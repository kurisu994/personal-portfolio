export class NightscapeAudio {
  private ctx: AudioContext | null = null;
  private isRunning = false;
  private noiseNode: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private windFilter: BiquadFilterNode | null = null;
  private cricketTimer: number | null = null;

  public async toggle(): Promise<boolean> {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.initWind();
      this.startCrickets();
      this.isRunning = true;
      return true;
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
      this.isRunning = true;
      return true;
    } else {
      await this.ctx.suspend();
      this.isRunning = false;
      return false;
    }
  }

  public get active(): boolean {
    return this.isRunning;
  }

  private initWind(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;

    // 2 秒循环粉红噪声模拟呼啸的自然夜风
    const bufferSize = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99 * b0 + white * 0.05;
      b1 = 0.96 * b1 + white * 0.11;
      b2 = 0.86 * b2 + white * 0.25;
      data[i] = (b0 + b1 + b2) * 0.15;
    }

    this.noiseNode = ctx.createBufferSource();
    this.noiseNode.buffer = buffer;
    this.noiseNode.loop = true;

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 240;

    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.35;

    this.noiseNode.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(ctx.destination);

    this.noiseNode.start();
  }

  /**
   * 稀疏程序化虫鸣（双正弦微调频 + 衰减脉冲）
   */
  private startCrickets(): void {
    const playCricketChirp = () => {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const ctx = this.ctx;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      // 4200 Hz ~ 4800 Hz 的幽微鸣叫
      const baseFreq = 4400 + Math.random() * 400;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(baseFreq, ctx.currentTime);

      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0, now);
      // 快速三连音脉冲
      for (let i = 0; i < 3; i++) {
        const t = now + i * 0.045;
        gain.gain.setValueAtTime(0.015, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
      }

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.18);
    };

    const scheduleNext = () => {
      const delay = 4000 + Math.random() * 8000; // 4 ~ 12 秒随机出现一次
      this.cricketTimer = window.setTimeout(() => {
        playCricketChirp();
        scheduleNext();
      }, delay);
    };

    scheduleNext();
  }

  public dispose(): void {
    if (this.cricketTimer) clearTimeout(this.cricketTimer);
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }
}
