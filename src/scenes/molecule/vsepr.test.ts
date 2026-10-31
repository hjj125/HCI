import { describe, expect, it } from 'vitest';
import { geometryLabels, geometryOf, vseprLayout } from './vsepr';
import { MOLECULE_DEMOS } from './agentAdapter';
import { freeValenceHint, molecularFormula, validateMolecule, type Atom, type Bond } from './molecule';

/** 从布局里量出中心原子到各邻居的两两夹角（度）。 */
function anglesAt(pos: Map<number, { x: number; y: number; z: number }>, center: number, neighbors: number[]): number[] {
  const c = pos.get(center)!;
  const dirs = neighbors.map(n => {
    const p = pos.get(n)!;
    const v = { x: p.x - c.x, y: p.y - c.y, z: p.z - c.z };
    const l = Math.hypot(v.x, v.y, v.z);
    return { x: v.x / l, y: v.y / l, z: v.z / l };
  });
  const out: number[] = [];
  for (let i = 0; i < dirs.length; i++) for (let j = i + 1; j < dirs.length; j++) {
    const d = dirs[i].x * dirs[j].x + dirs[i].y * dirs[j].y + dirs[i].z * dirs[j].z;
    out.push((Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI);
  }
  return out;
}

describe('VSEPR 理想几何 · 教学键角', () => {
  it('甲烷：中心碳四面体，任意两键夹角 ≈109.5°，键长一致', () => {
    const atoms: Atom[] = [{ id: 1, el: 'C' }, { id: 2, el: 'H' }, { id: 3, el: 'H' }, { id: 4, el: 'H' }, { id: 5, el: 'H' }];
    const bonds: Bond[] = [{ a: 1, b: 2, order: 1 }, { a: 1, b: 3, order: 1 }, { a: 1, b: 4, order: 1 }, { a: 1, b: 5, order: 1 }];
    const pos = vseprLayout(atoms, bonds);
    const angles = anglesAt(pos, 1, [2, 3, 4, 5]);
    expect(angles).toHaveLength(6);
    for (const a of angles) expect(Math.abs(a - 109.47)).toBeLessThan(0.6);
    for (const n of [2, 3, 4, 5]) {
      const p = pos.get(n)!, c = pos.get(1)!;
      expect(Math.hypot(p.x - c.x, p.y - c.y, p.z - c.z)).toBeCloseTo(0.95, 5);
    }
    expect(geometryOf('C', 4)).toBe('tetrahedral');
  });

  it('水：中心氧折角形，键角 ≈104.5°', () => {
    const atoms: Atom[] = [{ id: 1, el: 'O' }, { id: 2, el: 'H' }, { id: 3, el: 'H' }];
    const bonds: Bond[] = [{ a: 1, b: 2, order: 1 }, { a: 1, b: 3, order: 1 }];
    const [angle] = anglesAt(vseprLayout(atoms, bonds), 1, [2, 3]);
    expect(Math.abs(angle - 104.5)).toBeLessThan(0.6);
    expect(geometryOf('O', 2)).toBe('bent1045');
  });

  it('二氧化碳：中心碳直线形 180°（双键方向只占一个几何位）', () => {
    const atoms: Atom[] = [{ id: 1, el: 'C' }, { id: 2, el: 'O' }, { id: 3, el: 'O' }];
    const bonds: Bond[] = [{ a: 1, b: 2, order: 2 }, { a: 1, b: 3, order: 2 }];
    const [angle] = anglesAt(vseprLayout(atoms, bonds), 1, [2, 3]);
    expect(Math.abs(angle - 180)).toBeLessThan(0.6);
    expect(geometryOf('C', 2)).toBe('linear');
  });

  it('氨：中心氮三角锥形，键角 ≈107°', () => {
    const atoms: Atom[] = [{ id: 1, el: 'N' }, { id: 2, el: 'H' }, { id: 3, el: 'H' }, { id: 4, el: 'H' }];
    const bonds: Bond[] = [{ a: 1, b: 2, order: 1 }, { a: 1, b: 3, order: 1 }, { a: 1, b: 4, order: 1 }];
    const angles = anglesAt(vseprLayout(atoms, bonds), 1, [2, 3, 4]);
    for (const a of angles) expect(Math.abs(a - 107)).toBeLessThan(0.6);
    expect(geometryOf('N', 3)).toBe('pyramidal107');
  });

  it('所有灵犀演示分子：布局坐标有限、树边键长一致、分子合法', () => {
    for (const [name, spec] of Object.entries(MOLECULE_DEMOS)) {
      const atoms: Atom[] = spec.atoms.map((el, i) => ({ id: i + 1, el }));
      const bonds: Bond[] = spec.bonds.map(b => ({ a: b.a + 1, b: b.b + 1, order: b.order }));
      const pos = vseprLayout(atoms, bonds);
      expect(pos.size, name).toBe(atoms.length);
      for (const [, p] of pos) {
        expect(isFinite(p.x) && isFinite(p.y) && isFinite(p.z), name).toBe(true);
      }
      for (const b of bonds) {
        const pa = pos.get(b.a)!, pb = pos.get(b.b)!;
        // 树边键长精确；环边（本套演示没有）允许偏差。
        expect(Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z), name).toBeCloseTo(0.95, 5);
      }
      expect(validateMolecule(atoms, bonds).ok, name).toBe(true);
    }
  });

  it('几何标签：水给出"折角形 104.5°"，甲烷给出"正四面体 109.5°"', () => {
    const water = geometryLabels([{ id: 1, el: 'O' }, { id: 2, el: 'H' }, { id: 3, el: 'H' }], [{ a: 1, b: 2, order: 1 }, { a: 1, b: 3, order: 1 }]);
    expect(water).toHaveLength(1);
    expect(water[0].info.zh).toContain('折角');
    expect(water[0].info.angle).toBe(104.5);
    const ch4 = geometryLabels(
      [{ id: 1, el: 'C' }, { id: 2, el: 'H' }, { id: 3, el: 'H' }, { id: 4, el: 'H' }, { id: 5, el: 'H' }],
      [{ a: 1, b: 2, order: 1 }, { a: 1, b: 3, order: 1 }, { a: 1, b: 4, order: 1 }, { a: 1, b: 5, order: 1 }],
    );
    expect(ch4[0].info.zh).toBe('正四面体');
    expect(ch4[0].info.angle).toBe(109.5);
  });

  it('孤立氢原子（度数 1）也有确定坐标，混合连通分量在 x 方向铺开', () => {
    const atoms: Atom[] = [{ id: 1, el: 'H' }, { id: 2, el: 'O' }, { id: 3, el: 'H' }, { id: 4, el: 'H' }];
    const bonds: Bond[] = [{ a: 2, b: 3, order: 1 }, { a: 2, b: 4, order: 1 }];
    const pos = vseprLayout(atoms, bonds);
    expect(pos.size).toBe(4);
    expect(pos.get(1)!.x).toBeLessThan(pos.get(2)!.x); // 孤立 H 在第一个分量
    expect(isFinite(pos.get(1)!.y)).toBe(true);
  });
});

describe('价键辅助', () => {
  it('freeValenceHint：全满 / 有空余 / 空画布三种口径', () => {
    const water = { atoms: [{ id: 1, el: 'O' }, { id: 2, el: 'H' }, { id: 3, el: 'H' }] as Atom[], bonds: [{ a: 1, b: 2, order: 1 as const }, { a: 1, b: 3, order: 1 as const }] };
    expect(freeValenceHint(water.atoms, water.bonds)).toContain('已用满');
    const single = { atoms: [{ id: 1, el: 'O' }] as Atom[], bonds: [] as Bond[] };
    expect(freeValenceHint(single.atoms, single.bonds)).toContain('氧#1 余 2');
    expect(freeValenceHint([], [])).toContain('空');
  });

  it('演示分子的化学式口径不变（防止辅助改动破坏判题）', () => {
    const waterAtoms: Atom[] = [{ id: 1, el: 'O' }, { id: 2, el: 'H' }, { id: 3, el: 'H' }];
    expect(molecularFormula(waterAtoms)).toBe('H2O');
  });
});
