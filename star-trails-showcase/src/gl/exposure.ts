export interface FBOAttachment {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

/** 渲染目标格式：优先 32 位浮点（需可混合），其次半浮点，最后退回 8 位 */
interface TargetFormat {
  internal: number;
  type: number;
}

/**
 * 曝光底片与光晕缓冲管理。
 * - exposure：整夜累积的底片（高动态范围，加性混合）
 * - live：每帧重绘的实时星点
 * - blurA / blurB：半分辨率的光晕模糊
 */
export class ExposureManager {
  private gl: WebGL2RenderingContext;
  private format: TargetFormat;
  public exposure: FBOAttachment | null = null;
  public live: FBOAttachment | null = null;
  public blurA: FBOAttachment | null = null;
  public blurB: FBOAttachment | null = null;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const colorFloat = gl.getExtension('EXT_color_buffer_float');
    const floatBlend = gl.getExtension('EXT_float_blend');
    // 32 位浮点纹理默认不可线性过滤，缺这个扩展时采样会得到全黑
    const floatLinear = gl.getExtension('OES_texture_float_linear');
    const halfFloat = gl.getExtension('EXT_color_buffer_half_float');
    if (colorFloat && floatBlend && floatLinear) {
      this.format = { internal: gl.RGBA32F, type: gl.FLOAT };
    } else if (colorFloat || halfFloat) {
      this.format = { internal: gl.RGBA16F, type: gl.HALF_FLOAT };
    } else {
      this.format = { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE };
    }
  }

  /** 8 位底片装不下细小的逐次累积，需要放大单次能量 */
  public get lowPrecision(): boolean {
    return this.format.internal === this.gl.RGBA8;
  }

  public resize(width: number, height: number): void {
    this.dispose();
    this.exposure = this.createFBO(width, height, this.format);
    this.live = this.createFBO(width, height, this.format);
    const bw = Math.max(64, Math.floor(width / 2));
    const bh = Math.max(64, Math.floor(height / 2));
    const half = this.format.internal === this.gl.RGBA8 ? this.format : { internal: this.gl.RGBA16F, type: this.gl.HALF_FLOAT };
    this.blurA = this.createFBO(bw, bh, half);
    this.blurB = this.createFBO(bw, bh, half);
    this.clear(this.exposure);
    this.clear(this.live);
  }

  private createFBO(width: number, height: number, format: TargetFormat): FBOAttachment {
    const gl = this.gl;
    const framebuffer = gl.createFramebuffer();
    const texture = gl.createTexture();
    if (!framebuffer || !texture) throw new Error('无法创建帧缓冲');

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, format.internal, width, height, 0, gl.RGBA, format.type, null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return { framebuffer, texture, width, height };
  }

  public clear(target: FBOAttachment | null): void {
    if (!target) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, target.width, target.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  public clearExposure(): void {
    this.clear(this.exposure);
  }

  public dispose(): void {
    const gl = this.gl;
    for (const item of [this.exposure, this.live, this.blurA, this.blurB]) {
      if (item) {
        gl.deleteFramebuffer(item.framebuffer);
        gl.deleteTexture(item.texture);
      }
    }
    this.exposure = null;
    this.live = null;
    this.blurA = null;
    this.blurB = null;
  }
}
