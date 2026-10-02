import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { localParts } from '../src/astro/sky';
import { COASTS } from '../src/data/coasts';
import { findExtrema } from '../src/tide/model';

/**
 * 零依赖版（../tide/index.html）的真实浏览器验收：
 * - 三种海岸 × 四个潮位阶段（低潮、涨半、高潮、落半）截图，外加一张窄屏；
 * - 走真实界面：拖动划线、输入文字再点沙滩，读回痕迹场确认写进去了；
 * - 「写字 → 涨潮 → 抹去」三帧序列，断言字确实被抹掉；
 * - 全程不允许页面以外的任何网络请求，也不允许页面报错。
 * 脚本自己起一个只服务那一个文件的临时服务器，不需要先启动 dev。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = resolve(__dirname, '../../tide/index.html');
const outDir = resolve(__dirname, '../artifacts/simple');
const START = 2461313.5; // 2026-09-30 00:00 UT

interface SimpleHook {
  variant: string;
  snapshot: () => { level: number; rate: number; clock: string; cut: number };
  setPlaying: (on: boolean) => void;
  setSpeed: (speed: number) => void;
  writeText: (text: string, x: number, z: number, heightM?: number) => void;
  shoreline: (z: number) => number;
  fieldAt: (x: number, z: number, radius?: number) => [number, number, number];
  view: () => { x0: number; x1: number; z0: number; z1: number; planTop: number; planHeight: number; sx: number };
}
// 不扩充全局 Window：visual-audit.ts 已把同名属性声明为工程版的接口，这里用局部断言
type SimpleWindow = { __TIDE__?: SimpleHook };

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => (window as unknown as SimpleWindow).__TIDE__?.variant === 'simple');
  await page.evaluate(() => (window as unknown as SimpleWindow).__TIDE__!.setPlaying(false));
  await page.waitForTimeout(1200);
}

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const html = readFileSync(entry);
  const server = createServer((request, response) => {
    if (request.url === '/' || request.url?.startsWith('/?')) {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(html);
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

  const args = process.platform === 'darwin' ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : [];
  const browser = await chromium.launch({ headless: true, args });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  const foreign: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // 只允许页面本身与内联的 data: 资源
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.protocol !== 'data:' && !(url.origin === new URL(base).origin && url.pathname === '/')) foreign.push(r.url());
  });
  const results: Record<string, unknown>[] = [];

  // 1. 三种海岸 × 四个潮位阶段
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
      const level = await page.evaluate(() => (window as unknown as SimpleWindow).__TIDE__!.snapshot().level);
      const file = `simple-${coast.id}-${name}.png`;
      await page.screenshot({ path: resolve(outDir, file) });
      console.log(`📸 ${coast.name} ${name} ${local.date} ${local.clock} 潮位 ${level.toFixed(2)} m`);
      results.push({ coast: coast.id, phase: name, time: `${local.date} ${local.clock}`, level, file });
    }
  }

  // 2. 走真实界面书写：拖动划线、写字再点沙滩
  const beach = COASTS[0];
  const low = findExtrema(beach.model, beach.lon, START, START + 1).find((e) => e.kind === 'low')!;
  const t0 = localParts(low.jd - 0.5 / 24, beach.tz);
  await open(page, `${base}?coast=${beach.id}&date=${t0.date}&time=${t0.clock}`);
  const geo = await page.evaluate(() => {
    const t = (window as unknown as SimpleWindow).__TIDE__!;
    const v = t.view();
    const z = v.z0 + (v.z1 - v.z0) * 0.3;
    const x = t.shoreline(z) - 12;
    return { v, z, x };
  });
  const toScreen = (x: number, z: number) => ({ x: (x - geo.v.x0) * geo.v.sx, y: geo.v.planTop + (z - geo.v.z0) * geo.v.sx });
  const a = toScreen(geo.x - 6, geo.z);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(a.x + i * 6, a.y + Math.sin(i / 2) * 8);
  await page.mouse.up();
  const penTrace = await page.evaluate(({ x, z }) => (window as unknown as SimpleWindow).__TIDE__!.fieldAt(x, z, 1)[1], { x: geo.x - 6, z: geo.z });
  await page.getByRole('radio', { name: '写字' }).click();
  await page.getByLabel('要写在沙上的字').fill('涨潮');
  const b = toScreen(geo.x + 4, geo.z + 6);
  await page.mouse.click(b.x, b.y);
  await page.waitForTimeout(200);
  const textTrace = await page.evaluate(({ x, z }) => (window as unknown as SimpleWindow).__TIDE__!.fieldAt(x, z, 2)[1], { x: geo.x + 4, z: geo.z + 6 });
  const inputCleared = (await page.getByLabel('要写在沙上的字').inputValue()) === '';
  await page.screenshot({ path: resolve(outDir, 'simple-ui-write.png') });
  const uiWrite = penTrace > 0.5 && textTrace > 0.5 && inputCleared;
  console.log(`${uiWrite ? '✅' : '❌'} 界面书写：划线 ${penTrace.toFixed(2)}，写字 ${textTrace.toFixed(2)}，输入框${inputCleared ? '已清空' : '未清空'}`);
  results.push({ sequence: 'ui-write', penTrace, textTrace, inputCleared, pass: uiWrite });

  // 3. 写字 → 涨潮 → 抹去
  await open(page, `${base}?coast=${beach.id}&date=${t0.date}&time=${t0.clock}`);
  const spot = await page.evaluate(() => {
    const t = (window as unknown as SimpleWindow).__TIDE__!;
    const z = t.snapshot().cut - 8;
    const x = t.shoreline(z) - 6;
    t.writeText('潮汐', x, z);
    return { x, z, level: t.snapshot().level };
  });
  await page.waitForTimeout(400);
  const trace = () => page.evaluate(({ x, z }) => (window as unknown as SimpleWindow).__TIDE__!.fieldAt(x, z, 2.5)[1], spot);
  const written = await trace();
  await page.screenshot({ path: resolve(outDir, 'simple-erase-1-written.png') });
  await page.evaluate(() => {
    (window as unknown as SimpleWindow).__TIDE__!.setSpeed(3000);
    (window as unknown as SimpleWindow).__TIDE__!.setPlaying(true);
  });
  let flooded = false;
  let remaining = written;
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(500);
    remaining = await trace();
    const snap = await page.evaluate(() => (window as unknown as SimpleWindow).__TIDE__!.snapshot());
    if (!flooded && remaining < written * 0.6) {
      await page.screenshot({ path: resolve(outDir, 'simple-erase-2-flooding.png') });
      flooded = true;
    }
    // 落潮退到写字时的水位附近，字所在的沙重新露出来再收尾
    if (flooded && snap.rate < 0 && snap.level < spot.level + 0.15 && remaining < 0.05) break;
  }
  await page.evaluate(() => (window as unknown as SimpleWindow).__TIDE__!.setPlaying(false));
  await page.waitForTimeout(800);
  await page.screenshot({ path: resolve(outDir, 'simple-erase-3-erased.png') });
  const erased = written > 0.5 && remaining < 0.05;
  console.log(`${erased ? '✅' : '❌'} 写字 → 抹去：写入 ${written.toFixed(2)}，最终 ${remaining.toFixed(3)}`);
  results.push({ sequence: 'write-erase', written, remaining, erased });

  // 4. 窄屏
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  phone.on('pageerror', (e) => errors.push(e.message));
  const t1 = localParts(low.jd + 2 / 24, beach.tz);
  await open(phone, `${base}?coast=${beach.id}&date=${t1.date}&time=${t1.clock}`);
  await phone.screenshot({ path: resolve(outDir, 'simple-narrow.png') });
  console.log('📸 窄屏 390 × 844');

  await browser.close();
  server.close();
  const offline = foreign.length === 0;
  console.log(`${offline ? '✅' : '❌'} 零网络请求：页面之外的请求 ${foreign.length} 个`);
  if (errors.length) console.log('页面错误：', errors);
  const passed = uiWrite && erased && offline && errors.length === 0;
  writeFileSync(
    resolve(outDir, 'simple-report.json'),
    JSON.stringify({ timestamp: new Date().toISOString(), status: passed ? 'PASSED' : 'FAILED', errors, foreign, results }, null, 2),
  );
  console.log(passed ? '零依赖版验收通过，截图在 artifacts/simple' : '零依赖版验收失败');
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
