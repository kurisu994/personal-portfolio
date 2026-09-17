import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Director, FLUSH_DURATION, SATURATION_HOLD, SEED_DURATION } from '../src/core/Director';
import { GrayScottField } from '../src/core/GrayScott';
import {
  DIFFUSION,
  MORPH_BY_ID,
  MORPHS,
  RESOLVED_PATH,
  ROAM_BLEND,
  ROAM_CYCLE,
  ROAM_DWELL,
  ROAM_PATH,
} from '../src/core/presets';

/**
 * 苔痕的离线验收。
 *
 * 全部跑 CPU 内核，不需要浏览器——屏幕上跑的是同一组公式（见 src/gl/shaders.ts），
 * 所以这些断言对线上画面同样有效。三类检查：
 *
 *   1. 数值健全性：不发散、不越界、长程不溢出。
 *   2. 形态稳定性：五组参数在五万步后仍处于「有图案」区间。这一条最关键——
 *      Gray-Scott 的 (F, k) 平面里，有图案的只是一条窄带，带外与带边存在
 *      双稳态缝隙，照抄文献参数会在一分钟后整片消失。
 *   3. 叙事正确性：漫游折线整段安全、参数连续、状态机相位与时长正确。
 */

const here = dirname(fileURLToPath(import.meta.url));
const artifactDir = join(here, '..', 'artifacts', 'patina');
mkdirSync(artifactDir, { recursive: true });

const started = Date.now();

/** 覆盖率必须落在这个区间才算「有图案」，两侧分别是全空与全满。 */
const COVERAGE_MIN = 0.08;
const COVERAGE_MAX = 0.95;

function log(section: string, message: string): void {
  console.log(`  ${section}  ${message}`);
}

function makeField(size: number, seeds: number): GrayScottField {
  const field = new GrayScottField(size, size);
  if (seeds >= 1) field.seed(size * 0.5, size * 0.5, size * 0.06);
  if (seeds >= 2) field.seed(size * 0.28, size * 0.3, size * 0.045);
  if (seeds >= 3) field.seed(size * 0.72, size * 0.7, size * 0.045);
  return field;
}

// ── 1. 数值健全性与生长性 ─────────────────────────────────────────────
console.log('\n▶ 数值健全性与生长性');

const growthCurve: { id: string; at: number; meanV: number; coverage: number }[] = [];

// 网格尺寸必须与稳定性检查一致：48² 装不下 mitosis 这类大尺度图案
// （特征尺度约 8–10 格），环绕边界会把图案搅死，得出「长不起来」的假结论。
for (const morph of MORPHS) {
  const field = makeField(64, 3);
  const afterSeed = field.meanV();
  assert.ok(afterSeed > 0, `${morph.id}：播种后 V 必须大于 0`);

  for (let step = 1; step <= 5000; step += 1) {
    field.step({ ...DIFFUSION, feed: morph.feed, kill: morph.kill });
  }

  const grown = field.meanV();
  assert.ok(field.isSane(), `${morph.id}：5000 步后出现 NaN / 越界`);
  // 种子会先被消耗一小段再开始扩张，所以不断言「一开始就单调增长」，
  // 但 5000 步之后必须显著长起来。
  assert.ok(
    grown > afterSeed * 1.5,
    `${morph.id}：V 总量没有长起来（播种 ${afterSeed.toFixed(4)} → ${grown.toFixed(4)}）`,
  );

  log(morph.id.padEnd(9), `播种 ${afterSeed.toFixed(4)} → 5000 步 ${grown.toFixed(4)}，覆盖率 ${field.coverage().toFixed(3)}`);
}

// ── 2. 长程稳定性 ─────────────────────────────────────────────────────
console.log('\n▶ 长程稳定性（64² 网格，五万步）');

const marks = [5000, 15000, 40000, 50000];
const stability: Record<string, number[]> = {};

for (const morph of MORPHS) {
  const field = makeField(64, 3);
  const readings: number[] = [];
  let step = 0;

  for (const mark of marks) {
    while (step < mark) {
      field.step({ ...DIFFUSION, feed: morph.feed, kill: morph.kill });
      step += 1;
    }
    assert.ok(field.isSane(), `${morph.id}：${mark} 步时出现 NaN / 越界 / 溢出`);
    const coverage = field.coverage();
    readings.push(coverage);
    growthCurve.push({ id: morph.id, at: mark, meanV: field.meanV(), coverage });
  }

  stability[morph.id] = readings;

  for (const coverage of readings) {
    assert.ok(
      coverage > COVERAGE_MIN && coverage < COVERAGE_MAX,
      `${morph.id}：覆盖率 ${coverage.toFixed(3)} 落在图案区之外，说明参数踩到了双稳态边界`,
    );
  }

  log(
    morph.id.padEnd(11),
    marks.map((mark, index) => `${mark}=${readings[index].toFixed(3)}`).join('  ') + '  稳定',
  );
}

// ── 2b. 真实分辨率复核 ────────────────────────────────────────────────
// 校准分辨率必须与运行分辨率一致，所以这里按 256² 再跑一次，并与 presets
// 里登记的值对账。早先就是在这一步发现 mitosis(0.0367, 0.065) 在 256² 下
// 会整片死掉（覆盖率 0.000），而在 64² 上看不出来。
console.log('\n▶ 真实分辨率复核（256² 网格，与运行时一致）');

for (const morph of MORPHS) {
  const field = makeField(256, 3);
  for (let step = 0; step < 25000; step += 1) {
    field.step({ ...DIFFUSION, feed: morph.feed, kill: morph.kill });
  }
  assert.ok(field.isSane(), `${morph.id}：256² 下数值异常`);
  const coverage = field.coverage();

  assert.ok(
    coverage > COVERAGE_MIN,
    `${morph.id}：256² 下覆盖率只有 ${coverage.toFixed(3)}，图案长不起来（校准分辨率与运行分辨率不一致的典型症状）`,
  );
  assert.ok(
    Math.abs(coverage - morph.coverage) < 0.06,
    `${morph.id}：256² 实测覆盖率 ${coverage.toFixed(3)} 与 presets 登记的 ${morph.coverage} 不符，请重新校准`,
  );

  log(morph.id.padEnd(11), `覆盖率 ${coverage.toFixed(3)}（登记 ${morph.coverage}）`);
}

// 漫游顺序必须按覆盖率递增：从「铺满」切回稀疏形态会让整场 V 变成 0。
for (let index = 1; index < MORPHS.length; index += 1) {
  assert.ok(
    MORPHS[index].coverage > MORPHS[index - 1].coverage,
    `形态顺序必须按覆盖率递增：${MORPHS[index - 1].id}(${MORPHS[index - 1].coverage}) 后面跟了 ${MORPHS[index].id}(${MORPHS[index].coverage})`,
  );
}
log('顺序检查', MORPHS.map((morph) => morph.coverage.toFixed(2)).join(' → ') + ' 递增');

// 把「从铺满切回稀疏会崩解」这条结论固化成断言，防止有人再把顺序改回去。
{
  const field = makeField(64, 3);
  for (let step = 0; step < 45000; step += 1) {
    field.step({ ...DIFFUSION, feed: 0.05, kill: 0.06 });
  }
  const filled = field.coverage();
  assert.ok(filled > 0.8, 'bloom 应当能把画面铺满');
  for (let step = 0; step < 45000; step += 1) {
    field.step({ ...DIFFUSION, feed: 0.029, kill: 0.057 });
  }
  const afterSwitch = field.coverage();
  assert.ok(
    afterSwitch < 0.05,
    `预期「铺满后切到迷宫」会崩解，实际覆盖率 ${afterSwitch.toFixed(3)}——如果这条不再成立，说明漫游顺序的约束可以重新评估`,
  );
  log('铺满后切稀疏', `${filled.toFixed(3)} → ${afterSwitch.toFixed(3)}（确实会崩解，因此顺序不能回头）`);
}

// ── 3. 漫游折线整段安全 ───────────────────────────────────────────────
console.log('\n▶ 漫游折线（每一段都必须整段落在图案区内）');

// 最后一段 bloom → spots 不参与断言：真实运行中它不会以「参数演化」的方式
// 发生，而是被冲刷相位替代（整场清空后从 spots 重新播种）。
const EVOLVING_SEGMENTS = RESOLVED_PATH.length - 1;
const roamCurve: { from: string; to: string; t: number; feed: number; kill: number; coverage: number }[] = [];

for (let index = 0; index < EVOLVING_SEGMENTS; index += 1) {
  const from = RESOLVED_PATH[index];
  const to = RESOLVED_PATH[(index + 1) % RESOLVED_PATH.length];

  const readings: number[] = [];
  for (let sample = 0; sample <= 4; sample += 1) {
    const t = sample / 4;
    const feed = from.feed + (to.feed - from.feed) * t;
    const kill = from.kill + (to.kill - from.kill) * t;
    const field = makeField(64, 3);
    for (let step = 0; step < 15000; step += 1) {
      field.step({ ...DIFFUSION, feed, kill });
    }
    assert.ok(field.isSane(), `${from.morph.id} → ${to.morph.id} 在 t=${t} 处数值异常`);
    const coverage = field.coverage();
    readings.push(coverage);
    roamCurve.push({ from: from.morph.id, to: to.morph.id, t, feed, kill, coverage });

    assert.ok(
      coverage > COVERAGE_MIN && coverage < COVERAGE_MAX,
      `${from.morph.id} → ${to.morph.id} 在 t=${t} 处覆盖率 ${coverage.toFixed(3)}，插值路径穿过了空白或全满区`,
    );
  }

  // 相邻采样点之间不应该出现覆盖率的断崖，否则画面上会看到突变。
  for (let sample = 1; sample < readings.length; sample += 1) {
    const jump = Math.abs(readings[sample] - readings[sample - 1]);
    assert.ok(jump < 0.35, `${from.morph.id} → ${to.morph.id} 覆盖率跳变 ${jump.toFixed(3)}，插值不平滑`);
  }

  log(
    `${from.morph.id} → ${to.morph.id}`.padEnd(20),
    readings.map((value) => value.toFixed(3)).join('  '),
  );
}

// ── 3b. 完整过渡模拟 ──────────────────────────────────────────────────
// 逐点采样只能说明「路径上每个位置都不错」，但真实运行是连续插值，
// 会在缝隙里停留几百步。这里按真实帧率与步率跑完整条过渡，
// 断言画面在过渡结束时还活着——这才是玩家真正会经历的。
console.log('\n▶ 完整过渡模拟（按真实步率走完整段过渡）');

for (let index = 0; index < EVOLVING_SEGMENTS; index += 1) {
  const from = RESOLVED_PATH[index];
  const to = RESOLVED_PATH[(index + 1) % RESOLVED_PATH.length];
  const field = makeField(64, 3);

  // 先在起点形态稳定下来，模拟「已经停了 38 秒」的状态。
  for (let step = 0; step < 15000; step += 1) {
    field.step({ ...DIFFUSION, feed: from.feed, kill: from.kill });
  }
  const stable = field.coverage();

  // 每帧 16 步、60 fps，走完 ROAM_BLEND 秒。
  const frames = Math.round(ROAM_BLEND * 60);
  for (let frame = 0; frame < frames; frame += 1) {
    const t = frame / frames;
    const feed = from.feed + (to.feed - from.feed) * t;
    const kill = from.kill + (to.kill - from.kill) * t;
    for (let step = 0; step < 16; step += 1) {
      field.step({ ...DIFFUSION, feed, kill });
    }
  }

  const arrived = field.coverage();
  assert.ok(field.isSane(), `${from.morph.id} → ${to.morph.id} 过渡后数值异常`);
  assert.ok(
    arrived > COVERAGE_MIN,
    `${from.morph.id} → ${to.morph.id} 过渡结束时画面几乎空白（${stable.toFixed(3)} → ${arrived.toFixed(3)}）`,
  );

  log(`${from.morph.id} → ${to.morph.id}`.padEnd(20), `${stable.toFixed(3)} → ${arrived.toFixed(3)}`);
}

// ── 4. 叙事状态机 ─────────────────────────────────────────────────────
console.log('\n▶ 叙事状态机');

{
  const director = new Director(20260917);
  const delta = 1 / 30;
  const phases: string[] = [];
  const seedCounts: number[] = [];
  let coverage = 0;
  let previousFeed = Number.NaN;
  let previousPhase = '';
  let growingStart = -1;
  let flushStartedAt = -1;
  let flushEndedAt = -1;
  let lastElapsed = 0;
  let maxParamStep = 0;

  const totalFrames = Math.ceil(((SEED_DURATION + ROAM_CYCLE + FLUSH_DURATION) * 2.2) / delta);
  for (let frame = 0; frame < totalFrames; frame += 1) {
    // 模拟真实生长：覆盖率缓慢爬到 0.5，不足以触发饱和重生，
    // 因此这一轮的重生必须由「漫游走完一圈」触发。
    coverage = Math.min(0.5, coverage + 0.0008);
    const step = director.update(delta, coverage);

    if (step.phase !== previousPhase) {
      phases.push(step.phase);
      if (step.phase === 'growing' && growingStart < 0) growingStart = frame * delta;
      if (step.phase === 'flushing' && flushStartedAt < 0) flushStartedAt = frame * delta;
      if (previousPhase === 'flushing' && flushEndedAt < 0) flushEndedAt = frame * delta;
      previousPhase = step.phase;
    }

    if (step.actions.length > 0) seedCounts.push(step.actions.length);

    if (Number.isFinite(previousFeed)) {
      maxParamStep = Math.max(maxParamStep, Math.abs(step.params.feed - previousFeed));
    }
    previousFeed = step.params.feed;

    for (const action of step.actions) {
      assert.ok(
        action.x > 0 && action.x < 1 && action.y > 0 && action.y < 1,
        '播种点必须落在画面内，否则会被边缘裁掉',
      );
      assert.ok(action.radius > 0 && action.radius < 0.1, '播种半径必须合理');
    }
    lastElapsed = frame * delta;
  }

  assert.deepEqual(phases.slice(0, 4), ['seeding', 'growing', 'flushing', 'seeding'], '相位顺序应为 播种 → 蔓延 → 重生 → 播种');
  for (const count of seedCounts) {
    assert.ok(count >= 3 && count <= 8, `每次播种 3–8 团孢子，实际 ${count}`);
  }
  // 蔓延相位应当恰好持续一圈漫游的时长。
  assert.ok(
    Math.abs(flushStartedAt - growingStart - ROAM_CYCLE) < 0.2,
    `蔓延持续应为一圈 ${ROAM_CYCLE.toFixed(1)}s，实际 ${(flushStartedAt - growingStart).toFixed(1)}s`,
  );
  assert.ok(
    Math.abs(flushEndedAt - flushStartedAt - FLUSH_DURATION) < 0.2,
    `冲刷应持续 ${FLUSH_DURATION}s，实际 ${(flushEndedAt - flushStartedAt).toFixed(2)}s`,
  );
  assert.ok(maxParamStep < 0.01, `相邻帧参数变化过大：${maxParamStep.toFixed(5)}`);
  assert.ok(director.totalFlushes >= 2, `跑 ${lastElapsed.toFixed(0)}s 应完成至少两次重生`);

  log('相位序列', phases.join(' → '));
  log('播种数量', seedCounts.join(', '));
  log('一轮时长', `${(SEED_DURATION + ROAM_CYCLE + FLUSH_DURATION).toFixed(1)}s（蔓延 ${ROAM_CYCLE.toFixed(1)}s + 播种 ${SEED_DURATION}s + 冲刷 ${FLUSH_DURATION}s）`);
  log('最大参数步进', maxParamStep.toFixed(6));
}

{
  // 场景二：画面真的被长满时，应该靠覆盖率提前触发重生，不必等满一圈。
  const director = new Director(7);
  const delta = 1 / 30;
  let coverage = 0;
  let flushAt = -1;

  for (let frame = 0; frame < Math.ceil((SATURATION_HOLD + 30) / delta); frame += 1) {
    coverage = Math.min(0.999, coverage + 0.02);
    const step = director.update(delta, coverage);
    if (step.phase === 'flushing' && flushAt < 0) {
      flushAt = frame * delta;
      break;
    }
  }

  assert.ok(flushAt > 0, '覆盖率持续饱和时必须触发重生');
  assert.ok(
    flushAt < ROAM_CYCLE,
    `饱和触发的重生应该早于漫游一圈（实际 ${flushAt.toFixed(1)}s）`,
  );
  log('饱和触发', `覆盖率饱和后 ${flushAt.toFixed(1)}s 进入重生`);
}

// ── 5. 折线定义自洽 ───────────────────────────────────────────────────
assert.equal(
  ROAM_CYCLE,
  ROAM_PATH.reduce((total, waypoint) => total + waypoint.dwell + ROAM_BLEND, 0),
  '漫游时长与折线定义不符',
);
for (const id of MORPHS.map((morph) => morph.id)) {
  assert.ok(
    RESOLVED_PATH.some((waypoint) => waypoint.morph.id === id),
    `形态族 ${id} 不在漫游路径上，界面按钮会跳不到它`,
  );
}
for (const waypoint of ROAM_PATH) {
  if (!waypoint.morphId) continue;
  assert.ok(MORPH_BY_ID.has(waypoint.morphId), `ROAM_PATH 里的 ${waypoint.morphId} 没有对应参数`);
}
log('折线自洽', `${RESOLVED_PATH.length} 个路点，一圈 ${ROAM_CYCLE.toFixed(0)}s，停留 ${ROAM_DWELL}s，过渡 ${ROAM_BLEND}s`);

// ── 报告 ──────────────────────────────────────────────────────────────
const report = {
  generatedAt: new Date().toISOString(),
  diffusion: DIFFUSION,
  cycleSeconds: ROAM_CYCLE,
  marks,
  stability,
  growthCurve,
  roamCurve,
  elapsedMs: Date.now() - started,
};
writeFileSync(join(artifactDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(`\n✓ 苔痕验收通过（${((Date.now() - started) / 1000).toFixed(1)}s）`);
console.log(`  报告写入 artifacts/patina/report.json`);
