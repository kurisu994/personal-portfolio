import React from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';

interface TimelineProps {
  progress: number;
  onProgressChange: (val: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  currentTimeStr: string;
  speedSec: number;
  onSpeedChange: (sec: number) => void;
  onResetExposure: () => void;
}

export const Timeline: React.FC<TimelineProps> = ({
  progress,
  onProgressChange,
  isPlaying,
  onTogglePlay,
  currentTimeStr,
  speedSec,
  onSpeedChange,
  onResetExposure,
}) => {
  return (
    <div className="timeline panel">
      <button
        className="btn-circle"
        onClick={onTogglePlay}
        title={isPlaying ? '暂停' : '播放'}
      >
        {isPlaying ? <Pause size={16} /> : <Play size={16} />}
      </button>

      <button
        className="btn-action"
        onClick={onResetExposure}
        title="清空当前曝光重新开始"
        style={{ padding: '6px 8px' }}
      >
        <RotateCcw size={13} />
        <span>重置曝光</span>
      </button>

      <div className="slider-container">
        <input
          type="range"
          className="slider"
          min="0"
          max="1"
          step="0.001"
          value={progress}
          onChange={(e) => onProgressChange(parseFloat(e.target.value))}
        />
      </div>

      <div className="time-readout">{currentTimeStr}</div>

      <div className="field" style={{ marginLeft: 6 }}>
        <select
          value={speedSec}
          onChange={(e) => onSpeedChange(parseFloat(e.target.value))}
          style={{ padding: '3px 6px', fontSize: 11 }}
        >
          <option value={15}>15秒/夜</option>
          <option value={60}>60秒/夜</option>
          <option value={180}>180秒/夜</option>
        </select>
      </div>
    </div>
  );
};
