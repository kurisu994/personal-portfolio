/**
 * Gray-Scott 反应扩散的 CPU 参考实现。
 *
 * 刻意不依赖任何浏览器 API：验收脚本在 Node 里直接跑这份内核，断言数值
 * 稳定性与形态覆盖率；工程版的 WebGL 着色器按同一组公式编写，参数取自
 * presets.ts，两版因此共享同一份「定义」而不是各写一遍。
 *
 * 离散化：九点加权拉普拉斯核（正交 0.2、对角 0.05、中心 −1，权重和为 0）
 * 加显式欧拉，网格间距与时间步均取 1。边界环绕，苔面因此可以无限平铺。
 */

const ORTHO = 0.2;
const DIAGONAL = 0.05;

/** 单步更新的参数。 */
export interface StepParams {
  /** U 的扩散率。 */
  readonly du: number;
  /** V 的扩散率。 */
  readonly dv: number;
  /** 补给率 F。 */
  readonly feed: number;
  /** 移除率 k。 */
  readonly kill: number;
}

export class GrayScottField {
  readonly width: number;
  readonly height: number;

  /** 当前时刻的 U 场。step 后会指向新缓冲，调用方请勿长期持有引用。 */
  u: Float64Array;
  /** 当前时刻的 V 场。同上。 */
  v: Float64Array;

  private backU: Float64Array;
  private backV: Float64Array;

  /** 环绕边界预计算的邻居坐标，避免在热循环里取模。 */
  private readonly left: Int32Array;
  private readonly right: Int32Array;
  private readonly up: Int32Array;
  private readonly down: Int32Array;

  constructor(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 4 || height < 4) {
      throw new Error('反应扩散场的尺寸必须是 ≥ 4 的整数');
    }
    this.width = width;
    this.height = height;

    const size = width * height;
    this.u = new Float64Array(size).fill(1);
    this.v = new Float64Array(size);
    this.backU = new Float64Array(size);
    this.backV = new Float64Array(size);

    this.left = new Int32Array(width);
    this.right = new Int32Array(width);
    for (let x = 0; x < width; x += 1) {
      this.left[x] = x === 0 ? width - 1 : x - 1;
      this.right[x] = x === width - 1 ? 0 : x + 1;
    }
    this.up = new Int32Array(height);
    this.down = new Int32Array(height);
    for (let y = 0; y < height; y += 1) {
      this.up[y] = y === 0 ? height - 1 : y - 1;
      this.down[y] = y === height - 1 ? 0 : y + 1;
    }
  }

  /** 推进一步显式欧拉。 */
  step({ du, dv, feed, kill }: StepParams): void {
    const { width, height, u, v, backU, backV, left, right, up, down } = this;

    for (let y = 0; y < height; y += 1) {
      const row = y * width;
      const rowUp = up[y] * width;
      const rowDown = down[y] * width;

      for (let x = 0; x < width; x += 1) {
        const index = row + x;
        const xl = left[x];
        const xr = right[x];
        const centerU = u[index];
        const centerV = v[index];

        const lapU =
          (u[rowUp + x] + u[rowDown + x] + u[row + xl] + u[row + xr]) * ORTHO +
          (u[rowUp + xl] + u[rowUp + xr] + u[rowDown + xl] + u[rowDown + xr]) * DIAGONAL -
          centerU;

        const lapV =
          (v[rowUp + x] + v[rowDown + x] + v[row + xl] + v[row + xr]) * ORTHO +
          (v[rowUp + xl] + v[rowUp + xr] + v[rowDown + xl] + v[rowDown + xr]) * DIAGONAL -
          centerV;

        const reaction = centerU * centerV * centerV;
        backU[index] = centerU + du * lapU - reaction + feed * (1 - centerU);
        backV[index] = centerV + dv * lapV + reaction - (kill + feed) * centerV;
      }
    }

    // 交换缓冲而不是整体拷贝：整场拷贝会让每步多出一次全量内存写入。
    const swapU = this.u;
    this.u = this.backU;
    this.backU = swapU;
    const swapV = this.v;
    this.v = this.backV;
    this.backV = swapV;
  }

  /** 以环绕距离判定，在 (cx, cy) 处播下一团 V。 */
  seed(cx: number, cy: number, radius: number, amount = 1): void {
    const { width, height, u, v } = this;
    const r = Math.max(1, radius);
    const top = Math.floor(cy - r);
    const bottom = Math.ceil(cy + r);

    for (let y = top; y <= bottom; y += 1) {
      const wrapY = ((y % height) + height) % height;
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x += 1) {
        const wrapX = ((x % width) + width) % width;
        const dx = Math.abs(wrapX - cx);
        const distance = Math.hypot(Math.min(dx, width - dx), wrapY - cy);
        if (distance > r) continue;
        const index = wrapY * width + wrapX;
        // 边缘轻微羽化，播种后不会立刻出现方形硬边。
        const falloff = 1 - Math.min(1, distance / r);
        v[index] = Math.min(1, v[index] + amount * (0.55 + 0.45 * falloff));
        u[index] = 1 - v[index];
      }
    }
  }

  /** 抹掉一小片，用于「擦除」交互。 */
  erase(cx: number, cy: number, radius: number): void {
    const { width, height, u, v } = this;
    const r = Math.max(1, radius);
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y += 1) {
      const wrapY = ((y % height) + height) % height;
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x += 1) {
        const wrapX = ((x % width) + width) % width;
        const index = wrapY * width + wrapX;
        v[index] = 0;
        u[index] = 1;
      }
    }
  }

  /** V 超过阈值的格子比例，用来驱动「饱和 → 重生」的叙事。 */
  coverage(threshold = 0.2): number {
    const { v } = this;
    let count = 0;
    for (let index = 0; index < v.length; index += 1) {
      if (v[index] > threshold) count += 1;
    }
    return count / v.length;
  }

  /** V 的平均值，用来检查插值过程中是否出现突变。 */
  meanV(): number {
    const { v } = this;
    let sum = 0;
    for (let index = 0; index < v.length; index += 1) sum += v[index];
    return sum / v.length;
  }

  /** 整场是否保持有限且落在 [0, 1]，供验收脚本断言。 */
  isSane(tolerance = 1e-9): boolean {
    const { u, v } = this;
    for (let index = 0; index < v.length; index += 1) {
      const cu = u[index];
      const cv = v[index];
      if (!Number.isFinite(cu) || !Number.isFinite(cv)) return false;
      if (cu < -tolerance || cu > 1 + tolerance) return false;
      if (cv < -tolerance || cv > 1 + tolerance) return false;
    }
    return true;
  }
}
