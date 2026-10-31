import { describe, it, expect } from 'vitest';
import { GestureEngine, GESTURE_TUNING } from './gesture';

type P = { x: number; y: number };
/** 合成 21 点手：wrist(0.5,0.85)，掌长 0.2；spread 控制四指伸直程度（0=拳 1=全张），
 *  pinchX 为拇指-食指捏距（掌长倍数，默认 1.0 松开）。 */
function makeHand(spread: number, pinchX = 1.0, cx = 0.5): P[] {
  const wrist = { x: cx, y: 0.85 };
  const lm = Array.from({ length: 21 }, () => ({ ...wrist }));
  lm[0] = { ...wrist };
  lm[9] = { x: cx, y: 0.65 };
  const tipY = 0.85 - (0.5 + spread * 1.1) * 0.2;
  const xs = [0.44, 0.5, 0.56, 0.62];
  [[8, 6], [12, 10], [16, 14], [20, 18]].forEach(([tip, pip], f) => {
    lm[pip] = { x: xs[f], y: 0.85 - 0.14 };
    lm[tip] = { x: xs[f] + 0.01, y: tipY };
  });
  lm[4] = { x: lm[8].x + pinchX * 0.2 * 0.6, y: lm[8].y + pinchX * 0.2 * 0.35 };
  lm[8] = { x: xs[0] + 0.01, y: tipY };
  return lm;
}
const step = (e: GestureEngine, t: number, hands: P[][] | null) => e.update(t, hands);

describe('BloomVerse 手势引擎 · 连续开合', () => {
  it('张开→绽放度连续升高，握拳→收拢；放松的手保持微开', () => {
    const e = new GestureEngine();
    let s = step(e, 0, [makeHand(0)]);
    for (let i = 1; i <= 20; i++) s = step(e, i * 33, [makeHand(1)]);
    expect(s.bloomTarget).toBeGreaterThan(0.6);
    for (let i = 1; i <= 20; i++) s = step(e, 700 + i * 33, [makeHand(0)]);
    expect(s.bloomTarget).toBeLessThan(0.25);
    for (let i = 1; i <= 10; i++) s = step(e, 1500 + i * 33, [makeHand(0.35)]);
    expect(s.bloomTarget).toBeGreaterThan(0.2);   // 半开的手不再缩成花苞
  });
  it('手丢失 → 宽限期后过渡到空闲呼吸（不跳变）', () => {
    const e = new GestureEngine();
    let s = step(e, 0, [makeHand(1)]);
    for (let i = 1; i <= 10; i++) s = step(e, i * 33, [makeHand(1)]);
    const held = s.bloomTarget;
    s = step(e, 300, null);
    expect(s.gesture).not.toBe('idle');            // 宽限期内保持
    s = step(e, 1200, null);
    expect(s.gesture).toBe('idle');
    expect(s.bloomTarget).toBeLessThanOrEqual(held);   // 平滑滑向空闲值，不突跳
  });
});

describe('BloomVerse 手势引擎 · 捏合缩放', () => {
  it('捏合进入后锁定绽放度，捏距控制缩放；退出后回中', () => {
    const e = new GestureEngine();
    let s = step(e, 0, [makeHand(0.8)]);
    for (let i = 1; i <= 10; i++) s = step(e, i * 33, [makeHand(0.8)]);
    const bloomBefore = s.bloomTarget;
    // 进入捏合：拇指食指捏紧
    for (let i = 1; i <= 8; i++) s = step(e, 400 + i * 33, [makeHand(0.8, 0.16)]);
    expect(s.gesture).toBe('pinch');
    const locked = s.bloomTarget;
    // 捏合期间手掌继续开合也不影响绽放度
    for (let i = 1; i <= 8; i++) s = step(e, 700 + i * 33, [makeHand(1, 0.2)]);
    expect(s.bloomTarget).toBeCloseTo(locked, 5);
    // 捏距放大 → 缩放变大
    s = step(e, 1000, [makeHand(1, 0.16)]);
    const small = s.scaleTarget;
    s = step(e, 1100, [makeHand(1, 1.0)]);
    expect(s.scaleTarget).toBeGreaterThan(small);
    // 张开超出迟滞 → 退出捏合
    s = step(e, 1300, [makeHand(1, 1.0)]);
    for (let i = 1; i <= 6; i++) s = step(e, 1350 + i * 33, [makeHand(1, 1.0)]);
    expect(s.gesture).not.toBe('pinch');
  });
});

describe('BloomVerse 手势引擎 · 挥手风暴', () => {
  it('快速横移触发一次风暴事件，冷却期内不重复触发', () => {
    const e = new GestureEngine();
    step(e, 0, [makeHand(0.8)]);
    let s = step(e, 100, [makeHand(0.8)]);
    // 向右快速甩动（每帧 0.05 → 速度约 3/秒，EMA 收敛后越过阈值）
    for (let i = 1; i <= 12; i++) s = step(e, 100 + i * 16, [makeHand(0.8, 1.0, 0.5 + i * 0.05)]);
    expect(s.stormQueue.length).toBe(1);
    expect(s.stormQueue[0].dirX).toBe(1);
    // 冷却期内继续甩动不触发
    for (let i = 1; i <= 6; i++) s = step(e, 350 + i * 16, [makeHand(0.8, 1.0, 0.5 + i * 0.05)]);
    expect(s.stormQueue.length).toBe(1);
  });
  it('缓慢移动不触发风暴', () => {
    const e = new GestureEngine();
    step(e, 0, [makeHand(0.8)]);
    let s = step(e, 100, [makeHand(0.8)]);
    for (let i = 1; i <= 20; i++) s = step(e, 100 + i * 33, [makeHand(0.8, 1.0, 0.5 + i * 0.004)]);
    expect(s.stormQueue.length).toBe(0);
  });
  it('横移产生带惯性的旋转目标，停止后衰减', () => {
    const e = new GestureEngine();
    step(e, 0, [makeHand(0.8)]);
    let s = step(e, 100, [makeHand(0.8)]);
    for (let i = 1; i <= 6; i++) s = step(e, 100 + i * 16, [makeHand(0.8, 1.0, 0.5 + i * 0.02)]);
    const spinning = s.spinTarget;
    expect(spinning).toBeGreaterThan(0.3);
    for (let i = 1; i <= 20; i++) s = step(e, 300 + i * 33, [makeHand(0.8, 1.0, 0.62)]);
    expect(Math.abs(s.spinTarget)).toBeLessThan(spinning * 0.5);
  });
});

describe('BloomVerse 手势引擎 · 双手花海', () => {
  it('双手张开进入花海，掌距越大半径越大；单手退出', () => {
    const e = new GestureEngine();
    let s = step(e, 0, [makeHand(1, 1.0, 0.3), makeHand(1, 1.0, 0.4)]);
    for (let i = 1; i <= 10; i++) s = step(e, i * 33, [makeHand(1, 1.0, 0.3), makeHand(1, 1.0, 0.42)]);
    expect(s.sea).toBe(true);
    const near = s.seaRadius;
    for (let i = 1; i <= 10; i++) s = step(e, 500 + i * 33, [makeHand(1, 1.0, 0.2), makeHand(1, 1.0, 0.8)]);
    expect(s.seaRadius).toBeGreaterThan(near);
    expect(GESTURE_TUNING.seaRadiusFar).toBeGreaterThan(s.seaRadius - 0.5);
    s = step(e, 900, [makeHand(1)]);
    expect(s.sea).toBe(false);
  });
});
