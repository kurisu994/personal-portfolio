import { clamp, randomSeed } from '../scene/math';

const PENTATONIC = [130.8128, 146.8324, 164.8138, 195.9977, 220] as const;
type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

interface Voice {
  oscillator: OscillatorNode;
  gain: GainNode;
}

/** 克制的程序音景；所有节点在用户手势内一次创建，update 只调参和调度短鸟鸣。 */
export class Soundscape {
  private context: AudioContext | null = null;
  private pending: Promise<void> | null = null;
  private cancelPending: (() => void) | null = null;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly voices: Voice[] = [];
  private master: GainNode | null = null;
  private windGain: GainNode | null = null;
  private leafGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private chirp: OscillatorNode | null = null;
  private chirpGain: GainNode | null = null;
  private chirpModulator: OscillatorNode | null = null;
  private chirpDepth: GainNode | null = null;
  private requestedEnabled = false;
  private suspended = false;
  private disposed = false;
  private requestVersion = 0;
  private lastControl = -Infinity;
  private nextChirp = 0;
  private chirpIndex = 0;
  private inFinale = false;

  /** 已完成节点创建；浏览器实际运行状态与用户开关分开记录。 */
  get ready(): boolean {
    return !this.disposed && this.context !== null && this.context.state !== 'closed';
  }

  /** 用户选择的音频开关；页面隐藏不会把用户选择改成关闭。 */
  get enabled(): boolean {
    return this.requestedEnabled && !this.disposed;
  }

  /** 只能从点击、键盘等用户手势调用；重复启动复用同一上下文。 */
  async start(): Promise<void> {
    await this.setEnabled(true);
  }

  /** 开启时可创建或恢复上下文，关闭时仅平滑静音；调用方应处理中文错误。 */
  async setEnabled(enabled: boolean): Promise<void> {
    if (this.disposed) return;
    const version = ++this.requestVersion;
    this.requestedEnabled = enabled;
    if (!enabled) {
      this.applyMaster();
      this.silenceChirp();
      return;
    }
    try {
      // 构造与 resume 均在首个 await 之前执行，保留浏览器的用户激活权限。
      if (!this.context) this.create();
      const context = this.context;
      if (!context) return;
      if (!this.pending && context.state !== 'running') {
        const resume = context.resume();
        const cancelled = new Promise<void>(resolve => { this.cancelPending = resolve; });
        // 某些浏览器的权限提示会长期挂起 resume；卸载时也必须能结束调用方的等待。
        this.pending = Promise.race([resume, cancelled]);
      }
      const pending = this.pending;
      try {
        if (pending) await pending;
      } finally {
        if (this.pending === pending) {
          this.pending = null;
          this.cancelPending = null;
        }
      }
      // StrictMode 清理或后续开关操作优先，旧 Promise 不得把已关闭实例重新启用。
      if (this.disposed || this.context !== context || version !== this.requestVersion) return;
      if (context.state !== 'running') throw new Error('浏览器尚未允许播放声音，请再次点击声音开关。');
      this.lastControl = -Infinity;
      this.nextChirp = context.currentTime + 1;
      this.applyMaster();
    } catch (error) {
      if (this.disposed || version !== this.requestVersion) return;
      this.requestedEnabled = false;
      this.applyMaster();
      throw new Error(error instanceof Error && /[\u3400-\u9fff]/u.test(error.message)
        ? error.message : '声音启动失败，请在浏览器中允许音频后重试。', { cause: error });
    }
  }

  /** 页面不可见时平滑停音；恢复只解除静音，不在非用户手势中偷偷 resume。 */
  setSuspended(suspended: boolean): void {
    if (this.disposed || this.suspended === suspended) return;
    this.suspended = suspended;
    this.lastControl = -Infinity;
    if (suspended) this.silenceChirp();
    else if (this.context) this.nextChirp = this.context.currentTime + 1.2;
    this.applyMaster();
  }

  /** progress、wind 建议传 0–1；time 为场景秒数。不创建节点，也不自动启动声音。 */
  update(progress: number, wind: number, time: number): void {
    const context = this.context;
    if (!context || this.disposed || !this.requestedEnabled || this.suspended || context.state !== 'running') return;
    const now = context.currentTime;
    const p = Number.isFinite(progress) ? clamp(progress) : 0;
    const strength = Number.isFinite(wind) ? clamp(Math.abs(wind)) : 0;
    const clock = Number.isFinite(time) ? time : 0;
    const finale = p >= .92;
    if (finale !== this.inFinale) {
      this.inFinale = finale;
      this.silenceChirp();
      this.nextChirp = now + .7;
    }
    // 控制率约 12 Hz；AudioParam 自身的平滑负责补间，不逐帧堆积自动化事件。
    if (now - this.lastControl < .08) return;
    this.lastControl = now;
    const breath = .5 + .5 * Math.sin(clock * .27);
    if (this.windGain) this.target(this.windGain.gain, .045 + strength * .075 + breath * .008, now, .4);
    if (this.leafGain) this.target(this.leafGain.gain, (.005 + strength * .018) * (.2 + p * .8), now, .3);
    if (this.windFilter) this.target(this.windFilter.frequency, 250 + strength * 520, now, .5);
    const note = Math.min(4, Math.floor(p * 5));
    this.voices.forEach((voice, i) => {
      this.target(voice.oscillator.frequency, PENTATONIC[(note + i * 2) % PENTATONIC.length] * (i === 2 ? 2 : 1), now, 1.2);
      this.target(voice.gain.gain, (.004 + .002 * Math.sin(clock * .13 + i * 2) ** 2) * (i === 2 ? .5 : 1), now, .8);
    });
    if (finale && now >= this.nextChirp) {
      this.scheduleChirp(now);
      this.nextChirp = now + 4.2 + (this.chirpIndex % 4) * .73;
    }
  }

  private track<T extends AudioNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }

  private create(): void {
    if (typeof window === 'undefined') throw new Error('当前环境不支持 Web Audio，无法开启自然音景。');
    const Constructor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
    if (!Constructor) throw new Error('当前浏览器不支持 Web Audio，无法开启自然音景。');
    const context = new Constructor({ latencyHint: 'playback' });
    this.context = context;
    try {
      const master = this.track(context.createGain());
      master.gain.value = 0;
      master.connect(context.destination);
      this.master = master;
      const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * 3), context.sampleRate);
      const samples = buffer.getChannelData(0);
      const random = randomSeed(73013);
      for (let i = 0; i < samples.length; i++) samples[i] = random() * 2 - 1;
      const noise = this.track(context.createBufferSource());
      noise.buffer = buffer;
      noise.loop = true;
      this.sources.push(noise);

      // 风保留低中频并去除次声；叶响虽为高通，后面再低通，避免持续尖锐高频。
      const windHighpass = this.track(context.createBiquadFilter());
      windHighpass.type = 'highpass';
      windHighpass.frequency.value = 38;
      windHighpass.Q.value = .5;
      const windLowpass = this.track(context.createBiquadFilter());
      windLowpass.type = 'lowpass';
      windLowpass.frequency.value = 360;
      windLowpass.Q.value = .55;
      const windGain = this.track(context.createGain());
      windGain.gain.value = .045;
      noise.connect(windHighpass).connect(windLowpass).connect(windGain).connect(master);
      this.windFilter = windLowpass;
      this.windGain = windGain;
      const leafHighpass = this.track(context.createBiquadFilter());
      leafHighpass.type = 'highpass';
      leafHighpass.frequency.value = 1250;
      leafHighpass.Q.value = .5;
      const leafLowpass = this.track(context.createBiquadFilter());
      leafLowpass.type = 'lowpass';
      leafLowpass.frequency.value = 2900;
      leafLowpass.Q.value = .5;
      const leafGain = this.track(context.createGain());
      leafGain.gain.value = 0;
      noise.connect(leafHighpass).connect(leafLowpass).connect(leafGain).connect(master);
      this.leafGain = leafGain;

      for (let i = 0; i < 3; i++) {
        const oscillator = this.track(context.createOscillator());
        const gain = this.track(context.createGain());
        oscillator.type = 'sine';
        oscillator.frequency.value = PENTATONIC[i * 2] * (i === 2 ? 2 : 1);
        oscillator.detune.value = (i - 1) * 3;
        gain.gain.value = 0;
        oscillator.connect(gain).connect(master);
        this.sources.push(oscillator);
        this.voices.push({ oscillator, gain });
      }

      // 常驻双振荡器形成轻量 FM 鸟鸣；每次鸣叫只排短包络，没有逐帧节点分配。
      this.chirp = this.track(context.createOscillator());
      this.chirp.type = 'sine';
      this.chirp.frequency.value = 1700;
      this.chirpModulator = this.track(context.createOscillator());
      this.chirpModulator.frequency.value = 28;
      this.chirpDepth = this.track(context.createGain());
      this.chirpDepth.gain.value = 60;
      this.chirpGain = this.track(context.createGain());
      this.chirpGain.gain.value = 0;
      const chirpLowpass = this.track(context.createBiquadFilter());
      chirpLowpass.type = 'lowpass';
      chirpLowpass.frequency.value = 3200;
      chirpLowpass.Q.value = .5;
      this.chirpModulator.connect(this.chirpDepth).connect(this.chirp.frequency);
      this.chirp.connect(chirpLowpass).connect(this.chirpGain).connect(master);
      this.sources.push(this.chirp, this.chirpModulator);
      for (const source of this.sources) source.start();
      this.nextChirp = context.currentTime + 1;
    } catch (error) {
      this.release();
      throw new Error('自然音景初始化失败，请检查浏览器音频支持后重试。', { cause: error });
    }
  }

  private target(parameter: AudioParam, value: number, now: number, smoothing: number): void {
    // 取消已有目标并保留当前插值值，避免事件列表无限增长或切换瞬间爆音。
    if (typeof parameter.cancelAndHoldAtTime === 'function') parameter.cancelAndHoldAtTime(now);
    else {
      const current = parameter.value;
      parameter.cancelScheduledValues(now);
      parameter.setValueAtTime(current, now);
    }
    parameter.setTargetAtTime(value, now, smoothing);
  }

  private applyMaster(): void {
    if (!this.context || !this.master || this.context.state === 'closed') return;
    this.target(this.master.gain, this.requestedEnabled && !this.suspended && !this.disposed ? .32 : 0, this.context.currentTime, .09);
  }

  private silenceChirp(): void {
    if (!this.context || !this.chirpGain || this.context.state === 'closed') return;
    this.target(this.chirpGain.gain, 0, this.context.currentTime, .018);
  }

  private scheduleChirp(now: number): void {
    if (!this.chirp || !this.chirpGain || !this.chirpModulator || !this.chirpDepth) return;
    const index = this.chirpIndex++;
    const frequency = 1500 + (index % 5) * 115;
    const pitch = this.chirp.frequency;
    pitch.cancelScheduledValues(now);
    pitch.setValueAtTime(frequency, now);
    pitch.exponentialRampToValueAtTime(frequency * 1.28, now + .065);
    pitch.exponentialRampToValueAtTime(frequency * .91, now + .18);
    this.target(this.chirpModulator.frequency, 24 + (index % 3) * 7, now, .02);
    this.target(this.chirpDepth.gain, 45 + (index % 3) * 14, now, .02);
    const gain = this.chirpGain.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(0, now);
    gain.linearRampToValueAtTime(.019, now + .018);
    gain.exponentialRampToValueAtTime(.0001, now + .21);
    gain.linearRampToValueAtTime(0, now + .25);
  }

  private release(): void {
    for (const source of this.sources) {
      // 初始化中途失败时，某些 source 还没有 start。
      try { source.stop(); } catch { /* 未启动或已经停止，无需再次处理。 */ }
    }
    for (const node of this.nodes) node.disconnect();
    this.sources.length = this.nodes.length = this.voices.length = 0;
    const context = this.context;
    this.context = null;
    this.master = this.windGain = this.leafGain = this.chirpGain = this.chirpDepth = null;
    this.windFilter = null;
    this.chirp = this.chirpModulator = null;
    if (context && context.state !== 'closed') void context.close().catch(() => { /* 关闭中的上下文不再回写实例。 */ });
  }

  /** 停止全部声源并关闭上下文，清理期间的异步 start 不会复活实例。 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.requestedEnabled = false;
    this.requestVersion++;
    this.cancelPending?.();
    this.cancelPending = null;
    this.release();
    this.pending = null;
  }
}
