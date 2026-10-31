import { createContext, useContext, useEffect, useRef, type ReactNode, type MutableRefObject, type RefObject } from 'react';
import type { HandSample } from './useHandInput';
import type { SceneId } from './interaction';
import type { SceneAgentAdapter } from './agent/types';

/**
 * 平台提供给场景插件的服务契约（对应总体设计方案 6.2 学科插件契约）：
 * - notify：全局通知栏反馈
 * - cancelHand：复位手势感知（如切换捏合落笔方式时）
 * - registerPolicy：注册本场景的原始手部采样解释策略（仅激活场景收到采样）
 * - registerSnapshot：注册本场景的会话数据（用于导出学习记录）
 * - drag：跨场景共享的拖拽会话（谁在拖、从哪个参数出发）
 * 场景只通过这些接口与平台交互，不直接触碰摄像头或其他场景。
 */
export type DragSession = { scene: SceneId; initial?: Record<string, number>; x: number; y: number } | null;
export type PoseSample = { landmarks: { x: number; y: number; z: number; visibility: number }[] };
export type AppServices = {
  notify: (message: string) => void;
  cancelHand: () => void;
  registerPolicy: (scene: SceneId, handler: ((sample: HandSample) => void) | null) => void;
  /** 场景级语音策略：全局短语未命中的识别原文转交激活场景解释；返回 true 表示已消费。 */
  registerVoicePolicy: (scene: SceneId, handler: ((text: string) => boolean) | null) => void;
  /** 姿态策略：激活场景注册后平台启动 PoseLandmarker 并逐帧转交（生物实验用）。 */
  registerPosePolicy: (scene: SceneId, handler: ((sample: PoseSample) => void) | null) => void;
  registerSnapshot: (scene: SceneId, get: (() => Record<string, unknown>) | null) => void;
  /** 场景注册智能体适配器：登记本场景可被 AI 教学智能体「灵犀」执行的演示脚本。 */
  registerAgentPolicy: (scene: SceneId, adapter: SceneAgentAdapter | null) => void;
  /** TTS 播报期间暂停语音识别（防喇叭回听造成自激循环），ms 后自动恢复。 */
  pauseRecognition: (ms: number) => void;
  drag: MutableRefObject<DragSession>;
  /** 共享摄像头画面（手部与姿态识别共用的 <video> 元素）。 */
  handVideo: RefObject<HTMLVideoElement | null>;
};
const ServicesContext = createContext<AppServices | null>(null);

/** 平台与场景共享的界面设置（激光笔、落笔方式、工具等）。场景可写，平台读取以配置感知。 */
export type SceneSettings = {
  laser: boolean; setLaser: (value: boolean) => void;
  pptMode: boolean; setPptMode: (value: boolean) => void;
  backgroundCamera: boolean; setBackgroundCamera: (value: boolean) => void;
  fistUndo: boolean; setFistUndo: (value: boolean) => void;
  penInput: 'pinch' | 'space'; setPenInput: (value: 'pinch' | 'space') => void;
  tool: 'pen' | 'eraser'; setTool: (value: 'pen' | 'eraser') => void;
};
const SettingsContext = createContext<SceneSettings | null>(null);

export function SettingsProvider({ value, children }: { value: SceneSettings; children: ReactNode }) {
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSceneSettings(): SceneSettings {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('场景组件必须渲染在 SettingsProvider 内');
  return value;
}

export function ServicesProvider({ value, children }: { value: AppServices; children: ReactNode }) {
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}

export function useServices(): AppServices {
  const value = useContext(ServicesContext);
  if (!value) throw new Error('场景组件必须渲染在 ServicesProvider 内');
  return value;
}

/** 场景注册手势策略：随挂载/卸载自动登记，采样到达时始终调用最新闭包。 */
export function useScenePolicy(scene: SceneId, handler: (sample: HandSample) => void) {
  const { registerPolicy } = useServices();
  const latest = useRef(handler); latest.current = handler;
  useEffect(() => {
    registerPolicy(scene, sample => latest.current(sample));
    return () => registerPolicy(scene, null);
  }, [scene, registerPolicy]);
}

/** 场景注册会话快照：导出学习记录时由平台收集（对应 get_world_state）。 */
export function useSceneSnapshot(scene: SceneId, get: () => Record<string, unknown>) {
  const { registerSnapshot } = useServices();
  const latest = useRef(get); latest.current = get;
  useEffect(() => {
    registerSnapshot(scene, () => latest.current());
    return () => registerSnapshot(scene, null);
  }, [scene, registerSnapshot]);
}

/** 场景注册语音策略：全局短语未命中的识别原文转交本场景解释。 */
export function useSceneVoicePolicy(scene: SceneId, handler: (text: string) => boolean) {
  const { registerVoicePolicy } = useServices();
  const latest = useRef(handler); latest.current = handler;
  useEffect(() => {
    registerVoicePolicy(scene, text => latest.current(text));
    return () => registerVoicePolicy(scene, null);
  }, [scene, registerVoicePolicy]);
}

/** 场景注册智能体适配器：随挂载/卸载自动登记；演示请求始终委托最新闭包（脚本可异步）。 */
export function useSceneAgent(scene: SceneId, adapter: SceneAgentAdapter) {
  const { registerAgentPolicy } = useServices();
  const latest = useRef(adapter); latest.current = adapter;
  useEffect(() => {
    registerAgentPolicy(scene, {
      run: (script, param, say) => latest.current.run(script, param, say),
      disturb: () => latest.current.disturb?.(),
      cancel: () => latest.current.cancel(),
    });
    return () => registerAgentPolicy(scene, null);
  }, [scene, registerAgentPolicy]);
}

/** 场景注册姿态策略：随挂载/卸载自动登记；仅激活场景收到姿态采样。 */
export function useScenePosePolicy(scene: SceneId, handler: (sample: PoseSample) => void) {
  const { registerPosePolicy } = useServices();
  const latest = useRef(handler); latest.current = handler;
  useEffect(() => {
    registerPosePolicy(scene, sample => latest.current(sample));
    return () => registerPosePolicy(scene, null);
  }, [scene, registerPosePolicy]);
}

/* 音色优选缓存：voices 列表异步加载，监听 voiceschanged 保持最新。 */
let cachedVoices: SpeechSynthesisVoice[] = [];
if (typeof window !== 'undefined' && window.speechSynthesis) {
  const refresh = () => { cachedVoices = window.speechSynthesis.getVoices(); };
  refresh();
  window.speechSynthesis.addEventListener?.('voiceschanged', refresh);
}

/** Edge 的在线神经音色（晓晓/云希）需连微软语音服务；网络受限时会静默失败——
 *  失败后 90 秒内降级本地音色，之后自动重试一次（网络抖动不应永久放弃好音色）。 */
let onlineVoiceBrokenUntil = 0;

function refreshVoices() { if (window.speechSynthesis) cachedVoices = window.speechSynthesis.getVoices(); }

/** 本地（非在线）中文音色：失败可自动降级的目标。优先大陆普通话，避免误选粤语/国语。 */
function localZhVoice(): SpeechSynthesisVoice | undefined {
  const zh = cachedVoices.filter(v => /^zh|cmn/i.test(v.lang) && !/natural|online/i.test(v.name));
  const cn = zh.filter(v => v.lang.replace('_', '-').toLowerCase() === 'zh-cn');
  return cn.find(v => /google/i.test(v.name)) || cn[0] || zh[0];
}

/** 中文音色优选：优先大陆普通话（zh-CN）的在线神经音色（晓晓/云希），杜绝误选粤语（zh-HK）；
 *  在线音色失败（网络受限）后自动退回本地音色。 */
function pickZhVoice(): SpeechSynthesisVoice | undefined {
  if (!cachedVoices.length && typeof window !== 'undefined' && window.speechSynthesis) refreshVoices();   // 懒加载兜底：音色列表异步就绪前被调用
  const all = cachedVoices.filter(v => /^zh|cmn/i.test(v.lang));
  if (!all.length) return undefined;
  const mainland = all.filter(v => v.lang.replace('_', '-').toLowerCase() === 'zh-cn');
  const pool = mainland.length ? mainland : all;
  if (Date.now() >= onlineVoiceBrokenUntil) {
    const nat = pool.find(v => /natural|online/i.test(v.name))
      || pool.find(v => /xiaoxiao|晓晓|云希|云扬/i.test(v.name));
    if (nat) return nat;
  }
  const local = pool.filter(v => !/natural|online/i.test(v.name));
  return local.find(v => /google/i.test(v.name)) || local[0] || all[0];
}

/** 当前优选音色名（诊断用：教室里无声/音色异常时先看这个）。 */
export function zhVoiceName(): string {
  return pickZhVoice()?.name ?? '（系统默认音色）';
}

/** TTS 简短播报：浏览器 speechSynthesis，免 key；仅用于确认类短句。返回预计时长毫秒（供调用方暂停语音识别防回听）。 */
export function speak(text: string): number {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return 0;
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    const voice = pickZhVoice();
    const online = voice && /natural|online/i.test(voice.name);
    if (voice) utterance.voice = voice;
    // 在线神经音色语流自然可稍快；经典合成音色略放慢。
    utterance.rate = online ? 1.1 : 1.0;
    // 在线音色报错（网络受限/服务不可达）→ 降级本地音色重播同一句；90 秒后自动重试在线音色。
    utterance.onerror = () => {
      if (online && Date.now() >= onlineVoiceBrokenUntil) {
        onlineVoiceBrokenUntil = Date.now() + 90_000;
        const local = localZhVoice();
        if (local) {
          const retry = new SpeechSynthesisUtterance(text);
          retry.voice = local; retry.lang = 'zh-CN'; retry.rate = 1.0;
          synth.speak(retry);
        }
      }
    };
    synth.speak(utterance);
    return Math.max(1500, text.length * (online ? 200 : 220));
  } catch { return 0; /* 无语音合成环境时静默 */ }
}
