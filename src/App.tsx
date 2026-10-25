import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bus, type InteractionEvent, type RecordedEvent, type SceneId } from './core/interaction';
import { useHandInput, type HandSample } from './core/useHandInput';
import { usePoseInput } from './core/usePoseInput';
import { useVoiceInput } from './core/useVoiceInput';
import { ServicesProvider, SettingsProvider, type AppServices, type DragSession, type SceneSettings, type PoseSample } from './core/services';
import { subjects, experiments, experimentTitle } from './scenes/registry';
import './styles.css';

/**
 * 平台壳（Shell）：侧边导航、感知（摄像头/语音）、输入路由与学习记录。
 * 学科功能全部来自 scenes/ 注册表中的场景插件；壳本身不包含任何学科逻辑。
 */
export default function App() {
  const [mode, setMode] = useState<SceneId>('slides');
  const [notice, setNotice] = useState('欢迎！鼠标可独立完成全部任务。');
  const [events, setEvents] = useState<RecordedEvent[]>([]);
  const [laser, setLaser] = useState(false);
  const [pptMode, setPptMode] = useState(false);
  const [backgroundCamera, setBackgroundCamera] = useState(false);
  const [fistUndo, setFistUndo] = useState(false);
  const [penInput, setPenInput] = useState<'pinch' | 'space'>('pinch');
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const settings = useMemo<SceneSettings>(() => ({
    laser, setLaser, pptMode, setPptMode, backgroundCamera, setBackgroundCamera,
    fistUndo, setFistUndo, penInput, setPenInput, tool, setTool,
  }), [laser, pptMode, backgroundCamera, fistUndo, penInput, tool]);

  const drag = useRef<DragSession>(null);
  const policies = useRef(new Map<SceneId, (sample: HandSample) => void>());
  const snapshots = useRef(new Map<SceneId, () => Record<string, unknown>>());
  const seq = useRef(0);
  const lastActivity = useRef(Date.now());

  const registerPolicy = useCallback((scene: SceneId, handler: ((sample: HandSample) => void) | null) => {
    if (handler) policies.current.set(scene, handler); else policies.current.delete(scene);
  }, []);
  const voicePolicies = useRef(new Map<SceneId, (text: string) => boolean>());
  const registerVoicePolicy = useCallback((scene: SceneId, handler: ((text: string) => boolean) | null) => {
    if (handler) voicePolicies.current.set(scene, handler); else voicePolicies.current.delete(scene);
  }, []);
  const posePolicies = useRef(new Map<SceneId, (sample: PoseSample) => void>());
  const [poseActive, setPoseActive] = useState(false);
  const registerPosePolicy = useCallback((scene: SceneId, handler: ((sample: PoseSample) => void) | null) => {
    if (handler) posePolicies.current.set(scene, handler); else posePolicies.current.delete(scene);
    setPoseActive(posePolicies.current.size > 0);
  }, []);
  const registerSnapshot = useCallback((scene: SceneId, get: (() => Record<string, unknown>) | null) => {
    if (get) snapshots.current.set(scene, get); else snapshots.current.delete(scene);
  }, []);

  // 感知：手部采样先走通用规则（指向+捏合=点击任意按钮），再交给激活场景的策略。
  const hand = useHandInput((sample: HandSample) => {
    if (sample.phase === 'start') {
      const px = sample.x * window.innerWidth, py = sample.y * window.innerHeight;
      const element = document.elementFromPoint(px, py);
      if (element instanceof HTMLElement) {
        const button = element.closest('button');
        if (button && !button.disabled) { button.click(); return; }
      }
    }
    policies.current.get(mode)?.(sample);
  }, {
    fistUndo: mode === 'whiteboard' && penInput === 'pinch' && fistUndo,
    background: backgroundCamera && pptMode && mode === 'slides',
    numberTools: mode === 'whiteboard', numberLaser: mode === 'slides',
    statusTexts: mode === 'slides' ? {
      idle: laser ? '激光笔开启中 · 移动手指指示；比“2”或按 L 关闭' : pptMode ? '追踪就绪 · 张开手掌，向右挥=下一页，向左挥=上一页' : '追踪就绪 · 张开手掌左右挥动翻页，捏合可点按钮',
      pinching: '捏合中 · 想翻页请先张开手掌，再左右挥动',
      lost: '追踪丢失 · 请将手重新放入画面',
    } : undefined,
  });

  const services = useMemo<AppServices>(() => ({
    notify: setNotice,
    cancelHand: () => hand.cancel(),
    registerPolicy, registerVoicePolicy, registerPosePolicy, registerSnapshot, drag,
    pauseRecognition: ms => voiceCtl.current?.(ms),
    handVideo: hand.video,
  }), [hand.cancel, registerPolicy, registerVoicePolicy, registerPosePolicy, registerSnapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  // 语音命令：全局短语走统一事件总线；未命中的原文转交激活场景的场景级语音策略。
  const voiceCtl = useRef<((ms: number) => void) | null>(null);
  const voice = useVoiceInput((cmd, text) => {
    if (!cmd) {
      const consumed = voicePolicies.current.get(mode)?.(text) ?? false;
      if (!consumed) setNotice(`语音未识别命令：${text}`);
      return;
    }
    if (cmd.intent === 'voice-off') { voice.stop(); setNotice('语音命令已关闭。'); return; }
    if ((cmd.intent === 'next' || cmd.intent === 'previous') && mode !== 'slides') { setNotice('语音翻页只在课件视图生效。'); return; }
    if (cmd.intent === 'switch') { bus.emit({ scene: mode, source: 'voice', intent: 'switch', phase: 'end', value: cmd.value }); return; }
    bus.emit({ scene: mode, source: 'voice', intent: cmd.intent, phase: 'end' });
  });
  voiceCtl.current = voice.pauseFor ?? null;

  // 姿态识别：与手部共享摄像头画面，仅在激活场景注册了姿态策略时逐帧推理。
  const pose = usePoseInput(hand.video, hand.enabled, poseActive, sample => {
    posePolicies.current.get(mode)?.(sample);
  });

  // 全局语义事件：场景切换、学习记录。学科逻辑由各场景插件自行订阅处理。
  useEffect(() => bus.subscribe(e => {
    lastActivity.current = Date.now();
    if (e.intent === 'switch') {
      if (drag.current) bus.emit({ scene: drag.current.scene, source: 'system', intent: 'drag', phase: 'cancel' });
      hand.cancel();
      setLaser(false);
      const target = (e.value ?? 'slides') as SceneId;
      setMode(target);
      setNotice(`已切换到${experimentTitle(target)}，旧操作已结束。`);
      return;
    }
    if (e.phase === 'update' || e.intent === 'point') return;
    setEvents(v => [{ ...e, id: ++seq.current, time: new Date().toISOString() }, ...v].slice(0, 300));
  }), [hand.cancel]); // eslint-disable-line react-hooks/exhaustive-deps

  // 全局键盘：Esc 取消当前操作并关闭摄像头；Ctrl+Z 撤销（场景各自解释）。
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'Escape') {
        bus.emit({ scene: drag.current?.scene ?? mode, source: 'keyboard', intent: 'drag', phase: 'cancel' });
        hand.cancel(); hand.stop();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); bus.emit({ scene: mode, source: 'keyboard', intent: 'undo', phase: 'end' }); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode, hand.cancel, hand.stop]); // eslint-disable-line react-hooks/exhaustive-deps

  const exportLogs = () => {
    // 各场景提供会话快照（对应插件契约 get_world_state）；激活场景的数据置于顶层。
    const all: Record<string, unknown> = {};
    snapshots.current.forEach((get, id) => { all[id] = get(); });
    const activeSession = (all[mode] as Record<string, unknown> | undefined) ?? {};
    const data = {
      version: 2, exported: new Date().toISOString(),
      cameraUsed: hand.enabled, penInput, ...activeSession, scenes: all,
      events: [...events].reverse(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'embodiededu-session.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <SettingsProvider value={settings}>
    <ServicesProvider value={services}>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand-block">
            <div className="brand">EmbodiedEdu</div>
            <div className="brand-cn">灵境智学</div>
            <div className="subtitle">具身学习多模态交互平台</div>
          </div>
          <nav aria-label="场景导航">{subjects.map(g => (
            <div className="nav-group" key={g.id}>
              <div className="nav-group-title">{g.title}</div>
              {g.experiments.map(s =>
                <button key={s.id} className={mode === s.id ? 'active' : ''} title={s.description} onClick={() => bus.emit({ scene: mode, source: 'mouse', intent: 'switch', phase: 'end', value: s.id })}>
                  <span className="scene-icon">{s.icon}</span>{s.title}
                </button>)}
            </div>))}</nav>
          <div className="sidebar-footer">
            <button className="camera-btn" disabled={hand.loading} onClick={hand.enabled ? hand.stop : hand.start}>{hand.loading ? '加载中…' : hand.enabled ? '关闭摄像头' : '启用摄像头手势'}</button>
            <button className="camera-btn" disabled={!voice.supported} title={voice.supported ? '语音命令：下一页 / 上一页 / 白板 / 课件 / 几何 / 撤销 / 重置 / 提示 / 激光笔 / 关闭语音' : '当前浏览器不支持语音识别，请使用 Edge 或 Chrome'} onClick={voice.enabled ? voice.stop : voice.start}>{voice.enabled ? '关闭语音' : '语音命令'}</button>
            <div className="status">
              <b className={hand.enabled ? 'ok' : ''}>● {hand.status}</b>
              <span>鼠标随时可用 · 默认不录制画面</span>
              {poseActive && <span className={pose.loading ? '' : 'ok'}>⦾ {pose.loading ? '…' : pose.status}</span>}
              {voice.enabled && <span className="ok">🎙 {voice.status}{voice.lastHeard ? ` · “${voice.lastHeard}”` : ''}</span>}
            </div>
          </div>
        </aside>
        <div className="workspace">
          <div role="status" className="help notice-bar">{notice}</div>
          <main>{experiments.map(s => <s.component key={s.id} active={mode === s.id} />)}</main>
          <details className="panel log-panel">
            <summary>交互过程记录 · {events.length} 条（仅元数据，不含画面）</summary>
            <div className="task-actions">
              <button onClick={exportLogs}>导出 JSON 记录</button>
              <button onClick={() => { if (confirm('清空当前操作记录？')) setEvents([]); }}>清空记录</button>
            </div>
            <div className="event-list">{events.map(e =>
              <div className="event-row" key={e.id}><time>{new Date(e.time).toLocaleTimeString()}</time>{experimentTitle(e.scene)} · {e.source} · {e.intent}/{e.phase} {e.value}</div>)}</div>
          </details>
          <footer><span>统一事件 · 规则反馈 · 可恢复操作 · 场景可插拔</span><span>首次启用手势需下载本地模型；鼠标功能可独立使用</span></footer>
        </div>
        <div className="camera-box" style={{ display: hand.enabled || hand.loading ? 'block' : 'none' }}>
          <video className="camera-preview" ref={hand.video} muted playsInline />
          <div className="camera-label">本地识别 · 不录制 · 捏合操作</div>
        </div>
        {hand.cursor && <div aria-hidden className={laser ? 'laser-dot' : `gesture-cursor ${hand.cursor.pinching ? 'pinching' : ''} ${mode === 'whiteboard' && tool === 'eraser' ? 'eraser' : ''}`} style={{ left: `${hand.cursor.x * 100}%`, top: `${hand.cursor.y * 100}%` }} />}
      </div>
    </ServicesProvider>
  </SettingsProvider>;
}
