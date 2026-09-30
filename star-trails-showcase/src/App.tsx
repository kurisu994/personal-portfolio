import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Aperture, Download, Pause, Play, RotateCcw, Share2, SlidersHorizontal, Volume2, VolumeX } from 'lucide-react';
import type { NightInfo } from './astro/night';
import { formatCoordinate } from './astro/sky';
import { NightscapeAudio } from './audio/nightscape';
import { CITIES, LENSES, nearestCity } from './data/cities';
import { NightExposure, type ExposureSnapshot } from './engine/NightExposure';
import { NightBand } from './ui/NightBand';
import { PoleDial } from './ui/PoleDial';
import { Poem } from './ui/Poem';
import { DateField, SetupDrawer } from './ui/SetupDrawer';
import { SitePicker } from './ui/SitePicker';

interface InitialState {
  cityIndex: number;
  date: string;
  fovDeg: number;
  mode: 0 | 1;
  t: number | null;
  /** 带坐标的分享链接：跳过开场，直接显影 */
  shared: boolean;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 默认 13mm 广角：天极与地平线剪影能同框 */
const DEFAULT_FOV = 85;

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 从地址栏还原画面：?lat=&lon=&date=&fov=&mode=&t= */
function readUrl(): InitialState {
  const p = new URLSearchParams(window.location.search);
  const lat = parseFloat(p.get('lat') ?? '');
  const lon = parseFloat(p.get('lon') ?? '');
  const shared = Number.isFinite(lat) && Number.isFinite(lon);
  const rawDate = p.get('date') ?? '';
  const year = parseInt(rawDate.slice(0, 4), 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) && year >= 1900 && year <= 2100 ? rawDate : todayLocal();
  const fovRaw = parseFloat(p.get('fov') ?? '');
  const fovDeg = Number.isFinite(fovRaw)
    ? LENSES.reduce<number>((best, l) => (Math.abs(l.fov - fovRaw) < Math.abs(best - fovRaw) ? l.fov : best), DEFAULT_FOV)
    : DEFAULT_FOV;
  const tRaw = parseFloat(p.get('t') ?? '');
  return {
    cityIndex: shared ? nearestCity(lat, lon) : 0,
    date,
    fovDeg,
    mode: p.get('mode') === '1' ? 1 : 0,
    t: Number.isFinite(tRaw) ? Math.min(1, Math.max(0, tRaw)) : null,
    shared,
  };
}

function buildUrl(cityIndex: number, date: string, fovDeg: number, mode: number, t?: number): string {
  const c = CITIES[cityIndex];
  const p = new URLSearchParams();
  p.set('lat', c.lat.toFixed(4));
  p.set('lon', c.lon.toFixed(4));
  p.set('date', date);
  p.set('fov', String(fovDeg));
  p.set('mode', String(mode));
  if (t !== undefined) p.set('t', t.toFixed(3));
  return `${window.location.pathname}?${p.toString()}`;
}

export const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<NightExposure | null>(null);
  const audioRef = useRef<NightscapeAudio | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const lastNight = useRef<NightInfo | null>(null);
  const [initial] = useState(readUrl);

  const [cityIndex, setCityIndex] = useState(initial.cityIndex);
  const [date, setDate] = useState(initial.date);
  const [fovDeg, setFovDeg] = useState(initial.fovDeg);
  const [mode, setMode] = useState<0 | 1>(initial.mode);
  const [speedSec, setSpeedSec] = useState(60);
  const [ready, setReady] = useState(false);
  const [started, setStarted] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<ExposureSnapshot | null>(null);
  const [night, setNight] = useState<NightInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [sound, setSound] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((text: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  // 1. 创建引擎（WASM + WebGL2）
  useEffect(() => {
    let disposed = false;
    let engine: NightExposure | null = null;
    audioRef.current = new NightscapeAudio();
    NightExposure.create(canvasRef.current!, {
      onSnapshot: setSnapshot,
      onNight: (info) => {
        const prev = lastNight.current;
        lastNight.current = info;
        setNight(info);
        if (info.kind !== 'normal' && (prev?.kind !== info.kind || Math.abs(prev.start - info.start) > 0.5)) {
          showToast(
            info.kind === 'polar-night'
              ? '极夜：太阳整天不升起，这张底片曝光完整的 24 小时'
              : '极昼：太阳整夜不落，天色不够黑，几乎拍不到星轨',
          );
        }
      },
      onFinish: () => showToast('天亮了，这一夜的底片已经完成'),
    })
      .then((e) => {
        if (disposed) {
          e.dispose();
          return;
        }
        engine = e;
        engineRef.current = e;
        setReady(true);
      })
      .catch((err: unknown) => {
        console.error('星轨引擎启动失败', err);
        setFailed(true);
      });
    return () => {
      disposed = true;
      engine?.dispose();
      engineRef.current = null;
      audioRef.current?.dispose();
      window.clearTimeout(toastTimer.current);
    };
  }, [showToast]);

  // 2. 场景参数 → 引擎
  useEffect(() => {
    if (ready) engineRef.current?.setScene({ cityIndex, date, fovDeg, mode });
  }, [ready, cityIndex, date, fovDeg, mode]);

  useEffect(() => {
    engineRef.current?.setSpeed(speedSec);
  }, [ready, speedSec]);

  // 3. 分享链接直接开始显影
  useEffect(() => {
    if (!ready || !initial.shared) return;
    engineRef.current?.begin(initial.t ?? 0);
    setStarted(true);
  }, [ready, initial]);

  // 4. 地址栏跟随参数；暂停或曝光结束时带上进度（拖动时由 handleSeek 写入）
  const playing = snapshot?.playing ?? false;
  const progressRef = useRef(0);
  progressRef.current = snapshot?.progress ?? 0;
  useEffect(() => {
    if (!started) return;
    const t = playing ? undefined : progressRef.current;
    window.history.replaceState(null, '', buildUrl(cityIndex, date, fovDeg, mode, t));
  }, [started, playing, cityIndex, date, fovDeg, mode]);

  const begin = () => {
    engineRef.current?.begin(0);
    setStarted(true);
  };

  const togglePlay = useCallback(() => {
    const engine = engineRef.current;
    if (!engine || !snapshot) return;
    if (snapshot.playing) engine.pause();
    else engine.play();
  }, [snapshot]);

  const handleSeek = (p: number) => {
    engineRef.current?.seek(p);
    if (!playing) window.history.replaceState(null, '', buildUrl(cityIndex, date, fovDeg, mode, p));
  };

  const toggleSound = async () => {
    const active = await audioRef.current?.toggle();
    setSound(Boolean(active));
  };

  const share = async () => {
    const url = new URL(buildUrl(cityIndex, date, fovDeg, mode, snapshot?.progress), window.location.href).toString();
    try {
      await navigator.clipboard.writeText(url);
      showToast('链接已复制，打开就是这一张底片');
    } catch {
      showToast('无法写入剪贴板，请直接复制地址栏');
    }
  };

  const exportPlate = () => {
    const engine = engineRef.current;
    if (!engine || !snapshot) return;
    if (snapshot.developing) {
      showToast('底片还在显影，稍等片刻再导出');
      return;
    }
    const link = document.createElement('a');
    link.download = `星轨-${CITIES[cityIndex].name}-${date}.png`;
    link.href = engine.exportPlate();
    link.click();
    showToast('底片已导出');
  };

  // 空格键播放 / 暂停
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

  const city = CITIES[cityIndex];
  const lens = LENSES.find((l) => l.fov === fovDeg) ?? LENSES[1];
  const [y, m, d] = date.split('-').map(Number);
  const aim = mode === 1 ? '仰望天顶' : city.lat >= 0 ? '对准北天极' : '对准南天极';
  const elapsed = Math.max(0, Math.round(snapshot?.elapsedMinutes ?? 0));
  const developing = Boolean(snapshot?.developing);

  return (
    <main className="observatory" data-started={started}>
      <canvas ref={canvasRef} className="sky" aria-label={`${city.name}上空的星轨长曝光`} />

      {snapshot && <PoleDial pole={snapshot.pole} rotationDeg={snapshot.rotationDeg} show={started} />}

      <section className="opening" aria-hidden={started} inert={started}>
        <h1 className="opening__title">
          <span className="opening__zh">星轨</span>
          <span className="opening__en">Star Trails</span>
        </h1>

        <div className="opening__intro">
          <p className="opening__lead">
            选一个地点、一个夜晚。
            <br />
            真实星表会算出那一夜，天空绕着天极转过的每一道弧。
          </p>
          <div className="opening__date">
            <span className="field-label">日期</span>
            <DateField value={date} onChange={setDate} />
          </div>
          <button type="button" className="shutter" onClick={begin} disabled={!ready}>
            <Aperture aria-hidden="true" />
            <span>{ready ? '开始曝光' : '正在载入星表'}</span>
          </button>
        </div>

        <div className="opening__sites">
          <p className="field-label">观测地，由北向南</p>
          <SitePicker value={cityIndex} onChange={setCityIndex} />
        </div>
      </section>

      <section className="hud" aria-hidden={!started} inert={!started}>
        <div className="masthead" aria-label="星轨 Star Trails">
          <span className="masthead__zh">星轨</span>
          <span className="masthead__en">Star Trails</span>
        </div>

        <button type="button" className="site-card" onClick={() => setDrawerOpen(true)} aria-label="打开观测设置">
          <span className="site-card__name">{city.name}</span>
          <span className="site-card__coord">
            {formatCoordinate(city.lat, 'N', 'S')} {formatCoordinate(city.lon, 'E', 'W')}
          </span>
          <span className="site-card__meta">
            {y}年{m}月{d}日夜
          </span>
          <span className="site-card__meta">
            {lens.focal}mm {aim}
          </span>
          <span className="site-card__edit">
            <SlidersHorizontal aria-hidden="true" />
            调整
          </span>
        </button>

        <Poem progress={snapshot?.progress ?? 0} />

        <footer className="deck">
          <dl className="readouts">
            <div className="readout readout--primary">
              <dt>曝光</dt>
              <dd>
                {Math.floor(elapsed / 60)}
                <small>小时</small>
                {pad2(elapsed % 60)}
                <small>分</small>
              </dd>
            </div>
            <div className="readout">
              <dt>天球转过</dt>
              <dd>
                {(snapshot?.rotationDeg ?? 0).toFixed(1)}
                <small>°</small>
              </dd>
            </div>
            <div className="readout readout--minor">
              <dt>画面里的星</dt>
              <dd>
                {snapshot?.starsInFrame ?? 0}
                <small>颗</small>
              </dd>
            </div>
            <p className="readouts__status" data-visible={developing} aria-live="polite">
              {developing ? `正在显影 ${Math.round((snapshot?.developed ?? 0) / Math.max(snapshot?.progress ?? 1, 0.001) * 100)}%` : ''}
            </p>
          </dl>

          {night && snapshot && (
            <NightBand
              night={night}
              progress={snapshot.progress}
              developed={snapshot.developed}
              clock={snapshot.clock}
              onSeek={handleSeek}
            />
          )}

          <div className="controls">
            <div className="controls__group">
              <button
                type="button"
                className="round-button round-button--primary"
                onClick={togglePlay}
                aria-label={playing ? '暂停曝光' : snapshot?.finished ? '重新曝光' : '继续曝光'}
              >
                {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
              </button>
              <button type="button" className="text-button" onClick={() => engineRef.current?.restart()}>
                <RotateCcw aria-hidden="true" />
                <span>重新曝光</span>
              </button>
            </div>
            <div className="controls__group">
              <button
                type="button"
                className="round-button"
                onClick={toggleSound}
                aria-pressed={sound}
                aria-label={sound ? '关闭夜风与虫鸣' : '打开夜风与虫鸣'}
              >
                {sound ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
              </button>
              <button type="button" className="round-button" onClick={share} aria-label="复制分享链接">
                <Share2 aria-hidden="true" />
              </button>
              <button
                type="button"
                className="text-button text-button--outlined"
                onClick={exportPlate}
                data-ready={snapshot?.finished ?? false}
              >
                <Download aria-hidden="true" />
                <span>导出底片</span>
              </button>
            </div>
          </div>
        </footer>
      </section>

      <SetupDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        cityIndex={cityIndex}
        onCity={setCityIndex}
        date={date}
        onDate={setDate}
        fovDeg={fovDeg}
        onFov={setFovDeg}
        mode={mode}
        onMode={setMode}
        speedSec={speedSec}
        onSpeed={setSpeedSec}
      />

      <p className="toast" role="status" data-visible={toast !== null}>
        {toast}
      </p>

      {failed && (
        <div className="fallback" role="alert">
          <h2>这台设备暂时冲洗不出底片</h2>
          <p>星轨需要 WebGL2 与 WebAssembly。请开启浏览器的硬件加速，或换用新版 Chrome、Edge、Safari 后重新打开。</p>
          <button type="button" className="text-button text-button--outlined" onClick={() => window.location.reload()}>
            重新载入
          </button>
        </div>
      )}
    </main>
  );
};
