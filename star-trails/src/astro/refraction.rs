//! 大气折射修正
//! 依据：Saemundsson 公式（Meeus 第 16 章引用）

/// 大气折射量（度）
/// alt_deg: 视高度角（度），返回需要加到真高度上的修正量（度）
/// 低高度角时修正约 0.5°（地平线附近最大），高高度角时趋近于 0
pub fn refraction(alt_deg: f64) -> f64 {
    if alt_deg < -1.0 {
        // 地平线以下过多，忽略折射
        return 0.0;
    }

    // Bennett 公式（Meeus 公式 16.3），适用于地平高度角
    // R (角分) = 1.0 / tan(h + 7.31 / (h + 4.4)) + 0.0013515
    let h = alt_deg.max(-0.5);
    let r_arcmin = 1.0 / (h + 7.31 / (h + 4.4)).to_radians().tan() + 0.0013515;
    r_arcmin / 60.0 // 角分转度
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 地平线附近折射约 34 角分 ≈ 0.567°
    #[test]
    fn test_horizon_refraction() {
        let r = refraction(0.0);
        assert!(
            (r - 0.567).abs() < 0.05,
            "horizon refraction = {r}°"
        );
    }

    /// 高高度角折射很小
    #[test]
    fn test_high_altitude_refraction() {
        let r = refraction(90.0);
        assert!(r < 0.01, "zenith refraction = {r}°");
    }

    /// 低高度角（-1°以下）返回 0
    #[test]
    fn test_below_horizon() {
        let r = refraction(-5.0);
        assert_eq!(r, 0.0);
    }
}
