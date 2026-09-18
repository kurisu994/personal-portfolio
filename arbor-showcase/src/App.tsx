import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowDown, ArrowRight, Eye, EyeOff, Maximize2, Minimize2, Volume2, VolumeX, X } from 'lucide-react';
import { POEMS } from './data/poems';
import { ArborEngine, type EngineSnapshot } from './scene/ArborEngine';
import { STAGES } from './scene/climates';

type ThemeStyle = CSSProperties & Record<`--${string}`, string | number>;

const INITIAL_SNAPSHOT: EngineSnapshot = {
  progress: 0, stage: 0, started: false, audioEnabled: false, audioReady: false,
  fps: 0, wind: 0, ink: '#f5ebd4', accent: '#d5b57e', cameraLabel: '',
  quality: 1, branches: 0, leaves: 0, fruits: 0, birds: 0, landed: 0,
};

/** 一木的叙事界面：只管理文字、原生滚动与交互，画面交由引擎。 */
export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const errorRef = useRef<HTMLHeadingElement>(null);
  const engineRef = useRef<ArborEngine | null>(null);
  const aliveRef = useRef(false);
  const startingRef = useRef(false);
  const [snapshot, setSnapshot] = useState(INITIAL_SNAPSHOT);
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [starting, setStarting] = useState(false);
  const [poetryEnabled, setPoetryEnabled] = useState(true);
  const [audioBusy, setAudioBusy] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [notice, setNotice] = useState('');
  const [renderError, setRenderError] = useState('');

  useEffect(() => {
    if (!canvasRef.current) return;
    aliveRef.current = true;
    let disposed = false;
    let engine: ArborEngine | undefined;
    const previousRestoration = history.scrollRestoration;
    history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
    document.body.dataset.started = 'false';
    try {
      engine = new ArborEngine(canvasRef.current, {
        onState: (next: EngineSnapshot) => { if (!disposed) setSnapshot(next); },
        onError: (message: string) => {
          if (!disposed) setRenderError(message || '当前浏览器未能呈现树景。');
        },
      });
      engineRef.current = engine;
      setReady(true);
    } catch {
      setRenderError('当前浏览器未能启动三维画面。');
    }
    return () => {
      disposed = true;
      aliveRef.current = false;
      engine?.dispose();
      engineRef.current = null;
      delete document.body.dataset.started;
      history.scrollRestoration = previousRestoration;
    };
  }, []);

  useEffect(() => {
    const syncFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    syncFullscreen();
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  useLayoutEffect(() => {
    document.body.dataset.started = String(started && !renderError);
    if (renderError) errorRef.current?.focus({ preventScroll: true });
    else if (started) canvasRef.current?.focus({ preventScroll: true });
  }, [started, renderError]);

  /** 在用户手势中解锁音频；声音不可用时，生长与滚动仍继续。 */
  const beginJourney = async (): Promise<void> => {
    const engine = engineRef.current;
    if (!engine || startingRef.current || started || renderError) return;
    startingRef.current = true;
    setStarting(true);
    setNotice('');
    // 先释放原生页面高度，供引擎下一帧刷新 ScrollTrigger。不要等待音频授权。
    document.body.dataset.started = 'true';
    setStarted(true);
    try {
      await engine.start();
    } catch {
      if (aliveRef.current) setNotice('声音暂未响起，树仍会生长。可点击右上角声音按钮重试。');
    } finally {
      startingRef.current = false;
      if (aliveRef.current) setStarting(false);
    }
  };

  /** 声音状态由引擎回传，不把授权失败误报为已开启。 */
  const toggleAudio = async (): Promise<void> => {
    if (!engineRef.current || audioBusy || starting) return;
    setAudioBusy(true);
    setNotice('');
    try {
      await engineRef.current.setAudioEnabled(!(snapshot.audioEnabled && snapshot.audioReady));
    } catch {
      if (aliveRef.current) setNotice('暂时无法播放声音。请检查浏览器声音权限，再点击声音按钮重试；也可静静看树。');
    } finally {
      if (aliveRef.current) setAudioBusy(false);
    }
  };

  /** 全屏仅由明确点击触发，退出与进入状态以浏览器事件为准。 */
  const toggleFullscreen = async (): Promise<void> => {
    setNotice('');
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else setNotice('当前浏览器不支持全屏。留在此处，也能走完四时。');
    } catch {
      if (aliveRef.current) setNotice('暂时无法切换全屏。请检查浏览器权限，或继续在当前窗口观赏。');
    }
  };

  const stageIndex = Math.max(0, Math.min(STAGES.length - 1, snapshot.stage));
  const stage = STAGES[stageIndex];
  const poem = POEMS[stageIndex];
  const progress = Math.max(0, Math.min(1, snapshot.progress));
  const audioOn = snapshot.audioEnabled && snapshot.audioReady;
  const hudVisible = started && !renderError;
  const theme: ThemeStyle = {
    '--ui-ink': started ? snapshot.ink : INITIAL_SNAPSHOT.ink,
    '--ui-accent': started ? snapshot.accent : INITIAL_SNAPSHOT.accent,
    '--journey-progress': progress,
  };

  return (
    <main className="arbor" style={theme} data-started={started} aria-label="一木，四时生长之旅">
      <canvas
        ref={canvasRef}
        className="scene-canvas"
        role="img"
        tabIndex={hudVisible ? 0 : -1}
        inert={!hudVisible}
        aria-hidden={!hudVisible}
        aria-label={`一木树景，当前为${stage.name}。向下滚动看树生长，向上滚动回望。`}
        aria-describedby="journey-instructions"
      >你的浏览器暂不支持画布。请使用新版浏览器观赏一木。</canvas>

      <header className="topbar" data-header aria-hidden={Boolean(renderError)} inert={Boolean(renderError)}>
        <div className="brand" aria-label="一木 ARBOR">
          <span className="brand__chinese">一木</span>
          <span className="brand__rule" aria-hidden="true" />
          <span className="brand__english" lang="en">ARBOR</span>
        </div>
        <span className="opening-note" hidden={started}>一木之间，自有四时</span>
        <div className="controls" role="group" aria-label="观赏设置" hidden={!hudVisible} inert={!hudVisible}>
          <button className="icon-button" type="button" onClick={() => void toggleAudio()}
            aria-label={audioOn ? '关闭声音' : '开启声音'} aria-pressed={audioOn}
            aria-busy={audioBusy} disabled={audioBusy || starting} title={audioOn ? '关闭声音' : '开启声音'}>
            {audioOn ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
          </button>
          <button className="icon-button" type="button" onClick={() => setPoetryEnabled((value) => !value)}
            aria-label={poetryEnabled ? '隐藏诗句' : '显示诗句'} aria-pressed={poetryEnabled}
            aria-controls="journey-poem" title={poetryEnabled ? '隐藏诗句' : '显示诗句'}>
            {poetryEnabled ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
          </button>
          <button className="icon-button" type="button" onClick={() => void toggleFullscreen()}
            aria-label={fullscreen ? '退出全屏' : '进入全屏'} aria-pressed={fullscreen}
            title={fullscreen ? '退出全屏' : '进入全屏'}>
            {fullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
          </button>
        </div>
      </header>

      <section className="opening" hidden={started || Boolean(renderError)} inert={started || Boolean(renderError)}
        aria-hidden={started || Boolean(renderError)} aria-labelledby="opening-title">
        <div className="opening__body">
          <p className="opening__eyebrow" lang="en">A SEED. A SEASON. A WORLD.</p>
          <h1 id="opening-title"><span>一木</span><span className="opening__english" lang="en">ARBOR</span></h1>
          <p className="opening__lead">不催一叶，不问归期。</p>
          <p className="opening__description">落一粒种子，<wbr />看它慢慢长成自己的模样。</p>
          <div className="opening__action">
            <button className="begin-button" type="button" onClick={() => void beginJourney()} disabled={!ready || starting}>
              <span>{ready ? '落子生根' : '静候一息'}</span><ArrowRight aria-hidden="true" />
            </button>
            <p className="opening__hint"><ArrowDown aria-hidden="true" />向下滚动，四时渐深。</p>
          </div>
        </div>
        <div className="opening__footnote" aria-hidden="true"><span>始于一粒 · 归于一木</span><span lang="en">GROW AT YOUR OWN PACE</span></div>
      </section>

      <section className="journey-ui" hidden={!hudVisible} inert={!hudVisible} aria-hidden={!hudVisible} aria-label="四时诗境">
        <article className="poem" data-poem id="journey-poem" data-visible={poetryEnabled}
          aria-hidden={!poetryEnabled} inert={!poetryEnabled} aria-label={`${stage.name}诗句`}>
          <div className="poem__chapter" key={stageIndex}>
            <div className="poem__eyebrow" aria-hidden="true"><span>0{stageIndex + 1}</span><i /><span>五时 · 一木</span></div>
            <h2>{stage.name}</h2>
            <p className="sr-only">{poem.clauses.join('')}</p>
            <div className="poem__verses" aria-hidden="true">
              {poem.clauses.map((clause, clauseIndex) => (
                <span className="poem__clause" key={clause}>
                  {Array.from(clause).map((character, characterIndex) => (
                    <span className="poem__character" key={characterIndex}
                      style={{ animationDelay: `${120 + (clauseIndex * 6 + characterIndex) * 38}ms` }}>{character}</span>
                  ))}
                </span>
              ))}
            </div>
            <p className="poem__whisper" lang="en">{poem.whisper}</p>
          </div>
        </article>
        <footer className="journey-footer" data-footer>
          <div className="journey-footer__meta">
            <p id="journey-instructions"><ArrowDown aria-hidden="true" /><span>{progress >= 0.995 ? '一木已成。向上滚动，重访来时。' : '向下滚动，四时渐深。'}</span></p>
            <span className="journey-footer__progress" aria-hidden="true">{String(Math.round(progress * 100)).padStart(2, '0')}<small> / 100</small></span>
          </div>
          <div className="journey-track" role="progressbar" aria-label="一木生长进度" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)} aria-valuetext={`${stage.name}，${Math.round(progress * 100)}%`}><i /></div>
          <ol className="stage-scale" aria-label="生长五章">
            {STAGES.map((item, index) => (
              <li key={item.name} data-active={index === stageIndex} data-passed={index < stageIndex} aria-current={index === stageIndex ? 'step' : undefined}>
                <i aria-hidden="true" /><span className="stage-scale__number" aria-hidden="true">0{index + 1}</span><span>{item.name}</span>
              </li>
            ))}
          </ol>
        </footer>
      </section>

      <div className="notice" hidden={!notice || Boolean(renderError)}>
        <p role="status" aria-live="polite">{notice}</p>
        <button className="icon-button" type="button" aria-label="关闭提示" title="关闭提示" onClick={() => setNotice('')}><X aria-hidden="true" /></button>
      </div>

      {renderError && (
        <section className="render-fallback" aria-labelledby="render-error-title">
          <span className="render-fallback__eyebrow" lang="en">ARBOR</span>
          <h1 id="render-error-title" ref={errorRef} tabIndex={-1}>此刻，树景未能展开。</h1>
          <p role="alert">{renderError}</p>
          <p>请开启浏览器硬件加速，或使用新版 Chrome、Edge、Safari 再试一次。</p>
          <button className="begin-button" type="button" onClick={() => window.location.reload()}><span>重新尝试</span><ArrowRight aria-hidden="true" /></button>
        </section>
      )}
    </main>
  );
}
