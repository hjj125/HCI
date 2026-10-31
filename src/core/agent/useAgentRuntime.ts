import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { bus } from '../interaction';
import type { SceneId } from '../interaction';
import { speak, useServices } from '../services';
import { AGENT_SCENE_TITLES } from './brain';
import { createAgentController, type AgentController } from './controller';
import { streamAgentChat } from './llm';
import type { AgentPhase, SceneAgentAdapter } from './types';

/** 把 AgentController 接入 React：总线订阅、周期轮询、TTS/防回听与面板视图状态。
 *  决策逻辑全部在 controller（框架无关、可单测）；这里只做粘合。 */
export function useAgentRuntime(opts: {
  scene: SceneId;
  enabled: boolean;
  policies: MutableRefObject<Map<SceneId, SceneAgentAdapter>>;
  snapshots: MutableRefObject<Map<SceneId, () => Record<string, unknown>>>;
}) {
  const { pauseRecognition } = useServices();
  const [phase, setPhase] = useState<AgentPhase>('idle');
  const [bubble, setBubble] = useState('你好，我是灵犀。进入实验后我会观察你的操作，需要时给提示，也可以演示给你看。');
  const [offer, setOffer] = useState<{ label: string } | null>(null);
  const [ttsOn, setTtsState] = useState(true);
  const latest = useRef({ scene: opts.scene, ttsOn: true });
  latest.current = { scene: opts.scene, ttsOn };
  const ctlRef = useRef<AgentController | null>(null);
  if (!ctlRef.current) {
    const sceneTitle = () => AGENT_SCENE_TITLES[latest.current.scene] ?? latest.current.scene;
    ctlRef.current = createAgentController({
      scene: () => latest.current.scene,
      getSnapshot: s => opts.snapshots.current.get(s)?.(),
      getAdapter: s => opts.policies.current.get(s),
      say: text => {
        setBubble(text);
        if (text && latest.current.ttsOn) { const ms = speak(text); if (ms) pauseRecognition(ms + 800); }
      },
      appendDelta: d => setBubble(b => b + d),
      emit: e => bus.emit(e),
      narratePlan: (p, plan, onDelta) =>
        streamAgentChat({ scene: p.scene, sceneTitle: sceneTitle(), mode: 'narrate', snapshot: p.snapshot, events: p.events }, onDelta),
      askStream: (question, history, perception, onDelta) =>
        streamAgentChat({ scene: perception.scene, sceneTitle: sceneTitle(), mode: 'ask', snapshot: perception.snapshot, events: perception.events, question, history }, onDelta),
      onStateChange: s => { setPhase(s.phase); setOffer(s.offer); },
    });
  }
  useEffect(() => bus.subscribe(e => ctlRef.current?.onBusEvent({ scene: e.scene, source: e.source, intent: e.intent, phase: e.phase, value: e.value })), []);
  useEffect(() => {
    // 2 秒轮询：poll 只是读快照 + 规则匹配，开销可忽略；间隔越短，"搭错 → 指向"越跟手。
    const t = setInterval(() => { void ctlRef.current?.poll(); }, 2000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { ctlRef.current?.setEnabled(opts.enabled); }, [opts.enabled]);
  useEffect(() => { ctlRef.current?.onSceneChange(); }, [opts.scene]);
  return {
    phase, bubble, offer,
    ttsOn, setTtsOn: (v: boolean) => setTtsState(v),
    accept: () => ctlRef.current?.acceptOffer(),
    dismiss: () => ctlRef.current?.dismissOffer(),
    ask: (q: string) => ctlRef.current?.ask(q),
  };
}

/** AgentPanel 的视图属性 = 运行时返回值 + 壳层传入的开关状态。 */
export type AgentRuntimeView = ReturnType<typeof useAgentRuntime> & {
  enabled: boolean; open: boolean; setOpen: (v: boolean) => void; sceneTitle: string; cameraOn: boolean;
};

export type { AgentPhase };
