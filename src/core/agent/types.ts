import type { SceneId } from '../interaction';

/**
 * 具身教学智能体「灵犀」的平台层类型。
 * 三层闭环：感知（AgentPerception）→ 决策（AgentPlan，由 brain 规则策略产出）→ 行动（AgentOp / SceneAgentAdapter）。
 */

/** 智能体运行阶段（驱动面板状态胶囊与化身动画）。 */
export type AgentPhase = 'off' | 'idle' | 'perceiving' | 'thinking' | 'acting' | 'speaking';

/** 行动算子：say=气泡+TTS；demo=派发场景适配器的演示脚本；hint=复用总线既有提示通道。 */
export type AgentOp =
  | { op: 'say'; text: string }
  | { op: 'demo'; script: string; param?: string }
  | { op: 'hint' };

/** 一次规则决策的产出。key 同时用作冷却键；offer 非空时动作需学生确认（避免覆盖学生的操作成果）。
 *  cooldownMs 可为个别触发键指定不同的冷却窗口（如低频实验类提议）。 */
export type AgentPlan = {
  key: string;
  say: string;
  steps: AgentOp[];
  cooldownMs?: number;
  offer?: { label: string; steps: AgentOp[] };
};

/** 感知输入：场景身份 + 会话快照 + 最近语义事件 + 空闲时长。 */
export type AgentPerception = {
  scene: SceneId;
  snapshot: Record<string, unknown>;
  /** 最近交互事件（旧→新；已排除 update 帧）。 */
  events: { scene: SceneId; source: string; intent: string; phase: string; value?: string }[];
  /** 距最后一次交互事件的毫秒数。 */
  idleMs: number;
};

/** 场景适配器：场景向平台登记的演示能力（经 useSceneAgent 注册）。 */
export type SceneAgentAdapter = {
  /**
   * 按名执行演示脚本；返回 Promise 时，resolve 表示整个脚本演完（供运行时记录与取消）。
   * say 是灵犀的声音（气泡打字机 + TTS 播报 + 语音识别防回听）：脚本的关键节点
   * （预测、应验、扰动重看、完成总结）应走 say 让用户"听见"，过程性提示仍走 notify。
   */
  run: (script: string, param?: string, say?: (text: string) => void) => void | Promise<void>;
  /** 学生操作打断演示时的"软打断"钩子（可选）：实现者自行暂停-重感知-自适应继续；
   *  未实现则运行时回退为硬取消（学生操作即打断）。 */
  disturb?: () => void;
  /** 中止进行中的演示（场景切换、智能体关闭等硬取消时机由运行时调用）。 */
  cancel: () => void;
};
