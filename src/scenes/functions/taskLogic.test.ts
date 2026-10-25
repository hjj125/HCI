import { describe, it, expect } from 'vitest';
import { A_TARGETS, B_TARGETS, formatFit } from './taskLogic';
import type { FunctionFit } from './functionFit';

const lin = (k: number, b: number): FunctionFit => ({ family: 'linear', k, b, rmse: 0.01 });
const quad = (a: number, b = 0, c = 0): FunctionFit => ({ family: 'quadratic', a, b, c, rmse: 0.01 });
const sine = (amp: number, period: number, phase = 0, mid = 0): FunctionFit => ({ family: 'sine', amp, period, phase, mid, rmse: 0.01 });

describe('任务库 · 目标函数与判题', () => {
  it('任务 A 目标曲线全程保持在画布内（|y| ≤ 0.9）', () => {
    for (const t of A_TARGETS) {
      expect(t.family).toMatch(/linear|quadratic|sine/);
      for (let i = 0; i <= 40; i++) expect(Math.abs(t.f(-1 + (2 * i) / 40))).toBeLessThanOrEqual(0.9);
    }
  });
  it('任务 B 目标参考曲线同样保持在画布内', () => {
    for (const t of B_TARGETS) for (let i = 0; i <= 40; i++) expect(Math.abs(t.ref(-1 + (2 * i) / 40))).toBeLessThanOrEqual(0.9);
  });
  it('判题：上升/下降直线按斜率符号与幅度判定', () => {
    expect(B_TARGETS[0].check(lin(0.5, 0.1))).toBe(true);
    expect(B_TARGETS[0].check(lin(0.1, 0.1))).toBe(false);   // 斜率太小
    expect(B_TARGETS[0].check(lin(-0.5, 0.1))).toBe(false);  // 方向反了
    expect(B_TARGETS[0].check(sine(0.4, 2))).toBe(false);    // 族不对
    expect(B_TARGETS[1].check(lin(-0.5, 0.1))).toBe(true);
  });
  it('判题：抛物线按开口方向判定', () => {
    expect(B_TARGETS[2].check(quad(0.5))).toBe(true);
    expect(B_TARGETS[2].check(quad(-0.5))).toBe(false);
    expect(B_TARGETS[2].check(lin(0.5, 0))).toBe(false);
    expect(B_TARGETS[3].check(quad(-0.5))).toBe(true);
    expect(B_TARGETS[3].check(quad(0.5))).toBe(false);
  });
  it('判题：完整的波按族与周期上限判定', () => {
    expect(B_TARGETS[4].check(sine(0.4, 2))).toBe(true);
    expect(B_TARGETS[4].check(sine(0.4, 1))).toBe(true);
    expect(B_TARGETS[4].check(sine(0.4, 3))).toBe(false);   // 半个波都不到
    expect(B_TARGETS[4].check(quad(-0.5))).toBe(false);
  });
  it('表达式格式化：系数符号、零项省略与正弦角频率', () => {
    expect(formatFit(lin(0.8, 0.1))).toBe('y ≈ 0.80x + 0.10');
    expect(formatFit(lin(-0.6, -0.2))).toBe('y ≈ −0.60x − 0.20');
    expect(formatFit(lin(1, 0))).toBe('y ≈ 1.00x');
    expect(formatFit(quad(0.5, 0, -0.3))).toBe('y ≈ 0.50x² − 0.30');
    expect(formatFit(quad(-0.7, 0.4, 0.1))).toBe('y ≈ −0.70x² + 0.40x + 0.10');
    expect(formatFit(sine(0.4, 2))).toBe('y ≈ 0.40·sin(3.1x)');
    expect(formatFit(sine(0.4, 2, 0.5, 0.1))).toBe('y ≈ 0.40·sin(3.1x + 0.50) + 0.10');
  });
});
