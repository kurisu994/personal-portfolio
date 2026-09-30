import { describeNight, resolveNight, type NightInfo } from '../astro/night';
import {
  DEG,
  buildGalacticNodes,
  clamp,
  computeFrame,
  formatClock,
  formatCoordinate,
  gmst,
  projectSky,
  sunGlowAnchor,
  sunHorizontal,
  toHorizontal,
  toView,
  viewToScreen,
  type ProjectionMode,
  type ViewFrame,
} from '../astro/sky';
import { CITIES, type City, type TerrainFeature, type TerrainLayer, type TerrainShape } from '../data/cities';
import { GLOW_STRIDE, STAR_STRIDE, StarTrailsRenderer, type SceneUniforms } from '../gl/renderer';
import { compute_night_window, compute_star_positions, initAstro } from '../wasm/bridge';

/** 画面输入：地点、日期、视场、投影 */
export interface SceneInput {
  cityIndex: number;
  date: string;
  fovDeg: number;
  mode: ProjectionMode;
}

/** 每帧推给界面的状态 */
export interface ExposureSnapshot {
  started: boolean;
  playing: boolean;
  finished: boolean;
  /** 底片正在追赶目标时刻（拖动时间轴或切换参数后重新显影） */
  developing: boolean;
  progress: number;
  developed: number;
  clock: string;
  elapsedMinutes: number;
  rotationDeg: number;
  starsInFrame: number;
  pole: { x: number; y: number; visible: boolean; angle: number; south: boolean };
}

interface EngineCallbacks {
  onSnapshot: (snapshot: ExposureSnapshot) => void;
  onNight: (night: NightInfo) => void;
  onFinish: () => void;
}

/** 采样间隔：天球每次约转 0.03°，保证轨迹连续且亮度与帧率无关 */
const SAMPLE_SECONDS = 7.5;
const SAMPLE_DAYS = SAMPLE_SECONDS / 86400;
const SAMPLE_ENERGY = 0.085;
const HEAD_ENERGY = 0.9;
/** 播放时一帧内直接补齐的采样数上限，超过即进入「显影」按时间预算推进 */
const QUICK_SAMPLES = 24;
const DEVELOP_BUDGET_MS = 10;
const MILKY_EVERY = 4;
const MILKY_ENERGY = 0.00016;
const MILKY_LIVE_ENERGY = 0.0025;
const METEORS_PER_HOUR = 0.5;
const METEOR_STEPS = 140;
const SIDEREAL_DEG_PER_DAY = 360.98564736629;

const SHAPES: Record<TerrainShape, number> = { hills: 0, peaks: 1, mesa: 2, dunes: 3, flat: 4 };
const FEATURES: Record<TerrainFeature, number> = { none: 0, trees: 1, wall: 2, domes: 3, skyline: 4, cone: 5 };

const layerUniform = (l: TerrainLayer): [number, number, number, number] => [SHAPES[l.shape], l.amp, l.freq, l.rough];

/** 整数哈希 → [0, 1)，保证同一链接得到同一张底片（包括流星） */
function hash01(n: number): number {
  let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

const smooth = (edge0: number, edge1: number, x: number): number => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * 一夜长曝光引擎：持有渲染器与 WASM 调用，按固定的天文时间步长把星光累积进底片。
 * 界面只通过 setScene / begin / play / pause / seek 等方法驱动，状态经回调推回。
 */
export class NightExposure {
  private renderer: StarTrailsRenderer;
  private starBuf = new Float32Array(1600 * STAR_STRIDE);
  private headBuf = new Float32Array(1600 * STAR_STRIDE);
  private glowBuf = new Float32Array(160 * GLOW_STRIDE);
  private meteorBuf = new Float32Array(METEOR_STEPS * GLOW_STRIDE);
  private galactic = buildGalacticNodes();
  private scene: SceneInput | null = null;
  private city: City = CITIES[0];
  private night: NightInfo | null = null;
  private frame: ViewFrame | null = null;
  private seed = 0;
  private progress = 0;
  private previewProgress = 0.2;
  private started = false;
  private playing = false;
  private finished = false;
  private speedSec = 60;
  private totalSamples = 1;
  private exposedTo = 0;
  private developing = false;
  private starsInFrame = 0;
  private raf = 0;
  private lastTime = performance.now();
  private lastEmit = 0;
  private cssWidth = 1;
  private cssHeight = 1;
  private disposed = false;

  private constructor(private canvas: HTMLCanvasElement, private callbacks: EngineCallbacks) {
    this.renderer = new StarTrailsRenderer(canvas);
    this.handleResize();
    window.addEventListener('resize', this.handleResize);
    this.raf = requestAnimationFrame(this.tick);
  }

  /** 加载 WASM 内核并创建引擎 */
  public static async create(canvas: HTMLCanvasElement, callbacks: EngineCallbacks): Promise<NightExposure> {
    await initAstro();
    return new NightExposure(canvas, callbacks);
  }

  // ---------------------------------------------------------------- 对外控制

  public setScene(scene: SceneInput): void {
    this.scene = scene;
    this.city = CITIES[scene.cityIndex];
    const win = resolveNight(this.city, scene.date, compute_night_window);
    this.night = describeNight(this.city, win);
    this.totalSamples = Math.max(1, Math.ceil((win.end - win.start) / SAMPLE_DAYS));
    this.seed = hashString(`${this.city.name}-${scene.date}`);
    this.previewProgress = this.findPreviewProgress();
    this.refreshFrame();
    this.renderer.clearExposure();
    this.exposedTo = 0;
    this.callbacks.onNight(this.night);
    this.emit(true);
  }

  public setSpeed(seconds: number): void {
    this.speedSec = seconds;
  }

  /** 从开场进入曝光；分享链接可直接从指定进度显影 */
  public begin(progress = 0): void {
    this.started = true;
    this.progress = clamp(progress, 0, 1);
    this.finished = this.progress >= 1;
    this.playing = !this.finished;
    this.renderer.clearExposure();
    this.exposedTo = 0;
    this.emit(true);
  }

  public play(): void {
    if (this.finished) {
      this.restart();
      return;
    }
    this.playing = true;
    this.emit(true);
  }

  public pause(): void {
    this.playing = false;
    this.emit(true);
  }

  public restart(): void {
    this.progress = 0;
    this.finished = false;
    this.playing = true;
    this.renderer.clearExposure();
    this.exposedTo = 0;
    this.emit(true);
  }

  public seek(progress: number): void {
    this.progress = clamp(progress, 0, 1);
    this.finished = this.progress >= 1;
    if (this.finished) this.playing = false;
    this.emit(true);
  }

  /** 导出当前底片，并在下沿写上观测记录 */
  public exportPlate(): string {
    this.renderFrame();
    const src = this.canvas;
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext('2d');
    if (!ctx || !this.night || !this.scene) return src.toDataURL('image/png');
    ctx.drawImage(src, 0, 0);

    const dpr = this.renderer.pixelRatio;
    const pad = 28 * dpr;
    const city = this.city;
    const jd = this.jdAt(this.progress);
    const minutes = Math.round((jd - this.night.start) * 1440);
    const [y, m, d] = this.scene.date.split('-').map(Number);
    const lines = [
      `${city.name}  ${formatCoordinate(city.lat, 'N', 'S')} ${formatCoordinate(city.lon, 'E', 'W')}`,
      `${y}年${m}月${d}日夜  ${this.night.startLabel} 起曝光 ${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`,
    ];
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(236, 230, 217, 0.82)';
    ctx.font = `500 ${22 * dpr}px "Noto Serif SC Variable", "Songti SC", serif`;
    ctx.fillText('星轨', pad, out.height - pad - 44 * dpr);
    ctx.fillStyle = 'rgba(236, 230, 217, 0.6)';
    ctx.font = `${12 * dpr}px "Noto Serif SC Variable", "Songti SC", serif`;
    lines.forEach((line, i) => ctx.fillText(line, pad, out.height - pad - (22 - i * 20) * dpr));
    return out.toDataURL('image/png');
  }

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.handleResize);
    this.renderer.dispose();
  }

  // ---------------------------------------------------------------- 内部

  private handleResize = (): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.cssWidth = Math.max(1, rect.width);
    this.cssHeight = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.resize(Math.round(this.cssWidth * dpr), Math.round(this.cssHeight * dpr), dpr);
    this.refreshFrame();
    this.exposedTo = 0;
    this.emit(true);
  };

  private refreshFrame(): void {
    if (!this.scene) return;
    this.frame = computeFrame(this.city.lat, this.scene.fovDeg, this.scene.mode, this.cssWidth / this.cssHeight);
    this.renderer.setView([this.frame.mirror, this.frame.scale, this.frame.shift]);
  }

  private jdAt(progress: number): number {
    const n = this.night!;
    return n.start + (n.end - n.start) * progress;
  }

  /** 开场预览停在天色刚好够黑、亮星已现的时刻 */
  private findPreviewProgress(): number {
    const lat = this.city.lat * DEG;
    const lon = this.city.lon * DEG;
    for (let p = 0; p <= 0.5; p += 0.01) {
      if (sunHorizontal(this.jdAt(p), lat, lon).alt / DEG <= -12) return p;
    }
    return 0.5;
  }

  private tick = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    if (!this.night || !this.frame) return;

    if (this.started && this.playing) {
      this.progress += dt / this.speedSec;
      if (this.progress >= 1) {
        this.progress = 1;
        this.playing = false;
        this.finished = true;
        this.callbacks.onFinish();
      }
    }

    const target = this.started ? Math.min(this.totalSamples, Math.floor(this.progress * this.totalSamples)) : 0;
    if (target < this.exposedTo) {
      this.renderer.clearExposure();
      this.exposedTo = 0;
    }
    if (this.exposedTo < target) {
      const quick = target - this.exposedTo <= QUICK_SAMPLES;
      const deadline = performance.now() + DEVELOP_BUDGET_MS;
      this.renderer.beginExposure();
      while (this.exposedTo < target) {
        this.exposeSample(this.exposedTo);
        this.exposedTo++;
        if (!quick && performance.now() > deadline) break;
      }
      this.renderer.endPass();
    }
    const developing = this.exposedTo < target;
    const changed = developing !== this.developing;
    this.developing = developing;

    this.renderFrame();
    this.emit(changed || now - this.lastEmit > 33);
  };

  /** 把第 k 个采样时刻的星光叠进底片 */
  private exposeSample(k: number): void {
    const scene = this.scene!;
    const city = this.city;
    const jd = Math.min(this.night!.start + k * SAMPLE_DAYS, this.night!.end);
    const lat = city.lat * DEG;
    const lon = city.lon * DEG;
    const sunAlt = sunHorizontal(jd, lat, lon).alt / DEG;
    const energy = SAMPLE_ENERGY * (this.renderer.lowPrecision ? 6 : 1);

    const count = compute_star_positions(lat, lon, jd, scene.mode, scene.fovDeg, this.starBuf);
    this.renderer.drawStars(this.starBuf, count, energy, sunAlt, city.limitMag, false);

    if (k % MILKY_EVERY === 0) {
      const n = this.fillGalaxy(jd, sunAlt, MILKY_ENERGY * MILKY_EVERY);
      this.renderer.drawGlow(this.glowBuf, n);
    }

    const meteorChance = (METEORS_PER_HOUR * SAMPLE_SECONDS) / 3600;
    if (sunAlt < -12 && hash01(this.seed + k * 7919) < meteorChance) {
      const n = this.fillMeteor(k);
      this.renderer.drawGlow(this.meteorBuf, n);
    }
  }

  /** 沿银道的一串柔光点，累积后就是被拖成宽带的银河 */
  private fillGalaxy(jd: number, sunAlt: number, energy: number): number {
    const scene = this.scene!;
    const darkness = smooth(-10, -17, sunAlt) * Math.pow(1 - this.city.skyglow, 1.6);
    if (darkness <= 0.001) return 0;
    const lat = this.city.lat * DEG;
    const lon = this.city.lon * DEG;
    const project = (p: { ra: number; dec: number }) => {
      const h = toHorizontal(p.ra, p.dec, jd, lat, lon);
      return h.alt < -0.1 ? null : projectSky(h.alt, h.az, lat, scene.mode, scene.fovDeg, 3.2);
    };
    let n = 0;
    for (const node of this.galactic) {
      const h = toHorizontal(node.center.ra, node.center.dec, jd, lat, lon);
      if (h.alt < -0.05) continue;
      const pc = projectSky(h.alt, h.az, lat, scene.mode, scene.fovDeg, 3.2);
      if (!pc) continue;
      const pu = project(node.upper);
      const pl = project(node.lower);
      const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      const width = pu && pl ? dist(pu, pl) : pu ? 2 * dist(pc, pu) : pl ? 2 * dist(pc, pl) : 0.2;
      const o = n * GLOW_STRIDE;
      const core = clamp((node.weight - 0.3) / 1.1, 0, 1);
      this.glowBuf[o] = pc[0];
      this.glowBuf[o + 1] = pc[1];
      this.glowBuf[o + 2] = Math.min(width * 1.3, 2);
      this.glowBuf[o + 3] = energy * node.weight * darkness * smooth(0, 0.4, h.alt);
      this.glowBuf[o + 4] = 0.74 + 0.16 * core;
      this.glowBuf[o + 5] = 0.78 + 0.06 * core;
      this.glowBuf[o + 6] = 0.92 - 0.12 * core;
      n++;
    }
    return n;
  }

  /** 一颗流星：画面内一道直线，头尾渐隐 */
  private fillMeteor(k: number): number {
    const frame = this.frame!;
    const r = (i: number) => hash01(this.seed + k * 131 + i * 977);
    let cx: number;
    let cy: number;
    if (frame.mode === 1) {
      const a = r(1) * Math.PI * 2;
      const rad = Math.sqrt(r(2)) * 0.8;
      cx = Math.cos(a) * rad;
      cy = Math.sin(a) * rad;
    } else {
      const bottom = Math.max(frame.horizonRaw + 0.3, -1 - frame.shift);
      const top = 0.95 - frame.shift;
      cx = (r(1) * 2 - 1) * 1.3;
      cy = bottom + r(2) * Math.max(top - bottom, 0.1);
    }
    const angle = r(3) * Math.PI * 2;
    const length = 0.16 + 0.26 * r(4);
    const peak = 0.5 + 0.9 * r(5);
    const steps = METEOR_STEPS;
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      const o = i * GLOW_STRIDE;
      this.meteorBuf[o] = cx + Math.cos(angle) * length * (t - 0.5);
      this.meteorBuf[o + 1] = cy + Math.sin(angle) * length * (t - 0.5);
      this.meteorBuf[o + 2] = 0.006;
      this.meteorBuf[o + 3] = peak * Math.pow(Math.sin(Math.PI * t), 1.6) * 0.12;
      this.meteorBuf[o + 4] = 0.82;
      this.meteorBuf[o + 5] = 1;
      this.meteorBuf[o + 6] = 0.88;
    }
    return steps;
  }

  private renderFrame(): void {
    if (!this.night || !this.frame || !this.scene) return;
    const city = this.city;
    const scene = this.scene;
    const frame = this.frame;
    const jd = this.jdAt(this.started ? this.progress : this.previewProgress);
    const lat = city.lat * DEG;
    const lon = city.lon * DEG;
    const sun = sunHorizontal(jd, lat, lon);
    const sunAlt = sun.alt / DEG;

    const count = compute_star_positions(lat, lon, jd, scene.mode, scene.fovDeg, this.headBuf);
    this.starsInFrame = count;
    this.renderer.beginLive();
    this.renderer.drawStars(this.headBuf, count, HEAD_ENERGY, sunAlt, city.limitMag, true);
    const n = this.fillGalaxy(jd, sunAlt, MILKY_LIVE_ENERGY);
    this.renderer.drawGlow(this.glowBuf, n);
    this.renderer.endPass();

    const anchor = sunGlowAnchor(sun, city.lat, scene.fovDeg, frame);
    const uniforms: SceneUniforms = {
      view: [frame.mirror, frame.scale, frame.shift],
      mode: frame.mode,
      horizon: frame.horizon,
      sun: [sunAlt, anchor[0], anchor[1]],
      skyglow: city.skyglow,
      gain: 1,
      limitMag: city.limitMag,
      far: layerUniform(city.terrain.far),
      near: layerUniform(city.terrain.near),
      feature: [FEATURES[city.terrain.feature], city.terrain.water ? 1 : 0, (this.seed % 997) / 10],
    };
    this.renderer.composite(uniforms);
  }

  /** 天极在屏幕上的位置与天球自转角，用于叠加刻度盘 */
  private polePosition(jd: number): ExposureSnapshot['pole'] {
    const frame = this.frame!;
    const south = this.city.lat < 0;
    let raw: [number, number] | null = [0, 0];
    if (frame.mode === 1) {
      const lat = this.city.lat * DEG;
      raw = projectSky(Math.abs(lat), south ? Math.PI : 0, lat, 1, this.scene!.fovDeg);
    }
    const angle = ((gmst(jd) / DEG + this.city.lon) % 360 + 360) % 360;
    if (!raw) return { x: 0, y: 0, visible: false, angle, south };
    const [vx, vy] = toView(raw[0], raw[1], frame);
    const [x, y] = viewToScreen(vx, vy, this.cssWidth, this.cssHeight);
    const aboveHorizon = frame.mode === 1 || vy > frame.horizon + 0.04;
    const visible = aboveHorizon && x > 40 && x < this.cssWidth - 40 && y > 40 && y < this.cssHeight * 0.66;
    return { x, y, visible, angle, south };
  }

  private emit(force: boolean): void {
    if (!force || !this.night || !this.frame) return;
    this.lastEmit = performance.now();
    const progress = this.started ? this.progress : this.previewProgress;
    const jd = this.jdAt(progress);
    const elapsed = this.started ? jd - this.night.start : 0;
    this.callbacks.onSnapshot({
      started: this.started,
      playing: this.playing,
      finished: this.finished,
      developing: this.developing,
      progress,
      developed: this.exposedTo / this.totalSamples,
      clock: formatClock(jd, this.city.tz),
      elapsedMinutes: elapsed * 1440,
      rotationDeg: elapsed * SIDEREAL_DEG_PER_DAY,
      starsInFrame: this.starsInFrame,
      pole: this.polePosition(jd),
    });
  }
}
