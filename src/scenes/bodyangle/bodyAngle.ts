/** 身体量角器内核：手部关键点 → 角度测量（确定性纯函数，可单元测试）。
 *  双手角：两手各伸食指，顶点取两腕连线中点（0–180°）；
 *  虎口角：单手拇指-拇指掌根-食指尖张角（约 0–90°，小角测量仪）。
 *  测量天然有噪声 → stabilize 稳定窗口取中位数锁定；判题用宽容差，"误差"本身是教学点。
 */
export type Pt = { x: number; y: number };

export const WRIST = 0, THUMB_MCP = 2, THUMB_TIP = 4, INDEX_TIP = 8;

/** b 为顶点的三点夹角（度，[0,180]）。 */
export function angleAt(a: Pt, b: Pt, c: Pt): number {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const m1 = Math.hypot(v1.x, v1.y), m2 = Math.hypot(v2.x, v2.y);
  if (m1 === 0 || m2 === 0) return 0;
  const cos = (v1.x * v2.x + v1.y * v2.y) / (m1 * m2);
  return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
}

/** 双手角（度）：需要两手同时入镜。 */
export function twoHandAngle(landmarks: Pt[][]): number | null {
  if (!landmarks || landmarks.length < 2) return null;
  const [h1, h2] = landmarks;
  const vertex = { x: (h1[WRIST].x + h2[WRIST].x) / 2, y: (h1[WRIST].y + h2[WRIST].y) / 2 };
  return angleAt(h1[INDEX_TIP], vertex, h2[INDEX_TIP]);
}

/** 虎口角（度）：单手拇指与食指的张角。 */
export function thumbIndexAngle(landmarks: Pt[]): number | null {
  if (!landmarks || !landmarks.length) return null;
  return angleAt(landmarks[THUMB_TIP], landmarks[THUMB_MCP], landmarks[INDEX_TIP]);
}

export type AngleClass = '锐角' | '直角' | '钝角' | '平角';

/** 分类（直角/平角按 ±3° 边界带判定，兼容测量噪声）。 */
export function classifyAngle(deg: number): AngleClass {
  if (Math.abs(deg - 180) <= 3) return '平角';
  if (Math.abs(deg - 90) <= 3) return '直角';
  return deg < 90 ? '锐角' : '钝角';
}

/** 判题：读数是否落在目标 ±tol 内。 */
export function isWithin(deg: number, target: number, tol: number): boolean {
  return Math.abs(deg - target) <= tol;
}

/** 稳定窗口：最近 window 个读数极差 < tol → 返回中位数（可锁定），否则 null。 */
export function stabilize(samples: number[], tol: number, window = 10): number | null {
  if (samples.length < window) return null;
  const recent = samples.slice(-window);
  if (Math.max(...recent) - Math.min(...recent) >= tol) return null;
  const sorted = [...recent].sort((a, b) => a - b);
  return window % 2 ? sorted[(window - 1) / 2] : (sorted[window / 2 - 1] + sorted[window / 2]) / 2;
}
