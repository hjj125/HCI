export type SceneId = 'slides' | 'whiteboard' | 'geometry';
export type InteractionEvent = {
  scene: SceneId; source: 'mouse' | 'hand' | 'keyboard' | 'voice' | 'system';
  intent: 'point' | 'drag' | 'next' | 'previous' | 'undo' | 'reset' | 'switch' | 'predict' | 'hint' | 'submit' | 'laser';
  phase: 'start' | 'update' | 'end' | 'cancel';
  position?: { x: number; y: number }; value?: string;
};
export type RecordedEvent = InteractionEvent & { id: number; time: string };
// 连续更新不写日志，避免堆积大量指针帧。订阅者仍收到每个实时事件。
export class InteractionBus {
  private listeners = new Set<(event: InteractionEvent) => void>();
  subscribe(listener: (event: InteractionEvent) => void) {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  emit(event: InteractionEvent) { this.listeners.forEach(listener => listener(event)); }
}
export const bus = new InteractionBus();
/** 数字手势选择白板工具：比“2”（食指+中指）→画笔，比“3”（再加无名指）→橡皮。
 *  不用“1”：单指就是日常指向姿势，移动光标会被误当成命令。 */
export function numberToolPose(fingers: [boolean, boolean, boolean, boolean]): 'pen' | 'eraser' | null {
  if (fingers[0] && fingers[1] && !fingers[2] && !fingers[3]) return 'pen';
  if (fingers[0] && fingers[1] && fingers[2] && !fingers[3]) return 'eraser';
  return null;
}
/** 语音命令：识别短语 → 统一交互事件意图。破坏性操作（清空等）不设语音入口。 */
export type VoiceIntent = { intent: 'next' | 'previous' | 'undo' | 'reset' | 'hint' | 'laser' | 'voice-off' | 'switch'; value?: SceneId };
const VOICE_RULES: readonly (readonly [string, VoiceIntent])[] = [
  ['关闭语音', { intent: 'voice-off' }], ['停止语音', { intent: 'voice-off' }],
  ['下一页', { intent: 'next' }], ['上一页', { intent: 'previous' }],
  ['白板', { intent: 'switch', value: 'whiteboard' }], ['课件', { intent: 'switch', value: 'slides' }], ['几何', { intent: 'switch', value: 'geometry' }],
  ['撤销', { intent: 'undo' }], ['重置', { intent: 'reset' }], ['提示', { intent: 'hint' }], ['激光笔', { intent: 'laser' }],
];
export function matchVoiceCommand(text: string): VoiceIntent | null {
  const t = text.replace(/\s/g, '');
  for (const [phrase, cmd] of VOICE_RULES) if (t.includes(phrase)) return cmd;
  return null;
}
export class PinchGate {
  active = false;
  private since: number | null = null;
  update(ratio: number, now: number): 'start' | 'end' | null {
    if (this.active && ratio > 0.48) { this.reset(); return 'end'; }
    if (!this.active && ratio < 0.30) {
      this.since ??= now;
      if (now - this.since >= 55) { this.active = true; return 'start'; }
    } else if (!this.active) this.since = null;
    return null;
  }
  reset() { this.active = false; this.since = null; }
}
