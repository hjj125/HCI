/** 美术·手势开花内核：花型点阵、花苞形态、绽放进度与手势映射（确定性纯函数，可单元测试）。
 *  粒子模型（morph 范式，参考 GitHub hand_fireworks / Gesture-Controlled-Particles）：
 *  每个粒子持有「花苞位置」与「绽放位置」两组坐标与错峰 delay，渲染层按全局绽放度在两组坐标间插值。
 *  花型数学：花瓣沿瓣长参数化填充（玫瑰曲线 r=cos(kθ) 决定瓣数与张角），
 *  花芯按叶序螺旋（黄金角 137.5°，r∝√i）生长——粒子散开的目标即一朵花。
 *  坐标约定：花心在原点，花面为 xy 平面，+z 朝向观察者；花整体半径 ≈ 1。
 */

export type Species = {
  id: string; name: string;
  /** 花瓣数（玫瑰曲线的 k，取奇数）。 */
  petals: number;
  /** 数学玫瑰模式：粒子直接填充玫瑰曲线的楔形波瓣，而非花瓣轮廓线。 */
  rose?: boolean;
  /** 瓣长（花整体半径 = 1）。 */
  petalLength: number;
  /** 瓣最大半宽。 */
  petalWidth: number;
  /** 瓣 z 向卷曲强度。 */
  curl: number;
  /** 花芯半径。 */
  coreRatio: number;
  /** 瓣根色 → 瓣尖色。 */
  palette: [string, string];
  coreColor: string;
  /** 侧栏展示的花型说明。 */
  note: string;
};

export const SPECIES: Species[] = [
  { id: 'sakura', name: '樱花', petals: 5, petalLength: 0.60, petalWidth: 0.155, curl: 0.12, coreRatio: 0.24,
    palette: ['#f278a9', '#ffe9f2'], coreColor: '#ffd27a',
    note: '5 瓣樱花：花瓣沿玫瑰曲线 r=cos(5θ) 的五个波瓣方向排布，瓣根樱粉、瓣尖近白。' },
  { id: 'cosmos', name: '波斯菊', petals: 8, petalLength: 0.62, petalWidth: 0.125, curl: 0.16, coreRatio: 0.22,
    palette: ['#a86ae0', '#f5d0ff'], coreColor: '#ffcf5e',
    note: '8 瓣波斯菊：瓣更窄更长、卷曲更强，绽放时有翻飞的层次感。' },
  { id: 'daisy', name: '雏菊', petals: 13, petalLength: 0.66, petalWidth: 0.075, curl: 0.08, coreRatio: 0.26,
    palette: ['#fff3df', '#ffffff'], coreColor: '#ffb347',
    note: '13 瓣雏菊：细瓣密排、金黄花芯占比更大——菊科的花瓣数常是斐波那契数。' },
  { id: 'rose-curve', name: '玫瑰曲线', petals: 5, rose: true, petalLength: 1.0, petalWidth: 0, curl: 0.10, coreRatio: 0.16,
    palette: ['#e8557d', '#ff9ab5'], coreColor: '#ffd27a',
    note: '数学玫瑰：粒子直接填充极坐标玫瑰线 r=cos(5θ) 的五个楔形波瓣——一条方程就是一朵花。' },
];

const GOLDEN = 0.6180339887498949;
/** 黄金角 ≈ 137.5°（叶序螺旋的角步长）。 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const frac = (x: number) => x - Math.floor(x);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const mix3 = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** 花苞基准半径（x/z 向；y 向 ×1.3 成椭球）。 */
export const BUD_RADIUS = 0.30;

/** 花苞：泪滴形椭球点阵（斐波那契球分布 + 无理数抖动破环纹，确定性），底部收窄成泪滴。
 *  与绽放点阵按序号一一配对。 */
export function budPositions(count: number, out: Float32Array): void {
  const J = BUD_RADIUS * 0.05;
  for (let i = 0; i < count; i++) {
    const yn = 1 - 2 * ((i + 0.5) / count);
    const ring = Math.sqrt(Math.max(0, 1 - yn * yn));
    const phi = i * GOLDEN_ANGLE;
    const taper = yn < 0 ? 1 - 0.38 * -yn : 1;
    out[i * 3] = BUD_RADIUS * taper * ring * Math.cos(phi) + (frac(i * 0.7548776662) - 0.5) * 2 * J;
    out[i * 3 + 1] = BUD_RADIUS * 1.3 * yn + (frac(i * 0.579883) - 0.5) * 2 * J;
    out[i * 3 + 2] = BUD_RADIUS * taper * ring * Math.sin(phi) + (frac(i * 0.311107) - 0.5) * 2 * J;
  }
}

export type ParticleLayout = {
  count: number;
  /** 花苞位置（three 的 position 属性）。 */
  bud: Float32Array;
  /** 绽放位置。 */
  bloom: Float32Array;
  /** 错峰延迟 ∈[0,0.6]：花芯先醒，花瓣自内向外、绕序次第绽开。 */
  delay: Float32Array;
  color: Float32Array;
  size: Float32Array;
  /** 逐粒子随机相位（呼吸/闪烁用）。 */
  seed: Float32Array;
};

/** 粒子总量：花瓣 12000 + 花芯 4000。 */
export const PARTICLE_COUNT = 16000;

/** 一次性生成花型布局：花芯（叶序）+ 花瓣（玫瑰曲线方向 × 瓣内拟随机填充）。 */
export function buildLayout(species: Species, count = PARTICLE_COUNT): ParticleLayout {
  const coreCount = Math.round(count * 0.25);
  const petalCount = count - coreCount;
  const bud = new Float32Array(count * 3);
  const bloom = new Float32Array(count * 3);
  const delay = new Float32Array(count);
  const color = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const seed = new Float32Array(count);
  budPositions(count, bud);
  const coreRgb = hexToRgb(species.coreColor);
  const pRoot = hexToRgb(species.palette[0]);
  const pTip = hexToRgb(species.palette[1]);
  const white: [number, number, number] = [1, 1, 1];
  let o = 0;

  // 花芯：叶序螺旋（黄金角、r∝√i），微穹顶朝观察者。
  const coreR = Math.max(species.coreRatio, 1e-6);
  for (let i = 0; i < coreCount; i++, o++) {
    const f = (i + 0.5) / coreCount;
    const r = coreR * Math.sqrt(f);
    const a = i * GOLDEN_ANGLE;
    bloom[o * 3] = r * Math.cos(a);
    bloom[o * 3 + 1] = r * Math.sin(a);
    bloom[o * 3 + 2] = 0.10 * Math.sqrt(Math.max(0, 1 - (r / coreR) ** 2));
    const c = mix3([0.88, 0.68, 0.30], coreRgb, clamp01(r / coreR));   // 芯心深金、外缘转亮金
    color[o * 3] = c[0]; color[o * 3 + 1] = c[1]; color[o * 3 + 2] = c[2];
    delay[o] = 0.02 + 0.06 * f;
    size[o] = 1.5 + 0.8 * frac(i * GOLDEN);
    seed[o] = frac(i * GOLDEN * 1.7);
  }

  // 花瓣：按 p/P 绕序排布，瓣内用黄金比例拟随机均匀填充。
  const P = species.petals;
  const base = Math.floor(petalCount / P), extra = petalCount - base * P;
  const rootR = species.coreRatio * 0.8;
  for (let p = 0; p < P; p++) {
    const per = base + (p < extra ? 1 : 0);
    // 轻微错位更有机；数学玫瑰保持精确极坐标方程，不加偏移。
    const theta = (2 * Math.PI * p) / P + (species.rose ? 0 : 0.13 * Math.sin(p * 2.399));
    const ca = Math.cos(theta), sa = Math.sin(theta);
    const px = Math.cos(theta + Math.PI / 2), py = Math.sin(theta + Math.PI / 2);
    for (let j = 0; j < per; j++, o++) {
      // 分层均匀 + 无理数 Kronecker 抖动：u 覆盖全程 [0,1)，横向与径向互不相关。
      // 注意不能对归一化 t 再乘黄金比例——t<1 时永不回绕，瓣尖会整段缺失。
      const r1 = (j + frac(j * GOLDEN)) / per;
      const r2 = frac(j * 0.4142135623730951);   // √2-1
      const r3 = frac(j * Math.PI);
      let x: number, y: number, z: number, edge: number;
      let c: [number, number, number];
      if (species.rose) {
        // 玫瑰曲线楔形：局部角 α 内边界半径 R(α)=cos(kα)，径向均匀填充。
        const aMax = Math.PI / (2 * species.petals);
        const alpha = (r1 * 2 - 1) * aMax;
        const f = r2;
        const r = f * Math.cos(species.petals * alpha);
        const th = theta + alpha;
        x = r * Math.cos(th); y = r * Math.sin(th);
        z = species.curl * Math.sin(Math.PI * f) * 0.6;
        edge = Math.abs(alpha) / aMax;
        c = mix3(mix3(pRoot, pTip, Math.pow(f, 0.7)), white, 0.25 * edge * edge * edge);   // 波瓣边缘微亮
        delay[o] = 0.10 + 0.30 * f + 0.10 * edge + 0.04 * r3;
        size[o] = 1.5 + 0.7 * f + 0.6 * r3;
      } else {
        const u = r1;
        const halfW = species.petalWidth * Math.pow(Math.sin(Math.PI * u), 0.9);
        const v = (r2 * 2 - 1) * halfW;
        edge = halfW > 1e-6 ? Math.abs(v) / halfW : 0;
        const r = rootR + u * species.petalLength;
        x = ca * r + px * v; y = sa * r + py * v;
        z = species.curl * Math.sin(Math.PI * u) - 0.06 * u + 0.02 * Math.sin(r3 * 41);
        c = mix3(mix3(pRoot, pTip, Math.pow(u, 0.75)), white, edge * 0.25);                // 瓣缘微亮
        delay[o] = 0.12 + (0.28 * p) / P + 0.14 * u + 0.04 * r3;
        size[o] = 1.4 + 0.9 * edge + 0.6 * r3;
      }
      bloom[o * 3] = x; bloom[o * 3 + 1] = y; bloom[o * 3 + 2] = z;
      color[o * 3] = c[0]; color[o * 3 + 1] = c[1]; color[o * 3 + 2] = c[2];
      seed[o] = frac(o * GOLDEN);
    }
  }

  return { count, bud, bloom, delay, color, size, seed };
}

export type Landmark = { x: number; y: number };
const dist = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y);

/** 掌心：腕(0)、中指根(9)、小指根(17) 的平均（与平台 palmOf 同基准），输入已是镜像屏幕坐标。 */
export function palmCenter(landmarks: Landmark[]): Landmark {
  let x = 0, y = 0;
  for (const i of [0, 9, 17]) { x += landmarks[i].x; y += landmarks[i].y; }
  return { x: x / 3, y: y / 3 };
}

/** 五指张开度：四指 tip-wrist / pip-wrist 距离比（伸直 ≈1.4+，蜷曲 ≈0.8-）→
 *  线性映射 [0.80,1.28]→[0,1] 后过 smoothstep，拳与全张各留死区，中间连续可调。 */
export function spreadOf(landmarks: Landmark[]): number {
  if (landmarks.length < 21) return 0;
  const wrist = landmarks[0];
  let sum = 0;
  for (const [tip, pip] of [[8, 6], [12, 10], [16, 14], [20, 18]] as const) {
    const ext = dist(landmarks[tip], wrist) / (dist(landmarks[pip], wrist) || 1e-6);
    sum += clamp01((ext - 0.80) / 0.48);
  }
  const e = sum / 4;
  return e * e * (3 - 2 * e);
}

/** easeOutBack：绽放末段轻微过冲，产生「弹开」的活力感。 */
export function backOut(t: number, s = 1.7): number {
  const u = t - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
}

/** 绽放度平滑趋近（指数趋近，帧率无关）。 */
export function updateBloom(current: number, target: number, dt: number, rate = 2.2): number {
  const k = 1 - Math.exp(-rate * Math.max(dt, 0));
  const next = current + (target - current) * k;
  return Math.abs(next - target) < 1e-4 ? target : next;
}
