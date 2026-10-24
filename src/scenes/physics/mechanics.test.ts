import { describe, it, expect } from 'vitest';
import { simulate, step, speed, inTarget, clampForce } from './mechanics';

describe('力与运动仿真（物理正确性）', () => {
  it('无力时保持匀速直线运动（牛顿第一定律）', () => {
    const r = simulate({ x: 0, y: 0, vx: 2, vy: 0 }, { magnitude: 0, angle: 0 }, 300, 1 / 60); // 5 秒
    expect(speed(r.body)).toBeCloseTo(2, 10);
    expect(r.body.x).toBeCloseTo(10, 6);
    expect(r.body.y).toBeCloseTo(0, 10);
  });
  it('恒力下速度按 v = v0 + at 精确更新', () => {
    const r = simulate({ x: 0, y: 0, vx: 0, vy: 0 }, { magnitude: 3, angle: 0 }, 60, 0.5);
    expect(r.body.vx).toBeCloseTo(3 * 60 * 0.5, 10); // a=3，n=60 步 → v=90
    expect(r.body.vy).toBeCloseTo(0, 10);
  });
  it('位置符合离散积分闭式 x = x0 + n·dt·v0 + a·dt²·n(n+1)/2', () => {
    const n = 10, dt = 0.1, a = 2;
    const r = simulate({ x: 1, y: 0, vx: 1, vy: 0 }, { magnitude: a, angle: 0 }, n, dt);
    expect(r.body.x).toBeCloseTo(1 + n * dt * 1 + (a * dt * dt * n * (n + 1)) / 2, 10);
  });
  it('初始与速度垂直的力使轨迹向上拐弯，短期内速率近似不变', () => {
    // 世界系固定 90° 的力只在初始时刻垂直；随后速度转向、力不再垂直，速率会真实增加。
    // 教学断言限定短时间（0.2 秒）：二阶效应 ~a²t²/2v 足够小。
    const r = simulate({ x: 0, y: 0, vx: 2, vy: 0 }, { magnitude: 2, angle: 90 }, 12, 1 / 60);
    expect(Math.abs(speed(r.body) - 2)).toBeLessThan(0.05);
    expect(r.body.y).toBeGreaterThan(0.02);
  });
  it('反方向力使物体先减速再倒退', () => {
    const r = simulate({ x: 0, y: 0, vx: 2, vy: 0 }, { magnitude: 1, angle: 180 }, 300, 1 / 60); // 5 秒
    expect(r.body.vx).toBeCloseTo(2 - 5, 10); // v = 2 - 1×5 = -3
  });
  it('单步推进无量纲错误（ dt=0 时不变）', () => {
    const b = { x: 1, y: 2, vx: 3, vy: 4 };
    expect(step(b, { magnitude: 5, angle: 45 }, 0)).toEqual(b);
  });
  it('目标判定与力上限约束', () => {
    expect(inTarget({ x: 3, y: 4, vx: 0, vy: 0 }, { x: 3, y: 4, r: 1 })).toBe(true);
    expect(inTarget({ x: 5, y: 4, vx: 0, vy: 0 }, { x: 3, y: 4, r: 1 })).toBe(false);
    expect(clampForce(99, -90)).toEqual({ magnitude: 4, angle: 270 });
  });
});
