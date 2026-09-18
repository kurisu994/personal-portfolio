import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { Soundscape } from '../audio/Soundscape';
import { CLIMATES, SEGMENT_LENGTH, sampleClimate, type ClimateSample } from './climates';
import { Atmosphere } from './Atmosphere';
import { CAMERA_LIBRARY, Director, type DirectorState } from './Director';
import { Flock, type FlockMetrics } from './Flock';
import { clamp, damp, lerp, riverX, tupleToColor } from './math';
import { World } from './World';

const ROUTE_SPEED = 68;
const START_POSITIONS = CLIMATES.map((_, index) => index * SEGMENT_LENGTH + SEGMENT_LENGTH * 0.5);

const PaperShader = {
  uniforms: {
    tDiffuse: { value: null },
    grain: { value: 0.024 },
    vignette: { value: 0.08 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float grain;
    uniform float vignette;
    varying vec2 vUv;

    /** 纸纹必须锁在屏幕上：这类高频噪声一旦逐帧重采样，整屏会持续闪烁，平静水面最明显。 */
    float paperNoise(vec2 point) {
      vec3 p3 = fract(vec3(point.xyx) * vec3(443.8975, 397.2973, 491.1871));
      p3 += dot(p3, p3.yzx + 19.19);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec4 source = texture2D(tDiffuse, vUv);
      float noise = paperNoise(vUv * vec2(1783.0, 997.0)) - 0.5;
      float edge = 1.0 - smoothstep(0.18, 0.86, distance(vUv, vec2(0.5)));
      source.rgb += noise * grain;
      source.rgb *= mix(1.0 - vignette, 1.0, edge);
      gl_FragColor = source;
    }
  `,
};

export interface EngineSnapshot {
  elapsed: number;
  journey: number;
  routeZ: number;
  traveled: number;
  climate: ClimateSample;
  director: DirectorState;
  flock: FlockMetrics;
  loadedChunks: number;
  fps: number;
  wind: number;
  quality: number;
  audioReady: boolean;
}

export interface MigrationEngineOptions {
  seed?: number;
  startClimate?: number;
  onState?: (snapshot: EngineSnapshot) => void;
}

interface PointerSample {
  x: number;
  y: number;
  time: number;
}

interface DebugWindow extends Window {
  __MIGRATION__?: {
    snapshot: () => EngineSnapshot;
    cameraNames: readonly string[];
  };
}

/** 串联无限世界、鸟群、镜头、声音和输入，并保持 React 层只处理展示状态。 */
export class MigrationEngine {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(42, 1, 1, 7200);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly renderPass: RenderPass;
  private readonly bloomPass: UnrealBloomPass;
  private readonly fxaaPass: ShaderPass;
  private readonly paperPass: ShaderPass;
  private readonly outputPass: OutputPass;
  private readonly world: World;
  private readonly flock: Flock;
  private readonly director: Director;
  private readonly atmosphere: Atmosphere;
  private readonly soundscape = new Soundscape();
  private readonly hemisphere = new THREE.HemisphereLight(0xffffff, 0x8c8f79, 2.1);
  private readonly sun = new THREE.DirectionalLight(0xfff1d7, 2.45);
  private readonly fill = new THREE.DirectionalLight(0xbcd3e3, 0.52);
  private readonly fog = new THREE.FogExp2(0xe8e7df, 0.00033);
  private readonly center = new THREE.Vector3();
  private readonly skyColor = new THREE.Color();
  private readonly horizonColor = new THREE.Color();
  private readonly groundColor = new THREE.Color();
  private readonly accentColor = new THREE.Color();
  private readonly pointerSamples = new Map<number, PointerSample>();
  private readonly isTouch: boolean;
  private readonly seed: number;
  private readonly onState?: (snapshot: EngineSnapshot) => void;
  private readonly resizeObserver: ResizeObserver;

  private frameRequest = 0;
  private previousTime = performance.now();
  private started = false;
  private disposed = false;
  private routeZ = START_POSITIONS[0];
  private routeStart = this.routeZ;
  private journey = 0;
  private elapsed = 0;
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private quality = 1;
  private lastStateAt = -1;
  private latestSnapshot: EngineSnapshot;
  private frameAccumulator = 0;
  private frameCount = 0;
  private fps = 60;
  private performanceWindow = 0;
  private windTargetX = 0;
  private windTargetY = 0;
  private windX = 0;
  private windY = 0;
  private pointerSpeed = 0;
  private windActive = false;
  private draggingPointer: number | null = null;
  private dragX = 0;
  private dragY = 0;
  private pinchDistance = 0;
  private suspended = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    options: MigrationEngineOptions = {},
  ) {
    this.seed = options.seed ?? Math.floor(Math.random() * 0x7fffffff);
    this.onState = options.onState;
    this.isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
    const initialClimate = clamp(Math.round(options.startClimate ?? 0), 0, CLIMATES.length - 1);
    this.routeZ = START_POSITIONS[initialClimate];
    this.routeStart = this.routeZ;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.renderer.shadowMap.enabled = !this.isTouch;
    // three r186 已移除 PCFSoftShadowMap 的软阴影实现：传入它会触发一条警告并
    // 被就地改回 PCFShadowMap，实际效果与这里直接写 PCFShadowMap 完全一致。
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene.fog = this.fog;
    this.scene.add(this.camera, this.hemisphere, this.sun, this.fill);
    this.sun.castShadow = !this.isTouch;
    this.sun.shadow.mapSize.set(1536, 1536);
    this.sun.shadow.camera.left = -1050;
    this.sun.shadow.camera.right = 1050;
    this.sun.shadow.camera.top = 1050;
    this.sun.shadow.camera.bottom = -1050;
    this.sun.shadow.camera.near = 50;
    this.sun.shadow.camera.far = 3200;
    this.sun.shadow.bias = -0.00022;

    this.world = new World(this.seed);
    this.flock = new Flock(this.seed + 17, this.isTouch);
    this.director = new Director(this.camera, this.seed + 31);
    this.director.locatePreview(new THREE.Vector3(riverX(this.routeZ) - 95, 188, this.routeZ));
    this.atmosphere = new Atmosphere(this.seed + 47, this.camera);
    this.scene.add(this.world.group, this.flock.group, this.atmosphere.group);

    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.2, 0.58, 0.74);
    this.fxaaPass = new ShaderPass(FXAAShader);
    this.paperPass = new ShaderPass(PaperShader);
    this.outputPass = new OutputPass();
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.fxaaPass);
    this.composer.addPass(this.outputPass);
    this.composer.addPass(this.paperPass);

    const climate = sampleClimate(riverX(this.routeZ), this.routeZ);
    const director = this.director.state;
    this.latestSnapshot = {
      elapsed: 0,
      journey: 0,
      routeZ: this.routeZ,
      traveled: 0,
      climate,
      director,
      flock: { count: this.flock.count, visible: 0, maxScreenX: 0, finite: true },
      loadedChunks: 0,
      fps: 60,
      wind: 0,
      quality: 1,
      audioReady: false,
    };

    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.frameRequest = requestAnimationFrame(this.tick);
    (window as DebugWindow).__MIGRATION__ = {
      snapshot: () => this.getSnapshot(),
      cameraNames: CAMERA_LIBRARY.map((shot) => shot.name),
    };
  }

  setStartClimate(index: number): void {
    if (this.started) return;
    const safeIndex = clamp(Math.round(index), 0, START_POSITIONS.length - 1);
    this.routeZ = START_POSITIONS[safeIndex];
    this.routeStart = this.routeZ;
    this.journey = 0;
    this.director.reset();
    this.director.locatePreview(new THREE.Vector3(riverX(this.routeZ) - 95, 188, this.routeZ));
  }

  async beginJourney(): Promise<void> {
    if (!this.started) {
      this.started = true;
      this.routeStart = this.routeZ;
      this.journey = 0;
      this.director.reset();
    }
    await this.soundscape.start();
  }

  setAudioEnabled(value: boolean): void {
    this.soundscape.setEnabled(value);
  }

  setAutomaticCamera(value: boolean): void {
    this.director.setAutomatic(value);
  }

  getSnapshot(): EngineSnapshot {
    return this.latestSnapshot;
  }

  private readonly tick = (now: number): void => {
    if (this.disposed) return;
    const rawDelta = Math.max((now - this.previousTime) / 1000, 0.001);
    const delta = Math.min(rawDelta, 0.05);
    this.previousTime = now;
    this.elapsed += delta;
    if (this.started) {
      this.journey += delta;
      this.routeZ += ROUTE_SPEED * delta * (1 + Math.sin(this.elapsed * 0.071) * 0.035);
    }

    this.updatePerformance(rawDelta);
    this.updateWind(delta);
    const centerX = riverX(this.routeZ) - 95;
    this.center.set(centerX, 188, this.routeZ);
    const directorState = this.director.update(delta, this.elapsed, this.journey, this.center, this.started);
    this.flock.update(delta, this.elapsed, this.routeZ, this.windX, this.windY, this.camera, this.width);
    const climate = sampleClimate(centerX, this.routeZ);
    this.world.update(this.routeZ, this.elapsed, climate);
    this.atmosphere.update(this.elapsed, this.routeZ, climate, this.windX);
    this.updateEnvironment(climate, delta);
    this.updateAudio(directorState);

    this.paperPass.uniforms.grain.value = lerp(0.018, 0.03, climate.mist * 0.45 + climate.night * 0.35);
    this.bloomPass.strength = lerp(0.13, 0.37, climate.night) + climate.front * 0.08;
    this.composer.render(delta);

    if (this.elapsed - this.lastStateAt >= 0.12) {
      this.lastStateAt = this.elapsed;
      const flockMetrics = this.flock.metrics(this.camera);
      this.latestSnapshot = {
        elapsed: this.elapsed,
        journey: this.journey,
        routeZ: this.routeZ,
        traveled: Math.max(0, this.routeZ - this.routeStart),
        climate,
        director: directorState,
        flock: flockMetrics,
        loadedChunks: this.world.loadedChunks,
        fps: this.fps,
        wind: Math.hypot(this.windX, this.windY),
        quality: this.quality,
        audioReady: this.soundscape.ready,
      };
      this.onState?.(this.latestSnapshot);
    }
    this.frameRequest = requestAnimationFrame(this.tick);
  };

  private updateEnvironment(climate: ClimateSample, delta: number): void {
    tupleToColor(climate.sky, this.skyColor);
    tupleToColor(climate.horizon, this.horizonColor);
    tupleToColor(climate.ground, this.groundColor);
    tupleToColor(climate.accent, this.accentColor);
    const background = this.skyColor.clone().lerp(this.horizonColor, 0.24 + climate.dusk * 0.13);
    this.scene.background = background;
    this.fog.color.lerp(background, 1 - Math.exp(-delta * 1.8));
    this.fog.density = damp(this.fog.density, 0.0002 + climate.mist * 0.00034 + climate.night * 0.000055, 1.8, delta);

    this.hemisphere.color.set(0xf2f5ee).lerp(new THREE.Color(0x91aecb), climate.night);
    this.hemisphere.groundColor.copy(this.groundColor).multiplyScalar(0.6);
    this.hemisphere.intensity = lerp(1.2, 1.1, climate.night);
    this.sun.color.set(0xffecd3).lerp(new THREE.Color(0xb5d7ff), climate.night);
    this.sun.intensity = lerp(2.1, 1.5, climate.night);
    this.fill.color.set(0xd5e4ec).lerp(new THREE.Color(0x8fbfe8), climate.night);
    this.fill.intensity = lerp(0.32, 0.6, climate.night);

    this.sun.position.set(this.center.x - 840, 1420, this.center.z - 760);
    this.sun.target.position.copy(this.center).setY(0);
    this.fill.position.set(this.center.x + 720, 580, this.center.z + 540);
    this.fill.target.position.copy(this.center).setY(0);
    this.sun.target.updateMatrixWorld();
    this.fill.target.updateMatrixWorld();
  }

  private updateAudio(directorState: DirectorState): void {
    const riverDistance = Math.abs(this.camera.position.x - riverX(this.camera.position.z));
    this.soundscape.update(
      this.camera.position.y,
      riverDistance,
      directorState.distance,
      Math.hypot(this.windX, this.windY),
    );
  }

  private updatePerformance(delta: number): void {
    this.frameAccumulator += delta;
    this.frameCount += 1;
    this.performanceWindow += delta;
    if (this.frameAccumulator >= 1) {
      this.fps = this.frameCount / this.frameAccumulator;
      this.frameAccumulator = 0;
      this.frameCount = 0;
    }
    if (this.performanceWindow < 7 || this.fps >= 43 || this.quality <= 0.58) return;
    this.performanceWindow = 0;
    this.quality = Math.max(0.58, this.quality - 0.18);
    this.resize();
  }

  private updateWind(delta: number): void {
    this.pointerSpeed = damp(this.pointerSpeed, 0, 3.3, delta);
    if (!this.windActive) {
      this.windTargetX = damp(this.windTargetX, 0, 0.72, delta);
      this.windTargetY = damp(this.windTargetY, 0, 0.72, delta);
    }
    const response = this.windActive ? lerp(7.2, 1.45, clamp(this.pointerSpeed / 3.3)) : 0.68;
    this.windX = damp(this.windX, this.windTargetX, response, delta);
    this.windY = damp(this.windY, this.windTargetY, response, delta);
  }

  private updateWindTarget(x: number, y: number, previous?: PointerSample): void {
    const normalizedX = clamp(x / this.width, 0, 1) * 2 - 1;
    const normalizedY = clamp(y / this.height, 0, 1) * 2 - 1;
    const radius = Math.hypot(normalizedX, normalizedY);
    const deadZone = 0.055;
    const gain = radius <= deadZone ? 0 : Math.pow((radius - deadZone) / (1 - deadZone), 1.18) / Math.max(radius, 0.001);
    this.windTargetX = clamp(normalizedX * gain, -1, 1);
    this.windTargetY = clamp(normalizedY * gain, -1, 1);
    if (previous) {
      const elapsed = Math.max((performance.now() - previous.time) / 1000, 0.008);
      this.pointerSpeed = clamp(Math.hypot(x - previous.x, y - previous.y) / Math.max(this.width, this.height) / elapsed, 0, 5);
    }
    this.windActive = true;
  }

  private localPoint(event: PointerEvent): { x: number; y: number } {
    if (event.target === this.canvas && Number.isFinite(event.offsetX)) {
      return { x: event.offsetX, y: event.offsetY };
    }
    const bounds = this.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) / Math.max(bounds.width, 1) * this.width,
      y: (event.clientY - bounds.top) / Math.max(bounds.height, 1) * this.height,
    };
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    const point = this.localPoint(event);
    const sample = { ...point, time: performance.now() };
    this.pointerSamples.set(event.pointerId, sample);
    this.canvas.setPointerCapture(event.pointerId);
    this.updateWindTarget(point.x, point.y);
    if (!this.director.isAutomatic) {
      this.draggingPointer = event.pointerId;
      this.dragX = point.x;
      this.dragY = point.y;
    }
    if (this.pointerSamples.size === 2) this.pinchDistance = this.currentPinchDistance();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const point = this.localPoint(event);
    const previous = this.pointerSamples.get(event.pointerId);
    const shouldTrack = event.pointerType === 'mouse' || previous !== undefined;
    if (!shouldTrack) return;
    this.updateWindTarget(point.x, point.y, previous);
    this.pointerSamples.set(event.pointerId, { ...point, time: performance.now() });

    if (this.pointerSamples.size >= 2) {
      const nextDistance = this.currentPinchDistance();
      if (this.pinchDistance > 0) this.director.pinch(nextDistance / this.pinchDistance, this.elapsed);
      this.pinchDistance = nextDistance;
      return;
    }
    if (this.draggingPointer === event.pointerId) {
      this.director.orbit(point.x - this.dragX, point.y - this.dragY);
      this.dragX = point.x;
      this.dragY = point.y;
    }
  };

  private readonly onPointerEnd = (event: PointerEvent): void => {
    this.pointerSamples.delete(event.pointerId);
    if (this.draggingPointer === event.pointerId) this.draggingPointer = null;
    if (this.pointerSamples.size < 2) this.pinchDistance = 0;
    if (this.pointerSamples.size === 0) this.windActive = false;
    if (this.pointerSamples.size === 1 && !this.director.isAutomatic) {
      const remaining = this.pointerSamples.entries().next().value;
      if (remaining) {
        this.draggingPointer = remaining[0];
        this.dragX = remaining[1].x;
        this.dragY = remaining[1].y;
      }
    }
  };

  private readonly onPointerLeave = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' && this.draggingPointer === null) {
      this.windActive = false;
      this.pointerSamples.delete(event.pointerId);
    }
  };

  private readonly onVisibilityChange = (): void => {
    if (document.hidden) {
      this.suspended = true;
      cancelAnimationFrame(this.frameRequest);
      this.windActive = false;
      void this.soundscape.suspend();
    } else if (this.suspended && !this.disposed) {
      this.suspended = false;
      this.previousTime = performance.now();
      this.frameRequest = requestAnimationFrame(this.tick);
      void this.soundscape.resume();
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.director.zoom(clamp(event.deltaY, -180, 180), this.elapsed);
  };

  private currentPinchDistance(): number {
    const samples = [...this.pointerSamples.values()];
    if (samples.length < 2) return 0;
    return Math.hypot(samples[0].x - samples[1].x, samples[0].y - samples[1].y);
  }

  private bindEvents(): void {
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerEnd);
    this.canvas.addEventListener('pointercancel', this.onPointerEnd);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    this.width = Math.max(1, parent?.clientWidth ?? innerWidth);
    this.height = Math.max(1, parent?.clientHeight ?? innerHeight);
    const cap = this.isTouch ? 1.55 : 2;
    this.pixelRatio = Math.min(devicePixelRatio, cap) * this.quality;
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(this.width, this.height);
    const resolution = this.fxaaPass.material.uniforms.resolution.value as THREE.Vector2;
    resolution.set(1 / (this.width * this.pixelRatio), 1 / (this.height * this.pixelRatio));
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameRequest);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerEnd);
    this.canvas.removeEventListener('pointercancel', this.onPointerEnd);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.world.dispose();
    this.flock.dispose();
    this.atmosphere.dispose();
    this.bloomPass.dispose();
    this.fxaaPass.dispose();
    this.outputPass.dispose();
    this.paperPass.dispose();
    this.sun.shadow.map?.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    void this.soundscape.dispose();
    delete (window as DebugWindow).__MIGRATION__;
  }
}
