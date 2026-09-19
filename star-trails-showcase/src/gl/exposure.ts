export interface FBOAttachment {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

export class ExposureManager {
  private gl: WebGL2RenderingContext;
  public exposureFBO: FBOAttachment | null = null;
  public blurFBOA: FBOAttachment | null = null;
  public blurFBOB: FBOAttachment | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }

  public resize(width: number, height: number): void {
    this.dispose();

    // 1. 累积曝光主 FBO (支持半浮点 RGBA16F 或回退 RGBA8)
    this.exposureFBO = this.createFBO(width, height, true);

    // 2. Bloom 降采样 FBO (宽高的 1/2)
    const bloomW = Math.max(64, Math.floor(width / 2));
    const bloomH = Math.max(64, Math.floor(height / 2));
    this.blurFBOA = this.createFBO(bloomW, bloomH, false);
    this.blurFBOB = this.createFBO(bloomW, bloomH, false);

    this.clearExposure();
  }

  private createFBO(
    width: number,
    height: number,
    preferFloat: boolean
  ): FBOAttachment {
    const gl = this.gl;
    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) throw new Error("无法创建 Framebuffer");

    const texture = gl.createTexture();
    if (!texture) throw new Error("无法创建 Texture");

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    let internalFormat: number = gl.RGBA8;
    let type: number = gl.UNSIGNED_BYTE;

    // 检查 EXT_color_buffer_half_float 或 RGBA16F
    if (preferFloat) {
      const extHalfFloat = gl.getExtension("EXT_color_buffer_half_float");
      if (extHalfFloat) {
        internalFormat = gl.RGBA16F;
        type = gl.HALF_FLOAT;
      }
    }

    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      internalFormat,
      width,
      height,
      0,
      gl.RGBA,
      type,
      null
    );

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0
    );

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);

    return { framebuffer, texture, width, height };
  }

  public clearExposure(): void {
    if (!this.exposureFBO) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.exposureFBO.framebuffer);
    gl.viewport(0, 0, this.exposureFBO.width, this.exposureFBO.height);
    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  public dispose(): void {
    const gl = this.gl;
    const list = [this.exposureFBO, this.blurFBOA, this.blurFBOB];
    for (const item of list) {
      if (item) {
        gl.deleteFramebuffer(item.framebuffer);
        gl.deleteTexture(item.texture);
      }
    }
    this.exposureFBO = null;
    this.blurFBOA = null;
    this.blurFBOB = null;
  }
}
