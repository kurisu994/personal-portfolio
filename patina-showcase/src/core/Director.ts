/**
 * 苔痕的叙事状态机。
 *
 * 纯逻辑：不碰 DOM、不碰 WebGL，只回答「现在该用哪组参数、该不该播种、
 * 要不要开始冲刷」。verify:patina 在 Node 里直接驱动它跑完整轮次，断言
 * 相位顺序、播种数量与参数连续性——这些都不需要浏览器。
 *
 * 一轮的生命周期：
 *   seeding（播种一帧）→ growing（参数漫游，最长一圈 270 秒）
 *   → flushing（水渍从中心洇开，抹回纸面）→ seeding …
 */

import { DIFFUSION, ROAM_CYCLE, pathAt, type Morph } from './presets';

export type Phase = 'seeding' | 'growing' | 'flushing';

/**
 * 覆盖率超过这个值并持续一段时间就提前进入重生。
 *
 * 这个值必须贴近 1：覆盖率会随模拟分辨率上升（同样一组参数，64² 下
 * 是 0.85、512² 下就到 0.98），阀值定低了会让「茂密」在漫游的第一段就
 * 反复触发重生，后面四种形态永远没机会出现。这里的定位是安全阀——
 * 正常节奏下重生由「漫游走完一圈」触发，它只负责兜住真的被长满的情况。
 */
export const SATURATION_THRESHOLD = 0.995;
export const SATURATION_HOLD = 10;
/** 播种相位的持续时长（秒）。播下一帧就完事，但要留出这个时间让界面显示「播种」。 */
export const SEED_DURATION = 0.8;
/** 冲刷持续时长（秒）。 */
export const FLUSH_DURATION = 2.5;

export interface SeedAction {
  readonly kind: 'seed';
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface DirectorStep {
  readonly phase: Phase;
  readonly params: { readonly du: number; readonly dv: number; readonly feed: number; readonly kill: number };
  readonly morph: Morph;
  readonly next: Morph;
  readonly blend: number;
  readonly flush: number;
  readonly flushRadius: number;
  readonly actions: readonly SeedAction[];
  /** 本轮生长进度 0–1。 */
  readonly progress: number;
  readonly coverage: number;
  readonly saturationTime: number;
}

/** 可复现的伪随机数，播种位置由它决定。 */
function createRandom(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export class Director {
  private readonly random: () => number;
  private phase: Phase = 'seeding';
  private phaseTime = 0;
  private elapsed = 0;
  private coverage = 0;
  private saturationTime = 0;
  /** 本次播种相位是否已经播过种，避免每帧重复播。 */
  private sown = false;
  /** 累计播下的种子数，供验收脚本统计。 */
  totalSeeds = 0;
  /** 累计完成的重生次数。 */
  totalFlushes = 0;

  constructor(seed = 20260917) {
    this.random = createRandom(seed);
  }

  /** 立刻回到播种前的状态。 */
  restart(): void {
    this.phase = 'seeding';
    this.phaseTime = 0;
    this.elapsed = 0;
    this.saturationTime = 0;
    this.sown = false;
    this.totalSeeds = 0;
    this.totalFlushes = 0;
  }

  /** 跳到漫游折线上的某个时刻，供键盘切换形态与验收脚本使用。 */
  seek(elapsedSeconds: number): void {
    this.elapsed = Math.max(0, elapsedSeconds);
  }

  /** 当前相位。 */
  get currentPhase(): Phase {
    return this.phase;
  }

  /**
   * 推进一帧。
   *
   * coverage 由渲染层读回（浏览器里是 readCoverage 的结果，验收脚本里由
   * CPU 内核算出来），Director 自己不做任何像素统计。
   */
  update(delta: number, coverage: number): DirectorStep {
    this.coverage = coverage;
    this.phaseTime += delta;

    const actions: SeedAction[] = [];

    if (coverage > SATURATION_THRESHOLD) {
      this.saturationTime += delta;
    } else {
      this.saturationTime = 0;
    }

    if (this.phase === 'seeding') {
      // 播种只在进入该相位的头一帧发生，之后停留 SEED_DURATION 秒，
      // 让界面来得及显示「播种」这一步。
      if (!this.sown) {
        const count = 3 + Math.floor(this.random() * 6);
        for (let index = 0; index < count; index += 1) {
          actions.push({
            kind: 'seed',
            // 留出边距，避免孢子贴着画面边缘被裁掉。
            x: 0.16 + this.random() * 0.68,
            y: 0.16 + this.random() * 0.68,
            radius: 0.018 + this.random() * 0.022,
          });
        }
        this.totalSeeds += count;
        this.sown = true;
      }

      if (this.phaseTime >= SEED_DURATION) {
        this.phase = 'growing';
        this.phaseTime = 0;
        this.elapsed = 0;
        this.sown = false;
      }
    } else if (this.phase === 'growing') {
      this.elapsed += delta;
      const saturated = this.saturationTime > SATURATION_HOLD;
      const cycleOver = this.elapsed > ROAM_CYCLE;
      if (saturated || cycleOver) {
        this.phase = 'flushing';
        this.phaseTime = 0;
      }
    } else if (this.phaseTime >= FLUSH_DURATION) {
      this.phase = 'seeding';
      this.phaseTime = 0;
      this.elapsed = 0;
      this.saturationTime = 0;
      this.sown = false;
      this.totalFlushes += 1;
    }

    const roam = pathAt(this.elapsed);
    const flushProgress = this.phase === 'flushing' ? Math.min(1, this.phaseTime / FLUSH_DURATION) : 0;

    return {
      phase: this.phase,
      params: { du: DIFFUSION.du, dv: DIFFUSION.dv, feed: roam.feed, kill: roam.kill },
      morph: roam.from,
      next: roam.to,
      blend: roam.blend,
      // 冲刷时保持满强度，让半径从中心扫过整个画面；结束后立刻归零，
      // 此时 V 场已经被抹干净，所以不会看到突变。
      flush: flushProgress > 0 ? 1 : 0,
      flushRadius: 0.1 + flushProgress * 1.7,
      actions,
      progress: Math.min(1, this.elapsed / ROAM_CYCLE),
      coverage: this.coverage,
      saturationTime: this.saturationTime,
    };
  }
}
