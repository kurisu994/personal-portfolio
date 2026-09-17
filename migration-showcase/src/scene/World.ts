import * as THREE from 'three';
import { CLIMATES, sampleClimate, type ClimateSample, type ColorTuple } from './climates';
import { hash, riverSlope, riverWidth, riverX, tupleToColor } from './math';

const CHUNK_LENGTH = 540;
const CHUNK_RADIUS = 7;
const FIELD_WIDTH = 310;

class GeometryBuilder {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];
  private readonly indices: number[] = [];

  private appendColor(color: ColorTuple, count: number): void {
    const converted = tupleToColor(color);
    for (let index = 0; index < count; index += 1) {
      this.colors.push(converted.r, converted.g, converted.b);
    }
  }

  addTriangle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: ColorTuple): void {
    const offset = this.positions.length / 3;
    this.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    this.appendColor(color, 3);
    this.indices.push(offset, offset + 2, offset + 1);
  }

  addQuad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: ColorTuple, farColor: ColorTuple = color): void {
    const offset = this.positions.length / 3;
    this.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z);
    this.appendColor(color, 2);
    this.appendColor(farColor, 2);
    this.indices.push(offset, offset + 2, offset + 1, offset, offset + 3, offset + 2);
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setIndex(this.indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  get empty(): boolean {
    return this.positions.length === 0;
  }
}

function shaded(color: ColorTuple, factor: number): ColorTuple {
  return [Math.min(color[0] * factor, 1), Math.min(color[1] * factor, 1), Math.min(color[2] * factor, 1)];
}

function mixed(a: ColorTuple, b: ColorTuple, amount: number): ColorTuple {
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ];
}

function addOrientedBox(
  builder: GeometryBuilder,
  center: THREE.Vector3,
  tangent: THREE.Vector3,
  normal: THREE.Vector3,
  width: number,
  depth: number,
  height: number,
  color: ColorTuple,
  baseY = 1,
): void {
  const point = (cross: number, y: number, along: number) => center.clone()
    .addScaledVector(normal, cross)
    .addScaledVector(tangent, along)
    .setY(y);
  const a = point(-depth / 2, baseY, -width / 2);
  const b = point(depth / 2, baseY, -width / 2);
  const c = point(depth / 2, baseY, width / 2);
  const d = point(-depth / 2, baseY, width / 2);
  const topY = baseY + height;
  const A = point(-depth / 2, topY, -width / 2);
  const B = point(depth / 2, topY, -width / 2);
  const C = point(depth / 2, topY, width / 2);
  const D = point(-depth / 2, topY, width / 2);
  builder.addQuad(a, b, B, A, shaded(color, 0.86));
  builder.addQuad(b, c, C, B, shaded(color, 0.96));
  builder.addQuad(c, d, D, C, shaded(color, 1.04));
  builder.addQuad(d, a, A, D, shaded(color, 0.91));
  builder.addQuad(A, B, C, D, shaded(color, 1.05));
}

function addHouse(
  builders: { buildings: GeometryBuilder; windows: GeometryBuilder; snow: GeometryBuilder },
  x: number,
  z: number,
  width: number,
  depth: number,
  height: number,
  roofHeight: number,
  side: number,
  climate: ClimateSample,
  variation: number,
  church = false,
): void {
  const slope = riverSlope(z);
  const tangent = new THREE.Vector3(slope, 0, 1).normalize();
  const normal = new THREE.Vector3(1, 0, -slope).normalize();
  const center = new THREE.Vector3(x, 0, z);
  const wall = mixed(climate.wall, climate.bank, variation * 0.18);
  const roof = mixed(climate.roof, climate.tree, variation > 0.72 ? 0.42 : 0);
  addOrientedBox(builders.buildings, center, tangent, normal, width, depth, height, wall);

  const point = (cross: number, y: number, along: number) => center.clone()
    .addScaledVector(normal, cross)
    .addScaledVector(tangent, along)
    .setY(y);
  const edgeA = point(-depth / 2 - 1, height + 1, -width / 2 - 1);
  const edgeB = point(depth / 2 + 1, height + 1, -width / 2 - 1);
  const edgeC = point(depth / 2 + 1, height + 1, width / 2 + 1);
  const edgeD = point(-depth / 2 - 1, height + 1, width / 2 + 1);
  const ridgeA = point(0, height + roofHeight, -width / 2 - 1);
  const ridgeB = point(0, height + roofHeight, width / 2 + 1);
  builders.buildings.addQuad(edgeA, ridgeA, ridgeB, edgeD, shaded(roof, 0.88));
  builders.buildings.addQuad(ridgeA, edgeB, edgeC, ridgeB, shaded(roof, 1.08));
  builders.buildings.addTriangle(edgeA, edgeB, ridgeA, shaded(wall, 0.96));
  builders.buildings.addTriangle(edgeC, edgeD, ridgeB, shaded(wall, 1.03));
  if (climate.snow > 0.08) {
    const snowColor = mixed(roof, mixed(climate.sky, [1, 1, 0.985], 0.74), climate.snow);
    builders.snow.addQuad(edgeA, ridgeA, ridgeB, edgeD, snowColor);
    builders.snow.addQuad(ridgeA, edgeB, edgeC, ridgeB, snowColor);
  }

  const floors = Math.max(1, Math.floor(height / 19));
  for (const facadeSide of [-side, side]) {
    const face = facadeSide * (depth / 2 + 0.2);
    for (let floor = 0; floor < floors; floor += 1) {
      for (let column = 0; column < 2; column += 1) {
        const along = (column - 0.5) * width * 0.43;
        const bottom = 10 + floor * 18;
        const half = 2.4;
        const lit = variation + floor * 0.15 + column * 0.17 > 0.38;
        const windowColor = mixed(shaded(wall, 0.48), [1, 0.7, 0.33], climate.night * (lit ? 0.96 : 0.12));
        builders.windows.addQuad(
          point(face, bottom, along - half), point(face, bottom, along + half),
          point(face, bottom + 6, along + half), point(face, bottom + 6, along - half), windowColor,
        );
        builders.buildings.addQuad(
          point(face * 1.002, bottom - 0.8, along - half - 0.8), point(face * 1.002, bottom - 0.8, along + half + 0.8),
          point(face * 1.002, bottom, along + half + 0.8), point(face * 1.002, bottom, along - half - 0.8), shaded(wall, 0.79),
        );
      }
    }
    builders.windows.addQuad(
      point(face, 1, -2.6), point(face, 1, 2.6), point(face, 8, 2.6), point(face, 8, -2.6), shaded(roof, 0.5),
    );
  }

  if (variation > 0.46) {
    const chimneyCenter = center.clone().addScaledVector(normal, depth * 0.21).addScaledVector(tangent, width * 0.2);
    addOrientedBox(builders.buildings, chimneyCenter, tangent, normal, 6, 5, 12, shaded(wall, 0.78), height + roofHeight * 0.55);
  }

  if (church) {
    const towerCenter = center.clone().addScaledVector(tangent, -width * 0.36);
    addOrientedBox(builders.buildings, towerCenter, tangent, normal, 23, 23, 92, shaded(wall, 0.96));
    const peak = towerCenter.clone().setY(154);
    for (let face = 0; face < 4; face += 1) {
      const angleA = face * Math.PI / 2 + Math.PI / 4;
      const angleB = (face + 1) * Math.PI / 2 + Math.PI / 4;
      const a = towerCenter.clone().addScaledVector(normal, Math.cos(angleA) * 17).addScaledVector(tangent, Math.sin(angleA) * 17).setY(93);
      const b = towerCenter.clone().addScaledVector(normal, Math.cos(angleB) * 17).addScaledVector(tangent, Math.sin(angleB) * 17).setY(93);
      builders.buildings.addTriangle(a, b, peak, shaded(roof, 0.73 + face * 0.08));
    }
  }
}

function addTree(builder: GeometryBuilder, x: number, z: number, height: number, radius: number, climate: ClimateSample, variant: number): void {
  const center = new THREE.Vector3(x, 0, z);
  const trunk = mixed(shaded(climate.tree, 0.48), climate.roof, 0.22);
  const tangent = new THREE.Vector3(0, 0, 1);
  const normal = new THREE.Vector3(1, 0, 0);
  addOrientedBox(builder, center, tangent, normal, 3.1, 3.1, height * 0.55, trunk, 0.6);
  const conifer = climate.snow > 0.4 || variant > 0.82;
  if (conifer) {
    for (let layer = 0; layer < 3; layer += 1) {
      const layerRadius = radius * (1 - layer * 0.18);
      const base = height * (0.28 + layer * 0.18);
      const top = height * (0.78 + layer * 0.09);
      for (let face = 0; face < 7; face += 1) {
        const a = face / 7 * Math.PI * 2;
        const b = (face + 1) / 7 * Math.PI * 2;
        const color = mixed(shaded(climate.tree, 0.76 + face * 0.035), climate.sky, climate.snow * (layer === 2 ? 0.44 : 0.15));
        builder.addTriangle(
          new THREE.Vector3(x + Math.cos(a) * layerRadius, base, z + Math.sin(a) * layerRadius),
          new THREE.Vector3(x + Math.cos(b) * layerRadius, base, z + Math.sin(b) * layerRadius),
          new THREE.Vector3(x, top, z),
          color,
        );
      }
    }
    return;
  }
  const segments = 7;
  const lower = height * 0.42;
  const middle = height * 0.68;
  for (let face = 0; face < segments; face += 1) {
    const a = face / segments * Math.PI * 2;
    const b = (face + 1) / segments * Math.PI * 2;
    const lowerA = new THREE.Vector3(x + Math.cos(a) * radius * 0.68, lower, z + Math.sin(a) * radius * 0.68);
    const lowerB = new THREE.Vector3(x + Math.cos(b) * radius * 0.68, lower, z + Math.sin(b) * radius * 0.68);
    const middleA = new THREE.Vector3(x + Math.cos(a) * radius, middle, z + Math.sin(a) * radius);
    const middleB = new THREE.Vector3(x + Math.cos(b) * radius, middle, z + Math.sin(b) * radius);
    const color = shaded(climate.tree, 0.8 + face * 0.035);
    builder.addQuad(lowerA, lowerB, middleB, middleA, color);
    builder.addTriangle(middleA, middleB, new THREE.Vector3(x, height, z), shaded(color, 1.05));
  }
}

interface WorldChunk {
  group: THREE.Group;
  geometries: THREE.BufferGeometry[];
}

/** 绝对分块索引驱动全部细节，沿航线前进时不会重复已有地景。 */
export class World {
  readonly group = new THREE.Group();
  readonly waterUniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      time: { value: 0 },
      night: { value: 0 },
    },
  ]) as typeof THREE.UniformsLib.fog & {
    time: { value: number };
    night: { value: number };
  };

  private readonly chunks = new Map<number, WorldChunk>();
  private readonly groundMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0, side: THREE.DoubleSide });
  private readonly buildingMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0.01 });
  private readonly snowMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1 });
  private readonly windowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide });
  private readonly lineMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.38 });
  private readonly waterMaterial: THREE.ShaderMaterial;
  private centerChunk = Number.NaN;

  constructor(private readonly seed: number) {
    this.group.name = 'procedural-world';
    this.groundMaterial.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTerrainPosition;');
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerrainPosition = position;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTerrainPosition;');
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
        #include <color_fragment>
        float fieldNoise = fract(sin(dot(floor(vTerrainPosition.xz * 0.8), vec2(12.9898, 78.233))) * 43758.5453);
        float furrow = smoothstep(0.82, 0.98, sin(vTerrainPosition.x * 0.72 + sin(vTerrainPosition.z * 0.008) * 0.5));
        float fieldMask = step(0.45, fract(sin(floor(vTerrainPosition.x / 310.0) * 8.7 + floor(vTerrainPosition.z / 540.0) * 4.2) * 83.3));
        diffuseColor.rgb *= 0.97 + fieldNoise * 0.05 - furrow * fieldMask * 0.055;
      `);
    };
    this.waterMaterial = new THREE.ShaderMaterial({
      uniforms: this.waterUniforms,
      vertexColors: true,
      transparent: true,
      depthWrite: true,
      fog: true,
      vertexShader: `
        #include <common>
        #include <fog_pars_vertex>
        varying vec3 vColor;
        varying vec3 vWorld;
        attribute float aNight;
        varying float vNight;
        void main() {
          vColor = color;
          vNight = aNight;
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorld = worldPosition.xyz;
          vec4 mvPosition = viewMatrix * worldPosition;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: `
        #include <common>
        #include <fog_pars_fragment>
        uniform float time;
        varying vec3 vColor;
        varying vec3 vWorld;
        varying float vNight;
        void main() {
          float longWave = sin(vWorld.z * 0.52 + time * 0.9 + sin(vWorld.x * 0.011) * 6.0) * 0.5 + 0.5;
          float crossWave = sin(vWorld.x * 0.041 - time * 0.24 + vWorld.z * 0.014) * 0.5 + 0.5;
          float glint = pow(max(longWave * crossWave, 0.0), 19.0) * (1.0 - vNight);
          vec3 water = vColor * (0.91 + longWave * 0.045) + vec3(0.72, 0.82, 0.80) * glint * 0.22;
          gl_FragColor = vec4(water, 0.96);
          #include <fog_fragment>
        }
      `,
    });
  }

  update(centerZ: number, elapsed: number, climate: ClimateSample): void {
    this.waterUniforms.time.value = elapsed;
    this.waterUniforms.night.value = climate.night;
    const nextCenter = Math.floor(centerZ / CHUNK_LENGTH);
    if (nextCenter === this.centerChunk) return;
    this.centerChunk = nextCenter;
    for (let index = nextCenter - CHUNK_RADIUS; index <= nextCenter + CHUNK_RADIUS; index += 1) {
      if (!this.chunks.has(index)) this.addChunk(index);
    }
    for (const [index, chunk] of this.chunks) {
      if (Math.abs(index - nextCenter) <= CHUNK_RADIUS) continue;
      this.group.remove(chunk.group);
      chunk.geometries.forEach((geometry) => geometry.dispose());
      this.chunks.delete(index);
    }
  }

  private addChunk(index: number): void {
    const startZ = index * CHUNK_LENGTH;
    const group = new THREE.Group();
    group.name = `world-chunk-${index}`;
    const geometries: THREE.BufferGeometry[] = [];
    const ground = new GeometryBuilder();
    const water = new GeometryBuilder();
    const buildings = new GeometryBuilder();
    const windows = new GeometryBuilder();
    const snow = new GeometryBuilder();
    const trees = new GeometryBuilder();
    const linePositions: number[] = [];
    const lineColors: number[] = [];

    const baseNear = sampleClimate(0, startZ);
    const baseFar = sampleClimate(0, startZ + CHUNK_LENGTH);
    ground.addQuad(
      new THREE.Vector3(-6200, -1.4, startZ), new THREE.Vector3(6200, -1.4, startZ),
      new THREE.Vector3(6200, -1.4, startZ + CHUNK_LENGTH), new THREE.Vector3(-6200, -1.4, startZ + CHUNK_LENGTH),
      mixed(baseNear.ground, baseNear.tree, 0.17), mixed(baseFar.ground, baseFar.tree, 0.17),
    );

    for (let column = -6; column <= 5; column += 1) {
      const x = column * FIELD_WIDTH;
      const pad = 1.8 + hash(index, column + 110, this.seed) * 1.8;
      const y = -0.4 + hash(index, column + 210, this.seed) * 0.7;
      const climate = sampleClimate(x + FIELD_WIDTH / 2, startZ + CHUNK_LENGTH / 2);
      const fieldIndex = Math.floor(hash(index, column + 310, this.seed) * climate.fields.length);
      const color = sampleClimate(x + FIELD_WIDTH / 2, startZ).fields[fieldIndex];
      const farColor = sampleClimate(x + FIELD_WIDTH / 2, startZ + CHUNK_LENGTH).fields[fieldIndex];
      ground.addQuad(
        new THREE.Vector3(x + pad, y, startZ + pad),
        new THREE.Vector3(x + FIELD_WIDTH - pad, y, startZ + pad),
        new THREE.Vector3(x + FIELD_WIDTH - pad, y, startZ + CHUNK_LENGTH - pad),
        new THREE.Vector3(x + pad, y, startZ + CHUNK_LENGTH - pad),
        color, farColor,
      );
      const lineColor = tupleToColor(mixed(climate.bank, climate.sky, 0.36));
      linePositions.push(x + pad, y + 0.35, startZ + pad, x + FIELD_WIDTH - pad, y + 0.35, startZ + pad);
      lineColors.push(lineColor.r, lineColor.g, lineColor.b, lineColor.r, lineColor.g, lineColor.b);
      if (hash(index, column + 410, this.seed) > 0.56) {
        const rowX = x + FIELD_WIDTH * (0.25 + hash(index, column + 510, this.seed) * 0.5);
        linePositions.push(rowX, y + 0.34, startZ + 8, rowX, y + 0.34, startZ + CHUNK_LENGTH - 8);
        lineColors.push(lineColor.r, lineColor.g, lineColor.b, lineColor.r, lineColor.g, lineColor.b);
      }
    }

    const riverSamples = 13;
    for (let sample = 0; sample < riverSamples - 1; sample += 1) {
      const zA = startZ + sample / (riverSamples - 1) * CHUNK_LENGTH;
      const zB = startZ + (sample + 1) / (riverSamples - 1) * CHUNK_LENGTH;
      const xA = riverX(zA);
      const xB = riverX(zB);
      const widthA = riverWidth(zA);
      const widthB = riverWidth(zB);
      const climate = sampleClimate((xA + xB) / 2, (zA + zB) / 2);
      const nearClimate = sampleClimate(xA, zA);
      const farClimate = sampleClimate(xB, zB);
      ground.addQuad(
        new THREE.Vector3(xA - widthA - 18, 0.35, zA), new THREE.Vector3(xA + widthA + 18, 0.35, zA),
        new THREE.Vector3(xB + widthB + 18, 0.35, zB), new THREE.Vector3(xB - widthB - 18, 0.35, zB), nearClimate.bank, farClimate.bank,
      );
      water.addQuad(
        new THREE.Vector3(xA - widthA, 0.72, zA), new THREE.Vector3(xA + widthA, 0.72, zA),
        new THREE.Vector3(xB + widthB, 0.72, zB), new THREE.Vector3(xB - widthB, 0.72, zB), nearClimate.river, farClimate.river,
      );
      // 两岸窄石堤给远景一条稳定的尺度参照。
      for (const side of [-1, 1]) {
        ground.addQuad(
          new THREE.Vector3(xA + side * (widthA + 8), 0.85, zA), new THREE.Vector3(xA + side * (widthA + 10), 0.85, zA),
          new THREE.Vector3(xB + side * (widthB + 10), 0.85, zB), new THREE.Vector3(xB + side * (widthB + 8), 0.85, zB), shaded(climate.bank, 0.84),
        );
      }
    }

    if (hash(index, 980, this.seed) > 0.78) {
      const bridgeZ = startZ + CHUNK_LENGTH * 0.92;
      const bridgeCenter = new THREE.Vector3(riverX(bridgeZ), 0, bridgeZ);
      const tangent = new THREE.Vector3(riverSlope(bridgeZ), 0, 1).normalize();
      const normal = new THREE.Vector3(1, 0, -riverSlope(bridgeZ)).normalize();
      const span = riverWidth(bridgeZ) * 2 + 48;
      const stone = shaded(sampleClimate(bridgeCenter.x, bridgeZ).bank, 0.85);
      addOrientedBox(buildings, bridgeCenter, tangent, normal, 23, span, 5, stone, 12);
      for (const side of [-1, 1]) {
        addOrientedBox(buildings, bridgeCenter.clone().addScaledVector(tangent, side * 11), tangent, normal, 2.3, span, 5, shaded(stone, 1.08), 17);
        addOrientedBox(buildings, bridgeCenter.clone().addScaledVector(normal, side * span * 0.27), tangent, normal, 20, 10, 13, shaded(stone, 0.9));
      }
    }

    const townSide = hash(index, 21, this.seed) > 0.38 ? 1 : -1;
    if (hash(index, 20, this.seed) > 0.16) {
      const count = 6 + Math.floor(hash(index, 22, this.seed) * 6);
      let houseZ = startZ + 36;
      for (let house = 0; house < count; house += 1) {
        const width = 27 + hash(index, house + 30, this.seed) * 17;
        const depth = 34 + hash(index, house + 50, this.seed) * 17;
        const x = riverX(houseZ) + townSide * (riverWidth(houseZ) + 31 + depth / 2);
        const climate = sampleClimate(x, houseZ);
        addHouse(
          { buildings, windows, snow }, x, houseZ, width, depth,
          29 + hash(index, house + 60, this.seed) * 37,
          15 + hash(index, house + 70, this.seed) * 14,
          townSide, climate, hash(index, house + 80, this.seed), false,
        );
        houseZ += width + 1.1;
      }
      for (let rear = 0; rear < 5; rear += 1) {
        const z = startZ + 52 + rear * 82;
        const x = riverX(z) + townSide * (riverWidth(z) + 155 + hash(index, rear + 100, this.seed) * 96);
        addHouse(
          { buildings, windows, snow }, x, z,
          28 + hash(index, rear + 110, this.seed) * 18,
          29 + hash(index, rear + 120, this.seed) * 20,
          25 + hash(index, rear + 130, this.seed) * 34,
          16 + hash(index, rear + 140, this.seed) * 9,
          townSide, sampleClimate(x, z), hash(index, rear + 150, this.seed), false,
        );
      }
      if (hash(index, 24, this.seed) > 0.76) {
        const z = startZ + CHUNK_LENGTH * 0.48;
        const x = riverX(z) + townSide * (riverWidth(z) + 218);
        addHouse({ buildings, windows, snow }, x, z, 84, 54, 54, 31, townSide, sampleClimate(x, z), 0.68, true);
      }
    }

    for (let tree = 0; tree < 28; tree += 1) {
      const z = startZ + hash(index, tree + 201, this.seed) * CHUNK_LENGTH;
      const nearBank = hash(index, tree + 301, this.seed) < 0.47;
      const side = hash(index, tree + 401, this.seed) > 0.5 ? 1 : -1;
      const x = riverX(z) + side * (riverWidth(z) + (nearBank ? 23 + hash(index, tree + 501, this.seed) * 22 : 280 + hash(index, tree + 501, this.seed) * 1380));
      addTree(
        trees, x, z,
        24 + hash(index, tree + 601, this.seed) * 38,
        10 + hash(index, tree + 701, this.seed) * 13,
        sampleClimate(x, z), hash(index, tree + 801, this.seed),
      );
    }

    const addMesh = (builder: GeometryBuilder, material: THREE.Material, casts = false, receives = true) => {
      if (builder.empty) return;
      const geometry = builder.build();
      if (material === this.waterMaterial) {
        const positions = geometry.getAttribute('position');
        const nights = new Float32Array(positions.count);
        for (let vertex = 0; vertex < positions.count; vertex += 1) {
          nights[vertex] = sampleClimate(positions.getX(vertex), positions.getZ(vertex)).night;
        }
        geometry.setAttribute('aNight', new THREE.BufferAttribute(nights, 1));
      }
      geometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = casts;
      mesh.receiveShadow = receives;
      group.add(mesh);
    };
    addMesh(ground, this.groundMaterial, false, true);
    addMesh(water, this.waterMaterial, false, false);
    addMesh(buildings, this.buildingMaterial, true, true);
    addMesh(windows, this.windowMaterial, false, false);
    addMesh(snow, this.snowMaterial, false, true);
    addMesh(trees, this.buildingMaterial, true, true);

    if (linePositions.length > 0) {
      const lineGeometry = new THREE.BufferGeometry();
      lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
      lineGeometry.setAttribute('color', new THREE.Float32BufferAttribute(lineColors, 3));
      geometries.push(lineGeometry);
      group.add(new THREE.LineSegments(lineGeometry, this.lineMaterial));
    }

    this.chunks.set(index, { group, geometries });
    this.group.add(group);
  }

  dispose(): void {
    for (const chunk of this.chunks.values()) chunk.geometries.forEach((geometry) => geometry.dispose());
    this.chunks.clear();
    this.groundMaterial.dispose();
    this.buildingMaterial.dispose();
    this.snowMaterial.dispose();
    this.windowMaterial.dispose();
    this.lineMaterial.dispose();
    this.waterMaterial.dispose();
  }

  get loadedChunks(): number {
    return this.chunks.size;
  }
}

export function climateLabel(index: number): string {
  const climate = CLIMATES[index];
  return `${String(index + 1).padStart(2, '0')} — ${climate.name} / ${climate.en}`;
}
