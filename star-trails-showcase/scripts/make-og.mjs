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

  // 默认使用北京的壮丽北天极回旋画面
  await page.goto(`${url}?lat=39.9042&lon=116.4074&date=2026-09-20&fov=60&mode=0`, {
    waitUntil: 'networkidle',
  });

  // 曝光等待一段时间以积累足够密集的同心圆光轨
  await page.waitForTimeout(3000);

  await page.screenshot({ path: output, type: 'jpeg', quality: 90 });
  await browser.close();

  console.log(`✨ 分享图已成功写入: ${output}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
