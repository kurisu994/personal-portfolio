import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = process.argv[2] ?? process.env.TIDE_URL ?? 'http://127.0.0.1:3000/';
const output = resolve(__dirname, '../public/og-tide.jpg');

/** 分享图：细沙滩低潮后的午后，沙上写着「潮汐」，保留界面边注 */
async function main() {
  console.log(`🌊 [Make OG] 正在连接 ${url} 生成分享图...`);
  const args = process.platform === 'darwin' ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : [];
  const browser = await chromium.launch({ headless: true, args });
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(`${url}?coast=beach&date=2026-09-30&time=13:20`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__TIDE__));
  await page.evaluate(() => {
    const t = window.__TIDE__;
    t.setPlaying(false);
    const z = 6;
    const x = t.shoreline(z) - 7;
    t.writeText('潮汐', x, z);
    t.lookFrom([x - 10, 2.2, z - 3], [x + 10, -2.4, z + 2]);
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: output, type: 'jpeg', quality: 88 });
  await browser.close();
  console.log(`✨ 分享图已写入 ${output}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
