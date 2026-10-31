import { describe, it, expect } from 'vitest';
import { stabilizePoint, moved, JITTER_GATE, type Pt } from './stabilize';

const DT = 0.024;   // 手部采样间隔 ~24ms

/** 合成信号：沿 y=0.5 的水平直线从 x=0.2 写到 x=0.8（dt 移动 0.4/帧数），
 *  叠加 10Hz 正弦手抖（幅值 amp，法向）。 */
function jitteredLine(frames: number, amp: number) {
  const out: Pt[] = [];
  for (let i = 0; i < frames; i++) {
    out.push({ x: 0.2 + (0.6 * i) / (frames - 1), y: 0.5 + amp * Math.sin((i * 10 * 2 * Math.PI) / 40) });
  }
  return out;
}

describe('白板稳定内核 · 自适应平滑', () => {
  it('起笔首点直通原始位置（不偏移起笔点）', () => {
    const p = stabilizePoint(null, { x: 0.3, y: 0.4 }, DT);
    expect(p).toEqual({ x: 0.3, y: 0.4 });
  });
  it('慢速书写：抖动显著衰减（滤波后最大偏差 < 原始的 40%）', () => {
    const raw = jitteredLine(40, 0.006);           // 手抖幅值 0.6% 画布高
    let prev: Pt | null = null;
    const filtered: Pt[] = [];
    for (const t of raw) { prev = stabilizePoint(prev, t, DT); filtered.push(prev); }
    const dev = (pts: Pt[]) => Math.max(...pts.map(p => Math.abs(p.y - 0.5)));
    expect(dev(filtered)).toBeLessThan(dev(raw) * 0.4);
    // 端点仍然跟随到线的两端（不丢起止位置）
    expect(Math.hypot(filtered[filtered.length - 1].x - raw[raw.length - 1].x, filtered[filtered.length - 1].y - raw[raw.length - 1].y)).toBeLessThan(0.05);
  });
  it('快速移动：轻平滑跟手（单帧滞后有界）', () => {
    let prev: Pt | null = null;
    let target = { x: 0.2, y: 0.5 };
    let maxLag = 0;
    for (let i = 0; i < 30; i++) {                 // 快速横移：每帧 0.02（≈0.85 单位/秒）
      target = { x: target.x + 0.02, y: 0.5 };
      prev = stabilizePoint(prev, target, DT);
      if (i > 4) maxLag = Math.max(maxLag, Math.hypot(target.x - prev.x, target.y - prev.y));
    }
    expect(maxLag).toBeLessThan(0.07);
  });
  it('停笔收敛：目标不动时滤波点收敛到目标', () => {
    let prev: Pt | null = { x: 0.2, y: 0.5 };
    const target = { x: 0.35, y: 0.5 };
    for (let i = 0; i < 80; i++) prev = stabilizePoint(prev, target, DT);
    expect(Math.hypot(prev.x - target.x, prev.y - target.y)).toBeLessThan(1e-3);
  });
  it('dt 异常值受保护（0/负值不产生除零与跳变）', () => {
    const prev = { x: 0.3, y: 0.5 };
    const p = stabilizePoint(prev, { x: 0.32, y: 0.5 }, 0);
    expect(Number.isFinite(p.x)).toBe(true);
    expect(p.x).toBeGreaterThan(prev.x);           // 仍向目标平滑靠近
  });
});

describe('白板稳定内核 · 落点门限', () => {
  it('门限常数在亚像素量级（不吞正常笔迹细节）', () => {
    expect(JITTER_GATE).toBeGreaterThan(0.001);
    expect(JITTER_GATE).toBeLessThan(0.008);
  });
  it('moved：门限内抖动不落点，门限外正常记录', () => {
    const a = { x: 0.5, y: 0.5 };
    const jitter = { x: 0.5 + 0.001, y: 0.5 };     // < JITTER_GATE
    const real = { x: 0.5 + 0.01, y: 0.5 };        // > JITTER_GATE
    expect(moved(a, jitter)).toBeLessThan(JITTER_GATE);
    expect(moved(a, real)).toBeGreaterThan(JITTER_GATE);
  });
  it('滤波 + 门限串联：记录点构成的笔迹不再波浪', () => {
    const raw = jitteredLine(40, 0.006);
    let prev: Pt | null = null;
    let last: Pt | null = null;
    let recorded = 0;
    const recordedPts: Pt[] = [];
    for (const t of raw) {
      prev = stabilizePoint(prev, t, DT);
      if (!last || moved(last, prev) >= JITTER_GATE) { last = prev; recorded++; recordedPts.push(prev); }
    }
    // 用户看到的是「记录点连成的线」：其法向波浪必须显著小于原始抖动
    const dev = (pts: Pt[]) => Math.max(...pts.map(p => Math.abs(p.y - 0.5)));
    expect(dev(recordedPts)).toBeLessThan(dev(raw) * 0.4);
    expect(recorded).toBeGreaterThan(5);           // 仍保留笔迹形状
  });
});
