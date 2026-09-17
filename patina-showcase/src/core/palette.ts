/**
 * 纸墨配色：把 V 场映射成「暖纸上的苔与墨」。
 *
 * 这条色阶是全片唯一决定气质的地方。低 V 是纸，中段经过一层铜锈色（旧物
 * 的痕迹），高 V 落到深苔与墨。色阶两端刻意不取纯白与纯黑，避免出现屏幕
 * 感的死白死黑。
 */

export type Rgb = readonly [number, number, number];

/** 十六进制色值转 0–1 的三通道。 */
function hex(value: number): Rgb {
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

export const PAPER = 0xf6f2e9;
export const INK = 0x3a362c;
export const MOSS = 0x6f7a5a;
export const DEEP_MOSS = 0x46503a;
export const PATINA = 0x8a6f4a;

interface Stop {
  readonly at: number;
  readonly color: Rgb;
}

/** 按 V 升序的色阶停靠点。 */
export const COLOR_STOPS: readonly Stop[] = [
  { at: 0.0, color: hex(PAPER) },
  { at: 0.22, color: hex(0xcbb894) },
  { at: 0.48, color: hex(MOSS) },
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
