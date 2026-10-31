import { describe, it, expect } from 'vitest';
import { SPECIES, PARTICLE_COUNT, BUD_RADIUS, buildLayout, budPositions, palmCenter, spreadOf, backOut, updateBloom, hexToRgb } from './bloom';

/** 合成 21 点手部关键点：腕在 (0.5,0.85)，掌长 0.2；ext 为各指尖到腕的距离（掌长倍数）。
 *  pip 固定在 0.7 倍掌长处——ext=1.6 近似全张，ext=0.5 近似握拳。 */
function makeHand(ext: number) {
  const wrist = { x: 0.5, y: 0.85 };
  const lm = Array.from({ length: 21 }, () => ({ ...wrist }));
  lm[0] = { ...wrist };
  lm[9] = { x: 0.5, y: 0.65 };                    // 中指根：掌长基准
  const xs = [0.44, 0.5, 0.56, 0.62];             // 食/中/环/小指横向错开
  [[8, 6], [12, 10], [16, 14], [20, 18]].forEach(([tip, pip], f) => {
    lm[pip] = { x: xs[f], y: 0.85 - 0.7 * 0.2 };
    lm[tip] = { x: xs[f] + 0.01, y: 0.85 - ext * 0.2 };
  });
  return lm;
}

describe('开花内核 · 花型布局', () => {
  it('所有花型：粒子数正确、各数组长度匹配、坐标有限', () => {
    for (const species of SPECIES) {
      const L = buildLayout(species, PARTICLE_COUNT);
      expect(L.count).toBe(PARTICLE_COUNT);
      expect(L.bud.length).toBe(PARTICLE_COUNT * 3);
      expect(L.bloom.length).toBe(PARTICLE_COUNT * 3);
      expect(L.color.length).toBe(PARTICLE_COUNT * 3);
      expect(L.delay.length).toBe(PARTICLE_COUNT);
      expect(L.size.length).toBe(PARTICLE_COUNT);
      expect(L.seed.length).toBe(PARTICLE_COUNT);
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        expect(Number.isFinite(L.bloom[i * 3])).toBe(true);
        expect(Number.isFinite(L.bud[i * 3 + 1])).toBe(true);
        expect(L.delay[i]).toBeGreaterThanOrEqual(0);
        expect(L.delay[i]).toBeLessThan(0.7);
        expect(L.color[i * 3]).toBeGreaterThanOrEqual(0);
        expect(L.color[i * 3]).toBeLessThanOrEqual(1);
        expect(L.size[i]).toBeGreaterThan(0);
      }
    }
  });

  it('绽放半径远大于花苞半径（收拢↔展开形态分明）', () => {
    const L = buildLayout(SPECIES[0], PARTICLE_COUNT);
    const maxBud = Math.hypot(L.bud[0], L.bud[1], L.bud[2]);
    let maxBloom = 0, maxBudAll = 0;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      maxBudAll = Math.max(maxBudAll, Math.hypot(L.bud[i * 3], L.bud[i * 3 + 1], L.bud[i * 3 + 2]));
      maxBloom = Math.max(maxBloom, Math.hypot(L.bloom[i * 3], L.bloom[i * 3 + 1], L.bloom[i * 3 + 2]));
    }
    expect(maxBudAll).toBeLessThanOrEqual(0.55);    // 0.30·1.3 椭球 + 抖动余量
    expect(maxBud).toBeLessThanOrEqual(maxBudAll + 1e-9);
    expect(maxBloom).toBeGreaterThan(0.7);
    expect(maxBloom).toBeLessThan(1.1);           // 花整体半径 ≈ 1
    expect(maxBloom).toBeGreaterThan(maxBudAll * 1.8);
  });

  it('花芯与花瓣分区：花芯点集中在 coreRatio 内且先于花瓣绽放', () => {
    const species = SPECIES[0];                    // 樱花 coreRatio 0.24
    const L = buildLayout(species, PARTICLE_COUNT);
    const coreCount = Math.round(PARTICLE_COUNT * 0.25);
    let coreMaxR = 0, petalMinR = Infinity, coreDelaySum = 0, petalDelaySum = 0;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const r = Math.hypot(L.bloom[i * 3], L.bloom[i * 3 + 1]);
      if (i < coreCount) { coreMaxR = Math.max(coreMaxR, r); coreDelaySum += L.delay[i]; }
      else { petalMinR = Math.min(petalMinR, r); petalDelaySum += L.delay[i]; }
    }
    expect(coreMaxR).toBeLessThanOrEqual(species.coreRatio + 1e-6);
    expect(petalMinR).toBeGreaterThanOrEqual(species.coreRatio * 0.5);   // 花瓣根从花芯外围起步
    expect(coreDelaySum / coreCount).toBeLessThan(petalDelaySum / (PARTICLE_COUNT - coreCount));
  });

  it('花瓣沿瓣根→瓣尖由深到浅（樱花：瓣根樱粉、瓣尖近白）', () => {
    const species = SPECIES[0];
    const L = buildLayout(species, PARTICLE_COUNT);
    const lum = (i: number) => L.color[i * 3] * 0.3 + L.color[i * 3 + 1] * 0.6 + L.color[i * 3 + 2] * 0.1;
    const coreCount = Math.round(PARTICLE_COUNT * 0.25);
    let rootLum = 0, rootN = 0, tipLum = 0, tipN = 0;
    for (let i = coreCount; i < PARTICLE_COUNT; i++) {
      const r = Math.hypot(L.bloom[i * 3], L.bloom[i * 3 + 1]);
      if (r < 0.35) { rootLum += lum(i); rootN++; }
      if (r > 0.7) { tipLum += lum(i); tipN++; }
    }
    expect(rootN).toBeGreaterThan(0);
    expect(tipN).toBeGreaterThan(0);
    expect(tipLum / tipN).toBeGreaterThan(rootLum / rootN);
  });

  it('数学玫瑰：点落在 r=cos(5θ) 楔形内，五个波瓣都有覆盖', () => {
    const species = SPECIES[3];
    const L = buildLayout(species, PARTICLE_COUNT);
    const coreCount = Math.round(PARTICLE_COUNT * 0.25);
    const period = (2 * Math.PI) / 5;                     // 波瓣中心的角距
    const petalsHit = new Set<number>();
    for (let i = coreCount; i < PARTICLE_COUNT; i++) {
      const x = L.bloom[i * 3], y = L.bloom[i * 3 + 1];
      const r = Math.hypot(x, y);
      if (r < 1e-4) continue;                               // 花心处角度无定义
      const wrapped = ((Math.atan2(y, x) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const petal = Math.round(wrapped / period) % 5;
      const dev = Math.abs(wrapped - Math.round(wrapped / period) * period);  // 距最近瓣心角距
      expect(dev).toBeLessThanOrEqual(Math.PI / 10 + 1e-9);                   // 只存在于波瓣张角内
      expect(r).toBeLessThanOrEqual(Math.cos(5 * dev) + 1e-6);                // 半径不越过玫瑰线边界
      petalsHit.add(petal);
    }
    expect(petalsHit.size).toBe(5);
  });

  it('花苞点阵：确定性且底部收窄（泪滴形）', () => {
    const n = 500;
    const a = new Float32Array(n * 3), b = new Float32Array(n * 3);
    budPositions(n, a); budPositions(n, b);
    expect(Array.from(a)).toEqual(Array.from(b));
    let topR = 0, bottomR = 0;
    for (let i = 0; i < n; i++) {
      const r = Math.hypot(a[i * 3], a[i * 3 + 2]);
      if (a[i * 3 + 1] > 0) topR = Math.max(topR, r); else bottomR = Math.max(bottomR, r);
    }
    expect(bottomR).toBeLessThan(topR);
  });
});

describe('开花内核 · 手势映射', () => {
  it('握拳≈0，全张≈1，半张介于其间', () => {
    const fist = spreadOf(makeHand(0.5));
    const half = spreadOf(makeHand(0.78));   // 指尖约到 pip 附近：比值≈1.11，落在映射带中段
    const open = spreadOf(makeHand(1.6));
    expect(fist).toBeLessThan(0.1);
    expect(open).toBeGreaterThan(0.9);
    expect(half).toBeGreaterThan(0.2);
    expect(half).toBeLessThan(0.9);
  });
  it('关键点不足 21 个时安全返回 0', () => {
    expect(spreadOf([{ x: 0, y: 0 }])).toBe(0);
  });
  it('掌心 = 腕、中指根、小指根三点的平均', () => {
    const lm = Array.from({ length: 21 }, (_, i) => ({ x: i * 0.01, y: 0.5 + i * 0.02 }));
    const c = palmCenter(lm);
    expect(c.x).toBeCloseTo((0 + 0.09 + 0.17) / 3, 9);
    expect(c.y).toBeCloseTo((0.5 + 0.68 + 0.84) / 3, 9);
  });
});

describe('开花内核 · 绽放进度', () => {
  it('backOut：端点归一且中段过冲（弹开感）', () => {
    expect(backOut(0)).toBeCloseTo(0, 9);
    expect(backOut(1)).toBeCloseTo(1, 9);
    let peak = 0;
    for (let t = 0; t <= 1; t += 0.01) peak = Math.max(peak, backOut(t));
    expect(peak).toBeGreaterThan(1.05);
  });
  it('updateBloom：向目标单调趋近并收敛，dt=0 不动', () => {
    let b = 0;
    let prev = -1;
    for (let i = 0; i < 200; i++) {
      b = updateBloom(b, 1, 1 / 60);
      expect(b).toBeGreaterThan(prev);
      expect(b).toBeLessThanOrEqual(1);
      prev = b;
    }
    expect(b).toBeCloseTo(1, 2);
    expect(updateBloom(0.4, 1, 0)).toBeCloseTo(0.4, 9);
  });
});

describe('开花内核 · 颜色工具', () => {
  it('hexToRgb 归一化到 [0,1]', () => {
    expect(hexToRgb('#ff0000')).toEqual([1, 0, 0]);
    expect(hexToRgb('#00ff80')[1]).toBe(1);
    expect(hexToRgb('#00ff80')[2]).toBeCloseTo(0x80 / 255, 9);
  });
});
