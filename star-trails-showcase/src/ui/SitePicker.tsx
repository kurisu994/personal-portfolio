import React, { useId, useMemo } from 'react';
import { CITIES } from '../data/cities';

/**
 * 纬度小样：天极离地平线的高度等于纬度，
 * 高纬是整圆、赤道是贴地的半圆，一眼看出这里的星轨长什么样。
 */
export const TrailGlyph: React.FC<{ lat: number }> = ({ lat }) => {
  const horizon = 19;
  const cy = horizon - (Math.abs(lat) / 90) * 15;
  // 开场与抽屉会同时渲染同一组小样，clipPath 的 id 必须唯一
  const id = `glyph-${useId()}`;
  return (
    <svg className="trail-glyph" viewBox="0 0 30 22" aria-hidden="true">
      <defs>
        <clipPath id={id}>
          <rect x="0" y="0" width="30" height={horizon} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id})`} fill="none" stroke="currentColor" strokeWidth="1">
        {[3.5, 7, 10.5].map((r) => (
          <circle key={r} cx="15" cy={cy} r={r} />
        ))}
      </g>
      <line x1="2" y1={horizon + 0.5} x2="28" y2={horizon + 0.5} stroke="currentColor" strokeWidth="1" opacity="0.5" />
    </svg>
  );
};

interface SitePickerProps {
  value: number;
  onChange: (index: number) => void;
  compact?: boolean;
}

/** 观测地列表：按纬度由北向南排列 */
export const SitePicker: React.FC<SitePickerProps> = ({ value, onChange, compact }) => {
  const order = useMemo(
    () => CITIES.map((c, i) => ({ c, i })).sort((a, b) => b.c.lat - a.c.lat),
    [],
  );

  const move = (event: React.KeyboardEvent<HTMLButtonElement>, pos: number) => {
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = order[(pos + step + order.length) % order.length];
    onChange(next.i);
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button');
    buttons?.[(pos + step + order.length) % order.length]?.focus();
  };

  return (
    <div className={`sites${compact ? ' sites--compact' : ''}`} role="radiogroup" aria-label="观测地">
      {order.map(({ c, i }, pos) => (
        <button
          key={c.nameEn}
          type="button"
          role="radio"
          aria-checked={value === i}
          tabIndex={value === i ? 0 : -1}
          className="site"
          onClick={() => onChange(i)}
          onKeyDown={(e) => move(e, pos)}
        >
          <TrailGlyph lat={c.lat} />
          <span className="site__name">{c.name}</span>
          <span className="site__lat">{Math.round(Math.abs(c.lat))}°{c.lat >= 0 ? 'N' : 'S'}</span>
          {!compact && <span className="site__note">{c.description}</span>}
        </button>
      ))}
    </div>
  );
};
