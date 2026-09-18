import { PerspectiveCamera, Vector3 } from 'three';
import { bezier4, clamp, mix, phase } from './math';

interface Shot { p: number; y: number; distance: number; yaw: number; pitch: number; label: string }
const SHOTS: readonly Shot[] = [
  { p: 0, y: -.65, distance: 5.9, yaw: -.18, pitch: .38, label: '一粒微观' },
  { p: .17, y: -.6, distance: 7.8, yaw: -.08, pitch: .12, label: '向土中去' },
  { p: .25, y: .6, distance: 8.8, yaw: .08, pitch: -.08, label: '初见天光' },
  { p: .43, y: 5.7, distance: 18, yaw: .28, pitch: .04, label: '循枝而上' },
  { p: .60, y: 8.4, distance: 31, yaw: .50, pitch: .16, label: '枝向远天' },
  { p: .78, y: 8.2, distance: 34, yaw: .84, pitch: .18, label: '风过林间' },
  { p: 1, y: 8.1, distance: 35, yaw: .30, pitch: .17, label: '一木成境' },
];

/** 导演镜头与观察偏移分开计算，归位时不争抢滚动的位置。 */
export class Director {
  private width = 1;
  private height = 1;
  private safe = { x: 0, y: 0, w: 1, h: 1 };
  private readonly target = new Vector3();
  private yaw = 0;
  private pitch = 0;
  private yawVelocity = 0;
  private pitchVelocity = 0;
  private lastDrag = -10;
  private started = false;
  label = SHOTS[0].label;

  constructor(private readonly camera: PerspectiveCamera) {}

  /** 为诗句、页眉和页脚留出真实取景面积。 */
  resize(width: number, height: number, started: boolean): void {
    this.width = width;
    this.height = height;
    this.started = started;
    const compact = height <= 520 && width > height;
    const stacked = !compact && width <= 760;
    const poem = document.querySelector('[data-poem]')?.getBoundingClientRect();
    const header = document.querySelector('[data-header]')?.getBoundingClientRect();
    const footer = document.querySelector('[data-footer]')?.getBoundingClientRect();
    if (!started) {
      this.safe = width > 760
        ? { x: width * .46, y: height * .19, w: width * .47, h: height * .63 }
        : { x: width * .65, y: height * .12, w: width * .27, h: height * .22 };
    } else {
      const x = stacked ? 24 : Math.max(width * .33, (poem?.right ?? width * .28) + 28);
      const y = Math.max(78, (header?.bottom ?? 58) + 24);
      const right = width - (stacked ? 24 : 36);
      const bottom = stacked ? (poem?.top ?? height * .7) - 20 : (footer?.top ?? height - 52) - 24;
      this.safe = { x, y, w: Math.max(100, right - x), h: Math.max(110, bottom - y) };
    }
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** 小幅拖动允许自主观察，限制角度以免翻转或遮住诗句。 */
  drag(dx: number, dy: number, time: number, reduced: boolean): void {
    if (reduced) return;
    this.yaw = clamp(this.yaw - dx / this.width * 1.9, -.38, .38);
    this.pitch = clamp(this.pitch + dy / this.height * 1.0, -.14, .18);
    this.yawVelocity = this.pitchVelocity = 0;
    this.lastDrag = time;
  }

  /** 每帧求取基础轨迹；停手两秒后用阻尼弹簧回到同一镜位。 */
  update(p: number, dt: number, time: number, reduced: boolean): void {
    if (time - this.lastDrag > 2) {
      const stiffness = 12, damping = 7;
      this.yawVelocity += (-stiffness * this.yaw - damping * this.yawVelocity) * dt;
      this.pitchVelocity += (-stiffness * this.pitch - damping * this.pitchVelocity) * dt;
      this.yaw += this.yawVelocity * dt;
      this.pitch += this.pitchVelocity * dt;
    }
    let index = SHOTS.length - 2;
    for (let i = 0; i < SHOTS.length - 1; i++) { if (p <= SHOTS[i + 1].p) { index = i; break; } }
    const a = SHOTS[index], b = SHOTS[index + 1];
    const t = bezier4(phase(p, a.p, b.p));
    const crown = bezier4(phase(p, .49, .76));
    this.label = p < .96 ? a.label : b.label;
    const top = Math.max(.5, 17.75 * phase(p, .16, .5) - .5) + mix(.8, 2.0, crown);
    const bottom = -3.8 * (1 - bezier4(phase(p, .17, .33))) - .5;
    this.target.set(0, this.started ? (top + bottom) * .5 : mix(a.y, b.y, t), 0);
    let distance = mix(a.distance, b.distance, t);
    if (!this.started && this.width <= 760) distance *= 1.75;
    const fov = this.camera.fov * Math.PI / 180;
    const projectedH = top - bottom + .8;
    const projectedW = mix(7.5, 21.0, crown);
    // 用安全区占整屏的比例计算距离，竖屏不裁冠、短横屏不遮诗。
    const fitY = projectedH / (2 * Math.tan(fov / 2) * this.safe.h / this.height);
    const fitX = projectedW / (2 * Math.tan(fov / 2) * this.camera.aspect * this.safe.w / this.width);
    if (this.started) distance = Math.max(distance, fitX, fitY);
    const yaw = (reduced ? .25 : mix(a.yaw, b.yaw, t)) + this.yaw;
    const pitch = mix(a.pitch, b.pitch, t) + this.pitch;
    this.camera.position.set(
      Math.sin(yaw) * Math.cos(pitch) * distance,
      this.target.y + Math.sin(pitch) * distance,
      Math.cos(yaw) * Math.cos(pitch) * distance,
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    this.camera.updateProjectionMatrix();
    // 透视主点偏移而不是把树模型平移；地表与风场仍共用世界原点。
    const cx = this.safe.x + this.safe.w * .5;
    const cy = this.safe.y + this.safe.h * .5;
    this.camera.projectionMatrix.elements[8] = 1 - 2 * cx / this.width;
    this.camera.projectionMatrix.elements[9] = 2 * cy / this.height - 1;
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
  }

  /** 返回当前观察幅度，供只读验收快照使用。 */
  get offset(): { yaw: number; pitch: number } { return { yaw: this.yaw, pitch: this.pitch }; }
}
