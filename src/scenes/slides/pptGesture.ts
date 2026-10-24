export type SwipeDirection = 'left' | 'right';

/** 手部轨迹中的一点：归一化屏幕坐标 + 毫秒时间戳。 */
export type SwipePoint = { x: number; y?: number; time: number };

export type SwipeOptions = { pinching?: boolean };

/**
 * 判定一次“挥手”：足够快、足够远、方向一致，且没有明显的上下位移。
 * 挥手直接翻页，所以宁可漏判也不要误判——课堂上误翻一页比多挥一次更烦。
 * 距离阈值取屏幕宽度的 18%：后台识别约每 100ms 采样一次，配合轨迹平滑后
 * 测得的位移会略小于真实手部位移，留一点余量才能让随手一挥就被识别。
 */
export function detectSwipe(points: SwipePoint[], minDistance = 0.18, maxDuration = 700, maxVertical = 0.18): SwipeDirection | null {
  if (points.length < 3) return null;
  const first = points[0], last = points[points.length - 1];
  const duration = last.time - first.time, dx = last.x - first.x;
  if (duration < 80 || duration > maxDuration || Math.abs(dx) < minDistance) return null;
  // 抬手、放下这类竖直动作不应当翻页。
  if (first.y !== undefined && last.y !== undefined && Math.abs(last.y - first.y) > maxVertical) return null;
  const direction: SwipeDirection = dx > 0 ? 'right' : 'left';
  // 要求绝大部分位移朝同一方向：来回摆动、抖动都不能算挥手。
  let aligned = 0, opposed = 0, reversals = 0;
  for (let i = 1; i < points.length; i++) {
    const step = points[i].x - points[i - 1].x;
    if (Math.abs(step) < 0.006) continue;
    if (Math.sign(step) === Math.sign(dx)) aligned += Math.abs(step);
    else { opposed += Math.abs(step); reversals++; }
  }
  const total = aligned + opposed;
  if (!aligned || !total) return null;
  if (reversals > Math.ceil(points.length * 0.35)) return null;
  if (aligned / total < 0.85) return null;
  return direction;
}

/**
 * 从连续手部采样中识别挥手。
 * - 捏合“开始”时清空轨迹，并让随后一小段时间不判定，避免“伸手去点按钮”的移动被当成挥手；
 * - 持续捏合中不再逐帧清空：自然放松的手型（拇指贴近食指）也应当能挥手翻页；
 * - 识别成功后进入冷却，一次挥手最多翻一页。
 */
export class SwipeDetector {
  private buffer: { x: number; y: number; time: number }[] = [];
  private cooldownUntil = 0;
  private wasPinching = false;
  constructor(
    private readonly windowMs = 700,
    private readonly cooldownMs = 900,
    private readonly pinchCooldownMs = 300,
  ) {}

  reset() { this.buffer.length = 0; this.wasPinching = false; }

  push(x: number, y: number, time: number, { pinching = false }: SwipeOptions = {}): SwipeDirection | null {
    if (pinching) {
      if (!this.wasPinching) {
        this.buffer.length = 0;
        this.cooldownUntil = Math.max(this.cooldownUntil, time + this.pinchCooldownMs);
      }
      this.wasPinching = true;
    } else {
      this.wasPinching = false;
    }
    if (time < this.cooldownUntil) { this.buffer.length = 0; return null; }
    this.buffer.push({ x, y, time });
    while (this.buffer.length && time - this.buffer[0].time > this.windowMs) this.buffer.shift();
    const direction = detectSwipe(this.buffer);
    if (direction) {
      this.buffer.length = 0;
      this.cooldownUntil = time + this.cooldownMs;
    }
    return direction;
  }
}

export type VSwipeDirection = 'up' | 'down';

/**
 * 判定一次“竖直挥手”：快速、足够远、方向一致的上下移动，水平位移受限。
 * 与横向挥手判定器相互独立：斜向移动两者都不触发。
 */
export function detectVerticalSwipe(points: SwipePoint[], minDistance = 0.15, maxDuration = 700, maxHorizontal = 0.15): VSwipeDirection | null {
  if (points.length < 3) return null;
  const first = points[0], last = points[points.length - 1];
  if (first.y === undefined || last.y === undefined) return null;
  const duration = last.time - first.time, dy = last.y - first.y;
  if (duration < 80 || duration > maxDuration || Math.abs(dy) < minDistance) return null;
  if (first.x !== undefined && last.x !== undefined && Math.abs(last.x - first.x) > maxHorizontal) return null;
  const direction: VSwipeDirection = dy > 0 ? 'down' : 'up'; // 屏幕坐标 y 向下为正
  let aligned = 0, opposed = 0, reversals = 0;
  for (let i = 1; i < points.length; i++) {
    const yA = points[i - 1].y, yB = points[i].y;
    if (yA === undefined || yB === undefined) continue;
    const step = yB - yA;
    if (Math.abs(step) < 0.006) continue;
    if (Math.sign(step) === Math.sign(dy)) aligned += Math.abs(step);
    else { opposed += Math.abs(step); reversals++; }
  }
  const total = aligned + opposed;
  if (!aligned || !total) return null;
  if (reversals > Math.ceil(points.length * 0.35)) return null;
  if (aligned / total < 0.85) return null;
  return direction;
}

/** 从连续采样中识别竖直挥手（冷却与捏合静默规则与横向一致）。 */
export class VerticalSwipeDetector {
  private buffer: { x: number; y: number; time: number }[] = [];
  private cooldownUntil = 0;
  private wasPinching = false;
  constructor(
    private readonly windowMs = 700,
    private readonly cooldownMs = 900,
    private readonly pinchCooldownMs = 300,
  ) {}
  reset() { this.buffer.length = 0; this.wasPinching = false; }
  push(x: number, y: number, time: number, { pinching = false }: SwipeOptions = {}): VSwipeDirection | null {
    if (pinching) {
      this.buffer.length = 0;
      this.cooldownUntil = Math.max(this.cooldownUntil, time + this.pinchCooldownMs);
      return null;
    }
    if (time < this.cooldownUntil) { this.buffer.length = 0; return null; }
    this.buffer.push({ x, y, time });
    while (this.buffer.length && time - this.buffer[0].time > this.windowMs) this.buffer.shift();
    const direction = detectVerticalSwipe(this.buffer);
    if (direction) {
      this.buffer.length = 0;
      this.cooldownUntil = time + this.cooldownMs;
    }
    return direction;
  }
}
