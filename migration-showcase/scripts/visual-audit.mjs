import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';

const baseUrl = process.argv[2] ?? process.env.MIGRATION_URL ?? 'http://127.0.0.1:3000/';
const artifactDir = new URL('../artifacts/visual/', import.meta.url);

function pixelStats(buffer) {
  const png = PNG.sync.read(buffer);
  let count = 0;
  let sum = 0;
  let squareSum = 0;
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
  };
}

async function captureCanvas(page, filename) {
  const buffer = await page.locator('canvas').screenshot({ path: new URL(filename, artifactDir).pathname });
  const stats = pixelStats(buffer);
  assert.ok(stats.deviation > 4, `Canvas 像素方差过低：${JSON.stringify(stats)}`);
  assert.ok(stats.colorBuckets > 18, `Canvas 色阶不足：${JSON.stringify(stats)}`);
  return stats;
}

async function waitForWorld(page) {
  await page.waitForFunction(() => {
    const debug = window.__MIGRATION__;
    return debug?.snapshot().loadedChunks >= 12;
  }, null, { timeout: 20_000 });
}

async function auditDesktop(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await waitForWorld(page);
  await page.waitForTimeout(1200);

  assert.equal(await page.getByRole('radio').count(), 5, '起飞地点应有五个选项');
  const openingLayout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    width: document.documentElement.clientWidth,
    scrollHeight: document.documentElement.scrollHeight,
    height: document.documentElement.clientHeight,
    cameras: window.__MIGRATION__?.cameraNames.length,
  }));
  assert.equal(openingLayout.scrollWidth, openingLayout.width, '桌面首屏不应横向溢出');
  assert.equal(openingLayout.scrollHeight, openingLayout.height, '桌面首屏不应纵向溢出');
  assert.equal(openingLayout.cameras, 16, '镜位库应包含 16 个镜位');
  await page.screenshot({ path: new URL('desktop-opening.jpg', artifactDir).pathname, type: 'jpeg', quality: 84 });
  const openingPixels = await captureCanvas(page, 'desktop-opening-canvas.png');

  for (const [climate, slug] of [['雾境', 'mist'], ['暮粉', 'dusk'], ['雪境', 'snow']]) {
    await page.getByRole('radio', { name: new RegExp(climate) }).click();
    await page.waitForTimeout(850);
    await page.screenshot({ path: new URL(`climate-${slug}.jpg`, artifactDir).pathname, type: 'jpeg', quality: 84 });
  }

  await page.getByRole('radio', { name: /夜航/ }).click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: new URL('desktop-night-opening.jpg', artifactDir).pathname, type: 'jpeg', quality: 84 });
  await page.getByRole('button', { name: /开始迁徙/ }).click();
  await page.waitForFunction(() => (window.__MIGRATION__?.snapshot().journey ?? 0) > 1.5);
  await page.waitForTimeout(1000);
  const started = await page.evaluate(() => window.__MIGRATION__?.snapshot());
  assert.ok(started, '应能读取引擎状态');
  assert.equal(started.flock.count, 30, '桌面端应有 30 只鸟');
  assert.ok(started.flock.visible > 0, '进入旅程后至少应有鸟处于镜头内');
  assert.equal(started.flock.finite, true, '鸟群坐标必须保持有限值');
  assert.ok(started.loadedChunks <= 15, `活动分块数量异常：${started.loadedChunks}`);
  assert.equal(started.audioReady, true, '两首配乐应完成解码并开始声音系统');
  await page.screenshot({ path: new URL('desktop-journey.jpg', artifactDir).pathname, type: 'jpeg', quality: 88 });
  const journeyPixels = await captureCanvas(page, 'desktop-journey-canvas.png');

  const canvasBox = await page.locator('canvas').boundingBox();
  assert.ok(canvasBox, 'Canvas 应有可见边界');
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.96, canvasBox.y + canvasBox.height * 0.45);
  await page.waitForTimeout(700);
  const windy = await page.evaluate(() => window.__MIGRATION__?.snapshot());
  assert.ok((windy?.wind ?? 0) > 0.12, '光标靠近边缘时应产生风场');
  assert.equal(windy?.flock.finite, true, '风场作用后鸟群坐标必须稳定');

  await page.getByRole('button', { name: '自主镜头' }).click();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.52, canvasBox.y + canvasBox.height * 0.52);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.68, canvasBox.y + canvasBox.height * 0.37, { steps: 12 });
  await page.mouse.up();
  await page.mouse.wheel(0, -260);
  await page.waitForTimeout(650);
  const manual = await page.evaluate(() => window.__MIGRATION__?.snapshot());
  assert.equal(manual?.director.automatic, false, '自主镜头按钮应切换导演状态');
  assert.equal(manual?.director.name, '自由视角', '自主镜头应显示自由视角');
  await page.screenshot({ path: new URL('desktop-free-camera.jpg', artifactDir).pathname, type: 'jpeg', quality: 84 });

  await page.getByRole('button', { name: '隐藏诗句' }).click();
  assert.equal(await page.locator('.poem--visible').count(), 0, '诗句应能关闭');
  await page.getByRole('button', { name: '显示诗句' }).click();
  await page.getByRole('button', { name: '关闭音乐' }).click();
  await page.getByRole('button', { name: '开启音乐' }).waitFor();
  await page.getByRole('button', { name: '开启音乐' }).click();
  await page.getByRole('button', { name: '关闭音乐' }).waitFor();

  assert.deepEqual(errors, [], `浏览器控制台错误：${errors.join(' | ')}`);
  await context.close();
  return { openingPixels, journeyPixels, started, windy, manual };
}

async function auditViewport(browser, name, viewport, expectedScale, mobile = false) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await waitForWorld(page);
  await page.waitForTimeout(700);
  const layout = await page.evaluate(() => {
    const stage = document.querySelector('.orientation-stage');
    const canvas = document.querySelector('canvas');
    const bounds = stage?.getBoundingClientRect();
    return {
      stage: bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null,
      canvas: canvas ? { width: canvas.clientWidth, height: canvas.clientHeight } : null,
      viewport: { width: innerWidth, height: innerHeight },
      uiScale: getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim(),
      transform: stage ? getComputedStyle(stage).transform : 'none',
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      overflowY: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      birds: window.__MIGRATION__?.snapshot().flock.count,
    };
  });
  assert.ok(Math.abs(Number(layout.uiScale) - expectedScale) < 0.01, `${name} UI 比例错误`);
  assert.ok(layout.overflowX <= 1 && layout.overflowY <= 1, `${name} 页面发生溢出`);
  if (mobile) {
    assert.notEqual(layout.transform, 'none', '手机竖屏应旋转横向舞台');
    assert.equal(layout.birds, 22, '触屏端应有 22 只鸟');
    assert.ok(layout.stage && Math.abs(layout.stage.width - viewport.width) <= 2, '旋转舞台宽度应覆盖手机视口');
    assert.ok(layout.stage && Math.abs(layout.stage.height - viewport.height) <= 2, '旋转舞台高度应覆盖手机视口');
  }
  await page.screenshot({ path: new URL(`${name}.jpg`, artifactDir).pathname, type: 'jpeg', quality: 80 });
  const pixels = await captureCanvas(page, `${name}-canvas.png`);
  let touch;
  if (mobile) {
    // 在 CSS 已旋转的真实触屏坐标中验证单指风场与双指缩放。
    await page.getByRole('button', { name: /开始迁徙/ }).tap();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: '自主镜头' }).tap();
    const before = await page.evaluate(() => window.__MIGRATION__?.snapshot().director.distance);
    const cdp = await context.newCDPSession(page);
    const x = viewport.width * 0.5;
    const y = viewport.height * 0.5;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x, y: y - 50 }, { id: 2, x, y: y + 50 }] });
    for (const delta of [65, 80, 100]) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x, y: y - delta }, { id: 2, x, y: y + delta }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(650);
    const after = await page.evaluate(() => window.__MIGRATION__?.snapshot());
    assert.ok(after.director.distance < before * 0.8, '手机双指捏合应改变真实镜头距离');
    assert.equal(after.flock.finite, true, '触控后鸟群仍应稳定');
    touch = { distanceBefore: before, distanceAfter: after.director.distance, finite: after.flock.finite };
    await page.screenshot({ path: new URL('mobile-touch-journey.jpg', artifactDir).pathname, type: 'jpeg', quality: 84 });
  }
  assert.deepEqual(errors, [], `${name} 控制台错误：${errors.join(' | ')}`);
  await context.close();
  return { layout, pixels, touch };
}

async function captureShareImage(browser) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await waitForWorld(page);
  await page.waitForTimeout(700);
  await page.screenshot({ path: new URL('../public/og-migration.jpg', import.meta.url).pathname, type: 'jpeg', quality: 90 });
  await context.close();
}

await mkdir(artifactDir, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
} catch {
  browser = await chromium.launch({ headless: true });
}

try {
  const desktop = await auditDesktop(browser);
  const mobile = await auditViewport(browser, 'mobile-portrait', { width: 390, height: 844 }, 1, true);
  const large = await auditViewport(browser, 'large-2200', { width: 2200, height: 1240 }, 1.5);
  const cinema = await auditViewport(browser, 'cinema-3300', { width: 3300, height: 1856 }, 2);
  await captureShareImage(browser);
  const report = { desktop, mobile, large, cinema };
  await writeFile(new URL('report.json', artifactDir), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    result: '通过',
    desktop: { openingPixels: desktop.openingPixels, journeyPixels: desktop.journeyPixels, birds: desktop.started.flock.count, audio: desktop.started.audioReady, fps: Number(desktop.started.fps.toFixed(1)) },
    mobile, large, cinema,
    screenshots: artifactDir.pathname,
  }, null, 2));
} finally {
  await browser.close();
}
