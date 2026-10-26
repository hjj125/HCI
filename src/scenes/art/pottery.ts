/** 美术·陶艺工坊内核：陶坯轮廓的塑形、度量、造型分类与彩绘数学（确定性纯函数，可单元测试）。
 *  轮廓模型：控制点列 { y, r }——y 为归一化高度（0=轮盘面），r 为归一化半径。
 *  旋转体（Lathe）天然轴对称；对称纹样由彩绘层的旋转副本实现。
 */

export type ProfilePoint = { y: number; r: number };
export type Profile = ProfilePoint[];

export const Y_MIN = 0.02, Y_MAX = 1.2, R_MIN = 0.05, R_MAX = 1;
const clampY = (y: number) => Math.max(Y_MIN, Math.min(Y_MAX, y));
const clampR = (r: number) => Math.max(R_MIN, Math.min(R_MAX, r));

/** 初始圆柱陶坯（24 环带控制点，捏塑粒度细腻）。 */
export function defaultProfile(): Profile {
  const n = 24;
  return Array.from({ length: n }, (_, i) => ({ y: 0.02 + (i * (1.0 - 0.02)) / (n - 1), r: 0.55 }));
}

/** 拉长/压缩：整体高度缩放（底不动，y 钳位）。 */
export function stretchProfile(profile: Profile, factor: number): Profile {
  return profile.map(p => ({ y: clampY(p.y * factor), r: p.r }));
}

/** 胖瘦：整体半径缩放。 */
export function scaleRadius(profile: Profile, factor: number): Profile {
  return profile.map(p => ({ y: p.y, r: clampR(p.r * factor) }));
}

/** 局部捏塑：在高度 yTarget 附近以高斯衰减改变半径（deltaR>0 外推、<0 内收）。 */
export function pinchProfile(profile: Profile, yTarget: number, deltaR: number, sigma = 0.09): Profile {
  return profile.map(p => {
    const w = Math.exp(-((p.y - yTarget) ** 2) / (2 * sigma * sigma));
    return { y: p.y, r: clampR(p.r + deltaR * w) };
  });
}

/** 轻度平滑：半径移动平均（首尾保持），抑制手部抖动的毛刺。 */
export function smoothProfile(profile: Profile, iterations = 1): Profile {
  let pts = profile;
  for (let k = 0; k < iterations; k++) {
    pts = pts.map((p, i) => (i === 0 || i === pts.length - 1 ? p : { y: p.y, r: (pts[i - 1].r + p.r * 2 + pts[i + 1].r) / 4 }));
  }
  return pts;
}

/** 控制点 → 平滑轮廓点列（Catmull-Rom 插值，每段 per 份），供 LatheGeometry 消费。 */
export function lathePoints(profile: Profile, per = 8): ProfilePoint[] {
  const pts = [...profile].sort((a, b) => a.y - b.y);
  if (pts.length < 2) return pts;
  const out: ProfilePoint[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let t = 0; t < per; t++) {
      const s = t / per, s2 = s * s, s3 = s2 * s;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * s + (2 * a - 5 * b + 4 * c - d) * s2 + (-a + 3 * b - 3 * c + d) * s3);
      out.push({ y: clampY(f(p0.y, p1.y, p2.y, p3.y)), r: clampR(Math.max(0.02, f(p0.r, p1.r, p2.r, p3.r))) });
    }
  }
  out.push({ y: pts[pts.length - 1].y, r: pts[pts.length - 1].r });
  return out;
}

export type PotMetrics = { height: number; maxR: number; maxRy: number; volume: number; aspect: number };

/** 造型度量：高度、最大半径及其相对高度、体积（Σπr̄²dy 梯形近似）、长宽比。 */
export function potMetrics(profile: Profile): PotMetrics {
  const pts = [...profile].sort((a, b) => a.y - b.y);
  const height = pts.length ? pts[pts.length - 1].y : 0;
  let maxR = 0, maxRy = 0, volume = 0;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].r >= maxR) { maxR = pts[i].r; maxRy = pts[i].y; }   // 并列时取更晚（更高）点
    if (i > 0) {
      const dy = pts[i].y - pts[i - 1].y;
      const rMid = (pts[i].r + pts[i - 1].r) / 2;
      volume += Math.PI * rMid * rMid * dy;
    }
  }
  return { height, maxR, maxRy: maxR > 0 ? maxRy / Math.max(height, 1e-9) : 0, volume, aspect: maxR > 0 ? height / (2 * maxR) : 0 };
}

export type PotShape = '碗' | '瓶' | '自由造型';

/** 造型分类：碗=宽扁且最宽处偏下；瓶=明显瘦高；其余自由造型。 */
export function classifyShape(profile: Profile): PotShape {
  const m = potMetrics(profile);
  if (m.maxRy <= 0.45 && m.aspect <= 0.85) return '碗';
  if (m.aspect >= 1.4) return '瓶';
  return '自由造型';
}

export type TexPoint = { u: number; v: number }; // u∈[0,1) 环向（接缝回绕），v∈[0,1] 高度

/** 笔迹插值：从上一命中点到当前点，按 spacing 生成盖章点列（防快速移动断线）。 */
export function strokeSegments(from: TexPoint, to: TexPoint, spacing: number): TexPoint[] {
  const du = to.u - from.u, dv = to.v - from.v;
  const steps = Math.max(1, Math.ceil(Math.hypot(du, dv) / Math.max(spacing, 1e-4)));
  const out: TexPoint[] = [];
  for (let i = 1; i <= steps; i++) {
    out.push({ u: ((from.u + (du * i) / steps) % 1 + 1) % 1, v: from.v + (dv * i) / steps });
  }
  return out;
}

/** 旋转对称副本：n 重对称时每个盖章点在环向复制 n 份（u 偏移 k/n）。 */
export function symmetricStamps(stamps: TexPoint[], n: number): TexPoint[] {
  if (n <= 1) return stamps;
  const out: TexPoint[] = [];
  for (let k = 0; k < n; k++) for (const s of stamps) out.push({ u: (s.u + k / n) % 1, v: s.v });
  return out;
}

/** 彩绘覆盖率：RGBA 像素中偏离素坯底色的像素比例。 */
export function coverageRatio(data: Uint8ClampedArray, base: [number, number, number], tolerance = 12): number {
  let painted = 0, total = 0;
  for (let i = 0; i < data.length; i += 4) {
    total++;
    if (Math.abs(data[i] - base[0]) > tolerance || Math.abs(data[i + 1] - base[1]) > tolerance || Math.abs(data[i + 2] - base[2]) > tolerance) painted++;
  }
  return total ? painted / total : 0;
}

/** 素坯底色（RGB）。 */
export const BASE_CLAY: [number, number, number] = [201, 169, 134];
