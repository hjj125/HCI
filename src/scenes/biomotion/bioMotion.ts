/** 生物·运动系统内核：人体关键点 → 关节角度与骨骼肌协作状态（确定性纯函数，可单元测试）。
 *  关键点布局遵循 MediaPipe Pose（33 点，镜像归一化坐标，visibility ∈ [0,1]）。
 *  肌肉模型为教学简化：屈肘=二头收缩/三头舒张，伸肘相反，强度随肘角线性互补。
 */
import { angleAt } from '../bodyangle/bodyAngle';

export type PosePoint = { x: number; y: number; z?: number; visibility: number };

/** MediaPipe Pose 关键点索引（上肢为主）。 */
export const POSE = {
  NOSE: 0, LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12, LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
  LEFT_WRIST: 15, RIGHT_WRIST: 16, LEFT_HIP: 23, RIGHT_HIP: 24,
} as const;

/** 骨骼连接对（骨架叠加绘制用，上肢+躯干）。 */
export const BONES: readonly [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [11, 0], [12, 0],
];

/** 单侧手臂肘关节角度（顶点=肘，两边=肩、腕）；可见性不足返回 null。 */
export function elbowAngle(landmarks: PosePoint[], side: 'left' | 'right'): number | null {
  const s = side === 'left' ? POSE.LEFT_SHOULDER : POSE.RIGHT_SHOULDER;
  const e = side === 'left' ? POSE.LEFT_ELBOW : POSE.RIGHT_ELBOW;
  const w = side === 'left' ? POSE.LEFT_WRIST : POSE.RIGHT_WRIST;
  if (!landmarks || landmarks.length <= Math.max(s, e, w)) return null;
  const vis = Math.min(landmarks[s].visibility, landmarks[e].visibility, landmarks[w].visibility);
  if (vis < 0.5) return null;
  return angleAt(landmarks[s], landmarks[e], landmarks[w]);
}

/** 自动选可见性较好的一侧手臂。 */
export function bestElbowAngle(landmarks: PosePoint[]): { deg: number; side: 'left' | 'right' } | null {
  const left = elbowAngle(landmarks, 'left');
  const right = elbowAngle(landmarks, 'right');
  if (left == null && right == null) return null;
  if (left == null) return { deg: right!, side: 'right' };
  if (right == null) return { deg: left, side: 'left' };
  // 两侧都可见：选角度更小（更接近屈肘，动作意图更明确）的一侧。
  return left <= right ? { deg: left, side: 'left' } : { deg: right, side: 'right' };
}

export type FlexState = '屈肘' | '半屈' | '伸肘';

/** 屈伸状态判定：≤100° 屈肘，≥160° 伸肘，中间半屈。 */
export function flexState(elbowDeg: number): FlexState {
  if (elbowDeg <= 100) return '屈肘';
  if (elbowDeg >= 160) return '伸肘';
  return '半屈';
}

/** 骨骼肌协作（教学模型）：二头肌收缩强度 = (160−肘角)/100 截断 [0,1]，三头肌互补。
 *  屈肘（60°）→ 二头 1.0/三头 0.0；伸肘（160°+）→ 二头 0.0/三头 1.0。 */
export function musclePair(elbowDeg: number): { biceps: number; triceps: number; note: string } {
  const biceps = Math.max(0, Math.min(1, (160 - elbowDeg) / 100));
  const triceps = 1 - biceps;
  const note = elbowDeg <= 100 ? '肱二头肌收缩，肱三头肌舒张'
    : elbowDeg >= 160 ? '肱三头肌收缩，肱二头肌舒张'
      : '两肌协调过渡中';
  return { biceps, triceps, note };
}

/** 取景判定：肩/肘/腕可见性是否足以支撑上肢测量。 */
export function upperBodyVisible(landmarks: PosePoint[], min = 0.5): boolean {
  if (!landmarks || landmarks.length < 25) return false;
  const keys = [POSE.LEFT_SHOULDER, POSE.RIGHT_SHOULDER];
  const arms = [POSE.LEFT_ELBOW, POSE.RIGHT_ELBOW, POSE.LEFT_WRIST, POSE.RIGHT_WRIST];
  const shouldersOk = keys.every(i => landmarks[i].visibility >= min);
  const anyArmOk = arms.some(i => landmarks[i].visibility >= min);
  return shouldersOk && anyArmOk;
}
