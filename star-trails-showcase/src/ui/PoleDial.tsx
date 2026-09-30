import React from 'react';
import type { ExposureSnapshot } from '../engine/NightExposure';

interface PoleDialProps {
  pole: ExposureSnapshot['pole'];
  rotationDeg: number;
  show: boolean;
}

const R = 46;
const ARC_R = 56;
const SIZE = 150;
const C = SIZE / 2;

function polar(angleDeg: number, r: number): [number, number] {
  const a = (angleDeg - 90) * (Math.PI / 180);
  return [C + Math.cos(a) * r, C + Math.sin(a) * r];
}

/**
 * 天极刻度盘：像赤道仪上的时角盘，24 格随天球一起转；
 * 外圈弧线是这次曝光里天球已经转过的角度。北天极逆时针、南天极顺时针。
 */
export const PoleDial: React.FC<PoleDialProps> = ({ pole, rotationDeg, show }) => {
  const dir = pole.south ? 1 : -1;
  const now = dir * pole.angle;
  const sweep = Math.min(rotationDeg, 359.9);
  const start = now - dir * sweep;
  const [sx, sy] = polar(start, ARC_R);
  const [ex, ey] = polar(now, ARC_R);
  const large = sweep > 180 ? 1 : 0;
  const clockwise = dir > 0 ? 1 : 0;
  const [mx, my] = polar(now, R);

  return (
    <div
      className="pole-dial"
      data-visible={show && pole.visible}
      style={{ transform: `translate(${pole.x - C}px, ${pole.y - C}px)` }}
      aria-hidden="true"
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <circle cx={C} cy={C} r={R} className="pole-dial__ring" />
        <g transform={`rotate(${now} ${C} ${C})`}>
          {Array.from({ length: 24 }, (_, i) => {
            const major = i % 6 === 0;
            const [x1, y1] = polar(i * 15, R);
            const [x2, y2] = polar(i * 15, R - (major ? 7 : 3.5));
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className={major ? 'pole-dial__major' : 'pole-dial__minor'} />;
          })}
        </g>
        {sweep > 0.5 && (
          <path
            d={`M ${sx} ${sy} A ${ARC_R} ${ARC_R} 0 ${large} ${clockwise} ${ex} ${ey}`}
            className="pole-dial__arc"
          />
        )}
        <circle cx={mx} cy={my} r="2.2" className="pole-dial__mark" />
        <circle cx={C} cy={C} r="1.6" className="pole-dial__center" />
      </svg>
      <span className="pole-dial__label">{pole.south ? '南天极' : '北天极'}</span>
    </div>
  );
};
