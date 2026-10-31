import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bus, type InteractionEvent, type RecordedEvent, type SceneId } from './core/interaction';
import { useHandInput, type HandSample } from './core/useHandInput';
import { usePoseInput } from './core/usePoseInput';
import { useVoiceInput } from './core/useVoiceInput';
import { ServicesProvider, SettingsProvider, type AppServices, type DragSession, type SceneSettings, type PoseSample } from './core/services';
import { subjects, experiments, experimentTitle } from './scenes/registry';
import { HomeScene } from './scenes/home/HomeScene';
import './styles.css';
import './styles.v2.css';
import { BrandMark } from './ui/brand';
import { IconArrow, IconCamera, IconClose, IconGrid, IconHelp, IconHome, IconMenu, IconMic, IconSearch, IconSpark } from './ui/icons';
import type { SceneAgentAdapter } from './core/agent/types';
import { AgentHost } from './ui/agent/AgentHost';

/**
 * 平台壳（Shell）：侧边导航、感知（摄像头/语音）、输入路由与学习记录。
 * 学科功能全部来自 scenes/ 注册表中的场景插件；壳本身不包含任何学科逻辑。
 */
export default function App() {
  const [mode, setMode] = useState<SceneId>('home');
  const [notice, setNoticeState] = useState('欢迎！鼠标可独立完成全部任务。');
  const [toastOn, setToastOn] = useState(false);
  const [events, setEvents] = useState<RecordedEvent[]>([]);
  const [laser, setLaser] = useState(false);
  const [pptMode, setPptMode] = useState(false);
  const [backgroundCamera, setBackgroundCamera] = useState(false);
  const [fistUndo, setFistUndo] = useState(false);
  const [penInput, setPenInput] = useState<'pinch' | 'space'>('pinch');
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [homeQuery, setHomeQuery] = useState('');
  const [homeSubject, setHomeSubject] = useState('全部');
  const [guideOpen, setGuideOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [agentEnabled, setAgentEnabled] = useState(true);
  const [agentOpen, setAgentOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const guideCloseRef = useRef<HTMLButtonElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 通知以短暂 Toast 呈现：元素常驻（供测试与读屏器查询文本），仅视觉上自动消隐。
  const setNotice = useCallback((text: string) => {
    setNoticeState(text);
    setToastOn(true);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastOn(false), 3600);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);
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
  const agentPolicies = useRef(new Map<SceneId, SceneAgentAdapter>());
  const registerAgentPolicy = useCallback((scene: SceneId, adapter: SceneAgentAdapter | null) => {
    if (adapter) agentPolicies.current.set(scene, adapter); else agentPolicies.current.delete(scene);
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
    registerPolicy, registerVoicePolicy, registerPosePolicy, registerSnapshot, registerAgentPolicy, drag,
    pauseRecognition: ms => voiceCtl.current?.(ms),
    handVideo: hand.video,
  }), [hand.cancel, registerPolicy, registerVoicePolicy, registerPosePolicy, registerSnapshot, registerAgentPolicy]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // 全局键盘：Esc 取消当前操作并关闭摄像头；Ctrl+Z 撤销（场景各自解释）；“/”聚焦全局搜索。
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'Escape') {
        if (guideOpen) { setGuideOpen(false); return; }
        if (agentOpen) { setAgentOpen(false); return; }
        bus.emit({ scene: drag.current?.scene ?? mode, source: 'keyboard', intent: 'drag', phase: 'cancel' });
        hand.cancel(); hand.stop();
      }
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); bus.emit({ scene: mode, source: 'keyboard', intent: 'undo', phase: 'end' }); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mode, hand.cancel, hand.stop, guideOpen, agentOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (guideOpen) guideCloseRef.current?.focus(); }, [guideOpen]);
  const openGuide = useCallback(() => setGuideOpen(true), []);

  // 侧栏学科入口 → 回首页并定位到对应学科（首页监听该事件滚动到实验区）。
  const gotoHomeExplorer = (subject: string) => {
    setHomeSubject(subject);
    if (mode !== 'home') bus.emit({ scene: mode, source: 'mouse', intent: 'switch', phase: 'end', value: 'home' });
    setTimeout(() => window.dispatchEvent(new CustomEvent('ee:home-focus', { detail: { subject } })), 60);
    setSidebarOpen(false);
  };

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

  const toolGroup = subjects.find(g => g.id === 'tools');
  const subjectGroups = subjects.filter(g => g.id !== 'home' && g.id !== 'tools');
  const navGo = (id: SceneId) => { bus.emit({ scene: mode, source: 'mouse', intent: 'switch', phase: 'end', value: id }); setSidebarOpen(false); };

  return <SettingsProvider value={settings}>
    <ServicesProvider value={services}>
      <div className={`menu-scrim${sidebarOpen ? ' visible' : ''}`} onClick={() => setSidebarOpen(false)} />
      <div className="app-shell">
        <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
          <div className="brand-block">
            <div className="brand-mark-shell"><BrandMark size={34} /></div>
            <div><div className="brand">灵境智学</div><div className="brand-en">EMBODIED EDU</div></div>
          </div>
          <nav aria-label="场景导航">
            <div className="nav-group">
              <div className="nav-group-title">工作台 · WORKSPACE</div>
              <button className={`nav-item${mode === 'home' ? ' active' : ''}`} title="平台总览与全部实验入口" onClick={() => navGo('home')}>
                <span className="scene-icon" aria-hidden><IconHome size={15} /></span>总览
              </button>
            </div>
            {toolGroup && <div className="nav-group">
              <div className="nav-group-title">教学工具 · CLASSROOM</div>
              {toolGroup.experiments.map(s =>
                <button key={s.id} className={`nav-item${mode === s.id ? ' active' : ''}`} title={s.description} onClick={() => navGo(s.id)}>
                  <span className="scene-icon">{s.icon}</span>{s.title}
                </button>)}
            </div>}
            <div className="nav-group">
              <div className="nav-group-title">学科探索 · EXPLORE</div>
              <button className="nav-item" title="浏览全部学科实验" onClick={() => gotoHomeExplorer('全部')}>
                <span className="scene-icon" aria-hidden><IconGrid size={15} /></span>全部实验
              </button>
              {subjectGroups.map(g => <div key={g.id}>
                <button className="subject-label" title={`筛选${g.title}的实验`} onClick={() => gotoHomeExplorer(g.title)}>
                  <span aria-hidden>{g.id === 'geography' ? '◍' : g.id === 'math' ? '∑' : g.id === 'art' ? '✿' : g.id === 'chemistry' ? '⚛' : g.id === 'biology' ? '❋' : g.id === 'physics' ? '∞' : g.id === 'chinese' ? '文' : '◇'}</span>
                  <span className="subject-cn">{g.title}</span>
                </button>
                {g.experiments.map(s =>
                  <button key={s.id} className={`nav-item${mode === s.id ? ' active' : ''}`} title={s.description} onClick={() => navGo(s.id)}>
                    <span className="scene-icon">{s.icon}</span>{s.title}
                  </button>)}
              </div>)}
            </div>
          </nav>
          <div className="sidebar-footer">
            <div className="guide-card">
              <div className="gc-title"><IconSpark size={14} /> 交互指南</div>
              <p>无需专用硬件，一台摄像头即可开启体感探索。</p>
              <button onClick={openGuide}>查看操作指南 <IconArrow size={12} /></button>
            </div>
            <div className="sb-toggles">
              <button className={`toggle-row${hand.enabled ? ' on' : ''}${hand.loading ? ' loading' : ''}`} disabled={hand.loading}
                title={hand.status} onClick={hand.enabled ? hand.stop : hand.start}>
                <span className="tr-ico"><IconCamera size={15} /></span>
                <span className="tr-label">摄像头手势</span>
                <span className="tr-state">{hand.loading ? '加载中' : hand.enabled ? '已开启' : '未开启'}</span>
              </button>
              <button className={`toggle-row${voice.enabled ? ' on' : ''}${!voice.supported ? ' off' : ''}`} disabled={!voice.supported}
                title={voice.supported ? '语音命令：下一页 / 上一页 / 课件 / 白板 / 几何 / 撤销 / 重置 等' : '当前浏览器不支持语音识别，请使用 Edge 或 Chrome'}
                onClick={voice.enabled ? voice.stop : voice.start}>
                <span className="tr-ico"><IconMic size={15} /></span>
                <span className="tr-label">语音命令</span>
                <span className="tr-state">{voice.enabled ? '已开启' : voice.supported ? '未开启' : '不支持'}</span>
              </button>
            </div>
            {(hand.enabled || voice.enabled) && <div className="status slim">
              {hand.enabled && <b className="ok">🖐 {hand.status}</b>}
              {voice.enabled && <span className="ok">🎙 {voice.status}{voice.lastHeard ? ` · “${voice.lastHeard}”` : ''}</span>}
            </div>}
            <div className="local-dot"><i />本地优先 · 数据不出本机</div>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <button className="tool-btn menu-btn" aria-label="打开导航" onClick={() => setSidebarOpen(true)}><IconMenu size={17} /></button>
            <div className="crumb">
              <span className="crumb-brand"><BrandMark size={20} id="cb" /><span className="cn">灵境智学</span></span>
              <span className="sep" aria-hidden>›</span><b>{experimentTitle(mode)}</b>
            </div>
            <div className="spacer" />
            <label className={`search-box${homeQuery ? ' has-text' : ''}`}>
              <IconSearch size={15} className="s-ico" />
              <input ref={searchRef} value={homeQuery}
                onChange={e => { setHomeQuery(e.target.value); setHomeSubject('全部'); if (mode !== 'home') bus.emit({ scene: mode, source: 'mouse', intent: 'switch', phase: 'end', value: 'home' }); }}
                placeholder="搜索实验、学科或交互方式…" aria-label="全局搜索实验" />
              {homeQuery
                ? <button className="s-clear" aria-label="清除搜索" onClick={() => { setHomeQuery(''); setHomeSubject('全部'); searchRef.current?.focus(); }}><IconClose size={11} /></button>
                : <span className="kbd">/</span>}
            </label>
            <button className="tool-btn" aria-label="交互指南" title="交互指南" onClick={openGuide}><IconHelp size={17} /></button>
            <button className={`tool-btn${agentEnabled ? ' agent-on' : ''}`} aria-pressed={agentEnabled} aria-label="灵犀智能体开关"
              title="灵犀 · AI 教学智能体（感知—决策—行动）" onClick={() => setAgentEnabled(v => !v)}><IconSpark size={17} /></button>
            <div className="topbar-avatar" aria-label="演示用户">ED</div>
          </header>
          <div role="status" className={`help notice-bar${toastOn ? ' show' : ''}`}>
            <span className="t-text">{notice}</span>
            <button className="t-close" aria-label="关闭通知" onClick={() => setToastOn(false)}><IconClose size={11} /></button>
          </div>
          <main>
            {experiments.map(s => s.id === 'home'
              ? <HomeScene key="home" active={mode === 'home'} query={homeQuery} subject={homeSubject} onQuery={setHomeQuery} onSubject={setHomeSubject} onGuide={openGuide} />
              : <s.component key={s.id} active={mode === s.id} />)}
          </main>
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
        <AgentHost scene={mode} enabled={agentEnabled} open={agentOpen} setOpen={setAgentOpen} policies={agentPolicies} snapshots={snapshots} cameraOn={hand.enabled || hand.loading} />
        {hand.cursor && <div aria-hidden className={laser ? 'laser-dot' : `gesture-cursor ${hand.cursor.pinching ? 'pinching' : ''} ${mode === 'whiteboard' && tool === 'eraser' ? 'eraser' : ''}`} style={{ left: `${hand.cursor.x * 100}%`, top: `${hand.cursor.y * 100}%` }} />}
        {guideOpen && <div className="guide-modal-bg" onClick={e => { if (e.target === e.currentTarget) setGuideOpen(false); }}>
          <section className="guide-modal" role="dialog" aria-modal="true" aria-labelledby="guideTitle">
            <div className="gm-top">
              <div className="gm-ico" aria-hidden>✦</div>
              <button ref={guideCloseRef} className="gm-close" aria-label="关闭指南" onClick={() => setGuideOpen(false)}>✕</button>
            </div>
            <h3 id="guideTitle">交互方式 · 快速入门</h3>
            <div className="gm-row"><b>🖐 手势</b><span>在左下角「摄像头手势」开启后，指向并捏合可点击任意按钮；每个实验还有专属手势（如挥手翻页、双手缩放）。画面本地识别，不录制不上传。</span></div>
            <div className="gm-row"><b>🎙 语音</b><span>开启「语音命令」后可说：下一页 / 上一页 / 课件 / 白板 / 几何 / 撤销 / 重置 / 提示 / 激光笔 / 开花 等；背诵镜依赖语音输入。</span></div>
            <div className="gm-row"><b>🖱 鼠标</b><span>全部实验无需摄像头即可用鼠标完整操作；BloomVerse 单击切换绽放、拖动旋转、滚轮缩放。</span></div>
            <div className="gm-row"><b>⌨ 键盘</b><span>Esc 取消当前操作并关闭摄像头；Ctrl+Z 撤销；按 “/” 快速聚焦全局搜索。</span></div>
            <div className="gm-row"><b>当前状态</b><span>
              摄像头手势：{hand.loading ? '加载中…' : hand.enabled ? '已开启' : '未开启'} · 语音命令：{voice.enabled ? '已开启' : voice.supported ? '未开启' : '浏览器不支持'}{poseActive ? ` · 姿态识别：${pose.loading ? '加载中' : '已就绪'}` : ''}
              <br />鼠标与键盘随时可用；状态与数据不出本机。</span></div>
            <div className="gm-privacy">隐私承诺：摄像头画面与音频仅在本机浏览器内推理，学习过程仅记录交互元数据（不含画面），可随时导出或清除。</div>
            <div className="gm-foot"><button onClick={() => { setGuideOpen(false); gotoHomeExplorer('全部'); }}>开始探索 <IconArrow size={13} /></button></div>
          </section>
        </div>}
      </div>
    </ServicesProvider>
  </SettingsProvider>;
}
