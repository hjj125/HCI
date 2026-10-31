import { bondKey, molecularFormula, validateMolecule, VALENCE, type Atom, type Bond, type Element } from './molecule';
import type { MoleculeDemo } from './agentAdapter';

/**
 * 灵犀闭环搭建器（纯函数，可单测）：目标驱动的"感知 → 规划 → 预测"。
 * - planBuild：画布现状与目标的差 → 动作序列；执行器每步重新感知、只取第一步，扰动自然被重规划吸收。
 * - predictState：在副本上模拟动作，用 validateMolecule / molecularFormula / 价键计数给出预测态——
 *   灵犀的世界模型就是判题内核本身，行动前预测、行动后核对。
 * 键的匹配按"元素对+键级"多重集 + 容量约束：教学规模下充分且确定（全部演示目标都经单测验证可规划达成）。
 */

export type BuildGoal = { atoms: Element[]; bonds: { a: number; b: number; order: 1 | 2 }[] }; // a/b 为规格下标
export const goalFromSpec = (spec: MoleculeDemo): BuildGoal => ({ atoms: spec.atoms, bonds: spec.bonds });

export type BuildAction =
  | { kind: 'remove'; id: number }
  | { kind: 'add'; el: Element }
  | { kind: 'bond'; a: number; b: number; order: 1 | 2 }; // a/b 为画布原子 id

export type PredictedState = {
  atoms: Atom[];
  bonds: Bond[];
  formula: string;
  valid: boolean;
  errorCount: number;
  /** 被作用原子的"元素#id 键 n/价数"摘要（remove/bond 的 id 来自当前画布，可靠；add 为 null）。 */
  touchedSummary: string | null;
};

/** 在副本上模拟一个动作 → 预测态（世界模型）。 */
export function predictState(atoms: Atom[], bonds: Bond[], action: BuildAction): PredictedState {
  let nextAtoms = [...atoms];
  let nextBonds = [...bonds];
  let touched: number | null = null;
  if (action.kind === 'add') {
    const id = Math.max(0, ...nextAtoms.map(a => a.id)) + 1;
    nextAtoms = [...nextAtoms, { id, el: action.el }];
  } else if (action.kind === 'remove') {
    nextAtoms = nextAtoms.filter(a => a.id !== action.id);
    nextBonds = nextBonds.filter(b => b.a !== action.id && b.b !== action.id);
    touched = action.id;
  } else {
    const key = bondKey(action.a, action.b);
    const existing = nextBonds.find(b => bondKey(b.a, b.b) === key);
    if (existing) nextBonds = nextBonds.map(b => (bondKey(b.a, b.b) === key ? { ...b, order: action.order } : b));
    else nextBonds = [...nextBonds, { a: Math.min(action.a, action.b), b: Math.max(action.a, action.b), order: action.order }];
    touched = action.a;
  }
  const v = validateMolecule(nextAtoms, nextBonds);
  const t = touched != null ? nextAtoms.find(a => a.id === touched) : undefined;
  const used = t ? nextBonds.filter(b => b.a === t.id || b.b === t.id).reduce((s, b) => s + b.order, 0) : 0;
  return {
    atoms: nextAtoms,
    bonds: nextBonds,
    formula: molecularFormula(nextAtoms),
    valid: v.ok,
    errorCount: v.errors.length,
    touchedSummary: t ? `${t.el}#${t.id} 键 ${used}/${VALENCE[t.el]}` : null,
  };
}

/** 感知 → 规划：返回动作序列（执行器每步取第一个并重新感知）。目标已达成时返回 []。
 *  结构保真：画布同类元素按 id 升序与规格下标对齐（第 k 个规格 O ↔ 第 k 个画布 O），
 *  键直接按目标结构映射——正/异丁烷等"同式异构"目标不会互相串形。 */
export function planBuild(goal: BuildGoal, atoms: Atom[], bonds: Bond[]): BuildAction[] {
  const actions: BuildAction[] = [];
  // 1) 原子对齐：每类元素，画布按 id 升序取前 N 个为保留，多余删除，缺失补齐。
  const need: Partial<Record<Element, number>> = {};
  for (const el of goal.atoms) need[el] = (need[el] ?? 0) + 1;
  const have: Partial<Record<Element, number>> = {};
  for (const a of atoms) have[a.el] = (have[a.el] ?? 0) + 1;
  const keep = new Set<number>();
  const byEl = new Map<Element, Atom[]>();
  for (const a of [...atoms].sort((x, y) => x.id - y.id)) {
    if ((have[a.el] ?? 0) > 0 && (need[a.el] ?? 0) > 0) {
      keep.add(a.id);
      need[a.el] = (need[a.el] ?? 0) - 1;
      byEl.set(a.el, [...(byEl.get(a.el) ?? []), a]);
    }
  }
  for (const a of [...atoms].sort((x, y) => y.id - x.id)) if (!keep.has(a.id)) actions.push({ kind: 'remove', id: a.id });
  const specToCanvas = new Map<number, number>();
  const taken: Partial<Record<Element, number>> = {};
  for (let i = 0; i < goal.atoms.length; i++) {
    const el = goal.atoms[i];
    const list = byEl.get(el) ?? [];
    const k = taken[el] ?? 0;
    if (k < list.length) specToCanvas.set(i, list[k].id);
    taken[el] = k + 1;
  }
  for (let i = 0; i < goal.atoms.length; i++) if (!specToCanvas.has(i)) actions.push({ kind: 'add', el: goal.atoms[i] });
  // 2) 键：直接按目标结构映射到画布原子对；已有键级不足则升级，超出（不该发生）跳过。
  if (!actions.some(a => a.kind === 'add' || a.kind === 'remove')) {
    const used = new Map<number, number>();
    const currentOrder = new Map<string, 1 | 2>();
    for (const b of bonds) {
      used.set(b.a, (used.get(b.a) ?? 0) + b.order);
      used.set(b.b, (used.get(b.b) ?? 0) + b.order);
      currentOrder.set(bondKey(b.a, b.b), b.order);
    }
    for (const gb of goal.bonds) {
      const a = specToCanvas.get(gb.a), b = specToCanvas.get(gb.b);
      if (a == null || b == null) continue;
      const key = bondKey(a, b);
      const base = currentOrder.get(key) ?? 0;
      if (base >= gb.order) continue;
      const delta = gb.order - base;
      if ((used.get(a) ?? 0) + delta > VALENCE[goal.atoms[gb.a]] || (used.get(b) ?? 0) + delta > VALENCE[goal.atoms[gb.b]]) continue;
      actions.push({ kind: 'bond', a, b, order: gb.order });
      used.set(a, (used.get(a) ?? 0) + delta);
      used.set(b, (used.get(b) ?? 0) + delta);
      currentOrder.set(key, gb.order);
    }
  }
  return actions;
}
