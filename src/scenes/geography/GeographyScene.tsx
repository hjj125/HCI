import { useEffect, useRef, useState } from 'react';
import { bus } from '../../core/interaction';
import type { SceneProps } from '../types';
import { speak, useScenePolicy, useSceneSnapshot, useSceneVoicePolicy, useServices } from '../../core/services';
import { findRegion, type RegionFeature } from './geoMath';
import { loadWorld, regionName, cardFor, CLUES, computeCentroids, matchCountry } from './regionData';
import { SwipeDetector, VerticalSwipeDetector } from '../slides/pptGesture';
import { streamRegionChat, type ChatMessage } from './llm';
import { GlobeView, type GlobeHandle } from './GlobeView';

type Selection = { name: string; zh: string; lat: number; lon: number; continent: string };

/** 地理实验 1 · 找国家：手势旋转数字地球 → 指向选中区域 → 区位/地形/人文（内置卡 + DeepSeek 问答，支持语音定位）。 */
export function GeographyScene({ active }: SceneProps) {
  const { notify, drag } = useServices();
  const [task, setTask] = useState<'free' | 'A' | 'B'>('free');
  const [features, setFeatures] = useState<RegionFeature[] | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [regionView, setRegionView] = useState(false);
  const [graticule, setGraticule] = useState(true);
  const [clueIndex, setClueIndex] = useState(0);
  const [answerState, setAnswerState] = useState<'none' | 'right' | 'wrong'>('none');
  const [answerRegion, setAnswerRegion] = useState('');
  const [explanation, setExplanation] = useState('');
  const [completed, setCompleted] = useState(false);
  const [hint, setHint] = useState(0);
  const [started, setStarted] = useState(Date.now());
  const [stalled, setStalled] = useState(false);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [chatView, setChatView] = useState(false);
  const [input, setInput] = useState('');
  const chatScroll = useRef<HTMLDivElement>(null);
  const lastActivity = useRef(Date.now());
  const swipe = useRef(new SwipeDetector());
  const swipeV = useRef(new VerticalSwipeDetector());
  const twoHandsDist = useRef<number | null>(null);
  const palmHold = useRef<{ since: number; x: number; y: number } | null>(null);
  // 捏合结束（选中/微调完成）后的撤手静默期：撤手动作不应被误判为挥手。
  const swipeGraceUntil = useRef(0);
  // 统一交互：捏合拖动=旋转、捏合点击=选中；选点用“捏合前的指向位置”——
  // 捏合闭合瞬间食指指尖会向拇指偏移，用闭合后的位置会选偏邻国或海洋。
  const lastAim = useRef({ x: 0.5, y: 0.5 });
  const pinchAnchor = useRef<{ x: number; y: number } | null>(null);
  // 捏合长按 ≈0.7 秒（且未拖动）= 选中并直接进入区域详情。
  const pinchSince = useRef(0);
  const holdFired = useRef(false);
  const host = useRef<HTMLDivElement>(null);
  const globe = useRef<GlobeHandle>(null);
  const centroids = useRef<Map<string, { lat: number; lon: number; zh: string }>>(new Map());
  const live = useRef({ selected, features, regionView });
  live.current = { selected, features, regionView };
  const clue = CLUES[clueIndex];

  const emit = (intent: Parameters<typeof bus.emit>[0]['intent'], value?: string, source: Parameters<typeof bus.emit>[0]['source'] = 'mouse') =>
    bus.emit({ scene: 'geography', source, intent, phase: 'end', value });

  useEffect(() => {
    loadWorld().then(f => { setFeatures(f); centroids.current = computeCentroids(f); }).catch(() => notify('边界数据加载失败，请检查 public/assets。'));
  }, [notify]);

  // 选择：屏幕点 → 射线 → 球面 → 经纬度 → 区域（判定复用已测试的 findRegion）。
  const selectAt = (nx: number, ny: number) => {
    const picked = globe.current?.pickAt(nx, ny);
    const f = picked ? findRegion(live.current.features ?? [], picked.lon, picked.lat) : null;
    if (!picked) { notify('未指向地球，请对准球体再选择。'); return; }
    if (!f) { setSelected({ name: 'ocean', zh: '海洋', lat: picked.lat, lon: picked.lon, continent: '—' }); notify(`选中海洋（${picked.lat.toFixed(1)}°, ${picked.lon.toFixed(1)}°）。请选择陆地区域。`); return; }
    setSelected({ name: f.properties.NAME, zh: regionName(f), lat: picked.lat, lon: picked.lon, continent: f.properties.CONTINENT ?? '—' });
    notify(`已选中 ${regionName(f)}（${picked.lat.toFixed(1)}°, ${picked.lon.toFixed(1)}°）。`);
  };

  // 场景级语音策略：全局短语未命中的识别原文 → 国名定位（纯规则匹配）。
  // 播报去重：同一短语 3 秒内只播一次（识别引擎对同段语音可能多次回调）。
  const lastSpoken = useRef({ text: '', at: 0 });
  useSceneVoicePolicy('geography', text => {
    const list = live.current.features?.map(f => ({ zh: regionName(f), name: f.properties.NAME })) ?? [];
    const hit = matchCountry(text, list);
    if (!hit) return false;
    const c = centroids.current.get(hit.name);
    if (!c) return false;
    globe.current?.flyTo(c.lat, c.lon);
    // 黄色标记停在国家的位置（质心），后续由人继续手势操控。
    setSelected({ name: hit.name, zh: hit.zh, lat: c.lat, lon: c.lon, continent: live.current.features?.find(f => f.properties.NAME === hit.name)?.properties.CONTINENT ?? '—' });
    notify(`语音定位 · ${hit.zh}（${c.lat.toFixed(0)}°, ${c.lon.toFixed(0)}°）`);
    const now = performance.now();
    if (lastSpoken.current.text !== hit.zh || now - lastSpoken.current.at > 3000) {
      lastSpoken.current = { text: hit.zh, at: now };
      speak(`已定位到${hit.zh}`);
    }
    return true;
  });

  // 手势策略（统一交互，无模式切换）：挥动=惯性旋转；捏合拖动=直接旋转；捏合点击=选中；张掌悬停=刹车；双手张合=缩放。
  useScenePolicy('geography', sample => {
    if (sample.phase === 'cancel') { drag.current = null; swipe.current.reset(); swipeV.current.reset(); twoHandsDist.current = null; palmHold.current = null; swipeGraceUntil.current = 0; pinchAnchor.current = null; pinchSince.current = 0; holdFired.current = false; globe.current?.freezeInertia(); return; }
    // 捏合开始即冻结惯性：捏合意味着精确定位，残余滑行会让选中的国家“跑掉”。
    if (sample.phase === 'start') {
      globe.current?.freezeInertia();
      pinchAnchor.current = { x: sample.x, y: sample.y };
      pinchSince.current = performance.now(); holdFired.current = false;
      drag.current = { scene: 'geography', x: sample.x, y: sample.y };
      return;
    }
    if (sample.phase === 'end') {
      swipeGraceUntil.current = performance.now() + 1200;
      swipe.current.reset(); swipeV.current.reset();
      // 点击判定：捏合期间几乎没移动 → 选中国家；选点用捏合前的指向位置。
      if (!holdFired.current && drag.current?.scene === 'geography' && pinchAnchor.current) {
        const moved = Math.hypot(sample.x - pinchAnchor.current.x, sample.y - pinchAnchor.current.y);
        if (moved < 0.05) selectAt(lastAim.current.x, lastAim.current.y);
      }
      drag.current = null; pinchAnchor.current = null; pinchSince.current = 0; holdFired.current = false;
      return;
    }
    // 捏合前的移动持续更新“瞄准点”（闭合后的位置不用，见 lastAim 注释）。
    if (!sample.pinching) lastAim.current = { x: sample.x, y: sample.y };
    // 双手张合 → 缩放。
    if (sample.hands && sample.hands.length >= 2) {
      const d = Math.hypot(sample.hands[0].x - sample.hands[1].x, sample.hands[0].y - sample.hands[1].y);
      if (twoHandsDist.current != null) {
        const delta = d - twoHandsDist.current;
        if (Math.abs(delta) > 0.008) globe.current?.zoom(-delta * 2.4);
      }
      twoHandsDist.current = d;
    } else twoHandsDist.current = null;
    // 张开手掌且悬停不动 0.3 秒 → 刹车（挥动中的张开手掌不触发，避免与挥手冲突）。
    if (sample.openPalm) {
      palmHold.current ??= { since: performance.now(), x: sample.x, y: sample.y };
      const h = palmHold.current;
      if (Math.hypot(sample.x - h.x, sample.y - h.y) < 0.045 && performance.now() - h.since > 300) globe.current?.brake();
    } else palmHold.current = null;
    // 挥手 → 角速度冲量（水平=自转，竖直=俯仰）。
    if (!sample.pinching && performance.now() >= swipeGraceUntil.current) {
      const dir = swipe.current.push(sample.x, sample.y, performance.now(), { pinching: false });
      if (dir) {
        globe.current?.addSpin(dir === 'right' ? 1 : -1);
        notify(dir === 'right' ? '已识别向右挥手 · 地球向右旋转（张开手掌悬停可停）' : '已识别向左挥手 · 地球向左旋转（张开手掌悬停可停）');
      }
      const vdir = swipeV.current.push(sample.x, sample.y, performance.now(), { pinching: false });
      if (vdir) {
        globe.current?.addPitch(vdir === 'down' ? 1 : -1);
        notify(vdir === 'down' ? '已识别向下挥手 · 视角转向北半球' : '已识别向上挥手 · 视角转向南半球');
      }
    } else { swipe.current.reset(); swipeV.current.reset(); }  // 捏合中/静默期：清空轨迹
    // 捏合长按（未拖动）≈0.7 秒 → 选中并进入区域详情。
    if (drag.current?.scene === 'geography' && sample.pinching && !holdFired.current && !live.current.regionView && pinchAnchor.current &&
        Math.hypot(sample.x - pinchAnchor.current.x, sample.y - pinchAnchor.current.y) < 0.05 &&
        performance.now() - pinchSince.current > 700) {
      holdFired.current = true;
      selectAt(lastAim.current.x, lastAim.current.y);
      setRegionView(true);
      notify('捏合长按 · 已进入区域详情（Esc 或“返回地球”退出）');
    }
    // 捏合拖动 → 直接旋转（增量应用）。
    if (drag.current?.scene === 'geography' && sample.pinching && !holdFired.current) {
      globe.current?.applyRotate(sample.x - drag.current.x, sample.y - drag.current.y);
      drag.current.x = sample.x; drag.current.y = sample.y;
    }
  });

  // 鼠标：拖动旋转；单击选中；滚轮缩放。
  const pointerState = useRef<{ down: boolean; moved: number; x: number; y: number }>({ down: false, moved: 0, x: 0, y: 0 });
  const canvasPos = (e: React.PointerEvent | React.WheelEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  useEffect(() => bus.subscribe(e => {
    lastActivity.current = Date.now();
    if (e.scene !== 'geography' && e.intent !== 'switch') return;
    if (e.intent === 'hint') setHint(v => Math.min(2, v + 1));
    if (e.intent === 'reset') {
      // 任务切换按钮会先 setTask 再 emit reset：这里不重置 task，只清作答状态。
      setSelected(null); setRegionView(false); setAnswerState('none'); setAnswerRegion('');
      setExplanation(''); setCompleted(false); setHint(0); setStarted(Date.now()); setChat([]); setChatView(false); setInput(''); setStreaming(false);
    }
    if (e.intent === 'predict') {
      const ok = selected?.name === clue.target;
      setAnswerState(ok ? 'right' : 'wrong');
      setAnswerRegion(selected?.zh ?? '海洋');
      setCompleted(ok);
      notify(ok ? '回答正确！结合区位线索补充解释后提交。' : `选中的是${selected?.zh ?? '海洋'}，再读一遍线索和提示，重新选择。`);
    }
    if (e.intent === 'submit') { setCompleted(true); notify(`任务已完成，用时 ${Math.round((Date.now() - started) / 1000)} 秒。可导出过程记录。`); }
  }), [selected, clue, started, notify]);

  useEffect(() => {
    if (!active) { setStalled(false); return; }
    lastActivity.current = Date.now(); setStalled(false);
    const timer = setInterval(() => setStalled(Date.now() - lastActivity.current > 60000 && !completed), 5000);
    return () => clearInterval(timer);
  }, [active, completed]);

  // Esc 在区域视图中返回地球
  useEffect(() => {
    if (!active || !regionView) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setRegionView(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, regionView]);

  useSceneSnapshot('geography', () => ({
    startedAt: new Date(started).toISOString(), durationSeconds: Math.round((Date.now() - started) / 1000),
    task, hints: hint, explanation, completed,
    selected: selected ? { region: selected.zh, lat: Number(selected.lat.toFixed(2)), lon: Number(selected.lon.toFixed(2)) } : null,
    quiz: task === 'A' ? { target: clue.target, result: answerState } : null,
    aiTurns: chat.filter(m => m.role === 'user').length,
  }));

  const card = selected ? cardFor({ properties: { NAME: selected.name, CONTINENT: selected.continent }, geometry: { type: 'Polygon', coordinates: [] } }) : null;
  // AI 对话：发送一条消息并流式接收回复（打字机效果）。
  const send = async (text: string) => {
    const t = text.trim();
    if (!selected || !t) return;
    if (streaming) { notify('AI 正在回复中，请等当前回答完成后再继续提问。'); return; }
    const history = [...chat, { role: 'user' as const, content: t }];
    setChat(m => [...m, { role: 'user', content: t }, { role: 'assistant', content: '' }]);
    setStreaming(true);
    const result = await streamRegionChat(selected.zh, selected.continent, history, d => {
      setChat(m => m.map((msg, i) => (i === m.length - 1 ? { ...msg, content: msg.content + d } : msg)));
    });
    setStreaming(false);
    if (result === 'unconfigured') {
      setChat(m => m.map((msg, i) => (i === m.length - 1 ? { ...msg, content: '（AI 服务未配置：请在项目根目录 .env 填入 DEEPSEEK_API_KEY 并重启服务。可先查看“资料卡”。）' } : msg)));
      notify('AI 讲解未配置（服务端 .env），已显示引导。');
    } else if (result === 'error') {
      setChat(m => m.map((msg, i) => (i === m.length - 1 && !msg.content ? { ...msg, content: '（生成失败，请稍后重试；可先查看“资料卡”。）' } : msg)));
    }
  };
  useEffect(() => { chatScroll.current?.scrollTo({ top: chatScroll.current.scrollHeight }); }, [chat]);
  useEffect(() => { setChat([]); setChatView(false); setInput(''); setStreaming(false); }, [selected?.name]);

  return <section className="panel geo-panel" hidden={!active}>
    <div className="task-head">
      <div><div className="eyebrow">地理 · 数字地球</div><h2>实验一 · 找国家</h2></div>
      <button onClick={() => emit('reset')}>重置任务</button>
    </div>
    <div className="presets">
      <button className={task === 'free' ? 'selected' : ''} onClick={() => { setTask('free'); emit('reset'); }}>演示模式</button>
      <button className={task === 'A' ? 'selected' : ''} onClick={() => { setTask('A'); emit('reset'); }}>任务 A · 线索定位</button>
      <button className={task === 'B' ? 'selected' : ''} onClick={() => { setTask('B'); emit('reset'); }}>任务 B · 区位分析</button>
    </div>
    <div className="task-card">{task === 'free' ? '挥动旋转地球，指向国家捏合一下即可选中，进入详情查看资料与 AI 讲解；也可以开启语音说“定位日本”。'
      : task === 'A' ? `根据线索在地球上选中目标国家，然后点“确认作答”：${clue.clue}`
      : '选择任意区域进入详情，观察区位、地形与人文的关系，回答下方问题并提交。'}</div>
    <div className="toolbar" style={{ marginTop: 12 }}>
      <button onClick={() => globe.current?.zoom(-0.35)}>放大 +</button>
      <button onClick={() => globe.current?.zoom(0.35)}>缩小 −</button>
      <label className="small"><input type="checkbox" checked={graticule} onChange={e => setGraticule(e.target.checked)} /> 经纬网</label>
      <span className="help">挥手=旋转（左右自转、上下俯仰，有惯性）；指向国家捏合一下=选中、捏合保持≈0.7秒=直接进入详情、捏合拖动=微调旋转；张开手掌悬停≈刹车；双手张合缩放（鼠标：拖动/单击/滚轮）</span>
    </div>
    <div className="geo-host" ref={host}
      onPointerDown={e => {
        if ((e.target as HTMLElement).closest('.globe-overlay')) return; // 浮层内点击交给按钮，勿抢指针捕获
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 忽略 */ }
        const p = canvasPos(e); pointerState.current = { down: true, moved: 0, x: p.x, y: p.y };
      }}
      onPointerMove={e => {
        const s = pointerState.current; if (!s.down) return;
        const p = canvasPos(e);
        s.moved = Math.max(s.moved, Math.hypot(p.x - s.x, p.y - s.y));
        globe.current?.applyRotate(p.x - s.x, p.y - s.y);
        s.x = p.x; s.y = p.y;
      }}
      onPointerUp={e => {
        const s = pointerState.current;
        if (!s.down) return; // 浮层按钮点击冒泡的 pointerup，与画布操作无关
        s.down = false;
        if (s.moved < 0.02) { const p = canvasPos(e); selectAt(p.x, p.y); }
      }}
      onWheel={e => {
        if ((e.target as HTMLElement).closest('.globe-overlay')) return; // 浮层滚动（如聊天列表）不缩放地球
        e.preventDefault(); globe.current?.zoom(e.deltaY > 0 ? 0.2 : -0.2);
      }}>
      <GlobeView hostRef={host} ref={globe} features={features} selected={selected} graticule={graticule} />
      {regionView && selected && <div className="globe-overlay">
        <div className="overlay-head">
          <h3>{selected.zh}{selected.name !== selected.zh && selected.name !== 'ocean' ? ` · ${selected.name}` : ''}</h3>
          <div className="task-actions">
            <button className={chatView ? '' : 'selected'} onClick={() => setChatView(false)}>资料卡</button>
            <button className={chatView ? 'selected' : ''} onClick={() => setChatView(true)}>AI 问答</button>
            <button onClick={() => setRegionView(false)}>返回地球</button>
          </div>
        </div>
        <p className="help">位置：纬度 {selected.lat.toFixed(1)}°，经度 {selected.lon.toFixed(1)}° · {selected.continent}</p>
        {!chatView ? <>
          {(['区位', '地形地貌', '人文特征'] as const).map(k => <div key={k}>
            <h4>{k}</h4>
            <p>{card?.[k]}</p>
          </div>)}
          <div className="task-actions">
            <button className="primary" style={{ width: 'auto' }} disabled={streaming} onClick={() => { setChatView(true); if (chat.length === 0) void send('请完整介绍这个区域。'); }}>{streaming ? 'AI 回复中…' : 'AI 生成讲解 →'}</button>
          </div>
        </> : <div className="chat-box">
          <div className="chat-list" ref={chatScroll}>
            {chat.length === 0 && <p className="help">可以直接提问，或先 <button className="linkish" onClick={() => void send('请完整介绍这个区域。')}>生成完整讲解</button>。</p>}
            {chat.map((m, i) => <div key={i} className={`chat-msg ${m.role}`}>{m.content}{streaming && i === chat.length - 1 && m.role === 'assistant' ? <span className="chat-cursor">▍</span> : ''}</div>)}
          </div>
          <div className="chat-input-row">
            <input aria-label="向 AI 提问" value={input} disabled={streaming}
              placeholder={streaming ? 'AI 回复中…' : '向 AI 提问，例如：这里为什么人口集中在沿海？'}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !streaming && input.trim()) { const t = input; setInput(''); void send(t); } }} />
            <button disabled={streaming || !input.trim()} onClick={() => { const t = input; setInput(''); void send(t); }}>发送</button>
          </div>
          <p className="help">内容由 DeepSeek 生成，仅供参考；问答围绕当前区域，对话保留最近 10 轮。</p>
        </div>}
      </div>}
    </div>
    <aside className="side" style={{ marginTop: 16 }}>
      <div className="panel prediction">
        <h3>① {task === 'A' ? '线索作答' : task === 'B' ? '区位分析' : '当前选择'}</h3>
        {task === 'A' ? <>
          <p className="help">{clue.clue}</p>
          <p>当前选中：{selected?.zh ?? '（指向国家捏合一下即可选中）'}</p>
          <button className="primary" disabled={!selected || answerState !== 'none'} onClick={() => emit('predict', selected?.zh)}>确认作答</button>
          {answerState !== 'none' && <p className="notice">{answerState === 'right' ? '✓ 回答正确！' : `✗ 选中的是${answerRegion}，正确答案线索再读一遍。`}</p>}
          <button onClick={() => { setClueIndex((clueIndex + 1) % CLUES.length); setAnswerState('none'); setAnswerRegion(''); setSelected(null); setHint(0); notify('已切换到新线索。'); }}>换一题</button>
        </> : task === 'B' ? <p>选择一个区域进入详情（或直接作答）：观察区位、地形与人文特征之间的关系，例如“地形如何影响人口分布”。</p>
        : <p>{selected ? `已选中 ${selected.zh}（${selected.lat.toFixed(1)}°, ${selected.lon.toFixed(1)}°）` : '未选择区域。指向地球上的国家捏合一下即可选中（鼠标单击），或语音说“定位日本”。'}</p>}
        {selected && <button onClick={() => setRegionView(true)}>进入区域详情</button>}
      </div>
      <div className="panel result">
        <h3>② 实时观察</h3>
        <div className="big-number">{selected ? selected.lat.toFixed(0) : '—'}<small>° 纬度</small></div>
        <p>{selected ? `经度 ${selected.lon.toFixed(1)}° · ${selected.continent}` : '旋转地球，点选区域可读出经纬度；语音“定位+国名”可飞行定位。'}</p>
        <p className="help">区域判定：Natural Earth 离线边界 + 点在多边形确定性计算（国家级精度）；不依赖任何在线地图服务。</p>
      </div>
      <div className="panel hint">
        <h3>③ 提示与反思</h3>
        <button onClick={() => emit('hint')}>请求提示 {hint}/2</button>
        <p>{['先观察，再按需请求提示。', task === 'A' ? clue.hints[0] : '先选定区域，再从海陆位置、纬度、地形三方面组织分析。', task === 'A' ? clue.hints[1] : '提示：联系地形地貌与人口/城市分布的因果链条作答。'][Math.min(hint, 2)]}</p>
        {stalled && <p className="notice">已经停留超过 60 秒没有新操作。可以先自己再试一次，也可以点上面的“请求提示”。</p>}
        <textarea className="reflection" aria-label="地理观察解释" rows={3} value={explanation} placeholder={task === 'B' ? '该区域的区位、地形与人文有什么关系？' : '你观察到什么？'} onChange={e => setExplanation(e.target.value)} />
        {task !== 'free' && <button className="primary" disabled={!explanation.trim() || (task === 'A' ? answerState !== 'right' : !selected) || (completed && task !== 'A')} onClick={() => emit('submit', explanation)}>{completed ? '任务已完成 ✓' : '提交观察解释'}</button>}
      </div>
    </aside>
  </section>;
}
