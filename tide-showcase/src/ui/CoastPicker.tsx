import React, { useMemo } from 'react';
import { COASTS, type Coast } from '../data/coasts';
import { tideEnvelope } from '../tide/day';
import { tideHeight } from '../tide/model';

/** 统一纵向比例：三种海岸的潮差大小一眼可比 */
const MAX_AMP = Math.max(...COASTS.map((c) => tideEnvelope(c).max));
/** 取一个望日前后的两天作为小样，大潮时潮型最清楚 */
const SAMPLE_JD = 2461310.2;

/** 潮型小样：48 小时潮位曲线 */
export const TideGlyph: React.FC<{ coast: Coast }> = ({ coast }) => {
  const d = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i <= 96; i++) {
      const h = tideHeight(coast.model, SAMPLE_JD + i / 48, coast.lon);
      pts.push(`${((i / 96) * 44).toFixed(1)},${(11 - (h / MAX_AMP) * 9).toFixed(1)}`);
    }
    return `M${pts.join('L')}`;
  }, [coast]);
  return (
    <svg className="tide-glyph" viewBox="0 0 44 22" aria-hidden="true">
      <line x1="0" y1="11" x2="44" y2="11" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
};

interface CoastPickerProps {
  value: number;
  onChange: (index: number) => void;
  compact?: boolean;
}

/** 海岸列表：单选，方向键切换 */
export const CoastPicker: React.FC<CoastPickerProps> = ({ value, onChange, compact }) => {
  const move = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + COASTS.length) % COASTS.length;
    onChange(next);
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  };

  return (
    <div className={`coasts${compact ? ' coasts--compact' : ''}`} role="radiogroup" aria-label="海岸">
      {COASTS.map((c, i) => {
        const env = tideEnvelope(c);
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={value === i}
            tabIndex={value === i ? 0 : -1}
            className="coast"
            onClick={() => onChange(i)}
            onKeyDown={(e) => move(e, i)}
          >
            <TideGlyph coast={c} />
            <span className="coast__name">{c.name}</span>
            <span className="coast__range">{(env.max - env.min).toFixed(1)} m</span>
            {!compact && <span className="coast__note">{c.description}</span>}
          </button>
        );
      })}
    </div>
  );
};
