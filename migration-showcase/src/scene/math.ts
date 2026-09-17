import * as THREE from 'three';

export const TAU = Math.PI * 2;

export function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function smootherstep(value: number): number {
  const t = clamp(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function mod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function angleDelta(from: number, to: number): number {
  return mod(to - from + Math.PI, TAU) - Math.PI;
}

export function hash(a: number, b = 0, seed = 0x63d83595): number {
  let value = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ seed;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

export function mixTuple(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function tupleToColor(tuple: readonly [number, number, number], target = new THREE.Color()): THREE.Color {
  return target.setRGB(tuple[0], tuple[1], tuple[2], THREE.SRGBColorSpace);
}

export function tupleToCss(tuple: readonly [number, number, number]): string {
  const channels = tuple.map((value) => Math.round(clamp(value) * 255));
  return `rgb(${channels[0]} ${channels[1]} ${channels[2]})`;
}

export function riverX(z: number): number {
  return Math.sin(z * 0.00071 + 0.6) * 460 + Math.sin(z * 0.00163 + 1.3) * 160;
}

export function riverWidth(z: number): number {
  return 100 + Math.sin(z * 0.00093 + 2.2) * 20 + Math.sin(z * 0.0021) * 9;
}

export function riverSlope(z: number): number {
  return Math.cos(z * 0.00071 + 0.6) * 0.3266 + Math.cos(z * 0.00163 + 1.3) * 0.2608;
}

export function damp(current: number, target: number, lambda: number, delta: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * delta));
}

