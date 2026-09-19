//! 投影参数与统一接口

pub mod perspective;
pub mod stereographic;

/// 投影模式枚举
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProjectionMode {
    /// 透视投影（面向天极，星轨为同心圆弧）
    Perspective = 0,
    /// 全天域立体投影（以天顶或天极为中心）
    Stereographic = 1,
}

/// 投影参数结构体
#[derive(Clone, Copy, Debug)]
pub struct ProjectionParams {
    pub mode: ProjectionMode,
    pub fov_rad: f64,
    pub lat_rad: f64,
    pub is_northern: bool,
}

impl ProjectionParams {
    pub fn new(mode_code: u32, fov_deg: f64, lat_rad: f64) -> Self {
        let mode = if mode_code == 1 {
            ProjectionMode::Stereographic
        } else {
            ProjectionMode::Perspective
        };
        let is_northern = lat_rad >= 0.0;
        let clamped_fov = fov_deg.clamp(20.0, 140.0).to_radians();

        Self {
            mode,
            fov_rad: clamped_fov,
            lat_rad,
            is_northern,
        }
    }
}

/// 投影统一入口函数
/// alt: 经过折射修正的高度角（弧度）
/// az: 方位角（弧度，北=0, 东=π/2）
/// 返回标准化画面坐标 Option<(x, y)>，范围大致在 [-1.0, 1.0]，None 表示不可见或超出视场
pub fn project(alt: f64, az: f64, params: &ProjectionParams) -> Option<(f64, f64)> {
    match params.mode {
        ProjectionMode::Perspective => perspective::project_perspective(alt, az, params),
        ProjectionMode::Stereographic => stereographic::project_stereographic(alt, az, params),
    }
}
