import React, { useMemo, useRef } from 'react';
import type { TideDay } from '../tide/day';

interface TideTableProps {
  day: TideDay;
  /** 纵向比例：海岸潮位的理论上下限 */
  envelope: { min: number; max: number };
  datum: number;
  jd: number;
  clock: string;
  onSeek: (jd: number) => void;
}

/**
 * 潮汐表：一天的潮位曲线叠在日照色带上，标出高低潮的时刻与潮高；
 * 拖动或方向键改变时间。
 */
export const TideTable: React.FC<TideTableProps> = ({ day, envelope, datum, jd, clock, onSeek }) => {
  const plotRef = useRef<HTMLDivElement>(null);
  const span = day.end - day.start;
  const p = Math.min(1, Math.max(0, (jd - day.start) / span));
  const pad = 0.12;
  const toY = (h: number) => (1 - pad - ((h - envelope.min) / (envelope.max - envelope.min)) * (1 - pad * 2)) * 100;

  const { min, max } = envelope;
  const paths = useMemo(() => {
    const y = (h: number) => (1 - pad - ((h - min) / (max - min)) * (1 - pad * 2)) * 100;
    const line = day.curve.map(([x, h], i) => `${i ? 'L' : 'M'}${(x * 1000).toFixed(1)},${y(h).toFixed(2)}`).join('');
    return { line, area: `${line}L1000,100L0,100Z` };
  }, [day, min, max]);

  const seekAt = (clientX: number) => {
    const rect = plotRef.current?.getBoundingClientRect();
    if (!rect) return;
    onSeek(day.start + span * Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = (event.shiftKey ? 60 : 10) / 1440;
    const map: Record<string, number> = { ArrowLeft: jd - step, ArrowRight: jd + step, Home: day.start, End: day.end - 1 / 1440 };
    if (!(event.key in map)) return;
    event.preventDefault();
    onSeek(map[event.key]);
  };

  return (
    <div className="table">
      <div
        ref={plotRef}
        className="table__plot"
        role="slider"
        tabIndex={0}
        aria-label="时间"
        aria-valuemin={0}
        aria-valuemax={1440}
        aria-valuenow={Math.round(p * 1440)}
        aria-valuetext={`当地时间 ${clock}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seekAt(e.clientX);
        }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && seekAt(e.clientX)}
        onKeyDown={onKeyDown}
      >
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" x2="1000" y1={toY(0)} y2={toY(0)} className="table__msl" />
          <path d={paths.area} className="table__area" />
          <path d={paths.line} className="table__line" />
        </svg>
        {day.extrema.map((e) => (
          <span
            key={e.jd}
            className={`table__mark table__mark--${e.kind}`}
            style={{ left: `${e.p * 100}%`, top: `${toY(e.height)}%` }}
          >
            <b>{e.clock}</b>
            <i>{(e.height - datum).toFixed(1)} m</i>
          </span>
        ))}
        <span className="table__head" style={{ left: `${p * 100}%` }}>
          <b>{clock}</b>
        </span>
      </div>
      <div className="table__day" style={{ backgroundImage: day.gradient }} aria-hidden="true" />
      <div className="table__hours" aria-hidden="true">
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
          <span key={h} style={{ left: `${(h / 24) * 100}%` }}>
            {String(h % 24).padStart(2, '0')}
          </span>
        ))}
      </div>
    </div>
  );
};
