import { describe, expect, it } from 'vitest';
import { MOLECULE_DEMOS } from './agentAdapter';
import { MOLECULE_TARGETS } from '../../core/agent/brain';
import { isomerDifferent, molecularFormula, validateMolecule, type Atom, type Bond } from './molecule';

describe('灵犀分子演示脚本', () => {
  it('任务 B 的 5 个目标化学式都有脚本，且搭出的分子合法、化学式一致（对齐 MoleculeScene 的 B_TARGETS）', () => {
    expect(Object.keys(MOLECULE_TARGETS).sort()).toEqual(['CH4', 'CO2', 'H2O', 'NH3', 'O2']);
    for (const [formula, meta] of Object.entries(MOLECULE_TARGETS)) {
      const demo = MOLECULE_DEMOS[meta.script];
      expect(demo, `缺少脚本 ${meta.script}`).toBeTruthy();
      const atoms: Atom[] = demo.atoms.map((el, i) => ({ id: i + 1, el }));
      const bonds: Bond[] = demo.bonds.map(b => ({ a: b.a + 1, b: b.b + 1, order: b.order }));
      const v = validateMolecule(atoms, bonds);
      expect(v.ok, `${formula} → ${v.errors.map(e => e.detail).join('；')}`).toBe(true);
      expect(molecularFormula(atoms), meta.script).toBe(formula);
    }
  });

  it('脚本引用的原子下标全部有效且 a≠b', () => {
    for (const [name, demo] of Object.entries(MOLECULE_DEMOS)) {
      for (const b of demo.bonds) {
        expect(b.a).toBeGreaterThanOrEqual(0);
        expect(b.b).toBeLessThan(demo.atoms.length);
        expect(b.a, name).not.toBe(b.b);
      }
    }
  });

  it('正/异丁烷演示：化学式同为 C4H10、结构不同（isomerDifferent 判异成立）', () => {
    const build = (script: string) => {
      const demo = MOLECULE_DEMOS[script];
      const atoms: Atom[] = demo.atoms.map((el, i) => ({ id: i + 1, el }));
      const bonds: Bond[] = demo.bonds.map(b => ({ a: b.a + 1, b: b.b + 1, order: b.order }));
      return { atoms, bonds };
    };
    const n = build('demo-butane-n');
    const iso = build('demo-butane-iso');
    expect(validateMolecule(n.atoms, n.bonds).ok).toBe(true);
    expect(validateMolecule(iso.atoms, iso.bonds).ok).toBe(true);
    expect(molecularFormula(n.atoms)).toBe('C4H10');
    expect(molecularFormula(iso.atoms)).toBe('C4H10');
    expect(isomerDifferent(n.atoms, n.bonds, iso.atoms, iso.bonds)).toBe(true);
  });
});
