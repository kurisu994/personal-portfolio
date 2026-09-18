import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Soundscape } from './audio/Soundscape';
import { Director, type Phase } from './core/Director';
import { COLOR_STOPS } from './core/palette';
import { MORPHS, morphIndexOf, morphStartTime, ROAM_CYCLE, ROAM_DWELL } from './core/presets';
import { SIMULATION_SIZE, resolveTuning } from './core/tuning';
import { POEMS } from './data/poems';
import { PatinaEngine } from './gl/Engine';
import Overlay from './ui/Overlay';

/** 色阶打包成着色器要的 [r, g, b, 位置] 形式。 */
const STOPS = COLOR_STOPS.map((stop) => [stop.color[0], stop.color[1], stop.color[2], stop.at] as const);

const PAPER_STRENGTH = 0.35;
const VIGNETTE_STRENGTH = 0.24;
/** 每隔多少帧读一次覆盖率。读回是同步操作，太频繁会拖慢帧率。 */
const COVERAGE_INTERVAL = 12;
/** 每隔多少帧刷新一次界面文字。 */
const HUD_INTERVAL = 20;
const POEM_INTERVAL = 24_000;

interface HudState {
  phase: Phase;
  morphIndex: number;
  progress: number;
  coverage: number;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<PatinaEngine | null>(null);
  const directorRef = useRef<Director | null>(null);
  const soundRef = useRef<Soundscape | null>(null);

  const pausedRef = useRef(false);
  const speedRef = useRef(1);
  const scribbleRef = useRef({ active: false, erase: false, holdTimer: 0 });

  const [failure, setFailure] = useState<string | null>(null);
  const [lowPrecision, setLowPrecision] = useState(false);
  const [hud, setHud] = useState<HudState>({ phase: 'seeding', morphIndex: 0, progress: 0, coverage: 0 });
  const [soundOn, setSoundOn] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [poemIndex, setPoemIndex] = useState(0);
  const [hintVisible, setHintVisible] = useState(true);
  // 右上角控制簇（与候鸟同款）：诗句显隐、全屏。
  const [poemVisible, setPoemVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  // ── 主循环 ──────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const tuning = resolveTuning();
    let engine: PatinaEngine;
    try {
      engine = new PatinaEngine(canvas, { simulationSize: SIMULATION_SIZE });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : '初始化失败');
      return;
    }

    engineRef.current = engine;
    engine.reset();
    setLowPrecision(!engine.highPrecision);

    const director = new Director(20260917);
    directorRef.current = director;
    const sound = new Soundscape();
    soundRef.current = sound;

    let running = true;
    let coverage = 0;
    let frame = 0;
    let previous = performance.now();
    let lastChime = 0;
    let lastPhase: Phase = 'seeding';
    let dpr = Math.min(window.devicePixelRatio || 1, tuning.maxDpr);
    let slowFrames = 0;
    const runtime = { coverage: 0, morphId: MORPHS[0].id, progress: 0, elapsed: 0 };

    // 验收脚本用的调试接口。不参与业务逻辑，页面本身不读它。
    interface PatinaDebug {
      snapshot: () => Record<string, unknown>;
      restart: () => void;
      sow: (count: number) => void;
      /** 沿漫游路径连续推进到某个形态的停留中段，返回已推进的秒数。 */
      advanceToMorph: (morphId: string) => number;
    }
    const debug: PatinaDebug = {
      snapshot: () => ({
        phase: director.currentPhase,
        morph: runtime.morphId,
        coverage: runtime.coverage,
        progress: runtime.progress,
        simulationSize: engine.simulationSize,
        highPrecision: engine.highPrecision,
        seeds: director.totalSeeds,
        flushes: director.totalFlushes,
      }),
      restart: () => {
        director.restart();
        engine.reset();
        runtime.coverage = 0;
        runtime.elapsed = 0;
      },
      sow: (count) => {
        for (let index = 0; index < count; index += 1) {
          engine.brush(Math.random(), Math.random(), 0.02, 'seed');
        }
      },
      // 必须沿路径连续推进，不能 seek 之后直接换成目标参数：
      // 参数瞬切会让 V 场崩解（实测 maze → coral 瞬切后覆盖率 0.420 → 0.000，
      // 而同样两个形态走 8 秒渐变则是 0.420 → 0.501）。真实运行靠的就是
      // 那段渐变，验收也必须走同一条路。
      advanceToMorph: (morphId) => {
        const target = morphStartTime(morphId) + ROAM_DWELL / 2;
        let guard = 0;
        while (runtime.elapsed < target && guard < 400_000) {
          const step = director.update(1 / 60, runtime.coverage);
          engine.step(step.params, 16);
          // 从 progress 反推已推进的漫游时间，避免多维护一个时钟。
          runtime.elapsed = step.progress * ROAM_CYCLE;
          guard += 1;
        }
        runtime.coverage = engine.readCoverage(0.2);
        return runtime.elapsed;
      },
    };
    (window as unknown as Record<string, unknown>).__PATINA__ = debug;

    const loop = (now: number) => {
      if (!running) return;
      const delta = Math.min(0.1, (now - previous) / 1000);
      previous = now;
      frame += 1;

      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width > 0 && height > 0) engine.resize(width, height, dpr);

      if (!pausedRef.current && width > 0) {
        const step = director.update(delta, coverage);

        for (const action of step.actions) {
          engine.brush(action.x, action.y, action.radius, 'seed');
        }
        engine.setFlush(step.flush, step.flushRadius);
        engine.step(step.params, Math.max(1, Math.round(tuning.stepsPerFrame * speedRef.current)));

        if (step.phase === 'flushing' && lastPhase !== 'flushing') sound.flush();
        lastPhase = step.phase;

        if (frame % COVERAGE_INTERVAL === 0) {
          const next = engine.readCoverage(0.2);
          // 覆盖率明显上升说明有新核形成，配一声点音。
          if (next - coverage > 0.002 && now - lastChime > 420) {
            sound.chime(Math.random(), Math.random());
            lastChime = now;
          }
          coverage = next;
          runtime.coverage = coverage;
          sound.updateDrone(coverage);
        }

        runtime.morphId = step.morph.id;
        runtime.progress = step.progress;
        runtime.elapsed = step.progress * ROAM_CYCLE;

        if (frame % HUD_INTERVAL === 0) {
          setHud({
            phase: step.phase,
            morphIndex: Math.max(0, morphIndexOf(step.morph.id)),
            progress: step.progress,
            coverage,
          });
        }
      }

      engine.render(STOPS, PAPER_STRENGTH, VIGNETTE_STRENGTH);

      // 持续掉帧时降低像素密度，最低到 1 倍。
      if (delta > 0.032) {
        slowFrames += 1;
        if (slowFrames > 150 && dpr > 1) {
          dpr = Math.max(1, dpr - 0.5);
          slowFrames = 0;
        }
      } else if (slowFrames > 0) {
        slowFrames -= 1;
      }

      requestAnimationFrame(loop);
    };

    const handle = requestAnimationFrame(loop);
    return () => {
      running = false;
      cancelAnimationFrame(handle);
      engine.dispose();
      sound.dispose();
      engineRef.current = null;
      soundRef.current = null;
      delete (window as unknown as Record<string, unknown>).__PATINA__;
    };
  }, []);

  // ── 诗 ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const timer = window.setInterval(() => {
      setPoemIndex((index) => (index + 1) % POEMS.length);
    }, POEM_INTERVAL);
    return () => window.clearInterval(timer);
  }, []);

  // ── 滚轮调速度（必须手动绑定才拦得住页面滚动） ──────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handler = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      const next = Math.min(3, Math.max(0.25, speedRef.current * factor));
      speedRef.current = next;
      setSpeed(next);
    };
    canvas.addEventListener('wheel', handler, { passive: false });
    return () => canvas.removeEventListener('wheel', handler);
  }, []);

  // ── 键盘 ────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        event.preventDefault();
        // 暂停不改变界面，只翻 pausedRef。
        pausedRef.current = !pausedRef.current;
        return;
      }
      const index = Number.parseInt(event.key, 10);
      if (Number.isInteger(index) && index >= 1 && index <= MORPHS.length) {
        const director = directorRef.current;
        if (!director) return;
        // 向下跳会由 Director 走「冲刷 + 重播」，避免铺满的场在稀疏
        // 参数下整片衰减成白纸。
        director.jump(morphStartTime(MORPHS[index - 1].id));
        setHud((current) => ({ ...current, morphIndex: index - 1 }));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const pointAt = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / Math.max(1, rect.width),
      // 纹理坐标的 v 轴向上，指针坐标向下，这里翻转一次。
      y: 1 - (event.clientY - rect.top) / Math.max(1, rect.height),
    };
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const engine = engineRef.current;
      if (!engine) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      setHintVisible(false);

      const erase = event.button === 2 || event.shiftKey;
      scribbleRef.current.active = true;
      scribbleRef.current.erase = erase;

      const point = pointAt(event);
      engine.brush(point.x, point.y, erase ? 0.035 : 0.02, erase ? 'erase' : 'seed');

      // 触屏上没有右键，按住不动半秒转为擦除。
      if (!erase) {
        window.clearTimeout(scribbleRef.current.holdTimer);
        scribbleRef.current.holdTimer = window.setTimeout(() => {
          if (scribbleRef.current.active) scribbleRef.current.erase = true;
        }, 500);
      }
    },
    [pointAt],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>) => {
      const engine = engineRef.current;
      if (!engine || !scribbleRef.current.active) return;
      const point = pointAt(event);
      const erase = scribbleRef.current.erase;
      engine.brush(point.x, point.y, erase ? 0.04 : 0.018, erase ? 'erase' : 'seed');
    },
    [pointAt],
  );

  const handlePointerUp = useCallback(() => {
    scribbleRef.current.active = false;
    scribbleRef.current.erase = false;
    window.clearTimeout(scribbleRef.current.holdTimer);
  }, []);

  // ── 全屏（fullscreenchange 同步状态，Esc 退出时也保持一致）──────────
  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggleSound = useCallback(async () => {
    const sound = soundRef.current;
    if (!sound) return;
    if (!sound.ready) await sound.start();
    const next = !sound.isEnabled;
    sound.setEnabled(next);
    setSoundOn(next);
  }, []);

  const togglePoem = useCallback(() => {
    setPoemVisible((value) => !value);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void document.documentElement.requestFullscreen().catch(() => {
        // 无头环境等场景下全屏可能被拒绝，静默降级。
      });
    }
  }, []);

  const jumpToMorph = useCallback((index: number) => {
    const director = directorRef.current;
    if (!director) return;
    // 向下跳由 Director 走「冲刷 + 重播」；向上跳直接接着长。
    director.jump(morphStartTime(MORPHS[index].id));
    setHud((current) => ({ ...current, morphIndex: index }));
  }, []);

  if (failure) {
    return (
      <main className="fallback">
        <h1>苔痕 · PATINA</h1>
        <p>{failure}</p>
        <p className="fallback__hint">换一个支持 WebGL2 的浏览器，或打开硬件加速后重试。</p>
      </main>
    );
  }

  const morph = MORPHS[hud.morphIndex] ?? MORPHS[0];

  return (
    <main className="stage">
      <canvas
        ref={canvasRef}
        className="stage__canvas"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={(event) => event.preventDefault()}
      />
      <Overlay
        phase={hud.phase}
        morphName={morph.name}
        morphEn={morph.en}
        morphNote={morph.note}
        morphIndex={hud.morphIndex}
        progress={hud.progress}
        coverage={hud.coverage}
        speed={speed}
        poem={POEMS[poemIndex]}
        poemVisible={poemVisible}
        soundOn={soundOn}
        fullscreen={fullscreen}
        lowPrecision={lowPrecision}
        hintVisible={hintVisible}
        onTogglePoem={togglePoem}
        onToggleSound={toggleSound}
        onToggleFullscreen={toggleFullscreen}
        onJump={jumpToMorph}
      />
    </main>
  );
}
