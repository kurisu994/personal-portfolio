import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { createNoise2D } from 'simplex-noise';
import type { Climate } from './climates';
import { bezier4, phase, randomSeed } from './math';

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = vec4(position.xy, .999, 1.); }
`;
const NOISE = /* glsl */ `
  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
  float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
  float fbm(vec2 p){ return noise(p)*.5+noise(p*2.03)*.25+noise(p*4.07)*.125; }
`;

/** 在本地绘制纤维和湿边，再以 DataURL 装入纸张纹理，不访问外部图片。 */
export function createPaperTexture(seed: number): THREE.Texture {
  const random = randomSeed(seed);
  const simplex = createNoise2D(random);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(512, 512);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
    const n = 128 + (random() - .5) * 38 + simplex(x / 110, y / 110) * 16 + simplex(x / 2, y / 12) * 9;
    const i = (y * 512 + x) * 4;
    image.data[i] = image.data[i + 1] = image.data[i + 2] = n;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  for (let i = 0; i < 16; i++) {
    const x = random() * 512, y = random() * 512, radius = 22 + random() * 80;
    const wash = ctx.createRadialGradient(x, y, radius * .5, x, y, radius);
    wash.addColorStop(0, 'rgba(90,80,60,0)');
    wash.addColorStop(.85, 'rgba(65,55,40,.03)');
    wash.addColorStop(.95, 'rgba(50,40,30,.1)');
    wash.addColorStop(1, 'rgba(50,40,30,0)');
    ctx.fillStyle = wash; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  const texture: THREE.Texture = new THREE.Texture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  const source = new Image();
  source.onload = () => { texture.image = source; texture.needsUpdate = true; };
  source.src = canvas.toDataURL('image/png');
  texture.addEventListener('dispose', () => { source.onload = null; });
  return texture;
}

/** 在显示色彩空间叠加轻微纸纹，不抬白画面，也不重复做 gamma 转换。 */
export function createPaperPass(texture: THREE.Texture): ShaderPass {
  return new ShaderPass({
    uniforms: { tDiffuse: { value: null }, tPaper: { value: texture }, resolution: { value: new THREE.Vector2(1, 1) } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse, tPaper; uniform vec2 resolution; varying vec2 vUv;
      ${NOISE}
      void main(){
        vec3 c=texture2D(tDiffuse,vUv).rgb;
        float paper=texture2D(tPaper,vUv*resolution/650.).r-.5;
        float grain=hash(vUv*resolution)-.5;
        float edge=pow(length((vUv-.5)*vec2(1.,.8)),2.);
        c=c*(1.+paper*.115-edge*.09)+grain*.011;
        gl_FragColor=vec4(c,1.);
      }
    `,
  });
}

/** 薄雾、土壤水渍与三百颗浮游物，组成不会盖住树的纸本空间。 */
export class Atmosphere {
  readonly group = new THREE.Group();
  readonly particleCount = 300;
  private readonly background: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly ground: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly origin = new THREE.Vector3();

  constructor(seed = 23) {
    const backgroundMaterial = new THREE.ShaderMaterial({
      depthWrite: false, depthTest: false,
      uniforms: {
        uTop: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() }, uSoil: { value: new THREE.Color() },
        uHorizon: { value: .6 }, uTime: { value: 0 }, uMist: { value: 0 }, uProgress: { value: 0 },
        uAspect: { value: 1 },
      },
      vertexShader: VERTEX,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop,uBottom,uSoil; uniform float uHorizon,uTime,uMist,uProgress,uAspect;
        varying vec2 vUv; ${NOISE}
        void main(){
          vec2 p=vUv*vec2(uAspect,1.);
          float cloud=fbm(p*3.+vec2(uTime*.007,0.));
          float wet=fbm(p*11.+cloud*1.3);
          vec3 sky=mix(uBottom,uTop,smoothstep(0.,1.,vUv.y)+.08*(cloud-.5));
          float soil=(1.-smoothstep(uHorizon-.13,uHorizon+.045,vUv.y+(cloud-.4)*.018));
          float depth=clamp((uHorizon-vUv.y)*1.7,0.,1.);
          vec3 earth=uSoil*(.85+wet*.16-depth*.26);
          vec3 color=mix(sky,earth,soil);
          float sun=exp(-length((p-vec2(uAspect*.74,.76))*vec2(1.,1.2))*8.);
          color+=vec3(.13,.10,.052)*sun*(1.-soil);
          color*=.97+(cloud-.35)*.05+(wet-.35)*.025;
          color=mix(color,uTop,exp(-pow((vUv.y-uHorizon-.04)*8.,2.))*.05*uMist);
          gl_FragColor=vec4(color,1.);
        }
      `,
    });
    this.background = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), backgroundMaterial);
    this.background.renderOrder = -100;
    this.background.frustumCulled = false;
    this.group.add(this.background);

    const groundMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.MultiplyBlending, premultipliedAlpha: true,
      uniforms: { uColor: { value: new THREE.Color('#827151') }, uProgress: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;uniform vec3 uColor;uniform float uProgress; ${NOISE}
        void main(){
          vec2 p=(vUv-.5)*2.; float n=fbm(p*7.);
          float edge=1.-smoothstep(.35,1.,length(p)+n*.13);
          float ring=1.-smoothstep(.015,.09,abs(length(p)+n*.16-.58));
          float contact=exp(-dot(p,p)*22.);
          float alpha=edge*(.08+contact*.62+ring*.045)*smoothstep(.16,.36,uProgress);
          gl_FragColor=vec4(mix(vec3(1.),uColor,alpha),1.);
        }
      `,
    });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(12, 10), groundMaterial);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -.10;
    this.ground.renderOrder = -5;
    this.group.add(this.ground);

    const random = randomSeed(seed);
    const seeds = new Float32Array(this.particleCount * 4);
    const positions = new Float32Array(this.particleCount * 3);
    for (let i = 0; i < seeds.length; i++) seeds[i] = random();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    const material = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: true,
      uniforms: {
        uTime: { value: 0 }, uProgress: { value: 0 }, uDpr: { value: 1 },
        uWind: { value: new THREE.Vector2() }, uColor: { value: new THREE.Color() },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed; uniform float uTime,uProgress,uDpr;uniform vec2 uWind;
        varying float vAlpha,vPhase,vShape;
        void main(){
          float late=smoothstep(.76,.95,uProgress);
          vec3 p=vec3((aSeed.x-.5)*38.,mod(aSeed.y*30.+uTime*mix(.14,-.24,late),30.)-4.,(aSeed.z-.5)*22.);
          p.x+=sin(uTime*.24+aSeed.y*18.)*(.4+late)+uWind.x;
          p.z+=cos(uTime*.18+aSeed.x*15.)*.4+uWind.y*.5;
          vPhase=aSeed.w*6.283+uTime*.8;
          vAlpha=(.17+aSeed.w*.3)*smoothstep(-4.,-1.,p.y)*(1.-smoothstep(23.,26.,p.y));
          vShape=uProgress*4.;
          vec4 mv=modelViewMatrix*vec4(p,1.);
          gl_Position=projectionMatrix*mv;
          gl_PointSize=clamp((35.+aSeed.w*35.)/max(1.,-mv.z),1.3,8.)*uDpr*mix(1.,1.6,late);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;varying float vAlpha,vPhase,vShape;
        void main(){
          vec2 p=gl_PointCoord-.5;
          float angle=vPhase*.6; p=mat2(cos(angle),-sin(angle),sin(angle),cos(angle))*p;
          float dotShape=1.-smoothstep(.06,.5,length(p));
          float spore=(1.-smoothstep(.34,.49,length(p)))*(.55+.45*smoothstep(.16,.29,length(p)));
          float petal=1.-smoothstep(.25,.48,length(p*vec2(1.,1.7)));
          float shape=mix(dotShape,spore,smoothstep(.6,1.2,vShape)*(1.-smoothstep(1.7,2.3,vShape)));
          shape=mix(shape,petal,smoothstep(3.0,3.8,vShape));
          gl_FragColor=vec4(uColor,shape*vAlpha); if(gl_FragColor.a<.008)discard;
        }
      `,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    this.group.add(this.points);
  }

  /** 气候、地平线和粒子随同一生命进度更新。 */
  update(p: number, time: number, windX: number, windZ: number, C: Climate, camera: THREE.Camera, dpr: number, aspect: number): void {
    const u = this.background.material.uniforms;
    u.uTop.value.copy(C.skyTop); u.uBottom.value.copy(C.skyBottom); u.uSoil.value.copy(C.ground);
    u.uHorizon.value = this.origin.set(0, 0, 0).project(camera).y * .5 + .5 + .85 * (1 - bezier4(phase(p, .10, .23)));
    u.uTime.value = time; u.uMist.value = C.mist; u.uProgress.value = p; u.uAspect.value = aspect;
    this.ground.material.uniforms.uColor.value.copy(C.trunk);
    this.ground.material.uniforms.uProgress.value = p;
    const q = this.points.material.uniforms;
    q.uTime.value = time; q.uProgress.value = p; q.uDpr.value = dpr;
    q.uWind.value.set(windX, windZ); q.uColor.value.copy(C.particle);
  }

  /** 释放所有私有材质与几何。 */
  dispose(): void {
    for (const mesh of [this.background, this.ground, this.points]) { mesh.geometry.dispose(); mesh.material.dispose(); }
    this.group.clear();
  }
}
