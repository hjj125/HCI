/** 白板·笔迹稳定内核：隔空书写的输入信号稳定（确定性纯函数，可单元测试）。
 *
 *  抖动来源：MediaPipe 关键点在 ~24ms 采样间隔下的手部生理抖动（8–12Hz）与检测噪声。
 *  现有渲染已是二次曲线平滑，波浪来自信号本身，因此这里在记录层实现
 *  One Euro 自适应滤波（Casiez et al. 2012 的简化一阶形式）：
 *  低速时截止频率低（重平滑，抑制手抖）；速度越快截止频率越高（不拖尾）。
 *  鼠标路径不经过本内核（鼠标信号本身平滑，不应引入延迟）。
 */

export type Pt = { x: number; y: number };

/** 记录点最小间距（画布归一化坐标）：低于此距离的移动视为抖动，不产生新记录点。 */
export const JITTER_GATE = 0.003;
/** 低速截止频率（Hz）：越小书写越稳，但起笔越「钝」。 */
export const FC_MIN = 1.1;
/** 速度增益：截止频率随速度上升的斜率，越大快速移动越跟手。 */
export const FC_BETA = 1.4;

/** One Euro 自适应平滑一步。
 *  @param prev 上一步的滤波位置（null = 起笔，直通目标点）
 *  @param target 本帧的原始目标点
 *  @param dt 距上帧的秒数（钳制到 4ms 以上，防除零与跳变）
 *  @param minFc 低速截止频率
 *  @param beta 速度增益 */
export function stabilizePoint(prev: Pt | null, target: Pt, dt: number, minFc = FC_MIN, beta = FC_BETA): Pt {
  if (!prev) return { ...target };
  const dist = Math.hypot(target.x - prev.x, target.y - prev.y);
  const speed = dist / Math.max(dt, 0.008);
  const fc = minFc + beta * speed;
  const alpha = 1 - Math.exp((-2 * Math.PI * fc) * Math.max(dt, 0.004));
  return { x: prev.x + (target.x - prev.x) * alpha, y: prev.y + (target.y - prev.y) * alpha };
}

/** 两点间距（与 JITTER_GATE 配合做落点门限）。 */
export function moved(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
