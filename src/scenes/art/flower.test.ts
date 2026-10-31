import { describe, it, expect } from 'vitest';
import { FLOWERS, petalPoint, buildPetalSurface, planFlower } from './flower';

describe('BloomVerse 花朵内核 · 花瓣曲面', () => {
  it('花瓣基点在原点，瓣尖沿 +y 伸展', () => {
    const rose = FLOWERS[0].layers[0].shape;
    const base = petalPoint(rose, 0, 0);
    expect(Math.hypot(base[0], base[1], base[2])).toBeLessThan(1e-6);
    const tip = petalPoint(rose, 1, 0);
    expect(tip[1]).toBeGreaterThan(rose.length * 0.4);   // curl 使瓣尖回弯，y 仍为主要分量
    expect(tip[2]).toBeLessThan(0);                       // 瓣尖向后（-z）弯
  });
  it('曲面网格：顶点/索引/法线数量与归一性', () => {
    const lotus = FLOWERS[1].layers[0].shape;
    const g = buildPetalSurface(lotus, 12, 6);
    expect(g.positions.length).toBe(13 * 7 * 3);
    expect(g.indices.length).toBe(12 * 6 * 6);
    expect(g.uvs.length).toBe(13 * 7 * 2);
    for (let i = 0; i < g.normals.length; i += 3) {
      const len = Math.hypot(g.normals[i], g.normals[i + 1], g.normals[i + 2]);
      expect(Math.abs(len - 1)).toBeLessThan(1e-5);
    }
    for (let i = 0; i < g.positions.length; i++) expect(Number.isFinite(g.positions[i])).toBe(true);
  });
  it('曲面范围有界：横向不超过瓣宽的 1.6 倍，长度不超过瓣长', () => {
    const shape = FLOWERS[0].layers[0].shape;
    const g = buildPetalSurface(shape, 14, 8);
    for (let i = 0; i < g.positions.length; i += 3) {
      expect(Math.abs(g.positions[i])).toBeLessThan(shape.width * 1.6);
      expect(g.positions[i + 1]).toBeLessThanOrEqual(shape.length + 1e-6);
      expect(g.positions[i + 1]).toBeGreaterThanOrEqual(-1e-9);
      expect(Math.abs(g.positions[i + 2])).toBeLessThan(shape.length);
    }
  });
  it('樱花缺口：notch 使瓣尖中线回缩（V 形凹口）', () => {
    const withNotch = { ...FLOWERS[2].layers[0].shape };
    const without = { ...withNotch, notch: 0 };
    // 缺口出现在瓣尖中线：u=1、v=0 处的长度回缩，两侧瓣尖仍伸满全长
    const tipCenter = (s: typeof withNotch) => petalPoint(s, 1, 0)[1];
    expect(tipCenter(withNotch)).toBeLessThan(tipCenter(without) - 0.02);
    const horn = petalPoint(withNotch, 1, 0.55)[1];
    expect(horn).toBeGreaterThan(tipCenter(withNotch) + 0.05);   // 中线凹、两侧凸
  });
});

describe('BloomVerse 花朵内核 · 花种规划', () => {
  it('四种花种齐备且 id 唯一', () => {
    expect(FLOWERS.map(f => f.id)).toEqual(['rose', 'lotus', 'sakura', 'fantasy']);
  });
  it('planFlower：花瓣数等于各层之和，延迟在界内且外层先开', () => {
    for (const f of FLOWERS) {
      const plan = planFlower(f);
      expect(plan.petalCount).toBe(f.layers.reduce((n, l) => n + l.petals, 0));
      expect(plan.placements.length).toBe(plan.petalCount);
      for (const p of plan.placements) {
        expect(p.delay).toBeGreaterThanOrEqual(0);
        expect(p.delay).toBeLessThanOrEqual(0.56);
        expect(p.azimuth).toBeGreaterThanOrEqual(0);
        expect(p.tiltOpen).toBeGreaterThan(p.tiltClose);
      }
      if (f.layers.length > 1) {
        const outer = plan.placements.filter(p => p.layer === 0);
        const inner = plan.placements.filter(p => p.layer === f.layers.length - 1);
        const avg = (ps: typeof outer) => ps.reduce((n, p) => n + p.delay, 0) / ps.length;
        expect(avg(outer)).toBeLessThan(avg(inner));
      }
    }
  });
  it('同层花瓣方位角逐瓣错开（覆盖整圆）', () => {
    const plan = planFlower(FLOWERS[2]);   // 樱花单层 5 瓣
    const az = plan.placements.map(p => p.azimuth).sort((a, b) => a - b);
    for (let i = 1; i < az.length; i++) expect(az[i] - az[i - 1]).toBeGreaterThan(0.8);
  });
});
