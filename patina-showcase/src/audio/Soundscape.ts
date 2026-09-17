/**
 * 苔痕的声音：全部程序化合成，不引入任何音频素材。
 *
 * 三层：
 *   1. 底层嗡鸣——两个失谐的低频正弦，厚度与音高随覆盖率变化；
 *   2. 生长点音——纹理扩张时稀疏的清脆点音，音高由位置决定，限流触发；
 *   3. 重生水声——噪声过低通扫频，对应一次冲刷。
 *
 * 浏览器不允许在用户交互前出声，所以必须先调用 start()（由首次点击触发），
 * 再由 setEnabled() 控制是否真的发声。
 */

/** 五声音阶（宫商角徵羽）的半音级数，点音都落在它上面。 */
const PENTATONIC = [0, 2, 4, 7, 9];

export class Soundscape {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private droneGain: GainNode | null = null;
  private droneOscillators: OscillatorNode[] = [];
  private enabled = false;

  /** 音频上下文是否已经建立。 */
  get ready(): boolean {
    return this.context !== null;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** 在用户手势里调用，建立并恢复音频上下文。 */
  async start(): Promise<void> {
    if (!this.context) {
      const context = new AudioContext();
      const master = context.createGain();
      master.gain.value = 0;
      master.connect(context.destination);

      const droneGain = context.createGain();
      droneGain.gain.value = 0;
      droneGain.connect(master);

      // 两个基频相差 0.6%，产生缓慢的拍频，比单一正弦更像「活着」。
      for (const ratio of [1, 1.006, 0.5]) {
        const oscillator = context.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.value = 60 * ratio;
        oscillator.connect(droneGain);
        oscillator.start();
        this.droneOscillators.push(oscillator);
      }

      this.context = context;
      this.master = master;
      this.droneGain = droneGain;
    }

    if (this.context.state === 'suspended') await this.context.resume();
  }

  /** 开关声音。关闭时只是把总音量拉到 0，振荡器继续跑，重新打开没有爆音。 */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!this.context || !this.master) return;
    this.master.gain.setTargetAtTime(enabled ? 1 : 0, this.context.currentTime, 0.25);
  }

  /** 覆盖率高时嗡鸣更厚、更高。 */
  updateDrone(coverage: number): void {
    if (!this.context || !this.droneGain) return;
    const now = this.context.currentTime;
    const base = 44 + Math.min(1, coverage) * 46;
    for (let index = 0; index < this.droneOscillators.length; index += 1) {
      const ratio = index === 0 ? 1 : index === 1 ? 1.006 : 0.5;
      this.droneOscillators[index].frequency.setTargetAtTime(base * ratio, now, 0.5);
    }
    this.droneGain.gain.setTargetAtTime(0.015 + Math.min(1, coverage) * 0.05, now, 0.5);
  }

  /** 生长点音。位置决定音高，纵坐标做轻微失谐。 */
  chime(x: number, y: number): void {
    if (!this.enabled || !this.context || !this.master) return;
    const now = this.context.currentTime;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();

    const degree = Math.floor(Math.min(0.999, Math.max(0, x)) * PENTATONIC.length * 2);
    const semitone = PENTATONIC[degree % PENTATONIC.length] + 12 * Math.floor(degree / PENTATONIC.length);
    oscillator.type = 'sine';
    oscillator.frequency.value = 220 * Math.pow(2, semitone / 12) * (0.996 + y * 0.008);

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.05, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);

    oscillator.connect(gain).connect(this.master);
    oscillator.start(now);
    oscillator.stop(now + 1.2);
  }

  /** 重生水声：白噪声扫过一个高 Q 低通。 */
  flush(): void {
    if (!this.enabled || !this.context || !this.master) return;
    const context = this.context;
    const now = context.currentTime;
    const length = 2.2;

    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * length), context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;

    const source = context.createBufferSource();
    source.buffer = buffer;

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 5;
    filter.frequency.setValueAtTime(1400, now);
    filter.frequency.exponentialRampToValueAtTime(110, now + length);

    const gain = context.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.12, now + 0.18);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + length);

    source.connect(filter).connect(gain).connect(this.master);
    source.start(now);
    source.stop(now + length);
  }

  dispose(): void {
    for (const oscillator of this.droneOscillators) oscillator.stop();
    this.droneOscillators = [];
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.droneGain = null;
  }
}
