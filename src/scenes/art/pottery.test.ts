import { describe, it, expect } from 'vitest';
import {
  defaultProfile, stretchProfile, scaleRadius, pinchProfile, smoothProfile, lathePoints,
  potMetrics, classifyShape, strokeSegments, symmetricStamps, coverageRatio, Y_MAX, R_MAX,
} from './pottery';

describe('陶艺内核 · 塑形操作', () => {
  it('初始陶坯：y 升序、半径在界内', () => {
    const p = defaultProfile();
    expect(p.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < p.length; i++) expect(p[i].y).toBeGreaterThan(p[i - 1].y);
    for (const q of p) { expect(q.r).toBeGreaterThan(0); expect(q.r).toBeLessThanOrEqual(R_MAX); }
  });
  it('拉长/压缩：高度整体缩放且被钳位', () => {
    const stretched = stretchProfile(defaultProfile(), 1.2);
    expect(stretched[stretched.length - 1].y).toBeCloseTo(Y_MAX, 9);  // 1.0×1.2=1.2 顶格
    const squashed = stretchProfile(defaultProfile(), 0.5);
    expect(squashed[squashed.length - 1].y).toBeCloseTo(0.5, 9);
    expect(squashed[0].r).toBeCloseTo(0.55, 9);                        // 半径不变
  });
  it('胖瘦：半径整体缩放且被钳位', () => {
    const fat = scaleRadius(defaultProfile(), 3);
    expect(fat.every(p => p.r <= R_MAX)).toBe(true);
    expect(fat[0].r).toBeCloseTo(R_MAX, 9);
    const thin = scaleRadius(defaultProfile(), 0.5);
    expect(thin[0].r).toBeCloseTo(0.275, 9);
  });
  it('局部捏塑：目标高度附近生效，远处不变；平滑抑制毛刺', () => {
    const base = defaultProfile();
    const pinched = pinchProfile(base, 0.5, 0.3, 0.09);
    const nearest = pinched.reduce((a, b) => (Math.abs(b.y - 0.5) < Math.abs(a.y - 0.5) ? b : a));
    expect(nearest.r).toBeGreaterThan(0.62);            // 最近环带明显隆起
    expect(nearest.r).toBeLessThan(0.86);               // 高斯权重 <1
    const far = pinched[0];
    expect(far.r).toBeLessThan(0.5601);                 // 底部几乎不变
    const bumpy = [{ y: 0.1, r: 0.5 }, { y: 0.4, r: 0.8 }, { y: 0.7, r: 0.5 }];
    expect(smoothProfile(bumpy)[1].r).toBeCloseTo((0.5 + 0.8 * 2 + 0.5) / 4, 9);
  });
  it('lathePoints：数量与高度单调不减', () => {
    const pts = lathePoints(defaultProfile(), 8);
    expect(pts.length).toBe((defaultProfile().length - 1) * 8 + 1);
    for (let i = 1; i < pts.length; i++) expect(pts[i].y).toBeGreaterThanOrEqual(pts[i - 1].y - 1e-9);
    for (const p of pts) expect(p.r).toBeGreaterThanOrEqual(0.02);
  });
});

describe('陶艺内核 · 度量与造型分类', () => {
  it('圆柱坯体积 ≈ πr²h，长宽比 = 1', () => {
    const m = potMetrics(defaultProfile());   // r=0.55, h=1.0（含底 0.02）
    expect(m.volume).toBeCloseTo(Math.PI * 0.55 * 0.55 * 0.98, 1);
    expect(m.aspect).toBeCloseTo(1 / (2 * 0.55), 6);
    expect(m.maxRy).toBeCloseTo(1, 6);        // 圆柱最宽处在顶
  });
  it('分类：宽碗 / 高瓶 / 自由造型', () => {
    const bowl = [{ y: 0.02, r: 0.9 }, { y: 0.3, r: 0.85 }, { y: 0.4, r: 0.4 }];
    expect(classifyShape(bowl)).toBe('碗');
    const vase = [{ y: 0.02, r: 0.3 }, { y: 0.5, r: 0.35 }, { y: 1.1, r: 0.3 }];
    expect(classifyShape(vase)).toBe('瓶');
    expect(classifyShape(defaultProfile())).toBe('自由造型');
  });
});

describe('陶艺内核 · 彩绘数学', () => {
  it('笔迹插值：按间距生成中间盖章点', () => {
    const stamps = strokeSegments({ u: 0.1, v: 0.5 }, { u: 0.2, v: 0.5 }, 0.02);
    expect(stamps.length).toBe(5);
    expect(stamps[0].u).toBeCloseTo(0.12, 9);
    expect(stamps[4].u).toBeCloseTo(0.2, 9);
  });
  it('四重对称：每个点复制 4 份并均匀偏移', () => {
    const stamps = symmetricStamps([{ u: 0.1, v: 0.5 }], 4);
    expect(stamps.map(s => s.u).sort((a, b) => a - b)).toEqual([0.1, 0.35, 0.6, 0.85]);
    expect(stamps.every(s => s.v === 0.5)).toBe(true);
    expect(stamps.length).toBe(4);
  });
  it('自由模式（n=1）不复制', () => {
    expect(symmetricStamps([{ u: 0.3, v: 0.7 }], 1).length).toBe(1);
  });
  it('覆盖率：素坯底色为 0，全彩为 1', () => {
    const w = 2, h = 2;
    const blank = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < blank.length; i += 4) blank.set([201, 169, 134, 255], i);
    expect(coverageRatio(blank, [201, 169, 134])).toBe(0);
    const painted = new Uint8ClampedArray(blank);
    painted.set([30, 75, 143, 255], 0);   // 一个像素画了青花
    expect(coverageRatio(painted, [201, 169, 134])).toBeCloseTo(0.25, 9);
  });
});
