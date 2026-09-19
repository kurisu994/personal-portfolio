//! 岁差修正：J2000.0 赤道坐标 → 观测日期赤道坐标
//! 依据：Meeus《Astronomical Algorithms》第 21 章（刚体近似三转角法）

use super::time;

/// 将 J2000.0 赤道坐标 (ra0, dec0) 修正到儒略日 jd 对应的日期
/// 输入输出均为弧度
/// 使用 Meeus 第 21 章的近似三转角公式，在 ±200 年内精度约 0.01°
pub fn precess(ra0: f64, dec0: f64, jd: f64) -> (f64, f64) {
    let t = time::jd_to_centuries(jd);

    // Meeus 公式 21.2：岁差参数（单位为角秒）
    let zeta_a = (0.6406161 + (0.0000839 + 0.0000050 * t) * t) * t;
    let z_a = (0.6406161 + (0.0003041 + 0.0000051 * t) * t) * t;
    let theta_a = (0.5567530 - (0.0001185 + 0.0000116 * t) * t) * t;

    // 转为弧度（输入单位是度，因为系数已按度给出）
    let zeta = zeta_a.to_radians();
    let z = z_a.to_radians();
    let theta = theta_a.to_radians();

    // Meeus 公式 21.4
    let cos_dec0 = dec0.cos();
    let sin_dec0 = dec0.sin();
    let cos_theta = theta.cos();
    let sin_theta = theta.sin();

    let a = cos_dec0 * (ra0 + zeta).sin();
    let b = cos_theta * cos_dec0 * (ra0 + zeta).cos() - sin_theta * sin_dec0;
    let c = sin_theta * cos_dec0 * (ra0 + zeta).cos() + cos_theta * sin_dec0;

    let ra = a.atan2(b) + z;
    let dec = c.asin();

    (time::normalize_angle(ra), dec)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::astro::time::{hms_to_rad, utc_to_jd};

    /// Meeus 例 21.b：θ Persei 从 J2000.0 到 2028-11-13.19
    /// J2000.0 坐标：RA = 2h44m11.986s, Dec = +49°13'42.48"
    /// 预期结果：RA ≈ 2h46m11.331s, Dec ≈ +49°20'54.54"
    #[test]
    fn test_precess_meeus_21b() {
        let ra0 = hms_to_rad(2.0, 44.0, 11.986);
        let dec0 = (49.0_f64 + 13.0 / 60.0 + 42.48 / 3600.0).to_radians();

        let jd = utc_to_jd(2028, 11, 13, 0.19 * 24.0);
        let (ra, dec) = precess(ra0, dec0, jd);

        let expected_ra = hms_to_rad(2.0, 46.0, 11.331);
        let expected_dec = (49.0_f64 + 20.0 / 60.0 + 54.54 / 3600.0).to_radians();

        let ra_diff_arcsec = (ra - expected_ra).abs().to_degrees() * 3600.0;
        let dec_diff_arcsec = (dec - expected_dec).abs().to_degrees() * 3600.0;

        // 在 0.01° = 36″ 内
        assert!(
            ra_diff_arcsec < 36.0,
            "RA diff = {ra_diff_arcsec}″"
        );
        assert!(
            dec_diff_arcsec < 36.0,
            "Dec diff = {dec_diff_arcsec}″"
        );
    }
}
