import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowRight,
  Expand,
  Eye,
  EyeOff,
  Focus,
  Headphones,
  Maximize2,
  Minimize2,
  MousePointer2,
  Orbit,
  Quote,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { POEMS } from './data/poems';
import { CLIMATES, sampleClimate } from './scene/climates';
import { MigrationEngine, type EngineSnapshot } from './scene/MigrationEngine';
import { tupleToCss } from './scene/math';

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

interface NavigatorWithOptionalWakeLock {
  wakeLock?: {
    request: (type: 'screen') => Promise<WakeLockSentinelLike>;
  };
}

interface OptionalLockableOrientation {
  lock?: (orientation: 'landscape') => Promise<void>;
}

type ThemeStyle = CSSProperties & Record<`--${string}`, string | number>;

const initialClimate = sampleClimate(0, 4300);
const initialSnapshot: EngineSnapshot = {
  elapsed: 0,
  journey: 0,
  routeZ: 4300,
  traveled: 0,
  climate: initialClimate,
  director: { name: '航线俯瞰', cycle: 0, progress: 0, automatic: true, distance: 1120 },
  flock: { count: 30, visible: 0, maxScreenX: 0, finite: true },
  loadedChunks: 0,
  fps: 60,
  wind: 0,
  quality: 1,
  audioReady: false,
};

function splitCharacters(value: string): string[] {
  return Array.from(value);
}

function distanceLabel(distance: number): string {
  if (distance < 900) return 'NEAR';
  if (distance > 1360) return 'FAR';
  return 'MID';
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<MigrationEngine | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [selectedClimate, setSelectedClimate] = useState(0);
  const [started, setStarted] = useState(false);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [poetryEnabled, setPoetryEnabled] = useState(true);
  const [automatic, setAutomatic] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [audioFailed, setAudioFailed] = useState(false);
  const [renderFailed, setRenderFailed] = useState(false);
  const [modeChangedAt, setModeChangedAt] = useState(0);
  const isTouch = useMemo(() => matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0, []);

  useEffect(() => {
    if (!canvasRef.current) return undefined;
    let engine: MigrationEngine;
    try {
      engine = new MigrationEngine(canvasRef.current, { startClimate: selectedClimate, onState: setSnapshot });
    } catch {
      setRenderFailed(true);
      return undefined;
    }
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!started) engineRef.current?.setStartClimate(selectedClimate);
  }, [selectedClimate, started]);

  useEffect(() => {
    const updateFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    const resumeWakeLock = () => {
      if (document.visibilityState === 'visible' && started) {
        void (navigator as unknown as NavigatorWithOptionalWakeLock).wakeLock?.request('screen')
          .then((sentinel) => { wakeLockRef.current = sentinel; })
          .catch(() => undefined);
      }
    };
    document.addEventListener('fullscreenchange', updateFullscreen);
    document.addEventListener('visibilitychange', resumeWakeLock);
    return () => {
      document.removeEventListener('fullscreenchange', updateFullscreen);
      document.removeEventListener('visibilitychange', resumeWakeLock);
      void wakeLockRef.current?.release();
    };
  }, [started]);

  const enterImmersiveMode = async (): Promise<void> => {
    const fullscreenPromise = document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => undefined);
    const wakeLockPromise = (navigator as unknown as NavigatorWithOptionalWakeLock).wakeLock?.request('screen')
      .then((sentinel) => { wakeLockRef.current = sentinel; })
      .catch(() => undefined);
    await fullscreenPromise;
    const orientation = screen.orientation as unknown as OptionalLockableOrientation | undefined;
    const orientationPromise = orientation?.lock?.('landscape').catch(() => undefined);
    await Promise.all([orientationPromise, wakeLockPromise]);
  };

  const beginJourney = (): void => {
    setStarted(true);
    setAudioFailed(false);
    const startPromise = engineRef.current?.beginJourney();
    startPromise?.catch(() => {
      setAudioFailed(true);
      setMusicEnabled(false);
    });
    void enterImmersiveMode();
  };

  const toggleMusic = (): void => {
    const next = !musicEnabled;
    setMusicEnabled(next);
    engineRef.current?.setAudioEnabled(next);
    if (next) {
      setAudioFailed(false);
      void engineRef.current?.beginJourney().catch(() => {
        setAudioFailed(true);
        setMusicEnabled(false);
      });
    }
  };

  const setCameraMode = (nextAutomatic: boolean): void => {
    setAutomatic(nextAutomatic);
    setModeChangedAt(snapshot.journey);
    engineRef.current?.setAutomaticCamera(nextAutomatic);
  };

  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void enterImmersiveMode();
  };

  const poemStep = Math.floor(snapshot.journey / 18);
  const poemIndex = (poemStep * 5 + Math.floor(poemStep / POEMS.length) * 3) % POEMS.length;
  const poem = POEMS[poemIndex];
  const activeClimate = CLIMATES[snapshot.climate.index];
  const themeStyle = useMemo<ThemeStyle>(() => ({
    '--ui-ink': tupleToCss(snapshot.climate.ink),
    '--ui-accent': tupleToCss(snapshot.climate.accent),
    '--ui-sky': tupleToCss(snapshot.climate.sky),
    '--ui-paper': tupleToCss(snapshot.climate.bird),
    '--ui-night': snapshot.climate.night.toFixed(3),
  }), [snapshot.climate]);

  return (
    <main className="orientation-stage" style={themeStyle} data-started={started}>
      <canvas ref={canvasRef} className="scene-canvas" aria-label="程序化生成的候鸟迁徙世界" />
      <div className="paper-fiber" aria-hidden="true" />
      {renderFailed && (
        <div className="render-fallback" role="alert">
          <span>MIGRATION</span>
          <h2>风，在等待一双翅膀。</h2>
          <p>当前浏览器无法启动三维画面。请开启浏览器的硬件加速，或使用新版 Chrome、Edge、Safari 再次起飞。</p>
          <button type="button" onClick={() => location.reload()}>重新起飞 <ArrowRight size={16} /></button>
        </div>
      )}

      <section className={`opening ${started ? 'opening--departed' : ''}`} aria-hidden={started} inert={started}>
        <header className="opening__header">
          <div className="brand-lockup">
            <span className="brand-lockup__mark">M</span>
            <span>候鸟迁徙志</span>
          </div>
          <span className="edition">A GENERATIVE JOURNEY · 2026</span>
        </header>

        <div className="opening__body">
          <p className="opening__eyebrow">AN INFINITE FLIGHT ALONG THE RIVER</p>
          <h1>
            <span>候鸟</span>
            <strong>MIGRATION</strong>
          </h1>
          <p className="opening__lead">把远方折成翅膀，<br />把此刻交还给风。</p>
        </div>

        <div className="departure-panel">
          <div className="departure-panel__label">
            <span>选择起飞地点</span>
            <span>DEPARTURE / 01—05</span>
          </div>
          <div className="climate-picker" role="radiogroup" aria-label="选择起飞地点">
            {CLIMATES.map((climate, index) => (
              <button
                key={climate.en}
                type="button"
                role="radio"
                aria-checked={selectedClimate === index}
                tabIndex={selectedClimate === index ? 0 : -1}
                className="climate-option"
                data-active={selectedClimate === index}
                onClick={() => setSelectedClimate(index)}
                onPointerEnter={() => setSelectedClimate(index)}
                onKeyDown={(event) => {
                  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
                  event.preventDefault();
                  const next = (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + CLIMATES.length) % CLIMATES.length;
                  setSelectedClimate(next);
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
                }}
              >
                <span className="climate-option__swatch" style={{ backgroundColor: tupleToCss(climate.accent) }} />
                <span className="climate-option__index">0{index + 1}</span>
                <span className="climate-option__name">{climate.name}</span>
                <span className="climate-option__en">{climate.en}</span>
              </button>
            ))}
          </div>
          <button type="button" className="begin-button" onClick={beginJourney}>
            <span>开始迁徙</span>
            <ArrowRight aria-hidden="true" />
          </button>
        </div>

        <footer className="opening__footer">
          <span>{snapshot.flock.count} PAPER BIRDS</span>
          <span>05 CLIMATES</span>
          <span>∞ HORIZON</span>
        </footer>
      </section>

      <section className={`journey-ui ${started ? 'journey-ui--visible' : ''}`} aria-hidden={!started} inert={!started}>
        <header className="topbar">
          <div className="route-identity">
            <span className="route-identity__mark">M</span>
            <span className="route-identity__title">候鸟 · MIGRATION</span>
            <span className="route-identity__rule" />
            <span className="route-identity__climate">{activeClimate.name} / {activeClimate.en}</span>
          </div>

          <div className="control-cluster">
            <div className="mode-switch" role="group" aria-label="镜头模式">
              <button
                type="button"
                data-active={automatic}
                onClick={() => setCameraMode(true)}
                aria-label="自动镜头"
                title="自动镜头"
              >
                <Focus aria-hidden="true" />
                <span>AUTO</span>
              </button>
              <button
                type="button"
                data-active={!automatic}
                onClick={() => setCameraMode(false)}
                aria-label="自主镜头"
                title="自主镜头"
              >
                <Orbit aria-hidden="true" />
                <span>FREE</span>
              </button>
            </div>
            <button
              type="button"
              className="icon-button"
              onClick={() => setPoetryEnabled((value) => !value)}
              aria-label={poetryEnabled ? '隐藏诗句' : '显示诗句'}
              title={poetryEnabled ? '隐藏诗句' : '显示诗句'}
            >
              {poetryEnabled ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={toggleMusic}
              aria-label={musicEnabled ? '关闭音乐' : '开启音乐'}
              title={audioFailed ? '声音加载失败' : musicEnabled ? '关闭音乐' : '开启音乐'}
            >
              {musicEnabled ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? '退出全屏' : '进入全屏'}
              title={fullscreen ? '退出全屏' : '进入全屏'}
            >
              {fullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
            </button>
          </div>
        </header>

        <div className="shot-caption">
          <span className="shot-caption__number">{String((snapshot.director.cycle % 99) + 1).padStart(2, '0')}</span>
          <div>
            <span className="shot-caption__label">CAMERA / VAR {String(snapshot.director.cycle + 1).padStart(2, '0')}</span>
            <strong>{snapshot.director.name}</strong>
          </div>
          <span className="shot-caption__distance">{distanceLabel(snapshot.director.distance)}</span>
        </div>

        <div className="journey-index" aria-label="旅程进度">
          <span>LAT {Math.abs(47.3 + snapshot.traveled * 0.000021).toFixed(3)}° N</span>
          <span className="journey-index__line"><i style={{ transform: `scaleX(${snapshot.director.progress})` }} /></span>
          <span>{(snapshot.traveled / 1000).toFixed(1).padStart(5, '0')} KM</span>
        </div>

        <div className={`poem ${poetryEnabled ? 'poem--visible' : ''}`} key={`${poemIndex}-${poemStep}`}>
          <Quote aria-hidden="true" className="poem__icon" />
          <div className="poem__rule" />
          <div className="poem__copy">
            {poem.lines.map((line, lineIndex) => (
              <p key={line}>
                {splitCharacters(line).map((character, characterIndex) => (
                  <span
                    key={`${character}-${characterIndex}`}
                    style={{ animationDelay: `${0.36 + lineIndex * 0.5 + characterIndex * 0.055}s` }}
                  >
                    {character}
                  </span>
                ))}
              </p>
            ))}
            <small>{poem.translation}</small>
          </div>
        </div>

        <div className="interaction-status" aria-hidden="true">
          {automatic ? <MousePointer2 /> : <Expand />}
          <span>{automatic ? 'WIND' : 'ORBIT'}</span>
          <i style={{ transform: `scaleX(${Math.min(snapshot.wind, 1)})` }} />
        </div>

        <p className="gesture-hint" data-visible={snapshot.journey - modeChangedAt < 9}>
          {automatic
            ? isTouch ? '触碰生风 · 双指轻轻拉远' : '移动光标，借一阵风 · 滚轮轻轻拉远'
            : isTouch ? '单指转动视角 · 双指靠近远方' : '拖拽转动视角 · 滚轮靠近远方'}
        </p>

        {audioFailed && <p className="audio-notice" role="status">声音暂未抵达，点击音乐按钮重试。</p>}

        <div className="sound-status" aria-hidden="true" data-active={musicEnabled && !audioFailed}>
          <Headphones />
          <div>{[0, 1, 2, 3].map((bar) => <i key={bar} />)}</div>
        </div>
      </section>
    </main>
  );
}
