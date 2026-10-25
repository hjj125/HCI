/** 人体函数绘图仪 · 任务库、判题与表达式格式化（确定性纯函数，配合 functionFit 拟合内核）。
 *  所有目标函数值保持在 ±0.9 内——对应"画布内绘制"约定（出界截断会让长周期正弦有机可乘，
 *  见 functionFit.test.ts 的关键发现；UI 层负责引导学生把手保持在画布内）。
 */
import type { FunctionFit, FunctionFamily } from './functionFit';

/** 任务 A 目标：看虚线曲线猜族（判题 = family 相等，提交后揭晓表达式）。 */
export type TargetA = { family: FunctionFamily; zh: string; eq: string; f: (x: number) => number };
export const A_TARGETS: readonly TargetA[] = [
  { family: 'linear', zh: '一条直线', eq: 'y ≈ 0.60x + 0.15', f: x => 0.6 * x + 0.15 },
  { family: 'quadratic', zh: '一条抛物线', eq: 'y ≈ −0.60x² + 0.20', f: x => -0.6 * x * x + 0.2 },
  { family: 'sine', zh: '一段正弦波', eq: 'y ≈ 0.40·sin(3.1x)', f: x => 0.4 * Math.sin(2 * Math.PI * x / 2) },
  { family: 'linear', zh: '一条直线', eq: 'y ≈ −0.70x − 0.10', f: x => -0.7 * x - 0.1 },
  { family: 'quadratic', zh: '一条抛物线', eq: 'y ≈ 0.50x² − 0.30', f: x => 0.5 * x * x - 0.3 },
];

/** 任务 B 目标：听指令用身体画出指定形状（check = 拟合结果是否满足，含方向/开口/周期约束）。 */
export type TargetB = { zh: string; prompt: string; hint: string; ref: (x: number) => number; check: (fit: FunctionFit) => boolean };
export const B_TARGETS: readonly TargetB[] = [
  { zh: '上升的直线', prompt: '画一条「上升的直线」——从左往右越走越高。', hint: '让手指高度匀速上移，斜率要明显（k > 0.15）。', ref: x => 0.5 * x + 0.1, check: f => f.family === 'linear' && f.k > 0.15 },
  { zh: '下降的直线', prompt: '画一条「下降的直线」——从左往右越来越低。', hint: '高度匀速下降即可（k < −0.15）。', ref: x => -0.5 * x + 0.1, check: f => f.family === 'linear' && f.k < -0.15 },
  { zh: '开口向上的碗', prompt: '画一个「开口向上的碗」（抛物线）。', hint: '先高后低再高，两端翘起（a > 0.15）。', ref: x => 0.5 * x * x - 0.2, check: f => f.family === 'quadratic' && f.a > 0.15 },
  { zh: '开口向下的拱', prompt: '画一个「开口向下的拱门」（抛物线）。', hint: '中间高两端低（a < −0.15）。', ref: x => -0.5 * x * x + 0.2, check: f => f.family === 'quadratic' && f.a < -0.15 },
  { zh: '一个完整的波', prompt: '画一个「完整的波」（正弦，在画布内一起一伏）。', hint: '一起一伏是一个周期；完整的波周期不超过 2.2 个画布宽。', ref: x => 0.4 * Math.sin(2 * Math.PI * x / 2), check: f => f.family === 'sine' && f.period <= 2.2 },
];

const sgn = (v: number) => (v >= 0 ? '+ ' : '− ');
const term = (v: number, suffix: string) => (Math.abs(v) < 0.005 ? '' : ` ${sgn(v)}${Math.abs(v).toFixed(2)}${suffix}`);

/** 拟合结果 → 可读表达式（侧栏显示与学习记录导出）。 */
export function formatFit(fit: FunctionFit): string {
  const lead = (v: number) => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}`;
  switch (fit.family) {
    case 'linear': return `y ≈ ${lead(fit.k)}x${term(fit.b, '')}`;
    case 'quadratic': return `y ≈ ${lead(fit.a)}x²${term(fit.b, 'x')}${term(fit.c, '')}`;
    case 'sine': {
      const phase = Math.abs(fit.phase) < 0.01 ? '' : ` ${sgn(fit.phase)}${Math.abs(fit.phase).toFixed(2)}`;
      const mid = Math.abs(fit.mid) < 0.005 ? '' : ` ${sgn(fit.mid)}${Math.abs(fit.mid).toFixed(2)}`;
      return `y ≈ ${lead(fit.amp)}·sin(${(2 * Math.PI / fit.period).toFixed(1)}x${phase})${mid}`;
    }
  }
}
