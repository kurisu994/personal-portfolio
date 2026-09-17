interface NoiseLayer {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

interface AudioWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

/** 两首配乐交替播放，环境声始终由当前镜头距离实时混合。 */
export class Soundscape {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private wind: NoiseLayer | null = null;
  private water: NoiseLayer | null = null;
  private paper: NoiseLayer | null = null;
  private buffers: AudioBuffer[] = [];
  private activeTrack: AudioBufferSourceNode | null = null;
  private initialization: Promise<void> | null = null;
  private trackIndex = 0;
  private enabled = true;
  private disposed = false;
  private readonly abortController = new AbortController();

  async start(): Promise<void> {
    if (this.disposed) return;
    if (this.initialization) {
      await this.initialization;
      if (this.context?.state === 'suspended') await this.context.resume();
      return;
    }
    this.initialization = this.initialize().catch(async (error: unknown) => {
      if (this.context && this.context.state !== 'closed') await this.context.close();
      this.context = null;
      this.initialization = null;
      throw error;
    });
    await this.initialization;
  }

  private async initialize(): Promise<void> {
    const AudioContextConstructor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
    if (!AudioContextConstructor) throw new Error('当前浏览器不支持 WebAudio');
    const context = new AudioContextConstructor();
    this.context = context;
    this.master = context.createGain();
    this.master.gain.value = 0;
    this.master.connect(context.destination);
    this.musicGain = context.createGain();
    this.musicGain.gain.value = 0.5;
    this.musicGain.connect(this.master);
    this.wind = this.createNoise('lowpass', 570, 0.14, 7.37, true);
    this.water = this.createNoise('bandpass', 1050, 0, 11.31, false);
    this.water.filter.Q.value = 1.7;
    this.paper = this.createNoise('highpass', 4600, 0, 5.73, false);
    const lfo = context.createOscillator();
    const lfoGain = context.createGain();
    lfo.frequency.value = 0.083;
    lfoGain.gain.value = 0.042;
    lfo.connect(lfoGain);
    lfoGain.connect(this.wind.gain.gain);
    lfo.start();
    await context.resume();
    const urls = [
      new URL('./audio/migration-01.mp3', document.baseURI).href,
      new URL('./audio/migration-02.mp3', document.baseURI).href,
    ];
    this.buffers = await Promise.all(urls.map(async (url) => {
      const response = await fetch(url, { signal: this.abortController.signal });
      if (!response.ok) throw new Error(`配乐加载失败：${response.status}`);
      return context.decodeAudioData(await response.arrayBuffer());
    }));
    if (this.disposed) return;
    this.playTrack(0);
    const now = context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(0, now);
    this.master.gain.linearRampToValueAtTime(this.enabled ? 0.68 : 0, now + 5);
  }

  private createNoise(type: BiquadFilterType, frequency: number, volume: number, duration: number, brown: boolean): NoiseLayer {
    if (!this.context || !this.master) throw new Error('声音系统尚未初始化');
    const length = Math.floor(this.context.sampleRate * duration);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const samples = buffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const noise = Math.random() * 2 - 1;
      last = (last + 0.02 * noise) / 1.02;
      samples[index] = brown ? last * 3.5 : noise * 0.32;
    }
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.loop = true;
    filter.type = type;
    filter.frequency.value = frequency;
    gain.gain.value = volume;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start();
    return { source, filter, gain };
  }

  private playTrack(delay: number): void {
    if (!this.context || !this.musicGain || this.buffers.length === 0) return;
    const source = this.context.createBufferSource();
    source.buffer = this.buffers[this.trackIndex % this.buffers.length];
    source.connect(this.musicGain);
    source.onended = () => {
      source.disconnect();
      if (this.activeTrack !== source) return;
      this.trackIndex += 1;
      this.playTrack(2.4);
    };
    source.start(this.context.currentTime + delay);
    this.activeTrack = source;
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    // 中断开场淡入的自动化曲线，避免静音后被尚未结束的五秒淡入重新抬高音量。
    const gain = this.master.gain;
    if (typeof gain.cancelAndHoldAtTime === 'function') gain.cancelAndHoldAtTime(now);
    else gain.cancelScheduledValues(now);
    gain.setTargetAtTime(value ? 0.68 : 0, now, 0.32);
  }

  update(cameraHeight: number, riverDistance: number, cameraDistance: number, windStrength: number): void {
    if (!this.context || !this.wind || !this.water || !this.paper) return;
    const now = this.context.currentTime;
    const waterNear = Math.max(0, 1 - Math.max(cameraHeight - 80, 0) / 320) * Math.max(0, 1 - riverDistance / 310);
    const paperNear = Math.max(0, 1 - Math.max(cameraDistance - 620, 0) / 760);
    this.water.gain.gain.setTargetAtTime(waterNear * 0.28, now, 0.75);
    this.paper.gain.gain.setTargetAtTime(paperNear * 0.018, now, 0.15);
    this.wind.filter.frequency.setTargetAtTime(480 + windStrength * 180, now, 0.7);
  }

  async suspend(): Promise<void> {
    if (this.context?.state === 'running') await this.context.suspend();
  }

  async resume(): Promise<void> {
    if (this.enabled && this.context?.state === 'suspended') await this.context.resume();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.abortController.abort();
    if (this.activeTrack) {
      this.activeTrack.onended = null;
      this.activeTrack.stop();
    }
    this.activeTrack = null;
    this.wind?.source.stop();
    this.water?.source.stop();
    this.paper?.source.stop();
    if (this.context && this.context.state !== 'closed') await this.context.close();
    this.context = null;
  }

  get ready(): boolean {
    return this.buffers.length === 2 && this.context?.state === 'running';
  }
}
