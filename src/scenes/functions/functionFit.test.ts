import { describe, it, expect } from 'vitest';
import {
  smooth, resampleUniform, fitLinear, fitQuadratic, fitSine, classify, evaluate,
  type Sample, type FunctionFamily,
} from './functionFit';

/* ===== 仿真基建：种子化 LCG + Box-Muller 高斯 + 合成轨迹 =====
 * 模拟真实手势采样的三类退化：高斯噪声（指尖抖动）、非均匀 x（扫速不匀）、丢帧（追踪丢失）。
 * 全部种子化——测试结果完全确定，可精确复现。 */

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}
type SynthOpts = { n?: number; sigma?: number; dropout?: number };
function synth(f: (x: number) => number, seed: number, opts: SynthOpts = {}): Sample[] {
  const rng = lcg(seed);
  const n = opts.n ?? 90;
  const out: Sample[] = [];
  let x = -1;
  for (let i = 0; i < n; i++) {
    x += (2 / n) * (0.4 + 1.2 * rng()); // 扫速不匀 → 非均匀 x 步长
    if (x > 1) break;
    if (rng() < (opts.dropout ?? 0)) continue; // 追踪丢帧
    const y = Math.max(-1.05, Math.min(1.05, f(x) + gaussian(rng) * (opts.sigma ?? 0)));
    out.push({ x, y });
  }
  return out;
}

/* 测试用例的函数值都保持在 ±0.85 内——对应"学生把手保持在画面内"的真实约定；
 * 出界截断（平顶）会让长周期正弦有机可乘，属 UI 层引导问题，不进精度口径。 */
const LINE_CASES = [
  { f: (x: number) => 0.8 * x + 0.1, k: 0.8, b: 0.1 },
  { f: (x: number) => -0.6 * x - 0.2, k: -0.6, b: -0.2 },
  { f: (x: number) => 0.3 * x + 0.4, k: 0.3, b: 0.4 },
  { f: (x: number) => 0.95 * x - 0.05, k: 0.95, b: -0.05 },
  { f: (x: number) => -0.9 * x, k: -0.9, b: 0 },
];
const QUAD_CASES = [
  { f: (x: number) => 0.5 * x * x, a: 0.5, b: 0, c: 0 },
  { f: (x: number) => -1.0 * x * x + 0.3, a: -1, b: 0, c: 0.3 },
  { f: (x: number) => 0.8 * x * x - 0.2 * x - 0.2, a: 0.8, b: -0.2, c: -0.2 },
  { f: (x: number) => -0.5 * x * x + 0.4 * x + 0.1, a: -0.5, b: 0.4, c: 0.1 },
  { f: (x: number) => 0.2 * x * x - 0.6, a: 0.2, b: 0, c: -0.6 },
];
const SINE_CASES = [
  { f: (x: number) => 0.5 * Math.sin(2 * Math.PI * x / 2), amp: 0.5, period: 2, mid: 0 },
  { f: (x: number) => 0.3 * Math.sin(2 * Math.PI * x / 1 + 0.7), amp: 0.3, period: 1, mid: 0 },
  { f: (x: number) => 0.6 * Math.sin(2 * Math.PI * x / 0.5), amp: 0.6, period: 0.5, mid: 0 },
  { f: (x: number) => 0.4 * Math.sin(2 * Math.PI * x / 2 + 2.1) + 0.1, amp: 0.4, period: 2, mid: 0.1 },
  { f: (x: number) => 0.35 * Math.sin(2 * Math.PI * x / 1 - 1.2) - 0.15, amp: 0.35, period: 1, mid: -0.15 },
];

/** 分族准确率：每族 5 条已知函数 × 14 个种子 = 70 条轨迹。 */
function familyAccuracy(cases: { f: (x: number) => number }[], family: FunctionFamily, sigma: number, seedsPerCase = 14): { ok: number; total: number } {
  let ok = 0, total = 0;
  for (const c of cases) {
    for (let s = 0; s < seedsPerCase; s++) {
      const fit = classify(synth(c.f, 1000 + s * 7 + Math.round(sigma * 1000), { sigma, dropout: 0.2 }));
      if (fit?.family === family) ok++;
      total++;
    }
  }
  return { ok, total };
}

describe('拟合内核 · 基础单元', () => {
  it('无噪声时三族参数精确恢复', () => {
    const grid = (f: (x: number) => number): Sample[] => Array.from({ length: 64 }, (_, i) => ({ x: -1 + (2 * i) / 63, y: f(-1 + (2 * i) / 63) }));
    const lin = fitLinear(grid(x => 0.8 * x + 0.2));
    expect(lin?.family).toBe('linear');
    expect(lin && lin.family === 'linear' ? lin.k : 0).toBeCloseTo(0.8, 6);
    expect(lin && lin.family === 'linear' ? lin.b : 0).toBeCloseTo(0.2, 6);
    const quad = fitQuadratic(grid(x => 0.5 * x * x - 0.3 * x + 0.1));
    expect(quad && quad.family === 'quadratic' ? quad.a : 0).toBeCloseTo(0.5, 6);
    expect(quad && quad.family === 'quadratic' ? quad.c : 0).toBeCloseTo(0.1, 6);
    const sine = fitSine(grid(x => 0.4 * Math.sin(2 * Math.PI * x / 2 + 0.5) + 0.1));
    expect(sine?.family).toBe('sine');
    expect(sine && sine.family === 'sine' ? sine.period : 0).toBeCloseTo(2, 2); // 周期经细化，网格外真值误差 ~0.1%
    expect(sine && sine.family === 'sine' ? sine.amp : 0).toBeCloseTo(0.4, 3);
    expect(sine && sine.family === 'sine' ? sine.mid : 0).toBeCloseTo(0.1, 3);
    expect(sine?.rmse ?? 1).toBeLessThan(1e-3);
  });
  it('均匀重采样：数量、单调 x 与线性插值', () => {
    const raw: Sample[] = [{ x: -1, y: 0 }, { x: -0.8, y: 2 }, { x: 0.6, y: 3 }, { x: 1, y: 4 }];
    const pts = resampleUniform(raw, 21);
    expect(pts.length).toBe(21);
    for (let i = 1; i < pts.length; i++) expect(pts[i].x).toBeGreaterThan(pts[i - 1].x);
    expect(pts[0].x).toBeCloseTo(-1, 9);
    expect(pts[20].x).toBeCloseTo(1, 9);
    // x=0.4 位于 [−0.8,0.6] 段内：t=(0.4+0.8)/1.4≈0.857 → y≈2+0.857
    expect(pts[14].y).toBeCloseTo(2 + (1.2 / 1.4) * 1, 3);
  });
  it('跨度太小的输入拒绝重采样；滑动平均保持常数信号', () => {
    expect(resampleUniform([{ x: 0.4, y: 1 }, { x: 0.45, y: 2 }])).toEqual([]);
    const flat = Array.from({ length: 20 }, (_, i) => ({ x: i, y: 3 }));
    expect(smooth(flat, 5).every(p => p.y === 3)).toBe(true);
  });
  it('evaluate 与各族参数一致', () => {
    expect(evaluate({ family: 'linear', k: 2, b: 1, rmse: 0 }, 3)).toBe(7);
    expect(evaluate({ family: 'quadratic', a: 1, b: 0, c: -1, rmse: 0 }, 2)).toBe(3);
    expect(evaluate({ family: 'sine', amp: 1, period: 2, phase: 0, mid: 0, rmse: 0 }, 0.5)).toBeCloseTo(1, 9);
  });
});

describe('拟合内核 · 分类与拒识', () => {
  it('横扫直线被识别为直线（简约性：不被二次/正弦抢走）', () => {
    const r = classify(synth(x => -0.6 * x - 0.2, 11, { sigma: 0.02, dropout: 0.2 }));
    expect(r?.family).toBe('linear');
  });
  it('手几乎没动（近似水平）→ 拒识', () => {
    expect(classify(synth(() => 0.4, 22, { sigma: 0.02, dropout: 0.2 }))).toBeNull();
  });
  it('乱画的涂鸦（双频拍形波，三族都装不下）→ 残差超限拒识', () => {
    // 两个接近但不同的频率相乘形成"拍"——单周期正弦/二次/直线都无法拟合。
    const scribble = (x: number) => 0.55 * Math.sin((2 * Math.PI * x) / 0.35) * Math.sin((2 * Math.PI * x) / 1.9);
    expect(classify(synth(scribble, 33, { sigma: 0.02, dropout: 0.2 }))).toBeNull();
  });
  it('半波正弦（周期=定义域两倍）与二次存在固有歧义，允许两者之一', () => {
    const r = classify(synth(x => 0.55 * Math.sin((Math.PI * x) / 2), 44, { sigma: 0.02 }));
    expect(r === null || r.family === 'sine' || r.family === 'quadratic').toBe(true);
  });
});

describe('拟合内核 · 仿真精度验收（种子化，可复现）', () => {
  it('σ=0.01 + 丢帧 20%：三族准确率 ≥ 95%', () => {
    expect(familyAccuracy(LINE_CASES, 'linear', 0.01).ok / 70).toBeGreaterThanOrEqual(0.95);
    expect(familyAccuracy(QUAD_CASES, 'quadratic', 0.01).ok / 70).toBeGreaterThanOrEqual(0.95);
    expect(familyAccuracy(SINE_CASES, 'sine', 0.01).ok / 70).toBeGreaterThanOrEqual(0.95);
  });
  it('σ=0.03（验收主档）+ 丢帧 20%：三族准确率 ≥ 90%', () => {
    expect(familyAccuracy(LINE_CASES, 'linear', 0.03).ok / 70).toBeGreaterThanOrEqual(0.9);
    expect(familyAccuracy(QUAD_CASES, 'quadratic', 0.03).ok / 70).toBeGreaterThanOrEqual(0.9);
    expect(familyAccuracy(SINE_CASES, 'sine', 0.03).ok / 70).toBeGreaterThanOrEqual(0.9);
  });
  it('σ=0.05（悲观档）+ 丢帧 20%：三族准确率 ≥ 85%', () => {
    expect(familyAccuracy(LINE_CASES, 'linear', 0.05).ok / 70).toBeGreaterThanOrEqual(0.85);
    expect(familyAccuracy(QUAD_CASES, 'quadratic', 0.05).ok / 70).toBeGreaterThanOrEqual(0.85);
    expect(familyAccuracy(SINE_CASES, 'sine', 0.05).ok / 70).toBeGreaterThanOrEqual(0.85);
  });
  it('参数恢复：σ=0.03 下 k/a 误差 ≤10%（有绝对下限），正弦周期 ≤15%', () => {
    for (const c of LINE_CASES) {
      const r = classify(synth(c.f, 777, { sigma: 0.03, dropout: 0.2 }));
      expect(r?.family).toBe('linear');
      if (r?.family === 'linear') {
        expect(Math.abs(r.k - c.k)).toBeLessThanOrEqual(Math.max(0.1 * Math.abs(c.k), 0.03));
        expect(Math.abs(r.b - c.b)).toBeLessThanOrEqual(0.06);
      }
    }
    for (const c of QUAD_CASES) {
      const r = classify(synth(c.f, 888, { sigma: 0.03, dropout: 0.2 }));
      expect(r?.family).toBe('quadratic');
      if (r?.family === 'quadratic') expect(Math.abs(r.a - c.a)).toBeLessThanOrEqual(Math.max(0.1 * Math.abs(c.a), 0.03));
    }
    for (const c of SINE_CASES) {
      const r = classify(synth(c.f, 999, { sigma: 0.03, dropout: 0.2 }));
      expect(r?.family).toBe('sine');
      if (r?.family === 'sine') {
        expect(r.period / c.period).toBeGreaterThan(0.85);
        expect(r.period / c.period).toBeLessThan(1.15);
        expect(Math.abs(r.amp - c.amp)).toBeLessThanOrEqual(Math.max(0.1 * c.amp, 0.04));
        expect(Math.abs(r.mid - c.mid)).toBeLessThanOrEqual(0.06);
      }
    }
  });
});
