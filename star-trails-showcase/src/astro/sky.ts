//! 画面层天文辅助：太阳低精度位置、银道面、投影镜像与时区换算。
//! 这些计算只服务于天空着色、地平线构图和界面读数，不参与精度对账；
//! 星点位置与日落日出仍以 Rust WASM 内核为准。

export const DEG = Math.PI / 180;
export const JD_UNIX_EPOCH = 2440587.5;
const J2000 = 2451545.0;
const TWO_PI = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Unix 毫秒 → 儒略日 */
export function jdFromMs(ms: number): number {
  return ms / 86400000 + JD_UNIX_EPOCH;
}

/** 儒略日 → Unix 毫秒 */
export function msFromJd(jd: number): number {
  return (jd - JD_UNIX_EPOCH) * 86400000;
}

function wrap2pi(a: number): number {
  const r = a % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
}

/** 格林尼治平恒星时（弧度），Meeus 12.4 */
export function gmst(jd: number): number {
  const d = jd - J2000;
  const t = d / 36525;
  return wrap2pi((280.46061837 + 360.98564736629 * d + 0.000387933 * t * t) * DEG);
}

export interface Horizontal {
  alt: number;
  az: number;
}

/** 赤道坐标 → 地平坐标（弧度；方位角北为 0、东为正） */
export function toHorizontal(ra: number, dec: number, jd: number, lat: number, lon: number): Horizontal {
  const h = gmst(jd) + lon - ra;
  const sinDec = Math.sin(dec);
  const cosDec = Math.cos(dec);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const cosH = Math.cos(h);
  const up = sinDec * sinLat + cosDec * cosH * cosLat;
  const east = -cosDec * Math.sin(h);
  const north = sinDec * cosLat - cosDec * cosH * sinLat;
  return { alt: Math.asin(clamp(up, -1, 1)), az: Math.atan2(east, north) };
}

/** 太阳视位置（天文年历低精度公式，误差约 0.01°，够用于暮光着色与极昼极夜判定） */
export function sunHorizontal(jd: number, lat: number, lon: number): Horizontal {
  const n = jd - J2000;
  const L = (280.46 + 0.9856474 * n) * DEG;
  const g = (357.528 + 0.9856003 * n) * DEG;
  const lambda = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  return toHorizontal(ra, dec, jd, lat, lon);
}

// ---------------------------------------------------------------------------
// 投影：与 star-trails/src/projection 保持同一套公式，输出「Rust 投影空间」坐标
// ---------------------------------------------------------------------------

export type ProjectionMode = 0 | 1;

function clampFov(fovDeg: number): number {
  return clamp(fovDeg, 20, 140) * DEG;
}

/** 与 WASM 内核一致的投影；limit 控制允许超出画面的范围 */
export function projectSky(
  alt: number,
  az: number,
  lat: number,
  mode: ProjectionMode,
  fovDeg: number,
  limit = 2,
): [number, number] | null {
  if (mode === 1) {
    if (alt < -0.05) return null;
    const r = Math.tan((Math.PI / 2 - alt) * 0.5);
    if (r > 1.25) return null;
    return [r * Math.sin(az), r * Math.cos(az)];
  }
  const cosAlt = Math.cos(alt);
  const vx = cosAlt * Math.sin(az);
  const vy = cosAlt * Math.cos(az);
  const vz = Math.sin(alt);
  const north = lat >= 0;
  const fy = north ? Math.cos(lat) : -Math.cos(lat);
  const fz = north ? Math.sin(lat) : -Math.sin(lat);
  const rx = north ? 1 : -1;
  const zCam = vy * fy + vz * fz;
  if (zCam <= 0.02) return null;
  const xCam = vx * rx;
  const yCam = vy * -Math.sin(lat) + vz * Math.cos(lat);
  const halfTan = Math.tan(clampFov(fovDeg) * 0.5);
  const x = xCam / (zCam * halfTan);
  const y = yCam / (zCam * halfTan);
  if (Math.abs(x) > limit || Math.abs(y) > limit) return null;
  return [x, y];
}

/**
 * 取景参数：把 Rust 投影空间映射到「视图空间」（横屏时 y ∈ [-1, 1] 占满画面高度）。
 * - 透视模式用移轴（竖向平移像面）把地平线压到画面下部，天极留在上方，和真实星轨摄影的构图一致；
 * - 全天域模式做左右镜像，得到「躺着仰望」的真实朝向（北上、东左），并把地平圆收进画面。
 */
export interface ViewFrame {
  mode: ProjectionMode;
  mirror: number;
  scale: number;
  shift: number;
  /** 透视：视图空间中地平线的 y；全天域：地平圆半径 */
  horizon: number;
  /** 透视模式下地平线（未移轴）在 Rust 空间的 y */
  horizonRaw: number;
}

const HORIZON_TARGET = -0.52;
/** 全天域地平圆半径与上移量：给底部的读数和时间轴留出地面 */
const STEREO_RADIUS = 0.72;
const STEREO_SHIFT = 0.22;

export function computeFrame(latDeg: number, fovDeg: number, mode: ProjectionMode, aspect: number): ViewFrame {
  if (mode === 1) {
    return { mode, mirror: -1, scale: STEREO_RADIUS, shift: STEREO_SHIFT, horizon: STEREO_RADIUS, horizonRaw: 1 };
  }
  // 面向天极的针孔相机里，地平大圆投影成一条水平直线：y = -tan|φ| / tan(fov/2)
  const halfTan = Math.tan(clampFov(fovDeg) * 0.5);
  const horizonRaw = -Math.tan(Math.min(Math.abs(latDeg), 89.5) * DEG) / halfTan;
  const ky = aspect >= 1 ? 1 : aspect;
  const shift = clamp(HORIZON_TARGET / ky - horizonRaw, -0.75, 0.78 / ky);
  return { mode, mirror: 1, scale: 1, shift, horizon: horizonRaw + shift, horizonRaw };
}

/** Rust 投影空间 → 视图空间 */
export function toView(x: number, y: number, frame: ViewFrame): [number, number] {
  return [x * frame.mirror * frame.scale, y * frame.scale + frame.shift];
}

/** 视图空间 → CSS 像素 */
export function viewToScreen(vx: number, vy: number, width: number, height: number): [number, number] {
  const aspect = width / height;
  const nx = aspect >= 1 ? vx / aspect : vx;
  const ny = aspect >= 1 ? vy : vy * aspect;
  return [((nx + 1) / 2) * width, ((1 - ny) / 2) * height];
}

/** 太阳方位在视图空间里对应的地平线位置，用于暮光余晖的方向 */
export function sunGlowAnchor(sun: Horizontal, latDeg: number, fovDeg: number, frame: ViewFrame): [number, number] {
  if (frame.mode === 1) {
    return toView(Math.sin(sun.az), Math.cos(sun.az), frame);
  }
  const north = latDeg >= 0;
  let rel = north ? sun.az : sun.az - Math.PI;
  rel = Math.atan2(Math.sin(rel), Math.cos(rel));
  const halfTan = Math.tan(clampFov(fovDeg) * 0.5);
  const cosLat = Math.max(Math.cos(latDeg * DEG), 0.05);
  const x = Math.abs(rel) < Math.PI / 2 - 0.01 ? Math.tan(rel) / (cosLat * halfTan) : Math.sign(Math.sin(rel)) * 6;
  return [clamp(x, -6, 6), frame.horizon];
}

// ---------------------------------------------------------------------------
// 银道面：银河带的近似轮廓
// ---------------------------------------------------------------------------

/** J2000 赤道 → 银道旋转矩阵（IAU 1958 定义） */
const GAL = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.44482963, 0.7469822445],
  [-0.867666149, -0.1980763734, 0.4559837762],
];

function galacticToEquatorial(l: number, b: number): { ra: number; dec: number } {
  const gx = Math.cos(b) * Math.cos(l);
  const gy = Math.cos(b) * Math.sin(l);
  const gz = Math.sin(b);
  const ex = GAL[0][0] * gx + GAL[1][0] * gy + GAL[2][0] * gz;
  const ey = GAL[0][1] * gx + GAL[1][1] * gy + GAL[2][1] * gz;
  const ez = GAL[0][2] * gx + GAL[1][2] * gy + GAL[2][2] * gz;
  return { ra: Math.atan2(ey, ex), dec: Math.asin(clamp(ez, -1, 1)) };
}

export interface GalacticNode {
  center: { ra: number; dec: number };
  upper: { ra: number; dec: number };
  lower: { ra: number; dec: number };
  /** 相对亮度：银心方向最亮，天鹅座次之，反银心最暗 */
  weight: number;
}

/** 沿银道每 3° 取一个节点，节点宽度与亮度按银经做经验化分布 */
export function buildGalacticNodes(): GalacticNode[] {
  const nodes: GalacticNode[] = [];
  for (let deg = 0; deg < 360; deg += 3) {
    const signed = deg > 180 ? deg - 360 : deg;
    const core = Math.exp(-((signed / 38) ** 2));
    const cygnus = Math.exp(-(((deg - 78) / 22) ** 2));
    const weight = 0.28 + 0.9 * core + 0.35 * cygnus;
    const halfWidth = (5 + 7 * core + 2 * cygnus) * DEG;
    const l = deg * DEG;
    nodes.push({
      center: galacticToEquatorial(l, 0),
      upper: galacticToEquatorial(l, halfWidth),
      lower: galacticToEquatorial(l, -halfWidth),
      weight,
    });
  }
  return nodes;
}

// ---------------------------------------------------------------------------
// 时区：用 Intl 求本地时间，不引入时区库
// ---------------------------------------------------------------------------

const partsCache = new Map<string, Intl.DateTimeFormat>();
const clockCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    partsCache.set(tz, f);
  }
  return f;
}

/** 某一时刻在指定时区相对 UTC 的偏移（分钟） */
export function tzOffsetMinutes(tz: string, ms: number): number {
  const parts = partsFormatter(tz).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** 儒略日 → 当地钟面时间 HH:MM */
export function formatClock(jd: number, tz: string): string {
  let f = clockCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('zh-CN', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    clockCache.set(tz, f);
  }
  return f.format(new Date(msFromJd(jd)));
}

/** 度 → 度分形式，例如 39°54′N */
export function formatCoordinate(value: number, positive: string, negative: string): string {
  const abs = Math.abs(value);
  let deg = Math.floor(abs);
  let min = Math.round((abs - deg) * 60);
  if (min === 60) {
    deg += 1;
    min = 0;
  }
  return `${deg}°${String(min).padStart(2, '0')}′${value >= 0 ? positive : negative}`;
}
