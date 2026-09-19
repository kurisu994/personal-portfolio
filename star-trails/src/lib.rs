pub mod astro;
pub mod projection;
pub mod render;
pub mod stars;

use wasm_bindgen::prelude::*;

use astro::{horizontal, precess, refraction, sun, time};
use projection::ProjectionParams;
use stars::catalog;

/// 计算一夜的时间窗口（日落到日出）
/// 返回 [sunset_jd, sunrise_jd, twilight_start_jd, twilight_end_jd]
#[wasm_bindgen]
pub fn compute_night_window(
    lat: f64,
    lon: f64,
    year: i32,
    month: u32,
    day: u32,
) -> Box<[f64]> {
    let jd = time::utc_to_jd(year, month, day, 12.0); // 当天正午
    let (sunset, sunrise) = sun::sunset_sunrise(jd, lat, lon);
    let (tw_start, tw_end) = sun::astronomical_twilight(jd, lat, lon);
    Box::new([sunset, sunrise, tw_start, tw_end])
}

/// 计算某一时刻地平线以上的星点位置
/// buf 格式：每颗星 6 个 f32 = [x, y, alt, mag, bv, _padding]
/// 返回地平线以上的星数
#[wasm_bindgen]
pub fn compute_star_positions(
    lat: f64,
    lon: f64,
    jd: f64,
    proj_mode: u32,
    fov_deg: f64,
    buf: &mut [f32],
) -> u32 {
    let gst = time::greenwich_sidereal_time(jd);
    let lst = time::local_sidereal_time(gst, lon);
    let stars = catalog::get_catalog();
    let params = ProjectionParams::new(proj_mode, fov_deg, lat);

    let mut count = 0u32;
    let stride = 6;

    for star in stars {
        // 岁差修正
        let (ra, dec) = precess::precess(star.ra, star.dec, jd);

        // 时角
        let ha = lst - ra;

        // 赤道 → 地平坐标
        let (alt, az) = horizontal::equatorial_to_horizontal(ha, dec, lat);

        // 大气折射修正
        let alt_corrected = alt + refraction::refraction(alt.to_degrees()).to_radians();

        // 跳过地平线以下
        if alt_corrected <= 0.0 {
            continue;
        }

        // 投影到画面坐标
        if let Some((x, y)) = projection::project(alt_corrected, az, &params) {
            let offset = (count as usize) * stride;
            if offset + stride > buf.len() {
                break;
            }
            buf[offset] = x as f32;
            buf[offset + 1] = y as f32;
            buf[offset + 2] = alt_corrected as f32;
            buf[offset + 3] = star.mag;
            buf[offset + 4] = star.bv;
            buf[offset + 5] = 0.0; // padding
            count += 1;
        }
    }

    count
}

/// 计算星轨弧线（多个时刻的位置序列）
/// buf 格式：每颗星 steps 个 (x, y)，即 star_count * steps * 2 个 f32
/// 返回参与计算的星数
#[wasm_bindgen]
pub fn compute_trail_arcs(
    lat: f64,
    lon: f64,
    jd_start: f64,
    jd_end: f64,
    steps: u32,
    proj_mode: u32,
    fov_deg: f64,
    buf: &mut [f32],
) -> u32 {
    let stars = catalog::get_catalog();
    let params = ProjectionParams::new(proj_mode, fov_deg, lat);
    let dt = (jd_end - jd_start) / (steps as f64 - 1.0).max(1.0);
    let stride = (steps as usize) * 2;

    let mut count = 0u32;

    for star in stars {
        let offset = (count as usize) * stride;
        if offset + stride > buf.len() {
            break;
        }

        // 检查这颗星在时间窗口中是否至少有一个点在地平线以上
        let mut any_visible = false;

        for step in 0..steps {
            let jd = jd_start + (step as f64) * dt;
            let gst = time::greenwich_sidereal_time(jd);
            let lst = time::local_sidereal_time(gst, lon);

            let (ra, dec) = precess::precess(star.ra, star.dec, jd);
            let ha = lst - ra;
            let (alt, az) = horizontal::equatorial_to_horizontal(ha, dec, lat);
            let alt_corrected = alt + refraction::refraction(alt.to_degrees()).to_radians();

            let idx = offset + (step as usize) * 2;
            if alt_corrected > 0.0 {
                if let Some((x, y)) = projection::project(alt_corrected, az, &params) {
                    buf[idx] = x as f32;
                    buf[idx + 1] = y as f32;
                    any_visible = true;
                    continue;
                }
            }
            // 不可见或视场外，标记为 NaN
            buf[idx] = f32::NAN;
            buf[idx + 1] = f32::NAN;
        }

        if any_visible {
            count += 1;
        } else {
            // 这颗星整夜都不可见，回退 count 对应的缓冲区空间
            // （下一颗星会覆盖这个位置）
        }
    }

    count
}
