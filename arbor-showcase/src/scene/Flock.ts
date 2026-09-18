import * as THREE from 'three';
import type { Climate } from './climates';
import { clamp, damp, phase, randomSeed, TAU } from './math';

const COUNT = 5;
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const PAPER = new THREE.Color('#ead5a5');

interface Bird {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  spawn: THREE.Vector3;
  target: THREE.Vector3;
  rotation: THREE.Quaternion;
  captureOffset: THREE.Vector3;
  captureVelocity: THREE.Vector3;
  captureTime: number;
  active: boolean;
  landed: boolean;
  fold: number;
  phase: number;
  size: number;
}

/** 将低面数身体、头、喙与燕尾合为一块带纸色分区的几何，避免每个部位增加 draw call。 */
function makeBody(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const add = (geometry: THREE.BufferGeometry, color: string): void => {
    const part = geometry.index ? geometry.toNonIndexed() : geometry;
    if (part !== geometry) geometry.dispose();
    const tint = new THREE.Color(color);
    const colors = new Float32Array(part.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) tint.toArray(colors, i);
    part.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    parts.push(part);
  };
  add(new THREE.IcosahedronGeometry(1, 1).scale(.108, .115, .19).translate(0, .13, 0), '#fff4d9');
  add(new THREE.IcosahedronGeometry(1, 0).scale(.084, .085, .086).translate(0, .215, .148), '#e4cca0');
  add(new THREE.ConeGeometry(.036, .105, 4).rotateX(Math.PI / 2).translate(0, .206, .255), '#7a5437');
  // 燕尾有厚度与中央折痕，不把整只鸟简化成黑色三角剪影。
  const tail = new THREE.BufferGeometry();
  tail.setAttribute('position', new THREE.Float32BufferAttribute([
    0, .12, -.10, -.095, .085, -.31, 0, .105, -.255,
    0, .12, -.10, 0, .105, -.255, .095, .085, -.31,
    0, .12, -.10, 0, .072, -.15, -.095, .085, -.31,
    0, .12, -.10, .095, .085, -.31, 0, .072, -.15,
  ], 3));
  tail.computeVertexNormals();
  add(tail, '#947046');
  const body = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const data = new Float32Array(parts.reduce((sum, part) => sum + part.getAttribute(name).array.length, 0));
    let offset = 0;
    for (const part of parts) {
      const values = part.getAttribute(name).array;
      data.set(values, offset);
      offset += values.length;
    }
    body.setAttribute(name, new THREE.BufferAttribute(data, 3));
  }
  parts.forEach(part => part.dispose());
  body.computeBoundingSphere();
  return body;
}

/** 翼面沿折纸脊线分成四片；左右翼共用几何，通过旋转镜向而非负实例缩放。 */
function makeWing(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, .12, .25, .035, 0, 0, 0, -.12,
    0, 0, .12, .49, 0, 0, .25, .035, 0,
    .25, .035, 0, .49, 0, 0, 0, 0, -.12,
  ], 3));
  const colors = new Float32Array(27);
  const tint = new THREE.Color();
  for (let i = 0; i < 9; i++) tint.set(i < 3 ? '#c0a379' : '#ebd2a1').toArray(colors, i * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** 五只可重放的归鸟：常态群飞，终章限时平滑归巢，栖息坐标跟随 CPU 风场。 */
export class Flock {
  readonly group = new THREE.Group();
  private readonly bodyGeometry = makeBody();
  private readonly wingGeometry = makeWing();
  private readonly material = new THREE.MeshStandardMaterial({
    color: PAPER, vertexColors: true, roughness: 1, metalness: 0,
    flatShading: true, side: THREE.DoubleSide,
  });
  private readonly bodies = new THREE.InstancedMesh(this.bodyGeometry, this.material, COUNT);
  private readonly wings = new THREE.InstancedMesh(this.wingGeometry, this.material, COUNT * 2);
  private readonly birds: Bird[];
  private readonly object = new THREE.Object3D();
  private readonly localWing = new THREE.Object3D();
  private readonly matrix = new THREE.Matrix4();
  private readonly delta = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly separation = new THREE.Vector3();
  private readonly alignment = new THREE.Vector3();
  private readonly cohesion = new THREE.Vector3();
  private readonly heading = new THREE.Quaternion();
  private readonly tint = new THREE.Color();
  private elapsed = 0;
  private disposed = false;

  /** seed 仅影响固定出生位置、体型与振翅相位，每帧不取随机数。 */
  constructor(seed = 1701) {
    const random = randomSeed(seed);
    this.birds = Array.from({ length: COUNT }, (_, i) => {
      const spawn = new THREE.Vector3(i % 2 ? 15 : -15, 14 + random() * 7, -6);
      return {
        position: spawn.clone(), velocity: new THREE.Vector3(), spawn,
        target: new THREE.Vector3(), rotation: new THREE.Quaternion(),
        captureOffset: new THREE.Vector3(), captureVelocity: new THREE.Vector3(),
        captureTime: -1, active: false, landed: false, fold: 0,
        phase: random() * TAU, size: .83 + random() * .17,
      };
    });
    this.group.name = 'arbor-returning-flock';
    this.group.visible = false;
    for (const mesh of [this.bodies, this.wings]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // 实例不断飞行，不使用初始化时的静态包围球裁切。
      mesh.frustumCulled = false;
      mesh.count = 0;
      this.group.add(mesh);
    }
  }

  /** dt、time 单位为秒；perches 必须为世界坐标，顺序稳定且第一项为巢。 */
  update(progress: number, dt: number, time: number, perches: THREE.Vector3[], climate: Climate): void {
    if (this.disposed) return;
    const p = Number.isFinite(progress) ? clamp(progress) : 0;
    if (p < .92) {
      this.reset();
      return;
    }
    const duration = Number.isFinite(dt) ? clamp(dt, 0, 2) : 0;
    const clock = Number.isFinite(time) ? time : 0;
    const steps = Math.max(1, Math.ceil(duration * 60));
    const step = duration / steps;
    // 只用有效栖点激活对应鸟；尚未生成树冠时不会把 undefined 写入矩阵。
    for (let n = 0; n < steps; n++) {
      this.elapsed += step;
      for (let i = 0; i < COUNT; i++) {
        const bird = this.birds[i];
        const perch = perches[i];
        if (!perch || !Number.isFinite(perch.x + perch.y + perch.z)) {
          bird.active = false;
          continue;
        }
        bird.target.copy(perch);
        if (!bird.active && this.elapsed >= i * .09) {
          bird.active = true;
          bird.position.copy(bird.spawn);
          bird.velocity.set(i % 2 ? -5 : 5, 0, 2);
          bird.captureTime = -1;
          bird.landed = false;
        }
        if (!bird.active) continue;
        if (p < .98) bird.landed = false;
        if (p < 1) bird.captureTime = -1;
        if (bird.landed) {
          bird.position.copy(perch);
          bird.velocity.set(0, 0, 0);
        } else if (p >= 1) {
          this.capture(bird, step);
        } else {
          this.fly(bird, p, step, clock - duration + n * step);
        }
        bird.fold = damp(bird.fold, bird.landed ? 1 : phase(p, .98, 1) * Math.exp(-bird.position.distanceTo(perch)), 9, step);
        if (!bird.landed && bird.velocity.lengthSq() > .02) {
          this.delta.copy(bird.velocity).normalize();
          this.heading.setFromUnitVectors(FORWARD, this.delta);
          bird.rotation.slerp(this.heading, 1 - Math.exp(-7 * step));
        } else if (bird.landed) {
          this.delta.set(0, 0, 1).applyQuaternion(bird.rotation);
          this.heading.setFromAxisAngle(UP, Math.atan2(this.delta.x, this.delta.z));
          bird.rotation.slerp(this.heading, 1 - Math.exp(-10 * step));
        }
      }
    }
    this.tint.copy(PAPER).lerp(climate.light, .12).lerp(climate.ambient, .06);
    this.material.color.lerp(this.tint, 1 - Math.exp(-3 * duration));
    this.draw(clock);
  }

  private fly(bird: Bird, progress: number, dt: number, time: number): void {
    const arrival = phase(progress, .98, 1);
    this.desired.copy(bird.target);
    if (progress < .98) {
      const angle = time * .48 + bird.phase;
      this.desired.add(this.delta.set(Math.cos(angle) * 3.4, 1.5 + Math.sin(angle * 1.3) * .7, Math.sin(angle) * 2.8));
    }
    this.desired.sub(bird.position).multiplyScalar(2.3).clampLength(0, 9);
    this.separation.set(0, 0, 0);
    this.alignment.set(0, 0, 0);
    this.cohesion.set(0, 0, 0);
    let neighbors = 0;
    for (const other of this.birds) {
      if (other === bird || !other.active || other.landed) continue;
      this.delta.subVectors(bird.position, other.position);
      const distanceSq = this.delta.lengthSq();
      if (distanceSq > 36 || distanceSq < .00001) continue;
      if (distanceSq < 2.25) this.separation.addScaledVector(this.delta, 1 / Math.max(.08, distanceSq));
      this.alignment.add(other.velocity);
      this.cohesion.add(other.position);
      neighbors++;
    }
    if (neighbors) {
      this.alignment.divideScalar(neighbors).sub(bird.velocity);
      this.cohesion.divideScalar(neighbors).sub(bird.position);
      const weight = 1 - arrival;
      this.desired.addScaledVector(this.separation, 2.1 * weight)
        .addScaledVector(this.alignment, .22 * weight).addScaledVector(this.cohesion, .12 * weight);
    }
    this.desired.clampLength(0, 9);
    bird.velocity.lerp(this.desired, 1 - Math.exp(-3.8 * dt)).clampLength(0, 9);
    bird.position.addScaledVector(bird.velocity, dt);
    if (progress >= .98 && bird.position.distanceToSquared(bird.target) < .018 && bird.velocity.lengthSq() < 1) {
      bird.landed = true;
      bird.position.copy(bird.target);
      bird.velocity.set(0, 0, 0);
    }
  }

  private capture(bird: Bird, dt: number): void {
    if (bird.captureTime < 0) {
      bird.captureTime = 0;
      bird.captureOffset.subVectors(bird.position, bird.target);
      bird.captureVelocity.copy(bird.velocity);
    }
    // 终章使用带初速、末速为零的 Hermite 残差；最后出生的鸟也在 0.36 + 1.42 秒归巢。
    // 残差叠加于实时栖点，因此停驻后的鸟不会与风中树枝滑脱。
    bird.captureTime += dt;
    const u = clamp(bird.captureTime / 1.42);
    this.desired.copy(bird.target)
      .addScaledVector(bird.captureOffset, 1 - 3 * u * u + 2 * u * u * u)
      .addScaledVector(bird.captureVelocity, 1.42 * u * (1 - u) * (1 - u));
    this.delta.subVectors(this.desired, bird.position).clampLength(0, 48 * dt);
    bird.position.add(this.delta);
    if (dt > 0) bird.velocity.copy(this.delta).divideScalar(dt);
    if (u >= 1 && bird.position.distanceToSquared(bird.target) < .018) {
      bird.landed = true;
      bird.position.copy(bird.target);
      bird.velocity.set(0, 0, 0);
    }
  }

  private draw(time: number): void {
    this.group.updateWorldMatrix(true, false);
    // 内部模拟在世界空间，输出实例矩阵时逆变换，允许调用方把 group 放在变换后的父级。
    this.matrix.copy(this.group.matrixWorld).invert();
    let count = 0;
    for (const bird of this.birds) {
      if (!bird.active) continue;
      this.object.position.copy(bird.position);
      this.object.quaternion.copy(bird.rotation);
      this.object.scale.setScalar(bird.size);
      this.object.updateMatrix();
      this.object.matrix.premultiply(this.matrix);
      this.bodies.setMatrixAt(count, this.object.matrix);
      const flap = bird.landed ? 0 : Math.sin(time * 12 + bird.phase) * .62 * (1 - bird.fold);
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? 1 : -1;
        this.localWing.position.set(sign * .065, .17, 0);
        this.localWing.rotation.set(0, side * Math.PI, sign * (flap - bird.fold * 1.38), 'ZYX');
        this.localWing.updateMatrix();
        this.localWing.matrix.premultiply(this.object.matrix);
        this.wings.setMatrixAt(count * 2 + side, this.localWing.matrix);
      }
      count++;
    }
    this.bodies.count = count;
    this.wings.count = count * 2;
    this.bodies.instanceMatrix.needsUpdate = true;
    this.wings.instanceMatrix.needsUpdate = true;
    this.group.visible = count > 0;
  }

  private reset(): void {
    this.elapsed = 0;
    this.group.visible = false;
    this.bodies.count = this.wings.count = 0;
    for (const bird of this.birds) {
      bird.active = bird.landed = false;
      bird.captureTime = -1;
      bird.fold = 0;
      bird.position.copy(bird.spawn);
      bird.velocity.set(0, 0, 0);
      bird.rotation.identity();
    }
  }

  /** 返回实际可见、栖息数量，以及模拟与实例矩阵的有限数状态。 */
  metrics(): { count: number; visible: number; landed: number; finite: boolean } {
    return {
      count: COUNT,
      visible: this.disposed ? 0 : this.birds.filter(bird => bird.active).length,
      landed: this.disposed ? 0 : this.birds.filter(bird => bird.active && bird.landed).length,
      finite: this.birds.every(bird => [...bird.position.toArray(), ...bird.velocity.toArray(), ...bird.rotation.toArray()].every(Number.isFinite))
        && this.bodies.instanceMatrix.array.every(Number.isFinite) && this.wings.instanceMatrix.array.every(Number.isFinite),
    };
  }

  /** 释放本实例独占的共享资源；重复调用安全。 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.reset();
    this.group.removeFromParent();
    this.group.clear();
    this.bodies.dispose();
    this.wings.dispose();
    this.bodyGeometry.dispose();
    this.wingGeometry.dispose();
    this.material.dispose();
  }
}
