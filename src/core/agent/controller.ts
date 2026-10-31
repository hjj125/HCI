import type { InteractionEvent, SceneId } from '../interaction';
import { cooledDown, decideRules } from './brain';
import type { AgentOp, AgentPerception, AgentPhase, AgentPlan, SceneAgentAdapter } from './types';

/**
 * 灵犀的运行时核心（框架无关，便于单测）：感知轮询 → 规则决策 → 执行行动。
 * React 层（useAgentRuntime）只负责把总线/服务/状态接进来，不包含决策逻辑。
 * 取消模型：gen 代际计数——打断或切换场景时自增，进行中的异步流程发现代际不符即退出。
 */

export type AgentControllerDeps = {
  scene: () => SceneId;
  getSnapshot: (scene: SceneId) => Record<string, unknown> | undefined;
  getAdapter: (scene: SceneId) => SceneAgentAdapter | undefined;
  /** 气泡说话（是否 TTS 由 React 层决定；传空串表示清空气泡）。 */
  say: (text: string) => void;
  /** 流式追加到气泡（LLM 增量）。 */
  appendDelta: (delta: string) => void;
  /** 发出总线事件（学习记录 / 复用 hint 通道 / 记录 agent 演示）。 */
  emit: (e: InteractionEvent) => void;
  /** LLM 把规则计划的事实文案改写成口语引导；未提供表示关闭 LLM 层。 */
  narratePlan?: (perception: AgentPerception, plan: AgentPlan, onDelta: (d: string) => void) => Promise<'ok' | 'unconfigured' | 'error'>;
  /** 学生自由提问（流式）；perception 供 LLM 上下文使用。 */
  askStream?: (question: string, history: { role: 'user' | 'assistant'; content: string }[], perception: AgentPerception, onDelta: (d: string) => void) => Promise<'ok' | 'unconfigured' | 'error'>;
  /** 状态变化回调（React 层镜像到 state）。 */
  onStateChange?: (s: { phase: AgentPhase; offer: { label: string } | null }) => void;
  now?: () => number;
  cooldownMs?: number;
};

export type AgentController = {
  poll: () => Promise<void>;
  onBusEvent: (e: { scene: SceneId; source: string; intent: string; phase: string; value?: string }) => void;
  acceptOffer: () => Promise<void>;
  dismissOffer: () => void;
  ask: (question: string) => Promise<void>;
  setEnabled: (on: boolean) => void;
  /** 中止进行中的演示并复位（场景切换时由 React 层调用）。 */
  onSceneChange: () => void;
};

export function createAgentController(deps: AgentControllerDeps): AgentController {
  const now = () => deps.now?.() ?? Date.now();
  let phase: AgentPhase = 'idle';
  let gen = 0;
  let lastEventAt = now();
  let offer: AgentPlan['offer'] | null = null;
  const ring: AgentPerception['events'] = [];
  const cooldowns = new Map<string, number>();
  const history: { role: 'user' | 'assistant'; content: string }[] = [];

  const setPhase = (p: AgentPhase) => { phase = p; notify(); };
  const setOffer = (o: AgentPlan['offer'] | null) => { offer = o; notify(); };
  const notify = () => deps.onStateChange?.({ phase, offer: offer ? { label: offer.label } : null });
  const busy = () => phase === 'thinking' || phase === 'acting';

  function perceive(): AgentPerception {
    const scene = deps.scene();
    return {
      scene,
      snapshot: deps.getSnapshot(scene) ?? {},
      events: ring.slice(-20),
      idleMs: Math.max(0, now() - lastEventAt),
    };
  }

  /** LLM 把模板文案改写成口语引导：首个增量起替换气泡，失败回退模板。 */
  async function narrate(p: AgentPerception, plan: AgentPlan, myGen: number): Promise<void> {
    if (!deps.narratePlan) return;
    setPhase('thinking');
    let replaced = false;
    const status = await deps.narratePlan(p, plan, d => {
      if (myGen !== gen) return;
      if (!replaced) { replaced = true; deps.say(''); }
      deps.appendDelta(d);
    });
    if (myGen !== gen) return;
    if (status !== 'ok') {
      deps.say(plan.say);
      if (status === 'unconfigured') cooldowns.set('llm-unconfigured', now());
    }
    if (phase === 'thinking') setPhase('idle');
  }

  /** 顺序执行行动算子；say/hint 即时完成，demo 等待适配器脚本演完。返回是否完整执行。 */
  async function executeSteps(steps: AgentOp[], scene: SceneId, myGen: number): Promise<boolean> {
    for (const step of steps) {
      if (myGen !== gen) return false;
      if (step.op === 'say') { deps.say(step.text); continue; }
      if (step.op === 'hint') { deps.emit({ scene, source: 'agent', intent: 'hint', phase: 'end' }); continue; }
      const adapter = deps.getAdapter(scene);
      if (!adapter) continue;
      setPhase('acting');
      deps.emit({ scene, source: 'agent', intent: 'run', phase: 'start', value: step.script });
      try { await adapter.run(step.script, step.param, (text: string) => deps.say(text)); }
      finally { if (myGen === gen) deps.emit({ scene, source: 'agent', intent: 'run', phase: 'end', value: step.script }); }
      if (myGen !== gen) return false;
    }
    if (myGen === gen) setPhase('idle');
    return myGen === gen;
  }

  return {
    /** 周期轮询（约 2s）：仅在已启用、空闲且当前场景登记了适配器时决策。 */
    async poll() {
      if (phase === 'off' || busy()) return;
      if (!deps.getAdapter(deps.scene())) return;
      const t = now();
      const plan = decideRules(perceive());
      if (!plan || !cooledDown(plan.key, cooldowns, t, plan.cooldownMs ?? deps.cooldownMs ?? 90_000)) return;
      cooldowns.set(plan.key, t);
      const myGen = gen;
      const p = perceive();
      if (plan.offer) {
        setOffer(plan.offer);
        deps.say(plan.say);
        await narrate(p, plan, myGen);
        return;
      }
      deps.say(plan.say);
      await narrate(p, plan, myGen);
      if (myGen !== gen) return;
      await executeSteps(plan.steps, deps.scene(), myGen);
    },

    onBusEvent(e) {
      if (e.phase === 'update') return;
      lastEventAt = now();
      ring.push({ scene: e.scene, source: e.source, intent: e.intent, phase: e.phase, value: e.value });
      if (ring.length > 40) ring.splice(0, ring.length - 40);
      // 学生的操作打断正在进行的演示：适配器实现 disturb → 软打断（自行暂停-重感知-自适应继续）；
      // 未实现 → 硬取消（智能体不与学生抢画面）。场景切换、智能体关闭始终硬取消。
      if (e.source !== 'agent' && phase === 'acting') {
        const adapter = deps.getAdapter(deps.scene());
        if (adapter?.disturb) {
          adapter.disturb();
        } else {
          gen++;
          adapter?.cancel();
          setOffer(null);
          setPhase('idle');
        }
      }
    },

    async acceptOffer() {
      if (!offer) return;
      const steps = offer.steps;
      setOffer(null);
      await executeSteps(steps, deps.scene(), gen);
    },

    dismissOffer() { setOffer(null); },

    async ask(question) {
      const q = question.trim();
      if (!deps.askStream || !q) return;
      if (phase === 'acting') { gen++; deps.getAdapter(deps.scene())?.cancel(); }
      const myGen = gen;
      setPhase('thinking');
      const payloadHistory = history.slice();
      history.push({ role: 'user', content: q });
      deps.say('');
      let text = '';
      const status = await deps.askStream(q, payloadHistory, perceive(), d => {
        if (myGen !== gen) return;
        text += d;
        deps.appendDelta(d);
      });
      if (myGen !== gen) return;
      if (status !== 'ok') {
        history.pop();
        deps.say(status === 'unconfigured'
          ? '灵犀的大模型还没有配置：在项目根目录 .env 填入 DEEPSEEK_API_KEY 并重启服务。规则助手仍然在线，可以让我演示或给提示。'
          : '这次没能连上 AI，稍后再问一次试试。');
      } else {
        history.push({ role: 'assistant', content: text });
        if (history.length > 10) history.splice(0, history.length - 10);
      }
      setPhase('idle');
    },

    setEnabled(on) {
      if (on && phase === 'off') { setPhase('idle'); return; }
      if (!on && phase !== 'off') {
        gen++;
        deps.getAdapter(deps.scene())?.cancel();
        setOffer(null);
        setPhase('off');
      }
    },

    onSceneChange() {
      cooldowns.clear();
      if (phase === 'acting') { gen++; deps.getAdapter(deps.scene())?.cancel(); }
      setOffer(null);
      ring.length = 0;
      if (phase !== 'off') setPhase('idle');
    },
  };
}
