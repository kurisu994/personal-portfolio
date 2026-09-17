/**
 * 每帧推进多少步，以及像素密度上限。
 *
 * 模拟分辨率固定为 256²，不随设备与窗口变化。这一条是硬约束，不是偷懒：
 *
 *   Gray-Scott 的 (F, k) 平面里「有图案」的只是一条窄带，而窄带的位置会随
 *   网格尺寸移动。64² 上稳定的参数（mitosis 0.0367/0.065）搬到 256² 会直接
 *   死掉。所以校准分辨率必须与运行分辨率一致，运行时不能按设备改分辨率，
 *   否则移动端与桌面端会长出不同的东西。
 *
 * 256² 的开销很小（每帧 16 步也只有 100 万次格更新），现代设备都吃得下，
 * 所以统一分辨率换来的行为一致性是划算的。
 *
 * 每帧步数直接决定「一轮多久长满」：16 步/帧、60 fps 时是 960 步/秒，
 * 从斑点长到铺满约四分钟，落在设计预期的 3–5 分钟里。
 */

export const SIMULATION_SIZE = 256;

export interface Tuning {
  readonly stepsPerFrame: number;
  /** 初始像素密度上限。 */
  readonly maxDpr: number;
}

export function resolveTuning(): Tuning {
  if (typeof window === 'undefined') {
    return { stepsPerFrame: 16, maxDpr: 2 };
  }

  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 720;

  // 移动端把每帧步数降下来保证不烫手，但模拟分辨率与桌面端一致，
  // 区别只是「长得慢一点」，而不是「长出不一样的东西」。
  if (coarse || small) return { stepsPerFrame: 10, maxDpr: 1.5 };
  return { stepsPerFrame: 16, maxDpr: 2 };
}
