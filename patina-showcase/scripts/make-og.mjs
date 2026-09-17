import { chromium } from '@playwright/test';

/**
 * 生成社交分享图（1200 × 630）。
 *
 * 用真实页面截取，不是拼图：先沿漫游路径走到「茂密」，等画面长满再拍。
 * 需要先在另一个终端跑 `pnpm dev` 或 `pnpm preview`。
 *
 *   pnpm make:og
 *   PATINA_URL=http://127.0.0.1:4173/ pnpm make:og
 */

const url = process.argv[2] ?? process.env.PATINA_URL ?? 'http://127.0.0.1:3000/';
const output = new URL('../public/og-patina.jpg', import.meta.url);

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
const page = await context.newPage();

await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => Boolean(window.__PATINA__), null, { timeout: 20_000 });

// 长到较满的一帧更像「作品」，空白纸面做分享图没有信息量。
await page.evaluate(() => {
  window.__PATINA__.restart();
  window.__PATINA__.sow(6);
  window.__PATINA__.advanceToMorph('coral');
  window.__PATINA__.advanceToMorph('bloom');
});
await page.waitForTimeout(1500);

const snapshot = await page.evaluate(() => window.__PATINA__.snapshot());
if (snapshot.coverage < 0.5) {
  throw new Error(`分享图生成时画面只有 ${snapshot.coverage} 的覆盖率，先确认参数是否被改动`);
}

await page.screenshot({ path: output.pathname, type: 'jpeg', quality: 90 });
await browser.close();

console.log(`✓ 分享图已写入 public/og-patina.jpg（覆盖率 ${snapshot.coverage.toFixed(3)}）`);
