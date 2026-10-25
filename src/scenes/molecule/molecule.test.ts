import { describe, it, expect } from 'vitest';
import { validateMolecule, molecularFormula, isomerDifferent, type Atom, type Bond } from './molecule';

const mk = (spec: string): Atom[] => spec.split('').map((el, i) => ({ id: i + 1, el: el as Atom['el'] }));
// mk('OH H') 风格不好用，直接手写原子表。

describe('分子搭建内核 · 校验', () => {
  const O = { id: 1, el: 'O' as const }, H1 = { id: 2, el: 'H' as const }, H2 = { id: 3, el: 'H' as const }, H3 = { id: 4, el: 'H' as const };
  it('水（O-H ×2）合法', () => {
    const r = validateMolecule([O, H1, H2], [{ a: 1, b: 2, order: 1 }, { a: 1, b: 3, order: 1 }]);
    expect(r.ok).toBe(true);
  });
  it('氧连三个氢 → 超价', () => {
    const r = validateMolecule([O, H1, H2, H3], [{ a: 1, b: 2, order: 1 }, { a: 1, b: 3, order: 1 }, { a: 1, b: 4, order: 1 }]);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.kind === 'overvalence')).toBe(true);
  });
  it('双键计入价数：CO₂ 合法，C 再加一个 H → 超价', () => {
    const C = { id: 1, el: 'C' as const }, Oa = { id: 2, el: 'O' as const }, Ob = { id: 3, el: 'O' as const }, H = { id: 4, el: 'H' as const };
    const co2 = [{ a: 1, b: 2, order: 2 as const }, { a: 1, b: 3, order: 2 as const }];
    expect(validateMolecule([C, Oa, Ob], co2).ok).toBe(true);
    const bad = [...co2, { a: 1, b: 4, order: 1 as const }];
    expect(validateMolecule([C, Oa, Ob, H], bad).errors.some(e => e.kind === 'overvalence')).toBe(true);
  });
  it('两个互不相连的部分 → 混合物提示', () => {
    const r = validateMolecule([O, H1, { id: 5, el: 'C' as const }, { id: 6, el: 'H' as const }],
      [{ a: 1, b: 2, order: 1 }, { a: 5, b: 6, order: 1 }]);
    expect(r.ok).toBe(false);
    expect(r.errors.some(e => e.kind === 'disconnected')).toBe(true);
  });
  it('重复键被拒绝', () => {
    const r = validateMolecule([O, H1], [{ a: 1, b: 2, order: 1 }, { a: 2, b: 1, order: 1 }]);
    expect(r.errors.some(e => e.kind === 'duplicate')).toBe(true);
  });
});

describe('分子搭建内核 · 希尔式', () => {
  it('水/二氧化碳/甲醇/氧气/氨的规范书写', () => {
    expect(molecularFormula([{ id: 1, el: 'O' }, { id: 2, el: 'H' }, { id: 3, el: 'H' }])).toBe('H2O');
    expect(molecularFormula([{ id: 1, el: 'C' }, { id: 2, el: 'O' }, { id: 3, el: 'O' }])).toBe('CO2');
    expect(molecularFormula([{ id: 1, el: 'C' }, { id: 2, el: 'H' }, { id: 3, el: 'H' }, { id: 4, el: 'H' }, { id: 5, el: 'H' }, { id: 6, el: 'O' }])).toBe('CH4O');
    expect(molecularFormula([{ id: 1, el: 'O' }, { id: 2, el: 'O' }])).toBe('O2');
    expect(molecularFormula([{ id: 1, el: 'N' }, { id: 2, el: 'H' }, { id: 3, el: 'H' }, { id: 4, el: 'H' }])).toBe('NH3');
    expect(molecularFormula([])).toBe('—');
  });
});

describe('分子搭建内核 · 同分异构判别', () => {
  const C = (id: number) => ({ id, el: 'C' as const });
  const H = (id: number) => ({ id, el: 'H' as const });
  // 正丁烷：C1-C2-C3-C4，C1×3H、C2×2H、C3×2H、C4×3H（共 10 H）
  const nButaneAtoms = [C(1), C(2), C(3), C(4), H(5), H(6), H(7), H(8), H(9), H(10), H(11), H(12), H(13), H(14)];
  const nButaneBonds: Bond[] = [
    { a: 1, b: 2, order: 1 }, { a: 2, b: 3, order: 1 }, { a: 3, b: 4, order: 1 },
    { a: 1, b: 5, order: 1 }, { a: 1, b: 6, order: 1 }, { a: 1, b: 7, order: 1 },
    { a: 2, b: 8, order: 1 }, { a: 2, b: 9, order: 1 },
    { a: 3, b: 10, order: 1 }, { a: 3, b: 11, order: 1 },
    { a: 4, b: 12, order: 1 }, { a: 4, b: 13, order: 1 }, { a: 4, b: 14, order: 1 },
  ];
  // 异丁烷：中心 C2 连 C1/C3/C4 与 1 个 H；三个端点碳各连 3 个 H
  const isoButaneBonds: Bond[] = [
    { a: 2, b: 1, order: 1 }, { a: 2, b: 3, order: 1 }, { a: 2, b: 4, order: 1 },
    { a: 1, b: 5, order: 1 }, { a: 1, b: 6, order: 1 }, { a: 1, b: 7, order: 1 },
    { a: 3, b: 8, order: 1 }, { a: 3, b: 9, order: 1 }, { a: 3, b: 10, order: 1 },
    { a: 4, b: 11, order: 1 }, { a: 4, b: 12, order: 1 }, { a: 4, b: 13, order: 1 },
    { a: 2, b: 14, order: 1 },
  ];
  it('正丁烷与异丁烷判为不同结构', () => {
    expect(validateMolecule(nButaneAtoms, nButaneBonds).ok).toBe(true);
    expect(validateMolecule(nButaneAtoms, isoButaneBonds).ok).toBe(true);
    expect(molecularFormula(nButaneAtoms)).toBe('C4H10');
    expect(isomerDifferent(nButaneAtoms, nButaneBonds, nButaneAtoms, isoButaneBonds)).toBe(true);
  });
  it('同一结构（仅编号不同）不判为异构', () => {
    const swapped = nButaneBonds.map(b => ({ ...b, a: b.a === 1 ? 4 : b.a === 4 ? 1 : b.a, b: b.b === 1 ? 4 : b.b === 4 ? 1 : b.b }));
    expect(isomerDifferent(nButaneAtoms, nButaneBonds, nButaneAtoms, swapped)).toBe(false);
  });
  it('乙醇与二甲醚（同为 C2H6O）判为不同结构', () => {
    // 乙醇 C1-C2-O1(H)；二甲醚 C1-O1-C2
    const atoms = [C(1), C(2), { id: 3, el: 'O' as const }, H(4), H(5), H(6), H(7), H(8), H(9)];
    const ethanol: Bond[] = [
      { a: 1, b: 2, order: 1 }, { a: 2, b: 3, order: 1 },
      { a: 1, b: 4, order: 1 }, { a: 1, b: 5, order: 1 }, { a: 1, b: 6, order: 1 },
      { a: 2, b: 7, order: 1 }, { a: 2, b: 8, order: 1 }, { a: 3, b: 9, order: 1 },
    ];
    const ether: Bond[] = [
      { a: 1, b: 3, order: 1 }, { a: 3, b: 2, order: 1 },
      { a: 1, b: 4, order: 1 }, { a: 1, b: 5, order: 1 }, { a: 1, b: 6, order: 1 },
      { a: 2, b: 7, order: 1 }, { a: 2, b: 8, order: 1 }, { a: 2, b: 9, order: 1 },
    ];
    expect(validateMolecule(atoms, ethanol).ok).toBe(true);
    expect(validateMolecule(atoms, ether).ok).toBe(true);
    expect(isomerDifferent(atoms, ethanol, atoms, ether)).toBe(true);
  });
});
