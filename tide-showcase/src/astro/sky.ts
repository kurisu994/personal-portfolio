//! 日月位置与时区换算：只服务于光照、天空着色与界面读数（约 0.5° 精度）。

import { DEG, meanLongitudes } from '../tide/model';

export const JD_UNIX_EPOCH = 2440587.5;
const J2000 = 2451545.0;

export const jdFromMs = (ms: number): number => ms / 86400000 + JD_UNIX_EPOCH;
export const msFromJd = (jd: number): number => (jd - JD_UNIX_EPOCH) * 86400000;
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** 格林尼治平恒星时（弧度） */
function gmst(jd: number): number {
  const d = jd - J2000;
  const r = ((280.46061837 + 360.98564736629 * d) % 360) * DEG;
  return r < 0 ? r + Math.PI * 2 : r;
}

export interface Horizontal {
  /** 高度角（弧度） */
  alt: number;
  /** 方位角（弧度，北为 0、东为正） */
  az: number;
}

function toHorizontal(ra: number, dec: number, jd: number, lat: number, lon: number): Horizontal {
  const h = gmst(jd) + lon - ra;
  const up = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(h) * Math.cos(lat);
  const east = -Math.cos(dec) * Math.sin(h);
  const north = Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.cos(h) * Math.sin(lat);
  return { alt: Math.asin(clamp(up, -1, 1)), az: Math.atan2(east, north) };
}

function eclipticToHorizontal(lambda: number, beta: number, jd: number, lat: number, lon: number): Horizontal {
  const eps = (23.439 - 0.0000004 * (jd - J2000)) * DEG;
  const ra = Math.atan2(Math.sin(lambda) * Math.cos(eps) - Math.tan(beta) * Math.sin(eps), Math.cos(lambda));
  const dec = Math.asin(Math.sin(beta) * Math.cos(eps) + Math.cos(beta) * Math.sin(eps) * Math.sin(lambda));
  return toHorizontal(ra, dec, jd, lat, lon);
}

/** 太阳地平坐标（天文年历低精度公式） */
export function sunPosition(jd: number, latDeg: number, lonDeg: number): Horizontal {
  const n = jd - J2000;
  const L = (280.46 + 0.9856474 * n) * DEG;
  const g = (357.528 + 0.9856003 * n) * DEG;
  const lambda = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * DEG;
  return eclipticToHorizontal(lambda, 0, jd, latDeg * DEG, lonDeg * DEG);
}

/** 月球地平坐标：平经度加主要的中心差与出差项（约 1° 精度） */
export function moonPosition(jd: number, latDeg: number, lonDeg: number): Horizontal {
  const d = jd - J2000;
  const { s, h, p } = meanLongitudes(jd);
  const M = (s - p) * DEG;
  const D = (s - h) * DEG;
  const F = (93.272 + 13.22935 * d) * DEG;
  const lambda = (s + 6.289 * Math.sin(M) + 1.274 * Math.sin(2 * D - M) + 0.658 * Math.sin(2 * D)) * DEG;
  const beta = 5.128 * Math.sin(F) * DEG;
  return eclipticToHorizontal(lambda, beta, jd, latDeg * DEG, lonDeg * DEG);
}

/**
 * 地平坐标 → 场景方向。场景里 +x 永远指向大海，y 向上；
 * facingDeg 是海岸朝向的方位角（东 90°、南 180°），先把方位旋到「海在 +x」再换算。
 */
export function toSceneDirection(pos: Horizontal, facingDeg: number): [number, number, number] {
  const az = pos.az - (facingDeg - 90) * DEG;
  const c = Math.cos(pos.alt);
  return [c * Math.sin(az), Math.sin(pos.alt), -c * Math.cos(az)];
}

// ---------------------------------------------------------------------------
// 时区：用 Intl 求本地时间，不引入时区库
// ---------------------------------------------------------------------------

const partsCache = new Map<string, Intl.DateTimeFormat>();

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

/** 当地某日零点的儒略日 */
export function localMidnightJd(date: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  return jdFromMs(guess - tzOffsetMinutes(tz, guess + 12 * 3600000) * 60000);
}

/** 儒略日 → 当地日期与钟面时间 */
export function localParts(jd: number, tz: string): { date: string; clock: string; hours: number } {
  const parts = partsFormatter(tz).formatToParts(new Date(msFromJd(jd)));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  const hour = get('hour') % 24;
  return {
    date: `${get('year')}-${pad(get('month'))}-${pad(get('day'))}`,
    clock: `${pad(hour)}:${pad(get('minute'))}`,
    hours: hour + get('minute') / 60,
  };
}
