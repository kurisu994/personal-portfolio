//! 湿沙与痕迹的生命周期规则。
//! 着色器（scene/shaders.ts 的场更新）与 Node 验收脚本使用同一组常数与同一套规则：
//! - 被水覆盖：湿度置 1，痕迹按 ERASE_HOURS 衰减（泡沫线来回冲刷，字被一点点抹平）；
//! - 露出水面：湿度按 DRY_HOURS 衰减，痕迹只被风按 WIND_HOURS 极慢地抹平。
//! 时间单位均为模拟时间的小时。

/** 露出后表层沙变干的时间常数 */
export const DRY_HOURS = 1.1;
/** 被水覆盖时痕迹衰减的时间常数 */
export const ERASE_HOURS = 0.3;
/** 干沙上被风抹平的时间常数 */
export const WIND_HOURS = 60;
/** 退水后残留泡沫消散的时间常数 */
export const FOAM_HOURS = 0.06;
/** 痕迹低于该值视为已被抹去 */
export const TRACE_GONE = 0.05;

/** 单点湿度推进一步 */
export function stepWet(wet: number, covered: boolean, dtHours: number): number {
  return covered ? 1 : wet * Math.exp(-dtHours / DRY_HOURS);
}

/** 单点痕迹推进一步 */
export function stepTrace(trace: number, covered: boolean, dtHours: number): number {
  return trace * Math.exp(-dtHours / (covered ? ERASE_HOURS : WIND_HOURS));
}
