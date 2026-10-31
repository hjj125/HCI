import { bus } from '../../core/interaction';
import { sleep } from '../../core/agent/scheduler';
import type { FunctionFamily } from './functionFit';

/** 族别 → 规范参考曲线（演示用；值域控制在画布内，与 taskLogic 的"画布内绘制"口径一致）。 */
export const FAMILY_CURVES: Record<FunctionFamily, (x: number) => number> = {
  linear: x => 0.55 * x,
  quadratic: x => 0.6 * x * x - 0.25,
  sine: x => 0.4 * Math.sin(2 * Math.PI * x / 2),
};

/** 把曲线参数化成从左到右的画布归一化点列：x 严格递增 [0,1]，数学 y → 画布 v（向下为正）。 */
export function sampleCurve(f: (x: number) => number, n = 80): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const xm = -1 + (2 * i) / n;
    const ym = Math.max(-1, Math.min(1, f(xm)));
    pts.push({ x: i / n, y: (1 - ym) / 2 });
  }
  return pts;
}

/** 把点列经总线 drag 通道流出（与鼠标/手势同一条路径，end 后场景自动识别）。
 *  cancelled() 返回 true 时发出 cancel 并中止——学生打断演示即清空笔迹。 */
export async function emitDragStroke(points: { x: number; y: number }[], stepMs = 18, cancelled?: () => boolean): Promise<void> {
  if (!points.length) return;
  bus.emit({ scene: 'functions', source: 'agent', intent: 'drag', phase: 'start', position: points[0] });
  for (let i = 1; i < points.length; i++) {
    await sleep(stepMs);
    if (cancelled?.()) { bus.emit({ scene: 'functions', source: 'agent', intent: 'drag', phase: 'cancel' }); return; }
    bus.emit({ scene: 'functions', source: 'agent', intent: 'drag', phase: 'update', position: points[i] });
  }
  await sleep(stepMs);
  bus.emit({ scene: 'functions', source: 'agent', intent: 'drag', phase: 'end' });
}
