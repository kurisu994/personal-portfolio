//! 全天域立体投影（Stereographic Projection）
//! 以天顶为中心，整个天半球压进画面，地平线映射为单位圆

use super::ProjectionParams;
use std::f64::consts::FRAC_PI_2;

pub fn project_stereographic(alt: f64, az: f64, _params: &ProjectionParams) -> Option<(f64, f64)> {
    if alt < -0.05 {
        return None;
    }

    // 天顶距 zenith angle z = π/2 - alt
    let z = (FRAC_PI_2 - alt).max(0.0);

    // 标准立体投影极径：r = 2 * tan(z / 2) / (2 * tan(π/4)) = tan(z / 2)
    // 使得地平线 (alt = 0, z = π/2) 恰好对应 r = tan(π/4) = 1.0
    let r = (z * 0.5).tan();

    // 画面方向：北向上 (y 正方向)，东向右 (x 正方向)
    let x = r * az.sin();
    let y = r * az.cos();

    // 允许稍微延伸到地平线下方一点点 (r <= 1.2)
    if r > 1.25 {
        return None;
    }

    Some((x, y))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_zenith_and_horizon() {
        let params = ProjectionParams::new(1, 90.0, 0.0);

        // 天顶 alt = π/2 应该在原点 (0, 0)
        let zenith = project_stereographic(FRAC_PI_2, 0.0, &params).unwrap();
        assert!(zenith.0.abs() < 1e-6);
        assert!(zenith.1.abs() < 1e-6);

        // 地平线正北 alt = 0, az = 0 应该在 (0, 1)
        let north_horizon = project_stereographic(0.0, 0.0, &params).unwrap();
        assert!(north_horizon.0.abs() < 1e-6);
        assert!((north_horizon.1 - 1.0).abs() < 1e-6);

        // 地平线正东 alt = 0, az = π/2 应该在 (1, 0)
        let east_horizon = project_stereographic(0.0, FRAC_PI_2, &params).unwrap();
        assert!((east_horizon.0 - 1.0).abs() < 1e-6);
        assert!(east_horizon.1.abs() < 1e-6);
    }
}
