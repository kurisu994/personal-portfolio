//! 太阳视位置、日出/日落/暮光时刻
//! 依据：Meeus《Astronomical Algorithms》第 15、25 章

use super::time;
use std::f64::consts::PI;

const TWO_PI: f64 = 2.0 * PI;
const SIDEREAL_RATE: f64 = 1.00273790935; // 恒星日相对太阳日的速率

/// 太阳视赤经和赤纬（低精度，误差 ~0.01°）
/// 返回 (ra, dec)，弧度
pub fn sun_position(jd: f64) -> (f64, f64) {
    let t = time::jd_to_centuries(jd);

    // 太阳几何平黄经（Meeus 25.2）
    let l0 = (280.46646 + (36000.76983 + 0.0003032 * t) * t) % 360.0;

    // 太阳平近点角（Meeus 25.3）
    let m = (357.52911 + (35999.05029 - 0.0001537 * t) * t) % 360.0;
    let m_rad = m.to_radians();

    // 太阳中心方程
    let c = (1.914602 - (0.004817 + 0.000014 * t) * t) * m_rad.sin()
        + (0.019993 - 0.000101 * t) * (2.0 * m_rad).sin()
        + 0.000289 * (3.0 * m_rad).sin();

    // 太阳真黄经
    let sun_lon = (l0 + c).to_radians();

    // 黄赤交角（Meeus 22.2 简化）
    let epsilon = (23.439291 - 0.0130042 * t).to_radians();

    // 太阳赤经、赤纬
    let ra = (epsilon.cos() * sun_lon.sin()).atan2(sun_lon.cos());
    let dec = (epsilon.sin() * sun_lon.sin()).asin();

    (time::normalize_angle(ra), dec)
}

/// 计算太阳到达指定高度角（例如 -0.833° 或 -18.0°）的世界时时刻（JD）
/// jd_date: 当天日期所在的 JD
/// target_alt_deg: 目标视高度角（度）
/// rising: true 为日出/晨光，false 为日落/暮光
pub fn sun_transit_jd(jd_date: f64, lat: f64, lon: f64, target_alt_deg: f64, rising: bool) -> Option<f64> {
    // 1. 基准 0h UT 的儒略日
    let jd0 = (jd_date - 0.5).floor() + 0.5;

    // 2. 估计地方平正午发生时的 UT
    let approx_noon_ut = (0.5 - lon / TWO_PI).rem_euclid(1.0);
    let jd_approx_noon = jd0 + approx_noon_ut;

    // 3. 在近似正午时刻获取太阳赤经和赤纬
    let (ra0, dec0) = sun_position(jd_approx_noon);

    // 4. 计算半日弧时角
    let h0 = target_alt_deg.to_radians();
    let cos_w0 = (h0.sin() - lat.sin() * dec0.sin()) / (lat.cos() * dec0.cos());

    if cos_w0 > 1.0 || cos_w0 < -1.0 {
        // 极昼或极夜
        return None;
    }

    let w0 = cos_w0.acos(); // 半日弧弧度

    // 5. 目标时刻的地方恒星时 LST
    let lst_target = if rising {
        ra0 - w0
    } else {
        ra0 + w0
    };

    // 对应的格林尼治恒星时 GST = LST - lon
    let gst_target = lst_target - lon;
    let gst0 = time::greenwich_sidereal_time(jd0);

    // 换算为该日 UT 天数
    let delta_gst = time::normalize_angle(gst_target - gst0);
    let mut m = delta_gst / (TWO_PI * SIDEREAL_RATE);

    // 6. 运行一次牛顿迭代修正精确时刻
    let jd_est = jd0 + m;
    let (ra, dec) = sun_position(jd_est);
    let gst = time::greenwich_sidereal_time(jd_est);
    let lst = time::local_sidereal_time(gst, lon);
    let ha = lst - ra;

    let sin_alt = lat.sin() * dec.sin() + lat.cos() * dec.cos() * ha.cos();
    let alt = sin_alt.clamp(-1.0, 1.0).asin();

    let dh = alt - h0;
    let dh_dt = -lat.cos() * dec.cos() * ha.sin() * TWO_PI * SIDEREAL_RATE;
    if dh_dt.abs() > 1e-4 {
        m -= dh / dh_dt;
    }

    Some(jd0 + m)
}

/// 日落与日出时刻
/// 使用标准太阳高度角 -0.833°（含折射和太阳视半径）
/// 返回 (sunset_jd, sunrise_jd)
pub fn sunset_sunrise(jd_date: f64, lat: f64, lon: f64) -> (f64, f64) {
    let sunrise = sun_transit_jd(jd_date, lat, lon, -0.833, true)
        .unwrap_or(jd_date - 0.25);
    let sunset = sun_transit_jd(jd_date, lat, lon, -0.833, false)
        .unwrap_or(jd_date + 0.25);
    (sunset, sunrise)
}

/// 天文暮光时刻（太阳高度角 -18°）
/// 返回 (twilight_start_jd, twilight_end_jd)
/// twilight_start = 日落后太阳降到 -18° 的时刻
/// twilight_end = 次日日出前太阳升到 -18° 的时刻
pub fn astronomical_twilight(jd_date: f64, lat: f64, lon: f64) -> (f64, f64) {
    let tw_start = sun_transit_jd(jd_date, lat, lon, -18.0, false)
        .unwrap_or(jd_date + 0.3);
    // 次日清晨的暮光
    let tw_end = sun_transit_jd(jd_date + 1.0, lat, lon, -18.0, true)
        .unwrap_or(jd_date + 0.8);
    (tw_start, tw_end)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::astro::time::utc_to_jd;

    /// Meeus 例 25.a：1992-10-13 0h TD
    /// 太阳赤纬 ≈ -7.78°
    #[test]
    fn test_sun_declination_meeus_25a() {
        let jd = utc_to_jd(1992, 10, 13, 0.0);
        let (_ra, dec) = sun_position(jd);
        let dec_deg = dec.to_degrees();
        assert!(
            (dec_deg - (-7.78)).abs() < 0.05,
            "sun dec = {dec_deg}°, expected ≈ -7.78°"
        );
    }

    /// 北京 2026-09-20：秋分前夕，昼夜接近等长
    /// 经度 116.4°E，地方平正午约在 04:14 UT (北京时间 12:14)
    /// 日出约在 06:00 北京时间 = 22:00 (前一日 UT)
    /// 日落约在 18:15 北京时间 = 10:15 UT
    #[test]
    fn test_sunrise_sunset_beijing() {
        let lat = 39.9_f64.to_radians();
        let lon = 116.4_f64.to_radians();
        let jd = utc_to_jd(2026, 9, 20, 12.0);

        let (sunset, sunrise) = sunset_sunrise(jd, lat, lon);

        // 验证日出日落对应的 UT 小时数
        let sunrise_ut = (sunrise - (sunrise.floor() + 0.5)).rem_euclid(1.0) * 24.0;
        let sunset_ut = (sunset - (sunset.floor() + 0.5)).rem_euclid(1.0) * 24.0;

        // 北京日出约在 UT 21:30 - 22:30 (前夜)
        assert!(
            (21.0..23.0).contains(&sunrise_ut),
            "sunrise UT = {sunrise_ut}h (应在 21:00 ~ 23:00 UT 左右)"
        );

        // 北京日落约在 UT 10:00 - 11:00
        assert!(
            (9.5..11.5).contains(&sunset_ut),
            "sunset UT = {sunset_ut}h (应在 09:30 ~ 11:30 UT 左右)"
        );
    }
}
