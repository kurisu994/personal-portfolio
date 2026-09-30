import { localMidnightJd, localParts, sunPosition } from '../astro/sky';
import type { Coast } from '../data/coasts';
import { DEG, findExtrema, tideHeight, type TideExtremum } from './model';

/** 海岸潮位的理论上下限：各分潮振幅之和 */
export function tideEnvelope(coast: Coast): { min: number; max: number } {
  const sum = coast.model.constituents.reduce((s, c) => s + c.amp, 0);
  return { min: coast.model.z0 - sum, max: coast.model.z0 + sum };
}

/**
 * 海图基准面：取理论最低潮面向下取整到 0.1 米，
 * 界面上的「潮高」都从这里起算，和潮汐表的习惯一致，全天都是正数。
 */
export function chartDatum(coast: Coast): number {
  return Math.floor(tideEnvelope(coast).min * 10) / 10;
}

export interface TideDay {
  date: string;
  start: number;
  end: number;
  /** 每 10 分钟一个潮位点：[当日进度 0..1, 潮位] */
  curve: [number, number][];
  extrema: (TideExtremum & { p: number; clock: string })[];
  /** 按太阳高度着色的一天：夜、晨、昼、昏 */
  gradient: string;
}

/** 太阳高度（度）→ 时间轴颜色 */
function daylightColor(alt: number): string {
  const stops: [number, [number, number, number]][] = [
    [30, [232, 226, 210]],
    [8, [236, 214, 176]],
    [0, [226, 150, 104]],
    [-6, [110, 86, 118]],
    [-12, [34, 44, 78]],
    [-18, [12, 16, 30]],
  ];
  if (alt >= stops[0][0]) return `rgb(${stops[0][1].join(' ')})`;
  for (let i = 1; i < stops.length; i++) {
    const [a0, c0] = stops[i - 1];
    const [a1, c1] = stops[i];
    if (alt >= a1) {
      const t = (a0 - alt) / (a0 - a1);
      return `rgb(${c0.map((v, k) => Math.round(v + (c1[k] - v) * t)).join(' ')})`;
    }
  }
  return `rgb(${stops[stops.length - 1][1].join(' ')})`;
}

/** 当地某一天的潮位曲线、高低潮与日照色带 */
export function describeDay(coast: Coast, date: string): TideDay {
  const start = localMidnightJd(date, coast.tz);
  const end = localMidnightJd(nextDate(date), coast.tz);
  const span = end - start;
  const curve: [number, number][] = [];
  const steps = Math.round((span * 1440) / 10);
  for (let i = 0; i <= steps; i++) {
    const jd = start + (span * i) / steps;
    curve.push([i / steps, tideHeight(coast.model, jd, coast.lon)]);
  }
  const extrema = findExtrema(coast.model, coast.lon, start, end).map((e) => ({
    ...e,
    p: (e.jd - start) / span,
    clock: localParts(e.jd, coast.tz).clock,
  }));
  const colors: string[] = [];
  for (let i = 0; i <= 48; i++) {
    const alt = sunPosition(start + (span * i) / 48, coast.lat, coast.lon).alt / DEG;
    colors.push(`${daylightColor(alt)} ${((i / 48) * 100).toFixed(1)}%`);
  }
  return { date, start, end, curve, extrema, gradient: `linear-gradient(90deg, ${colors.join(', ')})` };
}

/** YYYY-MM-DD 加减天数 */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  const clamped = Math.min(Math.max(next.getTime(), Date.UTC(1950, 0, 1)), Date.UTC(2100, 11, 30));
  return new Date(clamped).toISOString().slice(0, 10);
}

export function nextDate(date: string): string {
  return shiftDate(date, 1);
}
