import { Vector3 } from 'three';

export const TAU = Math.PI * 2;
/** 将数值限制在指定区间。 */
export const clamp = (v: number, a = 0, b = 1): number => Math.max(a, Math.min(b, v));
/** 标量线性插值。 */
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
/** 将生命区间映射到零至一。 */
export const phase = (p: number, a: number, b: number): number => clamp((p - a) / (b - a));
/** 四阶 Bézier：控制值 0、0、0.58、1、1；两端速度归零。 */
export function bezier4(t: number): number {
  const x = clamp(t);
  return x * x * (3.48 + x * (-2.96 + x * 0.48));
}
/** 与帧率无关的一阶阻尼。 */
export const damp = (a: number, b: number, rate: number, dt: number): number => mix(a, b, 1 - Math.exp(-rate * dt));
/** 可重复的随机序列，用于树形和纸纹，不用于安全用途。 */
export function randomSeed(seed: number): () => number {
  let value = seed;
  return () => {
    value += 0x6D2B79F5;
    let n = Math.imul(value ^ value >>> 15, 1 | value);
    n ^= n + Math.imul(n ^ n >>> 7, 61 | n);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}
/** CPU 与 Shader 共用同一世界空间风场，让树、果与栖鸟保持连接。 */
export function bendPoint(p: Vector3, time: number, windX: number, windZ: number, out = new Vector3()): Vector3 {
  const h = Math.max(0, p.y) / 18;
  const w = h * h;
  return out.set(
    p.x + w * (Math.sin(time * 0.65 + p.y * 0.24) * 0.24 + windX * 1.4),
    p.y,
    p.z + w * (Math.cos(time * 0.51 + p.y * 0.19) * 0.15 + windZ * 0.8),
  );
}
export const WIND_GLSL = /* glsl */ `
  vec3 bend(vec3 p) {
    float h = max(0.0, p.y) / 18.0;
    float w = h * h;
    p.x += w * (sin(uTime * .65 + p.y * .24) * .24 + uWind.x * 1.4);
    p.z += w * (cos(uTime * .51 + p.y * .19) * .15 + uWind.y * .8);
    return p;
  }
`;
