/** 化学分子搭建内核：价键规则、连通性、希尔式与同分异构判别（确定性纯函数，可单元测试）。
 *  教学简化：仅 H/C/N/O 四种元素，价键 H=1 C=4 N=3 O=2；支持单键/双键；
 *  不含离子键/金属键，不做键角约束与能量优化。
 */

export type Element = 'H' | 'C' | 'N' | 'O';
export const VALENCE: Record<Element, number> = { H: 1, C: 4, N: 3, O: 2 };
export const ELEMENT_ZH: Record<Element, string> = { H: '氢', C: '碳', N: '氮', O: '氧' };

export type Atom = { id: number; el: Element };
export type Bond = { a: number; b: number; order: 1 | 2 }; // 约定 a < b

export type MoleculeError = { kind: 'overvalence' | 'disconnected' | 'duplicate'; detail: string; atoms: number[] };

/** 键去重键（无序对）。 */
export const bondKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** 校验：超价 / 重复键 / 不连通（多孤立部分 = 混合物不是分子）。 */
export function validateMolecule(atoms: Atom[], bonds: Bond[]): { ok: boolean; errors: MoleculeError[] } {
  const errors: MoleculeError[] = [];
  const byId = new Map(atoms.map(a => [a.id, a]));
  const used = new Map<number, number>();
  const seen = new Set<string>();
  for (const b of bonds) {
    if (!byId.has(b.a) || !byId.has(b.b) || b.a === b.b) continue;
    const key = bondKey(b.a, b.b);
    if (seen.has(key)) { errors.push({ kind: 'duplicate', detail: '两个原子间出现了重复的键', atoms: [b.a, b.b] }); continue; }
    seen.add(key);
    used.set(b.a, (used.get(b.a) ?? 0) + b.order);
    used.set(b.b, (used.get(b.b) ?? 0) + b.order);
  }
  for (const a of atoms) {
    const u = used.get(a.id) ?? 0;
    if (u > VALENCE[a.el]) errors.push({ kind: 'overvalence', detail: `${ELEMENT_ZH[a.el]}原子（#${a.id}）的键数 ${u} 超过了它的价数 ${VALENCE[a.el]}`, atoms: [a.id] });
  }
  // 连通分量（BFS）。
  const adj = new Map<number, number[]>();
  for (const a of atoms) adj.set(a.id, []);
  for (const b of bonds) {
    if (!adj.has(b.a) || !adj.has(b.b)) continue;
    adj.get(b.a)!.push(b.b);
    adj.get(b.b)!.push(b.a);
  }
  const seenAtom = new Set<number>();
  const components: number[][] = [];
  for (const a of atoms) {
    if (seenAtom.has(a.id)) continue;
    const comp: number[] = [];
    const queue = [a.id];
    seenAtom.add(a.id);
    while (queue.length) {
      const cur = queue.shift()!;
      comp.push(cur);
      for (const n of adj.get(cur) ?? []) if (!seenAtom.has(n)) { seenAtom.add(n); queue.push(n); }
    }
    components.push(comp);
  }
  if (components.length > 1) {
    errors.push({ kind: 'disconnected', detail: `画布上有 ${components.length} 个互不相连的部分——它们是混合物，不是同一个分子`, atoms: components.flat() });
  }
  return { ok: errors.length === 0, errors };
}

/** 分子式（教科书惯例顺序：碳优先、氢其次、其余字母序；无碳时氮优先于氢，如 NH3）。
 *  数目为 1 时省略。 */
export function molecularFormula(atoms: Atom[]): string {
  const count = new Map<Element, number>();
  for (const a of atoms) count.set(a.el, (count.get(a.el) ?? 0) + 1);
  if (!count.size) return '—';
  const rest = [...count.keys()] as Element[];
  let order: Element[];
  if (count.has('C')) order = ['C', 'H', ...rest.filter(e => e !== 'C' && e !== 'H').sort()] as Element[];
  else order = ['N', 'H', ...rest.filter(e => e !== 'N' && e !== 'H').sort()] as Element[];
  return order.filter(el => count.has(el)).map(el => `${el}${(count.get(el) ?? 0) > 1 ? count.get(el) : ''}`).join('');
}

/** 每原子结构签名：元素 + 邻居（元素+键级）多重集。 */
function signatures(atoms: Atom[], bonds: Bond[]): string[] {
  const el = new Map(atoms.map(a => [a.id, a.el]));
  const adj = new Map<number, string[]>();
  for (const a of atoms) adj.set(a.id, []);
  for (const b of bonds) {
    if (!el.has(b.a) || !el.has(b.b)) continue;
    adj.get(b.a)!.push(`${el.get(b.b)}${b.order}`);
    adj.get(b.b)!.push(`${el.get(b.a)}${b.order}`);
  }
  return atoms.map(a => `${a.el}:${(adj.get(a.id) ?? []).sort().join(',')}`);
}

/** 同分异构判别（教学级充分条件）：化学式相同的前提下，逐原子结构签名多重集不同 → 必为不同结构。
 *  能区分正/异丁烷（中心碳连接数 2 vs 3）、乙醇/二甲醚（氧的邻居不同）等课标案例；
 *  签名相同不必然同构，此函数只用于"判不同"。 */
export function isomerDifferent(atomsA: Atom[], bondsA: Bond[], atomsB: Atom[], bondsB: Bond[]): boolean {
  if (molecularFormula(atomsA) !== molecularFormula(atomsB)) return false;
  if (atomsA.length !== atomsB.length) return false;
  const sa = [...signatures(atomsA, bondsA)].sort();
  const sb = [...signatures(atomsB, bondsB)].sort();
  return sa.some((v, i) => v !== sb[i]);
}

/** 已达满价的原子 id 列表（剩余键位为 0；超价中态也算"已到头"）。 */
export function fullValenceIds(atoms: Atom[], bonds: Bond[]): number[] {
  const used = usedValenceMap(bonds);
  return atoms.filter(a => (used.get(a.id) ?? 0) >= VALENCE[a.el]).map(a => a.id);
}

function usedValenceMap(bonds: Bond[]): Map<number, number> {
  const used = new Map<number, number>();
  for (const b of bonds) {
    used.set(b.a, (used.get(b.a) ?? 0) + b.order);
    used.set(b.b, (used.get(b.b) ?? 0) + b.order);
  }
  return used;
}

/** 剩余键位提示（②面板与灵犀 LLM 上下文用）：全部满价 / 还有空余键位的原子清单。 */
export function freeValenceHint(atoms: Atom[], bonds: Bond[]): string {
  if (!atoms.length) return '画布为空。';
  const used = usedValenceMap(bonds);
  const free = atoms
    .map(a => ({ a, n: Math.max(0, VALENCE[a.el] - (used.get(a.id) ?? 0)) }))
    .filter(x => x.n > 0);
  if (!free.length) return '全部原子的价键都已用满——不能再连新的键了。';
  return `还有空余键位：${free.slice(0, 4).map(x => `${ELEMENT_ZH[x.a.el]}#${x.a.id} 余 ${x.n}`).join('、')}${free.length > 4 ? ' 等' : ''}。`;
}

/** 常见分子的中文名（化学式→名；C2H6O 有乙醇/二甲醚两解，故意不收录）。 */
export const NAME_ZH: Record<string, string> = {
  H2O: '水', H2O2: '过氧化氢', O2: '氧气', CO2: '二氧化碳', NH3: '氨', CH4: '甲烷',
  CH2O: '甲醛', CH4O: '甲醇', C4H10: '丁烷',
};
