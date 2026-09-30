import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Terrain } from './terrain';

export type CameraMode = 'auto' | 'fixed' | 'free';

const damp = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt));

/**
 * 镜头导演：
 * - 自动：沿岸缓慢横移，周期性推向水边再退回；
 * - 固定：贴近沙面的静观，看水线一来一回；
 * - 自由：拖拽环绕、滚轮 / 双指变焦。
 * 书写时镜头停住，免得字写歪。
 */
export class Director {
  mode: CameraMode = 'auto';
  hold = false;
  readonly controls: OrbitControls;
  private readonly pos = new THREE.Vector3(-20, 3, 0);
  private readonly look = new THREE.Vector3(40, 0, 0);
  private readonly desiredPos = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();
  private shoreSmoothed = 20;
  private fixedPose: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;

  constructor(private readonly camera: THREE.PerspectiveCamera, dom: HTMLElement) {
    this.controls = new OrbitControls(camera, dom);
    this.controls.enabled = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 220;
    this.controls.maxPolarAngle = Math.PI * 0.49;
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.controls.enabled = mode === 'free' && !this.hold;
    if (mode === 'free') {
      this.controls.target.copy(this.look);
      this.controls.update();
    }
  }

  setHold(hold: boolean): void {
    this.hold = hold;
    this.controls.enabled = this.mode === 'free' && !hold;
  }

  /** 换海岸后重新挑选固定机位：平均海面水边线后方几米、贴地 */
  resetForTerrain(terrain: Terrain): void {
    const z = 6;
    const shore = terrain.shorelineX(0, z);
    const x = Math.min(shore - 5, terrain.standLimit);
    this.fixedPose = {
      pos: new THREE.Vector3(x, terrain.heightAt(x, z) + 0.8, z),
      look: new THREE.Vector3(shore + 45, -0.2, z + 22),
    };
    this.shoreSmoothed = shore;
  }

  update(dt: number, time: number, tide: number, terrain: Terrain): void {
    if (this.hold) return;

    if (this.mode === 'free') {
      this.controls.update();
      const ground = terrain.heightAt(this.camera.position.x, this.camera.position.z) + 0.4;
      if (this.camera.position.y < ground) this.camera.position.y = ground;
      this.pos.copy(this.camera.position);
      this.look.copy(this.controls.target);
      return;
    }

    if (this.mode === 'fixed' && this.fixedPose) {
      this.desiredPos.copy(this.fixedPose.pos);
      this.desiredLook.copy(this.fixedPose.look);
    } else {
      // 沿岸横移，周期性推向水边
      const z = 55 * Math.sin((time / 160) * Math.PI * 2);
      const shore = terrain.shorelineX(tide, z);
      this.shoreSmoothed = damp(this.shoreSmoothed, shore, 0.6, dt);
      const push = Math.pow(0.5 - 0.5 * Math.cos((time / 52) * Math.PI * 2), 2);
      const back = 16 - 10 * push;
      const x = Math.min(this.shoreSmoothed - back, terrain.standLimit);
      this.desiredPos.set(x, terrain.heightAt(x, z) + 1.7 - 0.6 * push, z);
      this.desiredLook.set(this.shoreSmoothed + 34, tide + 0.2, z + 16 * Math.sin((time / 90) * Math.PI * 2 + 1));
    }

    const rate = 1.4;
    this.pos.set(damp(this.pos.x, this.desiredPos.x, rate, dt), damp(this.pos.y, this.desiredPos.y, rate, dt), damp(this.pos.z, this.desiredPos.z, rate, dt));
    this.look.set(damp(this.look.x, this.desiredLook.x, rate, dt), damp(this.look.y, this.desiredLook.y, rate, dt), damp(this.look.z, this.desiredLook.z, rate, dt));
    const ground = terrain.heightAt(this.pos.x, this.pos.z) + 0.5;
    if (this.pos.y < ground) this.pos.y = ground;
    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
  }

  /** 首帧直接到位，不做缓动 */
  snap(time: number, tide: number, terrain: Terrain): void {
    this.update(10, time, tide, terrain);
  }

  dispose(): void {
    this.controls.dispose();
  }
}
