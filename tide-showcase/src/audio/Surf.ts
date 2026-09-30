/** 引擎每帧交给音景的状态 */
export interface SurfState {
  /** 离镜头最近那段岸线的涌浪相位（周数，整数部分递增即一道新浪） */
  swellPhase: number;
  /** 镜头离水边的远近 0..1，越近越响 */
  proximity: number;
  /** 潮位在全年范围内的位置 0..1：低频涌声随之变厚 */
  tideNorm: number;
  /** 离岸波高（米） */
  swellHeight: number;
}

/**
 * 程序化海浪音景，三层全部由噪声与滤波合成，不需要任何音频素材：
 * - 涌浪：带通噪声按浪的周期起落（「沙——」），回落时加一层高频砾石摩擦；
 * - 底层：40–120 Hz 的低频涌声，潮位越高越厚；
 * - 细节：浪退时泡沫破裂的密集短脉冲，随机触发并限流。
 */
export class Surf {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lowGain: GainNode | null = null;
  private white: AudioBuffer | null = null;
  private lastWave = -1;
  private fizzBudget = 0;
  private enabled = false;

  async setEnabled(on: boolean): Promise<boolean> {
    this.enabled = on;
    if (on && !this.ctx) this.build();
    if (!this.ctx || !this.master) return false;
    if (on) await this.ctx.resume();
    this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.4);
    return on;
  }

  private build(): void {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // 4 秒白噪声，所有层共用
    const white = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const w = white.getChannelData(0);
    for (let i = 0; i < w.length; i++) w[i] = Math.random() * 2 - 1;
    this.white = white;

    // 底层：布朗噪声 + 低通
    const brown = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < b.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      b[i] = last * 3.2;
    }
    const low = ctx.createBufferSource();
    low.buffer = brown;
    low.loop = true;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 110;
    this.lowGain = ctx.createGain();
    this.lowGain.gain.value = 0.2;
    low.connect(lowpass).connect(this.lowGain).connect(this.master);
    low.start();
  }

  /** 一道浪：上涌的「沙——」与回落时的砾石声 */
  private wave(loudness: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.white) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.setValueAtTime(420, now);
    band.frequency.linearRampToValueAtTime(900 + Math.random() * 300, now + 0.9);
    band.frequency.exponentialRampToValueAtTime(380, now + 4.5);
    band.Q.value = 0.55;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.5 * loudness, now + 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 5.2);
    src.connect(band).connect(gain).connect(this.master);
    src.start(now, Math.random() * 2);
    src.stop(now + 5.4);

    // 回落：高频砾石摩擦
    const back = ctx.createBufferSource();
    back.buffer = this.white;
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 3200;
    const backGain = ctx.createGain();
    backGain.gain.setValueAtTime(0.0001, now + 1.6);
    backGain.gain.exponentialRampToValueAtTime(0.08 * loudness, now + 2.4);
    backGain.gain.exponentialRampToValueAtTime(0.0001, now + 4.6);
    back.connect(high).connect(backGain).connect(this.master);
    back.start(now + 1.6, Math.random() * 2);
    back.stop(now + 4.8);
    this.fizzBudget = 40 * loudness;
  }

  /** 泡沫破裂：极短的高频脉冲 */
  private fizz(loudness: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.white) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 5000 + Math.random() * 4000;
    const gain = ctx.createGain();
    const dur = 0.012 + Math.random() * 0.03;
    gain.gain.setValueAtTime(0.05 * loudness * Math.random(), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(high).connect(gain).connect(this.master);
    src.start(now, Math.random() * 3);
    src.stop(now + dur + 0.01);
  }

  update(state: SurfState, dt: number): void {
    if (!this.enabled || !this.ctx || !this.lowGain) return;
    const loud = Math.min(1.2, 0.25 + state.proximity * 0.9) * Math.min(1.4, 0.5 + state.swellHeight * 1.4);
    const index = Math.floor(state.swellPhase);
    if (this.lastWave >= 0 && index !== this.lastWave) this.wave(loud);
    this.lastWave = index;
    this.lowGain.gain.setTargetAtTime(0.08 + 0.3 * state.tideNorm * (0.4 + state.proximity * 0.6), this.ctx.currentTime, 1.5);
    // 泡沫：浪后两秒内最密；每帧至多一粒，约合每秒二十粒以内
    if (this.fizzBudget > 0) {
      if (Math.random() < 0.35 * Math.min(1, this.fizzBudget / 40)) this.fizz(loud);
      this.fizzBudget = Math.max(0, this.fizzBudget - dt * 18);
    }
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }
}
