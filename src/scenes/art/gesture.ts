/** BloomVerse · 手势引擎：原始手部关键点 → 驾驶状态（纯逻辑，确定性，可单元测试）。
 *
 *  手势集与优先级（高→低）：
 *    F 双手展开花海  >  D 双指捏合缩放（锁定绽放度）  >  E 快速挥手花瓣风暴（瞬时事件）
 *    >  B/A 五指开合连续绽放  +  C 手掌横移旋转（并行）。
 *  稳定性：掌心/张开度 EMA 平滑、捏合与风暴带迟滞阈值与冷却、手丢失自然过渡到空闲呼吸。
 */

import { palmCenter, spreadOf, type Landmark } from './bloom';

export type DriveGesture = 'idle' | 'bloom' | 'pinch' | 'spin' | 'storm' | 'sea';

export type StormEvent = { dirX: number; dirY: number; power: number };

export type DriveState = {
  /** 手是否在画面（去抖后）。 */
  present: boolean;
  handCount: number;
  /** 连续绽放目标 0..1（捏合期间锁定）。 */
  bloomTarget: number;
  /** 缩放目标（捏合控制，0.55..1.6）。 */
  scaleTarget: number;
  /** 旋转角速度目标 rad/s（横移惯性）。 */
  spinTarget: number;
  /** 双手花海。 */
  sea: boolean;
  seaRadius: number;
  /** 平滑后的主手掌心（镜像归一化屏幕坐标）。 */
  handX: number;
  handY: number;
  /** 当前手势标签（迟滞后，供 UI 提示）。 */
  gesture: DriveGesture;
  /** 风暴事件队列（边沿触发，视图消费后清空）。 */
  stormQueue: StormEvent[];
};

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const dist = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y);
/** 拇指-食指捏合距离 / 掌长：捏紧 ≈0.15，张开 ≈1.1+。 */
function pinchRatio(lm: Landmark[]): number {
  const palm = dist(lm[0], lm[9]) || 1e-6;
  return dist(lm[4], lm[8]) / palm;
}

export const GESTURE_TUNING = {
  palmSmooth: 0.4,          // 掌心 EMA
  spreadRise: 0.5,          // 张开跟随快
  spreadFall: 0.3,          // 收拢稍缓
  pinchEnter: 0.32,         // 捏合进入阈值
  pinchExit: 0.52,          // 捏合退出阈值（迟滞）
  pinchHoldMs: 90,          // 需保持的时长，防误触
  scaleMin: 0.55, scaleMax: 1.6,
  pinchNear: 0.14, pinchFar: 1.1,   // 捏距映射区间
  spinGain: 3.4, spinMax: 2.4, spinDecay: 3.2,
  waveVx: 1.5,              // 风暴触发横移速度（归一化宽/秒）
  waveHoldMs: 70, waveCooldownMs: 1400,
  seaSpread: 0.5,           // 双手花海需要的手掌张开度
  seaNear: 0.10, seaFar: 0.50,
  seaRadiusNear: 0.70, seaRadiusFar: 3.1,
  lostGraceMs: 400,         // 手丢失后过渡到空闲的宽限
  idleBloom: 0.42,          // 空闲呼吸的绽放度
  idleSpin: 0.16,
} as const;

export class GestureEngine {
  private state_: DriveState = {
    present: false, handCount: 0, bloomTarget: 0, scaleTarget: 1, spinTarget: 0,
    sea: false, seaRadius: 1, handX: 0.5, handY: 0.5, gesture: 'idle', stormQueue: [],
  };
  private primarySide: 0 | 1 = 0;       // 主手粘滞
  private spread = 0;
  private lastSeen = -1e9;
  private lastT = -1e9;
  private prevPalmX = 0.5;
  private vx = 0;                        // 平滑横向速度（归一化宽/s）
  private waveFastSince: number | null = null;
  private lastStormAt = -1e9;
  private pinchSince: number | null = null;
  private pinching = false;
  private pinchBloom = 0;
  private lastScale = 1;

  /** 当前驾驶状态（与引擎内部对象同一引用，随 update 就地更新）。 */
  get state(): DriveState {
    return this.state_;
  }

  /** 采集一帧手部数据并推进状态机（now 毫秒；hands 为各手 21 关键点，镜像屏幕坐标）。 */
  update(now: number, hands: Landmark[][] | undefined | null): DriveState {
    const s = this.state;
    const T = GESTURE_TUNING;
    const dt = this.lastT < 0 ? 1 / 60 : clamp((now - this.lastT) / 1000, 1 / 240, 0.1);
    this.lastT = now;

    const tracked = hands && hands.length > 0 && hands[0].length >= 21;
    if (tracked) {
      this.lastSeen = now;
      // 主手选择：双手时粘滞跟随上一次的主手（按掌心距离）。
      if (hands.length > 1) {
        const d0 = Math.hypot(palmCenter(hands[0]).x - s.handX, palmCenter(hands[0]).y - s.handY);
        const d1 = Math.hypot(palmCenter(hands[1]).x - s.handX, palmCenter(hands[1]).y - s.handY);
        this.primarySide = d1 < d0 ? 1 : 0;
      } else this.primarySide = 0;
      const lm = hands[this.primarySide];
      const palm = palmCenter(lm);
      s.handX += (palm.x - s.handX) * T.palmSmooth;
      s.handY += (palm.y - s.handY) * T.palmSmooth;
      s.handCount = hands.length;

      // C 旋转：横移速度（带惯性与衰减）。
      const vxInstant = (s.handX - this.prevPalmX) / dt;
      this.prevPalmX = s.handX;
      this.vx += (vxInstant - this.vx) * 0.35;
      this.vx *= Math.exp(-T.spinDecay * dt * 0.4);
      // E 风暴：持续快速横移（迟滞 + 冷却）。
      if (Math.abs(this.vx) > T.waveVx) {
        this.waveFastSince ??= now;
        if (now - this.waveFastSince >= T.waveHoldMs && now - this.lastStormAt >= T.waveCooldownMs) {
          this.lastStormAt = now;
          s.stormQueue.push({ dirX: Math.sign(this.vx), dirY: 0, power: clamp(Math.abs(this.vx) / 3, 0.5, 1) });
        }
      } else this.waveFastSince = null;

      const spread = spreadOf(lm);
      this.spread += (spread - this.spread) * (spread > this.spread ? T.spreadRise : T.spreadFall);

      // D 捏合：迟滞进入/退出；期间锁定绽放度、接管缩放。
      const ratio = pinchRatio(lm);
      if (!this.pinching && ratio < T.pinchEnter) {
        this.pinchSince ??= now;
        if (now - this.pinchSince >= T.pinchHoldMs) { this.pinching = true; this.pinchBloom = this.spread; }
      } else if (this.pinching && ratio > T.pinchExit) {
        this.pinching = false; this.pinchSince = null;
      } else if (!this.pinching) this.pinchSince = null;
      if (this.pinching) {
        s.bloomTarget = this.pinchBloom;
        const k = clamp((ratio - T.pinchNear) / (T.pinchFar - T.pinchNear), 0, 1);
        s.scaleTarget = T.scaleMin + (T.scaleMax - T.scaleMin) * k;
      } else {
        s.scaleTarget += (1 - s.scaleTarget) * 0.12;   // 退出捏合后弹性回中
        s.bloomTarget = 0.08 + this.spread * 0.92;     // 放松的手也能保持微开，握拳才完全收拢
      }

      // F 花海：双手同时张开，掌距控制扩散半径。
      const second = hands.length > 1 ? hands[1 - this.primarySide] : null;
      const seaOn = !!second && spreadOf(second) > T.seaSpread && this.spread > T.seaSpread;
      s.sea = seaOn;
      if (seaOn && second) {
        const d = Math.hypot(palm.x - palmCenter(second).x, palm.y - palmCenter(second).y);
        const k = clamp((d - T.seaNear) / (T.seaFar - T.seaNear), 0, 1);
        s.seaRadius += (T.seaRadiusNear + (T.seaRadiusFar - T.seaRadiusNear) * k - s.seaRadius) * 0.15;
      }
    } else if (now - this.lastSeen > T.lostGraceMs) {
      // 手丢失：自然过渡到空闲呼吸（不跳变）。
      s.present = false; s.handCount = 0; s.sea = false;
      s.bloomTarget += (T.idleBloom - s.bloomTarget) * 0.04;
      s.spinTarget += (T.idleSpin - s.spinTarget) * 0.02;
      s.scaleTarget += (1 - s.scaleTarget) * 0.02;
      s.gesture = 'idle';
      this.pinching = false; this.pinchSince = null; this.waveFastSince = null;
      return s;
    }
    s.present = !!tracked;
    s.spinTarget = clamp(this.vx * T.spinGain, -T.spinMax, T.spinMax);
    this.lastScale = s.scaleTarget;
    // 手势标签（迟滞：进入阈值略高于退出，避免抖动）。
    s.gesture = s.sea ? 'sea'
      : this.pinching ? 'pinch'
      : s.stormQueue.length ? 'storm'
      : Math.abs(s.spinTarget) > 0.35 ? 'spin'
      : s.bloomTarget > 0.55 ? 'bloom'
      : s.present ? 'bloom' : 'idle';
    return s;
  }
}
