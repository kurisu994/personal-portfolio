//! 时间相关计算：UTC ↔ 儒略日、格林尼治恒星时、地方恒星时
//! 依据：Meeus《Astronomical Algorithms》第 7、12 章

use std::f64::consts::PI;

const TWO_PI: f64 = 2.0 * PI;

/// UTC 日历日期转儒略日（Meeus 第 7 章）
/// hour 为 UTC 的小数小时（如 19:21 UT = 19.35）
pub fn utc_to_jd(year: i32, month: u32, day: u32, hour: f64) -> f64 {
    let (y, m) = if month <= 2 {
        (year as f64 - 1.0, month as f64 + 12.0)
    } else {
        (year as f64, month as f64)
    };

    let a = (y / 100.0).floor();
    let b = 2.0 - a + (a / 4.0).floor();

    (365.25 * (y + 4716.0)).floor()
        + (30.6001 * (m + 1.0)).floor()
        + day as f64
        + hour / 24.0
        + b
        - 1524.5
}

/// 儒略日转 J2000.0 起算的儒略世纪数 T
pub fn jd_to_centuries(jd: f64) -> f64 {
    (jd - 2451545.0) / 36525.0
}

/// 格林尼治平恒星时 GMST（Meeus 第 12 章，公式 12.4）
/// 返回值单位为弧度，已归化到 [0, 2π)
pub fn greenwich_sidereal_time(jd: f64) -> f64 {
    let t = jd_to_centuries(jd);

    // Meeus 公式 12.4：返回度数
    let theta0 = 280.46061837
        + 360.98564736629 * (jd - 2451545.0)
        + 0.000387933 * t * t
        - t * t * t / 38710000.0;

    // 转为弧度并归化
    let rad = theta0.to_radians();
    normalize_angle(rad)
}

/// 地方恒星时 = GST + 观测者经度（东经为正）
/// 输入输出均为弧度
pub fn local_sidereal_time(gst: f64, longitude_rad: f64) -> f64 {
    normalize_angle(gst + longitude_rad)
}

/// 将角度归化到 [0, 2π)
pub fn normalize_angle(angle: f64) -> f64 {
    let mut a = angle % TWO_PI;
    if a < 0.0 {
        a += TWO_PI;
    }
    a
}

/// 度分秒转弧度
pub fn dms_to_rad(deg: f64, min: f64, sec: f64) -> f64 {
    let sign = if deg < 0.0 { -1.0 } else { 1.0 };
    (deg.abs() + min / 60.0 + sec / 3600.0).to_radians() * sign
}

/// 时分秒转弧度（赤经用）
pub fn hms_to_rad(h: f64, m: f64, s: f64) -> f64 {
    ((h + m / 60.0 + s / 3600.0) * 15.0).to_radians()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Meeus 例 7.a：1957-10-04.81 → JD 2436116.31
    #[test]
    fn test_utc_to_jd_meeus_7a() {
        let jd = utc_to_jd(1957, 10, 4, 0.81 * 24.0);
        assert!((jd - 2436116.31).abs() < 0.001, "JD = {jd}");
    }

    /// Meeus 例 12.a：1987-04-10 19:21 UT → GST = 8h34m57.0896s
    #[test]
    fn test_gst_meeus_12a() {
        let jd = utc_to_jd(1987, 4, 10, 19.0 + 21.0 / 60.0);
        let gst_rad = greenwich_sidereal_time(jd);
        let gst_hours = gst_rad.to_degrees() / 15.0;
        // 8h34m57.0896s = 8.58252489 h
        let expected = 8.0 + 34.0 / 60.0 + 57.0896 / 3600.0;
        let diff_seconds = (gst_hours - expected).abs() * 3600.0;
        assert!(
            diff_seconds < 0.1,
            "GST = {gst_hours}h, expected = {expected}h, diff = {diff_seconds}s"
        );
    }
}
