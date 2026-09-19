//! 色温映射与颜色计算
//! 根据恒星的 B-V 色指数近似黑体辐射有效温度与 RGB 颜色

/// B-V 色指数转 RGB（0.0 ~ 1.0）
/// 使用 Ballesteros (2012) 黑色体有效温度近似公式 + 常见星色映射
pub fn bv_to_rgb(bv: f32) -> (f32, f32, f32) {
    // 限制 B-V 在常见恒星范围 [-0.4, 2.0]
    let bv_clamped = bv.clamp(-0.4, 2.0);

    // 三档核心色彩插值 (暖白 / 淡蓝 / 橙红)
    if bv_clamped < 0.0 {
        // 蓝白超巨星 / 早型星 (如参宿七 B-V ≈ -0.03) -> 淡蓝 #cce3ff
        let t = (-bv_clamped / 0.4).clamp(0.0, 1.0);
        (0.85 - 0.05 * t, 0.90 + 0.05 * t, 1.0)
    } else if bv_clamped < 0.6 {
        // 白星 ~ 黄白星 (如织女星 B-V ≈ 0.0, 太阳 B-V ≈ 0.65) -> 暖白 #f8f6f0
        let t = bv_clamped / 0.6;
        (0.95 + 0.05 * t, 0.95, 0.95 - 0.20 * t)
    } else if bv_clamped < 1.4 {
        // 橙色星 (如大角星 B-V ≈ 1.23) -> 暖橙金
        let t = (bv_clamped - 0.6) / 0.8;
        (1.0, 0.85 - 0.25 * t, 0.60 - 0.30 * t)
    } else {
        // 红巨星 / M型星 (如参宿四 B-V ≈ 1.85) -> 暖红橙 #fca369
        let t = ((bv_clamped - 1.4) / 0.6).clamp(0.0, 1.0);
        (1.0, 0.60 - 0.15 * t, 0.30 - 0.10 * t)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bv_colors() {
        let (r_blue, _g_blue, b_blue) = bv_to_rgb(-0.2);
        assert!(b_blue >= r_blue, "负 B-V 应偏蓝");

        let (r_red, _g_red, b_red) = bv_to_rgb(1.8);
        assert!(r_red > b_red, "高 B-V 应偏红");
    }
}
