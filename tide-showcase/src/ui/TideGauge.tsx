import React from 'react';

interface TideGaugeProps {
  /** 当前潮位（米，相对平均海面） */
  level: number;
  rising: boolean;
  datum: number;
  /** 标尺顶端（米，相对海图基准面） */
  top: number;
}

/**
 * 水尺：港口码头上那种 E 字刻度的潮位标尺，读数从海图基准面起算。
 * 水面以下的刻度被「淹没」变淡，水位线随潮涨落。
 */
export const TideGauge: React.FC<TideGaugeProps> = ({ level, rising, datum, top }) => {
  const height = level - datum;
  const toY = (m: number) => ((top - m) / top) * 100;
  const decimeters = Array.from({ length: Math.round(top * 10) }, (_, i) => i);
  return (
    <div className="gauge" aria-label={`潮高 ${height.toFixed(2)} 米，${rising ? '正在涨潮' : '正在落潮'}`} role="img">
      <svg viewBox="0 0 40 100" preserveAspectRatio="none" aria-hidden="true">
        <line x1="4" x2="4" y1="0" y2="100" className="gauge__spine" />
        {decimeters.map((d) => {
          const y0 = toY((d + 1) / 10);
          const y1 = toY(d / 10);
          const meter = d % 10 === 9;
          // E 字：每 10 厘米里上半截是一根横臂，每米换一侧颜色
          return (
            <rect
              key={d}
              x="4"
              y={y0}
              width={meter ? 22 : d % 5 === 4 ? 16 : 11}
              height={(y1 - y0) / 2}
              className={(d / 10) < height ? 'gauge__bar gauge__bar--under' : 'gauge__bar'}
            />
          );
        })}
        <rect x="0" y={toY(height)} width="40" height={100 - toY(height)} className="gauge__water" />
        <line x1="0" x2="40" y1={toY(height)} y2={toY(height)} className="gauge__level" />
      </svg>
      <div className="gauge__labels" aria-hidden="true">
        {Array.from({ length: Math.floor(top) + 1 }, (_, m) => (
          <span key={m} style={{ top: `${toY(m)}%` }}>
            {m}
          </span>
        ))}
      </div>
      <p className="gauge__reading" style={{ top: `${toY(height)}%` }}>
        <b>{height.toFixed(2)}</b>
        <small>m {rising ? '涨' : '落'}</small>
      </p>
    </div>
  );
};
