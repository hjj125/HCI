import { createContext, useContext, useEffect, useRef, type ReactNode, type MutableRefObject } from 'react';
import type { HandSample } from './useHandInput';
import type { SceneId } from './interaction';

/**
 * 平台提供给场景插件的服务契约（对应总体设计方案 6.2 学科插件契约）：
 * - notify：全局通知栏反馈
 * - cancelHand：复位手势感知（如切换捏合落笔方式时）
 * - registerPolicy：注册本场景的原始手部采样解释策略（仅激活场景收到采样）
 * - registerSnapshot：注册本场景的会话数据（用于导出学习记录）
 * - drag：跨场景共享的拖拽会话（谁在拖、从哪个参数出发）
 * 场景只通过这些接口与平台交互，不直接触碰摄像头或其他场景。
 */
export type DragSession = { scene: SceneId; initial?: { az: number; el: number; offset: number }; x: number; y: number } | null;
export type AppServices = {
  notify: (message: string) => void;
  cancelHand: () => void;
  registerPolicy: (scene: SceneId, handler: ((sample: HandSample) => void) | null) => void;
  registerSnapshot: (scene: SceneId, get: (() => Record<string, unknown>) | null) => void;
  drag: MutableRefObject<DragSession>;
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
