//! 潮间带着色器（three.js ShaderMaterial，GLSL1 写法由 three 转换到 WebGL2）。
//! 颜色一律在线性空间计算，最后由 OutputPass 统一做 ACES 色调映射与 sRGB 输出。

/** 公共：地形采样、噪声、涌浪与上冲。场更新、沙面、水面三处共用，保证「湿」与「看见的水」一致 */
export const COMMON = /* glsl */ `
uniform sampler2D uTerrain;
uniform vec4 uDomain;        // x0, z0, 宽, 深
uniform sampler2D uField;
uniform vec4 uFieldDomain;
uniform float uTide;         // 潮位（米，相对平均海面）
uniform float uTime;         // 真实秒数：涌浪不做时间压缩
uniform vec4 uSwell;         // 波高, 周期, 上冲高度, 近岸波长

float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm2(vec2 p) {
    float s = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
        s += a * vnoise(p);
        p = p * 2.03 + 11.7;
        a *= 0.5;
    }
    return s / 0.9375;
}

vec4 terrainAt(vec2 p) {
    return texture2D(uTerrain, clamp((p - uDomain.xy) / uDomain.zw, 0.0, 1.0));
}

float sandHeight(vec2 p) {
    float h = terrainAt(p).r;
    // 细节域外的陆侧延伸成起伏的坡地，避免边缘露出平台
    float land = clamp((uDomain.x - p.x) / 140.0, 0.0, 1.0);
    return h + land * (7.0 * fbm2(p * 0.006) + 5.0 * land);
}

/** 近岸系数：静水深小于一米多时上冲水膜才起作用 */
float shoreFactor(float stillDepth) {
    return 1.0 - smoothstep(0.2, 1.4, stillDepth);
}

/** 涌浪相位（周数）：波峰向陆地推进，沿岸方向错开 */
float swellPhase(vec2 p) {
    return p.x / uSwell.w + uTime / uSwell.y + p.y * 0.011 + 0.35 * sin(p.y * 0.021 + 1.3);
}

/** 上冲：快速涌上、缓慢回落，每道浪强弱不同 */
float swashLift(vec2 p) {
    float ph = swellPhase(p);
    float s = fract(ph);
    float strength = 0.55 + 0.45 * vnoise(vec2(floor(ph) * 1.37, p.y * 0.035));
    return uSwell.z * strength * smoothstep(0.0, 0.18, s) * (1.0 - smoothstep(0.18, 0.96, s));
}

/** 离岸涌浪起伏：四个分量，浅水抬升但不超过水深的 0.45 */
float swellHeight(vec2 p, float depth) {
    float H = uSwell.x;
    float w = 6.2831853 / uSwell.y;
    float h = 0.5 * H * sin(6.2831853 * swellPhase(p) - 1.5708);
    h += 0.22 * H * sin(dot(p, vec2(0.21, 0.09)) + 1.21 * w * uTime + 1.7);
    h += 0.14 * H * sin(dot(p, vec2(0.33, -0.16)) + 1.63 * w * uTime + 4.1);
    h += 0.05 * H * sin(dot(p, vec2(-0.2, 0.92)) + 2.9 * w * uTime);
    float shoal = clamp(pow(8.0 / max(depth, 0.4), 0.25), 1.0, 1.7);
    float cap = 0.45 * max(depth, 0.0);
    return clamp(h * shoal, -cap, cap);
}

/** 水面高度：潮位 + 涌浪 + 近岸上冲水膜 */
float waterSurface(vec2 p, out float still, out float sand) {
    sand = sandHeight(p);
    still = uTide - sand;
    return uTide + swellHeight(p, still) + swashLift(p) * shoreFactor(still);
}

vec3 srgb(vec3 c) {
    return pow(c, vec3(2.2));
}
`;

/** 光照与雾：沙面、水面共用 */
const LIGHT = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uGround;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uCoast;        // 0 细沙滩, 1 泥滩, 2 礁岸

vec3 ambientLight(vec3 n) {
    return mix(uGround, uSkyZenith, n.y * 0.5 + 0.5);
}

vec3 skyAt(vec3 dir) {
    return mix(uSkyHorizon, uSkyZenith, pow(clamp(dir.y, 0.0, 1.0), 0.45));
}

vec3 applyFog(vec3 color, float dist) {
    return mix(color, uFogColor, 1.0 - exp(-dist * uFogDensity));
}
`;

// ---------------------------------------------------------------- 沙面

export const sandVertex = /* glsl */ `
${COMMON}
varying vec3 vWorld;

void main() {
    vec3 p = position;
    p.y = sandHeight(p.xz);
    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const sandFragment = /* glsl */ `
${COMMON}
${LIGHT}
uniform vec2 uFieldTexel;
varying vec3 vWorld;

void main() {
    vec2 p = vWorld.xz;
    vec4 t = terrainAt(p);
    float h = sandHeight(p);
    float e = 0.3;
    vec3 n = normalize(vec3(sandHeight(p - vec2(e, 0.0)) - sandHeight(p + vec2(e, 0.0)), 2.0 * e,
                            sandHeight(p - vec2(0.0, e)) - sandHeight(p + vec2(0.0, e))));
    float dist = length(cameraPosition - vWorld);

    // 湿度与痕迹：场内取历史，场外按与水位的关系近似
    vec2 fuv = (p - uFieldDomain.xy) / uFieldDomain.zw;
    float inside = smoothstep(0.0, 0.03, fuv.x) * smoothstep(1.0, 0.97, fuv.x) * smoothstep(0.0, 0.03, fuv.y) * smoothstep(1.0, 0.97, fuv.y);
    vec4 f = texture2D(uField, clamp(fuv, 0.0, 1.0));
    float still = uTide - h;
    float film = uTide + swashLift(p) * shoreFactor(still) - h;
    float wetApprox = film > 0.0 ? 1.0 : exp(-max(h - uTide, 0.0) / 0.35) * 0.7;
    float wet = mix(wetApprox, f.r, inside);
    float trace = f.g * inside;
    float foam = f.b * inside;

    // 痕迹凹槽：用场的梯度扰动法线，背光一侧自然出现阴影
    if (inside > 0.001) {
        float gx = texture2D(uField, fuv + vec2(uFieldTexel.x, 0.0)).g - texture2D(uField, fuv - vec2(uFieldTexel.x, 0.0)).g;
        float gz = texture2D(uField, fuv + vec2(0.0, uFieldTexel.y)).g - texture2D(uField, fuv - vec2(0.0, uFieldTexel.y)).g;
        n = normalize(n + vec3(gx, 0.0, gz) * 1.8 * inside);
    }

    // 沙纹：平行岸线，近处清晰、远处淡出防止闪烁
    float near = 1.0 - smoothstep(8.0, 34.0, dist);
    float rp = (p.x + vnoise(p * 0.35) * 1.4 + vnoise(p * 1.3) * 0.3) * 6.2831853 / 0.62;
    float patchy = smoothstep(0.3, 0.75, vnoise(p * 0.07 + 4.0));
    n = normalize(n + vec3(cos(rp) * 0.12, 0.0, (vnoise(p * 2.0) - 0.5) * 0.1) * t.a * near * patchy * (1.0 - t.g));
    n = normalize(n + vec3(vnoise(p * 7.0) - 0.5, 0.0, vnoise(p * 7.0 + 5.3) - 0.5) * 0.12 * near);

    // 材质：干沙 / 湿沙 / 泥 / 礁石 / 植被
    float mud = t.b;
    float rock = smoothstep(0.25, 0.6, t.g);
    vec2 rq = p * 1.9;
    n = normalize(n + vec3(fbm2(rq) - 0.5, 0.0, fbm2(rq + 13.1) - 0.5) * 0.9 * rock);
    vec3 dry = mix(srgb(vec3(0.74, 0.67, 0.55)), srgb(vec3(0.46, 0.42, 0.36)), mud);
    vec3 damp = mix(srgb(vec3(0.47, 0.4, 0.31)), srgb(vec3(0.24, 0.21, 0.17)), mud);
    wet = max(wet, 0.65 * mud * (1.0 - smoothstep(2.6, 3.1, h)));
    float puddle = mud * smoothstep(0.6, 0.66, fbm2(p * vec2(0.35, 0.9) + 2.0)) * (1.0 - smoothstep(2.4, 2.8, h));
    wet = max(wet, puddle);
    vec3 albedo = mix(dry, damp, wet);
    float vegetation = smoothstep(2.9, 3.4, h) * (uCoast < 0.5 ? smoothstep(0.42, 0.66, fbm2(p * 0.25)) : uCoast < 1.5 ? 0.85 : 0.7);
    albedo = mix(albedo, srgb(vec3(0.4, 0.42, 0.28)) * (0.8 + 0.4 * vnoise(p * 0.8)), vegetation);
    vec3 rockColor = mix(srgb(vec3(0.33, 0.31, 0.28)), srgb(vec3(0.12, 0.11, 0.1)), wet) * (0.55 + 0.8 * fbm2(p * 0.9));
    // 潮间带礁石上的藻痕：低处偏绿
    rockColor = mix(rockColor, srgb(vec3(0.2, 0.24, 0.14)), smoothstep(0.3, -0.6, h) * 0.6);
    albedo = mix(albedo, rockColor, rock);
    vec2 cell = floor(p * 5.0);
    vec2 jitter = vec2(hash12(cell + 3.1), hash12(cell + 7.7)) - 0.5;
    float dot1 = 1.0 - smoothstep(0.035, 0.07, length(fract(p * 5.0) - 0.5 - jitter * 0.7));
    float speck = step(0.955, hash12(cell)) * dot1 * (1.0 - rock) * (1.0 - mud) * near;
    albedo = mix(albedo, srgb(vec3(0.95, 0.92, 0.86)), speck * 0.7);
    albedo *= 1.0 - trace * 0.3;

    // 光照：日光、月光、天空环境光
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 color = albedo * (uSunColor * max(dot(n, uSunDir), 0.0) + uMoonColor * max(dot(n, uMoonDir), 0.0) + ambientLight(n));

    // 湿面：菲涅尔天空反射与高光
    float gloss = wet * (1.0 - rock * 0.4) * (1.0 - vegetation) + puddle * 0.8;
    float fres = 0.04 + 0.96 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
    vec3 R = reflect(-V, n);
    float sunSpec = pow(max(dot(n, normalize(uSunDir + V)), 0.0), 180.0) * 5.0;
    float moonSpec = pow(max(dot(n, normalize(uMoonDir + V)), 0.0), 180.0) * 5.0;
    color += gloss * fres * (skyAt(R) * 0.9 + uSunColor * sunSpec + uMoonColor * moonSpec);

    // 退水后残留的泡沫花边
    float lace = smoothstep(0.48, 0.72, fbm2(p * vec2(2.2, 1.4) + 3.1));
    vec3 foamLit = (uSunColor * max(uSunDir.y, 0.0) + ambientLight(vec3(0.0, 1.0, 0.0)) + uMoonColor * 0.6) * 0.82;
    color = mix(color, foamLit, foam * lace * 0.8);

    gl_FragColor = vec4(applyFog(color, dist), 1.0);
}
`;

// ---------------------------------------------------------------- 水面

export const waterVertex = /* glsl */ `
${COMMON}
varying vec3 vWorld;

void main() {
    vec3 p = position;
    float still;
    float sand;
    p.y = waterSurface(p.xz, still, sand) + 0.01;
    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const waterFragment = /* glsl */ `
${COMMON}
${LIGHT}
uniform vec3 uWaterDeep;
uniform vec3 uWaterShallow;
uniform float uTurbidity;
varying vec3 vWorld;

void main() {
    vec2 p = vWorld.xz;
    float still;
    float sand;
    float surface = waterSurface(p, still, sand);
    float depth = surface - sand;
    if (depth <= 0.0) discard;

    float dist = length(cameraPosition - vWorld);
    float e = 0.3;
    float s1;
    float s2;
    float hx = waterSurface(p + vec2(e, 0.0), s1, s2);
    float hz = waterSurface(p + vec2(0.0, e), s1, s2);
    vec3 n = normalize(vec3(surface - hx, e, surface - hz));
    // 细碎的风浪纹理，两层反向流动
    float fine = 1.0 - smoothstep(20.0, 260.0, dist);
    vec2 q = p * 0.8 + vec2(uTime * 0.32, uTime * 0.1);
    vec2 q2 = p * 2.1 + vec2(-uTime * 0.18, uTime * 0.37);
    vec2 ripple = vec2(vnoise(q) - 0.5, vnoise(q + 17.0) - 0.5) + 0.5 * vec2(vnoise(q2) - 0.5, vnoise(q2 + 9.0) - 0.5);
    n = normalize(n + vec3(ripple.x, 0.0, ripple.y) * (0.12 + 0.3 * fine));

    vec3 V = normalize(cameraPosition - vWorld);
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
    vec3 R = reflect(-V, n);
    R.y = abs(R.y);
    float glint = pow(max(dot(n, normalize(uSunDir + V)), 0.0), 420.0) * 70.0;
    float moonGlint = pow(max(dot(n, normalize(uMoonDir + V)), 0.0), 320.0) * 40.0;
    vec3 reflection = skyAt(R) + uSunColor * glint + uMoonColor * moonGlint;

    // 水体：浅处透出沙底（由混合完成），深处是水色
    float T = exp(-depth * uTurbidity);
    vec3 lightIn = (uSunColor * max(uSunDir.y, 0.0) * 0.3 + ambientLight(vec3(0.0, 1.0, 0.0)) + uMoonColor * 0.3) * 1.4;
    vec3 body = mix(uWaterDeep, uWaterShallow, exp(-depth * 0.4)) * lightIn;

    float alpha = 1.0 - T * (1.0 - fres);
    vec3 color = (body * (1.0 - T) * (1.0 - fres) + reflection * fres) / max(alpha, 0.001);

    // 泡沫：上冲前缘 + 沙坝上的碎浪
    float lift = swashLift(p) * shoreFactor(still);
    float front = (1.0 - smoothstep(0.0, 0.07, depth)) * smoothstep(0.01, 0.06, lift);
    float wake = smoothstep(0.02, 0.2, lift) * (1.0 - smoothstep(0.05, 0.25, depth)) * 0.5;
    float crest = swellHeight(p, still) / max(uSwell.x * 0.5, 0.001);
    float swellScale = smoothstep(0.15, 0.45, uSwell.x);
    float breaker = smoothstep(0.28, 0.5, uSwell.x / max(still, 0.1)) * smoothstep(0.2, 0.9, crest) * swellScale;
    float foamTex = fbm2(p * vec2(1.4, 0.8) + vec2(uTime * 0.22, uTime * 0.05));
    float foam = clamp((front * 1.3 + wake + breaker) * smoothstep(0.3, 0.62, foamTex), 0.0, 1.0);
    vec3 foamLit = (uSunColor * max(uSunDir.y, 0.0) * 0.9 + ambientLight(vec3(0.0, 1.0, 0.0)) + uMoonColor * 0.6) * 0.9;
    color = mix(color, foamLit, foam);
    alpha = max(alpha, foam);
    alpha *= smoothstep(0.0, 0.02, depth);

    gl_FragColor = vec4(applyFog(color, dist), alpha);
}
`;

// ---------------------------------------------------------------- 天空

export const skyVertex = /* glsl */ `
varying vec3 vDir;

void main() {
    vDir = position;
    vec4 world = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
    gl_Position.z = gl_Position.w;
}
`;

export const skyFragment = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uGlow;
uniform float uNight;
uniform float uMoonPhase;   // 月相角（弧度），0 朔、π 望
varying vec3 vDir;

float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
}

void main() {
    vec3 d = normalize(vDir);
    float y = d.y;
    vec3 color = mix(uSkyHorizon, uSkyZenith, pow(clamp(y, 0.0, 1.0), 0.45));
    if (y < 0.0) color = uSkyHorizon;

    // 太阳：大气辉光 + 圆盘
    float cs = dot(d, uSunDir);
    color += uGlow * pow(max(cs, 0.0), 5.0) * pow(1.0 - clamp(y, 0.0, 1.0), 3.0);
    color += uSunColor * pow(max(cs, 0.0), 300.0) * 0.4;
    color += uSunColor * smoothstep(0.99975, 0.99988, cs) * 18.0;

    // 星空：方向格点上的稀疏亮点
    if (uNight > 0.01 && y > 0.0) {
        vec3 g = d * 220.0;
        vec3 cell = floor(g);
        float r = hash13(cell);
        float star = step(0.9962, r) * smoothstep(0.42, 0.0, length(fract(g) - 0.5));
        color += vec3(0.9, 0.93, 1.0) * star * uNight * (0.5 + 2.0 * hash13(cell + 7.0)) * smoothstep(0.0, 0.2, y);
    }

    // 月亮：放大后的圆盘，按月相画出明暗交界
    float cm = dot(d, uMoonDir);
    float radius = 0.012;
    vec3 offset = d - uMoonDir * cm;
    if (cm > 0.0 && length(offset) < radius * 1.2) {
        vec3 axisA = uSunDir - uMoonDir * dot(uSunDir, uMoonDir);
        axisA = length(axisA) > 1e-4 ? normalize(axisA) : vec3(1.0, 0.0, 0.0);
        vec3 axisB = cross(uMoonDir, axisA);
        float a = dot(offset, axisA) / radius;
        float b = dot(offset, axisB) / radius;
        float r2 = a * a + b * b;
        float disc = smoothstep(1.0, 0.9, r2);
        float terminator = cos(uMoonPhase) * sqrt(max(1.0 - b * b, 0.0));
        float lit = smoothstep(terminator - 0.06, terminator + 0.06, a);
        color += vec3(0.95, 0.93, 0.86) * disc * (0.04 + 1.6 * lit) * smoothstep(-0.02, 0.04, uMoonDir.y);
    }
    color += uMoonColor * pow(max(cm, 0.0), 80.0) * 0.6;

    gl_FragColor = vec4(color, 1.0);
}
`;

// ---------------------------------------------------------------- 湿度 / 痕迹场

export const fieldVertex = /* glsl */ `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** 场更新：R 湿度、G 痕迹、B 残留泡沫。规则与 tide/lifecycle.ts 一致 */
export const fieldFragment = /* glsl */ `
${COMMON}
uniform sampler2D uPrev;
uniform float uDtHours;
uniform float uDryHours;
uniform float uEraseHours;
uniform float uWindHours;
uniform float uFoamHours;
uniform float uClearTrace;
varying vec2 vUv;

void main() {
    vec4 prev = texture2D(uPrev, vUv);
    vec2 p = uFieldDomain.xy + vUv * uFieldDomain.zw;
    float sand = sandHeight(p);
    float still = uTide - sand;
    float depth = uTide + swashLift(p) * shoreFactor(still) - sand;
    bool covered = depth > 0.0;

    float wet = covered ? 1.0 : prev.r * exp(-uDtHours / uDryHours);
    float trace = prev.g * exp(-uDtHours / (covered ? uEraseHours : uWindHours)) * (1.0 - uClearTrace);
    float foam = covered
        ? (depth < 0.05 ? 1.0 : prev.b * exp(-uDtHours / uFoamHours) * (1.0 - smoothstep(0.1, 0.4, depth)))
        : prev.b * exp(-uDtHours / uFoamHours);
    gl_FragColor = vec4(wet, trace, foam, 1.0);
}
`;

/** 笔触：软圆点，以取大混合写进痕迹通道 */
export const dabVertex = /* glsl */ `
attribute float aSize;
attribute float aStrength;
varying float vStrength;

void main() {
    vStrength = aStrength;
    gl_PointSize = aSize;
    gl_Position = vec4(position.xy * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const dabFragment = /* glsl */ `
varying float vStrength;

void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c) * 2.0;
    if (d > 1.0) discard;
    gl_FragColor = vec4(0.0, vStrength * (1.0 - smoothstep(0.35, 1.0, d)), 0.0, 0.0);
}
`;

/** 文字：把画布上的字形当作凹痕写进痕迹通道 */
export const glyphVertex = /* glsl */ `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = vec4(position.xy * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const glyphFragment = /* glsl */ `
uniform sampler2D uGlyph;
uniform float uStrength;
varying vec2 vUv;

void main() {
    float a = texture2D(uGlyph, vUv).a;
    gl_FragColor = vec4(0.0, a * uStrength, 0.0, 0.0);
}
`;

// ---------------------------------------------------------------- 后期：锁屏颗粒与暗角

export const GrainShader = {
  uniforms: {
    tDiffuse: { value: null },
    uGrain: { value: 0.02 },
    uVignette: { value: 0.16 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uGrain;
    uniform float uVignette;
    varying vec2 vUv;

    // 颗粒锁在屏幕上：逐帧重采样会让平静的水面整片闪烁
    float grain(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * vec3(443.8975, 397.2973, 491.1871));
      p3 += dot(p3, p3.yzx + 19.19);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float edge = 1.0 - smoothstep(0.2, 0.9, distance(vUv, vec2(0.5)));
      c.rgb *= mix(1.0 - uVignette, 1.0, edge);
      c.rgb += (grain(vUv * vec2(1733.0, 1013.0)) - 0.5) * uGrain * (0.4 + c.rgb);
      gl_FragColor = c;
    }
  `,
};
