import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { localParts } from '../src/astro/sky';
import { COASTS } from '../src/data/coasts';
import { findExtrema } from '../src/tide/model';

/**
 * 真实浏览器视觉验收：
 * - 三种海岸 × 四个潮位阶段（低潮、涨半、高潮、落半）截图；
 * - 「写字 → 涨潮 → 抹去」三帧序列，并读回痕迹场断言字确实被抹掉。
 * 需要先启动 pnpm dev 或 pnpm preview，地址由 TIDE_URL 指定。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const base = process.env.TIDE_URL ?? 'http://127.0.0.1:3000/';
const outDir = resolve(__dirname, '../artifacts/visual');
const START = 2461313.5; // 2026-09-30 00:00 UT

interface TideHook {
  snapshot: () => { level: number; rate: number; clock: string };
  setPlaying: (on: boolean) => void;
  setSpeed: (s: number) => void;
  setCamera: (m: 'auto' | 'fixed' | 'free') => void;
  lookFrom: (from: [number, number, number], to: [number, number, number]) => void;
  cameraPose: () => { x: number; y: number; z: number };
  shoreline: (z: number) => number;
  writeText: (t: string, x: number, z: number) => void;
  fieldAt: (x: number, z: number, r?: number) => [number, number, number];
}
declare global {
  interface Window {
    __TIDE__?: TideHook;
  }
}

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__TIDE__));
  await page.evaluate(() => window.__TIDE__!.setPlaying(false));
  await page.waitForTimeout(2000);
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const args = process.platform === 'darwin' ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : [];
  const browser = await chromium.launch({ headless: true, args });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const results: Record<string, unknown>[] = [];

  for (const coast of COASTS) {
    const ex = findExtrema(coast.model, coast.lon, START, START + 1.5);
    const low = ex.find((e) => e.kind === 'low')!;
    const high = ex.find((e) => e.kind === 'high' && e.jd > low.jd)!;
    const nextLow = ex.find((e) => e.kind === 'low' && e.jd > high.jd) ?? { jd: high.jd + 0.26 };
    const phases = [
      ['low', low.jd],
      ['rising', (low.jd + high.jd) / 2],
      ['high', high.jd],
      ['falling', (high.jd + nextLow.jd) / 2],
    ] as const;
    for (const [name, jd] of phases) {
      const local = localParts(jd, coast.tz);
      await open(page, `${base}?coast=${coast.id}&date=${local.date}&time=${local.clock}`);
      const level = await page.evaluate(() => window.__TIDE__!.snapshot().level);
      const file = `tide-${coast.id}-${name}.png`;
      await page.screenshot({ path: resolve(outDir, file) });
      console.log(`📸 ${coast.name} ${name} ${local.date} ${local.clock} 潮位 ${level.toFixed(2)} m`);
      results.push({ coast: coast.id, phase: name, time: `${local.date} ${local.clock}`, level, file });
    }
  }

  // 写字 → 涨潮 → 抹去
  const beach = COASTS[0];
  const low = findExtrema(beach.model, beach.lon, START, START + 1).find((e) => e.kind === 'low')!;
  const t0 = localParts(low.jd - 0.5 / 24, beach.tz);
  await open(page, `${base}?coast=${beach.id}&date=${t0.date}&time=${t0.clock}`);
  const spot = await page.evaluate(() => {
    const t = window.__TIDE__!;
    const z = 4;
    const x = t.shoreline(z) - 5;
    t.writeText('潮汐', x, z);
    // 站在字后方八九米、略高处，看得见字也看得见水
    t.lookFrom([x - 9, 1.6, z - 1.5], [x + 6, -1.6, z + 0.8]);
    return { x, z, level: t.snapshot().level };
  });
  await page.addStyleTag({ content: '.hud { display: none !important; }' });
  await page.waitForTimeout(600);
  const trace = () => page.evaluate(({ x, z }) => window.__TIDE__!.fieldAt(x, z, 2.5)[1], spot);
  const written = await trace();
  await page.screenshot({ path: resolve(outDir, 'erase-1-written.png') });
  await page.evaluate(() => {
    window.__TIDE__!.setSpeed(3000);
    window.__TIDE__!.setPlaying(true);
  });
  let flooded = false;
  let remaining = written;
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(500);
    remaining = await trace();
    const snap = await page.evaluate(() => window.__TIDE__!.snapshot());
    if (!flooded && remaining < written * 0.6) {
      await page.screenshot({ path: resolve(outDir, 'erase-2-flooding.png') });
      flooded = true;
    }
    // 落潮退到写字时的水位附近，字所在的沙重新露出来再收尾
    if (flooded && snap.rate < 0 && snap.level < spot.level + 0.15 && remaining < 0.05) break;
  }
  await page.evaluate(() => window.__TIDE__!.setPlaying(false));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: resolve(outDir, 'erase-3-erased.png') });
  const erased = written > 0.5 && remaining < 0.05;
  console.log(`${erased ? '✅' : '❌'} 写字 → 抹去：写入 ${written.toFixed(2)}，最终 ${remaining.toFixed(3)}`);
  results.push({ sequence: 'write-erase', written, remaining, erased });

  await browser.close();
  const passed = erased && errors.length === 0;
  if (errors.length) console.log('页面错误：', errors);
  writeFileSync(resolve(outDir, 'visual-report.json'), JSON.stringify({ timestamp: new Date().toISOString(), status: passed ? 'PASSED' : 'FAILED', errors, results }, null, 2));
  console.log(passed ? '视觉验收通过，截图在 artifacts/visual' : '视觉验收失败');
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
