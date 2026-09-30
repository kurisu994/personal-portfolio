import * as THREE from 'three';

/** 某一刻的天空与光照参数（线性空间） */
export interface SkyPalette {
  zenith: THREE.Color;
  horizon: THREE.Color;
  sun: THREE.Color;
  glow: THREE.Color;
  ground: THREE.Color;
  moon: THREE.Color;
  exposure: number;
  /** 0 = 夜，1 = 白昼；界面色调据此在纸色与底片黑之间过渡 */
  daylight: number;
  /** 星空可见度 */
  night: number;
}

interface Key {
  alt: number;
  zenith: string;
  horizon: string;
  sun: string;
  sunI: number;
  glow: string;
  glowI: number;
}

/** 太阳高度关键帧：白昼、金色时刻、日落、民用暮光、航海暮光、夜 */
const KEYS: Key[] = [
  { alt: 40, zenith: '#3e76bb', horizon: '#b8cad6', sun: '#fff6e8', sunI: 2.7, glow: '#fff1dc', glowI: 0.25 },
  { alt: 12, zenith: '#4674ad', horizon: '#d9cdb6', sun: '#ffe6c2', sunI: 2.4, glow: '#ffdcb0', glowI: 0.55 },
  { alt: 3, zenith: '#46639a', horizon: '#e7ae83', sun: '#ffab66', sunI: 1.7, glow: '#ff9e5e', glowI: 1.4 },
  { alt: -1, zenith: '#2c3f6e', horizon: '#c98c85', sun: '#ff8a4c', sunI: 0.25, glow: '#ff8250', glowI: 1.5 },
  { alt: -5, zenith: '#172243', horizon: '#5d4c66', sun: '#000000', sunI: 0, glow: '#b0605a', glowI: 0.8 },
  { alt: -10, zenith: '#0b1227', horizon: '#1d2440', sun: '#000000', sunI: 0, glow: '#3a2e4a', glowI: 0.25 },
  { alt: -16, zenith: '#050a17', horizon: '#0e1528', sun: '#000000', sunI: 0, glow: '#000000', glowI: 0 },
];

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

function lerpHex(a: string, b: string, t: number, out: THREE.Color): THREE.Color {
  tmpA.set(a);
  tmpB.set(b);
  return out.copy(tmpA).lerp(tmpB, t);
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * 按太阳高度插值天空，并叠加月光：月光强度随月面照亮比例与月亮高度变化。
 * THREE.Color.set 会把十六进制按 sRGB 转成线性值，着色器里直接使用。
 */
export function skyPalette(sunAltDeg: number, moonAltDeg: number, moonIllum: number): SkyPalette {
  let i = 0;
  while (i < KEYS.length - 1 && sunAltDeg < KEYS[i + 1].alt) i++;
  const a = KEYS[Math.min(i, KEYS.length - 1)];
  const b = KEYS[Math.min(i + 1, KEYS.length - 1)];
  const t = a === b ? 0 : Math.min(1, Math.max(0, (a.alt - sunAltDeg) / (a.alt - b.alt)));

  const zenith = lerpHex(a.zenith, b.zenith, t, new THREE.Color());
  const horizon = lerpHex(a.horizon, b.horizon, t, new THREE.Color());
  const sun = lerpHex(a.sun, b.sun, t, new THREE.Color()).multiplyScalar(a.sunI + (b.sunI - a.sunI) * t);
  const glow = lerpHex(a.glow, b.glow, t, new THREE.Color()).multiplyScalar(a.glowI + (b.glowI - a.glowI) * t);

  const night = 1 - smooth(-14, -4, sunAltDeg);
  const moonUp = smooth(-2, 12, moonAltDeg);
  const moonStrength = moonIllum * moonUp;
  const moon = new THREE.Color('#9fb4dc').multiplyScalar(0.22 * moonStrength);
  // 月夜的天空不是纯黑：满月时天顶泛出深蓝
  zenith.add(new THREE.Color('#1a2b52').multiplyScalar(0.35 * moonStrength * night));
  horizon.add(new THREE.Color('#223358').multiplyScalar(0.3 * moonStrength * night));

  // 地面环境光：夜里保留一点星光与大气辉光的底子，沙滩不至于全黑
  const ground = horizon.clone().multiplyScalar(0.35).add(new THREE.Color('#1b2233').multiplyScalar(0.12 * night));
  zenith.add(new THREE.Color('#141c2e').multiplyScalar(0.08 * night));
  const daylight = smooth(-7, 5, sunAltDeg);
  const exposure = 0.82 + (1 - daylight) * (1.6 + moonStrength * 0.8);
  return { zenith, horizon, sun, glow, ground, moon, exposure, daylight, night };
}
