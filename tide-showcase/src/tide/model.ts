//! 谐波潮汐模型：h(t) = Z0 + Σ Aᵢ·cos(Vᵢ(t) − gᵢ)
//!
//! 各分潮的天文相角 V 用 Doodson 平均经度构造：
//!   τ 平太阴时、s 月球平经度、h 太阳平经度、p 月球近地点平经度、T 平太阳时。
//! M2 = 2τ、S2 = 2T，因此 S2 − M2 = 2(s − h) 恰好是「2 × 月相角」：
//! 朔望时两者同相叠加成大潮，上下弦时反相削减成小潮，拍频周期 14.77 天由频率自然给出。
//! 本模块不依赖浏览器，工程版与 Node 验收脚本共用同一份定义。

export const DEG = Math.PI / 180;
const J2000 = 2451545.0;

export type ConstituentName = 'M2' | 'S2' | 'N2' | 'K1' | 'O1' | 'M4';

/** 各分潮的周期（小时），用于展示与验收 */
export const PERIOD_HOURS: Record<ConstituentName, number> = {
  M2: 12.4206012,
  S2: 12,
  N2: 12.6583482,
  K1: 23.9344696,
  O1: 25.8193417,
  M4: 6.2103006,
};

export interface Constituent {
  name: ConstituentName;
  /** 振幅（米） */
  amp: number;
  /** 当地迟角（度）：决定高潮出现在月中天之后多久 */
  lag: number;
}

export interface TideModel {
  /** 平均海面相对于图面基准的高度（米） */
  z0: number;
  constituents: Constituent[];
}

/** Doodson 平均经度（度），d 为距 J2000 的日数 */
export function meanLongitudes(jd: number): { s: number; h: number; p: number } {
  const d = jd - J2000;
  return {
    s: 218.3164477 + 13.17639648 * d,
    h: 280.4664567 + 0.98564736 * d,
    p: 83.3532465 + 0.11140353 * d,
  };
}

/** 平太阳时角 T（度）：UT 午夜为 180°，东经为正 */
function solarAngle(jd: number, lonDeg: number): number {
  const ut = (jd + 0.5) % 1;
  return ut * 360 + 180 + lonDeg;
}

/** 分潮的天文相角 V（度） */
export function astronomicalArgument(name: ConstituentName, jd: number, lonDeg: number): number {
  const { s, h, p } = meanLongitudes(jd);
  const T = solarAngle(jd, lonDeg);
  const tau = T + h - s;
  switch (name) {
    case 'M2':
      return 2 * tau;
    case 'S2':
      return 2 * T;
    case 'N2':
      return 2 * tau - s + p;
    case 'K1':
      return tau + s + 90;
    case 'O1':
      return tau - s - 90;
    case 'M4':
      return 4 * tau;
  }
}

/** 潮位（米，相对平均海面加 z0） */
export function tideHeight(model: TideModel, jd: number, lonDeg: number): number {
  let h = model.z0;
  for (const c of model.constituents) {
    h += c.amp * Math.cos((astronomicalArgument(c.name, jd, lonDeg) - c.lag) * DEG);
  }
  return h;
}

/** 潮位变化率（米 / 小时），数值差分 */
export function tideRate(model: TideModel, jd: number, lonDeg: number): number {
  const dt = 1 / 1440;
  return ((tideHeight(model, jd + dt, lonDeg) - tideHeight(model, jd - dt, lonDeg)) / (2 * dt)) / 24;
}

/** 月相角（度）：月日平均距角 D = s − h，0 为朔、180 为望 */
export function moonPhaseAngle(jd: number): number {
  const { s, h } = meanLongitudes(jd);
  return (((s - h) % 360) + 360) % 360;
}

/** 月面被照亮的比例 */
export function moonIllumination(jd: number): number {
  return (1 - Math.cos(moonPhaseAngle(jd) * DEG)) / 2;
}

/** 月相名称 */
export function moonPhaseName(jd: number): string {
  const a = moonPhaseAngle(jd);
  const names = ['新月', '蛾眉月', '上弦月', '盈凸月', '满月', '亏凸月', '下弦月', '残月'];
  return names[Math.round(a / 45) % 8];
}

/** 大潮 / 小潮 / 中潮：按 S2 与 M2 的相位差判断 */
export function springNeap(jd: number): '大潮' | '中潮' | '小潮' {
  // cos(2D)：朔望为 1（同相叠加），上下弦为 −1（反相削减）
  const k = Math.cos(2 * moonPhaseAngle(jd) * DEG);
  if (k > 0.7) return '大潮';
  if (k < -0.7) return '小潮';
  return '中潮';
}

export interface TideExtremum {
  jd: number;
  height: number;
  kind: 'high' | 'low';
}

/** 在 [from, to] 内找高潮与低潮：先按 6 分钟步长找变号，再三次二分细化 */
export function findExtrema(model: TideModel, lonDeg: number, from: number, to: number): TideExtremum[] {
  const step = 6 / 1440;
  const out: TideExtremum[] = [];
  let prevRate = tideRate(model, from, lonDeg);
  for (let t = from + step; t <= to; t += step) {
    const rate = tideRate(model, t, lonDeg);
    if ((prevRate > 0 && rate <= 0) || (prevRate < 0 && rate >= 0)) {
      let lo = t - step;
      let hi = t;
      for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        const r = tideRate(model, mid, lonDeg);
        if (Math.sign(r) === Math.sign(prevRate)) lo = mid;
        else hi = mid;
      }
      const jd = (lo + hi) / 2;
      out.push({ jd, height: tideHeight(model, jd, lonDeg), kind: prevRate > 0 ? 'high' : 'low' });
    }
    prevRate = rate;
  }
  return out;
}
