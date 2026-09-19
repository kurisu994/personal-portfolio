//! 透视投影：相机面向天极，星轨呈现同心圆弧
//! 视场角可在 30° - 100° 间调节

use super::ProjectionParams;

pub fn project_perspective(alt: f64, az: f64, params: &ProjectionParams) -> Option<(f64, f64)> {
    // 1. 地平系下的星点三维单位向量
    // x: 东, y: 北, z: 天顶
    let cos_alt = alt.cos();
    let sin_alt = alt.sin();
    let sin_az = az.sin();
    let cos_az = az.cos();

    let vx = cos_alt * sin_az;
    let vy = cos_alt * cos_az;
    let vz = sin_alt;

    let lat = params.lat_rad;

    // 2. 相机坐标基底
    // 相机视线方向 F (面向最近的天极)
    let (fx, fy, fz, rx) = if params.is_northern {
        // 北半球：面向北天极 (alt = lat, az = 0)
        // 右方向为正东 (1, 0, 0)
        (0.0, lat.cos(), lat.sin(), 1.0)
    } else {
        // 南半球：面向南天极 (alt = -lat, az = π)
        // 右方向为正西 (-1, 0, 0)
        (0.0, -lat.cos(), -lat.sin(), -1.0)
    };

    // 上方向 U 垂直于视线且偏向天顶
    let (ux, uy, uz) = (0.0, -lat.sin(), lat.cos());

    // 3. 投影到相机坐标系
    let z_cam = vx * fx + vy * fy + vz * fz;
    if z_cam <= 0.02 {
        // 在相机背面或切面边缘外
        return None;
    }

    let x_cam = vx * rx; // 因为 ry=rz=0
    let y_cam = vx * ux + vy * uy + vz * uz;

    // 4. 透视除法
    let half_tan = (params.fov_rad * 0.5).tan();
    let x = x_cam / (z_cam * half_tan);
    let y = y_cam / (z_cam * half_tan);

    // 允许略超出 [-1, 1]（比如绘制视口边缘的圆弧）
    if x.abs() > 2.0 || y.abs() > 2.0 {
        return None;
    }

    Some((x, y))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_north_pole_center() {
        let lat = 40.0_f64.to_radians();
        let params = ProjectionParams::new(0, 60.0, lat);

        // 北天极点 (alt = lat, az = 0) 应该投影在画面中心 (0, 0)
        let pt = project_perspective(lat, 0.0, &params);
        assert!(pt.is_some());
        let (x, y) = pt.unwrap();
        assert!(x.abs() < 1e-6, "x = {x}");
        assert!(y.abs() < 1e-6, "y = {y}");
    }

    #[test]
    fn test_south_pole_center() {
        let lat = -35.0_f64.to_radians();
        let params = ProjectionParams::new(0, 60.0, lat);

        // 南天极点 (alt = 35°, az = π) 应该投影在画面中心 (0, 0)
        let pt = project_perspective(35.0_f64.to_radians(), std::f64::consts::PI, &params);
        assert!(pt.is_some());
        let (x, y) = pt.unwrap();
        assert!(x.abs() < 1e-6, "x = {x}");
        assert!(y.abs() < 1e-6, "y = {y}");
    }
}
