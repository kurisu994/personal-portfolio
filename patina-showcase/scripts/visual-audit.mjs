import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';

/**
 * 苔痕的视觉验收。
 *
 * 两个版本都要测：工程版走 dev / preview 服务，零依赖版由脚本自己起一个
 * 只服务那一个文件的临时服务器。两个版本共用同一套断言与调试接口，
 * 因此「两版同源」这件事是被实际验证过的，而不是写在文档里的承诺。
 *
 *   pnpm verify:visual                    # 默认 http://127.0.0.1:3000/
 *   PATINA_URL=http://127.0.0.1:3000/ pnpm verify:visual
 */

const showcaseUrl = process.argv[2] ?? process.env.PATINA_URL ?? 'http://127.0.0.1:3000/';
const simpleEntry = new URL('../../patina/index.html', import.meta.url);
const artifactDir = new URL('../artifacts/visual/', import.meta.url);

/** 与 migration-showcase 相同的像素统计：方差与色阶数用来判断「画面上真的有东西」。 */
function pixelStats(buffer) {
  const png = PNG.sync.read(buffer);
  let count = 0;
  let sum = 0;
  let squareSum = 0;
  let inkRatio = 0;
  const buckets = new Set();

  for (let y = 0; y < png.height; y += 8) {
    for (let x = 0; x < png.width; x += 8) {
      const offset = (y * png.width + x) * 4;
      const red = png.data[offset];
      const green = png.data[offset + 1];
      const blue = png.data[offset + 2];
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      count += 1;
      sum += luminance;
      squareSum += luminance * luminance;
      // 纸底亮度约 240，低于 200 就算「有苔」。
      if (luminance < 200) inkRatio += 1;
      buckets.add(`${red >> 4}-${green >> 4}-${blue >> 4}`);
    }
  }

  const average = sum / count;
  return {
    width: png.width,
    height: png.height,
    average: Number(average.toFixed(2)),
    deviation: Number(Math.sqrt(squareSum / count - average * average).toFixed(2)),
    colorBuckets: buckets.size,
    inkRatio: Number((inkRatio / count).toFixed(3)),
  };
}

async function captureCanvas(page, filename) {
  const buffer = await page.locator('canvas').screenshot({ path: new URL(filename, artifactDir).pathname });
  const stats = pixelStats(buffer);
  assert.ok(stats.deviation > 4, `画面方差过低，可能没画出东西：${JSON.stringify(stats)}`);
  assert.ok(stats.colorBuckets > 18, `色阶不足：${JSON.stringify(stats)}`);
  return stats;
}

/** 两个版本共用的检查流程。 */
async function auditVariant(page, label, options = {}) {
  // 零依赖版跑在 CPU 上，走完整圈漫游要约两分钟，所以只验证第一个形态；
  // 完整漫游、路径连续性与形态递增由工程版与 verify:patina 负责。
  const { expectHighPrecision = true, morphs = ['spots', 'mitosis', 'maze', 'coral', 'bloom'] } = options;
  const report = { label, steps: [] };

  await page.waitForFunction(() => Boolean(window.__PATINA__), null, { timeout: 20_000 });
  await page.waitForTimeout(600);

  const initial = await page.evaluate(() => window.__PATINA__.snapshot());
  assert.ok(initial.simulationSize >= 128, `${label}：模拟分辨率过低（${initial.simulationSize}）`);
  if (expectHighPrecision) {
    assert.equal(initial.highPrecision, true, `${label}：拿不到浮点渲染，画面精度会下降`);
  }
  report.initial = initial;
  report.steps.push(`初始：${initial.simulationSize}² 网格，浮点=${initial.highPrecision}`);

  // 播种后应当真的长起来。
  // 注意用的是 advanceToMorph 而不是「换成目标参数再跑若干步」：
  // 参数瞬切会让 V 场崩解（实测 maze → coral 瞬切后 0.420 → 0.000，
  // 而走 8 秒渐变是 0.420 → 0.501），真实运行靠的就是那段渐变。
  await page.evaluate(() => {
    window.__PATINA__.restart();
    window.__PATINA__.sow(6);
    window.__PATINA__.advanceToMorph('spots');
  });
  await page.waitForTimeout(400);

  const grown = await page.evaluate(() => window.__PATINA__.snapshot());
  assert.ok(grown.coverage > 0.1, `${label}：第一个形态覆盖率只有 ${grown.coverage}，图案没长起来`);
  report.steps.push(`长出第一个形态：覆盖率 ${grown.coverage.toFixed(3)}`);
  const growthStats = await captureCanvas(page, `${label}-grown.png`);
  assert.ok(growthStats.inkRatio > 0.05, `${label}：画面上几乎看不到苔（墨色占比 ${growthStats.inkRatio}）`);
  report.steps.push(`生长后像素：墨色占比 ${growthStats.inkRatio}，色阶 ${growthStats.colorBuckets}`);

  // 沿漫游路径一路走下去，在每个形态的停留中段取一张。
  // 顺序必须与漫游顺序一致（覆盖率递增）：从「铺满」切回稀疏形态会崩解。
  const coverages = [];
  const brightness = [];
  for (const morph of morphs) {
    await page.evaluate((id) => window.__PATINA__.advanceToMorph(id), morph);
    await page.waitForTimeout(320);

    const snapshot = await page.evaluate(() => window.__PATINA__.snapshot());
    assert.equal(snapshot.morph, morph, `${label}：走到 ${morph} 时当前形态是 ${snapshot.morph}`);
    assert.ok(
      snapshot.coverage > 0.08,
      `${label}：${morph} 覆盖率 ${snapshot.coverage}，图案在漫游途中死掉了`,
    );
    coverages.push(snapshot.coverage);

    const stats = await captureCanvas(page, `${label}-${morph}.png`);
    brightness.push(stats.average);
    report.steps.push(
      `${morph}：覆盖率 ${snapshot.coverage.toFixed(3)}，墨色 ${stats.inkRatio}，平均亮度 ${stats.average}`,
    );
  }

  // 多个形态时才比较「是否越来越满」；单形态（零依赖版）只留极差检查。
  const spread = Math.max(...coverages) - Math.min(...coverages);
  if (morphs.length > 1) {
    assert.ok(spread > 0.3, `${label}：五个形态的覆盖率极差只有 ${spread.toFixed(3)}，形态可能没有区分开`);
    for (let index = 1; index < coverages.length; index += 1) {
      assert.ok(
        coverages[index] >= coverages[index - 1] - 0.05,
        `${label}：${morphs[index]} 的覆盖率不应低于前一个形态（${coverages[index - 1].toFixed(3)} → ${coverages[index].toFixed(3)}）`,
      );
    }
    const brightnessSpread = Math.max(...brightness) - Math.min(...brightness);
    assert.ok(
      brightnessSpread > 0.5,
      `${label}：五个形态的平均亮度差异只有 ${brightnessSpread.toFixed(2)}，画面可能没有实质变化`,
    );
    report.brightnessSpread = Number(brightnessSpread.toFixed(2));
  }
  report.coverageSpread = Number(spread.toFixed(3));

  // 界面文字应当跟着形态变。
  const morphLabel = await page.locator('#morph, .status__morph').first().textContent();
  assert.ok(morphLabel && morphLabel.trim().length > 0, `${label}：形态名称没有显示`);

  return report;
}

async function main() {
  await assert.doesNotReject(async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(artifactDir, { recursive: true });
  });

  // 零依赖版只有一个文件，用一个临时服务器喂给浏览器即可。
  const server = createServer(async (_request, response) => {
    const body = await readFile(simpleEntry);
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const simpleUrl = `http://127.0.0.1:${server.address().port}/`;

  const browser = await chromium.launch();
  const reports = [];
  const errors = [];

  try {
    for (const [label, url, options] of [
      ['showcase', showcaseUrl, { expectHighPrecision: true }],
      ['simple', simpleUrl, { expectHighPrecision: false, morphs: ['spots'] }],
    ]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`${label}: ${message.text()}`);
      });
      page.on('pageerror', (error) => errors.push(`${label}: ${error.message}`));

      await page.goto(url, { waitUntil: 'load' });
      console.log(`\n▶ ${label}  ${url}`);
      const report = await auditVariant(page, label, options);
      for (const step of report.steps) console.log(`  ${step}`);
      reports.push(report);

      await page.screenshot({
        path: new URL(`${label}-desktop.jpg`, artifactDir).pathname,
        type: 'jpeg',
        quality: 84,
      });

      // 四档视口，检查界面不溢出、画布始终铺满。
      for (const [width, height] of [
        [390, 844],
        [1440, 900],
        [2200, 1240],
        [3300, 1856],
      ]) {
        await page.setViewportSize({ width, height });
        await page.waitForTimeout(500);
        const layout = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          scrollHeight: document.documentElement.scrollHeight,
          clientHeight: document.documentElement.clientHeight,
        }));
        assert.equal(layout.scrollWidth, layout.clientWidth, `${label} ${width}×${height}：横向溢出`);
        assert.equal(layout.scrollHeight, layout.clientHeight, `${label} ${width}×${height}：纵向溢出`);
      }
      report.steps.push('四档视口 390/1440/2200/3300 均无溢出');
      console.log('  四档视口 390/1440/2200/3300 均无溢出');

      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  assert.equal(errors.length, 0, `控制台出现错误：\n${errors.join('\n')}`);

  const { writeFile } = await import('node:fs/promises');
  await writeFile(
    new URL('report.json', artifactDir),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), reports }, null, 2)}\n`,
    'utf8',
  );

  console.log('\n✓ 苔痕视觉验收通过（工程版 + 零依赖版）');
  console.log('  截图与报告写入 patina-showcase/artifacts/visual/');
}

await main();
