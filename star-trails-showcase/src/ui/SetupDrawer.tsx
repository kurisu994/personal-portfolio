import React, { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { LENSES } from '../data/cities';
import { SitePicker } from './SitePicker';

/** 日期加减一天，保持 YYYY-MM-DD */
function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  const clamped = Math.min(Math.max(next.getTime(), Date.UTC(1900, 0, 1)), Date.UTC(2100, 11, 30));
  return new Date(clamped).toISOString().slice(0, 10);
}

interface DateFieldProps {
  value: string;
  onChange: (date: string) => void;
}

/** 观测日期：原生日期选择 + 前后一天 */
export const DateField: React.FC<DateFieldProps> = ({ value, onChange }) => (
  <div className="date-field">
    <button type="button" className="date-field__step" onClick={() => onChange(shiftDate(value, -1))} aria-label="前一天">
      <ChevronLeft aria-hidden="true" />
    </button>
    <input
      type="date"
      value={value}
      min="1900-01-01"
      max="2100-12-31"
      aria-label="观测日期"
      onChange={(e) => e.target.value && onChange(e.target.value)}
    />
    <button type="button" className="date-field__step" onClick={() => onChange(shiftDate(value, 1))} aria-label="后一天">
      <ChevronRight aria-hidden="true" />
    </button>
  </div>
);

interface Option<T> {
  value: T;
  label: string;
  hint?: string;
}

/** 单选分段 */
function Choice<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="choice" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className="choice__item"
          onClick={() => onChange(o.value)}
        >
          <span>{o.label}</span>
          {o.hint && <small>{o.hint}</small>}
        </button>
      ))}
    </div>
  );
}

interface SetupDrawerProps {
  open: boolean;
  onClose: () => void;
  cityIndex: number;
  onCity: (index: number) => void;
  date: string;
  onDate: (date: string) => void;
  fovDeg: number;
  onFov: (fov: number) => void;
  mode: 0 | 1;
  onMode: (mode: 0 | 1) => void;
  speedSec: number;
  onSpeed: (sec: number) => void;
}

/** 观测设置抽屉：地点、日期、镜头、视角、速度 */
export const SetupDrawer: React.FC<SetupDrawerProps> = (props) => {
  const { open, onClose } = props;
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      <div className="drawer-scrim" data-open={open} onClick={onClose} aria-hidden="true" />
      <aside className="drawer" data-open={open} aria-hidden={!open} inert={!open} aria-label="观测设置">
        <header className="drawer__head">
          <h2>观测设置</h2>
          <button ref={closeRef} type="button" className="round-button" onClick={onClose} aria-label="关闭观测设置">
            <X aria-hidden="true" />
          </button>
        </header>

        <section className="drawer__section">
          <h3>观测地</h3>
          <SitePicker value={props.cityIndex} onChange={props.onCity} compact />
        </section>

        <section className="drawer__section">
          <h3>日期</h3>
          <DateField value={props.date} onChange={props.onDate} />
        </section>

        <section className="drawer__section">
          <h3>镜头</h3>
          <Choice
            label="镜头"
            value={props.fovDeg}
            onChange={props.onFov}
            options={LENSES.map((l) => ({ value: l.fov, label: `${l.focal}mm`, hint: l.name }))}
          />
        </section>

        <section className="drawer__section">
          <h3>朝向</h3>
          <Choice
            label="朝向"
            value={props.mode}
            onChange={props.onMode}
            options={[
              { value: 0, label: '对准天极', hint: '同心圆弧' },
              { value: 1, label: '仰望天顶', hint: '整片天空' },
            ]}
          />
        </section>

        <section className="drawer__section">
          <h3>一夜压缩成</h3>
          <Choice
            label="一夜压缩成"
            value={props.speedSec}
            onChange={props.onSpeed}
            options={[
              { value: 15, label: '15 秒' },
              { value: 60, label: '1 分钟' },
              { value: 180, label: '3 分钟' },
            ]}
          />
        </section>

        <p className="drawer__credit">
          1600 颗亮星取自 Yale 亮星星表第五版，位置由 Rust 编写的 Meeus 天文算法逐刻推算。
        </p>
      </aside>
    </>
  );
};
