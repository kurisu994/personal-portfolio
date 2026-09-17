import * as THREE from 'three';
import { CLIMATES, SEGMENT_LENGTH, type ClimateSample, type ColorTuple } from './climates';
import { hash, mod, riverX, smoothstep, tupleToColor } from './math';

type ParticleKind = 'dust' | 'snow' | 'petal' | 'firefly';

interface ParticleLayer {
  points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  positions: THREE.BufferAttribute;
  opacity: THREE.BufferAttribute;
  order: number[];
  depths: Float32Array;
  count: number;
  kind: ParticleKind;
}

function particleTexture(kind: ParticleKind): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext('2d');
  if (context) {
    context.translate(48, 48);
    if (kind === 'dust') {
      const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 22);
      gradient.addColorStop(0, 'rgba(255,255,247,.65)');
      gradient.addColorStop(1, 'rgba(255,255,247,0)');
      context.fillStyle = gradient;
      context.fillRect(-28, -28, 56, 56);
    } else if (kind === 'snow') {
      context.strokeStyle = 'rgba(255,255,255,.95)';
      context.lineWidth = 2;
      for (let branch = 0; branch < 3; branch += 1) {
        const angle = branch * Math.PI / 3;
        context.beginPath();
        context.moveTo(Math.cos(angle) * -19, Math.sin(angle) * -19);
        context.lineTo(Math.cos(angle) * 19, Math.sin(angle) * 19);
        context.stroke();
      }
    } else if (kind === 'petal') {
      context.rotate(0.55);
      context.fillStyle = 'rgba(241,174,176,.9)';
      context.beginPath();
      context.ellipse(0, 0, 9, 24, 0, 0, Math.PI * 2);
      context.fill();
    } else {
      const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 34);
      gradient.addColorStop(0, 'rgba(255,247,172,1)');
      gradient.addColorStop(0.18, 'rgba(231,236,141,.82)');
      gradient.addColorStop(1, 'rgba(210,232,125,0)');
      context.fillStyle = gradient;
      context.fillRect(-38, -38, 76, 76);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeLayer(kind: ParticleKind, count: number, size: number): ParticleLayer {
  const geometry = new THREE.BufferGeometry();
  const positions = new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3);
  const opacity = new THREE.Float32BufferAttribute(new Float32Array(count), 1);
  geometry.setAttribute('position', positions);
  geometry.setAttribute('aParticleOpacity', opacity);
  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    map: particleTexture(kind),
    size,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    alphaTest: kind === 'snow' ? 0.04 : 0,
    blending: kind === 'firefly' ? THREE.AdditiveBlending : THREE.NormalBlending,
    toneMapped: kind !== 'firefly',
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float aParticleOpacity; varying float vParticleOpacity;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvParticleOpacity = aParticleOpacity;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vParticleOpacity;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vParticleOpacity;');
  };
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = kind === 'firefly' ? 6 : 4;
  const order = Array.from({ length: count }, (_, index) => index);
  geometry.setIndex(order);
  return { points, positions, opacity, order, depths: new Float32Array(count), count, kind };
}

function makeStarField(seed: number): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
  const count = 190;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const radius = 1900 + hash(index, 72, seed) * 2300;
    const angle = hash(index, 73, seed) * Math.PI * 2;
    positions[index * 3] = Math.cos(angle) * radius;
    positions[index * 3 + 1] = 480 + hash(index, 74, seed) * 1800;
    positions[index * 3 + 2] = Math.sin(angle) * radius;
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xf6f0d7,
    size: 5.2,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const stars = new THREE.Points(geometry, material);
  stars.frustumCulled = false;
  return stars;
}

function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  if (context) {
    const gradient = context.createRadialGradient(256, 256, 0, 256, 256, 248);
    gradient.addColorStop(0, 'rgba(255,232,179,.74)');
    gradient.addColorStop(0.24, 'rgba(255,218,160,.34)');
    gradient.addColorStop(0.58, 'rgba(246,192,148,.12)');
    gradient.addColorStop(1, 'rgba(246,192,148,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 512, 512);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** 粒子和天光全部留在三维场景中，由深度缓冲参与空间关系。 */
export class Atmosphere {
  readonly group = new THREE.Group();
  readonly stars: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  readonly glow: THREE.Sprite;
  private readonly sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly lightPool: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;

  private readonly layers: ParticleLayer[];
  private readonly seed: number;
  private readonly tempColor = new THREE.Color();

  constructor(seed: number, private readonly camera: THREE.PerspectiveCamera) {
    this.seed = seed;
    this.layers = [
      makeLayer('dust', 90, 8),
      makeLayer('snow', 240, 10),
      makeLayer('petal', 110, 13),
      makeLayer('firefly', 90, 19),
    ];
    this.layers.forEach((layer) => this.group.add(layer.points));
    this.stars = makeStarField(seed);
    this.group.add(this.stars);
    const glowMaterial = new THREE.SpriteMaterial({
      map: glowTexture(),
      color: 0xffd9a3,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.glow = new THREE.Sprite(glowMaterial);
    this.glow.position.set(360, -145, -1800);
    this.glow.scale.set(1450, 920, 1);
    this.glow.renderOrder = 20;
    camera.add(this.glow);
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(6100, 20, 12), new THREE.ShaderMaterial({
      uniforms: { topColor: { value: new THREE.Color() }, horizonColor: { value: new THREE.Color() } },
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: `varying vec3 vDirection; void main() { vDirection = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 topColor; uniform vec3 horizonColor; varying vec3 vDirection;
        void main() { float height = smoothstep(-0.18, 0.8, normalize(vDirection).y); gl_FragColor = vec4(mix(horizonColor, topColor, height), 1.0); }`,
    }));
    this.sky.renderOrder = -10;
    this.group.add(this.sky);
    this.lightPool = new THREE.Mesh(new THREE.PlaneGeometry(2100, 1200), new THREE.MeshBasicMaterial({
      map: glowTexture(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    this.lightPool.rotation.x = -Math.PI / 2;
    this.lightPool.renderOrder = 2;
    this.group.add(this.lightPool);
  }

  update(elapsed: number, routeZ: number, climate: ClimateSample, windX: number): void {
    const centerX = riverX(routeZ);
    for (const layer of this.layers) {
      for (let index = 0; index < layer.count; index += 1) {
        const seedA = hash(index, 3000 + layer.count, this.seed);
        const seedB = hash(index, 3001 + layer.count, this.seed);
        const seedC = hash(index, 3002 + layer.count, this.seed);
        let x = centerX + (seedA - 0.5) * 2500;
        let y = 20;
        let z = routeZ + mod(seedB * 2800 - elapsed * (8 + seedA * 9), 2800) - 1400;
        if (layer.kind === 'snow') {
          x += Math.sin(elapsed * 0.7 + seedC * 20) * 44 + windX * 70;
          y = mod(seedC * 760 - elapsed * (13 + seedB * 16), 760) + 12;
        } else if (layer.kind === 'petal') {
          x += Math.sin(elapsed * 1.1 + seedC * 16) * 92 + windX * 95;
          y = mod(seedC * 700 - elapsed * (7 + seedB * 9), 700) + 16;
          z += Math.cos(elapsed * 0.6 + seedA * 12) * 60;
        } else if (layer.kind === 'firefly') {
          x += Math.sin(elapsed * 0.43 + seedC * 19) * 58;
          y = 28 + seedC * 350 + Math.sin(elapsed * 0.8 + seedA * 16) * 35;
          z = routeZ + (seedB - 0.5) * 2400 + Math.cos(elapsed * 0.31 + seedC * 18) * 48;
        } else {
          x += Math.sin(elapsed * 0.2 + seedC * 17) * 35 + windX * 38;
          y = 35 + seedC * 570 + Math.sin(elapsed * 0.27 + seedA * 20) * 22;
        }
        layer.positions.setXYZ(index, x, y, z);
        const warped = z + Math.sin(x * 0.0029 + Math.sin(z * 0.00029)) * 390 + Math.sin(x * 0.0061 + z * 0.00037) * 155;
        const section = Math.floor((warped + 1650) / SEGMENT_LENGTH);
        const blend = smoothstep(-1650, 1650, warped - section * SEGMENT_LENGTH);
        const from = CLIMATES[mod(section - 1, CLIMATES.length)];
        const to = CLIMATES[mod(section, CLIMATES.length)];
        const amount = (palette: typeof from): number => {
          if (layer.kind === 'snow') return palette.snow;
          if (layer.kind === 'petal') return palette.dusk;
          if (layer.kind === 'firefly') return palette.night;
          return 1 - Math.max(palette.snow, palette.dusk, palette.night);
        };
        layer.opacity.setX(index, amount(from) * (1 - blend) + amount(to) * blend);
        const view = this.camera.matrixWorldInverse.elements;
        layer.depths[index] = -(view[2] * x + view[6] * y + view[10] * z + view[14]);
      }
      layer.positions.needsUpdate = true;
      layer.opacity.needsUpdate = true;
      layer.order.sort((a, b) => layer.depths[b] - layer.depths[a]);
      const sortedIndex = layer.points.geometry.getIndex();
      if (sortedIndex) {
        sortedIndex.array.set(layer.order);
        sortedIndex.needsUpdate = true;
      }
      const material = layer.points.material;
      if (layer.kind === 'dust') material.opacity = 0.42;
      if (layer.kind === 'snow') material.opacity = 0.86;
      if (layer.kind === 'petal') material.opacity = 0.72;
      if (layer.kind === 'firefly') material.opacity = 0.62 + Math.sin(elapsed * 1.6) * 0.13;
      const color: ColorTuple = layer.kind === 'petal'
        ? [0.96, 0.63, 0.64]
        : layer.kind === 'firefly'
          ? [0.91, 0.94, 0.56]
          : climate.bird;
      tupleToColor(color, this.tempColor);
      material.color.copy(this.tempColor);
    }
    this.stars.position.set(centerX, 0, routeZ);
    this.stars.rotation.y = elapsed * 0.0025;
    this.stars.material.opacity = climate.night * 0.76;
    const glowStrength = Math.min(climate.front * 0.46 + climate.dusk * 0.2, 0.58);
    (this.glow.material as THREE.SpriteMaterial).opacity = glowStrength;
    this.sky.position.copy(this.camera.position);
    tupleToColor(climate.sky, this.sky.material.uniforms.topColor.value as THREE.Color);
    tupleToColor(climate.horizon, this.sky.material.uniforms.horizonColor.value as THREE.Color);
    this.lightPool.position.set(centerX + 230, 1.05, routeZ + 740);
    this.lightPool.material.opacity = glowStrength * 0.34;
  }

  dispose(): void {
    for (const layer of this.layers) {
      layer.points.geometry.dispose();
      layer.points.material.map?.dispose();
      layer.points.material.dispose();
    }
    this.stars.geometry.dispose();
    this.stars.material.dispose();
    const material = this.glow.material as THREE.SpriteMaterial;
    material.map?.dispose();
    material.dispose();
    this.glow.removeFromParent();
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.lightPool.geometry.dispose();
    this.lightPool.material.map?.dispose();
    this.lightPool.material.dispose();
  }
}
