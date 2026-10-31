import { describe, expect, it } from 'vitest';
import { goalFromSpec, planBuild, predictState, type BuildAction } from './buildPlanner';
import { MOLECULE_DEMOS } from './agentAdapter';
import { molecularFormula, validateMolecule, type Atom, type Bond } from './molecule';

/** 用世界模型逐步执行动作（与场景执行器同语义：每步重新感知、只取第一个动作）。 */
function runPlanner(goal: ReturnType<typeof goalFromSpec>, atoms: Atom[], bonds: Bond[], maxSteps = 100) {
  let cur = { atoms: [...atoms], bonds: [...bonds] };
  const log: BuildAction[] = [];
  for (let i = 0; i < maxSteps; i++) {
    const actions = planBuild(goal, cur.atoms, cur.bonds);
    if (!actions.length) break;
    const act = actions[0];
    log.push(act);
    const pred = predictState(cur.atoms, cur.bonds, act);
    cur = { atoms: pred.atoms, bonds: pred.bonds };
  }
  return { ...cur, log };
}

describe('闭环搭建规划器（buildPlanner）', () => {
  it('空画布 → 水：先补原子（按目标序），原子未齐不出键', () => {
    const goal = goalFromSpec(MOLECULE_DEMOS['demo-water']);
    const first = planBuild(goal, [], []);
    expect(first.filter(a => a.kind === 'add').map(a => (a as { el: string }).el)).toEqual(['O', 'H', 'H']);
    expect(first.some(a => a.kind === 'bond')).toBe(false);
  });

  it('目标已达成 → 空计划', () => {
    const goal = goalFromSpec(MOLECULE_DEMOS['demo-water']);
    const atoms: Atom[] = [{ id: 1, el: 'O' }, { id: 2, el: 'H' }, { id: 3, el: 'H' }];
    const bonds: Bond[] = [{ a: 1, b: 2, order: 1 }, { a: 1, b: 3, order: 1 }];
    expect(planBuild(goal, atoms, bonds)).toEqual([]);
  });

  it('杂乱画布（CH5 超价）→ 水：先删多余原子，最终收敛到合法 H2O', () => {
    const goal = goalFromSpec(MOLECULE_DEMOS['demo-water']);
    const atoms: Atom[] = [
      { id: 1, el: 'C' }, { id: 2, el: 'H' }, { id: 3, el: 'H' }, { id: 4, el: 'H' }, { id: 5, el: 'H' }, { id: 6, el: 'H' },
    ];
    const bonds: Bond[] = [
      { a: 1, b: 2, order: 1 }, { a: 1, b: 3, order: 1 }, { a: 1, b: 4, order: 1 }, { a: 1, b: 5, order: 1 }, { a: 1, b: 6, order: 1 },
    ];
    const r = runPlanner(goal, atoms, bonds);
    expect(r.log[0].kind).toBe('remove');
    expect(validateMolecule(r.atoms, r.bonds).ok).toBe(true);
    expect(molecularFormula(r.atoms)).toBe('H2O');
  });

  it('氧分子升级：已有 O-O 单键 → 只出一个升双键动作（容量按增量校验）', () => {
    const goal = goalFromSpec(MOLECULE_DEMOS['demo-oxygen']);
    const atoms: Atom[] = [{ id: 1, el: 'O' }, { id: 2, el: 'O' }];
    const bonds: Bond[] = [{ a: 1, b: 2, order: 1 }];
    expect(planBuild(goal, atoms, bonds)).toEqual([{ kind: 'bond', a: 1, b: 2, order: 2 }]);
  });

  it('全部演示目标：空画布逐步执行 → 合法分子且化学式一致；正/异丁烷骨架不串形', () => {
    const formulas: Record<string, string> = {
      'demo-water': 'H2O', 'demo-oxygen': 'O2', 'demo-co2': 'CO2',
      'demo-ammonia': 'NH3', 'demo-methane': 'CH4',
      'demo-butane-n': 'C4H10', 'demo-butane-iso': 'C4H10',
    };
    for (const [name, spec] of Object.entries(MOLECULE_DEMOS)) {
      const r = runPlanner(goalFromSpec(spec), [], []);
      expect(validateMolecule(r.atoms, r.bonds).ok, name).toBe(true);
      expect(molecularFormula(r.atoms), name).toBe(formulas[name]);
    }
    // 碳骨架度数序列：直链两端度 1；叉链中心度 3——同式异构由结构区分
    const skeleton = (script: string) => {
      const r = runPlanner(goalFromSpec(MOLECULE_DEMOS[script]), [], []);
      const isC = (id: number) => r.atoms.find(a => a.id === id)!.el === 'C';
      const carbons = r.atoms.filter(a => a.el === 'C').map(a => a.id);
      const cc = r.bonds.filter(b => isC(b.a) && isC(b.b));
      return carbons.map(id => cc.filter(b => b.a === id || b.b === id).length).sort().join(',');
    };
    expect(skeleton('demo-butane-n')).toBe('1,1,2,2');
    expect(skeleton('demo-butane-iso')).toBe('1,1,1,3');
  });

  it('世界模型：升级双键的预测与判题内核一致，摘要含目标键数', () => {
    const atoms: Atom[] = [{ id: 1, el: 'O' }, { id: 2, el: 'O' }];
    const bonds: Bond[] = [{ a: 1, b: 2, order: 1 }];
    const pred = predictState(atoms, bonds, { kind: 'bond', a: 1, b: 2, order: 2 });
    expect(pred.formula).toBe('O2');
    expect(pred.valid).toBe(true);
    expect(pred.touchedSummary).toBe('O#1 键 2/2');
  });
});
