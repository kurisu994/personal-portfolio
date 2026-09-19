import React from 'react';
import { CITIES } from '../data/cities';

interface ControlsProps {
  cityIndex: number;
  onCityChange: (index: number) => void;
  dateStr: string;
  onDateChange: (date: string) => void;
  fovDeg: number;
  onFovChange: (fov: number) => void;
  mode: number;
  onModeChange: (mode: number) => void;
}

export const Controls: React.FC<ControlsProps> = ({
  cityIndex,
  onCityChange,
  dateStr,
  onDateChange,
  fovDeg,
  onFovChange,
  mode,
  onModeChange,
}) => {
  return (
    <div className="panel">
      <div className="field">
        <label className="field__label">观测地点</label>
        <select
          value={cityIndex}
          onChange={(e) => onCityChange(parseInt(e.target.value, 10))}
        >
          {CITIES.map((c, i) => (
            <option key={c.name} value={i}>
              {c.name} ({c.nameEn})
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label className="field__label">观测日期</label>
        <input
          type="date"
          value={dateStr}
          min="1900-01-01"
          max="2100-12-31"
          onChange={(e) => onDateChange(e.target.value)}
        />
      </div>

      <div className="field">
        <label className="field__label">视场角 (FOV)</label>
        <select
          value={fovDeg}
          onChange={(e) => onFovChange(parseFloat(e.target.value))}
        >
          <option value={40}>40° 望远端</option>
          <option value={60}>60° 标准天极</option>
          <option value={85}>85° 广角苍穹</option>
          <option value={110}>110° 超广角</option>
        </select>
      </div>

      <div className="field">
        <label className="field__label">投影视界</label>
        <select
          value={mode}
          onChange={(e) => onModeChange(parseInt(e.target.value, 10))}
        >
          <option value={0}>天极透视投影</option>
          <option value={1}>全天域立体投影</option>
        </select>
      </div>
    </div>
  );
};
