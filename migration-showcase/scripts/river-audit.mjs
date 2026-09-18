import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { chromium } from '@playwright/test';

const root = new URL('../', import.meta.url);
const output = new URL('artifacts/river/', root);
await mkdir(output, { recursive: true });
execFileSync('pnpm', [
  'exec', 'tsc', '--ignoreConfig', '--target', 'es2022', '--module', 'esnext',
  '--moduleResolution', 'bundler', '--skipLibCheck', '--outDir', new URL('modules/', output).pathname,
  new URL('src/scene/World.ts', root).pathname, new URL('src/scene/Director.ts', root).pathname,
], { stdio: 'pipe' });
const require = createRequire(import.meta.url);
const threeBuild = dirname(require.resolve('three'));
const engineSource = await readFile(new URL('src/scene/MigrationEngine.ts', root), 'utf8');
const near = Number(engineSource.match(/PerspectiveCamera\(42, 1, ([\d.]+), 7200\)/)?.[1]);
assert.ok(Number.isFinite(near), '需要从真实引擎读取镜头近裁剪面');

// 校验防退化：PaperShader 的纸纹不能引入时间项，否则超越奈奎斯特采样会在平静水面和天空导致高频像素抖动
assert.ok(
  !/paperNoise\([^)]*time/i.test(engineSource) && !/uniform\s+float\s+time;/i.test(engineSource),
  'PaperShader 纸纹噪声必须保持屏幕空间静态，不得采样时间 uniform（否则水面全屏闪烁）',
);
assert.ok(
  !engineSource.includes('paperPass.uniforms.time'),
  '引擎主循环中不得给纸纹传递时间驱动',
);

const document = `<!doctype html><meta charset="utf-8"><title>河面稳定性检视</title>
<style>body{margin:0;background:#202528}canvas{width:1440px;height:900px;display:block}</style><canvas></canvas>
<script type="importmap">{"imports":{"three":"/three.module.js"}}</script>
<script type="module">
import * as THREE from 'three';
import { World } from '/modules/World.js';
import { Director } from '/modules/Director.js';
import { sampleClimate } from '/modules/climates.js';
import { riverX } from '/modules/math.js';
const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:false,preserveDrawingBuffer:true});
renderer.setSize(1440,900);
renderer.setPixelRatio(1);
renderer.outputColorSpace=THREE.LinearSRGBColorSpace;
const target=new THREE.WebGLRenderTarget(1440,900);
const scene=new THREE.Scene();scene.background=new THREE.Color(0x111111);
const world=new World(9217);
world.update(4300,0,sampleClimate(riverX(4300),4300));
scene.add(world.group);
const camera=new THREE.PerspectiveCamera(42,1440/900,${near},7200);
const director=new Director(camera,9217);
const center=new THREE.Vector3(riverX(4300)-95,188,4300);
director.locatePreview(center);
const ground=new THREE.MeshBasicMaterial({color:0xff0000,side:THREE.DoubleSide});
const water=new THREE.MeshBasicMaterial({color:0x00ff00,side:THREE.FrontSide,transparent:true,opacity:.96,depthWrite:true});
const riverMeshes=[];const terrainMeshes=[];
let originalWater;
world.group.traverse(object=>{
  if(!object.isMesh&&!object.isLineSegments)return;
  if(object.material?.isShaderMaterial){originalWater=object.material;riverMeshes.push(object);object.material=water;}
  else if(object.material?.type==='MeshStandardMaterial'&&object.material.side===THREE.DoubleSide){terrainMeshes.push(object);object.material=ground;}
  else object.visible=false;
});
const pixels=new Uint8Array(1440*900*4),reference=new Uint8Array(pixels.length);
function render(){renderer.setRenderTarget(target);renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,1440,900,pixels);}
function measure(nearPlane,frames=90){
  camera.near=nearPlane;
  let missing=0,maxMissing=0,total=0,unstable=0;let previous;
  for(let frame=0;frame<frames;frame++){
    director.update(1/60,frame/60,0,center,false);
    terrainMeshes.forEach(m=>m.visible=false);render();reference.set(pixels);
    terrainMeshes.forEach(m=>m.visible=true);render();
    let missingFrame=0;const current=new Uint8Array(1440*900);
    // 去掉岸边两像素，避免把正常的边缘覆盖差异算成河床穿透。
    for(let y=2;y<898;y++)for(let x=2;x<1438;x++){
      const i=y*1440+x,p=i*4;
      if(reference[p+1]<200||reference[p-8+1]<200||reference[p+8+1]<200||reference[p-1440*8+1]<200||reference[p+1440*8+1]<200)continue;
      total++;
      if(pixels[p+1]<200){missing++;missingFrame++;current[i]=1;}
      if(previous&&previous[i]!==current[i])unstable++;
    }
    previous=current;maxMissing=Math.max(maxMissing,missingFrame);
  }
  const depthBits=renderer.getContext().getParameter(renderer.getContext().DEPTH_BITS);
  renderer.setRenderTarget(null);renderer.render(scene,camera);
  return {near:nearPlane,frames,depthBits,missingPixels:missing,maxMissingPerFrame:maxMissing,interiorSamples:total,missingRatio:missing/total,changingPixels:unstable};
}
function sampleWater(){
  terrainMeshes.forEach(m=>m.visible=false);
  riverMeshes.forEach(m=>m.material=originalWater);
  camera.near=${near};
  director.update(1/60,0,0,center,false);
  const width=720,height=450,scale=4;
  const low=new THREE.WebGLRenderTarget(width,height),high=new THREE.WebGLRenderTarget(width*scale,height*scale);
  const lowPixels=new Uint8Array(width*height*4),highPixels=new Uint8Array(width*height*scale*scale*4);
  let error=0,count=0,unstable=0;const histogram=new Uint32Array(256);let previousLow,previousReference;
  for(let frame=0;frame<12;frame++){
    world.waterUniforms.time.value=frame/60;
    camera.setViewOffset(width,height,frame*.17,0,width,height);
    renderer.setRenderTarget(low);renderer.render(scene,camera);renderer.readRenderTargetPixels(low,0,0,width,height,lowPixels);
    renderer.setRenderTarget(high);renderer.render(scene,camera);renderer.readRenderTargetPixels(high,0,0,width*scale,height*scale,highPixels);
    const reference=new Float32Array(width*height);
    for(let y=2;y<height-2;y++)for(let x=2;x<width-2;x++){
      const p=(y*width+x)*4;
      if(lowPixels[p+1]<30||lowPixels[p-8+1]<30||lowPixels[p+8+1]<30)continue;
      let sum=0,valid=true;
      for(let sy=0;sy<scale;sy++)for(let sx=0;sx<scale;sx++){
        const hp=((y*scale+sy)*width*scale+x*scale+sx)*4;
        if(highPixels[hp+1]<30)valid=false;
        sum+=highPixels[hp+1];
      }
      if(!valid)continue;
      const average=sum/(scale*scale),difference=Math.abs(lowPixels[p+1]-average);
      reference[y*width+x]=average;error+=difference;count++;histogram[Math.round(difference)]++;
      if(previousLow&&previousReference[y*width+x]>0){
        const change=lowPixels[p+1]-previousLow[p+1];
        const expected=average-previousReference[y*width+x];
        if(Math.abs(change-expected)>4)unstable++;
      }
    }
    previousLow=lowPixels.slice();previousReference=reference;
  }
  let percentile=0,total=0;for(let i=0;i<histogram.length;i++){total+=histogram[i];if(total>=count*.99){percentile=i;break;}}
  camera.clearViewOffset();renderer.setRenderTarget(null);renderer.render(scene,camera);
  low.dispose();high.dispose();
  return {frames:12,pixels:count,meanAliasingError:error/count,p99AliasingError:percentile,unstablePixels:unstable};
}
window.riverAudit={measure,sampleWater};
</script>`;

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  try {
    if (pathname === '/') response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(document);
    else if (['/three.module.js', '/three.core.js'].includes(pathname)) {
      response.writeHead(200, { 'content-type': 'text/javascript' }).end(await readFile(join(threeBuild, pathname.slice(1))));
    } else if (/^\/modules\/\w+(\.js)?$/.test(pathname)) {
      const file = pathname.split('/').at(-1).replace(/\.js$/, '') + '.js';
      response.writeHead(200, { 'content-type': 'text/javascript' }).end(await readFile(new URL('modules/' + file, output)));
    } else response.writeHead(204).end();
  } catch (error) { response.writeHead(500).end(error.message); }
});

await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
let browser;
try {
  try { browser = await chromium.launch({ channel: 'chrome', headless: true }); }
  catch { browser = await chromium.launch({ headless: true }); }
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + server.address().port);
  await page.waitForFunction(() => window.riverAudit);
  const baseline = await page.evaluate(() => window.riverAudit.measure(1));
  await page.screenshot({ path: new URL('depth-before.png', output).pathname });
  const probe = await page.evaluate(() => window.riverAudit.measure(12));
  await page.screenshot({ path: new URL('depth-probe.png', output).pathname });
  const aliasing=await page.evaluate(()=>window.riverAudit.sampleWater());
  await page.screenshot({path:new URL('water-detail.png',output).pathname});
  const report = { baseline, probe, aliasing, errors };
  await writeFile(new URL('diagnosis.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
