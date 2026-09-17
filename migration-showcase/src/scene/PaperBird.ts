import * as THREE from 'three';

type Point = readonly [number, number, number];
type Face = readonly [number, number, number, number];

export interface PaperBirdResources {
  body: THREE.BufferGeometry;
  wing: THREE.BufferGeometry;
  tail: THREE.BufferGeometry;
  paper: THREE.DataTexture;
}

export interface PaperBirdModel {
  group: THREE.Group;
  leftWing: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  rightWing: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  tail: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  material: THREE.MeshStandardMaterial;
}

/** 将折面、纸边和压痕合入同一几何，避免为每条折痕增加绘制调用。 */
class PaperSurface {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];
  private readonly uvs: number[] = [];

  triangle(a: Point, b: Point, c: Point, shade: number, upward = false): void {
    // 翼面在 XZ 平面展开；统一上表面的绕序，让薄纸两面获得正确光照。
    const normalY = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const vertices = upward && normalY < 0 ? [a, c, b] : [a, b, c];
    for (const vertex of vertices) {
      this.positions.push(...vertex);
      this.colors.push(shade * 0.986, shade, Math.min(1, shade * 1.018));
      this.uvs.push(vertex[0] * 0.047 + vertex[1] * 0.016, vertex[2] * 0.047);
    }
  }

  sheet(points: readonly Point[], faces: readonly Face[], outline: readonly number[], thickness: number): void {
    for (const [a, b, c, shade] of faces) {
      this.triangle(points[a], points[b], points[c], shade, true);
      const lower = [points[a], points[b], points[c]].map(([x, y, z]): Point => [x, y - thickness, z]);
      const normalY = (lower[1][2] - lower[0][2]) * (lower[2][0] - lower[0][0])
        - (lower[1][0] - lower[0][0]) * (lower[2][2] - lower[0][2]);
      this.triangle(lower[0], lower[normalY > 0 ? 2 : 1], lower[normalY > 0 ? 1 : 2], shade * 0.88);
    }
    for (let index = 0; index < outline.length; index += 1) {
      const a = points[outline[index]];
      const b = points[outline[(index + 1) % outline.length]];
      const c: Point = [b[0], b[1] - thickness, b[2]];
      const d: Point = [a[0], a[1] - thickness, a[2]];
      this.triangle(a, c, b, 0.79);
      this.triangle(a, d, c, 0.79);
    }
  }

  crease(a: Point, b: Point, width: number, shade: number): void {
    const length = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const offsetX = -(b[2] - a[2]) / length * width * 0.5;
    const offsetZ = (b[0] - a[0]) / length * width * 0.5;
    const points: Point[] = [
      [a[0] + offsetX, a[1] + 0.075, a[2] + offsetZ],
      [b[0] + offsetX, b[1] + 0.075, b[2] + offsetZ],
      [b[0] - offsetX, b[1] + 0.075, b[2] - offsetZ],
      [a[0] - offsetX, a[1] + 0.075, a[2] - offsetZ],
    ];
    this.triangle(points[0], points[1], points[2], shade, true);
    this.triangle(points[0], points[2], points[3], shade, true);
  }

  build(name: string): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.name = name;
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

function makeWing(): THREE.BufferGeometry {
  const surface = new PaperSurface();
  // 从翼根到外翼逐渐后掠，四枚错落翼尖保留折纸切口，不描摹写实羽毛。
  const points: Point[] = [
    [0, 0.2, 10], [10, 2.8, 11.5], [23, 2.3, 4], [35, 1.2, -0.8],
    [46, 0.3, -8.5], [55, -0.4, -20], [47, -0.8, -18.8], [47.6, -1.2, -24.5],
    [40.4, -1, -21.5], [39.5, -1.6, -26], [32.6, -1.2, -21.5], [30.6, -1.65, -24.5],
    [20.5, -0.8, -17], [9, -1.2, -11], [0, -0.1, -8],
    [8, -1.4, 2], [20, 0.8, -4], [29, -0.6, -9], [38, 0.1, -12],
  ];
  surface.sheet(points, [
    [0, 1, 15, 1], [1, 2, 16, 0.98], [1, 16, 15, 0.84],
    [0, 15, 14, 0.87], [14, 15, 13, 0.79], [15, 16, 13, 0.92], [13, 16, 12, 0.85],
    [2, 3, 16, 0.99], [16, 3, 17, 0.90], [16, 17, 12, 0.79],
    [12, 17, 11, 0.96], [17, 10, 11, 0.80], [17, 9, 10, 0.99],
    [17, 8, 9, 0.83], [17, 18, 8, 0.94], [18, 7, 8, 0.98],
    [18, 6, 7, 0.81], [18, 5, 6, 0.96], [3, 4, 18, 1],
    [3, 18, 17, 0.86], [4, 5, 18, 0.92],
  ], Array.from({ length: 15 }, (_, index) => index), 0.28);
  for (const [a, b] of [[1, 15], [2, 16], [16, 12], [3, 18], [18, 6], [17, 8], [17, 10]]) {
    surface.crease(points[a], points[b], 0.12, 0.73);
  }

  const geometry = surface.build('paper-bird-layered-wing');
  const position = geometry.getAttribute('position');
  const flex = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 1) {
    const reach = Math.max(0, position.getX(index) - 18);
    const weight = Math.min(reach / 37, 1);
    // 同一变形作用于纸面、下表面及折线，翼尖弯折时不会出现裂缝。
    flex[index * 3] = -reach * 0.075;
    flex[index * 3 + 1] = Math.pow(reach, 1.35) * 0.17;
    flex[index * 3 + 2] = -weight * weight * 2.4;
  }
  geometry.morphAttributes.position = [new THREE.Float32BufferAttribute(flex, 3)];
  geometry.morphTargetsRelative = true;
  // 包围体包含正负弯折的极值，避免翼尖在画面边缘提前被裁掉。
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(26, 0, -6), 45);
  return geometry;
}

interface BodySection {
  z: number;
  width: number;
  middle: number;
  top: number;
  bottom: number;
}

function makeBody(): THREE.BufferGeometry {
  const surface = new PaperSurface();
  // 八棱截面沿龙骨收放，胸腹、窄颈和头部分别成形，避免纸飞机的尖锥机身。
  const sections: BodySection[] = [
    { z: -18, width: 1.6, middle: 0, top: 1.9, bottom: -1.4 },
    { z: -10, width: 4.5, middle: 0, top: 4.9, bottom: -3.8 },
    { z: 1, width: 5.5, middle: 0.3, top: 6.3, bottom: -5.4 },
    { z: 10, width: 4.5, middle: 1.4, top: 6.5, bottom: -3.5 },
    { z: 16, width: 2.5, middle: 3.4, top: 7, bottom: 0.6 },
    { z: 23, width: 1.7, middle: 6.6, top: 8.9, bottom: 4.5 },
    { z: 27.5, width: 2.6, middle: 8.2, top: 10.6, bottom: 5.9 },
    { z: 31.5, width: 1.9, middle: 7.8, top: 9.6, bottom: 6.1 },
    { z: 39, width: 0, middle: 6.5, top: 6.5, bottom: 6.5 },
  ];
  const rings = sections.map(({ z, width, middle, top, bottom }): Point[] => [
    [0, top, z], [width * 0.68, middle + (top - middle) * 0.64, z],
    [width, middle, z], [width * 0.64, middle + (bottom - middle) * 0.67, z],
    [0, bottom, z], [-width * 0.64, middle + (bottom - middle) * 0.67, z],
    [-width, middle, z], [-width * 0.68, middle + (top - middle) * 0.64, z],
  ]);
  const shades = [0.98, 0.91, 0.82, 0.75, 0.80, 0.86, 0.95, 1];
  for (let ring = 0; ring < rings.length - 1; ring += 1) {
    for (let side = 0; side < 8; side += 1) {
      const next = (side + 1) % 8;
      const shade = shades[side] * (ring === 7 ? 0.72 : 1);
      surface.triangle(rings[ring][side], rings[ring + 1][next], rings[ring][next], shade);
      if (ring < rings.length - 2) {
        surface.triangle(rings[ring][side], rings[ring + 1][side], rings[ring + 1][next], shade * 0.98);
      }
    }
  }
  for (let side = 0; side < 8; side += 1) {
    surface.triangle([0, 0, -18], rings[0][side], rings[0][(side + 1) % 8], 0.8);
  }

  // 眼睛嵌在头侧折面上，与机身合批；只在近景读出小小的墨点。
  for (const side of [-1, 1]) {
    const eye = [[28.3, 8.58], [29.15, 9.05], [30, 8.60], [29.15, 8.14]].map(([z, y]): Point => {
      const t = (z - 27.5) / 4;
      const width = 2.6 - t * 0.7;
      const middle = 8.2 - t * 0.4;
      const top = 10.6 - t;
      const x = width * (1 - Math.max(0, y - middle) / ((top - middle) * 0.64) * 0.32) + 0.065;
      return [x * side, y, z];
    });
    surface.triangle(eye[0], eye[1], eye[2], 0.13);
    surface.triangle(eye[0], eye[2], eye[3], 0.13);
  }
  for (let ring = 1; ring < 4; ring += 1) {
    surface.crease(rings[ring][0], rings[ring + 1][0], 0.095, 0.84);
  }
  return surface.build('paper-bird-keel-neck-head');
}

function makeTail(): THREE.BufferGeometry {
  const surface = new PaperSurface();
  const points: Point[] = [
    [-2.8, 0.4, 1], [2.8, 0.4, 1], [9.2, -0.7, -21],
    [2.6, -0.5, -18.5], [0, 0.1, -14], [-2.6, -0.5, -18.5],
    [-9.2, -0.7, -21], [0, 1.9, -4], [4, 0.8, -12], [-4, 0.8, -12],
  ];
  surface.sheet(points, [
    [0, 1, 7, 1], [1, 2, 8, 0.94], [1, 8, 7, 0.84], [8, 2, 3, 0.78],
    [7, 8, 4, 0.98], [8, 3, 4, 0.86], [0, 7, 9, 0.96], [0, 9, 6, 0.84],
    [9, 5, 6, 0.97], [7, 4, 9, 0.83], [9, 4, 5, 0.75],
  ], [0, 1, 2, 3, 4, 5, 6], 0.23);
  surface.crease(points[7], points[8], 0.11, 0.76);
  surface.crease(points[7], points[9], 0.11, 0.78);
  return surface.build('paper-bird-fan-tail');
}

function makePaperGrain(): THREE.DataTexture {
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  let state = 9217;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const noise = state / 0xffffffff;
      const fiber = Math.sin(x * 0.53 + Math.sin(y * 0.19) * 2) * 5;
      const value = Math.round(170 + noise * 55 + fiber);
      const offset = (y * size + x) * 4;
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = value;
      pixels[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.name = 'shared-paper-fibers';
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** 只创建一份鸟体、翼面、尾羽和纸纹，整群共享，场景卸载时统一释放。 */
export function createPaperBirdResources(): PaperBirdResources {
  return { body: makeBody(), wing: makeWing(), tail: makeTail(), paper: makePaperGrain() };
}

/** 用四个网格组装折纸候鸟，颜色材质独立，以便逐鸟采样地理锋面。 */
export function createPaperBird(resources: PaperBirdResources): PaperBirdModel {
  const material = new THREE.MeshStandardMaterial({
    color: 0xf7f4ea,
    vertexColors: true,
    roughness: 0.91,
    metalness: 0,
    flatShading: true,
    side: THREE.DoubleSide,
    bumpMap: resources.paper,
    bumpScale: 0.085,
  });
  const group = new THREE.Group();
  group.name = 'folded-migrant';
  const body = new THREE.Mesh(resources.body, material);
  const leftWing = new THREE.Mesh(resources.wing, material);
  const rightWing = new THREE.Mesh(resources.wing, material);
  const tail = new THREE.Mesh(resources.tail, material);
  leftWing.position.set(3.4, 1.3, 0);
  rightWing.position.set(-3.4, 1.3, 0);
  rightWing.scale.x = -1;
  tail.position.set(0, 0.2, -14);
  group.add(body, leftWing, rightWing, tail);
  return { group, leftWing, rightWing, tail, material };
}

/** 翼根先起落，外翼延迟弯折；尾羽轻调俯仰和偏航，让滑翔有纸张的柔韧。 */
export function animatePaperBird(bird: PaperBirdModel, cycle: number, glide: number, turn: number, lift: number): void {
  const stroke = Math.sin(cycle);
  const flap = stroke * 0.38 * glide + 0.075;
  const flex = (Math.sin(cycle - 0.8) * 0.48 - stroke * 0.31) * glide;
  bird.leftWing.rotation.z = flap + turn * 0.035;
  bird.rightWing.rotation.z = -flap + turn * 0.035;
  bird.leftWing.rotation.y = Math.cos(cycle + 0.25) * 0.025;
  bird.rightWing.rotation.y = -bird.leftWing.rotation.y;
  bird.leftWing.morphTargetInfluences![0] = flex;
  bird.rightWing.morphTargetInfluences![0] = flex;
  bird.tail.rotation.x = -0.025 + Math.sin(cycle - 0.9) * 0.055 + lift * 0.0012;
  bird.tail.rotation.y = turn * 0.085;
}

/** 与鸟群生命周期一起释放共享 GPU 资源。 */
export function disposePaperBirdResources(resources: PaperBirdResources): void {
  resources.body.dispose();
  resources.wing.dispose();
  resources.tail.dispose();
  resources.paper.dispose();
}
