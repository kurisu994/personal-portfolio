import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const url = process.argv[2] ?? process.env.STAR_TRAILS_URL ?? 'http://127.0.0.1:3000/';
const output = resolve(__dirname, '../public/og-star-trails.jpg');

async function main() {
  console.log(`🌌 [Make OG] 正在连接服务 ${url} 生成分享图...`);
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  // 北京长城上空的北天极：分享链接会直接显影到 t 所在的时刻
  await page.goto(`${url}?lat=39.9042&lon=116.4074&date=2026-09-20&fov=85&mode=0&t=0.62`, {
    waitUntil: 'networkidle',
  });

  // 暂停在该时刻，等底片显影完成
  await page.getByRole('button', { name: '暂停曝光' }).click();
  await page.waitForFunction(() => !document.querySelector('.readouts__status[data-visible="true"]'), null, {
    timeout: 180000,
  });
  await page.waitForTimeout(600);

  await page.screenshot({ path: output, type: 'jpeg', quality: 90 });
  await browser.close();

  console.log(`✨ 分享图已成功写入: ${output}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
