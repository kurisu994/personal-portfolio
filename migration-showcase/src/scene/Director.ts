import * as THREE from 'three';
import { angleDelta, clamp, damp, hash, lerp, smootherstep } from './math';

interface ShotDefinition {
  name: string;
  yaw: number;
  pitch: number;
  distance: number;
  fov: number;
}

interface ScheduledShot extends ShotDefinition {
  start: number;
  duration: number;
  cycle: number;
}

export interface DirectorState {
  name: string;
  cycle: number;
  progress: number;
  automatic: boolean;
  distance: number;
}

export const CAMERA_LIBRARY: readonly ShotDefinition[] = [
  { name: '正俯视', yaw: -0.7, pitch: 1.48, distance: 1190, fov: 38 },
  { name: '航线俯瞰', yaw: -0.62, pitch: 1.01, distance: 1120, fov: 42 },
  { name: '俯冲入风', yaw: 0.34, pitch: 0.5, distance: 850, fov: 46 },
  { name: '贴河掠水', yaw: -0.12, pitch: -0.1, distance: 790, fov: 50 },
  { name: '沿河前推', yaw: 0.15, pitch: 0.25, distance: 930, fov: 45 },
  { name: '侧向轨道', yaw: 1.5, pitch: 0.49, distance: 1060, fov: 43 },
  { name: '低空宽景', yaw: -0.8, pitch: 0.28, distance: 1580, fov: 39 },
  { name: '回旋环绕', yaw: 2.4, pitch: 0.63, distance: 1110, fov: 43 },
  { name: '拉远揭示', yaw: -1.2, pitch: 0.89, distance: 1620, fov: 40 },
  { name: '追随背影', yaw: 0, pitch: 0.27, distance: 790, fov: 48 },
  { name: '迎面来风', yaw: Math.PI, pitch: 0.3, distance: 820, fov: 47 },
  { name: '高空漂移', yaw: 0.9, pitch: 1.16, distance: 1440, fov: 40 },
  { name: '翼侧同行', yaw: -1.6, pitch: 0.35, distance: 800, fov: 46 },
  { name: '临河旧城', yaw: 0.85, pitch: 0.69, distance: 1200, fov: 41 },
  { name: '地平线来信', yaw: 2.05, pitch: 0.16, distance: 1410, fov: 39 },
  { name: '乘风回升', yaw: -0.5, pitch: 1.29, distance: 1320, fov: 40 },
];

/** 以固定叙事骨架从十六个镜位中抽卡，每圈保持约九十六秒且无切镜。 */
export class Director {
  private readonly schedule: ScheduledShot[] = [];
  private readonly smoothedTarget = new THREE.Vector3();
  private readonly desiredPosition = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private builtCycle = -1;
  private yaw = -0.62;
  private pitch = 1.01;
  private distance = 1120;
  private fov = 42;
  private manualYaw = this.yaw;
  private manualPitch = this.pitch;
  private manualDistance = this.distance;
  private observationOffset = 0;
  private observationAt = -100;
  private composition = -235;
  private automatic = true;
  private current: DirectorState = { name: '航线俯瞰', cycle: 0, progress: 0, automatic: true, distance: 1120 };

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly seed: number,
  ) {
    this.buildCycle();
    this.buildCycle();
  }

  reset(): void {
    this.schedule.length = 0;
    this.builtCycle = -1;
    this.buildCycle();
    this.buildCycle();
    this.current = { name: '航线俯瞰', cycle: 0, progress: 0, automatic: this.automatic, distance: this.distance };
  }

  /** 起飞地点预览直接定位，正式旅程仍通过同一个阻尼镜头连续前进。 */
  locatePreview(target: THREE.Vector3): void {
    this.smoothedTarget.copy(target);
  }

  private buildCycle(): void {
    const cycle = ++this.builtCycle;
    const high = cycle % 2 === 0;
    const pools: readonly (readonly number[])[] = [
      high ? [0, 1, 11] : [1, 0],
      high ? [2, 4] : [3, 4, 2],
      high ? [5, 7, 13] : [12, 6, 5],
      [cycle % 2 ? 10 : 9],
      high ? [8, 11, 14] : [6, 8, 14],
      [15, 11, 0],
    ];
    for (let stage = 0; stage < pools.length; stage += 1) {
      const pool = pools[stage];
      const definition = CAMERA_LIBRARY[pool[Math.floor(hash(cycle * 17 + stage, 92, this.seed) * pool.length)]];
      const previous = this.schedule.at(-1);
      let yaw = definition.yaw + (hash(cycle, stage + 800, this.seed) - 0.5) * 0.2;
      if (previous) {
        let delta = angleDelta(previous.yaw, yaw);
        if (Math.abs(delta) < Math.PI / 6) delta = (delta < 0 ? -1 : 1) * (Math.PI / 6 + 0.06);
        yaw = previous.yaw + delta;
      }
      const distanceCard = [0.89, 1, 1.19][Math.floor(hash(cycle, stage + 400, this.seed) * 3)];
      const duration = 16 + hash(cycle, stage + 100, this.seed) * 2.1;
      this.schedule.push({
        ...definition,
        yaw,
        distance: definition.distance * distanceCard,
        duration,
        cycle,
        start: previous ? previous.start + previous.duration : 0,
      });
    }
  }

  private resolve(journey: number): ShotDefinition & { state: DirectorState } {
    while ((this.schedule.at(-2)?.start ?? 0) < journey) this.buildCycle();
    while (this.schedule.length > 2 && this.schedule[1].start <= journey) this.schedule.shift();
    const current = this.schedule[0];
    const next = this.schedule[1];
    const progress = clamp((journey - current.start) / current.duration);
    const transition = smootherstep((progress - 0.48) / 0.52);
    const pose = {
      name: current.name,
      yaw: lerp(current.yaw, next.yaw, transition),
      pitch: lerp(current.pitch, next.pitch, transition),
      distance: lerp(current.distance, next.distance, transition),
      fov: lerp(current.fov, next.fov, transition),
      state: { name: current.name, cycle: current.cycle, progress, automatic: this.automatic, distance: this.distance },
    };
    return pose;
  }

  update(delta: number, elapsed: number, journey: number, target: THREE.Vector3, started: boolean): DirectorState {
    const preview: ShotDefinition = {
      ...CAMERA_LIBRARY[1],
      yaw: CAMERA_LIBRARY[1].yaw + Math.sin(elapsed * 0.045) * 0.035,
    };
    const automaticPose = started ? this.resolve(journey) : { ...preview, state: this.current };
    if (elapsed - this.observationAt > 2) this.observationOffset *= Math.exp(-delta * 0.72);
    const targetYaw = this.automatic ? automaticPose.yaw : this.manualYaw;
    const targetPitch = (this.automatic ? automaticPose.pitch : this.manualPitch) + (this.automatic ? this.observationOffset * 0.00013 : 0);
    const targetDistance = (this.automatic ? automaticPose.distance : this.manualDistance) + (this.automatic ? this.observationOffset : 0);
    const targetFov = this.automatic ? automaticPose.fov : 43;
    const lambda = this.automatic ? 2.65 : 7;
    this.yaw += angleDelta(this.yaw, targetYaw) * (1 - Math.exp(-lambda * delta));
    this.pitch = damp(this.pitch, targetPitch, lambda, delta);
    this.distance = damp(this.distance, targetDistance, lambda, delta);
    this.fov = damp(this.fov, targetFov, 3.2, delta);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
    this.smoothedTarget.lerp(target, 1 - Math.exp(-delta * 5.4));

    const horizontal = Math.cos(this.pitch) * this.distance;
    this.desiredPosition.set(
      this.smoothedTarget.x - Math.sin(this.yaw) * horizontal,
      Math.max(32, this.smoothedTarget.y + Math.sin(this.pitch) * this.distance),
      this.smoothedTarget.z - Math.cos(this.yaw) * horizontal,
    );
    this.camera.position.copy(this.desiredPosition);
    this.right.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    this.composition = damp(this.composition, started ? 150 : -235, 0.95, delta);
    this.lookTarget.copy(this.smoothedTarget).addScaledVector(this.right, this.composition);
    this.lookTarget.y -= 8;
    this.camera.lookAt(this.lookTarget);
    this.camera.updateMatrixWorld();

    this.current = this.automatic && started
      ? { ...automaticPose.state, automatic: true, distance: this.distance }
      : { name: this.automatic ? '航线俯瞰' : '自由视角', cycle: started ? automaticPose.state.cycle : 0, progress: started ? automaticPose.state.progress : 0, automatic: this.automatic, distance: this.distance };
    return this.current;
  }

  setAutomatic(value: boolean): void {
    if (this.automatic === value) return;
    this.automatic = value;
    if (!value) {
      this.manualYaw = this.yaw;
      this.manualPitch = this.pitch;
      this.manualDistance = this.distance;
    }
  }

  orbit(deltaX: number, deltaY: number): void {
    if (this.automatic) return;
    this.manualYaw -= deltaX * 0.005;
    this.manualPitch = clamp(this.manualPitch + deltaY * 0.004, -0.14, 1.53);
  }

  zoom(delta: number, elapsed: number): void {
    if (this.automatic) {
      this.observationOffset = clamp(this.observationOffset + delta * 0.45, -90, 370);
      this.observationAt = elapsed;
      return;
    }
    this.manualDistance = clamp(this.manualDistance * Math.exp(delta * 0.001), 400, 2600);
  }

  pinch(scale: number, elapsed: number): void {
    if (this.automatic) {
      this.observationOffset = clamp(this.observationOffset + (1 - scale) * 620, -90, 370);
      this.observationAt = elapsed;
      return;
    }
    this.manualDistance = clamp(this.manualDistance / Math.max(scale, 0.2), 400, 2600);
  }

  get state(): DirectorState {
    return this.current;
  }

  get isAutomatic(): boolean {
    return this.automatic;
  }

  get plan(): readonly ScheduledShot[] {
    return this.schedule;
  }
}
