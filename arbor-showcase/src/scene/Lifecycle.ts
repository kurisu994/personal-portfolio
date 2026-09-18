import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SlowMo } from 'gsap/EasePack';

gsap.registerPlugin(ScrollTrigger, SlowMo);
export const JOURNEY_DISTANCE = 10000;

/** 唯一的生命时钟；所有长成与退回都由同一绝对进度求值。 */
export class Lifecycle {
  readonly state = { progress: 0 };
  private timeline: gsap.core.Timeline | null = null;

  /** 用户进入后建立时间轴，不劫持原生滚动和触屏惯性。 */
  start(): void {
    if (this.timeline) return;
    window.scrollTo(0, 0);
    this.timeline = gsap.timeline({
      scrollTrigger: {
        start: 0,
        end: JOURNEY_DISTANCE,
        scrub: true,
        invalidateOnRefresh: true,
      },
    }).to(this.state, { progress: 1, duration: 1, ease: 'none' });
    this.refresh();
  }

  /** 页面尺寸改变后重新测量，生命进度仍对应一万像素的旅程。 */
  refresh(): void { this.timeline?.scrollTrigger?.refresh(); }

  /** 仅移除本作品的时间轴，不影响同页其他 GSAP 动画。 */
  dispose(): void {
    this.timeline?.scrollTrigger?.kill();
    this.timeline?.kill();
    this.timeline = null;
  }
}
