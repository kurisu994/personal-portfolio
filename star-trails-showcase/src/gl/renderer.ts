import { ExposureManager } from './exposure';
import {
  starVS,
  starFS,
  blurVS,
  blurFS,
  compositeVS,
  compositeFS,
} from './shaders';

export class StarTrailsRenderer {
  private gl: WebGL2RenderingContext;
  private exposureMgr: ExposureManager;

  // 着色器程序
  private starProg!: WebGLProgram;
  private blurProg!: WebGLProgram;
  private compProg!: WebGLProgram;

  // 顶点对象
  private starVAO!: WebGLVertexArrayObject;
  private starVBO!: WebGLBuffer;
  private quadVAO!: WebGLVertexArrayObject;

  private width = 1;
  private height = 1;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    if (!gl) {
      throw new Error('当前浏览器不支持 WebGL2');
    }
    this.gl = gl;
    this.exposureMgr = new ExposureManager(gl);

    this.initPrograms();
    this.initBuffers();
  }

  private createShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const err = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Shader 编译失败: ${err}`);
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
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const err = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      throw new Error(`Program 链接失败: ${err}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return prog;
  }

  private initPrograms(): void {
    this.starProg = this.createProgram(starVS, starFS);
    this.blurProg = this.createProgram(blurVS, blurFS);
    this.compProg = this.createProgram(compositeVS, compositeFS);
  }

  private initBuffers(): void {
    const gl = this.gl;

    // 1. 星点缓冲区 (动态更新)
    this.starVAO = gl.createVertexArray()!;
    this.starVBO = gl.createBuffer()!;

    gl.bindVertexArray(this.starVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.starVBO);

    const stride = 6 * 4; // 6 个 float (x, y, alt, mag, bv, padding)
    // a_position (x, y)
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    // a_alt
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, stride, 2 * 4);
    // a_mag
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 3 * 4);
    // a_bv
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 4 * 4);

    gl.bindVertexArray(null);

    // 2. 全屏四边形缓冲区
    this.quadVAO = gl.createVertexArray()!;
    const quadVBO = gl.createBuffer()!;
    gl.bindVertexArray(this.quadVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
    // 两个三角形覆盖整个屏幕 [-1, 1]
    const quadVerts = new Float32Array([
      -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  public resize(width: number, height: number, _dpr?: number): void {
    this.width = width;
    this.height = height;
    this.exposureMgr.resize(width, height);
  }

  public clearExposure(): void {
    this.exposureMgr.clearExposure();
  }

  /**
   * 累积绘制当前时刻的恒星点（加性混合累积曝光）
   */
  public accumulateStars(starBuffer: Float32Array, starCount: number): void {
    if (starCount <= 0 || !this.exposureMgr.exposureFBO) return;

    const gl = this.gl;
    const fbo = this.exposureMgr.exposureFBO;

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.framebuffer);
    gl.viewport(0, 0, fbo.width, fbo.height);

    // 启用加性混合
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.disable(gl.DEPTH_TEST);

    gl.useProgram(this.starProg);
    const uRes = gl.getUniformLocation(this.starProg, 'u_resolution');
    gl.uniform2f(uRes, fbo.width, fbo.height);

    // 更新顶点数据
    gl.bindBuffer(gl.ARRAY_BUFFER, this.starVBO);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      starBuffer.subarray(0, starCount * 6),
      gl.DYNAMIC_DRAW
    );

    gl.bindVertexArray(this.starVAO);
    gl.drawArrays(gl.POINTS, 0, starCount);
    gl.bindVertexArray(null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.BLEND);
  }

  /**
   * 运行光晕模糊与全屏合成
   */
  public composite(isStereo: boolean, progress: number): void {
    const gl = this.gl;
    const expFBO = this.exposureMgr.exposureFBO;
    const blurA = this.exposureMgr.blurFBOA;
    const blurB = this.exposureMgr.blurFBOB;
    if (!expFBO || !blurA || !blurB) return;

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    // 1. 光晕降采样模糊 - 横向
    gl.useProgram(this.blurProg);
    gl.bindFramebuffer(gl.FRAMEBUFFER, blurA.framebuffer);
    gl.viewport(0, 0, blurA.width, blurA.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, expFBO.texture);
    gl.uniform1i(gl.getUniformLocation(this.blurProg, 'u_texture'), 0);
    gl.uniform2f(
      gl.getUniformLocation(this.blurProg, 'u_direction'),
      1.8 / blurA.width,
      0.0
    );

    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 2. 光晕模糊 - 纵向
    gl.bindFramebuffer(gl.FRAMEBUFFER, blurB.framebuffer);
    gl.viewport(0, 0, blurB.width, blurB.height);
    gl.bindTexture(gl.TEXTURE_2D, blurA.texture);
    gl.uniform2f(
      gl.getUniformLocation(this.blurProg, 'u_direction'),
      0.0,
      1.8 / blurB.height
    );
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // 3. 全屏最终合成 (绘制到主 Canvas)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);

    gl.useProgram(this.compProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, expFBO.texture);
    gl.uniform1i(gl.getUniformLocation(this.compProg, 'u_exposure'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, blurB.texture);
    gl.uniform1i(gl.getUniformLocation(this.compProg, 'u_bloom'), 1);

    gl.uniform2f(
      gl.getUniformLocation(this.compProg, 'u_resolution'),
      this.width,
      this.height
    );
    gl.uniform1f(
      gl.getUniformLocation(this.compProg, 'u_exposureTime'),
      progress
    );
    gl.uniform1i(
      gl.getUniformLocation(this.compProg, 'u_isStereo'),
      isStereo ? 1 : 0
    );

    gl.bindVertexArray(this.quadVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  public dispose(): void {
    this.exposureMgr.dispose();
    const gl = this.gl;
    gl.deleteProgram(this.starProg);
    gl.deleteProgram(this.blurProg);
    gl.deleteProgram(this.compProg);
    gl.deleteVertexArray(this.starVAO);
    gl.deleteVertexArray(this.quadVAO);
    gl.deleteBuffer(this.starVBO);
  }
}
