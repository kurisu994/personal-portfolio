import * as THREE from 'three';
import type { Coast } from '../data/coasts';

/** 地形细节域（米）：x 为离岸方向（正向指海），z 为沿岸方向 */
export const DOMAIN = { x0: -90, x1: 170, z0: -160, z1: 160 };
/** 湿度与痕迹场覆盖的区域：镜头活动与书写发生在这里 */
export const FIELD_DOMAIN = { x0: -50, x1: 110, z0: -90, z1: 90 };
export const TERRAIN_RES = 512;

// ---------------------------------------------------------------------------
// 种子噪声
// ---------------------------------------------------------------------------

function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

function fbm(x: number, z: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x, z, seed + i * 101);
    norm += amp;
    x *= 2.03;
    z *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

const sigmoid = (x: number) => 0.5 * (1 + Math.tanh(x));
const bump = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2));

/** 平滑取小：两条剖面线的圆角衔接 */
function smoothMin(a: number, b: number, k: number): number {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b + (a - b) * h - k * h * (1 - h);
}

/** 单点地形：高度（米，相对平均海面）与材质权重 */
interface Sample {
  height: number;
  rock: number;
  mud: number;
  ripple: number;
}

function sampleBeach(x: number, z: number, seed: number): Sample {
  // 沿岸方向：低频起伏 + 滩角（beach cusps）
  const shift = (valueNoise(z / 90, 0.5, seed) - 0.5) * 16 + Math.sin(z / 6.2 + valueNoise(z / 30, 3.1, seed) * 4) * 1.3 * bump(x, 20, 18);
  const xs = x + shift;
  const dune = 2.5 + 3.4 * sigmoid((-xs - 58) / 9) + (fbm(x / 14, z / 14, seed + 7) - 0.5) * 2.4 * sigmoid((-xs - 42) / 6);
  const face = 2.35 - (xs + 12) / 19;
  let h = smoothMin(dune, face, 1.6);
  // 槽沟与沙坝
  h += -0.45 * bump(xs, 76, 9) + 1.25 * bump(xs, 94, 11) * (0.8 + 0.4 * valueNoise(z / 40, 9.3, seed));
  h = Math.max(h, -5.2 - (xs - 150) * 0.01);
  // 下滩的礁石与潮池
  const rockField = Math.max(0, fbm(x / 9, z / 9, seed + 31) - 0.62) * 5 * bump(z, 55, 22) * bump(xs, 52, 14);
  h += rockField * 1.6;
  const pool = bump(x, 46, 3.2) * bump(z, 48, 4.5) + bump(x, 58, 2.6) * bump(z, 63, 3.2);
  h -= pool * 0.35;
  h += (fbm(x / 3, z / 3, seed + 3) - 0.5) * 0.08;
  return {
    height: h,
    rock: Math.min(1, rockField * 3),
    mud: 0,
    ripple: sigmoid((xs - 18) / 6) * (1 - sigmoid((xs - 110) / 8)),
  };
}

function sampleMudflat(x: number, z: number, seed: number): Sample {
  const shift = (valueNoise(z / 110, 0.3, seed) - 0.5) * 20;
  const xs = x + shift;
  const marsh = 3.35 + (fbm(x / 8, z / 8, seed + 5) - 0.5) * 0.5;
  const flat = 3.1 - (xs + 36) / 44;
  let h = smoothMin(marsh, flat, 0.8);
  // 滩外缘变陡，落到潮沟主槽
  h -= Math.max(0, xs - 112) * 0.06;
  h = Math.max(h, -4.6);
  // 潮沟：一条主沟加两条支沟，向海变宽变深
  const t = Math.max(0, xs + 30);
  const main = 18 * Math.sin(xs / 37) + (valueNoise(xs / 50, 1.7, seed) - 0.5) * 30;
  const w = 2.4 + t / 26;
  let creek = bump(z, main, w) * (0.35 + t / 150);
  const b1 = main + 30 + 14 * Math.sin(xs / 23);
  creek = Math.max(creek, bump(z, b1, 1.6 + t / 60) * 0.4 * sigmoid((xs - 20) / 12));
  const b2 = main - 42 + 10 * Math.sin(xs / 19 + 1.3);
  creek = Math.max(creek, bump(z, b2, 1.4 + t / 70) * 0.32 * sigmoid((xs - 45) / 10));
  h -= creek * sigmoid((xs + 28) / 4);
  h += (fbm(x / 4, z / 4, seed + 9) - 0.5) * 0.05;
  return {
    height: h,
    rock: 0,
    mud: sigmoid((-h + 3.0) / 0.15),
    ripple: 0.35 * sigmoid((xs - 30) / 10),
  };
}

function sampleRocky(x: number, z: number, seed: number): Sample {
  const shift = (valueNoise(z / 70, 0.9, seed) - 0.5) * 14;
  const xs = x + shift;
  const slope = 1.6 + 5.5 * sigmoid((-xs - 38) / 10) + (fbm(x / 12, z / 12, seed + 3) - 0.5) * 1.8 * sigmoid((-xs - 30) / 6);
  const beach = 1.5 - (xs + 25) / 11;
  let h = smoothMin(slope, beach, 1.2);
  // 浪蚀平台：在 −0.45 米附近铺开，之后跌入深水
  const platform = -0.45 + (fbm(x / 9, z / 9, seed + 17) - 0.5) * 0.28;
  const platformMask = sigmoid((xs + 2) / 3) * (1 - sigmoid((xs - 42) / 4));
  h = Math.max(h, platform * platformMask + (h - 10) * (1 - platformMask));
  h = xs > 42 ? Math.min(h, -0.6 - (xs - 42) * 0.18) : h;
  h = Math.max(h, -4.2);
  // 散落的巨石：圆润的鼓包，平台上与滩边都有
  let rock = 0;
  for (let i = 0; i < 46; i++) {
    const bx = -14 + hash2(i, 11, seed) * 58;
    const bz = -95 + hash2(i, 12, seed) * 190;
    const r = 1.4 + hash2(i, 13, seed) * 3.2;
    const d = ((x - bx) / r) ** 2 + ((z - bz) / (r * (0.7 + hash2(i, 14, seed) * 0.6))) ** 2;
    if (d < 1) rock = Math.max(rock, Math.sqrt(1 - d) * (0.5 + hash2(i, 15, seed) * 0.9));
  }
  rock *= 1 + (fbm(x / 1.6, z / 1.6, seed + 29) - 0.5) * 0.5;
  h += rock;
  // 潮池：平台上的圆坑
  let pool = 0;
  for (let i = 0; i < 7; i++) {
    const cx = 6 + hash2(i, 1, seed) * 30;
    const cz = -60 + hash2(i, 2, seed) * 120;
    pool = Math.max(pool, bump(x, cx, 2 + hash2(i, 3, seed) * 3) * bump(z, cz, 2.5 + hash2(i, 4, seed) * 4));
  }
  h -= pool * 0.45 * platformMask;
  return {
    height: h,
    rock: Math.min(1, platformMask * 0.8 + Math.min(1, rock * 4) + sigmoid((-xs - 32) / 3) * 0.85),
    mud: 0,
    ripple: 0.2 * (1 - platformMask) * sigmoid((xs + 20) / 4),
  };
}

/**
 * 程序化海岸地形。CPU 保留全精度高度用于镜头与书写取点，
 * GPU 拿到半浮点纹理：R 高度、G 礁石、B 泥、A 沙纹强度。
 */
export class Terrain {
  readonly heights: Float32Array;
  readonly texture: THREE.DataTexture;
  /** 镜头允许走到的最远离岸位置：礁岸只站在小沙滩上，不踩进礁石堆 */
  readonly standLimit: number;

  constructor(coast: Coast) {
    const n = TERRAIN_RES;
    this.heights = new Float32Array(n * n);
    const data = new Uint16Array(n * n * 4);
    const sampler = coast.terrain === 'mudflat' ? sampleMudflat : coast.terrain === 'rocky' ? sampleRocky : sampleBeach;
    this.standLimit = coast.terrain === 'rocky' ? -6 : Infinity;
    for (let j = 0; j < n; j++) {
      const z = DOMAIN.z0 + ((DOMAIN.z1 - DOMAIN.z0) * j) / (n - 1);
      for (let i = 0; i < n; i++) {
        const x = DOMAIN.x0 + ((DOMAIN.x1 - DOMAIN.x0) * i) / (n - 1);
        const s = sampler(x, z, coast.seed);
        const k = j * n + i;
        this.heights[k] = s.height;
        data[k * 4] = THREE.DataUtils.toHalfFloat(s.height);
        data[k * 4 + 1] = THREE.DataUtils.toHalfFloat(s.rock);
        data[k * 4 + 2] = THREE.DataUtils.toHalfFloat(s.mud);
        data[k * 4 + 3] = THREE.DataUtils.toHalfFloat(s.ripple);
      }
    }
    this.texture = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.HalfFloatType);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
  }

  /** 双线性取高度，域外按边缘延伸 */
  heightAt(x: number, z: number): number {
    const n = TERRAIN_RES;
    const fx = Math.min(n - 1.001, Math.max(0, ((x - DOMAIN.x0) / (DOMAIN.x1 - DOMAIN.x0)) * (n - 1)));
    const fz = Math.min(n - 1.001, Math.max(0, ((z - DOMAIN.z0) / (DOMAIN.z1 - DOMAIN.z0)) * (n - 1)));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const h = this.heights;
    const a = h[j * n + i];
    const b = h[j * n + i + 1];
    const c = h[(j + 1) * n + i];
    const d = h[(j + 1) * n + i + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }

  /** 沿岸位置 z 处、给定水位时的水边线 x（从海侧向陆地找第一个露出点） */
  shorelineX(level: number, z: number): number {
    for (let x = DOMAIN.x1; x > DOMAIN.x0; x -= 0.5) {
      if (this.heightAt(x, z) > level) return x;
    }
    return DOMAIN.x0;
  }

  /** 射线与地形求交（步进 + 二分），用于在沙上书写 */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist = 400): THREE.Vector3 | null {
    let prevT = 0;
    let prevAbove = origin.y - this.heightAt(origin.x, origin.z);
    if (prevAbove < 0) return null;
    for (let t = 0.25; t < maxDist; t += Math.max(0.25, t * 0.02)) {
      const x = origin.x + dir.x * t;
      const y = origin.y + dir.y * t;
      const z = origin.z + dir.z * t;
      const above = y - this.heightAt(x, z);
      if (above < 0) {
        let lo = prevT;
        let hi = t;
        for (let i = 0; i < 24; i++) {
          const mid = (lo + hi) / 2;
          const m = origin.y + dir.y * mid - this.heightAt(origin.x + dir.x * mid, origin.z + dir.z * mid);
          if (m > 0) lo = mid;
          else hi = mid;
        }
        return origin.clone().addScaledVector(dir, (lo + hi) / 2);
      }
      prevT = t;
      prevAbove = above;
    }
    return null;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
