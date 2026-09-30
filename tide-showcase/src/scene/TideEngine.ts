import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { localParts, moonPosition, sunPosition, toSceneDirection } from '../astro/sky';
import { Surf } from '../audio/Surf';
import { COASTS, type Coast } from '../data/coasts';
import { DEG, findExtrema, moonIllumination, moonPhaseAngle, moonPhaseName, springNeap, tideHeight, tideRate } from '../tide/model';
import { Director, type CameraMode } from './Director';
import { Fields } from './Fields';
import { skyPalette } from './palette';
import { GrainShader, sandFragment, sandVertex, skyFragment, skyVertex, waterFragment, waterVertex } from './shaders';
import { DOMAIN, FIELD_DOMAIN, Terrain } from './terrain';

export type Tool = 'look' | 'pen' | 'text';

export interface TideSnapshot {
  jd: number;
  date: string;
  clock: string;
  /** 潮位：相对平均海面（米） */
  level: number;
  /** 变化率（米 / 小时），正为涨 */
  rate: number;
  next: { kind: 'high' | 'low'; clock: string; minutes: number; level: number } | null;
  moonName: string;
  moonIllum: number;
  tideClass: '大潮' | '中潮' | '小潮';
  daylight: number;
  playing: boolean;
  speed: number;
  camera: CameraMode;
  tool: Tool;
}

interface EngineOptions {
  coastIndex: number;
  jd: number;
  speed: number;
  onSnapshot: (snapshot: TideSnapshot) => void;
  /** 文字落到沙上之后通知界面清空输入框 */
  onTextPlaced?: () => void;
}

interface DebugWindow extends Window {
  __TIDE__?: {
    snapshot: () => TideSnapshot;
    setTime: (jd: number) => void;
    writeText: (text: string, x: number, z: number) => void;
    shoreline: (z: number) => number;
    fieldAt: (x: number, z: number, radius?: number) => [number, number, number];
    setCamera: (mode: CameraMode) => void;
    setPlaying: (playing: boolean) => void;
    setSpeed: (speed: number) => void;
    cameraPose: () => { x: number; y: number; z: number };
    lookFrom: (from: [number, number, number], to: [number, number, number]) => void;
  };
}

/** 稠密中心、稀疏外围的网格：近处细节足够，远处一路铺到地平线 */
function warpedGrid(n: number, cx: number, cz: number, core: number, reach: number): THREE.BufferGeometry {
  const positions = new Float32Array((n + 1) * (n + 1) * 3);
  const warp = (t: number) => core * t + (reach - core) * Math.pow(t, 5);
  let k = 0;
  for (let j = 0; j <= n; j++) {
    const tz = (j / n) * 2 - 1;
    for (let i = 0; i <= n; i++) {
      const tx = (i / n) * 2 - 1;
      positions[k++] = cx + warp(tx);
      positions[k++] = 0;
      positions[k++] = cz + warp(tz);
    }
  }
  const index: number[] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      const b = a + 1;
      const c = a + n + 1;
      const d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(index);
  return g;
}

const COAST_KIND = { beach: 0, mudflat: 1, rocky: 2 } as const;

/**
 * 潮间带引擎：潮汐时钟、日月光照、地形与水面、湿度痕迹场、镜头、音景与书写输入。
 * React 层只负责展示状态和把用户操作转交给这里。
 */
export class TideEngine {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 9000);
  private readonly director: Director;
  private readonly fields: Fields;
  private readonly surf = new Surf();
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly sky: THREE.Mesh;
  private readonly sand: THREE.Mesh;
  private readonly water: THREE.Mesh;
  private readonly onSnapshot: EngineOptions['onSnapshot'];
  private readonly onTextPlaced?: () => void;
  private terrain: Terrain;
  private coast: Coast;
  private jd: number;
  private speed: number;
  private playing = true;
  private time = 0;
  private tool: Tool = 'look';
  private pendingText = '';
  private raf = 0;
  private last = performance.now();
  private lastEmit = 0;
  private disposed = false;
  private drawing: { pointer: number; x: number; z: number } | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly resizeObserver: ResizeObserver;
  private latest: TideSnapshot | null = null;
  /** 打开、换海岸或时间跳转后，下一帧先回放几小时让湿沙带就位 */
  private needsWarmup = true;

  constructor(private readonly canvas: HTMLCanvasElement, options: EngineOptions) {
    this.onSnapshot = options.onSnapshot;
    this.onTextPlaced = options.onTextPlaced;
    this.coast = COASTS[options.coastIndex];
    this.jd = options.jd;
    this.speed = options.speed;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    // 画质档：软件渲染（SwiftShader 等）降到最低，触屏设备取中档
    const gl = this.renderer.getContext();
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = String(debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    const software = /swiftshader|llvmpipe|software|basic render/i.test(gpu);
    const coarse = software || matchMedia('(pointer: coarse)').matches;
    if (software) this.renderer.setPixelRatio(1);
    this.terrain = new Terrain(this.coast);
    this.uniforms = {
      uTerrain: { value: this.terrain.texture },
      uDomain: { value: new THREE.Vector4(DOMAIN.x0, DOMAIN.z0, DOMAIN.x1 - DOMAIN.x0, DOMAIN.z1 - DOMAIN.z0) },
      uField: { value: null },
      uFieldDomain: { value: new THREE.Vector4(FIELD_DOMAIN.x0, FIELD_DOMAIN.z0, FIELD_DOMAIN.x1 - FIELD_DOMAIN.x0, FIELD_DOMAIN.z1 - FIELD_DOMAIN.z0) },
      uFieldTexel: { value: new THREE.Vector2() },
      uTide: { value: 0 },
      uTime: { value: 0 },
      uSwell: { value: new THREE.Vector4() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
      uMoonColor: { value: new THREE.Color() },
      uMoonPhase: { value: 0 },
      uSkyZenith: { value: new THREE.Color() },
      uSkyHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() },
      uGlow: { value: new THREE.Color() },
      uFogColor: { value: new THREE.Color() },
      uFogDensity: { value: 0.0006 },
      uNight: { value: 0 },
      uCoast: { value: 0 },
      uWaterDeep: { value: new THREE.Color() },
      uWaterShallow: { value: new THREE.Color() },
      uTurbidity: { value: 1 },
    };

    this.fields = new Fields(this.uniforms, software ? 512 : coarse ? 1024 : 2048);
    this.uniforms.uFieldTexel.value.copy(this.fields.texel);

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(4000, 48, 24),
      new THREE.ShaderMaterial({ vertexShader: skyVertex, fragmentShader: skyFragment, uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false }),
    );
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;

    this.sand = new THREE.Mesh(
      warpedGrid(software ? 140 : coarse ? 260 : 400, 40, 0, 150, 1600),
      new THREE.ShaderMaterial({ vertexShader: sandVertex, fragmentShader: sandFragment, uniforms: this.uniforms }),
    );
    this.sand.frustumCulled = false;

    this.water = new THREE.Mesh(
      warpedGrid(software ? 120 : coarse ? 220 : 320, 40, 0, 180, 3600),
      new THREE.ShaderMaterial({
        vertexShader: waterVertex,
        fragmentShader: waterFragment,
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.water.frustumCulled = false;
    this.water.renderOrder = 1;
    this.scene.add(this.sky, this.sand, this.water);

    this.composer = new EffectComposer(
      this.renderer,
      new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: coarse ? 0 : 4 }),
    );
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new ShaderPass(GrainShader));
    this.composer.addPass(new OutputPass());

    this.director = new Director(this.camera, canvas);
    this.applyCoast();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);

    (window as DebugWindow).__TIDE__ = {
      snapshot: () => this.latest ?? this.buildSnapshot(),
      setTime: (jd) => this.setTime(jd),
      writeText: (text, x, z) => this.fields.stampText(text, x, z, 1.4),
      shoreline: (z) => this.terrain.shorelineX(this.level(), z),
      fieldAt: (x, z, radius) => this.fields.read(this.renderer, x, z, radius),
      setCamera: (mode) => this.setCameraMode(mode),
      setPlaying: (playing) => this.setPlaying(playing),
      setSpeed: (speed) => this.setSpeed(speed),
      cameraPose: () => ({ x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z }),
      lookFrom: (from, to) => {
        this.director.setHold(true);
        this.camera.position.set(...from);
        this.camera.lookAt(...to);
      },
    };

    this.raf = requestAnimationFrame(this.tick);
  }

  // ------------------------------------------------------------ 对外控制

  setCoast(index: number): void {
    if (COASTS[index] === this.coast) return;
    this.coast = COASTS[index];
    this.terrain.dispose();
    this.terrain = new Terrain(this.coast);
    this.uniforms.uTerrain.value = this.terrain.texture;
    this.applyCoast();
  }

  setTime(jd: number): void {
    const jump = Math.abs(jd - this.jd) > 1 / 24;
    this.jd = jd;
    if (jump) this.needsWarmup = true;
    this.emit();
  }

  setSpeed(speed: number): void {
    this.speed = speed;
    this.emit();
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.emit();
  }

  setCameraMode(mode: CameraMode): void {
    this.director.setMode(mode);
    this.emit();
  }

  /** 切换工具：书写时镜头停住，自由镜头的拖拽让给笔 */
  setTool(tool: Tool): void {
    this.tool = tool;
    this.director.setHold(tool !== 'look');
    this.canvas.style.cursor = tool === 'look' ? '' : 'crosshair';
    this.emit();
  }

  setPendingText(text: string): void {
    this.pendingText = text;
  }

  clearTraces(): void {
    this.fields.clearTraces();
  }

  setSound(on: boolean): Promise<boolean> {
    return this.surf.setEnabled(on);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.director.dispose();
    this.fields.dispose();
    this.terrain.dispose();
    this.surf.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
    this.composer.dispose();
    this.renderer.dispose();
    delete (window as DebugWindow).__TIDE__;
  }

  // ------------------------------------------------------------ 内部

  private level(jd = this.jd): number {
    return tideHeight(this.coast.model, jd, this.coast.lon);
  }

  private applyCoast(): void {
    const c = this.coast;
    this.uniforms.uSwell.value.set(c.swell.height, c.swell.period, c.swell.runup, 5.2 * c.swell.period);
    this.uniforms.uCoast.value = COAST_KIND[c.terrain];
    this.uniforms.uWaterDeep.value.setRGB(...c.water.deep);
    this.uniforms.uWaterShallow.value.setRGB(...c.water.shallow);
    this.uniforms.uTurbidity.value = c.water.turbidity;
    this.fields.reset();
    this.needsWarmup = true;
    this.director.resetForTerrain(this.terrain);
    this.walkFootprints();
    this.director.snap(this.time, this.level(), this.terrain);
  }

  /** 开场时沙上已有一串脚印：有人走向水边，又沿着水边走远 */
  private walkFootprints(): void {
    const z0 = -22;
    const high = this.coast.model.constituents.reduce((s, c) => s + c.amp, 0);
    let x = this.terrain.shorelineX(high * 0.75, z0) - 6;
    let z = z0;
    let heading = 0.35;
    for (let i = 0; i < 64; i++) {
      const target = i < 26 ? 0.25 : 1.35;
      heading += (target - heading) * 0.08 + Math.sin(i * 0.7) * 0.02;
      x += Math.cos(heading) * 0.72;
      z += Math.sin(heading) * 0.72;
      const side = i % 2 === 0 ? 1 : -1;
      const ox = -Math.sin(heading) * 0.11 * side;
      const oz = Math.cos(heading) * 0.11 * side;
      for (const [along, r] of [[-0.09, 0.05], [0.0, 0.055], [0.1, 0.05]] as const) {
        this.fields.addDab(x + ox + Math.cos(heading) * along, z + oz + Math.sin(heading) * along, r, 0.75);
      }
    }
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 0.8 ? 64 : 50;
    this.camera.updateProjectionMatrix();
  }

  private tick = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.tick);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    if (this.playing) this.jd += (dt * this.speed) / 86400;

    const c = this.coast;
    const level = this.level();
    const sun = sunPosition(this.jd, c.lat, c.lon);
    const moon = moonPosition(this.jd, c.lat, c.lon);
    const illum = moonIllumination(this.jd);
    const pal = skyPalette(sun.alt / DEG, moon.alt / DEG, illum);
    const u = this.uniforms;
    u.uTide.value = level;
    u.uTime.value = this.time;
    u.uSunDir.value.set(...toSceneDirection(sun, c.facing));
    u.uMoonDir.value.set(...toSceneDirection(moon, c.facing));
    u.uSunColor.value.copy(pal.sun);
    u.uMoonColor.value.copy(pal.moon);
    u.uMoonPhase.value = moonPhaseAngle(this.jd) * DEG;
    u.uSkyZenith.value.copy(pal.zenith);
    u.uSkyHorizon.value.copy(pal.horizon);
    u.uGround.value.copy(pal.ground);
    u.uGlow.value.copy(pal.glow);
    u.uFogColor.value.copy(pal.horizon);
    u.uNight.value = pal.night;
    this.renderer.toneMappingExposure = pal.exposure;

    // 暂停时潮汐钟停住，但浪照常拍岸，场按真实时间推进
    const dtHours = (dt * (this.playing ? this.speed : 1)) / 3600;
    if (this.needsWarmup) {
      this.fields.warmup(this.renderer, (hoursAgo) => this.level(this.jd - hoursAgo / 24));
      this.needsWarmup = false;
    }
    this.fields.update(this.renderer, dtHours);
    u.uField.value = this.fields.texture;

    this.director.update(dt, this.time, level, this.terrain);
    this.sky.position.copy(this.camera.position);
    this.composer.render(dt);

    // 音景：取镜头正前方那段岸线的涌浪相位
    const camZ = this.camera.position.z;
    const shore = this.terrain.shorelineX(level, camZ);
    const phase = shore / (5.2 * c.swell.period) + this.time / c.swell.period + camZ * 0.011 + 0.35 * Math.sin(camZ * 0.021 + 1.3);
    const amp = c.model.constituents.reduce((s, k) => s + k.amp, 0);
    this.surf.update(
      {
        swellPhase: phase,
        proximity: 1 - Math.min(1, Math.max(0, (shore - this.camera.position.x) / 45)),
        tideNorm: (level + amp) / (2 * amp),
        swellHeight: c.swell.height,
      },
      dt,
    );

    if (now - this.lastEmit > 100) this.emit();
  };

  private buildSnapshot(): TideSnapshot {
    const c = this.coast;
    const local = localParts(this.jd, c.tz);
    const ahead = findExtrema(c.model, c.lon, this.jd, this.jd + 0.6)[0];
    const sun = sunPosition(this.jd, c.lat, c.lon);
    const pal = skyPalette(sun.alt / DEG, -90, 0);
    return {
      jd: this.jd,
      date: local.date,
      clock: local.clock,
      level: this.level(),
      rate: tideRate(c.model, this.jd, c.lon),
      next: ahead
        ? { kind: ahead.kind, clock: localParts(ahead.jd, c.tz).clock, minutes: Math.round((ahead.jd - this.jd) * 1440), level: ahead.height }
        : null,
      moonName: moonPhaseName(this.jd),
      moonIllum: moonIllumination(this.jd),
      tideClass: springNeap(this.jd),
      daylight: pal.daylight,
      playing: this.playing,
      speed: this.speed,
      camera: this.director.mode,
      tool: this.tool,
    };
  }

  private emit(): void {
    this.lastEmit = performance.now();
    this.latest = this.buildSnapshot();
    this.onSnapshot(this.latest);
  }

  // ------------------------------------------------------------ 书写

  private pick(event: PointerEvent): THREE.Vector3 | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.terrain.raycast(this.raycaster.ray.origin, this.raycaster.ray.direction);
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (this.tool === 'look') return;
    const hit = this.pick(event);
    if (!hit) return;
    if (this.tool === 'text') {
      if (this.pendingText.trim()) {
        this.fields.stampText(this.pendingText.trim(), hit.x, hit.z, 1.4);
        this.onTextPlaced?.();
      }
      return;
    }
    this.canvas.setPointerCapture(event.pointerId);
    this.drawing = { pointer: event.pointerId, x: hit.x, z: hit.z };
    this.fields.addDab(hit.x, hit.z, 0.09, 0.9);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.drawing || event.pointerId !== this.drawing.pointer) return;
    const hit = this.pick(event);
    if (!hit) return;
    this.fields.addStroke(this.drawing.x, this.drawing.z, hit.x, hit.z, 0.09);
    this.drawing.x = hit.x;
    this.drawing.z = hit.z;
  };

  private onPointerUp = (event: PointerEvent): void => {
    if (this.drawing?.pointer === event.pointerId) this.drawing = null;
  };

}
