import type { SceneId } from '../interaction';
import type { AgentPerception, AgentPlan } from './types';

/**
 * 灵犀的决策内核（规则策略层）：由感知决定是否介入、说什么、演示什么。
 * 确定性、可离线、可单测；LLM 只负责把这里的"事实文案"讲得更口语、以及回答学生自由提问。
 * 快照是场景会话快照（Record<string, unknown>），全部防御式取值——缺字段时规则静默跳过。
 */

/** 试点场景的标题（LLM 提示词上下文用；未列出的场景回退到场景 id）。 */
export const AGENT_SCENE_TITLES: Partial<Record<SceneId, string>> = {
  'chem-molecule': '分子搭建',
  'functions': '人体函数绘图仪',
  'art-pottery': '陶艺工坊',
};

/** 函数族中文名（快照 lastFit.family → 讲解用）。 */
export const FUNCTION_FAMILY_ZH: Record<string, string> = { linear: '直线', quadratic: '抛物线', sine: '正弦' };

/** 分子任务 B 目标化学式 → 中文名与演示脚本（与 MoleculeScene 的 B_TARGETS 对齐，由单测校验一致性）。 */
export const MOLECULE_TARGETS: Record<string, { zh: string; script: string }> = {
  H2O: { zh: '水', script: 'demo-water' },
  O2: { zh: '氧气', script: 'demo-oxygen' },
  CO2: { zh: '二氧化碳', script: 'demo-co2' },
  NH3: { zh: '氨', script: 'demo-ammonia' },
  CH4: { zh: '甲烷', script: 'demo-methane' },
};

const asStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const asNum = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);
const asBool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const asObj = (v: unknown): Record<string, unknown> | null =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);
const asStrArr = (v: unknown): string[] | null =>
  (Array.isArray(v) ? v.filter(x => typeof x === 'string') as string[] : null);
/** 同一触发键的冷却窗口判断（纯函数）：上一次触发距今不足 cooldownMs 则不再打扰。 */
export function cooledDown(key: string, lastFired: ReadonlyMap<string, number>, now: number, cooldownMs = 90_000): boolean {
  const last = lastFired.get(key);
  return last === undefined || now - last >= cooldownMs;
}

/** 规则策略入口：返回 null 表示本次轮询不介入。 */
export function decideRules(p: AgentPerception): AgentPlan | null {
  if (p.scene === 'chem-molecule') return moleculePlan(p);
  if (p.scene === 'functions') return functionsPlan(p);
  if (p.scene === 'art-pottery') return potteryPlan(p);
  return null;
}

function moleculePlan(p: AgentPerception): AgentPlan | null {
  const s = p.snapshot;
  const completed = asBool(s.completed) ?? false;
  const errors = asStrArr(s.errors) ?? [];
  const atomCount = asNum(s.atomCount) ?? 0;
  const task = asStr(s.task);
  // 1) 结构错误优先——按错误类型分冷却键：搭建中的"混合物"是正常中间态，不该吃掉超价修复的冷却名额。
  //    超价/重复键 = "连上了但连错"：立即指向出事原子（非破坏性），超价可提议就地修复（需学生确认）。
  //    混合物 = 原子还没连完：搭建中属预期，空闲 25 秒以上才轻声提醒，只说话、不抢选中。
  if (!completed && errors.length > 0 && atomCount > 0) {
    const overvalenceErr = errors.find(t => t.includes('超过了它的价数'));
    const duplicateErr = errors.find(t => t.includes('重复的键'));
    if (overvalenceErr || duplicateErr) {
      const first = overvalenceErr ?? duplicateErr!;
      return {
        key: overvalenceErr ? 'molecule-error-overvalence' : 'molecule-error-duplicate',
        say: `画布上的分子有个小问题：${first}。检查原子的价键是不是超了，或者有没有连错。`,
        steps: [{ op: 'demo', script: 'highlight-error' }],
        offer: overvalenceErr ? {
          label: '看灵犀改好它',
          steps: [
            { op: 'say', text: '好——灵犀不重搭，就在你这块分子上动手：拆掉一个多余的氢，再重新判一次。' },
            { op: 'demo', script: 'repair-overvalence' },
          ],
        } : undefined,
      };
    }
    const disconnectedErr = errors.find(t => t.includes('互不相连'));
    if (disconnectedErr && p.idleMs > 25_000) {
      return {
        key: 'molecule-error-disconnected',
        say: `画布上的分子有个小问题：${disconnectedErr}。把同一个分子里的原子两两连起来。`,
        steps: [],
      };
    }
    return null;
  }
  // 2) 任务 B 久攻不下 → 提议演示（需学生确认，演示会先清空画布）。
  const construct = asObj(s.construct);
  if (!completed && task === 'B' && construct && !(asBool(construct.satisfied) ?? false)) {
    const target = asStr(construct.target) ?? '';
    const meta = MOLECULE_TARGETS[target];
    if (meta) return {
      key: `molecule-demo-${target}`,
      say: `任务 B 要搭「${meta.zh}」。先想想中心原子能形成几个键；也可以让灵犀演示一遍。`,
      steps: [],
      offer: {
        label: `看灵犀搭${meta.zh}`,
        steps: [
          { op: 'say', text: '好——看仔细：先清空画布，再逐个添加原子，然后逐对点选成键。' },
          { op: 'demo', script: meta.script },
        ],
      },
    };
  }
  // 3) 任务 C 同分异构体：先演示直链正丁烷，保存 ① 后再演示叉链异丁烷。
  const compare = asObj(s.compare);
  if (!completed && task === 'C' && compare && p.idleMs > 45_000) {
    const saved = asStrArr(compare.saved) ?? [];
    if (saved.length === 0) return {
      key: 'molecule-demo-butane-n',
      say: '任务 C 要用 4 个碳和 10 个氢搭两种结构。先看灵犀搭一条直链的正丁烷。',
      steps: [],
      offer: {
        label: '看灵犀搭正丁烷',
        steps: [
          { op: 'say', text: '好——先清空画布，把四个碳连成一条链，再给每个碳补满氢。' },
          { op: 'demo', script: 'demo-butane-n' },
        ],
      },
    };
    if (saved.length === 1 && !(asBool(compare.satisfied) ?? false)) return {
      key: 'molecule-demo-butane-iso',
      say: '第一种结构已保存。第二种要"连接方式不同"——看灵犀搭中心碳连三个碳的叉链。',
      steps: [],
      offer: {
        label: '看灵犀搭异丁烷',
        steps: [
          { op: 'say', text: '看好——这次中心碳要连三个碳，自己再带一个氢。' },
          { op: 'demo', script: 'demo-butane-iso' },
        ],
      },
    };
  }
  // 4) 已请求提示但停留较久 → 轻推一把。
  const hints = asNum(s.hints) ?? 0;
  if (!completed && hints >= 1 && p.idleMs > 30_000)
    return { key: 'molecule-nudge', say: '提示已经给出去了。按任务卡的步骤再试一次；卡住的话可以直接打字问灵犀。', steps: [] };
  // 5) 任务 A 答错 → 引导用搭建验证（价键预测的验证主场）。
  const quiz = asObj(s.quiz);
  if (!completed && task === 'A' && quiz && (asBool(quiz.correct) ?? true) === false && p.idleMs > 20_000)
    return { key: 'molecule-verify', say: '答错不要紧——用托盘现场搭一下就能验证：把这种原子加进画布，看它能连几根键。', steps: [] };
  // 6) 演示模式 + 理想几何 + 画布有分子 → 提议"推氢回弹"具身小实验（低频，用更长冷却）。
  const geoMode = asStr(s.geoMode);
  if (!completed && task === 'free' && geoMode === 'vsepr' && atomCount > 0 && p.idleMs > 60_000)
    return {
      key: 'molecule-springback',
      cooldownMs: 180_000,
      say: '想看一个好玩的吗？灵犀可以把一个氢拖离理想位置，你再盯着它弹回来。',
      steps: [],
      offer: {
        label: '看灵犀推氢回弹',
        steps: [
          { op: 'say', text: '看好——我抓住这个氢，拖离它的理想位置，然后松手。' },
          { op: 'demo', script: 'demo-springback' },
        ],
      },
    };
  return null;
}

function functionsPlan(p: AgentPerception): AgentPlan | null {
  const s = p.snapshot;
  const completed = asBool(s.completed) ?? false;
  const task = asStr(s.task);
  const strokes = asNum(s.strokes) ?? 0;
  // 1) 连续画不出 → 给绘制要领（拒识的最常见原因是幅度不足或中途停顿）。
  const lastFit = asObj(s.lastFit);
  if (!completed && strokes >= 2 && !lastFit)
    return { key: 'functions-advise', say: `已经画了 ${strokes} 笔还没识别出来。要点：从画布最左一路扫到最右，高度变化至少占画布的一成，中途不要停顿或折返。`, steps: [] };
  // 2) 任务 B 久攻不下 → 点出最近一笔与目标的差距，并提议"看灵犀改一笔"。
  const construct = asObj(s.construct);
  if (!completed && task === 'B' && construct && !(asBool(construct.satisfied) ?? false) && strokes >= 2) {
    const target = asStr(construct.target) ?? '';
    const lastFit = asObj(s.lastFit);
    const fam = lastFit ? FUNCTION_FAMILY_ZH[asStr(lastFit.family) ?? ''] ?? null : null;
    return {
      key: 'functions-demo-b',
      say: fam ? `你最近一笔是${fam}，还不符合「${target}」——看灵犀改一笔。` : '这个形状有点难吗？灵犀可以亲手画一遍给你看。',
      steps: [],
      offer: {
        label: '看灵犀改一笔',
        steps: [
          { op: 'say', text: '看好——捏合落笔，从画布最左一路扫到最右：指尖的高度就是函数值 y。' },
          { op: 'demo', script: 'draw-target' },
        ],
      },
    };
  }
  // 3) 任务 A 预测错了 → 揭晓后示范画出来，用身体验证判断。
  const quiz = asObj(s.quiz);
  if (!completed && task === 'A' && quiz && (asBool(quiz.correct) ?? true) === false && p.idleMs > 20_000)
    return {
      key: 'functions-demo-a',
      say: '答案是虚线那样的曲线。要不要灵犀画一遍，你跟着用手画一次感受一下？',
      steps: [],
      offer: {
        label: '看灵犀画一遍',
        steps: [
          { op: 'say', text: '看好——注意曲线的升降和弯折次数，这就是判族的线索。' },
          { op: 'demo', script: 'draw-target' },
        ],
      },
    };
  // 4) 完成任务 → 一次鼓励。
  if (completed && strokes > 0)
    return { key: 'functions-done', say: '任务完成！再自由画几笔，感受不同手势对应的曲线变化吧。', steps: [] };
  return null;
}

function potteryPlan(p: AgentPerception): AgentPlan | null {
  const s = p.snapshot;
  const completed = asBool(s.completed) ?? false;
  const task = asStr(s.task);
  const construct = asObj(s.construct);
  // 任务 B 造型不达标 → 提议修坯：灵犀动手把坯修到目标形状（需学生确认——修的是学生作品）。
  if (!completed && task === 'B' && construct && !(asBool(construct.satisfied) ?? false) && p.idleMs > 45_000) {
    const target = asStr(construct.target) ?? '';
    const taller = target.includes('瓶');
    return {
      key: `pottery-fix-${target}`,
      say: `造型挑战的「${target}」还没达成。灵犀可以上手帮你修坯——想先自己再试两次也行。`,
      steps: [],
      offer: {
        label: `看灵犀修成${target}`,
        steps: [
          { op: 'say', text: taller
            ? '好——盯着长宽比读数：我把坯拉高一点、收瘦一点。泥还是那块泥，变高就会变薄。'
            : '好——看最宽处怎么落到底部：我把坯压矮一点、底部放宽、口部收一点。' },
          { op: 'demo', script: 'fix-shape' },
        ],
      },
    };
  }
  return null;
}
