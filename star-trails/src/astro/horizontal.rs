//! 赤道坐标 → 地平坐标变换
//! 依据：Meeus《Astronomical Algorithms》第 13 章

/// 赤道坐标转地平坐标
/// ha: 时角（弧度），dec: 赤纬（弧度），lat: 观测者纬度（弧度）
/// 返回 (altitude, azimuth)，均为弧度
/// 方位角从北顺时针量度（北=0, 东=π/2, 南=π, 西=3π/2）
pub fn equatorial_to_horizontal(ha: f64, dec: f64, lat: f64) -> (f64, f64) {
    let sin_lat = lat.sin();
    let cos_lat = lat.cos();
    let sin_dec = dec.sin();
    let cos_dec = dec.cos();
    let cos_ha = ha.cos();
    let sin_ha = ha.sin();

    // 高度角 (Meeus 13.6)
    let sin_alt = sin_lat * sin_dec + cos_lat * cos_dec * cos_ha;
    let alt = sin_alt.asin();

    // 方位角 (Meeus 13.5)
    // atan2(-cos_dec * sin_ha, sin_dec * cos_lat - cos_dec * sin_lat * cos_ha)
    let az = (-cos_dec * sin_ha).atan2(sin_dec * cos_lat - cos_dec * sin_lat * cos_ha);

    // 将方位角归化到 [0, 2π)
    let az_normalized = if az < 0.0 {
        az + 2.0 * std::f64::consts::PI
    } else {
        az
    };

    (alt, az_normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 基本几何验证：在北极观测天顶（赤纬=90°），高度角应为 90°
    #[test]
    fn test_pole_zenith() {
        let ha = 0.0;
        let dec = std::f64::consts::FRAC_PI_2; // 90°
        let lat = std::f64::consts::FRAC_PI_2; // 北极

        let (alt, _az) = equatorial_to_horizontal(ha, dec, lat);
        assert!(
            (alt - std::f64::consts::FRAC_PI_2).abs() < 1e-10,
            "alt = {}°",
            alt.to_degrees()
        );
    }

    /// 在赤道上，赤纬为 0 的星在子午线上时高度角应为 90°
    #[test]
    fn test_equator_meridian() {
        let ha = 0.0;
        let dec = 0.0;
        let lat = 0.0; // 赤道

        let (alt, _az) = equatorial_to_horizontal(ha, dec, lat);
        assert!(
            (alt - std::f64::consts::FRAC_PI_2).abs() < 1e-10,
            "alt = {}°",
            alt.to_degrees()
        );
    }

    /// 北纬 40°，赤纬 +40° 的星在子午线时高度角应为 90°
    #[test]
    fn test_lat40_dec40_meridian() {
        let lat = 40.0_f64.to_radians();
        let dec = 40.0_f64.to_radians();
        let ha = 0.0;

        let (alt, _az) = equatorial_to_horizontal(ha, dec, lat);
        // 子午线上 alt = 90° - |lat - dec| = 90°（lat == dec 时）
        assert!(
            (alt - std::f64::consts::FRAC_PI_2).abs() < 1e-6,
            "alt = {}°",
            alt.to_degrees()
        );
    }
}
