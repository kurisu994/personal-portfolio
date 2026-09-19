import initWasm, {
  compute_night_window,
  compute_star_positions,
  compute_trail_arcs,
} from '../../../star-trails/pkg/star_trails.js';

let isInitialized = false;
let initPromise: Promise<void> | null = null;

/**
 * 初始化并加载 Rust WASM 天文内核
 */
export async function initAstro(): Promise<void> {
  if (isInitialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // 指向构建产物或静态托管的 wasm 文件
    const wasmUrl = new URL('./pkg/star_trails_bg.wasm', window.location.href);
    await initWasm(wasmUrl);
    isInitialized = true;
  })();

  return initPromise;
}

export interface NightWindow {
  sunset: number;
  sunrise: number;
  twilightStart: number;
  twilightEnd: number;
  durationHours: number;
}

/**
 * 计算一夜观测时间窗口
 */
export function getNightWindow(
  latDeg: number,
  lonDeg: number,
  year: number,
  month: number,
  day: number
): NightWindow {
  const latRad = (latDeg * Math.PI) / 180;
  const lonRad = (lonDeg * Math.PI) / 180;
  const arr = compute_night_window(latRad, lonRad, year, month, day);

  const sunset = arr[0];
  const sunrise = arr[1];
  const twilightStart = arr[2];
  const twilightEnd = arr[3];
  const durationHours = (sunrise - sunset) * 24;

  return {
    sunset,
    sunrise,
    twilightStart,
    twilightEnd,
    durationHours,
  };
}

export { compute_star_positions, compute_trail_arcs };
