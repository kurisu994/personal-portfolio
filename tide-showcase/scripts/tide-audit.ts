import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { COASTS } from '../src/data/coasts';
import { MAX_DABS_PER_FRAME, WAVE_COMPONENTS } from '../src/scene/budget';
import { DRY_HOURS, ERASE_HOURS, FOAM_HOURS, TRACE_GONE, WIND_HOURS, stepTrace, stepWet } from '../src/tide/lifecycle';
import { PERIOD_HOURS, findExtrema, moonPhaseAngle, springNeap, tideHeight, type TideExtremum, type TideModel } from '../src/tide/model';

/**
 * 纯 Node 的潮汐验收：不需要浏览器，断言模型与生命周期规则满足设计稿的要求。
 * 输出 artifacts/tide/report.json，任一项失败则以非零码退出。
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '../artifacts/tide');
const START = 2461313.5; // 2026-09-30 00:00 UT
const beach = COASTS[0];

interface Check {
  name: string;
  expected: string;
  actual: string;
  pass: boolean;
}
const checks: Check[] = [];
const check = (name: string, expected: string, actual: string, pass: boolean) => {
  checks.push({ name, expected, actual, pass });
  console.log(`${pass ? '✅' : '❌'} ${name}：${actual}（要求 ${expected}）`);
};

// 1. M2 周期：只保留 M2，30 天内相邻高潮间隔
{
  const m2Only: TideModel = { z0: 0, constituents: [{ name: 'M2', amp: 1, lag: 0 }] };
  const highs = findExtrema(m2Only, beach.lon, START, START + 30).filter((e) => e.kind === 'high');
  let worst = 0;
  for (let i = 1; i < highs.length; i++) {
    worst = Math.max(worst, Math.abs((highs[i].jd - highs[i - 1].jd) * 24 - PERIOD_HOURS.M2));
  }
  check('M2 周期', '相邻高潮间隔误差 < 0.01 h', `${highs.length} 次高潮，最大误差 ${worst.toFixed(5)} h`, highs.length > 50 && worst < 0.01);
}

// 2 / 3. 大潮小潮：按每个半日潮周期的潮差，取朔望与上下弦附近平均
const cycleRanges = (model: TideModel, lon: number, from: number, days: number) => {
  const ex = findExtrema(model, lon, from, from + days);
  const out: { jd: number; range: number }[] = [];
  for (let i = 1; i < ex.length; i++) {
    if (ex[i].kind !== ex[i - 1].kind) out.push({ jd: (ex[i].jd + ex[i - 1].jd) / 2, range: Math.abs(ex[i].height - ex[i - 1].height) });
  }
  return out;
};
{
  const ranges = cycleRanges(beach.model, beach.lon, START, 60);
  const near = (target: number) => (r: { jd: number }) => {
    const a = moonPhaseAngle(r.jd);
    const d = Math.min(Math.abs(a - target), 360 - Math.abs(a - target));
    return d < 12;
  };
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const spring = avg(ranges.filter((r) => near(0)(r) || near(180)(r)).map((r) => r.range));
  const neap = avg(ranges.filter((r) => near(90)(r) || near(270)(r)).map((r) => r.range));
  const ratio = spring / neap;
  check('大潮 / 小潮潮差比', '1.6–1.9', `大潮 ${spring.toFixed(2)} m / 小潮 ${neap.toFixed(2)} m = ${ratio.toFixed(2)}`, ratio >= 1.6 && ratio <= 1.9);

  // 潮差最大的周期应靠近朔望，最小的靠近上下弦（月相角距离）
  const dist = (a: number, t: number) => Math.min(Math.abs(a - t), 360 - Math.abs(a - t));
  const phaseOf = (r: { jd: number }) => moonPhaseAngle(r.jd);
  const smoothed = ranges.map((r, i) => ({ ...r, range: avg(ranges.slice(Math.max(0, i - 1), i + 2).map((x) => x.range)) }));
  const maxR = smoothed.reduce((a, b) => (b.range > a.range ? b : a));
  const minR = smoothed.reduce((a, b) => (b.range < a.range ? b : a));
  const maxOff = Math.min(dist(phaseOf(maxR), 0), dist(phaseOf(maxR), 180));
  const minOff = Math.min(dist(phaseOf(minR), 90), dist(phaseOf(minR), 270));
  check('相位关系', '最大潮差距朔望、最小潮差距上下弦各 < 25°（约两天）', `最大偏 ${maxOff.toFixed(1)}°，最小偏 ${minOff.toFixed(1)}°`, maxOff < 25 && minOff < 25);
}

// 4. 湿度场：沿一条 1:19 的滩面剖面模拟两天
{
  const points = Array.from({ length: 60 }, (_, i) => 2 - i * 0.07); // 沙面高度 2 米到 −2.1 米
  let wet = points.map(() => 0);
  let monotonicViolations = 0;
  let driedOut = true;
  const dtHours = 0.05;
  let prevLevel = tideHeight(beach.model, START, beach.lon);
  for (let t = 0; t < 48; t += dtHours) {
    const level = tideHeight(beach.model, START + t / 24, beach.lon);
    const rising = level > prevLevel;
    const next = wet.map((w, i) => stepWet(w, points[i] < level, dtHours));
    if (rising) next.forEach((w, i) => w < wet[i] - 1e-9 && points[i] < level && monotonicViolations++);
    wet = next;
    prevLevel = level;
  }
  // 最高点之上的沙在两天后必须已经干透
  const top = Math.max(...findExtrema(beach.model, beach.lon, START, START + 2).map((e) => e.height));
  points.forEach((h, i) => {
    if (h > top + 0.05 && wet[i] > 0.02) driedOut = false;
  });
  const dryAfter = (() => {
    let w = 1;
    let hours = 0;
    while (w > 0.02) {
      w = stepWet(w, false, 0.05);
      hours += 0.05;
    }
    return hours;
  })();
  check('湿度：涨潮阶段', '被淹没的点湿度单调不减', `违例 ${monotonicViolations} 次`, monotonicViolations === 0);
  check('湿度：退潮后变干', '露出后衰减到 0（< 0.02）', `约 ${dryAfter.toFixed(1)} 小时降到 0.02；高潮线以上${driedOut ? '全部干透' : '仍有湿点'}`, driedOut && dryAfter < 6);
}

// 5. 痕迹生命周期：低潮时写在潮间带中部，一个半日潮周期内被抹去
{
  const lows = findExtrema(beach.model, beach.lon, START, START + 30).filter((e) => e.kind === 'low');
  let worstHours = 0;
  let allErased = true;
  for (const low of lows) {
    const next = findExtrema(beach.model, beach.lon, low.jd, low.jd + 1).find((e) => e.kind === 'high');
    if (!next) continue;
    const sand = low.height + (next.height - low.height) * 0.5; // 写在涨落范围的正中
    let trace = 1;
    let hours = 0;
    while (trace >= TRACE_GONE && hours < PERIOD_HOURS.M2) {
      const level = tideHeight(beach.model, low.jd + hours / 24, beach.lon);
      trace = stepTrace(trace, sand < level, 0.02);
      hours += 0.02;
    }
    if (trace >= TRACE_GONE) allErased = false;
    worstHours = Math.max(worstHours, hours);
  }
  check('痕迹：写字被抹去', `一个半日潮周期（${PERIOD_HOURS.M2} h）内降到 ${TRACE_GONE} 以下`, `${lows.length} 次低潮书写，最慢 ${worstHours.toFixed(2)} h（覆盖时常数 ${ERASE_HOURS} h）`, allErased);
}

// 6. 预算
{
  const constituents = Math.max(...COASTS.map((c) => c.model.constituents.length));
  check('预算', '分潮 ≤ 6、同屏涌浪分量 ≤ 5、每帧笔触 ≤ 512', `分潮 ${constituents}、涌浪分量 ${WAVE_COMPONENTS}、每帧笔触 ${MAX_DABS_PER_FRAME}`, constituents <= 6 && WAVE_COMPONENTS <= 5 && MAX_DABS_PER_FRAME <= 512);
}

// 7. 零依赖版同源：取出 ../tide/index.html 里 MODEL:BEGIN 与 MODEL:END 之间的模型段，
//    放进独立的 vm 上下文执行，与本版逐小时对账。两版各自持有一份代码，这一项保证它们算的是同一片海。
{
  interface SimpleModel {
    PERIOD_HOURS: unknown;
    COASTS: typeof COASTS;
    lifecycle: number[];
    tideHeight: typeof tideHeight;
    findExtrema: (model: TideModel, lon: number, from: number, to: number) => TideExtremum[];
    moonPhaseAngle: typeof moonPhaseAngle;
    springNeap: typeof springNeap;
    stepWet: typeof stepWet;
    stepTrace: typeof stepTrace;
  }
  const html = readFileSync(resolve(__dirname, '../../tide/index.html'), 'utf8');
  // 标记必须独占一行，注释里提到标记名不会被误认
  const block = /^[ \t]*\/\/ MODEL:BEGIN[ \t]*$([\s\S]*?)^[ \t]*\/\/ MODEL:END[ \t]*$/m.exec(html);
  if (!block) {
    check('零依赖版同源', '../tide/index.html 含 MODEL:BEGIN / MODEL:END 模型段', '没有找到模型段', false);
  } else {
    const simple = runInNewContext(
      `${block[1]}\n;({ PERIOD_HOURS, COASTS, lifecycle: [DRY_HOURS, ERASE_HOURS, WIND_HOURS, FOAM_HOURS, TRACE_GONE], tideHeight, findExtrema, moonPhaseAngle, springNeap, stepWet, stepTrace })`,
    ) as SimpleModel;
    const sameData =
      JSON.stringify(simple.COASTS) === JSON.stringify(COASTS) &&
      JSON.stringify(simple.PERIOD_HOURS) === JSON.stringify(PERIOD_HOURS) &&
      JSON.stringify(simple.lifecycle) === JSON.stringify([DRY_HOURS, ERASE_HOURS, WIND_HOURS, FOAM_HOURS, TRACE_GONE]);
    let heightDiff = 0;
    let extremaDiff = 0;
    let extremaCountMismatch = 0;
    let moonMismatch = 0;
    // 两边各用自己的海岸数据算，潮位向量才是端到端的对账
    COASTS.forEach((coast, index) => {
      const own = simple.COASTS[index];
      for (let hour = 0; hour <= 30 * 24; hour++) {
        const jd = START + hour / 24;
        heightDiff = Math.max(heightDiff, Math.abs(simple.tideHeight(own.model, jd, own.lon) - tideHeight(coast.model, jd, coast.lon)));
        if (Math.abs(simple.moonPhaseAngle(jd) - moonPhaseAngle(jd)) > 1e-9 || simple.springNeap(jd) !== springNeap(jd)) moonMismatch++;
      }
      const a = findExtrema(coast.model, coast.lon, START, START + 3);
      const b = simple.findExtrema(own.model, own.lon, START, START + 3);
      if (a.length !== b.length) extremaCountMismatch++;
      a.forEach((e, i) => {
        const o = b[i];
        extremaDiff = Math.max(extremaDiff, o && o.kind === e.kind ? Math.abs(o.jd - e.jd) * 86400 : Infinity);
      });
    });
    let lifecycleDiff = 0;
    for (const v of [0, 0.3, 1]) {
      for (const dt of [0.01, 0.2, 2]) {
        for (const covered of [true, false]) {
          lifecycleDiff = Math.max(lifecycleDiff, Math.abs(simple.stepWet(v, covered, dt) - stepWet(v, covered, dt)), Math.abs(simple.stepTrace(v, covered, dt) - stepTrace(v, covered, dt)));
        }
      }
    }
    check(
      '零依赖版同源',
      '海岸与分潮表、生命周期常数一致；三种海岸 30 天逐小时潮位差 < 1e-9 m，高低潮时刻差 < 1 s',
      `数据${sameData ? '一致' : '不一致'}，潮位最大差 ${heightDiff.toExponential(1)} m，高低潮最大差 ${extremaDiff.toFixed(3)} s（数量不符 ${extremaCountMismatch} 处），月相不符 ${moonMismatch} 处，生命周期最大差 ${lifecycleDiff.toExponential(1)}`,
      sameData && heightDiff < 1e-9 && extremaDiff < 1 && extremaCountMismatch === 0 && moonMismatch === 0 && lifecycleDiff < 1e-12,
    );
  }
}

mkdirSync(outDir, { recursive: true });
const passed = checks.every((c) => c.pass);
writeFileSync(resolve(outDir, 'report.json'), JSON.stringify({ timestamp: new Date().toISOString(), status: passed ? 'PASSED' : 'FAILED', checks }, null, 2));
console.log(passed ? '\n潮汐验收全部通过' : '\n潮汐验收存在失败项');
process.exit(passed ? 0 : 1);
