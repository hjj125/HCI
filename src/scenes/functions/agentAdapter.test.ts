import { afterEach, describe, expect, it, vi } from 'vitest';
import { bus } from '../../core/interaction';
import { emitDragStroke, FAMILY_CURVES, sampleCurve } from './agentAdapter';

describe('灵犀函数演示 · 曲线采样', () => {
  it('sampleCurve：x 严格递增、首尾为 0/1、y 为数学值到画布 v 的映射', () => {
    const pts = sampleCurve(x => 0.5 * x, 10);
    expect(pts).toHaveLength(11);
    expect(pts[0].x).toBe(0);
    expect(pts[10].x).toBe(1);
    for (let i = 1; i < pts.length; i++) expect(pts[i].x).toBeGreaterThan(pts[i - 1].x);
    expect(pts[0].y).toBeCloseTo(0.75); // f(-1) = -0.5 → v = (1-(-0.5))/2
    expect(pts[10].y).toBeCloseTo(0.25);
  });

  it('族别参考曲线值域都在画布内（|y|≤1，符合"画布内绘制"口径）', () => {
    for (const f of Object.values(FAMILY_CURVES)) {
      for (let i = 0; i <= 20; i++) expect(Math.abs(f(-1 + (2 * i) / 20))).toBeLessThanOrEqual(1);
    }
  });
});

describe('灵犀函数演示 · 统一 drag 通道流出', () => {
  afterEach(() => vi.restoreAllMocks());

  it('start → 逐点 update → end；事件属于 functions 场景的 agent 源', async () => {
    const emit = vi.spyOn(bus, 'emit').mockImplementation(() => {});
    const pts = sampleCurve(x => 0.55 * x, 5);
    await emitDragStroke(pts, 1);
    const kinds = emit.mock.calls.map(c => (c[0] as { phase: string }).phase);
    expect(kinds[0]).toBe('start');
    expect(kinds[kinds.length - 1]).toBe('end');
    expect(kinds.filter(p => p === 'update')).toHaveLength(5);
    expect(emit.mock.calls[0][0]).toMatchObject({ scene: 'functions', source: 'agent', intent: 'drag', position: pts[0] });
  });

  it('学生打断 → 发出 cancel、不再发 end（场景会清空笔迹）', async () => {
    const emit = vi.spyOn(bus, 'emit').mockImplementation(() => {});
    const pts = sampleCurve(x => 0, 8);
    let n = 0;
    await emitDragStroke(pts, 1, () => ++n > 2);
    const kinds = emit.mock.calls.map(c => (c[0] as { phase: string }).phase);
    expect(kinds).toContain('cancel');
    expect(kinds).not.toContain('end');
  });
});
