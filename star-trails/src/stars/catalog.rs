//! 星表数据加载与访问
//! 二进制格式：4 * f32 小端序 (ra_rad, dec_rad, mag, bv)

use std::sync::OnceLock;

/// 单颗恒星数据
#[derive(Clone, Copy, Debug)]
pub struct Star {
    pub ra: f64,   // J2000 赤经（弧度）
    pub dec: f64,  // J2000 赤纬（弧度）
    pub mag: f32,  // 视星等
    pub bv: f32,   // B-V 色指数
}

// 编译期内嵌二进制星表
static CATALOG_RAW: &[u8] = include_bytes!("../../data/bsc5_mag45.bin");
static PARSED_CATALOG: OnceLock<Vec<Star>> = OnceLock::new();

/// 获取已解析的星表切片
pub fn get_catalog() -> &'static [Star] {
    PARSED_CATALOG.get_or_init(|| {
        let chunk_size = 16;
        let star_count = CATALOG_RAW.len() / chunk_size;
        let mut stars = Vec::with_capacity(star_count);

        for chunk in CATALOG_RAW.chunks_exact(chunk_size) {
            let ra_f32 = f32::from_le_bytes(chunk[0..4].try_into().unwrap());
            let dec_f32 = f32::from_le_bytes(chunk[4..8].try_into().unwrap());
            let mag = f32::from_le_bytes(chunk[8..12].try_into().unwrap());
            let bv = f32::from_le_bytes(chunk[12..16].try_into().unwrap());

            stars.push(Star {
                ra: ra_f32 as f64,
                dec: dec_f32 as f64,
                mag,
                bv,
            });
        }
        stars
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_load_catalog() {
        let stars = get_catalog();
        assert!(!stars.is_empty(), "星表不应为空");
        assert_eq!(stars.len(), 1600, "预设模拟/裁剪星表数量应为 1600 颗");

        let first = &stars[0];
        assert!(first.ra >= 0.0 && first.ra <= std::f64::consts::TAU);
        assert!(first.dec >= -std::f64::consts::FRAC_PI_2 && first.dec <= std::f64::consts::FRAC_PI_2);
    }
}
