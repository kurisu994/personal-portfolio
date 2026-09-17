/**
 * 苔痕的 WebGL2 引擎。
 *
 * 职责边界：只管「怎么算、怎么画」，不管「什么时候该做什么」——后者属于
 * core/Director.ts。这样叙事逻辑可以在 Node 里被 verify:patina 直接断言，
 * 而不需要浏览器。
 *
 * 两个实现细节值得留意：
 * 1. 模拟场固定为正方形，显示时按画布比例拉伸。反应扩散的图案是有机的，
 *    轻微拉伸肉眼不可察；换来的是窗口缩放与屏幕旋转都不需要重建纹理，
 *    状态因此不会丢。
 * 2. 模拟纹理是 32 位浮点的（RGBA32F）。Du = 1 时 U 的中心系数正好为 0，
 *    16 位浮点撑不住这个边界，会积累出可见的棋盘伪影。
 */

import type { StepParams } from '../core/GrayScott';
import {
  BRUSH_FRAGMENT,
  COVERAGE_FRAGMENT,
  DISPLAY_FRAGMENT,
  FULLSCREEN_VERTEX,
  SHADE_FRAGMENT,
  SIMULATION_FRAGMENT,
} from './shaders';

export interface EngineOptions {
  /** 模拟场边长（正方形）。 */
  readonly simulationSize: number;
}

interface Target {
  readonly framebuffer: WebGLFramebuffer;
  readonly texture: WebGLTexture;
}

/** 色阶停靠点的 float32 打包：rgb + 位置。 */
const STOP_COUNT = 5;

export class PatinaEngine {
  readonly gl: WebGL2RenderingContext;
  readonly simulationSize: number;
  /** 浮点渲染不可用时为 false，此时精度下降，画面会偏硬。 */
  readonly highPrecision: boolean;

  private readonly canvas: HTMLCanvasElement;
  private front: Target;
  private back: Target;
  private readonly shaded: Target;
  private readonly coverageTarget: Target;
  private readonly coveragePixels: Uint8Array;
  private readonly coverageSize = 64;

  private readonly vao: WebGLVertexArrayObject;
  private readonly simulationProgram: WebGLProgram;
  private readonly brushProgram: WebGLProgram;
  private readonly shadeProgram: WebGLProgram;
  private readonly displayProgram: WebGLProgram;
  private readonly coverageProgram: WebGLProgram;

  private readonly simulationUniforms: Readonly<Record<string, WebGLUniformLocation>>;
  private readonly brushUniforms: Readonly<Record<string, WebGLUniformLocation>>;
  private readonly shadeUniforms: Readonly<Record<string, WebGLUniformLocation>>;
  private readonly displayUniforms: Readonly<Record<string, WebGLUniformLocation>>;
  private readonly coverageUniforms: Readonly<Record<string, WebGLUniformLocation>>;

  private readonly stopData: Float32Array;
  private flush = 0;
  private flushRadius = 0;

  constructor(canvas: HTMLCanvasElement, options: EngineOptions) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('这个浏览器没有提供 WebGL2 上下文');

    this.gl = gl;
    this.canvas = canvas;
    this.simulationSize = options.simulationSize;
    this.highPrecision = gl.getExtension('EXT_color_buffer_float') !== null;

    this.simulationProgram = this.createProgram(SIMULATION_FRAGMENT);
    this.brushProgram = this.createProgram(BRUSH_FRAGMENT);
    this.shadeProgram = this.createProgram(SHADE_FRAGMENT);
    this.displayProgram = this.createProgram(DISPLAY_FRAGMENT);
    this.coverageProgram = this.createProgram(COVERAGE_FRAGMENT);

    this.simulationUniforms = this.cacheUniforms(this.simulationProgram, [
      'uState',
      'uTexel',
      'uDu',
      'uDv',
      'uFeed',
      'uKill',
      'uFlush',
      'uFlushRadius',
    ]);
    this.brushUniforms = this.cacheUniforms(this.brushProgram, [
      'uState',
      'uCenter',
      'uAspect',
      'uRadius',
      'uMode',
    ]);
    this.shadeUniforms = this.cacheUniforms(this.shadeProgram, ['uState', 'uTexel', 'uStops[0]']);
    this.displayUniforms = this.cacheUniforms(this.displayProgram, [
      'uShaded',
      'uResolution',
      'uPaper',
      'uVignette',
    ]);
    this.coverageUniforms = this.cacheUniforms(this.coverageProgram, ['uState', 'uThreshold', 'uTexel']);

    const vao = gl.createVertexArray();
    if (!vao) throw new Error('创建顶点数组对象失败');
    this.vao = vao;
    gl.bindVertexArray(vao);

    // 浮点纹理的线性过滤在 WebGL2 里是可选扩展，所以模拟纹理统一用 NEAREST，
    // 放大平滑交给中间那张 8 位纹理。
    const simulationFormat = this.highPrecision ? gl.RGBA32F : gl.RGBA8;
    const size = this.simulationSize;
    this.front = this.createTarget(size, size, simulationFormat, gl.NEAREST, this.highPrecision);
    this.back = this.createTarget(size, size, simulationFormat, gl.NEAREST, this.highPrecision);
    this.shaded = this.createTarget(size, size, gl.RGBA8, gl.LINEAR, false);
    this.coverageTarget = this.createTarget(this.coverageSize, this.coverageSize, gl.RGBA8, gl.NEAREST, false);
    this.coveragePixels = new Uint8Array(this.coverageSize * this.coverageSize * 4);

    this.stopData = new Float32Array(STOP_COUNT * 4);

    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(1, 0, 0, 1);
  }

  /** 全部重置为纸面（U = 1，V = 0）。 */
  reset(): void {
    for (const target of [this.front, this.back]) {
      this.bindTarget(target, this.simulationSize);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    }
  }

  /** 推进若干步模拟。 */
  step(params: StepParams, steps: number): void {
    const gl = this.gl;
    const texel = 1 / this.simulationSize;

    gl.useProgram(this.simulationProgram);
    gl.uniform2f(this.simulationUniforms.uTexel, texel, texel);
    gl.uniform1f(this.simulationUniforms.uDu, params.du);
    gl.uniform1f(this.simulationUniforms.uDv, params.dv);
    gl.uniform1f(this.simulationUniforms.uFeed, params.feed);
    gl.uniform1f(this.simulationUniforms.uKill, params.kill);
    gl.uniform1f(this.simulationUniforms.uFlush, this.flush);
    gl.uniform1f(this.simulationUniforms.uFlushRadius, this.flushRadius);
    gl.uniform1i(this.simulationUniforms.uState, 0);

    for (let index = 0; index < steps; index += 1) {
      this.bindTarget(this.back, this.simulationSize);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.front.texture);
      this.drawFullscreen();
      this.swap();
    }
  }

  /** 设置重生冲刷的强度与前沿半径。 */
  setFlush(amount: number, radius: number): void {
    this.flush = amount;
    this.flushRadius = radius;
  }

  /**
   * 在归一化坐标 (x, y) ∈ [0,1] 处涂抹。
   *
   * 笔刷半径按模拟场的短边计算；因为模拟场是正方形，两个方向一致。
   */
  brush(x: number, y: number, radius: number, mode: 'seed' | 'erase'): void {
    const gl = this.gl;
    gl.useProgram(this.brushProgram);
    gl.uniform2f(this.brushUniforms.uCenter, x, y);
    gl.uniform2f(this.brushUniforms.uAspect, 1, 1);
    gl.uniform1f(this.brushUniforms.uRadius, radius);
    gl.uniform1f(this.brushUniforms.uMode, mode === 'seed' ? 1 : -1);
    gl.uniform1i(this.brushUniforms.uState, 0);

    this.bindTarget(this.back, this.simulationSize);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.front.texture);
    this.drawFullscreen();
    this.swap();
  }

  /** 画一帧。 */
  render(stops: readonly (readonly [number, number, number, number])[], paper: number, vignette: number): void {
    const gl = this.gl;

    for (let index = 0; index < STOP_COUNT; index += 1) {
      const stop = stops[index];
      this.stopData[index * 4 + 0] = stop[0];
      this.stopData[index * 4 + 1] = stop[1];
      this.stopData[index * 4 + 2] = stop[2];
      this.stopData[index * 4 + 3] = stop[3];
    }

    // 第一趟：V 场 → 纸墨色阶 + 墨晕，写进 8 位中间纹理。
    const texel = 1 / this.simulationSize;
    gl.useProgram(this.shadeProgram);
    gl.uniform1i(this.shadeUniforms.uState, 0);
    gl.uniform2f(this.shadeUniforms.uTexel, texel, texel);
    gl.uniform4fv(this.shadeUniforms['uStops[0]'], this.stopData);
    this.bindTarget(this.shaded, this.simulationSize);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.front.texture);
    this.drawFullscreen();

    // 第二趟：纸纹与暗角，按屏幕像素计算，放大后才不会糊。
    gl.useProgram(this.displayProgram);
    gl.uniform1i(this.displayUniforms.uShaded, 0);
    gl.uniform2f(this.displayUniforms.uResolution, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.displayUniforms.uPaper, paper);
    gl.uniform1f(this.displayUniforms.uVignette, vignette);
    this.bindScreen();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shaded.texture);
    this.drawFullscreen();
  }

  /** 读回 V 超过阈值的比例。读的是 64×64 的降采样，开销可以忽略。 */
  readCoverage(threshold = 0.2): number {
    const gl = this.gl;
    const texel = 1 / this.simulationSize;
    gl.useProgram(this.coverageProgram);
    gl.uniform1i(this.coverageUniforms.uState, 0);
    gl.uniform1f(this.coverageUniforms.uThreshold, threshold);
    gl.uniform2f(this.coverageUniforms.uTexel, texel, texel);
    this.bindTarget(this.coverageTarget, this.coverageSize);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.front.texture);
    this.drawFullscreen();
    gl.readPixels(0, 0, this.coverageSize, this.coverageSize, gl.RGBA, gl.UNSIGNED_BYTE, this.coveragePixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    let hits = 0;
    for (let index = 0; index < this.coverageSize * this.coverageSize; index += 1) {
      if (this.coveragePixels[index * 4] > 127) hits += 1;
    }
    return hits / (this.coverageSize * this.coverageSize);
  }

  /** 按显示尺寸调整画布像素，模拟场分辨率不变。 */
  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
  }

  dispose(): void {
    const gl = this.gl;
    for (const target of [this.front, this.back, this.shaded, this.coverageTarget]) {
      gl.deleteFramebuffer(target.framebuffer);
      gl.deleteTexture(target.texture);
    }
    for (const program of [
      this.simulationProgram,
      this.brushProgram,
      this.shadeProgram,
      this.displayProgram,
      this.coverageProgram,
    ]) {
      gl.deleteProgram(program);
    }
    gl.deleteVertexArray(this.vao);
  }

  private swap(): void {
    const previous = this.front;
    this.front = this.back;
    this.back = previous;
  }

  private bindTarget(target: Target, size: number): void {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, target.framebuffer);
    this.gl.viewport(0, 0, size, size);
  }

  private bindScreen(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  private drawFullscreen(): void {
    this.gl.bindVertexArray(this.vao);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }

  private createTarget(width: number, height: number, internalFormat: number, filter: number, float: boolean): Target {
    const gl = this.gl;
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) throw new Error('创建渲染目标失败');

    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (float) {
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, gl.RGBA, gl.FLOAT, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    // 环绕边界与 CPU 内核一致：苔面因此可以无限平铺。
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`渲染目标不完整（0x${status.toString(16)}），可能不支持浮点渲染`);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { framebuffer, texture };
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error('创建着色器失败');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? '未知原因';
      gl.deleteShader(shader);
      throw new Error(`着色器编译失败：${log}`);
    }
    return shader;
  }

  private createProgram(fragmentSource: string): WebGLProgram {
    const gl = this.gl;
    const program = gl.createProgram();
    if (!program) throw new Error('创建着色器程序失败');
    const vertex = this.compileShader(gl.VERTEX_SHADER, FULLSCREEN_VERTEX);
    const fragment = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? '未知原因';
      gl.deleteProgram(program);
      throw new Error(`着色器程序链接失败：${log}`);
    }
    return program;
  }

  private cacheUniforms(program: WebGLProgram, names: readonly string[]): Record<string, WebGLUniformLocation> {
    const gl = this.gl;
    const uniforms: Record<string, WebGLUniformLocation> = {};
    for (const name of names) {
      // uniform 数组要按首元素取位置，这是 WebGL 的规定。
      const location = gl.getUniformLocation(program, name.endsWith(']') ? name : name);
      if (!location) throw new Error(`着色器缺少 uniform：${name}`);
      uniforms[name] = location;
    }
    return uniforms;
  }
}
