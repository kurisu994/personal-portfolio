import { ExposureManager, type FBOAttachment } from './exposure';
import { blurFS, compositeFS, glowFS, glowVS, quadVS, starFS, starVS } from './shaders';

/** 合成与取景所需的全部画面参数 */
export interface SceneUniforms {
  view: [number, number, number];
  mode: 0 | 1;
  horizon: number;
  sun: [number, number, number];
  skyglow: number;
  gain: number;
  limitMag: number;
  far: [number, number, number, number];
  near: [number, number, number, number];
  feature: [number, number, number];
}

type Uniforms = Record<string, WebGLUniformLocation | null>;

/** 星点缓冲布局：x, y, alt, mag, bv, padding */
export const STAR_STRIDE = 6;
/** 柔光点缓冲布局：x, y, size, energy, r, g, b */
export const GLOW_STRIDE = 7;

/**
 * WebGL2 星轨渲染管线：
 * 采样累积（加性混合进浮点底片）→ 光晕模糊 → 实时星点 → 全屏合成（天空、剪影、倒影、颗粒）。
 */
export class StarTrailsRenderer {
  private gl: WebGL2RenderingContext;
  private fbo: ExposureManager;
  private starProg: WebGLProgram;
  private glowProg: WebGLProgram;
  private blurProg: WebGLProgram;
  private compProg: WebGLProgram;
  private starU: Uniforms;
  private glowU: Uniforms;
  private blurU: Uniforms;
  private compU: Uniforms;
  private starVAO: WebGLVertexArrayObject;
  private starVBO: WebGLBuffer;
  private glowVAO: WebGLVertexArrayObject;
  private glowVBO: WebGLBuffer;
  private quadVAO: WebGLVertexArrayObject;
  private quadVBO: WebGLBuffer;
  private maxPoint: number;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private bloomDirty = true;
  private view: [number, number, number] = [1, 1, 0];

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.fbo = new ExposureManager(gl);
    this.maxPoint = (gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array)[1] || 64;

    this.starProg = this.createProgram(starVS, starFS);
    this.glowProg = this.createProgram(glowVS, glowFS);
    this.blurProg = this.createProgram(quadVS, blurFS);
    this.compProg = this.createProgram(quadVS, compositeFS);
    this.starU = this.locate(this.starProg, ['u_resolution', 'u_view', 'u_energy', 'u_pointScale', 'u_limitMag', 'u_sunAlt', 'u_head']);
    this.glowU = this.locate(this.glowProg, ['u_resolution', 'u_view', 'u_sizeToPx', 'u_maxPoint']);
    this.blurU = this.locate(this.blurProg, ['u_texture', 'u_direction']);
    this.compU = this.locate(this.compProg, [
      'u_exposure', 'u_bloom', 'u_live', 'u_resolution', 'u_view', 'u_mode', 'u_horizon', 'u_sun',
      'u_skyglow', 'u_gain', 'u_far', 'u_near', 'u_feature', 'u_grainSeed',
    ]);

    // 星点：每颗 6 个 float
    this.starVAO = gl.createVertexArray()!;
    this.starVBO = gl.createBuffer()!;
    gl.bindVertexArray(this.starVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.starVBO);
    gl.bufferData(gl.ARRAY_BUFFER, 1600 * STAR_STRIDE * 4, gl.DYNAMIC_DRAW);
    const s = STAR_STRIDE * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, s, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, s, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, s, 12);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, s, 16);

    // 柔光点：每个 7 个 float
    this.glowVAO = gl.createVertexArray()!;
    this.glowVBO = gl.createBuffer()!;
    gl.bindVertexArray(this.glowVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.glowVBO);
    const g = GLOW_STRIDE * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, g, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, g, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, g, 12);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, g, 16);

    // 全屏四边形
    this.quadVAO = gl.createVertexArray()!;
    this.quadVBO = gl.createBuffer()!;
    gl.bindVertexArray(this.quadVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  private createShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const err = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`着色器编译失败: ${err}`);
    }
    return shader;
  }

  private createProgram(vsSrc: string, fsSrc: string): WebGLProgram {
    const gl = this.gl;
    const vs = this.createShader(gl.VERTEX_SHADER, vsSrc);
    const fs = this.createShader(gl.FRAGMENT_SHADER, fsSrc);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const err = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new Error(`着色器链接失败: ${err}`);
    }
    return prog;
  }

  private locate(prog: WebGLProgram, names: string[]): Uniforms {
    const out: Uniforms = {};
    for (const n of names) out[n] = this.gl.getUniformLocation(prog, n);
    return out;
  }

  public get lowPrecision(): boolean {
    return this.fbo.lowPrecision;
  }

  public get pixelRatio(): number {
    return this.dpr;
  }

  public get drawingWidth(): number {
    return this.width;
  }

  public get drawingHeight(): number {
    return this.height;
  }

  /** 视图单位 → 设备像素（横屏时画面半高为 1 个视图单位） */
  public get pxPerViewUnit(): number {
    return Math.min(this.width, this.height) / 2;
  }

  public resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = width;
    this.canvas.height = height;
    this.fbo.resize(width, height);
    this.bloomDirty = true;
  }

  public setView(view: [number, number, number]): void {
    this.view = view;
  }

  public clearExposure(): void {
    this.fbo.clearExposure();
    this.bloomDirty = true;
  }

  private bindTarget(target: FBOAttachment): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
  }

  /** 开始向底片累积；之后可连续调用多次 drawStars / drawGlow */
  public beginExposure(): void {
    if (!this.fbo.exposure) return;
    this.bindTarget(this.fbo.exposure);
    this.bloomDirty = true;
  }

  /** 开始绘制实时层（每帧清空） */
  public beginLive(): void {
    if (!this.fbo.live) return;
    this.fbo.clear(this.fbo.live);
    this.bindTarget(this.fbo.live);
  }

  public drawStars(buffer: Float32Array, count: number, energy: number, sunAlt: number, limitMag: number, head: boolean): void {
    if (count <= 0) return;
    const gl = this.gl;
    gl.useProgram(this.starProg);
    gl.uniform2f(this.starU.u_resolution, this.width, this.height);
    gl.uniform3fv(this.starU.u_view, this.view);
    gl.uniform1f(this.starU.u_energy, energy);
    gl.uniform1f(this.starU.u_pointScale, this.dpr);
    gl.uniform1f(this.starU.u_limitMag, limitMag);
    gl.uniform1f(this.starU.u_sunAlt, sunAlt);
    gl.uniform1f(this.starU.u_head, head ? 1 : 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.starVBO);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, buffer, 0, count * STAR_STRIDE);
    gl.bindVertexArray(this.starVAO);
    gl.drawArrays(gl.POINTS, 0, count);
  }

  public drawGlow(buffer: Float32Array, count: number): void {
    if (count <= 0) return;
    const gl = this.gl;
    gl.useProgram(this.glowProg);
    gl.uniform2f(this.glowU.u_resolution, this.width, this.height);
    gl.uniform3fv(this.glowU.u_view, this.view);
    gl.uniform1f(this.glowU.u_sizeToPx, this.view[1] * this.pxPerViewUnit);
    gl.uniform1f(this.glowU.u_maxPoint, this.maxPoint);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.glowVBO);
    gl.bufferData(gl.ARRAY_BUFFER, buffer.subarray(0, count * GLOW_STRIDE), gl.STREAM_DRAW);
    gl.bindVertexArray(this.glowVAO);
    gl.drawArrays(gl.POINTS, 0, count);
  }

  public endPass(): void {
    const gl = this.gl;
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private blurBloom(): void {
    const gl = this.gl;
    const { exposure, blurA, blurB } = this.fbo;
    if (!exposure || !blurA || !blurB) return;
    gl.disable(gl.BLEND);
    gl.useProgram(this.blurProg);
    gl.bindVertexArray(this.quadVAO);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.blurU.u_texture, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, blurA.framebuffer);
    gl.viewport(0, 0, blurA.width, blurA.height);
    gl.bindTexture(gl.TEXTURE_2D, exposure.texture);
    gl.uniform2f(this.blurU.u_direction, 1.6 / blurA.width, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindFramebuffer(gl.FRAMEBUFFER, blurB.framebuffer);
    gl.bindTexture(gl.TEXTURE_2D, blurA.texture);
    gl.uniform2f(this.blurU.u_direction, 0, 1.6 / blurB.height);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.bloomDirty = false;
  }

  /** 全屏合成到画布 */
  public composite(scene: SceneUniforms): void {
    const gl = this.gl;
    const { exposure, blurB, live } = this.fbo;
    if (!exposure || !blurB || !live) return;
    if (this.bloomDirty) this.blurBloom();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.compProg);
    const u = this.compU;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, exposure.texture);
    gl.uniform1i(u.u_exposure, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, blurB.texture);
    gl.uniform1i(u.u_bloom, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, live.texture);
    gl.uniform1i(u.u_live, 2);
    gl.uniform2f(u.u_resolution, this.width, this.height);
    gl.uniform3fv(u.u_view, scene.view);
    gl.uniform1i(u.u_mode, scene.mode);
    gl.uniform1f(u.u_horizon, scene.horizon);
    gl.uniform3fv(u.u_sun, scene.sun);
    gl.uniform1f(u.u_skyglow, scene.skyglow);
    gl.uniform1f(u.u_gain, scene.gain);
    gl.uniform4fv(u.u_far, scene.far);
    gl.uniform4fv(u.u_near, scene.near);
    gl.uniform3fv(u.u_feature, scene.feature);
    gl.uniform1f(u.u_grainSeed, 0.37);
    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
  }

  public dispose(): void {
    const gl = this.gl;
    this.fbo.dispose();
    gl.deleteProgram(this.starProg);
    gl.deleteProgram(this.glowProg);
    gl.deleteProgram(this.blurProg);
    gl.deleteProgram(this.compProg);
    gl.deleteVertexArray(this.starVAO);
    gl.deleteVertexArray(this.glowVAO);
    gl.deleteVertexArray(this.quadVAO);
    gl.deleteBuffer(this.starVBO);
    gl.deleteBuffer(this.glowVBO);
    gl.deleteBuffer(this.quadVBO);
  }
}
