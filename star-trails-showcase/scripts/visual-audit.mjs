import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const targetUrl = process.env.STAR_TRAILS_URL ?? 'http://127.0.0.1:3000/';
const artifactDir = resolve(__dirname, '../artifacts/visual');

const AUDIT_LOCATIONS = [
  { name: 'beijing', lat: 39.9042, lon: 116.4074 },
  { name: 'james-shoal', lat: 3.9667, lon: 112.2833 },
  { name: 'sydney', lat: -33.8688, lon: 151.2093 },
  { name: 'reykjavik', lat: 64.1466, lon: -21.9426 },
  { name: 'south-pole', lat: -89.0, lon: 0.0 },
];

const AUDIT_DATES = ['2026-03-21', '2026-06-21', '2026-09-21'];

function checkPixelActivity(buffer) {
  const png = PNG.sync.read(buffer);
  let totalLum = 0;
  let sampleCount = 0;
  let brightPixels = 0;

  for (let y = 0; y < png.height; y += 4) {
    for (let x = 0; x < png.width; x += 4) {
      const idx = (y * png.width + x) * 4;
      const r = png.data[idx];
      const g = png.data[idx + 1];
      const b = png.data[idx + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      totalLum += lum;
      sampleCount++;
      if (lum > 40) {
        brightPixels++;
      }
    }
  }

  const avgLum = totalLum / sampleCount;
  const starRatio = brightPixels / sampleCount;

  return {
    width: png.width,
    height: png.height,
    avgLum: Number(avgLum.toFixed(2)),
    starRatio: Number(starRatio.toFixed(4)),
  };
}

async function main() {
  await mkdir(artifactDir, { recursive: true });
  console.log(`🌌 [Visual Audit] 启动视觉验收测试... 目标服务: ${targetUrl}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  const results = [];

  for (const loc of AUDIT_LOCATIONS) {
    for (const date of AUDIT_DATES) {
      const query = `?lat=${loc.lat}&lon=${loc.lon}&date=${date}&fov=60&mode=0`;
      const fullUrl = `${targetUrl}${query}`;
      console.log(`📸 正在采集: ${loc.name} (${date})`);

      try {
        await page.goto(fullUrl, { waitUntil: 'networkidle', timeout: 15000 });
        // 等待累积曝光进行 2.5 秒
        await page.waitForTimeout(2500);

        const screenshotPath = resolve(
          artifactDir,
          `audit-${loc.name}-${date}.png`
        );
        const buffer = await page.screenshot({ path: screenshotPath });
        const stats = checkPixelActivity(buffer);

        console.log(
          `   -> 亮度均值: ${stats.avgLum}, 星光占比: ${(stats.starRatio * 100).toFixed(2)}%`
        );

        results.push({
          location: loc.name,
          date,
          status: 'SUCCESS',
          stats,
          file: `audit-${loc.name}-${date}.png`,
        });
      } catch (err) {
        console.error(`❌ 采集失败 ${loc.name} ${date}:`, err.message);
        results.push({
          location: loc.name,
          date,
          status: 'FAILED',
          error: err.message,
        });
      }
    }
  }

  await browser.close();

  const reportJson = resolve(artifactDir, 'visual-report.json');
  await writeFile(reportJson, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`✅ [Visual Audit] 视觉验收完成，报告与截图保存在 ${artifactDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
