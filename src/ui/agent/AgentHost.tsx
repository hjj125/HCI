import type { MutableRefObject } from 'react';
import type { SceneId } from '../../core/interaction';
import type { SceneAgentAdapter } from '../../core/agent/types';
import { AGENT_SCENE_TITLES } from '../../core/agent/brain';
import { useAgentRuntime } from '../../core/agent/useAgentRuntime';
import { AgentPanel } from './AgentPanel';

/** 平台壳挂载的智能体宿主：接入运行时（总线订阅/轮询/TTS）并渲染浮动面板。
 *  演示能力来自各场景经 useSceneAgent 登记的适配器；面板开关与折叠状态由壳持有（Esc 可关闭）。 */
export function AgentHost(props: {
  scene: SceneId;
  enabled: boolean;
  open: boolean;
  setOpen: (v: boolean) => void;
  policies: MutableRefObject<Map<SceneId, SceneAgentAdapter>>;
  snapshots: MutableRefObject<Map<SceneId, () => Record<string, unknown>>>;
  cameraOn: boolean;
}) {
  const rt = useAgentRuntime({ scene: props.scene, enabled: props.enabled, policies: props.policies, snapshots: props.snapshots });
  const sceneTitle = AGENT_SCENE_TITLES[props.scene] ?? props.scene;
  return <AgentPanel {...rt} enabled={props.enabled} open={props.open} setOpen={props.setOpen} sceneTitle={sceneTitle} cameraOn={props.cameraOn} />;
}
