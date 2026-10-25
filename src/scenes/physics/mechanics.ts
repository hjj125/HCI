/** 力与运动：二维牛顿运动确定性仿真（半隐式欧拉）。
 *  与正方体截面算法同一工程思路——纯函数、结果可复现、物理正确性由单元测试锁定。
 *  世界单位：米、秒、牛（质量 1kg）；y 轴向上。
 */
export type Vec2 = [number, number];
export type Body = { x: number; y: number; vx: number; vy: number };
export type Force = { magnitude: number; angle: number }; // 角度为世界系度数，0=向右、90=向上

export const MAX_FORCE = 4;

/** 单步推进。半隐式欧拉对恒力速度更新精确，长期积分稳定。 */
export function step(body: Body, force: Force, dt: number, mass = 1): Body {
  const a = force.magnitude / mass, rad = (force.angle * Math.PI) / 180;
  const ax = Math.cos(rad) * a, ay = Math.sin(rad) * a;
  const vx = body.vx + ax * dt, vy = body.vy + ay * dt;
  return { x: body.x + vx * dt, y: body.y + vy * dt, vx, vy };
}

export function simulate(body: Body, force: Force, steps: number, dt: number): { body: Body; trail: Vec2[] } {
  let b = body;
  const trail: Vec2[] = [[body.x, body.y]];
  for (let i = 0; i < steps; i++) {
    b = step(b, force, dt);
    if (i % 3 === 0) trail.push([b.x, b.y]);
  }
  trail.push([b.x, b.y]);
  return { body: b, trail };
}

export const speed = (b: Body) => Math.hypot(b.vx, b.vy);
export const heading = (b: Body) => (Math.atan2(b.vy, b.vx) * 180) / Math.PI;
export const inTarget = (b: Body, t: { x: number; y: number; r: number }) => Math.hypot(b.x - t.x, b.y - t.y) <= t.r;
export const clampForce = (magnitude: number, angle: number): Force =>
  ({ magnitude: Math.max(0, Math.min(MAX_FORCE, magnitude)), angle: (angle % 360 + 360) % 360 });

/** ===== 挑战模式 · 星际巡游 ===== */
export const GAME_START: [number, number] = [2.5, 2.5];
export const GAME_GOAL = { x: 17, y: 9, r: 1.2 };
export const COLLECT_R = 0.9;

/** 生成随机途经点（拒绝采样）：在观测区内、远离起点与终点、彼此保持间距。
 *  rng 可注入（确定性测试）；采样失败时沿起终点对角线兜底铺开。 */
export function makeWaypoints(count: number, rng: () => number = Math.random): [number, number][] {
  const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const out: [number, number][] = [];
  let guard = 0;
  while (out.length < count && guard++ < 600) {
    const p: [number, number] = [4.5 + rng() * 11, 2 + rng() * 7];
    if (dist(p, GAME_START) < 4.5 || dist(p, [GAME_GOAL.x, GAME_GOAL.y]) < 3) continue;
    if (out.some(q => dist(p, q) < 3)) continue;
    out.push(p);
  }
  while (out.length < count) {
    const t = (out.length + 1) / (count + 1);
    out.push([GAME_START[0] + (GAME_GOAL.x - GAME_START[0]) * t, GAME_START[1] + (GAME_GOAL.y - GAME_START[1]) * t]);
  }
  return out;
}
