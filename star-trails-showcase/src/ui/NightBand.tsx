import React, { useEffect, useRef, useState } from 'react';
import type { NightInfo } from '../astro/night';

interface NightBandProps {
  night: NightInfo;
  progress: number;
  developed: number;
  clock: string;
  onSeek: (progress: number) => void;
}

/**
 * 夜晚色带：颜色取自每一刻的太阳高度（暮光到全黑再到晨光），
 * 拖动即改变曝光终点，底片会从日落重新显影到这里。
 */
export const NightBand: React.FC<NightBandProps> = ({ night, progress, developed, clock, onSeek }) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 播放头的时间标签靠近两端时，让出日落 / 日出文字
  const headX = progress * width;
  const coverStart = width > 0 && headX < 112;
  const coverEnd = width > 0 && width - headX < 112;

  const seekFromPointer = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    onSeek(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)));
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    seekFromPointer(event.clientX);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) seekFromPointer(event.clientX);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 1 / Math.max(night.hours * 4, 8);
    const map: Record<string, number> = {
      ArrowLeft: progress - step,
      ArrowRight: progress + step,
      Home: 0,
      End: 1,
    };
    if (!(event.key in map)) return;
    event.preventDefault();
    onSeek(Math.min(1, Math.max(0, map[event.key])));
  };

  const [startText, endText] =
    night.kind === 'polar-night'
      ? ['极夜 正午', '次日正午']
      : night.kind === 'polar-day'
        ? ['极昼 太阳不落', '']
        : [`日落 ${night.startLabel}`, `日出 ${night.endLabel}`];

  return (
    <div className="band">
      <div className="band__ends" aria-hidden="true">
        <span data-covered={coverStart}>{startText}</span>
        <span data-covered={coverEnd}>{endText}</span>
      </div>
      <div
        ref={trackRef}
        className="band__track"
        role="slider"
        tabIndex={0}
        aria-label="曝光终点"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-valuetext={`当地时间 ${clock}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
      >
        <div className="band__sky" style={{ backgroundImage: night.gradient }} />
        <div className="band__developed" style={{ transform: `scaleX(${developed})` }} />
        {night.ticks.map((tick) => (
          <span key={tick.p} className="band__tick" style={{ left: `${tick.p * 100}%` }}>
            <i>{tick.label}</i>
          </span>
        ))}
        <span className="band__head" style={{ left: `${progress * 100}%` }}>
          <b>{clock}</b>
        </span>
      </div>
    </div>
  );
};
