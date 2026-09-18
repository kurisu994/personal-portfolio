import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import type { Climate } from './climates';
import { bendPoint, clamp, mix, phase, randomSeed, TAU } from './math';
import { TreeMaterials } from './materials';

/** 当前拓扑及可见生长统计；孤立节点包括提前于挂点出现的枝、叶、果。 */
export interface TreeMetrics {
  branches: number;
  leaves: number;
  fruits: number;
  visibleBranches: number;
  visibleLeaves: number;
  visibleFruits: number;
  orphans: number;
  maxHeight: number;
}

interface Branch {
  curve: THREE.CatmullRomCurve3;
  parent: Branch | null;
  attachment: number;
  birth: number;
  end: number;
  radius: number;
  tipRadius: number;
  order: number;
}
interface Organ {
  branch: Branch;
  attachment: number;
  birth: number;
  end: number;
  anchor: THREE.Vector3;
  matrix: THREE.Matrix4;
  tint: number;
  phase: number;
  top: number;
}
interface InstanceSpec {
  matrix: THREE.Matrix4;
  anchor: THREE.Vector3;
  birth: number;
  end: number;
  tint: number;
  phase: number;
}
interface TubeBatch {
  positions: number[];
  normals: number[];
  uvs: number[];
  centers: number[];
  life: number[];
  along: number[];
  tone: number[];
  indices: number[];
}

const UP = new THREE.Vector3(0, 1, 0);
const LEAF_COUNT_PER_TWIG = 6;

// 额外预留一段收尖长度，子枝不能挂到尚未成形的细尖上。
function readyAt(branch: Branch, attachment: number): number {
  return mix(branch.birth, branch.end, clamp(attachment + .045));
}

function leafGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const rows = 10;
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    const width = .36 * Math.pow(Math.sin(Math.PI * t), .78);
    for (let side = 0; side < 3; side++) {
      const x = side - 1;
      positions.push(x * width, t, .11 * Math.sin(t * Math.PI) - x * x * .065 * Math.sin(t * Math.PI));
      uvs.push(side / 2, t);
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let side = 0; side < 2; side++) {
      const a = row * 3 + side;
      indices.push(a, a + 1, a + 3, a + 1, a + 4, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function appendTube(
  batch: TubeBatch, curve: THREE.CatmullRomCurve3, radius: number, tipRadius: number,
  birth: number, end: number, segments: number, sides: number, tone: number,
): void {
  const tube = new THREE.TubeGeometry(curve, segments, 1, sides, false);
  const position = tube.getAttribute('position');
  const center = new THREE.Vector3();
  for (let ring = 0; ring <= segments; ring++) {
    const t = ring / segments;
    curve.getPointAt(t, center);
    const r = mix(radius, tipRadius, 1 - Math.pow(1 - t, .82));
    for (let side = 0; side <= sides; side++) {
      const vertex = ring * (sides + 1) + side;
      // 由 TubeGeometry 的平行移动标架调径，避免每段独立旋转的关节裂缝。
      const irregularity = 1 + .035 * Math.sin(side / sides * TAU * 3 + t * 8);
      position.setXYZ(vertex,
        center.x + (position.getX(vertex) - center.x) * r * irregularity,
        center.y + (position.getY(vertex) - center.y) * r * irregularity,
        center.z + (position.getZ(vertex) - center.z) * r * irregularity);
      batch.centers.push(center.x, center.y, center.z);
      batch.life.push(birth, end);
      batch.along.push(t);
      batch.tone.push(tone);
    }
  }
  tube.computeVertexNormals();
  const normal = tube.getAttribute('normal');
  const uv = tube.getAttribute('uv');
  const offset = batch.positions.length / 3;
  for (let i = 0; i < position.count; i++) {
    batch.positions.push(position.getX(i), position.getY(i), position.getZ(i));
    batch.normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
    batch.uvs.push(uv.getX(i), uv.getY(i));
  }
  const index = tube.getIndex()!;
  for (let i = 0; i < index.count; i++) batch.indices.push(index.getX(i) + offset);
  tube.dispose();
}

function finishTubes(batch: TubeBatch): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(batch.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(batch.uvs, 2));
  geometry.setAttribute('aCenter', new THREE.Float32BufferAttribute(batch.centers, 3));
  geometry.setAttribute('aLife', new THREE.Float32BufferAttribute(batch.life, 2));
  geometry.setAttribute('aAlong', new THREE.Float32BufferAttribute(batch.along, 1));
  geometry.setAttribute('aTone', new THREE.Float32BufferAttribute(batch.tone, 1));
  geometry.setIndex(batch.indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/** 可复现的非对称分形树：连续木质部、实例水彩叶、悬果、鸟巢和贴合生长尖的子叶。 */
export class TreeModel {
  readonly group = new THREE.Group();
  readonly height = 18;
  readonly radius = 9;
  private readonly materials = new TreeMaterials();
  private readonly geometries = new Set<THREE.BufferGeometry>();
  private readonly branches: Branch[] = [];
  private readonly leaves: Organ[] = [];
  private readonly fruits: Organ[] = [];
  private readonly perchPoints: THREE.Vector3[] = [];
  private readonly visibilityRanges: { object: THREE.Object3D; birth: number; end: number }[] = [];
  private readonly trunk: Branch;
  private readonly random: () => number;
  private readonly noise: ReturnType<typeof createNoise3D>;
  private progress = 0;
  private disposed = false;

  /** 使用固定默认种子生成整棵树；叶片矩阵只在构造时上传。 */
  constructor(seed = 20260918) {
    this.group.name = 'watercolor-fractal-tree';
    this.random = randomSeed(seed);
    this.noise = createNoise3D(this.random);
    const batch: TubeBatch = {
      positions: [], normals: [], uvs: [], centers: [], life: [], along: [], tone: [], indices: [],
    };
    const trunkPoints: THREE.Vector3[] = [];
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      trunkPoints.push(new THREE.Vector3(
        Math.sin(t * 4.6) * 1.05 * t + this.noise(t * 2, 1, 0) * .28 * t,
        mix(-.5, 17.25, t),
        Math.sin(t * 7.1) * .32 * t + this.noise(0, t * 2, 2) * .19 * t,
      ));
    }
    this.trunk = this.addBranch(new THREE.CatmullRomCurve3(trunkPoints), null, 0, .16, .5, .7, .022, 0);
    this.createRoots();
    const primary: Branch[] = [];
    const twigs: Branch[] = [];
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < 19; i++) {
      const heightFraction = i / 18;
      const attachment = .385 + .405 * Math.pow(heightFraction, 1.15);
      const anchor = this.trunk.curve.getPointAt(attachment);
      const angle = i * goldenAngle + .65 + this.range(-.21, .21);
      const targetY = mix(8.8, 16.45, heightFraction) + this.range(-.7, .75);
      const reach = (6.6 - heightFraction * 3.45) * this.range(.85, 1.12);
      const target = new THREE.Vector3(Math.cos(angle) * reach, targetY, Math.sin(angle) * reach * .91);
      const birth = Math.max(.5 + this.range(0, .014), readyAt(this.trunk, attachment));
      const bough = this.addBranch(this.branchCurve(anchor, target, this.trunk.curve.getTangentAt(attachment), .14),
        this.trunk, attachment, birth, .61 + this.range(-.015, .018),
        mix(.31, .12, heightFraction), .026, 1);
      primary.push(bough);
      for (let j = 0; j < 5; j++) {
        const at = .3 + j * .145 + this.range(-.035, .035);
        const start = bough.curve.getPointAt(at);
        const side = j % 2 === 0 ? 1 : -1;
        const forkAngle = angle + side * this.range(.4, 1.05);
        const extension = this.range(1.65, 2.9) * mix(1, .62, heightFraction);
        const end = this.crownPoint(start.clone().add(new THREE.Vector3(
          Math.cos(forkAngle) * extension,
          this.range(-.7, 2.5) * (1 - heightFraction * .45),
          Math.sin(forkAngle) * extension,
        )));
        const secondaryBirth = Math.max(.56 + this.range(0, .025), readyAt(bough, at) + .003);
        const fork = this.addBranch(this.branchCurve(start, end, bough.curve.getTangentAt(at), .12),
          bough, at, secondaryBirth, Math.min(.698, secondaryBirth + this.range(.063, .081)),
          bough.radius * (1 - at * .6) * .4, .009, 2);
        for (let k = 0; k < 4; k++) {
          const twigAt = .35 + k * .19 + this.range(-.025, .025);
          const twigStart = fork.curve.getPointAt(twigAt);
          const twigAngle = forkAngle + (k % 2 ? 1 : -1) * this.range(.55, 1.35);
          const length = this.range(.78, 1.65);
          const twigEnd = this.crownPoint(twigStart.clone().add(new THREE.Vector3(
            Math.cos(twigAngle) * length,
            this.range(-.55, 1.25) * (1 - heightFraction * .45),
            Math.sin(twigAngle) * length,
          )));
          const twigBirth = Math.max(.7 + this.range(0, .03), readyAt(fork, twigAt) + .003);
          const twig = this.addBranch(this.branchCurve(twigStart, twigEnd, fork.curve.getTangentAt(twigAt), .095),
            fork, twigAt, twigBirth, twigBirth + this.range(.057, .082),
            fork.radius * (1 - twigAt * .56) * .43, .0025, 3);
          twigs.push(twig);
          for (let l = 0; l < LEAF_COUNT_PER_TWIG; l++) {
            this.leaves.push(this.createLeaf(twig, .26 + l * .137 + this.range(-.022, .022), l));
          }
        }
        this.leaves.push(this.createLeaf(fork, .84, j), this.createLeaf(fork, .985, j + 1));
      }
    }
    // 顶梢的小羽枝补齐中央冠帽，避免一根无叶的主干尖穿出树冠。
    for (let i = 0; i < 12; i++) {
      const attachment = .875 + i * .01;
      const start = this.trunk.curve.getPointAt(attachment);
      const angle = i * goldenAngle + this.range(-.3, .3);
      const reach = this.range(.72, 1.62);
      const target = this.crownPoint(start.clone().add(new THREE.Vector3(
        Math.cos(angle) * reach, this.range(.25, 1.05), Math.sin(angle) * reach,
      )));
      const twig = this.addBranch(this.branchCurve(start, target, this.trunk.curve.getTangentAt(attachment), .07),
        this.trunk, attachment, .708 + this.range(0, .014), .798 + this.range(0, .016), .034, .0025, 3);
      twigs.push(twig);
      for (let l = 0; l < 8; l++) this.leaves.push(this.createLeaf(twig, .22 + l * .109, l));
    }
    for (const branch of this.branches) {
      const segments = branch.order === 0 ? 112 : branch.order === 1 ? 28 : branch.order === 2 ? 17 : 11;
      const sides = branch.order === 0 ? 12 : branch.order === 1 ? 9 : 6;
      appendTube(batch, branch.curve, branch.radius, branch.tipRadius, branch.birth, branch.end,
        segments, sides, branch.order < 0 ? .2 : this.range(.02, .55));
    }
    this.createFruits(twigs, batch);
    this.createNest(primary[0], batch);
    for (const index of [3, 7, 11, 15]) {
      const point = primary[index].curve.getPointAt(.58);
      point.y += .12;
      this.perchPoints.push(point);
    }
    const woodGeometry = this.own(finishTubes(batch));
    const woodDepth = new THREE.Mesh(woodGeometry, this.materials.woodDepth);
    const wood = new THREE.Mesh(woodGeometry, this.materials.wood);
    woodDepth.name = 'wood-depth-prepass';
    wood.name = 'continuous-trunk-roots-branches-nest-stems';
    // 先确定整棵木质部的最近表面，再乘色一次，枝叉交叠不积成黑结。
    woodDepth.renderOrder = 1;
    wood.renderOrder = 2;
    woodDepth.frustumCulled = wood.frustumCulled = false;
    this.group.add(woodDepth, wood);
    this.visibilityRanges.push({ object: woodDepth, birth: .00001, end: Infinity },
      { object: wood, birth: .00001, end: Infinity });
    const leafMesh = this.addInstances(this.own(leafGeometry()), this.materials.leaf,
      this.leaves, 'clustered-watercolor-leaves', 4);
    const leafDepth = leafMesh.clone();
    leafDepth.material = this.materials.leafDepth;
    leafDepth.name = 'leaf-depth-prepass';
    leafDepth.renderOrder = 1;
    this.group.add(leafDepth);
    this.visibilityRanges.push({ object: leafDepth, birth: Math.min(...this.leaves.map(leaf => leaf.birth)), end: Infinity });
    this.addInstances(this.own(new THREE.SphereGeometry(1, 14, 10)), this.materials.fruit, this.fruits,
      'vermilion-hanging-fruit', 5);
    this.createSeedAndSprout();
  }

  private range(a: number, b: number): number { return mix(a, b, this.random()); }

  private own<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.add(geometry);
    return geometry;
  }

  private crownPoint(point: THREE.Vector3): THREE.Vector3 {
    // 柔软椭球包络仅限制末端，不将各级枝条强行吸到球面上。
    point.y = clamp(point.y, 7.1, 17.05);
    const limit = 8.35 * Math.sqrt(Math.max(.15, 1 - Math.pow((point.y - 11.85) / 6.7, 2)));
    const radius = Math.hypot(point.x, point.z);
    if (radius > limit) { point.x *= limit / radius; point.z *= limit / radius; }
    return point;
  }

  private addBranch(
    curve: THREE.CatmullRomCurve3, parent: Branch | null, attachment: number,
    birth: number, end: number, radius: number, tipRadius: number, order: number,
  ): Branch {
    const branch: Branch = { curve, parent, attachment, birth, end, radius, tipRadius, order };
    this.branches.push(branch);
    return branch;
  }

  private branchCurve(start: THREE.Vector3, end: THREE.Vector3, parentTangent: THREE.Vector3, roughness: number): THREE.CatmullRomCurve3 {
    const delta = end.clone().sub(start);
    const length = delta.length();
    const controlA = start.clone().addScaledVector(parentTangent, length * .23).addScaledVector(delta, .08);
    const controlB = end.clone().addScaledVector(delta, -.3).add(new THREE.Vector3(0, length * .06, 0));
    const bezier = new THREE.CubicBezierCurve3(start, controlA, controlB, end);
    const points: THREE.Vector3[] = [];
    const noiseOffset = this.range(0, 100);
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const p = bezier.getPoint(t);
      const weight = Math.sin(t * Math.PI) * roughness;
      p.x += this.noise(t * 3, noiseOffset, 0) * weight;
      p.y += this.noise(t * 3, noiseOffset, 1) * weight * .7;
      p.z += this.noise(t * 3, noiseOffset, 2) * weight;
      points.push(p);
    }
    return new THREE.CatmullRomCurve3(points);
  }

  private createRoots(): void {
    // 根颈与主干共用同一原点；弧形板根先贴过地表，再下钻到 -3。
    for (let i = 0; i < 9; i++) {
      const angle = i / 9 * TAU + this.range(-.21, .21);
      const length = this.range(3.6, 5.45);
      const x = Math.cos(angle), z = Math.sin(angle);
      const points = [
        new THREE.Vector3(0, -.5, 0),
        new THREE.Vector3(x * .68, -.38, z * .68),
        new THREE.Vector3(x * length * .39, -.7, z * length * .39),
        new THREE.Vector3(x * length * .73, -1.65, z * length * .73),
        new THREE.Vector3(x * length, this.range(-3, -2.65), z * length),
      ];
      const birth = this.range(0, .016);
      const root = this.addBranch(new THREE.CatmullRomCurve3(points), null, 0, birth, this.range(.125, .158),
        this.range(.22, .36), .009, -1);
      for (let j = 0; j < 2; j++) {
        const at = .49 + j * .22;
        const anchor = root.curve.getPointAt(at);
        const direction = angle + (j ? -1 : 1) * this.range(.48, .86);
        const target = anchor.clone().add(new THREE.Vector3(Math.cos(direction) * 1.55, -.8, Math.sin(direction) * 1.55));
        target.y = Math.max(-3, target.y);
        const rootBirth = readyAt(root, at) + .002;
        this.addBranch(this.branchCurve(anchor, target, root.curve.getTangentAt(at), .08), root, at,
          rootBirth, .195, .07, .003, -2);
      }
    }
  }

  private createLeaf(branch: Branch, attachment: number, index: number): Organ {
    const anchor = branch.curve.getPointAt(attachment);
    const tangent = branch.curve.getTangentAt(attachment);
    const azimuth = index * 2.39996 + this.range(-.55, .55);
    const direction = new THREE.Vector3(Math.cos(azimuth), this.range(-.12, .85), Math.sin(azimuth))
      .addScaledVector(tangent, .5).normalize();
    const rotation = new THREE.Quaternion().setFromUnitVectors(UP, direction);
    rotation.multiply(new THREE.Quaternion().setFromAxisAngle(UP, this.range(-1.3, 1.3)));
    const length = this.range(.65, 1.08);
    const matrix = new THREE.Matrix4().compose(anchor, rotation,
      new THREE.Vector3(length * this.range(.64, .98), length, length));
    const birth = Math.max(.73 + this.range(0, .105), readyAt(branch, attachment) + .004);
    const end = Math.min(.9, birth + this.range(.044, .061));
    const top = Math.max(anchor.y, anchor.y + direction.y * length) + length * .16;
    return { branch, attachment, anchor, matrix, birth, end, tint: this.random(), phase: this.range(0, TAU), top };
  }

  private createFruits(twigs: Branch[], batch: TubeBatch): void {
    const selected = new Set<number>();
    for (let i = 0; i < 42; i++) {
      let index = Math.floor((i + this.range(.1, .9)) / 42 * twigs.length);
      while (selected.has(index)) index = (index + 1) % twigs.length;
      selected.add(index);
      const branch = twigs[index];
      const attachment = this.range(.55, .86);
      const anchor = branch.curve.getPointAt(attachment);
      const radius = this.range(.135, .205);
      const hanging = this.range(.22, .37);
      const center = anchor.clone().add(new THREE.Vector3(.035, -hanging - radius * .88, .025));
      const birth = Math.max(.85 + this.range(0, .038), readyAt(branch, attachment) + .008);
      const end = Math.min(.92, birth + .029);
      const stemEnd = center.clone().add(new THREE.Vector3(0, radius * 1.08, 0));
      const stemCurve = new THREE.CatmullRomCurve3([
        anchor, anchor.clone().lerp(stemEnd, .5).add(new THREE.Vector3(.025, 0, -.02)), stemEnd,
      ]);
      // 果柄先长完；球体从柄末端回弹展开，不在尚未长到的空中出现。
      appendTube(batch, stemCurve, .014, .007, birth - .014, birth, 7, 5, .7);
      const matrix = new THREE.Matrix4().compose(center,
        new THREE.Quaternion().setFromEuler(new THREE.Euler(this.range(-.2, .2), this.range(0, TAU), .05)),
        new THREE.Vector3(radius, radius * 1.08, radius));
      this.fruits.push({ branch, attachment, anchor: stemEnd, matrix, birth, end,
        tint: this.random(), phase: this.range(0, TAU), top: center.y + radius * 1.08 });
    }
  }

  private createNest(branch: Branch, batch: TubeBatch): void {
    const center = branch.curve.getPointAt(.19);
    center.y += .16;
    center.z += .06;
    this.perchPoints.push(center.clone().add(new THREE.Vector3(0, .34, 0)));
    // 错开的开放弧线编织浅碗，不用厚实体圆环，保留写意的空隙。
    for (let i = 0; i < 52; i++) {
      const layer = i / 51;
      const radius = mix(.23, .62, Math.pow(layer, .6)) + this.range(-.04, .04);
      const start = this.range(0, TAU);
      const sweep = this.range(2.6, 5.7);
      const points: THREE.Vector3[] = [];
      for (let j = 0; j <= 12; j++) {
        const t = j / 12;
        const angle = start + sweep * t;
        points.push(center.clone().add(new THREE.Vector3(
          Math.cos(angle) * radius,
          mix(-.12, .19, layer) + .036 * Math.sin(angle * 3 + i) + this.range(-.018, .018),
          Math.sin(angle) * radius * .76,
        )));
      }
      appendTube(batch, new THREE.CatmullRomCurve3(points), this.range(.014, .023), .006,
        .91 + layer * .017, .941 + layer * .019, 16, 4, this.range(.45, 1));
    }
  }

  private addInstances(
    geometry: THREE.BufferGeometry, material: THREE.ShaderMaterial,
    specs: readonly InstanceSpec[], name: string, renderOrder: number, hideAfter = Infinity,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, specs.length);
    const birth = new Float32Array(specs.length);
    const end = new Float32Array(specs.length);
    const tint = new Float32Array(specs.length);
    const phases = new Float32Array(specs.length);
    const anchors = new Float32Array(specs.length * 3);
    specs.forEach((spec, i) => {
      mesh.setMatrixAt(i, spec.matrix);
      birth[i] = spec.birth;
      end[i] = spec.end;
      tint[i] = spec.tint;
      phases[i] = spec.phase;
      spec.anchor.toArray(anchors, i * 3);
    });
    geometry.setAttribute('aBirth', new THREE.InstancedBufferAttribute(birth, 1));
    geometry.setAttribute('aEnd', new THREE.InstancedBufferAttribute(end, 1));
    geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 1));
    geometry.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    geometry.setAttribute('aAnchor', new THREE.InstancedBufferAttribute(anchors, 3));
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.name = name;
    mesh.renderOrder = renderOrder;
    // 静态包围体不能代表 GPU 风偏和主干尖上的子叶，统一交给场景级可见性。
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.visibilityRanges.push({ object: mesh, birth: Math.min(...specs.map(spec => spec.birth)), end: hideAfter });
    return mesh;
  }

  private createSeedAndSprout(): void {
    const center = new THREE.Vector3(0, -.5, 0);
    this.addInstances(this.own(new THREE.SphereGeometry(1, 18, 12)), this.materials.seed, [{
      matrix: new THREE.Matrix4().compose(center,
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -.32),
        new THREE.Vector3(.23, .34, .19)),
      anchor: center, birth: 0, end: .001, tint: .5, phase: 0,
    }], 'breathing-seed', 5, .25);
    const specs: InstanceSpec[] = [];
    for (let i = 0; i < 2; i++) {
      const direction = new THREE.Vector3(i === 0 ? -1 : 1, .42, i === 0 ? .15 : -.15).normalize();
      const rotation = new THREE.Quaternion().setFromUnitVectors(UP, direction);
      rotation.multiply(new THREE.Quaternion().setFromAxisAngle(UP, i === 0 ? -.65 : .65));
      specs.push({
        matrix: new THREE.Matrix4().compose(new THREE.Vector3(), rotation, new THREE.Vector3(.63, .86, .78)),
        anchor: new THREE.Vector3(), birth: .173 + i * .006, end: .25 + i * .008, tint: .65, phase: i * 2,
      });
    }
    this.addInstances(this.own(leafGeometry()), this.materials.sprout, specs, 'two-tip-attached-cotyledons', 4, .59);
  }

  /** 接收主引擎时间轴进度；每帧只更新少量 uniform，不重建枝叶矩阵。 */
  update(progress: number, time: number, windX: number, windZ: number, climate: Climate): void {
    if (this.disposed) return;
    this.progress = clamp(progress);
    this.materials.update(this.progress, time, windX, windZ, climate);
    // 未进入生命区间的整批对象不提交 GPU，逆向拖动时同样即时恢复。
    for (const range of this.visibilityRanges) {
      range.object.visible = this.progress >= range.birth && this.progress < range.end;
    }
    const growth = phase(this.progress, this.trunk.birth, this.trunk.end);
    this.trunk.curve.getPointAt(growth, this.materials.uniforms.uSproutTip.value);
    this.materials.uniforms.uSproutOpacity.value = (1 - phase(this.progress, .47, .59))
      * phase(this.progress, .169, .195);
  }

  /** 返回五个已施加世界空间风场的栖点；第一点在巢口，其余四点在冠内实枝上。 */
  getPerches(time: number, windX: number, windZ: number): THREE.Vector3[] {
    this.group.updateWorldMatrix(true, false);
    return this.perchPoints.map(point => {
      const world = point.clone().applyMatrix4(this.group.matrixWorld);
      return bendPoint(world, time, windX, windZ, world);
    });
  }

  /** 读取真实父子挂点就绪关系，可用于正放、倒放和随机跳转的无孤枝审计。 */
  metrics(): TreeMetrics {
    let visibleBranches = 0, visibleLeaves = 0, visibleFruits = 0, orphans = 0;
    let maxHeight = -.5;
    const p = this.progress;
    for (const branch of this.branches) {
      if (p <= branch.birth) continue;
      visibleBranches++;
      if (branch.parent && p + 1e-7 < readyAt(branch.parent, branch.attachment)) orphans++;
      maxHeight = Math.max(maxHeight, branch.curve.getPointAt(phase(p, branch.birth, branch.end)).y);
    }
    for (const leaf of this.leaves) {
      if (p <= leaf.birth) continue;
      visibleLeaves++;
      if (p + 1e-7 < readyAt(leaf.branch, leaf.attachment)) orphans++;
      maxHeight = Math.max(maxHeight, mix(leaf.anchor.y, leaf.top, phase(p, leaf.birth, leaf.end)));
    }
    for (const fruit of this.fruits) {
      if (p <= fruit.birth) continue;
      visibleFruits++;
      if (p + 1e-7 < readyAt(fruit.branch, fruit.attachment)) orphans++;
    }
    return { branches: this.branches.length, leaves: this.leaves.length, fruits: this.fruits.length,
      visibleBranches, visibleLeaves, visibleFruits, orphans, maxHeight };
  }

  /** 幂等释放树拥有的 GPU 资源，不重复释放深度预通道共用的几何体。 */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const child of this.group.children) {
      if (child instanceof THREE.InstancedMesh) child.dispose();
    }
    for (const geometry of this.geometries) geometry.dispose();
    this.geometries.clear();
    this.materials.dispose();
    this.group.clear();
    this.visibilityRanges.length = 0;
    this.group.removeFromParent();
  }
}
