import * as THREE from 'three';
import { gsap } from 'gsap';
import type { Climate } from './climates';
import { WIND_GLSL } from './math';

/** 树的共享着色参数；同一风场与生命进度同时驱动木质部、叶和果。 */
export interface TreeUniforms {
  [name: string]: THREE.IUniform;
  uProgress: THREE.IUniform<number>;
  uTime: THREE.IUniform<number>;
  uWind: THREE.IUniform<THREE.Vector2>;
  uTrunk: THREE.IUniform<THREE.Color>;
  uLeaf: THREE.IUniform<THREE.Color>;
  uAccent: THREE.IUniform<THREE.Color>;
  uLight: THREE.IUniform<THREE.Color>;
  uAmbient: THREE.IUniform<THREE.Color>;
  uLightIntensity: THREE.IUniform<number>;
  uAmbientIntensity: THREE.IUniform<number>;
  uFogDensity: THREE.IUniform<number>;
  uFogColor: THREE.IUniform<THREE.Color>;
  uSproutTip: THREE.IUniform<THREE.Vector3>;
  uSproutOpacity: THREE.IUniform<number>;
  uEase: THREE.IUniform<THREE.DataTexture>;
}

// 深度预通道与乘色通道使用不同片元程序，驱动可能据此重排顶点运算。
// 声明位置跨程序保持一致，避免 EqualDepth 因末位误差漏绘，随风摆产生闪点。
const commonVertex = /* glsl */ `
  invariant gl_Position;
  uniform float uProgress;
  uniform float uTime;
  uniform vec2 uWind;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying float vTone;
  varying float vCoverage;
  varying float vDepth;
  ${WIND_GLSL}
  float life(float birth, float end) {
    return clamp((uProgress - birth) / max(.0001, end - birth), 0., 1.);
  }
  void projectTree(vec3 p, vec3 n) {
    vWorld = (modelMatrix * vec4(p, 1.)).xyz;
    // 所有对象先到世界空间再形变，挂点不会因局部旋转而裂开。
    vec3 worldNormal = normalize(mat3(modelMatrix) * n);
    vec3 warped = bend(vWorld);
    vec3 tangent = abs(worldNormal.y) < .9
      ? normalize(cross(worldNormal, vec3(0., 1., 0.)))
      : normalize(cross(worldNormal, vec3(1., 0., 0.)));
    vec3 bitangent = cross(worldNormal, tangent);
    vNormal = normalize(cross(bend(vWorld + tangent * .02) - warped,
      bend(vWorld + bitangent * .02) - warped));
    vec4 view = viewMatrix * vec4(warped, 1.);
    vDepth = -view.z;
    gl_Position = projectionMatrix * view;
  }
`;

const woodVertex = /* glsl */ `
  ${commonVertex}
  attribute vec3 aCenter;
  attribute vec2 aLife;
  attribute float aAlong;
  attribute float aTone;
  varying float vRemaining;
  varying float vSoil;
  void main() {
    float growth = life(aLife.x, aLife.y);
    vRemaining = growth - aAlong;
    // 生长前缘收束成尖，避免裸露的圆管截面；成熟末梢也保持自然尖端。
    float taper = smoothstep(0., .035, vRemaining);
    float maturity = mix(.10, 1., smoothstep(0., .9, growth));
    float girth = mix(.18, 1., smoothstep(.22, .60, uProgress));
    vec3 p = aCenter + (position - aCenter) * taper * maturity * girth;
    // 镜头离开土中后，根系回到土层之下，不把成熟树画成悬空标本。
    vSoil = p.y - mix(-5., .01, smoothstep(.18, .34, uProgress));
    vUv = uv;
    vTone = aTone;
    vCoverage = step(.00001, growth);
    projectTree(p, normal);
  }
`;

const instanceVertex = /* glsl */ `
  ${commonVertex}
  uniform sampler2D uEase;
  uniform float uKind;
  uniform vec3 uSproutTip;
  uniform float uSproutOpacity;
  attribute float aBirth;
  attribute float aEnd;
  attribute float aTint;
  attribute float aPhase;
  attribute vec3 aAnchor;
  void main() {
    float age = life(aBirth, aEnd);
    // 查表值直接来自 GSAP back.out(1.7)，时间轴由主引擎拥有。
    float grow = texture2D(uEase, vec2((age * 255. + .5) / 256., .5)).r * 1.2;
    vec3 blade = position;
    if (uKind < .5 || uKind > 2.5) {
      // 微小叶面颤动在叶柄处严格为零，不改变枝条的共同风场。
      blade.z += sin(uTime * 1.8 + aPhase + position.y * 2.) * .055 * position.y * position.y;
    }
    vec3 full = (instanceMatrix * vec4(blade, 1.)).xyz;
    vec3 p = mix(aAnchor, full, grow);
    vCoverage = smoothstep(0., .16, age);
    if (uKind > 1.5 && uKind < 2.5) {
      p = aAnchor + (full - aAnchor) * (1. + .07 * sin(uTime * 2.2));
      vCoverage = 1. - smoothstep(.16, .25, uProgress);
    }
    if (uKind > 2.5) {
      p += uSproutTip;
      vCoverage *= uSproutOpacity;
    }
    mat3 basis = mat3(instanceMatrix);
    vec3 n = basis * (normal / vec3(dot(basis[0], basis[0]),
      dot(basis[1], basis[1]), dot(basis[2], basis[2])));
    vUv = uv;
    vTone = aTint;
    projectTree(p, normalize(n));
  }
`;

const pigmentFunctions = /* glsl */ `
  uniform vec3 uTrunk;
  uniform vec3 uLeaf;
  uniform vec3 uAccent;
  uniform vec3 uLight;
  uniform vec3 uAmbient;
  uniform float uLightIntensity;
  uniform float uAmbientIntensity;
  uniform float uFogDensity;
  uniform vec3 uFogColor;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying float vTone;
  varying float vCoverage;
  varying float vDepth;
  float hash3(vec3 p) {
    p = fract(p * .1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float noise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3. - 2. * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x),
      mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x),
      mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float wash(vec3 p) {
    return noise3(p * 2.1) * .57 + noise3(p * 6.3) * .28 + noise3(p * 19.) * .15;
  }
  vec3 illuminate(vec3 pigment, vec3 n, float translucency) {
    vec3 direction = normalize(vec3(-.55, .85, .65));
    float lambert = max(dot(n, direction), 0.);
    float transmitted = max(dot(-n, direction), 0.) * translucency;
    vec3 irradiance = uAmbient * uAmbientIntensity * .58
      + uLight * uLightIntensity * (.2 + .43 * lambert + transmitted);
    return clamp(pigment * irradiance, .025, .98);
  }
  vec3 watercolor(vec3 pigment, float coverage) {
    float fog = 1. - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
    // MultiplyBlending 不靠 alpha 插值；白色才是无颜料，避免透明片变成黑片。
    vec3 stain = mix(vec3(1.), pigment, clamp(coverage, 0., 1.));
    return mix(stain, mix(vec3(1.), uFogColor, .055), min(.85, fog));
  }
`;

const woodFragment = /* glsl */ `
  ${pigmentFunctions}
  varying float vRemaining;
  varying float vSoil;
  void main() {
    if (vRemaining < 0. || vCoverage < .001 || vSoil < 0.) discard;
    vec3 n = normalize(vNormal);
    float paper = wash(vWorld);
    float bark = noise3(vWorld * vec3(14., 1.7, 14.));
    float tide = 1. - smoothstep(.025, .12, abs(paper - .47));
    float rim = pow(1. - abs(dot(n, normalize(cameraPosition - vWorld))), 2.5);
    vec3 base = mix(uTrunk, uAccent, vTone * .23);
    base *= .87 + paper * .31 + bark * .12 - tide * .11 - rim * .29;
    vec3 color = watercolor(illuminate(base, n, 0.), .86 + rim * .105);
    gl_FragColor = vec4(color, 1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const instanceFragment = /* glsl */ `
  ${pigmentFunctions}
  uniform float uKind;
  uniform vec3 uFruit;
  void main() {
    if (vCoverage < .003) discard;
    vec3 n = normalize(vNormal) * (gl_FrontFacing ? 1. : -1.);
    float paper = wash(vWorld + vTone * 13.);
    float tide = 1. - smoothstep(.02, .105, abs(paper - .49));
    vec3 base;
    float coverage;
    if (uKind < .5 || uKind > 2.5) {
      float edge = pow(abs(vUv.x * 2. - 1.), 6.);
      float vein = exp(-abs(vUv.x - .5) * 90.) * sin(vUv.y * 3.14159);
      float cloud = noise3(vWorld * .48 + vec3(2.7, 0., 4.1));
      float inner = 1. - smoothstep(1.2, 7.5, length(vWorld.xz));
      float lower = 1. - smoothstep(8., 17.5, vWorld.y);
      float shade = clamp(inner * .28 + lower * .32 + (1. - cloud) * .4, 0., 1.);
      base = mix(uLeaf * vec3(.79, 1.06, .69), uAccent, .035 + vTone * .12);
      // 大尺度浓淡刻画簇体积，小尺度三维噪声留下纸纹与回流水线。
      base *= (.56 + cloud * .93) * (1.02 + (paper - .5) * .4 - edge * .23 - tide * .15 + vein * .18);
      base = illuminate(base, n, .14);
      coverage = (.77 + shade * .19 + edge * .055 + vTone * .025) * vCoverage;
    } else {
      base = uKind < 1.5 ? uFruit : mix(uTrunk, uAccent, .48);
      base *= .93 + paper * .2 - tide * .09;
      base = illuminate(base, n, .04);
      vec3 halfVector = normalize(normalize(cameraPosition - vWorld) + normalize(vec3(-.55,.85,.65)));
      float highlight = pow(max(dot(n, halfVector), 0.), 28.);
      base = mix(base, vec3(.98, .94, .81), highlight * (uKind > 1.5 ? .17 : .58));
      coverage = .92 * vCoverage;
      if (uKind > 1.5) base *= 1. - exp(-abs(vUv.x - .48) * 75.) * .38;
    }
    vec3 pigment = watercolor(base, coverage);
    if (uKind > 1.5 && uKind < 2.5) pigment = base * .72;
    gl_FragColor = vec4(pigment, 1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** 水彩树材质集合；纹理和材质统一释放，不依赖场景中的占位灯光。 */
export class TreeMaterials {
  readonly uniforms: TreeUniforms;
  readonly wood: THREE.ShaderMaterial;
  readonly woodDepth: THREE.ShaderMaterial;
  readonly leaf: THREE.ShaderMaterial;
  readonly leafDepth: THREE.ShaderMaterial;
  readonly fruit: THREE.ShaderMaterial;
  readonly seed: THREE.ShaderMaterial;
  readonly sprout: THREE.ShaderMaterial;
  private readonly easeTexture: THREE.DataTexture;

  /** 构造静态 GSAP 缓动查找纹理及共用世界风场的着色器。 */
  constructor() {
    const ease = gsap.parseEase('back.out(1.7)');
    const data = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      data[i * 4] = Math.round(ease(i / 255) / 1.2 * 255);
      data[i * 4 + 3] = 255;
    }
    this.easeTexture = new THREE.DataTexture(data, 256, 1, THREE.RGBAFormat);
    this.easeTexture.minFilter = this.easeTexture.magFilter = THREE.LinearFilter;
    this.easeTexture.needsUpdate = true;
    this.uniforms = {
      uProgress: { value: 0 }, uTime: { value: 0 }, uWind: { value: new THREE.Vector2() },
      uTrunk: { value: new THREE.Color() }, uLeaf: { value: new THREE.Color() },
      uAccent: { value: new THREE.Color() }, uLight: { value: new THREE.Color() },
      uAmbient: { value: new THREE.Color() }, uLightIntensity: { value: 1 },
      uAmbientIntensity: { value: 1 }, uFogDensity: { value: 0 },
      uFogColor: { value: new THREE.Color() }, uSproutTip: { value: new THREE.Vector3() },
      uSproutOpacity: { value: 0 }, uEase: { value: this.easeTexture },
    };
    this.woodDepth = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: woodVertex,
      fragmentShader: /* glsl */ `
        varying float vRemaining;
        varying float vCoverage;
        varying float vSoil;
        void main() {
          if (vRemaining < 0. || vCoverage < .001 || vSoil < 0.) discard;
          gl_FragColor = vec4(1.);
        }
      `,
      colorWrite: false, depthWrite: true, side: THREE.FrontSide,
    });
    this.wood = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: woodVertex, fragmentShader: woodFragment,
      blending: THREE.MultiplyBlending, premultipliedAlpha: true,
      depthWrite: false, depthFunc: THREE.EqualDepth,
      side: THREE.FrontSide,
    });
    const instanceMaterial = (kind: number): THREE.ShaderMaterial => new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, uKind: { value: kind }, uFruit: { value: new THREE.Color('#D9534F') } },
      vertexShader: instanceVertex, fragmentShader: instanceFragment,
      blending: THREE.MultiplyBlending, premultipliedAlpha: true, transparent: true,
      depthWrite: false,
      depthFunc: kind === 0 ? THREE.EqualDepth : THREE.LessEqualDepth,
      side: kind === 0 || kind === 3 ? THREE.DoubleSide : THREE.FrontSide,
      forceSinglePass: true,
    });
    this.leaf = instanceMaterial(0);
    // 叶片轮廓先参与整树深度，后面的粗枝不会透过每片叶子形成灰黑骨架。
    this.leafDepth = new THREE.ShaderMaterial({
      uniforms: this.leaf.uniforms, vertexShader: instanceVertex,
      fragmentShader: /* glsl */ `
        varying float vCoverage;
        void main() {
          if (vCoverage < .003) discard;
          gl_FragColor = vec4(1.);
        }
      `,
      colorWrite: false, depthWrite: true, side: THREE.DoubleSide, forceSinglePass: true,
    });
    this.fruit = instanceMaterial(1);
    this.seed = instanceMaterial(2);
    this.seed.blending = THREE.NormalBlending;
    this.sprout = instanceMaterial(3);
  }

  /** 更新真实参与着色的气候光色、光强和指数雾。 */
  update(progress: number, time: number, windX: number, windZ: number, climate: Climate): void {
    const u = this.uniforms;
    u.uProgress.value = progress;
    u.uTime.value = time;
    u.uWind.value.set(windX, windZ);
    u.uTrunk.value.copy(climate.trunk);
    u.uLeaf.value.copy(climate.leaf);
    u.uAccent.value.copy(climate.accent);
    u.uLight.value.copy(climate.light);
    u.uAmbient.value.copy(climate.ambient);
    u.uLightIntensity.value = climate.lightIntensity;
    u.uAmbientIntensity.value = climate.ambientIntensity;
    u.uFogDensity.value = climate.fogDensity;
    u.uFogColor.value.copy(climate.skyBottom);
  }

  /** 释放共享纹理和全部 GPU 材质，各资源只释放一次。 */
  dispose(): void {
    this.easeTexture.dispose();
    for (const material of [this.woodDepth, this.wood, this.leafDepth, this.leaf, this.fruit, this.seed, this.sprout]) {
      material.dispose();
    }
  }
}
