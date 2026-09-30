import React, { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Eraser,
  Eye,
  Footprints,
  LocateFixed,
  Pause,
  PenLine,
  Play,
  Share2,
  SlidersHorizontal,
  Type,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { jdFromMs, localMidnightJd, localParts } from './astro/sky';
import { COASTS } from './data/coasts';
import type { CameraMode } from './scene/Director';
import { TideEngine, type TideSnapshot, type Tool } from './scene/TideEngine';
import { chartDatum, describeDay, tideEnvelope } from './tide/day';
import { CoastPicker } from './ui/CoastPicker';
import { Poem } from './ui/Poem';
import { DateField, SetupDrawer } from './ui/SetupDrawer';
import { TideGauge } from './ui/TideGauge';
import { TideTable } from './ui/TideTable';

type ToneStyle = CSSProperties & Record<`--${string}`, string>;

interface InitialState {
  coastIndex: number;
  jd: number;
  /** 带参数的分享链接：跳过开场直接到水边 */
  shared: boolean;
}

/** 从地址栏还原：?coast=beach&date=2026-09-30&time=14:30（时间为该海岸当地时间） */
function readUrl(): InitialState {
  const p = new URLSearchParams(window.location.search);
  const found = COASTS.findIndex((c) => c.id === p.get('coast'));
  const coastIndex = Math.max(0, found);
  const coast = COASTS[coastIndex];
  const date = p.get('date') ?? '';
  const time = p.get('time') ?? '';
  const year = parseInt(date.slice(0, 4), 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && year >= 1950 && year <= 2100) {
    const [hh, mm] = /^\d{1,2}:\d{2}$/.test(time) ? time.split(':').map(Number) : [12, 0];
    return { coastIndex, jd: localMidnightJd(date, coast.tz) + (Math.min(hh, 23) * 60 + Math.min(mm, 59)) / 1440, shared: found >= 0 };
  }
  return { coastIndex, jd: jdFromMs(Date.now()), shared: found >= 0 };
}

function buildUrl(coastIndex: number, snapshot: TideSnapshot | null): string {
  const p = new URLSearchParams();
  p.set('coast', COASTS[coastIndex].id);
  if (snapshot) {
    p.set('date', snapshot.date);
    p.set('time', snapshot.clock);
  }
  return `${window.location.pathname}?${p.toString()}`;
}

/**
 * 界面色调在「纸色墨字」与「底片黑银白字」两态之间切换：
 * 按天光带回差判定目标，再用 1.2 秒动画过渡。线性跟随天光会在黄昏时
 * 把墨色和底色一起推到中灰，文字几乎看不见。
 */
function useTone(daylight: number | undefined): number {
  const [target, setTarget] = useState<number | null>(null);
  const [tone, setTone] = useState(1);
  const toneRef = useRef(1);

  useEffect(() => {
    if (daylight === undefined) return;
    setTarget((prev) => (daylight > 0.55 ? 1 : daylight < 0.45 ? 0 : (prev ?? (daylight >= 0.5 ? 1 : 0))));
  }, [daylight]);

  useEffect(() => {
    if (target === null) return undefined;
    const from = toneRef.current;
    if (from === target) return undefined;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 1200);
      const eased = k * k * (3 - 2 * k);
      toneRef.current = from + (target - from) * eased;
      setTone(toneRef.current);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  return tone;
}

/** 由色调生成 CSS 变量 */
function toneVars(daylight: number): ToneStyle {
  const mix = (night: number[], day: number[]) => night.map((v, i) => Math.round(v + (day[i] - v) * daylight)).join(' ');
  const ink = mix([236, 230, 217], [34, 33, 29]);
  const veil = mix([3, 5, 9], [240, 235, 224]);
  return { '--ink-rgb': ink, '--veil-rgb': veil };
}

export const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<TideEngine | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const [initial] = useState(readUrl);
  const [coastIndex, setCoastIndex] = useState(initial.coastIndex);
  const [started, setStarted] = useState(initial.shared);
  const [snapshot, setSnapshot] = useState<TideSnapshot | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [text, setText] = useState('');
  const [sound, setSound] = useState(false);
  const [failed, setFailed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(null), 3400);
  }, []);

  // 1. 创建引擎
  useEffect(() => {
    let engine: TideEngine;
    try {
      engine = new TideEngine(canvasRef.current!, {
        coastIndex: initial.coastIndex,
        jd: initial.jd,
        speed: 600,
        onSnapshot: setSnapshot,
        onTextPlaced: () => setText(''),
      });
    } catch (err) {
      console.error('潮汐引擎启动失败', err);
      setFailed(true);
      return undefined;
    }
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
      window.clearTimeout(toastTimer.current);
    };
  }, [initial]);

  useEffect(() => {
    engineRef.current?.setCoast(coastIndex);
  }, [coastIndex]);

  useEffect(() => {
    engineRef.current?.setPendingText(text);
  }, [text]);

  const coast = COASTS[coastIndex];
  const envelope = useMemo(() => tideEnvelope(coast), [coast]);
  const datum = useMemo(() => chartDatum(coast), [coast]);
  const date = snapshot?.date ?? localParts(initial.jd, coast.tz).date;
  const day = useMemo(() => describeDay(coast, date), [coast, date]);
  const playing = snapshot?.playing ?? true;

  // 2. 地址栏：暂停或换海岸时写入当前时刻（播放中每帧改地址栏没有意义）
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  useEffect(() => {
    if (started && !playing) window.history.replaceState(null, '', buildUrl(coastIndex, snapshotRef.current));
  }, [started, playing, coastIndex]);

  const setDate = (next: string) => {
    const hours = snapshot ? localParts(snapshot.jd, coast.tz).hours : 12;
    engineRef.current?.setTime(localMidnightJd(next, coast.tz) + hours / 24);
  };

  const togglePlay = useCallback(() => {
    engineRef.current?.setPlaying(!(snapshot?.playing ?? true));
  }, [snapshot]);

  const chooseTool = (tool: Tool) => {
    engineRef.current?.setTool(tool);
    if (tool === 'pen') showToast('在沙上拖动就能写，镜头会停下来等你');
    if (tool === 'text') showToast('先写好字，再点一下沙滩');
  };

  const toggleSound = async () => {
    const on = await engineRef.current?.setSound(!sound);
    setSound(Boolean(on));
  };

  const share = async () => {
    const url = new URL(buildUrl(coastIndex, snapshot), window.location.href).toString();
    try {
      await navigator.clipboard.writeText(url);
      showToast('链接已复制，打开就是此刻的这片海');
    } catch {
      showToast('无法写入剪贴板，请直接复制地址栏');
    }
  };

  const begin = () => {
    setStarted(true);
    void engineRef.current?.setSound(true).then(setSound);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !started || drawerOpen) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|BUTTON|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      if (target?.getAttribute('role') === 'slider') return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [started, drawerOpen, togglePlay]);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const tone = toneVars(useTone(snapshot?.daylight));
  const [y, m, d] = date.split('-').map(Number);
  const level = snapshot?.level ?? 0;
  const rising = (snapshot?.rate ?? 0) >= 0;
  const next = snapshot?.next;
  const tool = snapshot?.tool ?? 'look';

  return (
    <main className="shore" data-started={started} data-tool={tool} style={tone}>
      <canvas ref={canvasRef} className="scene" aria-label={`${coast.name}的潮间带`} />

      <section className="opening" aria-hidden={started} inert={started}>
        <h1 className="opening__title">
          <span className="opening__zh">潮汐</span>
          <span className="opening__en">Tideline</span>
        </h1>
        <div className="opening__intro">
          <p className="opening__lead">
            选一片海岸、一个日子。
            <br />
            月亮会把潮水推上来，你在沙上写下的，涨潮时会被收回。
          </p>
          <div className="opening__date">
            <span className="field-label">日期</span>
            <DateField value={date} onChange={setDate} />
          </div>
          <button type="button" className="shutter" onClick={begin} disabled={failed}>
            <Footprints aria-hidden="true" />
            <span>走到水边</span>
          </button>
        </div>
        <div className="opening__coasts">
          <p className="field-label">海岸</p>
          <CoastPicker value={coastIndex} onChange={setCoastIndex} />
        </div>
      </section>

      <section className="hud" aria-hidden={!started} inert={!started}>
        <div className="masthead" aria-label="潮汐 Tideline">
          <span className="masthead__zh">潮汐</span>
          <span className="masthead__en">Tideline</span>
        </div>

        <button type="button" className="site-card" onClick={() => setDrawerOpen(true)} aria-label="打开海岸与时间设置">
          <span className="site-card__name">{coast.name}</span>
          <span className="site-card__meta">
            {y}年{m}月{d}日
          </span>
          <span className="site-card__meta">
            {snapshot?.moonName} {snapshot?.tideClass}
          </span>
          <span className="site-card__edit">
            <SlidersHorizontal aria-hidden="true" />
            调整
          </span>
        </button>

        <TideGauge level={level} rising={rising} datum={datum} top={Math.ceil(envelope.max - datum + 0.3)} />

        {snapshot && <Poem jd={snapshot.jd} />}

        <footer className="deck">
          <dl className="readouts">
            <div className="readout readout--primary">
              <dt>潮高</dt>
              <dd>
                {(level - datum).toFixed(2)}
                <small>米</small>
              </dd>
            </div>
            <div className="readout">
              <dt>{rising ? '正在涨潮' : '正在落潮'}</dt>
              <dd>
                {Math.abs((snapshot?.rate ?? 0) * 100).toFixed(0)}
                <small>厘米每小时</small>
              </dd>
            </div>
            {next && (
              <div className="readout readout--minor">
                <dt>下次{next.kind === 'high' ? '高潮' : '低潮'}</dt>
                <dd>
                  {next.clock}
                  <small>
                    {Math.floor(next.minutes / 60)} 小时 {next.minutes % 60} 分后
                  </small>
                </dd>
              </div>
            )}
          </dl>

          {snapshot && (
            <TideTable
              day={day}
              envelope={envelope}
              datum={datum}
              jd={snapshot.jd}
              clock={snapshot.clock}
              onSeek={(jd) => engineRef.current?.setTime(jd)}
            />
          )}

          <div className="controls">
            <div className="controls__group">
              <button
                type="button"
                className="round-button round-button--primary"
                onClick={togglePlay}
                aria-label={playing ? '暂停潮汐' : '继续潮汐'}
              >
                {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
              </button>
              <button
                type="button"
                className="text-button"
                aria-label="回到此刻"
                onClick={() => engineRef.current?.setTime(jdFromMs(Date.now()))}
              >
                <LocateFixed aria-hidden="true" />
                <span>回到此刻</span>
              </button>
            </div>

            <div className="controls__group tools">
              <div className="tool-switch" role="radiogroup" aria-label="工具">
                {(
                  [
                    ['look', Eye, '看'],
                    ['pen', PenLine, '手写'],
                    ['text', Type, '写字'],
                  ] as const
                ).map(([key, Icon, label]) => (
                  <button key={key} type="button" role="radio" aria-checked={tool === key} aria-label={label} onClick={() => chooseTool(key)}>
                    <Icon aria-hidden="true" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
              {tool === 'text' && (
                <input
                  className="text-input"
                  value={text}
                  maxLength={12}
                  placeholder="写点什么"
                  aria-label="要写在沙上的字"
                  onChange={(e) => setText(e.target.value)}
                />
              )}
              <button type="button" className="text-button" aria-label="抹平沙上的痕迹" onClick={() => engineRef.current?.clearTraces()}>
                <Eraser aria-hidden="true" />
                <span>抹平</span>
              </button>
            </div>

            <div className="controls__group">
              <button
                type="button"
                className="round-button"
                onClick={toggleSound}
                aria-pressed={sound}
                aria-label={sound ? '关闭海浪声' : '打开海浪声'}
              >
                {sound ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
              </button>
              <button type="button" className="round-button" onClick={share} aria-label="复制分享链接">
                <Share2 aria-hidden="true" />
              </button>
            </div>
          </div>
        </footer>
      </section>

      <SetupDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        coastIndex={coastIndex}
        onCoast={setCoastIndex}
        date={date}
        onDate={setDate}
        camera={snapshot?.camera ?? 'auto'}
        onCamera={(mode: CameraMode) => engineRef.current?.setCameraMode(mode)}
        speed={snapshot?.speed ?? 600}
        onSpeed={(speed) => engineRef.current?.setSpeed(speed)}
      />

      <p className="toast" role="status" data-visible={toast !== null}>
        {toast}
      </p>

      {failed && (
        <div className="fallback" role="alert">
          <h2>这台设备暂时看不见海</h2>
          <p>潮汐需要 WebGL2。请开启浏览器的硬件加速，或换用新版 Chrome、Edge、Safari 后重新打开。</p>
          <button type="button" className="text-button text-button--outlined" onClick={() => window.location.reload()}>
            重新载入
          </button>
        </div>
      )}
    </main>
  );
};
