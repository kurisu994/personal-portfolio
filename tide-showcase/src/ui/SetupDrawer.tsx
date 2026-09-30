import React, { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { CameraMode } from '../scene/Director';
import { shiftDate } from '../tide/day';
import { CoastPicker } from './CoastPicker';

interface DateFieldProps {
  value: string;
  onChange: (date: string) => void;
}

/** 日期：原生日期选择 + 前后一天 */
export const DateField: React.FC<DateFieldProps> = ({ value, onChange }) => (
  <div className="date-field">
    <button type="button" className="date-field__step" onClick={() => onChange(shiftDate(value, -1))} aria-label="前一天">
      <ChevronLeft aria-hidden="true" />
    </button>
    <input
      type="date"
      value={value}
      min="1950-01-01"
      max="2100-12-31"
      aria-label="日期"
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
export function Choice<T extends string | number>({
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
  coastIndex: number;
  onCoast: (index: number) => void;
  date: string;
  onDate: (date: string) => void;
  camera: CameraMode;
  onCamera: (mode: CameraMode) => void;
  speed: number;
  onSpeed: (speed: number) => void;
}

/** 设置抽屉：海岸、日期、镜头、时间流速 */
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
      <aside className="drawer" data-open={open} aria-hidden={!open} inert={!open} aria-label="设置">
        <header className="drawer__head">
          <h2>海岸与时间</h2>
          <button ref={closeRef} type="button" className="round-button" onClick={onClose} aria-label="关闭设置">
            <X aria-hidden="true" />
          </button>
        </header>

        <section className="drawer__section">
          <h3>海岸</h3>
          <CoastPicker value={props.coastIndex} onChange={props.onCoast} compact />
        </section>

        <section className="drawer__section">
          <h3>日期</h3>
          <DateField value={props.date} onChange={props.onDate} />
        </section>

        <section className="drawer__section">
          <h3>镜头</h3>
          <Choice
            label="镜头"
            value={props.camera}
            onChange={props.onCamera}
            options={[
              { value: 'auto', label: '沿岸漫步', hint: '自动' },
              { value: 'fixed', label: '蹲在水边', hint: '固定' },
              { value: 'free', label: '自己看', hint: '拖拽与缩放' },
            ]}
          />
        </section>

        <section className="drawer__section">
          <h3>时间流速</h3>
          <Choice
            label="时间流速"
            value={props.speed}
            onChange={props.onSpeed}
            options={[
              { value: 200, label: '1:200', hint: '一次涨落约 4 分钟' },
              { value: 600, label: '1:600', hint: '一个潮日约 2.5 分钟' },
              { value: 3000, label: '1:3000', hint: '大潮到小潮约 7 分钟' },
            ]}
          />
        </section>

        <p className="drawer__credit">
          潮位由 M2、S2、K1、O1 等分潮的谐波合成，天文相角取自日月平经度，大小潮随真实月相出现。分潮振幅是典型值，不是某个港口的实测常数。
        </p>
      </aside>
    </>
  );
};
