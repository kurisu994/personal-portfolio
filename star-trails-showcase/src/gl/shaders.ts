//! WebGL2 着色器

/** 公共：Rust 投影空间 → NDC（镜像、缩放、移轴，再按宽高比铺满） */
const VIEW_CHUNK = `
uniform vec2 u_resolution;
uniform vec3 u_view; // x 镜像, y 缩放, z 竖向移轴

vec2 toNdc(vec2 p) {
    vec2 v = vec2(p.x * u_view.x, p.y) * u_view.y + vec2(0.0, u_view.z);
    float aspect = u_resolution.x / u_resolution.y;
    return aspect >= 1.0 ? vec2(v.x / aspect, v.y) : vec2(v.x, v.y * aspect);
}
`;

// 1. 恒星：累积曝光与实时星点共用
export const starVS = `#version 300 es
layout(location = 0) in vec2 a_position;
layout(location = 1) in float a_alt;
layout(location = 2) in float a_mag;
layout(location = 3) in float a_bv;
${VIEW_CHUNK}
uniform float u_energy;     // 单次采样的曝光能量
uniform float u_pointScale; // 设备像素比
uniform float u_limitMag;   // 光污染下的极限星等
uniform float u_sunAlt;     // 太阳高度（度）
uniform float u_head;       // 1 = 实时星点

out vec3 v_color;
out float v_energy;

// B-V 色指数 → 星光颜色：蓝白、暖白、橙金、橙红
vec3 bvToColor(float bv) {
    float c = clamp(bv, -0.4, 2.0);
    if (c < 0.0) return mix(vec3(0.86, 0.92, 1.0), vec3(0.66, 0.8, 1.0), -c / 0.4);
    if (c < 0.6) return mix(vec3(0.97, 0.97, 0.98), vec3(1.0, 0.93, 0.8), c / 0.6);
    if (c < 1.4) return mix(vec3(1.0, 0.93, 0.8), vec3(1.0, 0.7, 0.42), (c - 0.6) / 0.8);
    return mix(vec3(1.0, 0.7, 0.42), vec3(1.0, 0.5, 0.3), clamp((c - 1.4) / 0.6, 0.0, 1.0));
}

void main() {
    gl_Position = vec4(toNdc(a_position), 0.0, 1.0);

    float norm = clamp((5.0 - a_mag) / 6.0, 0.0, 1.0);
    gl_PointSize = (u_head > 0.5 ? mix(2.6, 9.5, norm * norm) : mix(1.6, 3.8, norm)) * u_pointScale;

    // 亮度按星等做压缩（0 等 ≈ 1，4.5 等 ≈ 0.1），否则暗星在屏幕上完全消失
    float bright = pow(10.0, -0.22 * a_mag);
    float limit = 1.0 - smoothstep(u_limitMag - 0.5, u_limitMag + 0.5, a_mag);
    // 越暗的星越要等天色更黑才显现
    float threshold = -1.0 - 2.4 * a_mag;
    float dark = 1.0 - smoothstep(threshold - 2.5, threshold + 2.5, u_sunAlt);
    float extinction = mix(0.2, 1.0, smoothstep(0.0, 0.3, a_alt));

    v_color = bvToColor(a_bv);
    v_energy = u_energy * bright * limit * dark * extinction;
}
`;

export const starFS = `#version 300 es
precision highp float;

in vec3 v_color;
in float v_energy;
uniform float u_head;
out vec4 fragColor;

void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d2 = dot(c, c) * 4.0;
    if (d2 > 1.0) discard;
    float shape = u_head > 0.5
        ? exp(-d2 * 16.0) + 0.22 * exp(-d2 * 3.5)
        : exp(-d2 * 4.5);
    fragColor = vec4(v_color * v_energy * shape, 1.0);
}
`;

// 2. 柔光点：银河带与流星
export const glowVS = `#version 300 es
layout(location = 0) in vec2 a_position;
layout(location = 1) in float a_size;
layout(location = 2) in float a_energy;
layout(location = 3) in vec3 a_color;
${VIEW_CHUNK}
uniform float u_sizeToPx;
uniform float u_maxPoint;

out vec3 v_color;
out float v_energy;

void main() {
    gl_Position = vec4(toNdc(a_position), 0.0, 1.0);
    float px = max(a_size * u_sizeToPx, 1.0);
    gl_PointSize = min(px, u_maxPoint);
    v_color = a_color;
    v_energy = a_energy;
}
`;

export const glowFS = `#version 300 es
precision highp float;

in vec3 v_color;
in float v_energy;
out vec4 fragColor;

void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d2 = dot(c, c) * 4.0;
    if (d2 > 1.0) discard;
    float shape = exp(-d2 * 3.2) * (1.0 - d2);
    fragColor = vec4(v_color * v_energy * shape, 1.0);
}
`;

// 3. 高斯模糊（分离卷积，用于光晕）
export const quadVS = `#version 300 es
layout(location = 0) in vec2 a_position;
out vec2 v_uv;

void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const blurFS = `#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_texture;
uniform vec2 u_direction;
out vec4 fragColor;

void main() {
    vec4 sum = texture(u_texture, v_uv) * 0.163;
    sum += (texture(u_texture, v_uv - u_direction) + texture(u_texture, v_uv + u_direction)) * 0.153;
    sum += (texture(u_texture, v_uv - u_direction * 2.0) + texture(u_texture, v_uv + u_direction * 2.0)) * 0.122;
    sum += (texture(u_texture, v_uv - u_direction * 3.0) + texture(u_texture, v_uv + u_direction * 3.0)) * 0.091;
    sum += (texture(u_texture, v_uv - u_direction * 4.0) + texture(u_texture, v_uv + u_direction * 4.0)) * 0.051;
    fragColor = sum;
}
`;

// 4. 最终合成：天空、曝光显影、实时星点、前景剪影、水面倒影
export const compositeFS = `#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_exposure;
uniform sampler2D u_bloom;
uniform sampler2D u_live;
uniform vec2 u_resolution;
uniform vec3 u_view;
uniform int u_mode;          // 0 透视, 1 全天域
uniform float u_horizon;     // 透视：视图空间地平线 y；全天域：地平圆半径
uniform vec3 u_sun;          // x 太阳高度（度），yz 余晖在视图空间的锚点
uniform float u_skyglow;     // 光污染
uniform float u_gain;        // 曝光增益
uniform vec4 u_far;          // 远景：轮廓, 幅度, 频率, 粗糙度
uniform vec4 u_near;         // 近景：轮廓, 幅度, 频率, 粗糙度
uniform vec3 u_feature;      // 地物, 是否临水, 种子
uniform float u_grainSeed;

out vec4 fragColor;

float hash(float n) {
    return fract(sin(n * 127.1 + u_feature.z * 311.7) * 43758.5453);
}

float vnoise(float x) {
    float i = floor(x);
    float f = fract(x);
    float u = f * f * (3.0 - 2.0 * f);
    return mix(hash(i), hash(i + 1.0), u);
}

float fbm(float x, float rough) {
    float sum = 0.0;
    float amp = 0.5;
    float norm = 0.0;
    for (int k = 0; k < 5; k++) {
        sum += amp * vnoise(x);
        norm += amp;
        x = x * 2.03 + 17.0;
        amp *= rough;
    }
    return sum / norm;
}

float ridged(float x, float rough) {
    float sum = 0.0;
    float amp = 0.5;
    float norm = 0.0;
    for (int k = 0; k < 5; k++) {
        float n = 1.0 - abs(vnoise(x) * 2.0 - 1.0);
        sum += amp * n * n;
        norm += amp;
        x = x * 2.1 + 31.0;
        amp *= rough;
    }
    return sum / norm;
}

// 轮廓高度：0 丘陵, 1 峻峰, 2 平顶山, 3 沙丘, 4 平地
float profile(float x, vec4 p, float seed) {
    float amp = p.y;
    if (amp <= 0.0) return 0.0;
    float xx = x * p.z + seed;
    if (p.x < 0.5) return amp * fbm(xx, p.w);
    if (p.x < 1.5) return amp * (0.15 + 1.1 * pow(ridged(xx, p.w), 2.2));
    if (p.x < 2.5) return amp * smoothstep(0.42, 0.6, fbm(xx * 0.8, p.w)) * (0.85 + 0.15 * vnoise(xx * 6.0));
    if (p.x < 3.5) {
        float s = fract(xx * 0.55 + 0.35 * fbm(xx * 0.4, 0.5));
        float dune = s < 0.74 ? s / 0.74 : (1.0 - s) / 0.26;
        return amp * (0.3 + 0.7 * smoothstep(0.0, 1.0, dune)) * (0.65 + 0.35 * vnoise(xx * 0.35));
    }
    return amp * (0.4 + 0.6 * fbm(xx * 3.0, 0.5));
}

float farHeight(float x) {
    float h = profile(x, u_far, 3.7);
    if (u_feature.x > 4.5) {
        // 远处的火山锥
        float d = abs(x - 0.62);
        h = max(h, min(0.2 * pow(max(0.0, 1.0 - d / 0.78), 1.5), 0.185));
    }
    return h;
}

float nearBase(float x) {
    return profile(x, u_near, 11.3);
}

// 近景高度：地形轮廓 + 地物（长城、圆顶、天际线）
float nearHeight(float x) {
    float h = nearBase(x);
    float feature = u_feature.x;
    if (feature > 1.5 && feature < 2.5) {
        // 长城：垛口沿山脊起伏，隔一段一座敌台
        float span = smoothstep(-1.5, -1.3, x) * (1.0 - smoothstep(1.0, 1.2, x));
        float crenel = step(0.5, fract(x / 0.012)) * 0.005;
        float t = fract(x / 0.46);
        float tower = step(0.465, t) * step(t, 0.535);
        float towerCrenel = step(0.5, fract(x / 0.009)) * 0.004;
        h += span * (0.015 + crenel * (1.0 - tower) + tower * (0.034 + towerCrenel));
    } else if (feature > 2.5 && feature < 3.5) {
        // 天文台圆顶：圆柱基座 + 半球
        float cell = floor(x / 0.42);
        float present = step(0.35, hash(cell + 5.0));
        float r = 0.026 + 0.018 * hash(cell + 9.0);
        float cx = (cell + 0.3 + 0.4 * hash(cell + 13.0)) * 0.42;
        float dx = abs(x - cx);
        float base = nearBase(cx);
        float dome = base + r * 0.75 + sqrt(max(r * r - dx * dx, 0.0));
        h = max(h, present * step(dx, r) * dome);
    } else if (feature > 3.5 && feature < 4.5) {
        // 城市天际线：高低错落的楼群与天线
        float w = 0.034;
        float cell = floor(x / w);
        float hgt = 0.018 + 0.1 * pow(hash(cell + 2.0), 2.6) * (1.0 - smoothstep(0.2, 1.9, abs(x + 0.2)));
        float local = fract(x / w);
        float gap = step(0.06, local) * step(local, 0.94);
        float spire = step(0.9, hash(cell + 7.0)) * step(abs(local - 0.5), 0.05) * 0.035;
        h = max(h, gap * (hgt + spire));
    }
    return h;
}

// 针叶林：每格一棵，树冠分三层锯齿
float treeCover(float x, float y, float px) {
    float w = 0.021;
    float cell = floor(x / w);
    if (hash(cell + 41.0) > 0.86) return 0.0;
    float height = w * (2.0 + 2.6 * hash(cell + 43.0));
    float cx = (cell + 0.5 + (hash(cell + 47.0) - 0.5) * 0.4) * w;
    float rel = y - nearBase(cx);
    if (rel < 0.0 || rel > height) return 0.0;
    float k = rel / height;
    float halfW = max(w * 0.6 * (1.0 - k) * (0.7 + 0.3 * fract(k * 3.0)), 0.0012);
    return clamp((halfW - abs(x - cx)) / px + 0.5, 0.0, 1.0);
}

vec3 tonemap(vec3 hdr) {
    return vec3(1.0) - exp(-hdr);
}

float grain(vec2 p) {
    p = fract(p * vec2(123.34, 456.21) + u_grainSeed);
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

void main() {
    float aspect = u_resolution.x / u_resolution.y;
    vec2 ndc = v_uv * 2.0 - 1.0;
    vec2 v = aspect >= 1.0 ? vec2(ndc.x * aspect, ndc.y) : vec2(ndc.x, ndc.y / aspect);
    float px = 2.0 / min(u_resolution.x, u_resolution.y);

    // 地形坐标：透视沿地平线展开；全天域沿地平圆展开（x 为方位，y 为向内的距离）
    float tx;
    float ty;
    float elevation;
    float scaleH = 1.0;
    bool outside = false;
    if (u_mode == 1) {
        vec2 vc = v - vec2(0.0, u_view.z);
        float r = length(vc);
        outside = r > u_horizon;
        float theta = atan(vc.x, vc.y);
        tx = theta / 6.2831853 * 10.0;
        ty = u_horizon - r;
        elevation = ty / u_horizon;
        scaleH = 0.7 * u_horizon;
    } else {
        tx = v.x;
        ty = v.y - u_horizon;
        elevation = ty;
    }

    // ---- 天空：夜色、暮光余晖、光污染 ----
    float sunAlt = u_sun.x;
    float twilight = clamp((sunAlt + 18.0) / 18.0, 0.0, 1.0);
    float e = max(elevation, 0.0);
    vec3 sky = mix(vec3(0.028, 0.042, 0.072), vec3(0.012, 0.017, 0.03), smoothstep(0.0, 1.1, e));
    sky += vec3(0.1, 0.17, 0.32) * pow(twilight, 2.4) * (0.55 + 0.45 * exp(-e * 2.0));
    float sunDist = u_mode == 1 ? length(v - u_sun.yz) / u_horizon : abs(v.x - u_sun.y);
    float glow = exp(-sunDist * sunDist * 0.9) * exp(-e * 3.2);
    sky += vec3(1.0, 0.5, 0.22) * pow(twilight, 3.2) * glow * 0.75;
    sky += vec3(0.9, 0.55, 0.3) * pow(twilight, 5.0) * exp(-e * 1.4) * 0.12;
    sky += vec3(1.0, 0.58, 0.3) * u_skyglow * exp(-e * 3.0) * 0.2 + vec3(0.02, 0.018, 0.016) * u_skyglow;

    // ---- 曝光显影：胶片式高光压缩，光晕做柔焦 ----
    vec3 hdr = (texture(u_exposure, v_uv).rgb + texture(u_bloom, v_uv).rgb * 0.35) * u_gain;
    vec3 film = tonemap(hdr);
    vec3 live = tonemap(texture(u_live, v_uv).rgb);
    vec3 color = vec3(1.0) - (vec3(1.0) - sky) * (vec3(1.0) - film) * (vec3(1.0) - live);

    // ---- 前景剪影（只在地平线附近求值，天空像素直接跳过） ----
    bool water = u_feature.y > 0.5 && u_mode == 0;
    float reach = (u_far.y + u_near.y + 0.26) * scaleH;
    if (ty > reach || (ty < -0.02 && !water)) {
        if (ty < 0.0 && u_mode == 0) color = vec3(0.006, 0.008, 0.012);
        if (outside) color = vec3(0.012, 0.014, 0.02);
        vec2 c0 = v_uv - 0.5;
        color *= 1.0 - dot(c0, c0) * 0.55;
        color += (grain(v_uv * u_resolution) - 0.5) * 0.018;
        fragColor = vec4(color, 1.0);
        return;
    }
    float farH = farHeight(tx);
    float nearH = nearHeight(tx);
    if (u_mode == 1) {
        // 全天域沿方位展开，在正南接缝处与另一侧混合，避免轮廓断开
        float seam = smoothstep(4.0, 5.0, tx);
        farH = mix(farH, farHeight(tx - 10.0), seam);
        nearH = mix(nearH, nearHeight(tx - 10.0), seam);
    }
    farH *= scaleH;
    nearH *= scaleH;

    float farMask = clamp((farH - ty) / px + 0.5, 0.0, 1.0);
    if (water) farMask *= step(0.0, ty);
    vec3 horizonSky = vec3(0.05, 0.07, 0.11) + vec3(0.12, 0.18, 0.3) * pow(twilight, 2.0) + vec3(0.2, 0.12, 0.06) * u_skyglow;
    color = mix(color, horizonSky * 0.55, farMask);

    if (water && ty < 0.0) {
        // 水面：以地平线为轴取倒影，加一点横向涟漪
        vec2 mv = vec2(v.x, u_horizon - ty);
        mv.x += sin(ty * 380.0 + v.x * 9.0) * 0.004 * (1.0 + abs(ty) * 12.0);
        vec2 mndc = aspect >= 1.0 ? vec2(mv.x / aspect, mv.y) : vec2(mv.x, mv.y * aspect);
        vec2 muv = mndc * 0.5 + 0.5;
        vec3 reflHdr = (texture(u_exposure, muv).rgb + texture(u_bloom, muv).rgb) * u_gain;
        float blocked = step(-ty, max(farH, nearH));
        vec3 refl = (tonemap(reflHdr) * 0.3 + tonemap(texture(u_live, muv).rgb) * 0.22) * (1.0 - blocked);
        float fade = exp(-abs(ty) * 5.0);
        vec3 waterColor = horizonSky * 0.18 * (0.4 + 0.6 * fade) + refl * fade;
        float wmask = clamp(-ty / px + 0.5, 0.0, 1.0);
        color = mix(color, waterColor, wmask);
    }

    float nearMask = clamp((nearH - ty) / px + 0.5, 0.0, 1.0);
    if (water) nearMask *= step(0.0015, nearH) * (u_feature.x > 3.5 && u_feature.x < 4.5 ? step(0.0, ty) : 1.0);
    if (u_feature.x > 0.5 && u_feature.x < 1.5) nearMask = max(nearMask, treeCover(tx, ty / scaleH, px / scaleH));
    vec3 ground = vec3(0.006, 0.008, 0.012);
    color = mix(color, ground, nearMask);

    if (outside) color = vec3(0.012, 0.014, 0.02);

    // ---- 暗角与颗粒 ----
    vec2 c = v_uv - 0.5;
    color *= 1.0 - dot(c, c) * 0.55;
    color += (grain(v_uv * u_resolution) - 0.5) * 0.018;

    fragColor = vec4(color, 1.0);
}
`;
