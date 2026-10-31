import { describe, expect, it } from 'vitest';
import { fixProfileToward } from './shapeFix';
import { classifyShape, defaultProfile, potMetrics } from './pottery';

/** 判据与 PotteryScene 的 B_TARGETS 对齐（瓶 aspect≥1.4；碗 aspect≤0.85 且最宽处偏下 maxRy≤0.45）。 */
const bottleDone = (m: ReturnType<typeof potMetrics>) => m.aspect >= 1.4;
const bowlDone = (m: ReturnType<typeof potMetrics>) => m.aspect <= 0.85 && m.maxRy <= 0.45;

describe('灵犀修坯策略（shapeFix）', () => {
  it('修成瓶：从默认圆柱迭代到 aspect≥1.4，控制点数不变', () => {
    const from = defaultProfile();
    const to = fixProfileToward(from, 'taller-thinner', bottleDone);
    expect(to).toHaveLength(from.length);
    expect(bottleDone(potMetrics(to))).toBe(true);
    // 方向正确：比初始更瘦高
    const m0 = potMetrics(from), m1 = potMetrics(to);
    expect(m1.aspect).toBeGreaterThan(m0.aspect);
    expect(m1.maxR).toBeLessThan(m0.maxR);
  });

  it('修成碗：压矮 + 下宽上窄梯度，最宽处落到下部（maxRy≤0.45）——这是均匀放大做不到的', () => {
    const from = defaultProfile();
    const to = fixProfileToward(from, 'flatter-wider', bowlDone);
    const m = potMetrics(to);
    expect(bowlDone(m)).toBe(true);
    expect(classifyShape(to)).toBe('碗');
    // 碗形特征：底部半径大于顶部半径
    const sorted = [...to].sort((a, b) => a.y - b.y);
    expect(sorted[0].r).toBeGreaterThan(sorted[sorted.length - 1].r);
  });

  it('已达标 → 原样返回（不多动一下）', () => {
    const from = fixProfileToward(defaultProfile(), 'taller-thinner', bottleDone);
    const again = fixProfileToward(from, 'taller-thinner', bottleDone);
    expect(again.map(p => p.y)).toEqual(from.map(p => p.y));
    expect(again.map(p => p.r)).toEqual(from.map(p => p.r));
  });
});
