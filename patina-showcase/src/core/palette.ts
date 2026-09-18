/**
 * 纸墨配色：把 V 场映射成「暖纸上的苔与墨」。
 *
 * 这条色阶是全片唯一决定气质的地方。设计依据是实测的 V 值分布：图案内部
 * V ≈ 0.3–0.5，所以 0.3–0.5 这段必须直接落在「苔青」上，而不是像旧版那样
 * 先经过一段土黄（旧版 0.22 处的 #cbb894 让整片苔发闷发脏）。
 *
 * 六个停靠点的分工（V 的实测分布：图案内部峰值只有 0.42–0.5，几乎
 * 不会更高，所以整条 ramp 要压在低 V 区，高段留给墨晕深取去走）：
 *   0.30 之前都是纸的调子——缝隙与边缘保持干净，maze 的白缝不会发黄；
 *   0.42 是苔青主体——正落在 V 的峰值上，斑点内部直接取到正色，
 *   而不是纸与苔青 ramp 的中间值；
 *   0.56 是铜锈——「PATINA」这个名字的颜色。墨晕深取的路径会正面
 *   穿过这一段（0.42 + 0.42×edge 的中段正好落在 0.6 附近），苔青的
 *   边缘因此透出旧铜的暖色；
 *   0.74 以后落到深苔与墨。两端刻意不取纯白与纯黑。
 */

export type Rgb = readonly [number, number, number];

/** 十六进制色值转 0–1 的三通道。 */
function hex(value: number): Rgb {
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

export const PAPER = 0xf7f3ec;
export const INK = 0x34302a;
/** 纸与苔之间的浅米调，只做过渡，不抢纸色。 */
export const PALE = 0xd9d0ba;
export const MOSS = 0x5c6e54;
export const PATINA = 0x7a6640;
export const DEEP_MOSS = 0x465039;

interface Stop {
  readonly at: number;
  readonly color: Rgb;
}

/** 按 V 升序的色阶停靠点。 */
export const COLOR_STOPS: readonly Stop[] = [
  { at: 0.0, color: hex(PAPER) },
  { at: 0.3, color: hex(PALE) },
  { at: 0.42, color: hex(MOSS) },
  { at: 0.56, color: hex(PATINA) },
  { at: 0.74, color: hex(DEEP_MOSS) },
  { at: 1.0, color: hex(INK) },
];

/** 在色阶上取样，返回 0–1 的三通道。 */
export function samplePalette(v: number): Rgb {
  const t = Math.min(1, Math.max(0, v));
  for (let index = 1; index < COLOR_STOPS.length; index += 1) {
    const previous = COLOR_STOPS[index - 1];
    const current = COLOR_STOPS[index];
    if (t > current.at) continue;
    const span = current.at - previous.at;
    const local = span === 0 ? 0 : (t - previous.at) / span;
    // 平滑插值，避免色阶停靠点处出现可见的分段。
    const smooth = local * local * (3 - 2 * local);
    return [
      previous.color[0] + (current.color[0] - previous.color[0]) * smooth,
      previous.color[1] + (current.color[1] - previous.color[1]) * smooth,
      previous.color[2] + (current.color[2] - previous.color[2]) * smooth,
    ];
  }
  return COLOR_STOPS[COLOR_STOPS.length - 1].color;
}

/** 供 UIColor 与 CSS 复用的十六进制串。 */
export function cssHex(value: number): string {
  return `#${value.toString(16).padStart(6, '0')}`;
}
