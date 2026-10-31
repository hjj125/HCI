import type { Element } from './molecule';

/** 灵犀演示脚本（数据即编排）：原子序列 + 键列表（引用原子下标；order 指定单/双键）。
 *  执行器在 MoleculeScene 内按闭环搭建器运行（buildPlanner 规划 + 世界模型预测 + 复核），
 *  演示规格 = 目标状态。quiz 为搭完后的苏格拉底式反问。 */
export type MoleculeDemo = {
  atoms: Element[];
  bonds: { a: number; b: number; order: 1 | 2 }[];
  /** 演示完成时的总结语。 */
  summary: string;
  /** 搭完后的反问（收尾用，可选）。 */
  quiz?: string;
};

export const MOLECULE_DEMOS: Record<string, MoleculeDemo> = {
  'demo-water': {
    atoms: ['O', 'H', 'H'],
    bonds: [{ a: 0, b: 1, order: 1 }, { a: 0, b: 2, order: 1 }],
    summary: '1 个氧连接 2 个氢——氧的价数是 2，正好填满。',
    quiz: '为什么氧只连两个氢，而不是三个？',
  },
  'demo-oxygen': {
    atoms: ['O', 'O'],
    bonds: [{ a: 0, b: 1, order: 2 }],
    summary: '两个氧各出 2 个价键，共用一根双键 O=O。',
    quiz: '为什么两个氧要共用两对电子？',
  },
  'demo-co2': {
    atoms: ['C', 'O', 'O'],
    bonds: [{ a: 0, b: 1, order: 2 }, { a: 0, b: 2, order: 2 }],
    summary: '碳的价数是 4，分给两个氧各一根双键 O=C=O。',
    quiz: '为什么 CO₂ 是直线形，而水是折角形？',
  },
  'demo-ammonia': {
    atoms: ['N', 'H', 'H', 'H'],
    bonds: [{ a: 0, b: 1, order: 1 }, { a: 0, b: 2, order: 1 }, { a: 0, b: 3, order: 1 }],
    summary: '氮的价数是 3，连 3 个氢。',
    quiz: '为什么氨是三角锥形，而不是平面三角形？',
  },
  'demo-methane': {
    atoms: ['C', 'H', 'H', 'H', 'H'],
    bonds: [{ a: 0, b: 1, order: 1 }, { a: 0, b: 2, order: 1 }, { a: 0, b: 3, order: 1 }, { a: 0, b: 4, order: 1 }],
    summary: '碳的价数是 4，连 4 个氢——空间上是正四面体。',
    quiz: '为什么四个键要张开成正四面体，而不是十字交叉？',
  },
  'demo-butane-n': {
    atoms: ['C', 'C', 'C', 'C', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'],
    bonds: [
      { a: 0, b: 1, order: 1 }, { a: 1, b: 2, order: 1 }, { a: 2, b: 3, order: 1 },
      { a: 0, b: 4, order: 1 }, { a: 0, b: 5, order: 1 }, { a: 0, b: 6, order: 1 },
      { a: 1, b: 7, order: 1 }, { a: 1, b: 8, order: 1 },
      { a: 2, b: 9, order: 1 }, { a: 2, b: 10, order: 1 },
      { a: 3, b: 11, order: 1 }, { a: 3, b: 12, order: 1 }, { a: 3, b: 13, order: 1 },
    ],
    summary: '直链「正丁烷」：四个碳连成一条链，两端碳各带 3 个氢、中间碳各带 2 个氢。',
    quiz: '同样的 4 个碳和 10 个氢，还能怎么连？',
  },
  'demo-butane-iso': {
    atoms: ['C', 'C', 'C', 'C', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H', 'H'],
    bonds: [
      { a: 0, b: 1, order: 1 }, { a: 0, b: 2, order: 1 }, { a: 0, b: 3, order: 1 },
      { a: 0, b: 4, order: 1 },
      { a: 1, b: 5, order: 1 }, { a: 1, b: 6, order: 1 }, { a: 1, b: 7, order: 1 },
      { a: 2, b: 8, order: 1 }, { a: 2, b: 9, order: 1 }, { a: 2, b: 10, order: 1 },
      { a: 3, b: 11, order: 1 }, { a: 3, b: 12, order: 1 }, { a: 3, b: 13, order: 1 },
    ],
    summary: '叉链「异丁烷」：中心碳连着三个碳、自己再带一个氢——与正丁烷化学式相同、连接方式不同。',
    quiz: '两种结构化学式相同、连接方式不同——这叫什么？',
  },
};
