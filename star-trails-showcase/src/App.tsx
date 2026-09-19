import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Volume2, VolumeX, Share2, Download } from 'lucide-react';
import { CITIES } from './data/cities';
import { Controls } from './ui/Controls';
import { Timeline } from './ui/Timeline';
import { Poem } from './ui/Poem';
import {
  initAstro,
  getNightWindow,
  compute_star_positions,
  NightWindow,
} from './wasm/bridge';
import { StarTrailsRenderer } from './gl/renderer';
import { NightscapeAudio } from './audio/nightscape';

export const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<StarTrailsRenderer | null>(null);
  const audioRef = useRef<NightscapeAudio | null>(null);

  // 状态管理
  const [cityIndex, setCityIndex] = useState(0);
  const [dateStr, setDateStr] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [fovDeg, setFovDeg] = useState(60);
  const [mode, setMode] = useState(0); // 0: 透视, 1: 全天域
  const [progress, setProgress] = useState(0.25);
  const [isPlaying, setIsPlaying] = useState(true);
  const [speedSec, setSpeedSec] = useState(60);
  const [soundActive, setSoundActive] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [currentTimeStr, setCurrentTimeStr] = useState('00:00');

  const nightWindowRef = useRef<NightWindow | null>(null);
  const starBufferRef = useRef<Float32Array>(new Float32Array(1600 * 6));
  const animIdRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(performance.now());
  const progressRef = useRef(progress);
  progressRef.current = progress;

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2600);
  }, []);

  // 1. 初始化 URL 参数
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('lat') && params.has('lon')) {
      const lat = parseFloat(params.get('lat')!);
      const lon = parseFloat(params.get('lon')!);
      let bestIdx = 0;
      let minDiff = 9999;
      CITIES.forEach((c, idx) => {
        const d = Math.hypot(c.lat - lat, c.lon - lon);
        if (d < minDiff) {
          minDiff = d;
          bestIdx = idx;
        }
      });
      setCityIndex(bestIdx);
    }
    if (params.has('date')) setDateStr(params.get('date')!);
    if (params.has('fov')) setFovDeg(parseFloat(params.get('fov')!));
    if (params.has('mode')) setMode(parseInt(params.get('mode')!, 10));
  }, []);

  // 2. 更新 URL
  const updateUrl = useCallback(
    (cIdx: number, dStr: string, fov: number, m: number) => {
      const c = CITIES[cIdx];
      const p = new URLSearchParams();
      p.set('lat', c.lat.toFixed(4));
      p.set('lon', c.lon.toFixed(4));
      p.set('date', dStr);
      p.set('fov', fov.toString());
      p.set('mode', m.toString());
      window.history.replaceState(null, '', '?' + p.toString());
    },
    []
  );

  // 3. 计算一夜时间窗口
  const recalculateNight = useCallback(
    (cIdx: number, dStr: string) => {
      const c = CITIES[cIdx];
      const [y, m, d] = dStr.split('-').map((v) => parseInt(v, 10));
      const win = getNightWindow(c.lat, c.lon, y, m, d);
      nightWindowRef.current = win;

      if (win.durationHours <= 0.5) {
        showToast('该地点当前日期处于极昼，黑夜极短');
      } else if (win.durationHours >= 23.5) {
        showToast('该地点当前日期处于极夜');
      }

      // 重置曝光缓冲区
      if (rendererRef.current) {
        rendererRef.current.clearExposure();
      }
    },
    [showToast]
  );

  // 4. 初始化 WebGL 与 WASM
  useEffect(() => {
    let disposed = false;
    audioRef.current = new NightscapeAudio();

    async function setup() {
      await initAstro();
      if (disposed || !canvasRef.current) return;

      const canvas = canvasRef.current;
      const renderer = new StarTrailsRenderer(canvas);
      rendererRef.current = renderer;

      const handleResize = () => {
        const dpr = window.devicePixelRatio || 1;
        const w = window.innerWidth;
        const h = window.innerHeight;
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
        renderer.resize(canvas.width, canvas.height, dpr);
      };

      window.addEventListener('resize', handleResize);
      handleResize();

      recalculateNight(cityIndex, dateStr);

      // 启动渲染循环
      const renderLoop = (time: number) => {
        animIdRef.current = requestAnimationFrame(renderLoop);
        const delta = (time - lastTimeRef.current) / 1000;
        lastTimeRef.current = time;

        const win = nightWindowRef.current;
        if (!win) return;

        if (isPlaying) {
          const nextProg = (progressRef.current + delta / speedSec) % 1.0;
          progressRef.current = nextProg;
          setProgress(nextProg);
        }

        const currentProg = progressRef.current;
        const currentJd =
          win.sunset + (win.sunrise - win.sunset) * currentProg;

        // 更新时间文字
        const city = CITIES[cityIndex];
        const utHours =
          ((currentJd - Math.floor(currentJd) + 0.5) % 1.0) * 24;
        const localHours = (utHours + city.lon / 15 + 24) % 24;
        const hh = Math.floor(localHours).toString().padStart(2, '0');
        const mm = Math.floor((localHours % 1) * 60)
          .toString()
          .padStart(2, '0');
        setCurrentTimeStr(`${hh}:${mm}`);

        // 调用 WASM 计算当前时刻星位
        const count = compute_star_positions(
          (city.lat * Math.PI) / 180,
          (city.lon * Math.PI) / 180,
          currentJd,
          mode,
          fovDeg,
          starBufferRef.current
        );

        // 累积曝光与后处理合成
        renderer.accumulateStars(starBufferRef.current, count);
        renderer.composite(mode === 1, currentProg);
      };

      lastTimeRef.current = performance.now();
      animIdRef.current = requestAnimationFrame(renderLoop);
    }

    setup();

    return () => {
      disposed = true;
      if (animIdRef.current) cancelAnimationFrame(animIdRef.current);
      if (rendererRef.current) rendererRef.current.dispose();
      if (audioRef.current) audioRef.current.dispose();
    };
  }, []);

  // 5. 交互回调
  const handleCityChange = (idx: number) => {
    setCityIndex(idx);
    recalculateNight(idx, dateStr);
    updateUrl(idx, dateStr, fovDeg, mode);
  };

  const handleDateChange = (d: string) => {
    setDateStr(d);
    recalculateNight(cityIndex, d);
    updateUrl(cityIndex, d, fovDeg, mode);
  };

  const handleFovChange = (f: number) => {
    setFovDeg(f);
    if (rendererRef.current) rendererRef.current.clearExposure();
    updateUrl(cityIndex, dateStr, f, mode);
  };

  const handleModeChange = (m: number) => {
    setMode(m);
    if (rendererRef.current) rendererRef.current.clearExposure();
    updateUrl(cityIndex, dateStr, fovDeg, m);
  };

  const handleResetExposure = () => {
    if (rendererRef.current) {
      rendererRef.current.clearExposure();
      showToast('已重置并清空曝光底片');
    }
  };

  const handleToggleSound = async () => {
    if (audioRef.current) {
      const active = await audioRef.current.toggle();
      setSoundActive(active);
    }
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    showToast('已将分享链接复制到剪贴板');
  };

  const handleExport = () => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const link = document.createElement('a');
    link.download = `star-trails-showcase-${dateStr}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('已成功导出星轨曝光图像');
  };

  return (
    <div className="stage">
      <canvas ref={canvasRef} className="stage__canvas" />

      <div className="hud">
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 16,
          }}
        >
          <div className="brand">
            <h1 className="brand__title">星轨</h1>
            <span className="brand__en">STAR TRAILS · SHOWCASE</span>
            <div className="brand__tag">
              <span className="brand__dot" />
              <span>WASM 天文内核 · WebGL2 加性累积曝光</span>
            </div>
          </div>

          <Controls
            cityIndex={cityIndex}
            onCityChange={handleCityChange}
            dateStr={dateStr}
            onDateChange={handleDateChange}
            fovDeg={fovDeg}
            onFovChange={handleFovChange}
            mode={mode}
            onModeChange={handleModeChange}
          />
        </header>

        <div className="bottom-container">
          <Timeline
            progress={progress}
            onProgressChange={(val) => {
              progressRef.current = val;
              setProgress(val);
            }}
            isPlaying={isPlaying}
            onTogglePlay={() => setIsPlaying((p) => !p)}
            currentTimeStr={currentTimeStr}
            speedSec={speedSec}
            onSpeedChange={setSpeedSec}
            onResetExposure={handleResetExposure}
          />

          <div className="footer-bar">
            <Poem />

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className={`btn-action ${soundActive ? 'active' : ''}`}
                onClick={handleToggleSound}
                title="环境音景"
              >
                {soundActive ? <Volume2 size={14} /> : <VolumeX size={14} />}
                <span>夜风虫鸣</span>
              </button>

              <button
                className="btn-action"
                onClick={handleShare}
                title="分享作品"
              >
                <Share2 size={14} />
                <span>分享</span>
              </button>

              <button
                className="btn-action"
                onClick={handleExport}
                title="导出作品图像"
              >
                <Download size={14} />
                <span>导出图片</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={`toast ${toastMsg ? 'toast--visible' : ''}`}>
        {toastMsg}
      </div>
    </div>
  );
};
