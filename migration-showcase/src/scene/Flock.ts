import * as THREE from 'three';
import { sampleClimate } from './climates';
import { clamp, damp, hash, riverX, TAU, tupleToColor } from './math';
import { animatePaperBird, createPaperBird, createPaperBirdResources, disposePaperBirdResources, type PaperBirdModel } from './PaperBird';

interface BirdState extends PaperBirdModel {
  index: number;
  anchorX: number;
  anchorZ: number;
  x: number;
  y: number;
  z: number;
  velocityX: number;
  velocityY: number;
  velocityZ: number;
  stiffness: number;
  phase: number;
  courage: number;
  scale: number;
}

export interface FlockMetrics {
  count: number;
  visible: number;
  maxScreenX: number;
  finite: boolean;
}

function makeShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(48, 48, 3, 48, 48, 45);
    gradient.addColorStop(0, 'rgba(33, 38, 31, .44)');
    gradient.addColorStop(0.46, 'rgba(33, 38, 31, .17)');
    gradient.addColorStop(1, 'rgba(33, 38, 31, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 96, 96);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 每只鸟拥有独立弹簧、相位和胆量，群体只共享航线中心。 */
export class Flock {
  readonly group = new THREE.Group();
  readonly count: number;

  private readonly birds: BirdState[];
  private readonly modelResources = createPaperBirdResources();
  private readonly shadowTexture = makeShadowTexture();
  private readonly shadowMaterial: THREE.MeshBasicMaterial;
  private readonly shadows: THREE.InstancedMesh;
  private readonly shadowMatrix = new THREE.Matrix4();
  private readonly shadowPosition = new THREE.Vector3();
  private readonly shadowQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
  private readonly shadowScale = new THREE.Vector3();
  private readonly projection = new THREE.Vector3();
  private readonly targetColor = new THREE.Color();
  private readonly cameraDirection = new THREE.Vector3();
  private readonly cameraRight = new THREE.Vector3();
  private readonly separation = new THREE.Vector3();
  private center = new THREE.Vector3();

  constructor(seed: number, isTouch: boolean) {
    this.count = isTouch ? 22 : 30;
    this.group.name = 'paper-flock';
    this.shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x30342e,
      map: this.shadowTexture,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      toneMapped: false,
    });
    this.shadows = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), this.shadowMaterial, this.count);
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 1;
    this.group.add(this.shadows);

    this.birds = Array.from({ length: this.count }, (_, index) => {
      const radius = Math.sqrt((index + 0.5) / this.count);
      const angle = index * 2.399963229728653;
      const anchorX = Math.cos(angle) * radius * 238;
      const anchorZ = Math.sin(angle) * radius * 176;
      const model = createPaperBird(this.modelResources);
      const { group } = model;
      // 分层翼面比旧三角翼更丰满，略收小模型以保留鸟群之间的留白。
      const scale = 0.7 + hash(index, 14, seed) * 0.34;
      group.scale.setScalar(scale);
      group.matrixAutoUpdate = true;
      this.group.add(group);
      return {
        index,
        anchorX,
        anchorZ,
        x: anchorX,
        y: 174 + (index % 4) * 17,
        z: anchorZ,
        velocityX: 0,
        velocityY: 0,
        velocityZ: 0,
        stiffness: 1.5 + hash(index, 11, seed) * 2.7,
        phase: hash(index, 12, seed) * TAU,
        courage: 0.22 + Math.pow(hash(index, 13, seed), 4.5) * 3.1,
        scale,
        ...model,
      };
    });
  }

  update(
    delta: number,
    elapsed: number,
    routeZ: number,
    windX: number,
    windY: number,
    camera: THREE.PerspectiveCamera,
    viewportWidth: number,
  ): void {
    const centerX = riverX(routeZ) - 95;
    this.center.set(centerX, 188, routeZ);
    camera.getWorldDirection(this.cameraDirection);
    this.cameraRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const worldWindX = (this.cameraRight.x * windX - this.cameraDirection.x * windY * 0.65) * 136;
    const worldWindZ = (this.cameraRight.z * windX - this.cameraDirection.z * windY * 0.65) * 136;

    for (const bird of this.birds) {
      this.separation.set(0, 0, 0);
      for (const other of this.birds) {
        if (bird === other) continue;
        const dx = bird.x - other.x;
        const dy = (bird.y - other.y) * 0.6;
        const dz = bird.z - other.z;
        const distanceSquared = dx * dx + dy * dy + dz * dz;
        if (distanceSquared >= 4900 || distanceSquared <= 0.01) continue;
        const distance = Math.sqrt(distanceSquared);
        const force = Math.min(20, 16500 / (distanceSquared + 95));
        const falloff = 1 - Math.min(Math.max((distance - 28) / 42, 0), 1);
        this.separation.x += dx / distance * force * falloff;
        this.separation.y += dy / distance * force * falloff * 0.45;
        this.separation.z += dz / distance * force * falloff;
      }
      const planarSeparation = Math.hypot(this.separation.x, this.separation.z);
      if (planarSeparation > 40) {
        this.separation.x *= 40 / planarSeparation;
        this.separation.z *= 40 / planarSeparation;
      }

      this.projection.set(centerX + bird.x, bird.y, routeZ + bird.z).project(camera);
      const normalizedX = this.projection.x * 0.5 + 0.5;
      const breathingBoundary = 0.595 + Math.sin(elapsed * 0.45 + bird.phase) * 0.023;
      const rightInfluence = 1 - clamp((normalizedX - 0.43) / Math.max(breathingBoundary - 0.43, 0.01));
      const leftInfluence = clamp((normalizedX - 0.025) / 0.155);
      const influence = windX >= 0 ? rightInfluence : leftInfluence;
      const rightPush = normalizedX > breathingBoundary ? clamp((normalizedX - breathingBoundary) * 1250, 0, 210) : 0;
      const leftPush = normalizedX < 0.06 ? (normalizedX - 0.06) * 1000 : 0;
      const boundaryForce = rightPush + leftPush;

      const targetX = bird.anchorX + worldWindX * bird.courage * influence + Math.sin(elapsed * 0.43 + bird.phase) * 13;
      const targetZ = bird.anchorZ + worldWindZ * bird.courage * influence + Math.cos(elapsed * 0.34 + bird.phase) * 15;
      const targetY = 178 + (bird.index % 4) * 17 + Math.sin(elapsed * 0.76 + bird.phase) * 10 - windY * 19 * bird.courage;
      const damping = 2 * Math.sqrt(bird.stiffness) * 0.91;
      bird.velocityX += ((targetX - bird.x) * bird.stiffness + this.separation.x - boundaryForce * this.cameraRight.x - damping * bird.velocityX) * delta;
      bird.velocityZ += ((targetZ - bird.z) * bird.stiffness + this.separation.z - boundaryForce * this.cameraRight.z - damping * bird.velocityZ) * delta;
      bird.velocityY += ((targetY - bird.y) * bird.stiffness * 0.72 + this.separation.y - damping * bird.velocityY) * delta;
      const speed = Math.hypot(bird.velocityX, bird.velocityZ);
      if (speed > 145) {
        bird.velocityX *= 145 / speed;
        bird.velocityZ *= 145 / speed;
      }
      bird.x += bird.velocityX * delta;
      bird.y += bird.velocityY * delta;
      bird.z += bird.velocityZ * delta;

      const worldX = centerX + bird.x;
      const worldZ = routeZ + bird.z;
      bird.group.position.set(worldX, bird.y, worldZ);
      bird.group.rotation.y = Math.atan2(bird.velocityX, 74 + bird.velocityZ) * 0.56;
      bird.group.rotation.z = clamp(-bird.velocityX * 0.004, -0.4, 0.4);
      bird.group.rotation.x = clamp(windY * 0.05 - bird.velocityY * 0.002, -0.12, 0.12);
      const cycle = elapsed * (1.52 + bird.stiffness * 0.08) + bird.phase;
      const glide = 0.78 + Math.sin(elapsed * 0.27 + bird.phase * 0.7) ** 2 * 0.22;
      animatePaperBird(bird, cycle, glide, clamp(bird.velocityX / 90, -1, 1), bird.velocityY);

      const climate = sampleClimate(worldX, worldZ);
      tupleToColor(climate.bird, this.targetColor);
      bird.material.color.lerp(this.targetColor, 1 - Math.exp(-delta * 2.2));
      bird.material.emissive.copy(this.targetColor).multiplyScalar(climate.night * 0.065);

      const shadowSize = 18 + bird.y * 0.18 * bird.scale;
      this.shadowPosition.set(worldX + bird.y * 0.24, 1.35, worldZ + bird.y * 0.17);
      this.shadowScale.set(shadowSize * 1.5, shadowSize * 0.54, 1);
      this.shadowMatrix.compose(this.shadowPosition, this.shadowQuaternion, this.shadowScale);
      this.shadows.setMatrixAt(bird.index, this.shadowMatrix);
    }
    this.shadows.instanceMatrix.needsUpdate = true;
    this.shadowMaterial.opacity = damp(this.shadowMaterial.opacity, 0.16, 2, delta);
    void viewportWidth;
  }

  metrics(camera: THREE.PerspectiveCamera): FlockMetrics {
    let visible = 0;
    let maxScreenX = 0;
    let finite = true;
    for (const bird of this.birds) {
      this.projection.copy(bird.group.position).project(camera);
      if (Math.abs(this.projection.x) < 1.08 && Math.abs(this.projection.y) < 1.08 && this.projection.z < 1) visible += 1;
      maxScreenX = Math.max(maxScreenX, this.projection.x * 0.5 + 0.5);
      finite = finite && Number.isFinite(bird.x + bird.y + bird.z + this.projection.x + this.projection.y);
    }
    return { count: this.count, visible, maxScreenX, finite };
  }

  getCenter(target = new THREE.Vector3()): THREE.Vector3 {
    return target.copy(this.center);
  }

  dispose(): void {
    disposePaperBirdResources(this.modelResources);
    this.shadows.geometry.dispose();
    this.shadowTexture.dispose();
    this.shadowMaterial.dispose();
    this.birds.forEach((bird) => bird.material.dispose());
  }
}
