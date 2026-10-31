/** BloomVerse · 三维花朵内核：花瓣参数化曲面、花种结构规划（确定性纯函数，可单元测试）。
 *  与 pottery/bloom 内核同风格：本文件不 import three，输出纯数组，由视图层包装为 BufferGeometry。
 *
 *  花瓣曲面：沿瓣长 u∈[0,1]、横向 v∈[-1,1] 的参数曲面——
 *  轮廓 halfW(u)=width·sin(πu)^0.75，横向杯形 cup·v²、瓣尖后弯 curl·u^1.7、
 *  边缘波浪 ruffle、绕瓣轴扭转 twist、不对称偏斜 asym、樱式瓣尖缺口 notch。
 *  花朵结构：多层轮生（whorl），每瓣有方位角/开合倾角/绽放延迟，逐瓣独立动画。
 */

export type PetalShape = {
  /** 瓣长（花整体半径 ≈ 1.35）。 */
  length: number;
  /** 瓣最大半宽。 */
  width: number;
  /** 瓣尖向后弯曲强度。 */
  curl: number;
  /** 横向杯状拱起。 */
  cup: number;
  /** 绕瓣轴扭转（rad，随 u 渐增）。 */
  twist: number;
  /** 边缘波浪幅度。 */
  ruffle: number;
  /** 瓣尖 V 形缺口深度（樱花）。 */
  notch: number;
  /** 不对称偏斜。 */
  asym: number;
};

export type PetalLayer = {
  petals: number;
  /** 绽放时花瓣与花轴的夹角（rad，0=直立抱拢，π/2≈水平）。 */
  tiltOpen: number;
  /** 花苞时与花轴的夹角（小值=抱拢）。 */
  tiltClose: number;
  /** 层内方位角整体偏移（rad）。 */
  azOffset: number;
  /** 层缩放（内层小）。 */
  scale: number;
  /** 绽放顺序延迟基数（外层先开 → 内层值更大）。 */
  delayBase: number;
  shape: PetalShape;
};

export type CoreSpec = {
  radius: number;
  height: number;
  /** 雄蕊数量（叶序排布的小花丝）。 */
  stamens: number;
};

export type FlowerSpecies = {
  id: string; name: string; en: string;
  layers: PetalLayer[];
  core: CoreSpec;
  /** 侧栏/引导中的花种描述。 */
  note: string;
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const frac = (x: number) => x - Math.floor(x);
const GOLDEN = 0.6180339887498949;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** 玫瑰：五层宽瓣螺旋抱叠，瓣宽弯曲大、外层近水平。 */
const ROSE: FlowerSpecies = {
  id: 'rose', name: '玫瑰', en: 'Rose',
  layers: [
    { petals: 9, tiltOpen: 1.35, tiltClose: 0.10, azOffset: 0.00, scale: 1.00, delayBase: 0.00,
      shape: { length: 0.95, width: 0.46, curl: 0.30, cup: 0.42, twist: 0.30, ruffle: 0.55, notch: 0, asym: 0.30 } },
    { petals: 8, tiltOpen: 1.04, tiltClose: 0.08, azOffset: 0.44, scale: 0.83, delayBase: 0.10,
      shape: { length: 0.88, width: 0.44, curl: 0.36, cup: 0.48, twist: 0.38, ruffle: 0.45, notch: 0, asym: 0.26 } },
    { petals: 7, tiltOpen: 0.72, tiltClose: 0.07, azOffset: 0.90, scale: 0.68, delayBase: 0.20,
      shape: { length: 0.78, width: 0.42, curl: 0.42, cup: 0.55, twist: 0.46, ruffle: 0.38, notch: 0, asym: 0.22 } },
    { petals: 6, tiltOpen: 0.44, tiltClose: 0.06, azOffset: 0.22, scale: 0.54, delayBase: 0.30,
      shape: { length: 0.66, width: 0.38, curl: 0.48, cup: 0.62, twist: 0.54, ruffle: 0.30, notch: 0, asym: 0.18 } },
    { petals: 5, tiltOpen: 0.22, tiltClose: 0.05, azOffset: 0.78, scale: 0.42, delayBase: 0.40,
      shape: { length: 0.54, width: 0.34, curl: 0.54, cup: 0.70, twist: 0.62, ruffle: 0.22, notch: 0, asym: 0.15 } },
  ],
  core: { radius: 0.10, height: 0.09, stamens: 36 },
  note: '层叠螺旋宽瓣，绽放时由外向内翻卷，花心抱合如杯。',
};

/** 莲花：三轮尖瓣挺立，杯形深、通透，瓣尖微外翻。 */
const LOTUS: FlowerSpecies = {
  id: 'lotus', name: '莲花', en: 'Lotus',
  layers: [
    { petals: 13, tiltOpen: 1.18, tiltClose: 0.10, azOffset: 0.00, scale: 1.00, delayBase: 0.00,
      shape: { length: 1.00, width: 0.30, curl: 0.22, cup: 0.80, twist: 0.10, ruffle: 0.16, notch: 0.10, asym: 0.10 } },
    { petals: 11, tiltOpen: 0.76, tiltClose: 0.08, azOffset: 0.30, scale: 0.76, delayBase: 0.12,
      shape: { length: 0.88, width: 0.28, curl: 0.28, cup: 0.88, twist: 0.12, ruffle: 0.12, notch: 0.08, asym: 0.08 } },
    { petals: 9, tiltOpen: 0.40, tiltClose: 0.07, azOffset: 0.62, scale: 0.55, delayBase: 0.24,
      shape: { length: 0.72, width: 0.26, curl: 0.34, cup: 0.96, twist: 0.14, ruffle: 0.10, notch: 0.06, asym: 0.06 } },
  ],
  core: { radius: 0.16, height: 0.14, stamens: 64 },
  note: '三轮尖瓣挺立如盏，杯形深、边缘透光，莲座式花芯。',
};

/** 樱花：单层五瓣带缺口，瓣薄平展，配密集花蕊。 */
const SAKURA: FlowerSpecies = {
  id: 'sakura', name: '樱花', en: 'Sakura',
  layers: [
    { petals: 5, tiltOpen: 1.38, tiltClose: 0.14, azOffset: 0.00, scale: 1.00, delayBase: 0.00,
      shape: { length: 0.98, width: 0.36, curl: 0.10, cup: 0.30, twist: 0.06, ruffle: 0.30, notch: 0.22, asym: 0.14 } },
  ],
  core: { radius: 0.09, height: 0.08, stamens: 48 },
  note: '单层五瓣、瓣尖带标志性的 V 形缺口，花蕊密集如星。',
};

/** 幻想之花：四层细长瓣 + 扭转，虹彩着色，未来感发光结构。 */
const FANTASY: FlowerSpecies = {
  id: 'fantasy', name: '幻想之花', en: 'Fantasy',
  layers: [
    { petals: 12, tiltOpen: 1.45, tiltClose: 0.12, azOffset: 0.00, scale: 1.00, delayBase: 0.00,
      shape: { length: 1.04, width: 0.20, curl: 0.24, cup: 0.40, twist: 0.85, ruffle: 0.42, notch: 0, asym: 0.30 } },
    { petals: 10, tiltOpen: 1.02, tiltClose: 0.10, azOffset: 0.30, scale: 0.80, delayBase: 0.10,
      shape: { length: 0.92, width: 0.19, curl: 0.32, cup: 0.48, twist: 0.95, ruffle: 0.36, notch: 0, asym: 0.26 } },
    { petals: 9, tiltOpen: 0.62, tiltClose: 0.09, azOffset: 0.62, scale: 0.62, delayBase: 0.20,
      shape: { length: 0.78, width: 0.18, curl: 0.40, cup: 0.56, twist: 1.05, ruffle: 0.30, notch: 0, asym: 0.22 } },
    { petals: 8, tiltOpen: 0.28, tiltClose: 0.08, azOffset: 0.16, scale: 0.46, delayBase: 0.30,
      shape: { length: 0.62, width: 0.17, curl: 0.48, cup: 0.64, twist: 1.15, ruffle: 0.24, notch: 0, asym: 0.18 } },
  ],
  core: { radius: 0.13, height: 0.16, stamens: 80 },
  note: '四层细长扭转花瓣，虹彩流光，如深空中生长的数字生命。',
};

export const FLOWERS: FlowerSpecies[] = [ROSE, LOTUS, SAKURA, FANTASY];

/** 参数曲面取点：u 沿瓣长、v 横向，返回局部坐标（瓣基在原点，沿 +y 生长，+z 朝观察者）。 */
export function petalPoint(s: PetalShape, u: number, v: number): [number, number, number] {
  const uu = clamp01(u);
  const halfW = s.width * Math.pow(Math.sin(Math.PI * clamp01(uu * 1.06)), 0.6);
  // 樱式瓣尖缺口：靠近瓣尖的中线区域沿长度回缩，形成 V 形凹口。
  const notchZone = Math.max(0, (uu - 0.72) / 0.28);
  const sEff = uu - s.notch * Math.exp(-(v * v) / 0.06) * notchZone * 0.5;
  let x = v * halfW;
  let y = sEff * s.length;
  let z = s.cup * v * v * halfW * 0.9;
  z -= s.curl * s.length * Math.pow(uu, 1.7);
  z += s.ruffle * halfW * 0.12 * Math.sin(v * Math.PI * 3) * uu;
  x += s.asym * s.length * 0.12 * uu * uu;
  const tw = s.twist * uu;
  const rx = x * Math.cos(tw) - z * Math.sin(tw);
  const rz = x * Math.sin(tw) + z * Math.cos(tw);
  return [rx, y, rz];
}

export type PetalSurfaceData = {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint16Array;
};

/** 花瓣曲面网格数据（segU×segV 网格，中心差分法线，全部法线朝 +z 半空间）。 */
export function buildPetalSurface(s: PetalShape, segU = 16, segV = 8): PetalSurfaceData {
  const rows = segU + 1, cols = segV + 1;
  const positions = new Float32Array(rows * cols * 3);
  const normals = new Float32Array(rows * cols * 3);
  const uvs = new Float32Array(rows * cols * 2);
  const indices = new Uint16Array(segU * segV * 6);
  const eps = 1e-3;
  const at = (u: number, v: number, out: [number, number, number]) => {
    const p = petalPoint(s, u, v);
    out[0] = p[0]; out[1] = p[1]; out[2] = p[2];
  };
  const pa: [number, number, number] = [0, 0, 0], pb: [number, number, number] = [0, 0, 0];
  const pc: [number, number, number] = [0, 0, 0], pd: [number, number, number] = [0, 0, 0];
  for (let i = 0; i <= segU; i++) {
    const u = i / segU;
    for (let j = 0; j <= segV; j++) {
      const v = (j / segV) * 2 - 1;
      const k = (i * cols + j) * 3;
      const p = petalPoint(s, u, v);
      positions[k] = p[0]; positions[k + 1] = p[1]; positions[k + 2] = p[2];
      uvs[(i * cols + j) * 2] = j / segV;
      uvs[(i * cols + j) * 2 + 1] = u;
      at(Math.min(1, u + eps), v, pa); at(Math.max(0, u - eps), v, pb);
      at(u, Math.min(1, v + eps), pc); at(u, Math.max(-1, v - eps), pd);
      const du = [pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]];
      const dv = [pc[0] - pd[0], pc[1] - pd[1], pc[2] - pd[2]];
      // n = -(du × dv)：基准朝 +z（正面），弯曲后仍保持与参数化一致的连续朝向。
      let nx = -(du[1] * dv[2] - du[2] * dv[1]);
      let ny = -(du[2] * dv[0] - du[0] * dv[2]);
      let nz = -(du[0] * dv[1] - du[1] * dv[0]);
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-9) { nx = 0; ny = 0; nz = 1; }   // u=0 处参数退化（所有 v 重合于瓣基点）
      else { nx /= len; ny /= len; nz /= len; }
      normals[k] = nx; normals[k + 1] = ny; normals[k + 2] = nz;
    }
  }
  let o = 0;
  for (let i = 0; i < segU; i++) {
    for (let j = 0; j < segV; j++) {
      const a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
      indices[o++] = a; indices[o++] = c; indices[o++] = b;
      indices[o++] = b; indices[o++] = c; indices[o++] = d;
    }
  }
  return { positions, normals, uvs, indices };
}

export type PetalPlacement = {
  layer: number;
  index: number;
  /** 方位角（绕花轴）。 */
  azimuth: number;
  tiltOpen: number;
  tiltClose: number;
  /** 绽放延迟 ∈[0,0.55]：外层先开、层内绕序错峰。 */
  delay: number;
  scale: number;
  shape: PetalShape;
};

export type FlowerPlan = {
  placements: PetalPlacement[];
  core: CoreSpec;
  /** 全部花瓣数。 */
  petalCount: number;
};

/** 花朵结构规划：逐瓣的方位角、开合角与绽放延迟（确定性，含微量有机错位）。 */
export function planFlower(species: FlowerSpecies): FlowerPlan {
  const placements: PetalPlacement[] = [];
  species.layers.forEach((layer, li) => {
    for (let i = 0; i < layer.petals; i++) {
      const azimuth = (2 * Math.PI * i) / layer.petals + layer.azOffset + 0.06 * frac(i * GOLDEN);
      placements.push({
        layer: li,
        index: i,
        azimuth,
        tiltOpen: layer.tiltOpen,
        tiltClose: layer.tiltClose,
        delay: Math.min(0.55, layer.delayBase + (i / layer.petals) * 0.10 + 0.02 * frac(i * GOLDEN_ANGLE)),
        scale: layer.scale,
        shape: layer.shape,
      });
    }
  });
  return { placements, core: species.core, petalCount: placements.length };
}
