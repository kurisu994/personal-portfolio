import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { TreeModel } from './TreeModel';
import { Flock } from './Flock';
import { Atmosphere, createPaperPass, createPaperTexture } from './Atmosphere';
import { Director } from './Director';
import { Lifecycle } from './Lifecycle';
import { sampleClimate, type Climate } from './climates';
import { bezier4, clamp, damp, phase } from './math';
import { Soundscape } from '../audio/Soundscape';

export interface EngineSnapshot {
  progress: number; stage: number; started: boolean; audioEnabled: boolean; audioReady: boolean;
  fps: number; wind: number; ink: string; accent: string; cameraLabel: string; quality: number;
  branches: number; leaves: number; fruits: number; birds: number; landed: number;
}
interface EngineOptions { onState?: (snapshot: EngineSnapshot) => void; onError?: (message: string) => void }
interface PointerSample { x: number; y: number; time: number; id: number | null }
interface AuditWindow extends Window {
  __ARBOR__?: { snapshot: () => Record<string, unknown> };
}

/** 将滚动、风场、镜头、树和声景串联；React 只接收低频的展示快照。 */
export class ArborEngine {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(39, 1, .08, 180);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly outputPass = new OutputPass();
  private readonly fxaa = new ShaderPass(FXAAShader);
  private readonly paperTexture: THREE.Texture;
  private readonly paperPass: ShaderPass;
  private readonly renderPass: RenderPass;
  private readonly tree: TreeModel;
  private readonly flock = new Flock(82019);
  private readonly atmosphere = new Atmosphere(120);
  private readonly director: Director;
  private readonly lifecycle = new Lifecycle();
  private readonly sound = new Soundscape();
  private readonly ambient = new THREE.AmbientLight(0xffead0, 1);
  private readonly sun = new THREE.DirectionalLight(0xfff0d0, 1.4);
  private readonly fog = new THREE.FogExp2(0xd6d8ba, .009);
  private readonly resizeObserver: ResizeObserver;
  private readonly motion = matchMedia('(prefers-reduced-motion: reduce)');
  private readonly pointer: PointerSample = { x: 0, y: 0, time: -1, id: null };
  private readonly projection = new THREE.Vector3();
  private request = 0;
  private startRequest = 0;
  private previousTime = 0;
  private time = 0;
  // 仅保留材质中的自然风，不再把指针速度注入树体形变。
  private readonly windX = 0;
  private readonly windZ = 0;
  private width = 1;
  private height = 1;
  private dpr = 1;
  private quality = 1;
  private qualityClock = 0;
  private frameAverage = 1 / 60;
  private snapshotAt = -1;
  private started = false;
  private disposed = false;
  private contextLost = false;
  private readonly debug: boolean;
  private latest: EngineSnapshot;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly options: EngineOptions = {}) {
    this.debug = new URLSearchParams(location.search).has('debug');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor('#f7f4eb');
    this.renderer.info.autoReset = false;
    this.renderer.debug.onShaderError = (_gl, _program, vertex, fragment) => {
      console.error('一木着色器未能编译', _gl.getShaderInfoLog(vertex), _gl.getShaderInfoLog(fragment));
      this.options.onError?.('画纸暂未展开，请更新浏览器后重试。');
    };
    this.tree = new TreeModel(20260918);
    this.director = new Director(this.camera);
    this.sun.position.set(-12, 22, 14);
    this.scene.fog = this.fog;
    this.scene.add(this.ambient, this.sun, this.tree.group, this.flock.group, this.atmosphere.group);
    this.paperTexture = createPaperTexture(4511);
    this.paperPass = createPaperPass(this.paperTexture);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.outputPass);
    this.composer.addPass(this.fxaa);
    this.composer.addPass(this.paperPass);
    this.latest = {
      progress: 0, stage: 0, started: false, audioEnabled: false, audioReady: false,
      fps: 60, wind: 0, ink: '#f5ebd4', accent: '#d5b57e', cameraLabel: '一粒微观', quality: 1,
      branches: 0, leaves: 0, fruits: 0, birds: 0, landed: 0,
    };
    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(canvas.parentElement ?? canvas);
    this.bindEvents();
    this.resize();
    void document.fonts.ready.then(() => { if (!this.disposed) this.resize(); });
    this.request = requestAnimationFrame(this.tick);
    if (this.debug) (window as AuditWindow).__ARBOR__ = { snapshot: () => ({
      ...this.latest, tree: this.tree.metrics(), flock: this.flock.metrics(),
      particles: this.atmosphere.particleCount, dpr: this.dpr,
      renderer: { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures },
      camera: { position: this.camera.position.toArray(), offset: this.director.offset },
      scroll: { y: scrollY, max: document.documentElement.scrollHeight - innerHeight },
    }) };
  }

  /** 一次手势种下种子；声音失败也不撤回已经开始的画面。 */
  async start(): Promise<void> {
    if (this.disposed) return;
    if (!this.started) {
      this.started = true;
      this.startRequest = requestAnimationFrame(() => {
        if (this.disposed) return;
        this.resize();
        this.lifecycle.start();
      });
    }
    await this.sound.start();
  }

  /** 使用真实音频状态控制按钮，不把未成功 resume 的声音标为已开启。 */
  async setAudioEnabled(enabled: boolean): Promise<void> { if (!this.disposed) await this.sound.setEnabled(enabled); }

  private readonly tick = (now: number): void => {
    if (this.disposed || this.contextLost || document.hidden) return;
    const raw = this.previousTime ? (now - this.previousTime) / 1000 : 1 / 60;
    const dt = clamp(raw, .001, .045);
    this.previousTime = now;
    this.time += dt;
    const reduced = this.motion.matches;
    const ambientTime = reduced ? 0 : this.time;
    const p = this.started ? this.lifecycle.state.progress : 0;
    const climate = sampleClimate(p);
    this.director.update(p, dt, this.time, reduced);
    // 响应式拉远不应把同一棵树额外淹没在雾里，按取景距离校正光学深度。
    const distance = this.camera.position.distanceTo(this.projection.set(0, 8, 0));
    climate.fogDensity *= Math.min(1, 32 / Math.max(1, distance));
    this.ambient.color.copy(climate.ambient); this.ambient.intensity = climate.ambientIntensity;
    this.sun.color.copy(climate.light); this.sun.intensity = climate.lightIntensity;
    this.fog.color.copy(climate.skyBottom); this.fog.density = climate.fogDensity;
    this.tree.update(p, ambientTime, this.windX, this.windZ, climate);
    this.flock.update(p, dt, ambientTime, this.tree.getPerches(ambientTime, this.windX, this.windZ), climate);
    this.atmosphere.update(p, ambientTime, this.windX, this.windZ, climate, this.camera, this.dpr, this.width / this.height);
    this.sound.update(p, Math.hypot(this.windX, this.windZ), this.time);
    this.renderer.info.reset();
    this.composer.render(dt);
    this.frameAverage = damp(this.frameAverage, Math.min(raw, .1), .7, dt);
    this.qualityClock += dt;
    if (this.qualityClock > 4) {
      this.qualityClock = 0;
      if (this.frameAverage > .026 && this.quality > .6) { this.quality = Math.max(.6, this.quality - .12); this.resize(); }
    }
    if (this.time - this.snapshotAt > .12) {
      this.snapshotAt = this.time;
      const tree = this.tree.metrics(), flock = this.flock.metrics();
      const poem = document.querySelector('[data-poem]')?.getBoundingClientRect();
      const header = document.querySelector('[data-header]')?.getBoundingClientRect();
      const footer = document.querySelector('[data-footer]')?.getBoundingClientRect();
      const ink = this.readableInk(climate, poem ? poem.top + poem.height / 2 : this.height * .7);
      document.documentElement.style.setProperty('--header-ink', this.readableInk(climate, header ? header.top + header.height / 2 : 40));
      document.documentElement.style.setProperty('--footer-ink', this.readableInk(climate, footer ? footer.top + footer.height / 2 : this.height - 30));
      this.latest = {
        progress: p, stage: climate.index, started: this.started,
        audioEnabled: this.sound.enabled, audioReady: this.sound.ready,
        fps: Math.round(1 / this.frameAverage), wind: Math.hypot(this.windX, this.windZ),
        ink, accent: `#${climate.accent.getHexString()}`, cameraLabel: this.director.label, quality: this.quality,
        branches: tree.visibleBranches, leaves: tree.visibleLeaves, fruits: tree.visibleFruits,
        birds: flock.visible, landed: flock.landed,
      };
      this.options.onState?.(this.latest);
    }
    this.request = requestAnimationFrame(this.tick);
  };

  /** 在诗所在的天空或土层估计亮度，选择对比度更高的墨色。 */
  private readableInk(C: Climate, y: number): string {
    const horizon = ((1 - this.projection.set(0, 0, 0).project(this.camera).y) * .5 - .85 * (1 - bezier4(phase(this.lifecycle.state.progress, .10, .23)))) * this.height;
    const c = y > horizon ? C.ground.clone().multiplyScalar(.78) : C.skyBottom.clone().lerp(C.skyTop, 1 - y / this.height);
    const l = .2126 * c.r + .7152 * c.g + .0722 * c.b;
    return (.92 + .05) / (l + .05) > (l + .05) / (.017 + .05) ? '#f4ebd8' : '#302f25';
  }

  private readonly resize = (): void => {
    if (this.disposed) return;
    this.width = window.innerWidth; this.height = window.innerHeight;
    this.dpr = Math.min(devicePixelRatio || 1, 2) * this.quality;
    document.documentElement.style.setProperty('--ui', String(clamp(Math.min(this.width / 1440, this.height / 900), .78, 1.75)));
    document.documentElement.style.setProperty('--viewport-height', `${this.height}px`);
    this.renderer.setPixelRatio(this.dpr); this.renderer.setSize(this.width, this.height, false);
    this.composer.setPixelRatio(this.dpr); this.composer.setSize(this.width, this.height);
    this.fxaa.uniforms.resolution.value.set(1 / (this.width * this.dpr), 1 / (this.height * this.dpr));
    this.paperPass.uniforms.resolution.value.set(this.width * this.dpr, this.height * this.dpr);
    this.director.resize(this.width, this.height, this.started);
    this.lifecycle.refresh();
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (!this.started || e.button !== 0) return;
    this.pointer.id = e.pointerId;
    this.pointer.x = e.clientX; this.pointer.y = e.clientY; this.pointer.time = e.timeStamp;
    if (e.pointerType === 'mouse') this.canvas.setPointerCapture(e.pointerId);
  };
  private readonly onPointerMove = (e: PointerEvent): void => {
    if (!this.started || this.pointer.id !== e.pointerId) return;
    const dx = e.clientX - this.pointer.x, dy = e.clientY - this.pointer.y;
    // 按住拖拽只改变观察镜头；普通悬停与移动不影响树、叶、果。
    this.director.drag(dx, e.pointerType === 'mouse' ? dy : 0, this.time, this.motion.matches);
    this.pointer.x = e.clientX; this.pointer.y = e.clientY; this.pointer.time = e.timeStamp;
  };
  private readonly onPointerUp = (e: PointerEvent): void => {
    if (this.pointer.id === e.pointerId) this.pointer.id = null;
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
  };
  private readonly onPointerLeave = (): void => { if (this.pointer.id === null) this.pointer.time = -1; };
  private readonly onVisibility = (): void => {
    this.sound.setSuspended(document.hidden);
    cancelAnimationFrame(this.request);
    this.previousTime = 0;
    if (!document.hidden && !this.disposed && !this.contextLost) this.request = requestAnimationFrame(this.tick);
  };
  private readonly onContextLost = (e: Event): void => {
    e.preventDefault(); this.contextLost = true; cancelAnimationFrame(this.request);
    this.sound.setSuspended(true);
    this.options.onError?.('画面暂时停留在这里。请重新展开画纸，继续这一程。');
  };
  private bindEvents(): void {
    window.addEventListener('resize', this.resize);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
  }

  /** 释放所有 RAF、监听器、GSAP、音频与 GPU 资源，支持 React 严格模式。 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.request); cancelAnimationFrame(this.startRequest);
    this.resizeObserver.disconnect();
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.lifecycle.dispose(); this.sound.dispose(); this.tree.dispose(); this.flock.dispose(); this.atmosphere.dispose();
    this.renderPass.dispose(); this.outputPass.dispose(); this.fxaa.dispose(); this.paperPass.dispose();
    this.paperTexture.dispose(); this.composer.dispose(); this.renderer.dispose(); this.scene.clear();
    if (this.debug) delete (window as AuditWindow).__ARBOR__;
  }
}
