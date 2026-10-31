import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildPetalSurface, planFlower, FLOWERS, type PetalShape } from './flower';
import { SPECIES, buildLayout, updateBloom } from './bloom';
import type { DriveState } from './gesture';

export type PaletteId = 'gild' | 'ice' | 'pink' | 'aurora';
export type Quality = 'high' | 'medium' | 'low';

export const PALETTES: { id: PaletteId; name: string; root: string; tip: string; edge: string; core: string; glow: string; pollenA: string; pollenB: string }[] = [
  { id: 'gild', name: '鎏金玫瑰', root: '#5c3d28', tip: '#ffedd2', edge: '#ffd9a0', core: '#ffc87d', glow: '#ffb35c', pollenA: '#ffe2b8', pollenB: '#ff9d76' },
  { id: 'ice', name: '冰蓝星尘', root: '#1d3a63', tip: '#e6f4ff', edge: '#aee4ff', core: '#c8ecff', glow: '#8fd0ff', pollenA: '#d8efff', pollenB: '#7fb8ff' },
  { id: 'pink', name: '樱粉流霞', root: '#a03a72', tip: '#ffe9f3', edge: '#ffc4e0', core: '#ff9ac8', glow: '#ff7fb5', pollenA: '#ffd7e8', pollenB: '#ff8fc0' },
  { id: 'aurora', name: '极光秘境', root: '#175a4e', tip: '#e2fff4', edge: '#7dffd9', core: '#aef4ff', glow: '#66f2cf', pollenA: '#c8ffe9', pollenB: '#6fd8ff' },
];

export type BloomVerseHandle = {
  /** 平滑后的绽放度（侧栏读数/快照轮询）。 */
  getBloom(): number;
  /** 渲染当前帧并导出 PNG。 */
  snapshot(): string;
};

type Props = {
  hostRef: React.RefObject<HTMLDivElement | null>;
  active: boolean;
  /** FLOWERS 下标。 */
  species: number;
  palette: PaletteId;
  quality: Quality;
  /** 手势引擎写、视图读的共享驾驶状态。 */
  drive: { current: DriveState };
  /** 开场仪式起始时间戳（0=未开始）；视图按真实时间计算生长进度，不受定时器节流影响。 */
  introStart: { current: number };
};

/* ---------------- 着色器 ---------------- */

const PETAL_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying float vDepth;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  vec4 vp = viewMatrix * wp;
  vDepth = -vp.z;
  gl_Position = projectionMatrix * vp;
}`;

const PETAL_FRAG = /* glsl */ `
uniform vec3 uRoot, uTip, uEdge, uGlow;
uniform float uTime, uIride, uOpacity, uDeep, uInner;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
varying float vDepth;
vec3 hue2rgb(float h) {
  vec3 k = mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0);
  return clamp(min(k, 4.0 - k), 0.0, 1.0);
}
void main() {
  float u = vUv.y;
  float v = vUv.x * 2.0 - 1.0;
  vec3 base = mix(uRoot, uTip, pow(u, 0.85));
  float vein = sin((abs(v) * 5.0 + u * 3.0) * 3.14159) * 0.5 + 0.5;
  base *= 0.93 + 0.10 * vein;
  base *= uDeep;
  // 层次分离：瓣根加深 + 瓣侧收暗，相邻花瓣的轮廓因此可读
  base *= 0.68 + 0.32 * smoothstep(0.0, 0.40, u);
  base *= 1.0 - 0.22 * pow(abs(v), 3.0);
  vec3 N = normalize(vN);
  vec3 L = normalize(vec3(0.45, 0.75, 0.55));
  float ndl = dot(N, L);
  float diff = clamp(ndl * 0.5 + 0.58, 0.0, 1.0);
  float back = clamp(-ndl, 0.0, 1.0);
  vec3 col = base * (0.34 + 0.66 * diff);
  col += uGlow * back * back * 0.5 * (1.0 - u * 0.45);            // 背光透光（次表面感）
  col += uGlow * uInner * pow(1.0 - u, 1.6) * 0.55;               // 内层暖光（花心辉光）
  float fres = pow(1.0 - abs(dot(N, normalize(vV))), 2.2);
  col += uEdge * (1.1 + 0.2 * sin(uTime * 0.7 + u * 5.0 + v * 2.0)) * fres * (0.85 + (1.0 - uInner) * 0.55);   // 外层瓣缘更亮
  col += uGlow * pow(1.0 - u, 2.4) * (0.40 + 0.55 * uInner);
  if (uIride > 0.5) col += hue2rgb(fract(u * 0.55 + v * 0.16 + uTime * 0.035)) * fres * 0.75;
  // 景深衰减：后排花瓣自动变暗、内层偏暖——花瓣的层叠关系一目了然
  col *= mix(1.0, 0.48, smoothstep(3.0, 5.4, vDepth));
  col = mix(col, col * vec3(1.10, 0.93, 0.86), uInner * 0.8);
  float alpha = uOpacity * (0.60 + 0.40 * fres);
  gl_FragColor = vec4(col, alpha);
}`;

const CORE_FRAG = /* glsl */ `
uniform vec3 uCore, uGlow;
uniform float uTime, uPulse;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vV;
void main() {
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.6);
  vec3 col = uCore * (0.85 + 0.3 * sin(uTime * 1.6) * uPulse) + uGlow * fres * 1.6;
  gl_FragColor = vec4(col, 0.96);
}`;

const CORE_VERT = PETAL_VERT;

const POLLEN_VERT = /* glsl */ `
attribute float aSeed;
attribute float aSize;
uniform float uTime, uGather, uHandForce, uScale;
uniform vec3 uHand;
varying float vA;
varying float vMix;
void main() {
  vec3 p = position;
  p.x += sin(uTime * 0.12 + aSeed * 17.0) * 0.45;
  p.y += sin(uTime * 0.09 + aSeed * 29.0) * 0.32;
  p.z += cos(uTime * 0.11 + aSeed * 23.0) * 0.45;
  p = mix(uHand, p, uGather);                                   // 开场：星尘向种子汇聚
  vec3 d = uHand - p;
  float dist = length(d);
  p += (d / max(dist, 1e-4)) * smoothstep(1.0, 0.0, dist) * uHandForce * 0.22;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = aSize * 0.0042 * uScale / -mv.z;
  vA = 0.42 + 0.58 * pow(0.5 + 0.5 * sin(uTime * (0.5 + aSeed) + aSeed * 40.0), 2.0);
  vMix = aSeed;
  gl_Position = projectionMatrix * mv;
}`;

const POLLEN_FRAG = /* glsl */ `
uniform vec3 uPollenA, uPollenB;
uniform sampler2D uMap;
varying float vA;
varying float vMix;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vA;
  gl_FragColor = vec4(mix(uPollenA, uPollenB, vMix), a);
}`;

const BURST_VERT = /* glsl */ `
attribute vec3 aDir;
attribute float aSpeed;
attribute float aDelay;
attribute float aSeed;
uniform float uTime, uBurstTime, uScale;
varying float vA;
void main() {
  float t = max(uTime - uBurstTime - aDelay, 0.0);
  float life = 1.2 + aSeed * 0.8;
  float k = clamp(t / life, 0.0, 1.0);
  vec3 p = vec3(0.0, 0.05, 0.0) + aDir * aSpeed * t * (1.0 - 0.35 * k);
  p.y += sin(t * 2.0 + aSeed * 9.0) * 0.06;
  p.y -= k * k * 0.25;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (1.8 - k) * (0.9 + aSeed) * 0.0052 * uScale / -mv.z;
  vA = pow(1.0 - k, 1.5) * step(0.0001, t);
  gl_Position = projectionMatrix * mv;
}`;

const BURST_FRAG = /* glsl */ `
uniform vec3 uPollenA, uPollenB;
uniform sampler2D uMap;
varying float vA;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vA;
  gl_FragColor = vec4(uPollenA, a);
}`;

const MINI_VERT = /* glsl */ `
attribute vec3 aBloomP;
attribute vec3 aColor;
attribute float aDelay;
attribute float aSize;
attribute float aSeed;
uniform float uOpen, uScale;
varying vec3 vColor;
varying float vA;
float backOut(float t) { float s = 1.7; t -= 1.0; return 1.0 + (s + 1.0) * t * t * t + s * t * t; }
void main() {
  float local = clamp((uOpen * 1.25 - aDelay) / 0.55, 0.0, 1.0);
  vec3 p = mix(position, aBloomP, backOut(local));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = aSize * (0.5 + 0.5 * local) * 0.0032 * uScale / -mv.z;
  vColor = aColor;
  vA = (0.4 + 0.6 * local) * step(0.001, uOpen);
  gl_Position = projectionMatrix * mv;
}`;

const MINI_FRAG = /* glsl */ `
uniform sampler2D uMap;
varying vec3 vColor;
varying float vA;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vA;
  gl_FragColor = vec4(vColor, a);
}`;

const TRAIL_VERT = /* glsl */ `
attribute float aBirth;
attribute float aSize;
uniform float uTime, uScale;
varying float vA;
void main() {
  float age = uTime - aBirth;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = max(0.0, 1.0 - age * 0.9) * aSize * 0.005 * uScale / -mv.z;
  vA = exp(-age * 2.6) * step(0.0, age);
  gl_Position = projectionMatrix * mv;
}`;

const TRAIL_FRAG = /* glsl */ `
uniform vec3 uGlow;
uniform sampler2D uMap;
varying float vA;
void main() {
  float a = texture2D(uMap, gl_PointCoord).a * vA;
  gl_FragColor = vec4(uGlow, a);
}`;

/* ---------------- 工具 ---------------- */

function softSprite(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const hex = (s: string) => new THREE.Color(s);
const frac = (x: number) => x - Math.floor(x);
const QUALITY_DPR: Record<Quality, number> = { high: 2, medium: 1.5, low: 1 };
const QUALITY_POLLEN: Record<Quality, number> = { high: 2600, medium: 1700, low: 900 };
const QUALITY_STORM: Record<Quality, number> = { high: 140, medium: 90, low: 48 };
const QUALITY_MINIS: Record<Quality, number> = { high: 12, medium: 8, low: 5 };
/** 花海小花的粒子花型（复用 bloom.ts 花型点阵）。 */
const MINI_SPECIES: Record<string, number> = { rose: 2, lotus: 1, sakura: 0, fantasy: 1 };

type PetalNode = {
  wrap: THREE.Group;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  tiltOpen: number;
  tiltClose: number;
  delay: number;
  baseScale: number;
  phase: number;
};

type MiniNode = {
  group: THREE.Group;
  mat: THREE.ShaderMaterial;
  offset: number;
  sizeMul: number;
};

/** BloomVerse 视图：程序化 3D 花瓣 + 粒子特效 + UnrealBloom 后处理。
 *  场景层经 drive ref 驱动（手势引擎/鼠标共用），视图只做渲染与动画积分。 */
export const BloomVerseView = forwardRef<BloomVerseHandle, Props>(function BloomVerseView(
  { hostRef, active, species, palette, quality, drive, introStart },
  ref,
) {
  const world = useRef<any>(null);
  const ui = useRef({ active, species, palette, quality, drive, introStart });
  ui.current = { active, species, palette, quality, drive, introStart };

  useImperativeHandle(ref, () => ({
    /** 平滑后的绽放度（侧栏读数/快照轮询）。 */
    getBloom() {
      return world.current ? world.current.stats.bloom : 0;
    },
    snapshot() {
      const w = world.current; if (!w) return '';
      w.render();
      return w.renderer.domElement.toDataURL('image/png');
    },
  }), []);

  /* 花种切换：重建花瓣与花海小花（带一次性爆散粒子）。 */
  useEffect(() => {
    const w = world.current; if (!w) return;
    w.rebuildFlower(species);
  }, [species]);

  /* 调色板切换：仅更新 uniform 颜色。 */
  useEffect(() => {
    const w = world.current; if (!w) return;
    w.applyPalette(palette);
  }, [palette]);

  /* 画质：DPR / 后处理 / 粒子规模。 */
  useEffect(() => {
    const w = world.current; if (!w) return;
    w.applyQuality(quality);
  }, [quality]);

  useEffect(() => {
    const el = hostRef.current; if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); }
    catch { el.textContent = 'WebGL 不可用，请启用硬件加速。'; return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY_DPR[ui.current.quality]));
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#04060f');
    scene.fog = new THREE.FogExp2(0x04060f, 0.055);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 60);
    camera.position.set(0, 0.32, 4.5);

    const sprite = softSprite();

    /* ---------- 花朵（倾斜组 → 自转组 → 花瓣/花芯/迸发粒子） ---------- */
    const flowerGroup = new THREE.Group();
    flowerGroup.rotation.x = -1.02;   // 3/4 俯视：露出层叠花心
    scene.add(flowerGroup);
    const spinGroup = new THREE.Group();
    flowerGroup.add(spinGroup);
    const petalGroup = new THREE.Group();
    spinGroup.add(petalGroup);
    let core: THREE.Group | null = null;
    const petals: PetalNode[] = [];
    const geoCache = new Map<string, THREE.BufferGeometry>();

    const petalGeometry = (shape: PetalShape) => {
      const key = JSON.stringify(shape);
      let geo = geoCache.get(key);
      if (!geo) {
        const d = buildPetalSurface(shape, 16, 8);
        geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(d.uvs, 2));
        geo.setIndex(new THREE.BufferAttribute(d.indices, 1));
        geoCache.set(key, geo);
      }
      return geo;
    };

    const paletteOf = () => PALETTES.find(p => p.id === ui.current.palette) ?? PALETTES[0];

    const makePetalMaterial = (deep: number, inner: number) => {
      const pal = paletteOf();
      return new THREE.ShaderMaterial({
        vertexShader: PETAL_VERT,
        fragmentShader: PETAL_FRAG,
        uniforms: {
          uRoot: { value: hex(pal.root) }, uTip: { value: hex(pal.tip) },
          uEdge: { value: hex(pal.edge) }, uGlow: { value: hex(pal.glow) },
          uTime: { value: 0 }, uIride: { value: FLOWERS[ui.current.species].id === 'fantasy' ? 1 : 0 },
          uOpacity: { value: 0.92 }, uDeep: { value: deep }, uInner: { value: inner },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    };

    const rebuildFlower = (speciesIdx: number) => {
      const sp = FLOWERS[speciesIdx];
      for (const p of petals) { p.mat.dispose(); petalGroup.remove(p.wrap); }
      petals.length = 0;
      if (core) {
        core.traverse(o => {
          const m = o as THREE.Mesh;
          m.geometry?.dispose();
          const mat = m.material as THREE.Material | undefined;
          mat?.dispose?.();
        });
        flowerGroup.remove(core);
        core = null;
      }
      const plan = planFlower(sp);
      const layerCount = sp.layers.length;
      for (const pl of plan.placements) {
        const wrap = new THREE.Group();
        wrap.rotation.y = pl.azimuth;
        const innerT = layerCount > 1 ? pl.layer / (layerCount - 1) : 1;
        const mat = makePetalMaterial(0.80 + 0.24 * innerT, innerT);   // 外层深、内层亮暖——层次分明
        const mesh = new THREE.Mesh(petalGeometry(pl.shape), mat);
        mesh.scale.setScalar(pl.scale * 1.42);
        mesh.rotation.x = pl.tiltClose;
        wrap.add(mesh);
        petalGroup.add(wrap);
        petals.push({ wrap, mesh, mat, tiltOpen: pl.tiltOpen, tiltClose: pl.tiltClose, delay: pl.delay, baseScale: pl.scale * 1.42, phase: pl.azimuth * 2.7 });
      }
      // 花芯：花托穹顶 + 叶序花丝 + 亮点花药。
      core = new THREE.Group();
      const pal = paletteOf();
      const coreMat = new THREE.ShaderMaterial({
        vertexShader: CORE_VERT, fragmentShader: CORE_FRAG,
        uniforms: {
          uCore: { value: hex(pal.core) }, uGlow: { value: hex(pal.glow) },
          uTime: { value: 0 }, uPulse: { value: 1 },
        },
        transparent: true, depthWrite: false,
      });
      const dome = new THREE.Mesh(new THREE.SphereGeometry(sp.core.radius, 28, 18), coreMat);
      dome.scale.set(1, sp.core.height / Math.max(sp.core.radius, 1e-4), 1);
      core.add(dome);
      const stamenGeo = new THREE.ConeGeometry(0.0075, sp.core.height * 1.9, 5);
      stamenGeo.translate(0, sp.core.height * 0.95, 0);
      const stamenMat = new THREE.MeshBasicMaterial({ color: hex(pal.glow).multiplyScalar(1.25) });
      const stamens = new THREE.InstancedMesh(stamenGeo, stamenMat, sp.core.stamens);
      const tipPos = new Float32Array(sp.core.stamens * 3);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < sp.core.stamens; i++) {
        const f = (i + 0.5) / sp.core.stamens;
        const r = sp.core.radius * 0.92 * Math.sqrt(f);
        const a = i * 2.39996323;
        const tilt = 0.25 + 0.55 * f;
        q.setFromAxisAngle(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), tilt);
        m4.compose(new THREE.Vector3(r * Math.cos(a) * 0.9, sp.core.height * 0.3, r * Math.sin(a) * 0.9), q, sc);
        stamens.setMatrixAt(i, m4);
        const tipLen = sp.core.height * 1.9;
        tipPos[i * 3] = r * Math.cos(a) * 0.9 + Math.sin(tilt) * tipLen * Math.cos(a);
        tipPos[i * 3 + 1] = sp.core.height * 0.3 + Math.cos(tilt) * tipLen * 0.4;
        tipPos[i * 3 + 2] = r * Math.sin(a) * 0.9 + Math.sin(tilt) * tipLen * Math.sin(a);
      }
      core.add(stamens);
      const tipGeo = new THREE.BufferGeometry();
      tipGeo.setAttribute('position', new THREE.BufferAttribute(tipPos, 3));
      const tips = new THREE.Points(tipGeo, new THREE.PointsMaterial({
        color: hex(pal.core).multiplyScalar(1.6), size: 0.035, sizeAttenuation: true,
        transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      core.add(tips);
      core.scale.setScalar(0.001);
      spinGroup.add(core);
      triggerBurst();
    };

    /* ---------- 花粉 / 星尘 ---------- */
    const POLLEN_N = 2600;
    const pollenPos = new Float32Array(POLLEN_N * 3);
    const pollenSeed = new Float32Array(POLLEN_N);
    const pollenSize = new Float32Array(POLLEN_N);
    for (let i = 0; i < POLLEN_N; i++) {
      pollenPos[i * 3] = (Math.random() - 0.5) * 7.0;
      pollenPos[i * 3 + 1] = (Math.random() - 0.5) * 4.4;
      pollenPos[i * 3 + 2] = (Math.random() - 0.5) * 4.5 - 0.5;
      pollenSeed[i] = Math.random();
      pollenSize[i] = 0.5 + Math.random() * 1.1;
    }
    const pollenGeo = new THREE.BufferGeometry();
    pollenGeo.setAttribute('position', new THREE.BufferAttribute(pollenPos, 3));
    pollenGeo.setAttribute('aSeed', new THREE.BufferAttribute(pollenSeed, 1));
    pollenGeo.setAttribute('aSize', new THREE.BufferAttribute(pollenSize, 1));
    const pal0 = paletteOf();
    const pollenMat = new THREE.ShaderMaterial({
      vertexShader: POLLEN_VERT, fragmentShader: POLLEN_FRAG,
      uniforms: {
        uTime: { value: 0 }, uGather: { value: 1 }, uHandForce: { value: 0 }, uScale: { value: 900 },
        uHand: { value: new THREE.Vector3(0, 0, 0) },
        uPollenA: { value: hex(pal0.pollenA) }, uPollenB: { value: hex(pal0.pollenB) },
        uMap: { value: sprite },
      },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pollen = new THREE.Points(pollenGeo, pollenMat);
    pollen.frustumCulled = false;
    scene.add(pollen);

    /* ---------- 绽放粒子（从花心迸发） ---------- */
    const BURST_N = 2200;
    const burstGeo = new THREE.BufferGeometry();
    {
      const dir = new Float32Array(BURST_N * 3);
      const speed = new Float32Array(BURST_N);
      const delay = new Float32Array(BURST_N);
      const seed = new Float32Array(BURST_N);
      const zero = new Float32Array(BURST_N * 3);
      for (let i = 0; i < BURST_N; i++) {
        const a = Math.random() * Math.PI * 2;
        const upBias = Math.random() * 0.9;
        const r = Math.sqrt(1 - upBias * upBias);
        dir[i * 3] = r * Math.cos(a);
        dir[i * 3 + 1] = upBias;
        dir[i * 3 + 2] = r * Math.sin(a) * 0.8 + 0.25;
        speed[i] = 0.9 + Math.random() * 2.1;
        delay[i] = Math.random() * 0.22;
        seed[i] = Math.random();
      }
      burstGeo.setAttribute('position', new THREE.BufferAttribute(zero, 3));
      burstGeo.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
      burstGeo.setAttribute('aSpeed', new THREE.BufferAttribute(speed, 1));
      burstGeo.setAttribute('aDelay', new THREE.BufferAttribute(delay, 1));
      burstGeo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    }
    const burstMat = new THREE.ShaderMaterial({
      vertexShader: BURST_VERT, fragmentShader: BURST_FRAG,
      uniforms: {
        uTime: { value: 0 }, uBurstTime: { value: -10 }, uScale: { value: 900 },
        uPollenA: { value: hex(pal0.pollenA) }, uPollenB: { value: hex(pal0.pollenB) },
        uMap: { value: sprite },
      },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const burst = new THREE.Points(burstGeo, burstMat);
    burst.frustumCulled = false;
    spinGroup.add(burst);

    /* ---------- 手势光轨 ---------- */
    const TRAIL_N = 700;
    const trailGeo = new THREE.BufferGeometry();
    const trailPos = new Float32Array(TRAIL_N * 3);
    const trailBirth = new Float32Array(TRAIL_N).fill(-100);
    const trailSize = new Float32Array(TRAIL_N);
    for (let i = 0; i < TRAIL_N; i++) trailSize[i] = 0.6 + Math.random() * 1.2;
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    trailGeo.setAttribute('aBirth', new THREE.BufferAttribute(trailBirth, 1));
    trailGeo.setAttribute('aSize', new THREE.BufferAttribute(trailSize, 1));
    const trailMat = new THREE.ShaderMaterial({
      vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG,
      uniforms: { uTime: { value: 0 }, uScale: { value: 900 }, uGlow: { value: hex(pal0.glow) }, uMap: { value: sprite } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const trail = new THREE.Points(trailGeo, trailMat);
    trail.frustumCulled = false;
    scene.add(trail);
    let trailHead = 0;
    let trailEmitAcc = 0;
    const stormEmitters: { p: THREE.Vector3; v: THREE.Vector3; until: number }[] = [];

    const emitTrail = (x: number, y: number, z: number, t: number, n = 2) => {
      for (let i = 0; i < n; i++) {
        const k = trailHead = (trailHead + 1) % TRAIL_N;
        trailPos[k * 3] = x + (Math.random() - 0.5) * 0.05;
        trailPos[k * 3 + 1] = y + (Math.random() - 0.5) * 0.05;
        trailPos[k * 3 + 2] = z + (Math.random() - 0.5) * 0.05;
        trailBirth[k] = t;
      }
      trailGeo.attributes.position.needsUpdate = true;
      trailGeo.attributes.aBirth.needsUpdate = true;
    };

    /* ---------- 花瓣风暴（实例化小花瓣） ---------- */
    const STORM_N = QUALITY_STORM[ui.current.quality];
    const stormGeoBase = buildPetalSurface(FLOWERS[0].layers[1].shape, 8, 4);
    const stormGeo = new THREE.BufferGeometry();
    stormGeo.setAttribute('position', new THREE.BufferAttribute(stormGeoBase.positions, 3));
    stormGeo.setAttribute('normal', new THREE.BufferAttribute(stormGeoBase.normals, 3));
    stormGeo.setAttribute('uv', new THREE.BufferAttribute(stormGeoBase.uvs, 2));
    stormGeo.setIndex(new THREE.BufferAttribute(stormGeoBase.indices, 1));
    const stormFade = new Float32Array(STORM_N).fill(0);
    stormGeo.setAttribute('aFade', new THREE.InstancedBufferAttribute(stormFade, 1));
    const stormMat = new THREE.ShaderMaterial({
      vertexShader: /* glsl */ `
        attribute float aFade;
        varying vec2 vUv; varying vec3 vN; varying vec3 vV; varying float vF; varying float vDepth;
        void main() {
          vUv = uv; vF = aFade;
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          vec4 vp = viewMatrix * wp;
          vDepth = -vp.z;
          gl_Position = projectionMatrix * vp;
        }`,
      fragmentShader: PETAL_FRAG,
      uniforms: {
        uRoot: { value: hex(pal0.root) }, uTip: { value: hex(pal0.tip) },
        uEdge: { value: hex(pal0.edge) }, uGlow: { value: hex(pal0.glow) },
        uTime: { value: 0 }, uIride: { value: 0 }, uOpacity: { value: 1 }, uDeep: { value: 1 }, uInner: { value: 0 },
      },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    // 注：PETAL_FRAG 的透明度叠加 vF（风暴实例淡出）。
    stormMat.fragmentShader = PETAL_FRAG.replace(
      'float alpha = uOpacity * (0.60 + 0.40 * fres);',
      'float alpha = uOpacity * (0.60 + 0.40 * fres) * vF;');
    stormMat.needsUpdate = true;
    const storm = new THREE.InstancedMesh(stormGeo, stormMat, STORM_N);
    storm.frustumCulled = false;
    scene.add(storm);
    const stormState = Array.from({ length: STORM_N }, () => ({
      pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(),
      rv: new THREE.Vector3(), born: -1e9, life: 1, size: 1,
    }));
    const stormM4 = new THREE.Matrix4(), stormQ = new THREE.Quaternion(), stormS = new THREE.Vector3();

    /* ---------- 双手花海（粒子小花） ---------- */
    const MINI_N = QUALITY_MINIS[ui.current.quality];
    const minis: MiniNode[] = [];
    const miniGroup = new THREE.Group();
    scene.add(miniGroup);
    const rebuildMinis = () => {
      for (const m of minis) { m.mat.dispose(); miniGroup.remove(m.group); }
      minis.length = 0;
      const layout = buildLayout(SPECIES[MINI_SPECIES[FLOWERS[ui.current.species].id] ?? 0], 900);
      for (let i = 0; i < MINI_N; i++) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(layout.bud, 3));
        geo.setAttribute('aBloomP', new THREE.BufferAttribute(layout.bloom, 3));
        geo.setAttribute('aColor', new THREE.BufferAttribute(layout.color, 3));
        geo.setAttribute('aDelay', new THREE.BufferAttribute(layout.delay, 1));
        geo.setAttribute('aSize', new THREE.BufferAttribute(layout.size, 1));
        geo.setAttribute('aSeed', new THREE.BufferAttribute(layout.seed, 1));
        const mat = new THREE.ShaderMaterial({
          vertexShader: MINI_VERT, fragmentShader: MINI_FRAG,
          uniforms: { uOpen: { value: 0 }, uScale: { value: 900 }, uMap: { value: sprite } },
          transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        });
        const pts = new THREE.Points(geo, mat);
        pts.frustumCulled = false;
        const group = new THREE.Group();
        group.add(pts);
        group.visible = false;
        miniGroup.add(group);
        minis.push({ group, mat, offset: frac(i * 0.618) , sizeMul: 0.55 + 0.45 * frac(i * 0.377) });
      }
    };
    rebuildMinis();

    /* ---------- 后处理 ---------- */
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.72, 0.55, 0.62);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());

    const resize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      renderer.setSize(w, h);
      composer.setSize(w, h);
      camera.aspect = h ? w / h : 1;
      camera.updateProjectionMatrix();
      const scale = renderer.domElement.height / (2 * Math.tan((camera.fov * Math.PI) / 360));
      pollenMat.uniforms.uScale.value = scale;
      burstMat.uniforms.uScale.value = scale;
      trailMat.uniforms.uScale.value = scale;
      for (const m of minis) m.mat.uniforms.uScale.value = scale;
    };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();

    const applyPalette = (id: PaletteId) => {
      const pal = PALETTES.find(p => p.id === id) ?? PALETTES[0];
      for (const p of petals) {
        p.mat.uniforms.uRoot.value = hex(pal.root);
        p.mat.uniforms.uTip.value = hex(pal.tip);
        p.mat.uniforms.uEdge.value = hex(pal.edge);
        p.mat.uniforms.uGlow.value = hex(pal.glow);
      }
      if (core) {
        const dome = core.children[0] as THREE.Mesh;
        (dome.material as THREE.ShaderMaterial).uniforms.uCore.value = hex(pal.core);
        (dome.material as THREE.ShaderMaterial).uniforms.uGlow.value = hex(pal.glow);
        const stamens = core.children[1] as THREE.InstancedMesh;
        (stamens.material as THREE.MeshBasicMaterial).color = hex(pal.glow).multiplyScalar(1.25);
        const tips = core.children[2] as THREE.Points;
        (tips.material as THREE.PointsMaterial).color = hex(pal.core).multiplyScalar(1.6);
      }
      pollenMat.uniforms.uPollenA.value = hex(pal.pollenA);
      pollenMat.uniforms.uPollenB.value = hex(pal.pollenB);
      burstMat.uniforms.uPollenA.value = hex(pal.pollenA);
      trailMat.uniforms.uGlow.value = hex(pal.glow);
      stormMat.uniforms.uRoot.value = hex(pal.root);
      stormMat.uniforms.uTip.value = hex(pal.tip);
      stormMat.uniforms.uEdge.value = hex(pal.edge);
      stormMat.uniforms.uGlow.value = hex(pal.glow);
    };

    const applyQuality = (q: Quality) => {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY_DPR[q]));
      pollenGeo.setDrawRange(0, QUALITY_POLLEN[q]);
      storm.count = QUALITY_STORM[q];
      resize();
    };

    const triggerBurst = () => {
      burstMat.uniforms.uBurstTime.value = performance.now() / 1000;
    };

    let bloom = 0, scaleCur = 1, scaleVel = 0, spin = 0, rotY = 0, seaStrength = 0, seaRadius = 1;
    let lastBloomForBurst = 0, lastBurstAt = 0, dipUntil = 0, dipValue = 0, bloomRiseAcc = 0, lastHandEmitX = -1, lastHandEmitY = -1;

    const renderNow = () => (ui.current.quality === 'low'
      ? renderer.render(scene, camera)
      : composer.render());
    const stats = { bloom: 0, scale: 1 };
    const w = {
      renderer, scene, camera, composer, bloomPass, sprite,
      petals, petalGroup, flowerGroup, geoCache, stats,
      rebuildFlower, applyPalette, applyQuality, triggerBurst,
      render: renderNow,
    };
    world.current = w;

    let frame = 0, prev = performance.now();
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const now = performance.now();
      const t = now / 1000;
      const dt = Math.min((now - prev) / 1000, 0.05); prev = now;
      if (!ui.current.active) return;
      const d = ui.current.drive.current;
      const is = ui.current.introStart.current;
      const introK = is > 0 ? Math.min(1, (Date.now() - is) / 3200) : 1;

      // 消费风暴事件：花瓣收拢 → 风暴 → 再绽放。风暴花瓣铺满整个舞台（全屏飞散）。
      if (d.stormQueue.length) {
        for (const ev of d.stormQueue) {
          dipUntil = t + 1.15;
          dipValue = 0.1;
          lastBurstAt = t;
          const dirX = ev.dirX, power = ev.power;
          const n = QUALITY_STORM[ui.current.quality];
          for (let i = 0; i < n; i++) {
            const st = stormState[i];
            const a = Math.random() * Math.PI * 2;
            const r = 0.35 + Math.random() * 0.8;
            // 70% 出生在花心附近，30% 铺满全屏，形成贯穿整个界面的花瓣风暴
            if (Math.random() < 0.7) st.pos.set(r * Math.cos(a), -0.1 + Math.random() * 0.9, r * Math.sin(a) * 0.6);
            else st.pos.set((Math.random() - 0.5) * 4.6, -0.5 + Math.random() * 1.7, (Math.random() - 0.5) * 2.0);
            st.vel.set(dirX * (1.15 + Math.random() * 1.0) * power + (Math.random() - 0.5) * 0.7,
              0.15 + Math.random() * 0.7, (Math.random() - 0.5) * 0.9);
            st.rot.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
            st.rv.set((Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7);
            st.born = t + Math.random() * 0.55;
            st.life = 2.3 + Math.random() * 1.3;
            st.size = 0.14 + Math.random() * 0.14;
          }
          // 光轨发射器：两条弧线扫过全屏，沿途播撒光点。
          stormEmitters.length = 0;
          stormEmitters.push(
            { p: new THREE.Vector3(0, 0.5, 0), v: new THREE.Vector3(dirX * 3.2, 0.5, 0), until: t + 0.85 },
            { p: new THREE.Vector3(0, -0.4, 0.4), v: new THREE.Vector3(dirX * 2.6, 0.95, 0), until: t + 0.85 },
          );
        }
        d.stormQueue.length = 0;
      }

      // 绽放度积分（风暴期间短暂收拢）。
      const target = t < dipUntil ? dipValue : d.bloomTarget;
      bloom = updateBloom(bloom, target, dt, 3.0);
      stats.bloom = bloom;
      stats.scale = scaleCur;
      // 绽放上升沿累计触发迸发（平滑上升的单帧涨幅很小，必须按累计量判定，否则开花永远不喷发）。
      const rise = bloom - lastBloomForBurst;
      if (rise > 0) bloomRiseAcc += rise;
      else if (rise < -0.02) bloomRiseAcc = 0;
      if (bloomRiseAcc > 0.10 && t - lastBurstAt > 0.9) {
        burstMat.uniforms.uBurstTime.value = t;
        bloomRiseAcc = 0;
        lastBurstAt = t;
      }
      lastBloomForBurst = bloom;

      // 缩放（弹簧，轻微弹性）。
      scaleVel += (d.scaleTarget - scaleCur) * 90 * dt;
      scaleVel *= Math.exp(-9 * dt);
      scaleCur += scaleVel * dt;

      // 旋转（横移惯性 + 空闲慢转）。
      spin += (d.spinTarget - spin) * (1 - Math.exp(-3.5 * dt));
      rotY += (spin + (d.gesture === 'idle' ? 0.14 : 0)) * dt;
      spinGroup.rotation.y = rotY;

      // 呼吸与开场生长。
      const breathe = 1 + 0.012 * Math.sin(t * 1.25);
      const grow = 0.25 + 0.75 * (1 - Math.pow(1 - introK, 3));
      flowerGroup.scale.setScalar(scaleCur * breathe * grow * (1 + seaStrength * 0.06));

      // 花瓣逐片开合。
      for (const p of petals) {
        const local = Math.max(0, Math.min(1, (bloom * 1.35 - p.delay) / 0.6));
        const k = local - 1;
        const eased = 1 + 2.70158 * k * k * k + 1.70158 * k * k;   // easeOutBack
        p.mesh.rotation.x = p.tiltClose + (p.tiltOpen - p.tiltClose) * eased;
        p.mesh.rotation.z = Math.sin(t * 0.9 + p.phase) * 0.02 * local;
        const s = p.baseScale * (1 + 0.015 * Math.sin(t * 1.1 + p.phase)) * (0.35 + 0.65 * local);
        p.mesh.scale.setScalar(s);
        p.mat.uniforms.uTime.value = t;
      }
      if (core) {
        core.scale.setScalar(Math.max(0.001, (0.35 + 0.65 * bloom) * grow));
        core.rotation.y = -rotY * 0.35;
        const dome = core.children[0] as THREE.Mesh;
        (dome.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
        (dome.material as THREE.ShaderMaterial).uniforms.uPulse.value = 0.4 + 0.6 * bloom;
      }

      // 花粉：开场汇聚 + 手势引力。
      pollenMat.uniforms.uTime.value = t;
      pollenMat.uniforms.uGather.value = 1 - introK;
      const handForce = d.present ? 1 : 0;
      pollenMat.uniforms.uHandForce.value += (handForce * (0.4 + 0.6 * bloom) - pollenMat.uniforms.uHandForce.value) * 0.06;
      (pollenMat.uniforms.uHand.value as THREE.Vector3).set((d.handX - 0.5) * 3.2, (0.5 - d.handY) * 2.0 + 0.15, 0.7);

      burstMat.uniforms.uTime.value = t;
      trailMat.uniforms.uTime.value = t;
      stormMat.uniforms.uTime.value = t;

      // 手势光轨：手动 + 风暴弧线。
      if (d.present) {
        const hx = (d.handX - 0.5) * 3.2, hy = (0.5 - d.handY) * 2.0 + 0.15;
        const moved = lastHandEmitX < 0 || Math.hypot(hx - lastHandEmitX, hy - lastHandEmitY) > 0.03;
        if (moved) { emitTrail(hx, hy, 0.75, t, 2); lastHandEmitX = hx; lastHandEmitY = hy; }
      } else lastHandEmitX = -1;
      if (stormEmitters.length) {
        for (const em of stormEmitters) {
          if (t < em.until) {
            em.p.addScaledVector(em.v, dt);
            em.v.y -= 0.7 * dt;
            emitTrail(em.p.x, em.p.y, em.p.z, t, 4);
          }
        }
        for (let i = stormEmitters.length - 1; i >= 0; i--) if (t >= stormEmitters[i].until) stormEmitters.splice(i, 1);
      }

      // 花瓣风暴实例更新。
      for (let i = 0; i < storm.count; i++) {
        const st = stormState[i];
        const age = t - st.born;
        if (age < 0 || age > st.life) {
          stormFade[i] = 0;
          stormM4.makeScale(0, 0, 0);
          storm.setMatrixAt(i, stormM4);
          continue;
        }
        st.pos.addScaledVector(st.vel, dt);
        st.vel.multiplyScalar(Math.exp(-0.85 * dt));
        st.vel.y -= 0.2 * dt;
        st.rot.x += st.rv.x * dt; st.rot.y += st.rv.y * dt; st.rot.z += st.rv.z * dt;
        const fade = age < st.life * 0.7 ? 1 : 1 - (age - st.life * 0.7) / (st.life * 0.3);
        stormFade[i] = fade * 0.95;
        stormQ.setFromEuler(st.rot);
        stormS.setScalar(st.size);
        stormM4.compose(st.pos, stormQ, stormS);
        storm.setMatrixAt(i, stormM4);
      }
      stormGeo.attributes.aFade.needsUpdate = true;
      storm.instanceMatrix.needsUpdate = true;

      // 双手花海。
      seaStrength += ((d.sea ? 1 : 0) - seaStrength) * (1 - Math.exp(-2.2 * dt));
      seaRadius += (d.seaRadius - seaRadius) * (1 - Math.exp(-2.5 * dt));
      const miniOpen = Math.max(0, Math.min(1, Math.max(bloom * 1.15 - 0.05, seaStrength * 0.92)));
      for (let i = 0; i < minis.length; i++) {
        const m = minis[i];
        m.group.visible = seaStrength > 0.02;
        if (!m.group.visible) continue;
        const a = (i / minis.length) * Math.PI * 2 + rotY * 0.22 + m.offset * 6.28;
        const rr = (0.5 + seaRadius * 1.05) * (0.72 + 0.42 * m.sizeMul);
        m.group.position.set(Math.cos(a) * rr, -0.35 + Math.sin(t * 0.7 + i * 1.7) * 0.1 + (m.offset - 0.5) * 1.4, Math.sin(a) * rr * 0.72 + (m.sizeMul - 0.5) * 1.3);
        m.group.rotation.set(-1.0, a, 0);
        m.group.scale.setScalar(seaStrength * m.sizeMul * 1.5);
        m.mat.uniforms.uOpen.value = Math.max(0, Math.min(1, miniOpen * 1.25 - m.offset * 0.3));
      }

      // 花随手漂移；无手时缓缓漂回画面中心（不永远停在最后一处）。
      const tx = d.present ? (d.handX - 0.5) * 2.6 : flowerGroup.position.x * Math.exp(-0.9 * dt);
      const ty = d.present ? (0.5 - d.handY) * 1.6 : flowerGroup.position.y * Math.exp(-0.9 * dt);
      const pk = 1 - Math.exp(-4.5 * dt);
      flowerGroup.position.x += (tx - flowerGroup.position.x) * pk;
      flowerGroup.position.y += (ty - flowerGroup.position.y) * pk;

      // 相机：手势视差 + 花海拉远。
      const px = d.present ? (d.handX - 0.5) * 0.5 : 0;
      const py = d.present ? (0.5 - d.handY) * 0.28 : 0;
      camera.position.x += (px + Math.sin(t * 0.1) * 0.1 - camera.position.x) * (1 - Math.exp(-2.5 * dt));
      camera.position.y += (0.32 + py - camera.position.y) * (1 - Math.exp(-2.5 * dt));
      camera.position.z += (4.5 + seaStrength * 1.7 - camera.position.z) * (1 - Math.exp(-2 * dt));
      camera.lookAt(0, 0.08, 0);

      renderNow();
    };
    tick();

    rebuildFlower(ui.current.species);
    applyPalette(ui.current.palette);
    applyQuality(ui.current.quality);

    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      scene.traverse(obj => {
        const m = obj as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = (m as any).material;
        if (mat) Array.isArray(mat) ? mat.forEach((x: THREE.Material) => x.dispose()) : mat.dispose();
      });
      for (const g of geoCache.values()) g.dispose();
      bloomPass.dispose(); composer.dispose(); sprite.dispose();
      renderer.dispose(); renderer.domElement.remove(); world.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
});
