//! 离线固化天文算法精度测试
//! 读取 tests/vectors/astro-reference.json 中的权威测试向量进行断言

use serde::Deserialize;
use star_trails::astro::{precess, refraction, sun, time};

#[derive(Debug, Deserialize)]
struct ReferenceData {
    sidereal_time: Vec<SiderealTestCase>,
    precession: Vec<PrecessionTestCase>,
    sun_declination: Vec<SunDecTestCase>,
    refraction: Vec<RefractionTestCase>,
}

#[derive(Debug, Deserialize)]
struct SiderealTestCase {
    description: String,
    year: i32,
    month: u32,
    day: u32,
    hour: f64,
    expected_gst_hours: f64,
    tolerance_seconds: f64,
}

#[derive(Debug, Deserialize)]
struct PrecessionTestCase {
    description: String,
    ra0_hms: [f64; 3],
    dec0_dms: [f64; 3],
    target_jd_date: [f64; 4],
    expected_ra_hms: [f64; 3],
    expected_dec_dms: [f64; 3],
    tolerance_arcsec: f64,
}

#[derive(Debug, Deserialize)]
struct SunDecTestCase {
    description: String,
    year: i32,
    month: u32,
    day: u32,
    hour: f64,
    expected_dec_deg: f64,
    tolerance_deg: f64,
}

#[derive(Debug, Deserialize)]
struct RefractionTestCase {
    description: String,
    alt_deg: f64,
    expected_refraction_deg: f64,
    tolerance_deg: f64,
}

#[test]
fn test_all_astro_accuracy_vectors() {
    let json_bytes = include_bytes!("vectors/astro-reference.json");
    let data: ReferenceData = serde_json::from_slice(json_bytes).expect("解析参考向量 JSON 失败");

    // 1. 恒星时验证
    for tc in &data.sidereal_time {
        let jd = time::utc_to_jd(tc.year, tc.month, tc.day, tc.hour);
        let gst_rad = time::greenwich_sidereal_time(jd);
        let gst_hours = gst_rad.to_degrees() / 15.0;
        let diff_sec = (gst_hours - tc.expected_gst_hours).abs() * 3600.0;
        assert!(
            diff_sec < tc.tolerance_seconds,
            "{}: 差异 {} 秒超出阈值 {} 秒",
            tc.description,
            diff_sec,
            tc.tolerance_seconds
        );
    }

    // 2. 岁差验证
    for tc in &data.precession {
        let ra0 = time::hms_to_rad(tc.ra0_hms[0], tc.ra0_hms[1], tc.ra0_hms[2]);
        let dec0 = time::dms_to_rad(tc.dec0_dms[0], tc.dec0_dms[1], tc.dec0_dms[2]);
        let jd = time::utc_to_jd(
            tc.target_jd_date[0] as i32,
            tc.target_jd_date[1] as u32,
            tc.target_jd_date[2] as u32,
            tc.target_jd_date[3],
        );

        let (ra, dec) = precess::precess(ra0, dec0, jd);
        let exp_ra = time::hms_to_rad(tc.expected_ra_hms[0], tc.expected_ra_hms[1], tc.expected_ra_hms[2]);
        let exp_dec = time::dms_to_rad(tc.expected_dec_dms[0], tc.expected_dec_dms[1], tc.expected_dec_dms[2]);

        let ra_diff = (ra - exp_ra).abs().to_degrees() * 3600.0;
        let dec_diff = (dec - exp_dec).abs().to_degrees() * 3600.0;
        assert!(
            ra_diff < tc.tolerance_arcsec,
            "{}: RA 误差 {} 角秒超出阈值",
            tc.description,
            ra_diff
        );
        assert!(
            dec_diff < tc.tolerance_arcsec,
            "{}: Dec 误差 {} 角秒超出阈值",
            tc.description,
            dec_diff
        );
    }

    // 3. 太阳赤纬验证
    for tc in &data.sun_declination {
        let jd = time::utc_to_jd(tc.year, tc.month, tc.day, tc.hour);
        let (_ra, dec) = sun::sun_position(jd);
        let diff_deg = (dec.to_degrees() - tc.expected_dec_deg).abs();
        assert!(
            diff_deg < tc.tolerance_deg,
            "{}: 差异 {}° 超出阈值 {}°",
            tc.description,
            diff_deg,
            tc.tolerance_deg
        );
    }

    // 4. 大气折射验证
    for tc in &data.refraction {
        let r = refraction::refraction(tc.alt_deg);
        let diff_deg = (r - tc.expected_refraction_deg).abs();
        assert!(
            diff_deg < tc.tolerance_deg,
            "{}: 差异 {}° 超出阈值 {}°",
            tc.description,
            diff_deg,
            tc.tolerance_deg
        );
    }
}
