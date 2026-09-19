//! WebGL2 着色器定义

// 1. 恒星绘制着色器（加性混合渲染到累积 FBO）
export const starVS = `#version 300 es
layout(location = 0) in vec2 a_position; // 归一化坐标 [-1, 1]
layout(location = 1) in float a_alt;     // 高度角 (rad)
layout(location = 2) in float a_mag;     // 视星等 (0 ~ 5.5)
layout(location = 3) in float a_bv;      // B-V 色指数 (-0.4 ~ 2.0)

uniform vec2 u_resolution;
uniform float u_scale;

out vec3 v_color;
out float v_alpha;

// B-V 色指数映射到 RGB
vec3 bvToColor(float bv) {
    float c = clamp(bv, -0.4, 2.0);
    if (c < 0.0) {
        float t = clamp(-c / 0.4, 0.0, 1.0);
        return mix(vec3(0.92, 0.95, 1.0), vec3(0.78, 0.88, 1.0), t); // 蓝白淡青
    } else if (c < 0.6) {
        float t = c / 0.6;
        return mix(vec3(0.98, 0.97, 0.95), vec3(1.0, 0.94, 0.85), t); // 暖白
    } else if (c < 1.4) {
        float t = (c - 0.6) / 0.8;
        return mix(vec3(1.0, 0.94, 0.85), vec3(1.0, 0.75, 0.50), t); // 暖橙金
    } else {
        float t = clamp((c - 1.4) / 0.6, 0.0, 1.0);
        return mix(vec3(1.0, 0.75, 0.50), vec3(1.0, 0.55, 0.35), t); // 橙红
    }
}

void main() {
    float aspect = u_resolution.x / u_resolution.y;
    vec2 pos = a_position;
    if (aspect > 1.0) {
        pos.x /= aspect;
    } else {
        pos.y *= aspect;
    }

    gl_Position = vec4(pos, 0.0, 1.0);

    // 星等越小（越亮），点径与透明度越大
    float normMag = clamp((4.8 - a_mag) / 4.8, 0.1, 1.0);
    gl_PointSize = mix(2.0, 5.2, normMag);

    v_color = bvToColor(a_bv);
    // 高度角很低时适度大气消光
    float extinction = smoothstep(0.0, 0.15, a_alt);
    v_alpha = mix(0.15, 0.85, normMag) * extinction;
}
`;

export const starFS = `#version 300 es
precision highp float;

in vec3 v_color;
in float v_alpha;

out vec4 fragColor;

void main() {
    // 径向平滑高斯辉光
    vec2 coord = gl_PointCoord - vec2(0.5);
    float distSq = dot(coord, coord);
    if (distSq > 0.25) {
        discard;
    }

    float radial = exp(-distSq * 9.0);
    fragColor = vec4(v_color * v_alpha * radial * 0.12, 1.0);
}
`;

// 2. 高斯模糊光晕（分离模糊核）
export const blurVS = `#version 300 es
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
    vec4 sum = vec4(0.0);
    vec2 tc = v_uv;
    
    // 9 点高斯卷积
    sum += texture(u_texture, tc - u_direction * 4.0) * 0.051;
    sum += texture(u_texture, tc - u_direction * 3.0) * 0.091;
    sum += texture(u_texture, tc - u_direction * 2.0) * 0.122;
    sum += texture(u_texture, tc - u_direction * 1.0) * 0.153;
    sum += texture(u_texture, tc) * 0.163;
    sum += texture(u_texture, tc + u_direction * 1.0) * 0.153;
    sum += texture(u_texture, tc + u_direction * 2.0) * 0.122;
    sum += texture(u_texture, tc + u_direction * 3.0) * 0.091;
    sum += texture(u_texture, tc + u_direction * 4.0) * 0.051;

    fragColor = sum;
}
`;

// 3. 最终全屏合成（累积曝光 + 光晕 + 剪影 + 纸底暗角）
export const compositeVS = `#version 300 es
layout(location = 0) in vec2 a_position;
out vec2 v_uv;

void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const compositeFS = `#version 300 es
precision highp float;

in vec2 v_uv;
uniform sampler2D u_exposure;
uniform sampler2D u_bloom;
uniform vec2 u_resolution;
uniform float u_exposureTime;
uniform int u_isStereo;

out vec4 fragColor;

// 简单伪随机哈希
float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

void main() {
    vec4 trail = texture(u_exposure, v_uv);
    vec4 bloom = texture(u_bloom, v_uv);

    // 深墨纸底基色
    vec3 paperDark = vec3(0.045, 0.055, 0.08);

    // 星光合成 (曝光增强 + 软光晕)
    vec3 stars = trail.rgb + bloom.rgb * 0.45;

    // 宣纸噪点质感
    vec2 pixelCoord = v_uv * u_resolution;
    float grain = (hash(pixelCoord) - 0.5) * 0.025;

    // 暗角效应 Vignette
    vec2 center = v_uv - 0.5;
    float dist = dot(center, center);
    float vignette = clamp(1.0 - dist * 0.85, 0.0, 1.0);

    vec3 finalColor = (paperDark + stars) * vignette + grain;

    // 如果是全天立体投影，画框外做圆形剪裁遮罩
    if (u_isStereo == 1) {
        float r = length(center * vec2(u_resolution.x / u_resolution.y, 1.0));
        if (r > 0.46) {
            float edge = smoothstep(0.46, 0.465, r);
            finalColor = mix(finalColor, vec3(0.03, 0.035, 0.045), edge);
        }
    }

    fragColor = vec4(finalColor, 1.0);
}
`;
