import { describe, expect, it } from 'vitest';
import { cooledDown, decideRules, MOLECULE_TARGETS } from './brain';
import type { AgentPerception } from './types';

const perception = (scene: AgentPerception['scene'], snapshot: Record<string, unknown>, idleMs = 0): AgentPerception => ({
  scene, snapshot, events: [], idleMs,
});

describe('灵犀规则策略 · 分子搭建', () => {
  it('超价错误：独立冷却键、立即指向出事原子、提议就地修复', () => {
    const plan = decideRules(perception('chem-molecule', {
      task: 'B', completed: false, atomCount: 6, errors: ['碳原子（#5）的键数 5 超过了它的价数 4'],
      construct: { target: 'H2O', satisfied: false },
    }));
    expect(plan?.key).toBe('molecule-error-overvalence');
    expect(plan?.say).toContain('碳原子（#5）的键数 5');
    expect(plan?.steps).toEqual([{ op: 'demo', script: 'highlight-error' }]);
    expect(plan?.offer?.label).toContain('改好它');
    expect(plan?.offer?.steps.some(s => s.op === 'demo' && s.script === 'repair-overvalence')).toBe(true);
  });

  it('重复键：独立冷却键、指向但不提议修复', () => {
    const plan = decideRules(perception('chem-molecule', {
      task: 'free', completed: false, atomCount: 3, errors: ['两个原子间出现了重复的键'],
    }));
    expect(plan?.key).toBe('molecule-error-duplicate');
    expect(plan?.steps).toEqual([{ op: 'demo', script: 'highlight-error' }]);
    expect(plan?.offer).toBeUndefined();
  });

  it('混合物（搭建中间态）：空闲超 25 秒才轻声提醒，只说话不指向、不提议', () => {
    const errors = ['画布上有 2 个互不相连的部分——它们是混合物，不是同一个分子'];
    const quiet = decideRules(perception('chem-molecule', {
      task: 'free', completed: false, atomCount: 4, errors,
    }, 26_000));
    expect(quiet?.key).toBe('molecule-error-disconnected');
    expect(quiet?.steps).toEqual([]);
    expect(quiet?.offer).toBeUndefined();
    // 刚加完原子还没连线的正常中间态 → 完全不打扰
    expect(decideRules(perception('chem-molecule', {
      task: 'free', completed: false, atomCount: 4, errors,
    }))).toBeNull();
  });

  it('超价 + 混合物同时存在 → 优先超价（可修复的错误优先于搭建中间态）', () => {
    const plan = decideRules(perception('chem-molecule', {
      task: 'free', completed: false, atomCount: 6,
      errors: ['碳原子（#5）的键数 5 超过了它的价数 4', '画布上有 2 个互不相连的部分——它们是混合物，不是同一个分子'],
    }));
    expect(plan?.key).toBe('molecule-error-overvalence');
    expect(plan?.offer).toBeDefined();
  });

  it('任务 B 未达成且空闲 → 提议演示（需确认，不自动执行）', () => {
    const plan = decideRules(perception('chem-molecule', {
      task: 'B', completed: false, atomCount: 1, errors: [], hints: 0,
      construct: { target: 'H2O', satisfied: false },
    }, 46_000));
    expect(plan?.key).toBe('molecule-demo-H2O');
    expect(plan?.offer?.label).toContain('水');
    expect(plan?.offer?.steps.some(s => s.op === 'demo' && s.script === 'demo-water')).toBe(true);
  });

  it('任务 B 已达成 → 不再提议', () => {
    const plan = decideRules(perception('chem-molecule', {
      task: 'B', completed: false, atomCount: 3, errors: [],
      construct: { target: 'H2O', satisfied: true },
    }, 120_000));
    expect(plan).toBeNull();
  });

  it('未知目标化学式 → 静默跳过', () => {
    const plan = decideRules(perception('chem-molecule', {
      task: 'B', completed: false, atomCount: 1, errors: [],
      construct: { target: 'X9', satisfied: false },
    }, 120_000));
    expect(plan).toBeNull();
  });

  it('任务 C：未保存结构 → 提议演示正丁烷；已保存 ① → 提议演示异丁烷', () => {
    const base = { task: 'C', completed: false, atomCount: 0, errors: [] };
    const planN = decideRules(perception('chem-molecule', { ...base, compare: { saved: [], satisfied: false } }, 46_000));
    expect(planN?.key).toBe('molecule-demo-butane-n');
    expect(planN?.offer?.steps.some(s => s.op === 'demo' && s.script === 'demo-butane-n')).toBe(true);
    const planIso = decideRules(perception('chem-molecule', { ...base, compare: { saved: ['C4H10'], satisfied: false } }, 46_000));
    expect(planIso?.key).toBe('molecule-demo-butane-iso');
    expect(planIso?.offer?.label).toContain('异丁烷');
    // 已保存两结构（判异成立）→ 不再打扰
    expect(decideRules(perception('chem-molecule', { ...base, compare: { saved: ['C4H10', 'C4H10'], satisfied: true } }, 46_000))).toBeNull();
  });

  it('任务 C 刚进入（未空闲）→ 不打扰', () => {
    expect(decideRules(perception('chem-molecule', {
      task: 'C', completed: false, atomCount: 0, errors: [], compare: { saved: [], satisfied: false },
    }))).toBeNull();
  });

  it('演示模式 + VSEPR 几何 + 空闲 → 提议推氢回弹（长冷却）；条件不符不打扰', () => {
    const plan = decideRules(perception('chem-molecule', {
      task: 'free', completed: false, atomCount: 4, errors: [], geoMode: 'vsepr',
    }, 61_000));
    expect(plan?.key).toBe('molecule-springback');
    expect(plan?.cooldownMs).toBe(180_000);
    expect(plan?.offer?.steps.some(s => s.op === 'demo' && s.script === 'demo-springback')).toBe(true);
    // 自由摆放几何下没有"弹回"可言
    expect(decideRules(perception('chem-molecule', {
      task: 'free', completed: false, atomCount: 4, errors: [], geoMode: 'free',
    }, 61_000))).toBeNull();
    // 任务 B 的演示提议优先于实验提议
    expect(decideRules(perception('chem-molecule', {
      task: 'B', completed: false, atomCount: 1, errors: [], geoMode: 'vsepr',
      construct: { target: 'H2O', satisfied: false },
    }, 61_000))?.key).toBe('molecule-demo-H2O');
  });

  it('任务 A 答错且空闲 → 引导用搭建验证', () => {
    const plan = decideRules(perception('chem-molecule', {
      task: 'A', completed: false, atomCount: 0, errors: [], quiz: { element: 'O', prediction: 4, correct: false },
    }, 25_000));
    expect(plan?.key).toBe('molecule-verify');
    expect(plan?.say).toContain('搭');
  });

  it('快照缺字段/类型不对 → 防御式跳过不抛错', () => {
    expect(() => decideRules(perception('chem-molecule', { garbage: [1, {}, undefined] }))).not.toThrow();
    expect(decideRules(perception('chem-molecule', {}))).toBeNull();
  });

  it('目标表覆盖全部 5 个任务 B 化学式（对齐 MoleculeScene 的 B_TARGETS）', () => {
    expect(Object.keys(MOLECULE_TARGETS).sort()).toEqual(['CH4', 'CO2', 'H2O', 'NH3', 'O2']);
  });
});

describe('灵犀规则策略 · 函数绘图', () => {
  it('两笔未识别 → 给绘制要领', () => {
    const plan = decideRules(perception('functions', { task: 'free', completed: false, strokes: 2, lastFit: null }));
    expect(plan?.key).toBe('functions-advise');
    expect(plan?.say).toContain('从画布最左一路扫到最右');
  });

  it('任务 B 多笔未达成 → 提议看灵犀改一遍', () => {
    const plan = decideRules(perception('functions', {
      task: 'B', completed: false, strokes: 3, lastFit: { family: 'linear', rmse: 0.05 },
      construct: { target: '开口向上的碗', satisfied: false },
    }));
    expect(plan?.offer?.steps.some(s => s.op === 'demo' && s.script === 'draw-target')).toBe(true);
  });

  it('任务 B 有拟合但不匹配 → 点出最近一笔的族别差异', () => {
    const plan = decideRules(perception('functions', {
      task: 'B', completed: false, strokes: 2, lastFit: { family: 'linear', rmse: 0.04 },
      construct: { target: '开口向上的碗', satisfied: false },
    }));
    expect(plan?.key).toBe('functions-demo-b');
    expect(plan?.say).toContain('直线');
    expect(plan?.say).toContain('开口向上的碗');
    expect(plan?.offer?.label).toContain('改一笔');
  });

  it('任务 B 达成 → 不再提议改一笔', () => {
    expect(decideRules(perception('functions', {
      task: 'B', completed: false, strokes: 2, lastFit: { family: 'quadratic', rmse: 0.03 },
      construct: { target: '开口向上的碗', satisfied: true },
    }))).toBeNull();
  });

  it('任务 A 预测错误 → 提议示范并用身体验证', () => {
    const plan = decideRules(perception('functions', {
      task: 'A', completed: false, strokes: 0, lastFit: null,
      quiz: { target: '一条直线', prediction: 'quadratic', correct: false },
    }, 21_000));
    expect(plan?.key).toBe('functions-demo-a');
    expect(plan?.offer?.label).toContain('画一遍');
  });

  it('已完成 → 一次鼓励', () => {
    const plan = decideRules(perception('functions', { task: 'B', completed: true, strokes: 4, lastFit: { family: 'sine', rmse: 0.03 } }));
    expect(plan?.key).toBe('functions-done');
  });
});

describe('灵犀规则策略 · 陶艺工坊', () => {
  it('任务 B 造型未达成且空闲 → 提议修坯', () => {
    const plan = decideRules(perception('art-pottery', {
      task: 'B', completed: false, construct: { target: '高瘦的瓶', satisfied: false },
    }, 46_000));
    expect(plan?.key).toBe('pottery-fix-高瘦的瓶');
    expect(plan?.offer?.label).toContain('修成高瘦的瓶');
    expect(plan?.offer?.steps.some(s => s.op === 'demo' && s.script === 'fix-shape')).toBe(true);
    expect(plan?.offer?.steps[0].op === 'say' && plan?.offer?.steps[0].text.includes('长宽比')).toBe(true);
  });

  it('任务 B 达成 / 未空闲 → 不打扰', () => {
    expect(decideRules(perception('art-pottery', {
      task: 'B', completed: false, construct: { target: '宽扁的碗', satisfied: true },
    }, 46_000))).toBeNull();
    expect(decideRules(perception('art-pottery', {
      task: 'B', completed: false, construct: { target: '宽扁的碗', satisfied: false },
    }))).toBeNull();
  });
});

describe('触发冷却', () => {
  it('同一键在冷却窗口内不重复触发，超过窗口后重新生效', () => {
    const map = new Map<string, number>();
    expect(cooledDown('k', map, 1000)).toBe(true);
    map.set('k', 1000);
    expect(cooledDown('k', map, 1000 + 89_999)).toBe(false);
    expect(cooledDown('k', map, 1000 + 90_000)).toBe(true);
  });
});
