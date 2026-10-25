import { describe, it, expect } from 'vitest';
import { angleAt, twoHandAngle, thumbIndexAngle, classifyAngle, isWithin, stabilize } from './bodyAngle';

describe('身体量角器内核', () => {
  it('三点夹角：正交 90°、共线 180°、等边 60°', () => {
    expect(angleAt({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90, 9);
    expect(angleAt({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(180, 9);
    // 等边三角形内角（顶点 (1,0)，第三个顶点 (0.5, √3/2)）
    expect(angleAt({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: Math.sqrt(3) / 2 })).toBeCloseTo(60, 9);
  });
  it('夹角与镜像/平移无关（对手势镜像坐标稳定）', () => {
    const deg = angleAt({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0.2 });
    const mirror = angleAt({ x: -0, y: 0 }, { x: -1, y: 1 }, { x: -2, y: 0.2 });
    expect(mirror).toBeCloseTo(deg, 9);
  });
  it('双手角：对称双手给出预期角度；单手时返回 null', () => {
    const lms = [
      Array.from({ length: 21 }, (_, i) => ({ x: i * 0.01, y: 0.3 })),
      Array.from({ length: 21 }, (_, i) => ({ x: 0.3 + i * 0.01, y: 0.3 })),
    ];
    // 顶点 = 两腕中点 (0.145, 0.3)；食指尖 (0.08, 0.3) 与 (0.37, 0.3) 共线 → 180°
    expect(twoHandAngle(lms)).toBeCloseTo(180, 6);
    expect(twoHandAngle([lms[0]])).toBeNull();
    expect(twoHandAngle([])).toBeNull();
  });
  it('虎口角：拇指食指垂直张开 ≈90°，并拢 ≈0°', () => {
    const open = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));
    open[2] = { x: 0, y: 0 }; open[4] = { x: 0.3, y: 0 }; open[8] = { x: 0, y: 0.3 };
    expect(thumbIndexAngle(open)).toBeCloseTo(90, 6);
    const closed = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));
    closed[4] = { x: 0.2, y: 0 }; closed[8] = { x: 0.3, y: 0 };
    expect(thumbIndexAngle(closed)).toBeCloseTo(0, 6);
  });
  it('分类：±3° 边界带内的直角/平角', () => {
    expect(classifyAngle(45)).toBe('锐角');
    expect(classifyAngle(88)).toBe('直角');
    expect(classifyAngle(91.5)).toBe('直角');
    expect(classifyAngle(120)).toBe('钝角');
    expect(classifyAngle(178)).toBe('平角');
    expect(classifyAngle(30)).toBe('锐角');
  });
  it('判题容差与稳定窗口', () => {
    expect(isWithin(92, 90, 8)).toBe(true);
    expect(isWithin(100, 90, 8)).toBe(false);
    const steady = Array.from({ length: 12 }, (_, i) => 45 + (i % 2 ? 0.4 : -0.4));
    expect(stabilize(steady, 3)).toBeCloseTo(45, 6);   // 偶数窗口中位数 = 均值
    expect(stabilize(Array.from({ length: 11 }, () => 45.2), 3)).toBe(45.2);
    const shaky = [40, 55, 42, 58, 39, 61, 44, 52];
    expect(stabilize(shaky, 3)).toBeNull();
    expect(stabilize([45], 3)).toBeNull();   // 样本不足
  });
});
