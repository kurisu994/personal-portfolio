import assert from 'node:assert/strict';
import { EqualDepth, Vector3 } from 'three';
import { TreeMaterials } from '../src/scene/materials';
import { TreeModel } from '../src/scene/TreeModel';
import { Flock } from '../src/scene/Flock';
import { sampleClimate } from '../src/scene/climates';
import { bezier4, bendPoint } from '../src/scene/math';

/** 检查数学与生命时序，而非以统计计数替代真实页面视觉检查。 */
function auditMath(): void {
  assert.equal(bezier4(0), 0);
  assert.ok(Math.abs(bezier4(1) - 1) < 1e-10);
  let previous = 0;
  for (let i = 0; i <= 1000; i++) {
    const p = i / 1000, value = bezier4(p);
    assert.ok(value >= previous - 1e-12 && value <= 1 + 1e-12);
    previous = value;
    const a = sampleClimate(p), b = sampleClimate(Math.min(1, p + 1e-6));
    for (const key of ['skyTop', 'skyBottom', 'ground', 'trunk', 'leaf', 'light', 'ambient'] as const) {
      assert.ok(a[key].toArray().every(Number.isFinite));
      assert.ok(a[key].toArray().every((x, n) => Math.abs(x - b[key].toArray()[n]) < .001));
    }
  }
  const root = new Vector3(0, -1, 0);
  assert.equal(bendPoint(root, 9, 1, 1).distanceTo(root), 0);
  const anchor = new Vector3(3, 12, 2);
  assert.equal(bendPoint(anchor, 8, .8, -.5).distanceTo(bendPoint(anchor.clone(), 8, .8, -.5)), 0);
}

/** 防止跨程序的严格深度比较重新出现精度闪烁；像素覆盖另由真实 GPU 对照验证。 */
function auditDepthPasses(): void {
  const materials = new TreeMaterials();
  try {
    for (const [name, depth, color] of [
      ['木质部', materials.woodDepth, materials.wood],
      ['叶片', materials.leafDepth, materials.leaf],
    ] as const) {
      assert.equal(color.depthFunc, EqualDepth, `${name}应仅给预通道选中的表面着墨`);
      assert.equal(depth.vertexShader, color.vertexShader, `${name}两通道必须使用相同顶点变换`);
      assert.match(color.vertexShader, /\binvariant\s+gl_Position\s*;/, `${name}缺少跨程序位置一致性声明，会导致闪烁`);
      for (const key of ['uTime', 'uProgress', 'uWind']) {
        assert.equal(depth.uniforms[key], color.uniforms[key], `${name}两通道必须共享 ${key}`);
      }
      assert.equal(depth.side, color.side, `${name}两通道必须保持相同面剔除规则`);
    }
  } finally {
    materials.dispose();
  }
}

/** 正向、反向及跳转都必须由同一进度得到相同的挂接结果。 */
function auditTree(seed: number): void {
  const tree = new TreeModel(seed);
  for (const direction of [1, -1]) {
    for (let i = 0; i <= 500; i++) {
      const p = direction > 0 ? i / 500 : 1 - i / 500;
      tree.update(p, i / 60, .8, -.7, sampleClimate(p));
      const m = tree.metrics();
      assert.equal(m.orphans, 0, `种子 ${seed} 在 ${p} 出现悬空挂点`);
      assert.ok(Number.isFinite(m.maxHeight));
      if (p < .85) assert.equal(m.visibleFruits, 0);
      if (p === 0) { assert.equal(m.visibleBranches, 0); assert.equal(m.visibleLeaves, 0); }
      if (p === 1) { assert.equal(m.fruits, 42); assert.equal(m.visibleFruits, 42); assert.ok(m.leaves >= 1800); }
      assert.equal(tree.getPerches(i / 60, .8, -.7).length, 5);
    }
  }
  tree.group.traverse(object => {
    if ('geometry' in object) {
      const geometry = object.geometry as import('three').BufferGeometry;
      const positions = geometry.getAttribute('position');
      assert.ok(Array.from(positions.array).every(Number.isFinite));
    }
  });
  console.log(`树形 ${seed}：`, tree.metrics());
  tree.dispose(); tree.dispose();
}

/** 跨帧率验证终点收敛、回滚重放和动态栖息点。 */
function auditFlock(): void {
  const perches = Array.from({ length: 5 }, (_, i) => new Vector3((i - 2) * 2, 9 + i, i % 2));
  for (const fps of [15, 30, 60, 120]) {
    const flock = new Flock(21);
    for (let replay = 0; replay < 2; replay++) {
      flock.update(.8, 1 / fps, 0, perches, sampleClimate(.8));
      assert.equal(flock.metrics().visible, 0);
      for (let i = 0; i <= fps * 2; i++) flock.update(1, 1 / fps, i / fps, perches, sampleClimate(1));
      assert.equal(flock.metrics().landed, 5, `${fps}fps 五鸟应于两秒内栖息`);
      assert.equal(flock.metrics().finite, true);
    }
    flock.dispose();
  }
}

auditMath();
auditDepthPasses();
for (const seed of [7, 413, 20260918]) auditTree(seed);
auditFlock();
console.log('PASS：深度双通道位置一致性、四阶插值、气候连续性、三组树形正反向挂点、42果、5鸟跨帧率归巢。');
