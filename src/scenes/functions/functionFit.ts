/** 人体函数绘图仪 · 拟合内核：从含噪的指尖采样点识别函数类型（直线 / 抛物线 / 正弦）。
 *  纯函数、零依赖、确定性——不用任何 ML/形状识别：手扫过的轨迹本身就是函数采样，
 *  "识别" = 三族最小二乘 + 简约性惩罚 + 幅值/残差双门限拒识。
 *  精度验收见 functionFit.test.ts 的种子化仿真套件（σ=0.03 + 20% 丢帧 + 非均匀采样 ≥90%）。
 */

export type Sample = { x: number; y: number }; // 归一化坐标 [-1,1]
export type FunctionFamily = 'linear' | 'quadratic' | 'sine';
export type FunctionFit =
  | { family: 'linear'; k: number; b: number; rmse: number }
  | { family: 'quadratic'; a: number; b: number; c: number; rmse: number }
  | { family: 'sine'; amp: number; period: number; phase: number; mid: number; rmse: number };

/** 二次/正弦须以 <70% 的残差胜过更简单的族（简约性惩罚），防止噪声把直线拟合得"更像曲线"。 */
const PARSIMONY = 0.7;
/** 拟合曲线在定义域上的纵向跨度下限：跨度太小说明手几乎没动，无从谈形状。 */
const MIN_SPAN = 0.1;
/** 最优拟合残差上限：残差太大说明这不是三族之一（乱画的折线），拒识。 */
const RMSE_REJECT = 0.1;
/** 族合理性门限：二次曲率/正弦振幅低于此视为噪声拟合出的假曲线，退回更简单的族。
 *  真实手绘抛物线 |a|≥0.15、正弦 amp≥0.15；噪声拟合出的假曲线通常 <0.05。 */
const MIN_CURVATURE = 0.08;
const MIN_AMPLITUDE = 0.08;

/** 滑动平均去抖：按时间顺序对 y 做窗口平均（x 保持原值）。 */
export function smooth(samples: Sample[], window = 5): Sample[] {
  if (window < 2 || samples.length < 3) return samples;
  const half = Math.floor(window / 2);
  return samples.map((p, i) => {
    let sum = 0, cnt = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(samples.length - 1, i + half); j++) { sum += samples[j].y; cnt++; }
    return { x: p.x, y: sum / cnt };
  });
}

/** 按 x 排序去重后线性插值到均匀网格：消除扫速不匀与丢帧的影响。
 *  跨度 <0.1（手没有横扫）返回空数组。 */
export function resampleUniform(samples: Sample[], n = 64): Sample[] {
  if (samples.length < 2) return [];
  const sorted = samples
    .slice()
    .sort((p, q) => p.x - q.x)
    .filter((p, i, a) => i === 0 || p.x - a[i - 1].x > 1e-9);
  const x0 = sorted[0].x, x1 = sorted[sorted.length - 1].x;
  if (x1 - x0 < 0.1) return [];
  const out: Sample[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const x = x0 + ((x1 - x0) * i) / (n - 1);
    while (j < sorted.length - 2 && sorted[j + 1].x < x) j++;
    const p = sorted[j], q = sorted[j + 1];
    const t = q.x === p.x ? 0 : Math.max(0, Math.min(1, (x - p.x) / (q.x - p.x)));
    out.push({ x, y: p.y + (q.y - p.y) * t });
  }
  return out;
}

const rms = (pts: Sample[], f: (x: number) => number) =>
  Math.sqrt(pts.reduce((s, p) => s + (p.y - f(p.x)) ** 2, 0) / pts.length);

/** 直线 y = kx + b：闭式最小二乘。 */
export function fitLinear(pts: Sample[]): FunctionFit | null {
  const n = pts.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const p of pts) { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; }
  const d = n * sxx - sx * sx;
  if (!isFinite(d) || Math.abs(d) < 1e-9) return null;
  const k = (n * sxy - sx * sy) / d;
  const b = (sy - k * sx) / n;
  return { family: 'linear', k, b, rmse: rms(pts, x => k * x + b) };
}

/** 3×3 线性方程组：克拉默法则（行列式近零 = 退化，返回 null）。 */
function det3(m: number[][]): number {
  return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
       - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
       + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
}
function solve3(m: number[][], v: number[]): number[] | null {
  const d = det3(m);
  if (!isFinite(d) || Math.abs(d) < 1e-12) return null;
  return [0, 1, 2].map(i => det3(m.map((row, r) => row.map((c, cc) => (cc === i ? v[r] : c)))) / d);
}

/** 抛物线 y = ax² + bx + c：3×3 正规方程（x∈[-1,1]，条件数良好）。 */
export function fitQuadratic(pts: Sample[]): FunctionFit | null {
  const n = pts.length;
  if (n < 3) return null;
  let s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
  for (const p of pts) {
    const x2 = p.x * p.x;
    s1 += p.x; s2 += x2; s3 += x2 * p.x; s4 += x2 * x2;
    t0 += p.y; t1 += p.x * p.y; t2 += x2 * p.y;
  }
  const sol = solve3([[s4, s3, s2], [s3, s2, s1], [s2, s1, n]], [t2, t1, t0]);
  if (!sol) return null;
  const [a, b, c] = sol;
  return { family: 'quadratic', a, b, c, rmse: rms(pts, x => (a * x + b) * x + c) };
}

/** 正弦候选周期：定义域 [-1,1] 上 0.25–4 对数均匀 96 档（相邻档约 3%，细化后满足周期 ±15% 精度）。 */
const PERIOD_CANDIDATES: readonly number[] = Array.from({ length: 96 }, (_, i) => 0.25 * Math.pow(16, i / 95));

/** 给定周期解出最优 mid/A/B 与残差。 */
function sineAtPeriod(pts: Sample[], period: number): { mid: number; A: number; B: number; rmse: number } | null {
  const n = pts.length;
  const w = (2 * Math.PI) / period;
  let s1 = 0, c1 = 0, ss = 0, sc = 0, cc = 0, t0 = 0, sy = 0, cy = 0;
  for (const p of pts) {
    const s = Math.sin(w * p.x), c = Math.cos(w * p.x);
    s1 += s; c1 += c; ss += s * s; sc += s * c; cc += c * c;
    t0 += p.y; sy += s * p.y; cy += c * p.y;
  }
  const sol = solve3([[n, s1, c1], [s1, ss, sc], [c1, sc, cc]], [t0, sy, cy]);
  if (!sol) return null;
  const [mid, A, B] = sol;
  return { mid, A, B, rmse: rms(pts, x => mid + A * Math.sin(w * x) + B * Math.cos(w * x)) };
}

/** 正弦 y = mid + amp·sin(2πx/period + phase)：周期网格搜索 + 抛物线细化 + 每档线性最小二乘
 *  （对固定周期，y = mid + A·sin(ωx) + B·cos(ωx) 对参数是线性的，闭式可解）。 */
export function fitSine(pts: Sample[]): FunctionFit | null {
  const n = pts.length;
  if (n < 4) return null;
  let bestIdx = -1, bestR = Infinity;
  const rs: number[] = [];
  for (let i = 0; i < PERIOD_CANDIDATES.length; i++) {
    const r = sineAtPeriod(pts, PERIOD_CANDIDATES[i]);
    if (!r) { rs.push(Infinity); continue; }
    rs.push(r.rmse);
    if (r.rmse < bestR) { bestR = r.rmse; bestIdx = i; }
  }
  if (bestIdx < 0) return null;
  // 周期细化：对 (log period, rmse) 邻域三点做抛物线顶点插值，把 3% 网格精度提到 ~0.1%。
  let period = PERIOD_CANDIDATES[bestIdx];
  if (bestIdx > 0 && bestIdx < PERIOD_CANDIDATES.length - 1 && isFinite(rs[bestIdx - 1]) && isFinite(rs[bestIdx + 1])) {
    const lp = Math.log(period), lpPrev = Math.log(PERIOD_CANDIDATES[bestIdx - 1]), lpNext = Math.log(PERIOD_CANDIDATES[bestIdx + 1]);
    const denom = rs[bestIdx - 1] - 2 * rs[bestIdx] + rs[bestIdx + 1];
    if (denom > 0) {
      const delta = Math.max(-1, Math.min(1, (0.5 * (rs[bestIdx - 1] - rs[bestIdx + 1])) / denom));
      period = Math.exp(lp + delta * (lpNext - lp));
    }
  }
  const best = sineAtPeriod(pts, period);
  if (!best) return null;
  return { family: 'sine', amp: Math.hypot(best.A, best.B), period, phase: Math.atan2(best.B, best.A), mid: best.mid, rmse: best.rmse };
}

/** 拟合曲线在某点的函数值（供 UI 叠画与判题）。 */
export function evaluate(fit: FunctionFit, x: number): number {
  switch (fit.family) {
    case 'linear': return fit.k * x + fit.b;
    case 'quadratic': return (fit.a * x + fit.b) * x + fit.c;
    case 'sine': return fit.mid + fit.amp * Math.sin((2 * Math.PI * x) / fit.period + fit.phase);
  }
}

function fittedSpan(fit: FunctionFit, x0: number, x1: number): number {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i <= 32; i++) {
    const y = evaluate(fit, x0 + ((x1 - x0) * i) / 32);
    if (y < mn) mn = y;
    if (y > mx) mx = y;
  }
  return mx - mn;
}

/** 分类：滤波 → 均匀重采样 → 三族拟合 → 族合理性门限 + 简约性择优 → 双门限拒识。
 *  返回 null 表示"没认出来，请再画一次"（手没动 / 乱画折线 / 噪声过大），宁可拒识不误报。 */
export function classify(samples: Sample[]): FunctionFit | null {
  const pts = smooth(resampleUniform(samples, 64), 3);
  if (pts.length < 12) return null;
  const lin = fitLinear(pts);
  // 族合理性门限：曲率/振幅小到可忽略的"二次/正弦"是噪声拟合出来的假曲线，直接淘汰。
  let quad = fitQuadratic(pts);
  if (quad?.family === 'quadratic' && Math.abs(quad.a) < MIN_CURVATURE) quad = null;
  let sine = fitSine(pts);
  if (sine?.family === 'sine' && sine.amp < MIN_AMPLITUDE) sine = null;
  let best: FunctionFit | null = lin;
  if (quad && (!best || quad.rmse < best.rmse * PARSIMONY)) best = quad;
  if (sine && (!best || sine.rmse < best.rmse * PARSIMONY)) best = sine;
  if (!best || best.rmse > RMSE_REJECT) return null;
  if (fittedSpan(best, pts[0].x, pts[pts.length - 1].x) < MIN_SPAN) return null;
  return best;
}
