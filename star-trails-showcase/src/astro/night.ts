import type { City } from '../data/cities';
import { DEG, formatClock, jdFromMs, sunHorizontal, tzOffsetMinutes } from './sky';

export type NightKind = 'normal' | 'polar-night' | 'polar-day';

/** 一夜的曝光窗口（儒略日） */
export interface NightWindow {
  start: number;
  end: number;
  kind: NightKind;
}

/** 时间轴刻度 */
export interface NightTick {
  p: number;
  label: string;
}

/** 供界面使用的夜晚摘要 */
export interface NightInfo extends NightWindow {
  startLabel: string;
  endLabel: string;
  hours: number;
  ticks: NightTick[];
  /** 按太阳高度着色的 CSS 渐变，日落端暖、深夜端黑、日出端回暖 */
  gradient: string;
}

type WasmNightWindow = (lat: number, lon: number, year: number, month: number, day: number) => Float64Array;

const SUNSET_ALT = -0.833 * DEG;

/** 在 [a, b] 间二分求太阳高度穿过日落高度的时刻 */
function bisectCrossing(a: number, b: number, lat: number, lon: number): number {
  const fa = sunHorizontal(a, lat, lon).alt - SUNSET_ALT;
  let lo = a;
  let hi = b;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    const fm = sunHorizontal(mid, lat, lon).alt - SUNSET_ALT;
    if (Math.sign(fm) === Math.sign(fa)) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** 从 from 起以 10 分钟步长扫描，找第一个指定方向的穿越 */
function findCrossing(from: number, to: number, lat: number, lon: number, descending: boolean): number | null {
  const step = 10 / 1440;
  let prev = sunHorizontal(from, lat, lon).alt - SUNSET_ALT;
  for (let t = from + step; t <= to; t += step) {
    const cur = sunHorizontal(t, lat, lon).alt - SUNSET_ALT;
    if (descending ? prev >= 0 && cur < 0 : prev < 0 && cur >= 0) {
      return bisectCrossing(t - step, t, lat, lon);
    }
    prev = cur;
  }
  return null;
}

/**
 * 解析「某地某日当晚」的曝光窗口。
 *
 * WASM 内核的 compute_night_window 返回的是同一个 UT 日期里的日落与日出，
 * 对西经和极地站点会出现日出早于日落（时长为负）或取到前一晚的情况。
 * 这里以当地正午为界，先用太阳高度扫描判定极昼 / 极夜并求出近似时刻，
 * 再从相邻几天的 WASM 结果里挑出与之吻合的那一组，保留内核的精度。
 */
export function resolveNight(city: City, dateStr: string, wasmWindow: WasmNightWindow): NightWindow {
  const [y, m, d] = dateStr.split('-').map((v) => parseInt(v, 10));
  const lat = city.lat * DEG;
  const lon = city.lon * DEG;
  const noonUtc = Date.UTC(y, m - 1, d, 12);
  const from = jdFromMs(noonUtc - tzOffsetMinutes(city.tz, noonUtc) * 60000);
  const to = from + 1;

  let minAlt = Infinity;
  let maxAlt = -Infinity;
  let minAt = from + 0.5;
  for (let i = 0; i <= 96; i++) {
    const t = from + i / 96;
    const alt = sunHorizontal(t, lat, lon).alt;
    if (alt < minAlt) {
      minAlt = alt;
      minAt = t;
    }
    maxAlt = Math.max(maxAlt, alt);
  }

  if (maxAlt < SUNSET_ALT) return { start: from, end: to, kind: 'polar-night' };
  if (minAlt > SUNSET_ALT) return { start: minAt - 4 / 24, end: minAt + 4 / 24, kind: 'polar-day' };

  const approxSet = findCrossing(from, to, lat, lon, true);
  const approxRise = approxSet === null ? null : findCrossing(approxSet, approxSet + 1, lat, lon, false);
  if (approxSet === null || approxRise === null) return { start: from, end: to, kind: 'polar-night' };

  // 用内核结果替换近似值：只接受与扫描结果相差 20 分钟以内的候选
  const tolerance = 20 / 1440;
  let sunset = approxSet;
  let sunrise = approxRise;
  for (let offset = -1; offset <= 2; offset++) {
    const day = new Date(Date.UTC(y, m - 1, d + offset));
    const w = wasmWindow(lat, lon, day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate());
    if (Math.abs(w[0] - approxSet) < tolerance) sunset = w[0];
    if (Math.abs(w[1] - approxRise) < tolerance) sunrise = w[1];
  }
  return { start: sunset, end: sunrise, kind: 'normal' };
}

/** 太阳高度（度）→ 时间轴颜色：白昼、民用 / 航海 / 天文暮光、全黑夜 */
function twilightColor(altDeg: number): string {
  const stops: [number, [number, number, number]][] = [
    [4, [214, 170, 118]],
    [-1, [226, 138, 84]],
    [-5, [120, 92, 120]],
    [-9, [44, 62, 110]],
    [-14, [18, 26, 52]],
    [-18, [9, 12, 22]],
  ];
  if (altDeg >= stops[0][0]) return `rgb(${stops[0][1].join(' ')})`;
  for (let i = 1; i < stops.length; i++) {
    const [a0, c0] = stops[i - 1];
    const [a1, c1] = stops[i];
    if (altDeg >= a1) {
      const t = (a0 - altDeg) / (a0 - a1);
      const c = c0.map((v, k) => Math.round(v + (c1[k] - v) * t));
      return `rgb(${c.join(' ')})`;
    }
  }
  return `rgb(${stops[stops.length - 1][1].join(' ')})`;
}

/** 生成时间轴需要的刻度、渐变与起止文字 */
export function describeNight(city: City, win: NightWindow): NightInfo {
  const lat = city.lat * DEG;
  const lon = city.lon * DEG;
  const span = win.end - win.start;

  const colorStops: string[] = [];
  const samples = 36;
  for (let i = 0; i <= samples; i++) {
    const t = win.start + (span * i) / samples;
    const alt = sunHorizontal(t, lat, lon).alt / DEG;
    colorStops.push(`${twilightColor(alt)} ${((i / samples) * 100).toFixed(1)}%`);
  }

  // 整点刻度：以窗口起点的时区偏移为准（一夜之内的夏令时切换忽略不计）
  const offsetDays = tzOffsetMinutes(city.tz, (win.start - 2440587.5) * 86400000) / 1440;
  const hours = span * 24;
  const every = hours > 16 ? 3 : hours > 8 ? 2 : 1;
  const ticks: NightTick[] = [];
  const localStart = (win.start + 0.5 + offsetDays) * 24;
  for (let h = Math.ceil(localStart); h < localStart + hours; h++) {
    const p = (h - localStart) / hours;
    if (p < 0.04 || p > 0.96) continue;
    const clock = ((h % 24) + 24) % 24;
    if (clock % every !== 0) continue;
    ticks.push({ p, label: String(clock).padStart(2, '0') });
  }

  return {
    ...win,
    startLabel: formatClock(win.start, city.tz),
    endLabel: formatClock(win.end, city.tz),
    hours,
    ticks,
    gradient: `linear-gradient(90deg, ${colorStops.join(', ')})`,
  };
}
