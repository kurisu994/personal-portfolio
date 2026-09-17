import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from '@playwright/test';

// 仅在本地验收时编译同一份模型源码，不向正式页面增加调试入口或额外依赖。
const require = createRequire(import.meta.url);
const threeDirectory = dirname(require.resolve('three'));
const output = new URL('../artifacts/model/', import.meta.url);
const baseUrl = process.argv[2] ?? process.env.MIGRATION_URL;
await mkdir(output, { recursive: true });
execFileSync('pnpm', [
  'exec', 'tsc', '--ignoreConfig', '--target', 'es2022', '--module', 'esnext',
  '--moduleResolution', 'bundler', '--skipLibCheck', '--outDir', new URL('modules/', output).pathname,
  new URL('../src/scene/PaperBird.ts', import.meta.url).pathname,
], { stdio: 'pipe' });
const model = await readFile(new URL('modules/PaperBird.js', output), 'utf8');
const document = `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<title>候鸟 · 模型检视</title>
<style>
  *{box-sizing:border-box}body{margin:0;background:#e9e3d6;color:#514d43;font-family:Georgia,serif}
  canvas{display:block;width:1600px;height:1040px}
  header{height:100px;padding:30px 50px;display:flex;justify-content:space-between;align-items:center}
  h1{font-size:23px;font-weight:400;letter-spacing:5px;margin:0}small{font:11px system-ui;letter-spacing:3px}
  .caption{position:absolute;font:10px system-ui;letter-spacing:2px;opacity:.7}
  .a{top:120px;left:50px}.b{top:120px;left:850px}.c{top:640px;left:50px}.d{top:640px;left:850px}
</style>
<header><h1>候鸟 · MIGRATION</h1><small>FOLDED BY THE WIND / MODEL STUDY</small></header>
<canvas></canvas><span class="caption a">01 / THREE-QUARTER</span><span class="caption b">02 / WING PLAN</span>
<span class="caption c">03 / SIDE PROFILE</span><span class="caption d">04 / UNDERSIDE</span>
<script type="importmap">{"imports":{"three":"/three.module.js"}}</script>
<script type="module">
import * as THREE from 'three';
import { createPaperBirdResources, createPaperBird, animatePaperBird, disposePaperBirdResources } from '/model.js';
const resources = createPaperBirdResources();
const bird = createPaperBird(resources);
const scene = new THREE.Scene();
const renderer = new THREE.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true});
renderer.setPixelRatio(1);
renderer.setSize(1600,1040);
renderer.outputColorSpace=THREE.SRGBColorSpace;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=.9;
const sky=new THREE.HemisphereLight(0xf2f5ee,0x979e88,1.2);
const key=new THREE.DirectionalLight(0xffecd3,2.1);key.position.set(-84,142,-76);
const fill=new THREE.DirectionalLight(0xd5e4ec,.32);fill.position.set(72,58,54);
scene.add(bird.group,sky,key,fill);
const positions=[[110,88,155],[0,180,1],[165,18,50],[100,-55,135]];
const cameras=positions.map(position=>{const c=new THREE.PerspectiveCamera(36,800/520,1,1000);c.position.set(...position);c.lookAt(0,0,0);return c});
function render(cycle,night=false){
  scene.background=new THREE.Color(night?0x172738:0xe9e3d6);
  sky.color.set(night?0x91aecb:0xf2f5ee);sky.intensity=night?1.1:1.2;
  key.color.set(night?0xb5d7ff:0xffecd3);key.intensity=night?1.5:2.1;
  fill.color.set(night?0x8fbfe8:0xd5e4ec);fill.intensity=night?.6:.32;
  bird.material.color.set(night?0xbecddd:0xf7f4ea);
  bird.material.emissive.copy(bird.material.color).multiplyScalar(night?.065:0);
  document.body.style.background=night?'#172738':'#e9e3d6';
  document.body.style.color=night?'#ced9e1':'#514d43';
  animatePaperBird(bird,cycle,1,.25,2);
  renderer.setScissorTest(true);
  for(let i=0;i<4;i++){
    const x=i%2*800, y=i<2?520:0;
    renderer.setViewport(x,y,800,520);renderer.setScissor(x,y,800,520);renderer.render(scene,cameras[i]);
  }
}
function inspect(){
  const geometry={};let triangles=0;
  for(const name of ['body','wing','tail']){
    const g=resources[name],p=g.getAttribute('position'),n=g.getAttribute('normal');
    let degenerate=0;
    const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
    for(let i=0;i<p.count;i+=3){
      a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1).sub(a);c.fromBufferAttribute(p,i+2).sub(a);
      if(b.cross(c).lengthSq()<1e-10)degenerate++;
    }
    geometry[name]={triangles:p.count/3,degenerate,finite:[...p.array,...n.array].every(Number.isFinite)};
    triangles+=p.count/3*(name==='wing'?2:1);
  }
  return {geometry,trianglesPerBird:triangles,meshesPerBird:bird.group.children.length,textureCount:renderer.info.memory.textures};
}
window.study={render,inspect,dispose(){bird.material.dispose();disposePaperBirdResources(resources);renderer.dispose()}};
render(.42);
</script></html>`;

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  try {
    if (pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(document);
    } else if (pathname === '/model.js') {
      response.writeHead(200, { 'content-type': 'text/javascript' }).end(model);
    } else if (['/three.module.js', '/three.core.js'].includes(pathname)) {
      response.writeHead(200, { 'content-type': 'text/javascript' }).end(await readFile(join(threeDirectory, pathname.slice(1))));
    } else {
      response.writeHead(204).end();
    }
  } catch (error) {
    response.writeHead(500).end(error.message);
  }
});

await mkdir(output, { recursive: true });
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
let browser;
try {
  try { browser = await chromium.launch({ channel: 'chrome', headless: true }); }
  catch { browser = await chromium.launch({ headless: true }); }
  const page = await browser.newPage({ viewport: { width: 1600, height: 1140 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => window.study);
  const report = await page.evaluate(() => window.study.inspect());
  for (const [name, result] of Object.entries(report.geometry)) {
    assert.ok(result.finite, `${name} 存在无效顶点或法线`);
    assert.equal(result.degenerate, 0, `${name} 存在退化三角形`);
  }
  assert.ok(report.trianglesPerBird < 600, '单鸟几何应保持轻量');
  assert.equal(report.meshesPerBird, 4, '鸟体、双翼与尾羽共四个网格');
  for (const [name, cycle, night] of [['warm', .42, false], ['upstroke', Math.PI / 2, false], ['downstroke', Math.PI * 1.5, false], ['night', .42, true]]) {
    await page.evaluate(({ cycle, night }) => window.study.render(cycle, night), { cycle, night });
    await page.screenshot({ path: new URL(`${name}.png`, output).pathname });
  }
  // 长时间改变翼尖形变，检查共享纹理没有随动画帧持续增长。
  const animated = await page.evaluate(() => {
    for (let i = 0; i < 120; i++) window.study.render(i / 12);
    return window.study.inspect();
  });
  assert.equal(animated.textureCount, report.textureCount, '动画不应反复创建纹理');
  assert.deepEqual(errors, [], '模型的 WebGL 材质编译与渲染不应报错');

  if (baseUrl) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const flight = await context.newPage();
    flight.on('pageerror', (error) => errors.push(error.message));
    flight.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await flight.goto(baseUrl, { waitUntil: 'networkidle' });
    await flight.waitForFunction(() => window.__MIGRATION__?.snapshot().loadedChunks >= 12);
    await flight.getByRole('button', { name: '开始迁徙' }).click();
    await flight.waitForFunction(() => window.__MIGRATION__?.snapshot().journey > 1.5);
    await flight.getByRole('button', { name: '自主镜头' }).click();
    await flight.mouse.move(640, 400);
    for (let i = 0; i < 8; i++) await flight.mouse.wheel(0, -175);

    const orbit = async (dx, dy) => {
      await flight.mouse.move(640, 400);
      await flight.mouse.down();
      await flight.mouse.move(640 + dx, 400 + dy, { steps: 16 });
      await flight.mouse.up();
      await flight.mouse.move(1430, 10);
      await flight.waitForTimeout(1100);
    };
    await orbit(0, 420);
    await flight.screenshot({ path: new URL('flight-overhead.jpg', output).pathname, type: 'jpeg', quality: 92 });
    await orbit(190, -155);
    await flight.screenshot({ path: new URL('flight-close.jpg', output).pathname, type: 'jpeg', quality: 92 });
    await orbit(0, -205);
    await flight.screenshot({ path: new URL('flight-low.jpg', output).pathname, type: 'jpeg', quality: 92 });
    report.flight = await flight.evaluate(() => window.__MIGRATION__.snapshot());
    assert.equal(report.flight.flock.finite, true, '近景环绕后鸟群应保持稳定');
    assert.ok(report.flight.flock.visible > 0, '低角度近景应可见鸟群');
    assert.deepEqual(errors, [], '实际飞行场景不应报错');
    await context.close();
  }
  await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ result: '通过', ...report, flight: report.flight ? { ...report.flight.flock, fps: report.flight.fps, distance: report.flight.director.distance } : undefined, screenshots: output.pathname }, null, 2));
  await page.evaluate(() => window.study.dispose());
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
