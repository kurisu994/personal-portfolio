import * as THREE from 'three';
import { DRY_HOURS, ERASE_HOURS, FOAM_HOURS, WIND_HOURS } from '../tide/lifecycle';
import { MAX_DABS_PER_FRAME } from './budget';
import { dabFragment, dabVertex, fieldFragment, fieldVertex, glyphFragment, glyphVertex } from './shaders';
import { FIELD_DOMAIN } from './terrain';

type Uniforms = Record<string, THREE.IUniform>;

/**
 * 湿度 / 痕迹 / 泡沫场：一对乒乓渲染目标，每帧按潮位与上冲推进一步，
 * 书写的笔触与文字以取大混合叠进痕迹通道。
 */
export class Fields {
  readonly size: number;
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private current = 0;
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly updateScene = new THREE.Scene();
  private readonly updateMaterial: THREE.ShaderMaterial;
  private readonly stampScene = new THREE.Scene();
  private readonly dabGeometry = new THREE.BufferGeometry();
  private readonly dabPositions = new Float32Array(MAX_DABS_PER_FRAME * 3);
  private readonly dabSizes = new Float32Array(MAX_DABS_PER_FRAME);
  private readonly dabStrengths = new Float32Array(MAX_DABS_PER_FRAME);
  private readonly dabs: THREE.Points;
  private readonly glyphMesh: THREE.Mesh;
  private readonly glyphMaterial: THREE.ShaderMaterial;
  private readonly glyphCanvas = document.createElement('canvas');
  private readonly glyphTexture: THREE.CanvasTexture;
  private pendingDabs = 0;
  private pendingGlyph = false;
  private clearRequested = false;
  private resetRequested = true;

  constructor(shared: Uniforms, size: number) {
    this.size = size;
    const options: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      generateMipmaps: false,
    };
    this.targets = [new THREE.WebGLRenderTarget(size, size, options), new THREE.WebGLRenderTarget(size, size, options)];

    this.updateMaterial = new THREE.ShaderMaterial({
      vertexShader: fieldVertex,
      fragmentShader: fieldFragment,
      uniforms: {
        ...shared,
        uPrev: { value: null },
        uDtHours: { value: 0 },
        uDryHours: { value: DRY_HOURS },
        uEraseHours: { value: ERASE_HOURS },
        uWindHours: { value: WIND_HOURS },
        uFoamHours: { value: FOAM_HOURS },
        uClearTrace: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.updateScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.updateMaterial));

    // 笔触点
    this.dabGeometry.setAttribute('position', new THREE.BufferAttribute(this.dabPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.dabGeometry.setAttribute('aSize', new THREE.BufferAttribute(this.dabSizes, 1).setUsage(THREE.DynamicDrawUsage));
    this.dabGeometry.setAttribute('aStrength', new THREE.BufferAttribute(this.dabStrengths, 1).setUsage(THREE.DynamicDrawUsage));
    const maxBlend = {
      blending: THREE.CustomBlending,
      blendEquation: THREE.MaxEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      depthTest: false,
      depthWrite: false,
    } as const;
    this.dabs = new THREE.Points(this.dabGeometry, new THREE.ShaderMaterial({ vertexShader: dabVertex, fragmentShader: dabFragment, ...maxBlend }));
    this.dabs.frustumCulled = false;
    this.stampScene.add(this.dabs);

    // 文字
    this.glyphCanvas.width = 1024;
    this.glyphCanvas.height = 256;
    this.glyphTexture = new THREE.CanvasTexture(this.glyphCanvas);
    this.glyphMaterial = new THREE.ShaderMaterial({
      vertexShader: glyphVertex,
      fragmentShader: glyphFragment,
      uniforms: { uGlyph: { value: this.glyphTexture }, uStrength: { value: 0.95 } },
      // 四角在场空间里是顺时针，必须双面，否则整块字被当作背面剔除
      side: THREE.DoubleSide,
      ...maxBlend,
    });
    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    quad.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    this.glyphMesh = new THREE.Mesh(quad, this.glyphMaterial);
    this.glyphMesh.frustumCulled = false;
    this.glyphMesh.visible = false;
    this.stampScene.add(this.glyphMesh);
  }

  get texture(): THREE.Texture {
    return this.targets[this.current].texture;
  }

  get texel(): THREE.Vector2 {
    return new THREE.Vector2(1 / this.size, 1 / this.size);
  }

  /** 世界坐标 → 场 UV */
  static toUv(x: number, z: number): [number, number] {
    return [(x - FIELD_DOMAIN.x0) / (FIELD_DOMAIN.x1 - FIELD_DOMAIN.x0), (z - FIELD_DOMAIN.z0) / (FIELD_DOMAIN.z1 - FIELD_DOMAIN.z0)];
  }

  /** 米 → 场像素 */
  private metersToPx(m: number): number {
    return (m / (FIELD_DOMAIN.x1 - FIELD_DOMAIN.x0)) * this.size;
  }

  /** 排入一个笔触点（世界坐标，半径米） */
  addDab(x: number, z: number, radius: number, strength: number): void {
    if (this.pendingDabs >= MAX_DABS_PER_FRAME) return;
    const [u, v] = Fields.toUv(x, z);
    if (u < 0 || u > 1 || v < 0 || v > 1) return;
    const i = this.pendingDabs++;
    this.dabPositions[i * 3] = u;
    this.dabPositions[i * 3 + 1] = v;
    this.dabSizes[i] = Math.max(2, this.metersToPx(radius * 2));
    this.dabStrengths[i] = strength;
  }

  /** 两点之间按半径的一半铺满笔触 */
  addStroke(x0: number, z0: number, x1: number, z1: number, radius: number): void {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const steps = Math.max(1, Math.ceil(len / (radius * 0.45)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.addDab(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, radius, 0.9);
    }
  }

  /**
   * 在沙上写字：字形的「上」指向大海（+x），从岸上看是正的；
   * 行沿岸线（+z）展开，字高 heightM 米，以 (x, z) 为中心。
   */
  stampText(text: string, x: number, z: number, heightM: number): void {
    const ctx = this.glyphCanvas.getContext('2d');
    if (!ctx || !text.trim()) return;
    const fontPx = 180;
    ctx.font = `600 ${fontPx}px "Noto Serif SC Variable", "Songti SC", serif`;
    ctx.clearRect(0, 0, this.glyphCanvas.width, this.glyphCanvas.height);
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(text, this.glyphCanvas.width / 2, this.glyphCanvas.height / 2, this.glyphCanvas.width - 40);
    this.glyphTexture.needsUpdate = true;

    // 画布整幅映射到沙面：宽 = 画布宽 / 字号 × 字高
    const scale = heightM / fontPx;
    const halfAlong = (this.glyphCanvas.width * scale) / 2;
    const halfAcross = (this.glyphCanvas.height * scale) / 2;
    // 四角：uv(0,0) 左下 → 岸侧、左；uv(1,1) 右上 → 海侧、右
    const corners: [number, number][] = [
      [x - halfAcross, z - halfAlong],
      [x - halfAcross, z + halfAlong],
      [x + halfAcross, z + halfAlong],
      [x + halfAcross, z - halfAlong],
    ];
    const pos = this.glyphMesh.geometry.getAttribute('position') as THREE.BufferAttribute;
    corners.forEach(([cx, cz], i) => {
      const [u, v] = Fields.toUv(cx, cz);
      pos.setXYZ(i, u, v, 0);
    });
    pos.needsUpdate = true;
    this.pendingGlyph = true;
  }

  /** 抹平所有痕迹 */
  clearTraces(): void {
    this.clearRequested = true;
  }

  /** 切换海岸时清空全部状态 */
  reset(): void {
    this.resetRequested = true;
    this.pendingDabs = 0;
    this.pendingGlyph = false;
  }

  /**
   * 预热：按过去几小时的潮位粗步长回放，让刚打开或跳转时间后的沙滩
   * 已有该有的湿沙带，而不是只有正被水盖着的那一条。
   */
  warmup(renderer: THREE.WebGLRenderer, levelAt: (hoursAgo: number) => number, hours = 3, steps = 36): void {
    const tide = this.updateMaterial.uniforms.uTide;
    const time = this.updateMaterial.uniforms.uTime;
    const keepTide = tide.value;
    const keepTime = time.value;
    const dt = hours / steps;
    for (let i = steps; i >= 1; i--) {
      tide.value = levelAt(i * dt);
      time.value = keepTime - i * 3.7;
      this.update(renderer, dt);
    }
    tide.value = keepTide;
    time.value = keepTime;
  }

  /** 推进一步：场更新 → 写入笔触与文字 */
  update(renderer: THREE.WebGLRenderer, dtHours: number): void {
    const prevTarget = renderer.getRenderTarget();
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;

    if (this.resetRequested) {
      for (const t of this.targets) {
        renderer.setRenderTarget(t);
        renderer.setClearColor(0x000000, 0);
        renderer.clear(true, false, false);
      }
      this.resetRequested = false;
    }

    const src = this.targets[this.current];
    const dst = this.targets[1 - this.current];
    this.updateMaterial.uniforms.uPrev.value = src.texture;
    this.updateMaterial.uniforms.uDtHours.value = dtHours;
    this.updateMaterial.uniforms.uClearTrace.value = this.clearRequested ? 1 : 0;
    this.clearRequested = false;
    renderer.setRenderTarget(dst);
    renderer.render(this.updateScene, this.camera);
    this.current = 1 - this.current;

    if (this.pendingDabs > 0 || this.pendingGlyph) {
      this.dabGeometry.setDrawRange(0, this.pendingDabs);
      (this.dabGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
      (this.dabGeometry.getAttribute('aSize') as THREE.BufferAttribute).needsUpdate = true;
      (this.dabGeometry.getAttribute('aStrength') as THREE.BufferAttribute).needsUpdate = true;
      this.dabs.visible = this.pendingDabs > 0;
      this.glyphMesh.visible = this.pendingGlyph;
      renderer.render(this.stampScene, this.camera);
      this.pendingDabs = 0;
      this.pendingGlyph = false;
      this.glyphMesh.visible = false;
    }

    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = autoClear;
  }

  /** 读回以 (x, z) 为中心、半径 radius 米范围内各通道的最大值：湿度、痕迹、泡沫（验收脚本用） */
  read(renderer: THREE.WebGLRenderer, x: number, z: number, radius = 0): [number, number, number] {
    const [u, v] = Fields.toUv(x, z);
    const r = Math.ceil(this.metersToPx(radius));
    const clampPx = (n: number) => Math.min(this.size - 1, Math.max(0, n));
    const x0 = clampPx(Math.floor(u * this.size) - r);
    const y0 = clampPx(Math.floor(v * this.size) - r);
    const w = clampPx(Math.floor(u * this.size) + r) - x0 + 1;
    const h = clampPx(Math.floor(v * this.size) + r) - y0 + 1;
    const out = new Uint16Array(w * h * 4);
    renderer.readRenderTargetPixels(this.targets[this.current], x0, y0, w, h, out);
    const max = [0, 0, 0];
    for (let i = 0; i < w * h; i++) {
      for (let c = 0; c < 3; c++) max[c] = Math.max(max[c], THREE.DataUtils.fromHalfFloat(out[i * 4 + c]));
    }
    return [max[0], max[1], max[2]];
  }

  dispose(): void {
    this.targets.forEach((t) => t.dispose());
    this.updateMaterial.dispose();
    this.dabGeometry.dispose();
    (this.dabs.material as THREE.Material).dispose();
    this.glyphMesh.geometry.dispose();
    this.glyphMaterial.dispose();
    this.glyphTexture.dispose();
  }
}
