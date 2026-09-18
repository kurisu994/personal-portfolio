/**
 * 着色器源码。
 *
 * 全部用 #version 300 es（WebGL2）。模拟与显示分成两趟：
 *   1. 模拟：九点加权拉普拉斯 + 显式欧拉，读写 32 位浮点纹理。
 *   2. 显示：色阶映射与墨晕写进一张 8 位中间纹理，再放大到屏幕并叠纸纹。
 * 这样模拟纹理可以用 NEAREST 过滤（不依赖 OES_texture_float_linear），
 * 放大平滑交给中间的 8 位纹理完成。
 */

/** 全屏三角形，靠 gl_VertexID 生成，不需要顶点缓冲。 */
export const FULLSCREEN_VERTEX = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 position = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = position;
  gl_Position = vec4(position * 2.0 - 1.0, 0.0, 1.0);
}
`;

/**
 * 反应扩散推进一步。
 *
 * 权重与 core/GrayScott.ts 的 CPU 内核逐项对应：正交 0.2、对角 0.05、中心 -1。
 * 改这里必须同步改 CPU 版，否则 verify:patina 断言的就不再是屏幕上跑的东西。
 */
export const SIMULATION_FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform float uDu;
uniform float uDv;
uniform float uFeed;
uniform float uKill;
uniform float uFlush;
uniform float uFlushRadius;

in vec2 vUv;
out vec4 outState;

void main() {
  vec2 center = texture(uState, vUv).xy;

  vec2 orthogonal =
    texture(uState, vUv + vec2(-uTexel.x, 0.0)).xy +
    texture(uState, vUv + vec2( uTexel.x, 0.0)).xy +
    texture(uState, vUv + vec2(0.0, -uTexel.y)).xy +
    texture(uState, vUv + vec2(0.0,  uTexel.y)).xy;

  vec2 diagonal =
    texture(uState, vUv + vec2(-uTexel.x, -uTexel.y)).xy +
    texture(uState, vUv + vec2( uTexel.x, -uTexel.y)).xy +
    texture(uState, vUv + vec2(-uTexel.x,  uTexel.y)).xy +
    texture(uState, vUv + vec2( uTexel.x,  uTexel.y)).xy;

  vec2 laplace = orthogonal * 0.2 + diagonal * 0.05 - center;
  float reaction = center.x * center.y * center.y;

  float u = center.x + (uDu * laplace.x - reaction + uFeed * (1.0 - center.x));
  float v = center.y + (uDv * laplace.y + reaction - (uKill + uFeed) * center.y);

  // 重生：一圈水渍从中心向外洇开，把苔痕洗回纸面。
  if (uFlush > 0.0) {
    float distance = length(vUv - vec2(0.5));
    float front = 1.0 - smoothstep(uFlushRadius - 0.25, uFlushRadius, distance);
    float amount = front * uFlush;
    u = mix(u, 1.0, amount);
    v = mix(v, 0.0, amount);
  }

  outState = vec4(clamp(u, 0.0, 1.0), clamp(v, 0.0, 1.0), 0.0, 1.0);
}
`;

/**
 * 笔刷：播种与擦除。
 *
 * 直接读取旧状态并输出新状态，所以可以渲染到另一张纹理上而无需先拷贝。
 */
export const BRUSH_FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D uState;
uniform vec2 uCenter;
uniform vec2 uAspect;
uniform float uRadius;
uniform float uMode;

in vec2 vUv;
out vec4 outState;

void main() {
  vec2 state = texture(uState, vUv).xy;
  vec2 delta = (vUv - uCenter) * uAspect;
  float distance = length(delta);

  if (distance > uRadius) {
    outState = vec4(state, 0.0, 1.0);
    return;
  }

  float falloff = 1.0 - smoothstep(uRadius * 0.35, uRadius, distance);

  if (uMode > 0.0) {
    // 播种：把 V 抬到至少 falloff，同时保持 u + v = 1 的关系。
    float v = clamp(max(state.y, falloff), 0.0, 1.0);
    outState = vec4(1.0 - v, v, 0.0, 1.0);
  } else {
    // 擦除：抹回纸面。
    outState = vec4(1.0, 0.0, 0.0, 1.0);
  }
}
`;

/**
 * 第一趟显示：V 场 → 纸墨色阶 + 边缘墨晕。
 *
 * 墨晕的实现是「往色阶深处取色」而不是乘暗：苔青的边缘会先透出铜锈、
 * 再落到深苔，像旧铜的锈从边缘漫出来。乘暗只会发灰，取色才有浸润感。
 * 飞白：静态白噪声扰动墨晕强度，让苔斑边缘出现不规则的咬合颗粒。
 *
 * 输出 a 通道存墨晕强度，供第二趟使用。
 */
export const SHADE_FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D uState;
uniform vec2 uTexel;
uniform vec4 uStops[6];

in vec2 vUv;
out vec4 outColor;

vec3 shade(float v) {
  float t = clamp(v, 0.0, 1.0);
  vec3 color = uStops[0].rgb;
  for (int index = 1; index < 6; index += 1) {
    float previous = uStops[index - 1].a;
    float current = uStops[index].a;
    float local = clamp((t - previous) / max(current - previous, 1e-5), 0.0, 1.0);
    local = local * local * (3.0 - 2.0 * local);
    color = mix(color, uStops[index].rgb, local);
  }
  return color;
}

float hashNoise(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  float v = texture(uState, vUv).y;
  float left = texture(uState, vUv - vec2(uTexel.x, 0.0)).y;
  float right = texture(uState, vUv + vec2(uTexel.x, 0.0)).y;
  float up = texture(uState, vUv - vec2(0.0, uTexel.y)).y;
  float down = texture(uState, vUv + vec2(0.0, uTexel.y)).y;

  float edge = clamp(length(vec2(right - left, down - up)) * 2.6, 0.0, 1.0);
  // 飞白：按模拟像素取静态白噪声，扰动墨晕的强度。
  float splatter = hashNoise(floor(vUv * 256.0));
  edge = clamp(edge * (0.6 + 0.8 * splatter), 0.0, 1.0);

  outColor = vec4(shade(min(1.0, v + edge * 0.42)), edge);
}
`;

/**
 * 第二趟显示：纸纹、墨晕与暗角。
 *
 * 纸纹按屏幕像素计算而不是按模拟像素，放大后才不会糊成一片。
 * 纸纹只属于纸：用亮度估计纸面遮罩，亮的地方（纸与浅米）满纹，
 * 苔的图案上只留一点点颗粒——全画面叠纹远看像扫描件，不像手作。
 */
export const DISPLAY_FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D uShaded;
uniform vec2 uResolution;
uniform float uPaper;
uniform float uVignette;

in vec2 vUv;
out vec4 fragColor;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

void main() {
  vec4 shaded = texture(uShaded, vUv);
  vec3 color = shaded.rgb;

  // 亮部是纸，暗部是苔。纸面遮罩决定纸纹的归属。
  float luminance = dot(shaded.rgb, vec3(0.2126, 0.7152, 0.0722));
  float paperMask = smoothstep(0.55, 0.8, luminance);

  // 轻压暗保留体积感；墨色的浸润主要已在上游用色阶深取完成。
  color = mix(color, color * 0.86, shaded.a * 0.9);

  vec2 grainUv = vUv * uResolution * 0.5;
  float grain = valueNoise(grainUv) * 0.6 + valueNoise(grainUv * 3.1) * 0.4;
  color *= 1.0 + (grain - 0.5) * uPaper * mix(0.1, 1.0, paperMask);

  // 横向拉长的噪声当作纸的纤维走向；纤维属于纸，图案上减弱。
  float fiber = valueNoise(vec2(vUv.x * uResolution.x * 0.32, vUv.y * uResolution.y * 2.6));
  color *= 1.0 + (fiber - 0.5) * uPaper * mix(0.22, 0.75, paperMask);

  float vignette = 1.0 - uVignette * pow(length(vUv - vec2(0.5)) * 1.35, 2.4);
  fragColor = vec4(color * clamp(vignette, 0.0, 1.0), 1.0);
}
`;

/**
 * 覆盖率归约：把 V 高于阈值的位置写成白色，读回后统计比例。
 *
 * 降采样目标只有 64×64，所以每个纹素做 3×3 超采样，避免与图案自身的
 * 尺度发生混叠——否则覆盖率会在阈值附近剧烈跳动，误触「重生」。
 */
export const COVERAGE_FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D uState;
uniform float uThreshold;
uniform vec2 uTexel;

in vec2 vUv;
out vec4 outColor;

void main() {
  float hits = 0.0;
  for (int y = -1; y <= 1; y += 1) {
    for (int x = -1; x <= 1; x += 1) {
      float v = texture(uState, vUv + vec2(float(x), float(y)) * uTexel).y;
      hits += step(uThreshold, v);
    }
  }
  float ratio = hits / 9.0;
  outColor = vec4(ratio, ratio, ratio, 1.0);
}
`;
