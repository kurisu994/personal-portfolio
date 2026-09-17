import assert from 'node:assert/strict';
import { Mesh, PerspectiveCamera, Vector3 } from 'three';
import { CAMERA_LIBRARY, Director } from '../src/scene/Director';
import { CLIMATES, SEGMENT_LENGTH, sampleClimate } from '../src/scene/climates';
import { World } from '../src/scene/World';
import { angleDelta, riverX } from '../src/scene/math';

// 验证真实导演轨迹：跨圈不跳位，所有镜位可达，镜头抽卡符合叙事约束。
const camera = new PerspectiveCamera(42, 16 / 9, 1, 7200);
const director = new Director(camera, 20260917);
const target = new Vector3(0, 188, 4300);
const previous = new Vector3();
const visited = new Set<string>();
const checkedCycles = new Set<number>();
director.locatePreview(target);
let largestStep = 0;

for (let second = 0; second < 13_000; second += 0.2) {
  const state = director.update(0.2, second, second, target, true);
  visited.add(state.name);
  assert.ok(Number.isFinite(camera.position.length()), '镜头位置必须保持有限值');
  if (second > 1) {
    const step = camera.position.distanceTo(previous);
    largestStep = Math.max(largestStep, step);
    assert.ok(step < 210, `镜头轨迹出现不连续位移：${step}`);
  }
  previous.copy(camera.position);
  const plan = director.plan;
  for (let index = 1; index < plan.length; index += 1) {
    assert.ok(Math.abs(angleDelta(plan[index - 1].yaw, plan[index].yaw)) >= Math.PI / 6 - 0.0001, '相邻镜位偏航差必须至少 30°');
    assert.ok(plan[index].duration >= 16 && plan[index].duration <= 19, '每镜应保持 16–19 秒');
  }
  for (const shot of plan) {
    if (checkedCycles.has(shot.cycle)) continue;
    const cycleShots = plan.filter((entry) => entry.cycle === shot.cycle);
    if (cycleShots.length !== 6) continue;
    assert.equal(cycleShots[3].name, shot.cycle % 2 ? '迎面来风' : '追随背影', '压轴镜头应隔圈轮换');
    checkedCycles.add(shot.cycle);
  }
}
assert.equal(visited.size, CAMERA_LIBRARY.length, '长旅程中全部 16 个镜位应可达');

// 锋面逐点取样，检查地理边界前后 RGB 与气候强度的连续性。
let maxColorStep = 0;
for (let boundary = 0; boundary <= 10; boundary += 1) {
  for (const x of [-1800, -520, 0, 750, 1800]) {
    let previousSample = sampleClimate(x, boundary * SEGMENT_LENGTH - 2450);
    for (let offset = -2442; offset < 2450; offset += 8) {
      const sample = sampleClimate(x, boundary * SEGMENT_LENGTH + offset);
      for (const key of ['sky', 'ground', 'river', 'bird', 'ink'] as const) {
        for (let channel = 0; channel < 3; channel += 1) {
          const difference = Math.abs(sample[key][channel] - previousSample[key][channel]);
          maxColorStep = Math.max(maxColorStep, difference);
          assert.ok(difference < 0.012, `气候 ${key} 存在突变`);
        }
      }
      assert.ok(sample.index >= 0 && sample.index < CLIMATES.length);
      previousSample = sample;
    }
  }
}

// 分块经历数百次加载卸载后仍保持固定数量，地表法线始终朝上。
const world = new World(20260917);
for (let step = 0; step < 200; step += 1) {
  const z = 4300 + step * 720;
  world.update(z, step, sampleClimate(riverX(z), z));
  assert.equal(world.loadedChunks, 15, '世界分块缓存不得随旅程增长');
  assert.equal(world.group.children.length, 15, '卸载的分块必须离开场景树');
}
const groundMesh = world.group.children[0].children[0] as Mesh;
assert.ok(groundMesh.geometry.getAttribute('normal').getY(0) > 0.99, '地表应朝向天空');
world.dispose();

console.log(JSON.stringify({
  checkedCycles: checkedCycles.size,
  visitedCameras: [...visited],
  largestCameraStepPer200ms: Number(largestStep.toFixed(2)),
  maxClimateColorStepPer8Units: Number(maxColorStep.toFixed(5)),
  chunkTransitions: 200,
  activeChunkLimit: 15,
}, null, 2));
