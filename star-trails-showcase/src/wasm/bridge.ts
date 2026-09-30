import initWasm, {
  compute_night_window,
  compute_star_positions,
} from '../../../star-trails/pkg/star_trails.js';

let initPromise: Promise<void> | null = null;

/**
 * 初始化并加载 Rust WASM 天文内核（多次调用只加载一次）
 */
export function initAstro(): Promise<void> {
  if (!initPromise) {
    // 指向构建产物或静态托管的 wasm 文件
    const wasmUrl = new URL('./pkg/star_trails_bg.wasm', window.location.href);
    initPromise = initWasm({ module_or_path: wasmUrl }).then(() => undefined);
  }
  return initPromise;
}

/**
 * 内核给出的同一 UT 日期内的 [日落, 日出, 天文暮光始, 天文晨光终]（儒略日）。
 * 跨日期与极昼极夜的挑选由 astro/night.ts 负责。
 */
export { compute_night_window, compute_star_positions };
