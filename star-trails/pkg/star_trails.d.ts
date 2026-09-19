/* tslint:disable */
/* eslint-disable */

/**
 * 计算一夜的时间窗口（日落到日出）
 * 返回 [sunset_jd, sunrise_jd, twilight_start_jd, twilight_end_jd]
 */
export function compute_night_window(lat: number, lon: number, year: number, month: number, day: number): Float64Array;

/**
 * 计算某一时刻地平线以上的星点位置
 * buf 格式：每颗星 6 个 f32 = [x, y, alt, mag, bv, _padding]
 * 返回地平线以上的星数
 */
export function compute_star_positions(lat: number, lon: number, jd: number, proj_mode: number, fov_deg: number, buf: Float32Array): number;

/**
 * 计算星轨弧线（多个时刻的位置序列）
 * buf 格式：每颗星 steps 个 (x, y)，即 star_count * steps * 2 个 f32
 * 返回参与计算的星数
 */
export function compute_trail_arcs(lat: number, lon: number, jd_start: number, jd_end: number, steps: number, proj_mode: number, fov_deg: number, buf: Float32Array): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly compute_night_window: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly compute_star_positions: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => number;
    readonly compute_trail_arcs: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export2: (a: number, b: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
