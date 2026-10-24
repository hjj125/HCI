import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { bus } from '../../core/interaction';
import type { SceneProps } from '../types';
import { useScenePolicy, useSceneSnapshot, useServices } from '../../core/services';
import { latLonToVector3, vector3ToLatLon, findRegion, type RegionFeature } from './geoMath';
import { loadWorld, regionName, cardFor, CLUES } from './regionData';
import { streamRegionChat, type ChatMessage } from './llm';

type Selection = { name: string; zh: string; lat: number; lon: number; continent: string };
type World = {
  scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer;
  earthGroup: THREE.Group; earth: THREE.Mesh; marker: THREE.Mesh; highlight: THREE.LineSegments;
  borders: THREE.LineSegments; observer: ResizeObserver;
};

/** 地理场景插件：手势旋转数字地球 → 指向选中区域 → 区位/地形/人文（内置卡 + DeepSeek 增强）。 */
export function GeographyScene({ active }: SceneProps) {
  const { notify, drag } = useServices();
  const [task, setTask] = useState<'free' | 'A' | 'B'>('free');
  const [mode, setMode] = useState<'rotate' | 'select'>('rotate');
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
  const host = useRef<HTMLDivElement>(null);
  const world = useRef<World | null>(null);
  const live = useRef({ mode, selected, features, graticule });
  live.current = { mode, selected, features, graticule };
  const clue = CLUES[clueIndex];

  const emit = (intent: Parameters<typeof bus.emit>[0]['intent'], value?: string, source: Parameters<typeof bus.emit>[0]['source'] = 'mouse') =>
    bus.emit({ scene: 'geography', source, intent, phase: 'end', value });

  useEffect(() => { loadWorld().then(setFeatures).catch(() => notify('边界数据加载失败，请检查 public/assets。')); }, [notify]);

  // 三维地球：昼面贴图 + 法线 + 云层 + 大气辉光 + 星空；WebGL 不可用时降级为文字提示。
  useEffect(() => {
    const el = host.current; if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch { el.textContent = 'WebGL 不可用，请启用硬件加速。任务面板仍可使用。'; return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#050914');
    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
    camera.position.set(0, 0, 3.1);
    scene.add(new THREE.AmbientLight(0xffffff, 0.38));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.15); sun.position.set(5, 2, 4); scene.add(sun);
    const loader = new THREE.TextureLoader();
    const earthGroup = new THREE.Group(); scene.add(earthGroup);
    const material = new THREE.MeshPhongMaterial({
      map: loader.load('/assets/earth_atmos_2048.jpg'),
      normalMap: loader.load('/assets/earth_normal_2048.jpg'),
      normalScale: new THREE.Vector2(0.8, 0.8),
      shininess: 14, specular: new THREE.Color(0x445566),
    });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 64), material);
    earthGroup.add(earth);
    const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.012, 48, 48),
      new THREE.MeshPhongMaterial({ map: loader.load('/assets/earth_clouds_1024.png'), transparent: true, opacity: 0.55, depthWrite: false }));
    earthGroup.add(clouds);
    // 大气辉光（内侧菲涅尔近似）
    const glow = new THREE.Mesh(new THREE.SphereGeometry(1.16, 48, 48), new THREE.ShaderMaterial({
      vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vN; void main(){ float i = pow(0.62 - dot(vN, vec3(0.0,0.0,1.0)), 3.0); gl_FragColor = vec4(0.30,0.62,1.0,1.0) * i; }',
      side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    }));
    scene.add(glow);
    // 星空
    const starPos = new Float32Array(2400);
    for (let i = 0; i < 800; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(18 + Math.random() * 10);
      starPos.set([v.x, v.y, v.z], i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xbfd4ff, size: 0.05, sizeAttenuation: true })));
    // 经纬网（每 30°）
    const grat = new THREE.Group(); grat.name = 'graticule'; earthGroup.add(grat);
    const gratMat = new THREE.LineBasicMaterial({ color: 0x7ae8d4, transparent: true, opacity: 0.18 });
    for (let lat = -60; lat <= 60; lat += 30) for (let lon = -180; lon < 180; lon += 5) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...latLonToVector3(lat, lon, 1.003)), new THREE.Vector3(...latLonToVector3(lat, lon + 5, 1.003))]);
      grat.add(new THREE.Line(g, gratMat));
    }
    for (let lon = -180; lon < 180; lon += 30) for (let lat = -88; lat < 88; lat += 4) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...latLonToVector3(lat, lon, 1.003)), new THREE.Vector3(...latLonToVector3(lat + 4, lon, 1.003))]);
      grat.add(new THREE.Line(g, gratMat));
    }
    // 国界线（数据加载后填充）与选中高亮
    const borders = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x9fe8d8, transparent: true, opacity: 0.55 }));
    earthGroup.add(borders);
    const highlight = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xf4c784 }));
    earthGroup.add(highlight);
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 16), new THREE.MeshBasicMaterial({ color: 0xf4c784 }));
    marker.visible = false; earthGroup.add(marker);
    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); camera.aspect = h ? w / h : 1; camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      clouds.rotation.y += 0.0004;                       // 云层缓慢自转
      earthGroup.rotation.x *= 0.98;                     // 轻微回正，避免极端俯仰
      renderer.render(scene, camera);
    };
    tick();
    world.current = { scene, camera, renderer, earthGroup, earth, marker, highlight, borders, observer };
    return () => { cancelAnimationFrame(frame); observer.disconnect(); renderer.dispose(); renderer.domElement.remove(); world.current = null; };
  }, []);

  // 边界数据 → 线段；选中区域 → 高亮边界与标记。
  useEffect(() => {
    const w = world.current; if (!w || !features) return;
    const pts: number[] = [];
    for (const f of features) for (const poly of (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][])
      for (const ring of poly) for (let i = 0; i + 1 < ring.length; i++) {
        pts.push(...latLonToVector3(ring[i][1], ring[i][0], 1.004), ...latLonToVector3(ring[i + 1][1], ring[i + 1][0], 1.004));
      }
    w.borders.geometry.dispose();
    w.borders.geometry = new THREE.BufferGeometry();
    w.borders.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }, [features]);
  useEffect(() => {
    const w = world.current; if (!w) return;
    const grat = w.earthGroup.getObjectByName('graticule');
    if (grat) grat.visible = graticule;
    if (!selected || !features) { w.marker.visible = false; w.highlight.geometry.dispose(); w.highlight.geometry = new THREE.BufferGeometry(); return; }
    w.marker.position.set(...latLonToVector3(selected.lat, selected.lon, 1.02));
    w.marker.visible = true;
    const f = features.find(x => x.properties.NAME === selected.name);
    const pts: number[] = [];
    if (f) for (const poly of (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][])
      for (const ring of poly) for (let i = 0; i + 1 < ring.length; i++)
        pts.push(...latLonToVector3(ring[i][1], ring[i][0], 1.006), ...latLonToVector3(ring[i + 1][1], ring[i + 1][0], 1.006));
    w.highlight.geometry.dispose();
    w.highlight.geometry = new THREE.BufferGeometry();
    w.highlight.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }, [selected, features, graticule]);

  // 选择：屏幕点 → 射线 → 球面 → 经纬度 → 区域（判定复用已测试的 findRegion）。
  const selectAt = (nx: number, ny: number) => {
    const w = world.current; if (!w || !live.current.features) return;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(nx * 2 - 1, -(ny * 2 - 1)), w.camera);
    const hit = ray.intersectObject(w.earth)[0];
    if (!hit) { notify('未指向地球，请对准球体再选择。'); return; }
    const local = w.earthGroup.worldToLocal(hit.point.clone());
    const { lat, lon } = vector3ToLatLon([local.x, local.y, local.z]);
    const f = findRegion(live.current.features, lon, lat);
    if (!f) { setSelected({ name: 'ocean', zh: '海洋', lat, lon, continent: '—' }); notify(`选中海洋（${lat.toFixed(1)}°, ${lon.toFixed(1)}°）。请选择陆地区域。`); return; }
    setSelected({ name: f.properties.NAME, zh: regionName(f), lat, lon, continent: f.properties.CONTINENT ?? '—' });
    notify(`已选中 ${regionName(f)}（${lat.toFixed(1)}°, ${lon.toFixed(1)}°）。`);
  };

  const applyRotate = (dx: number, dy: number) => {
    const w = world.current; if (!w) return;
    w.earthGroup.rotation.y += dx * 4.2;
    const next = Math.max(-1.2, Math.min(1.2, w.earthGroup.rotation.x + dy * 2.4));
    w.earthGroup.rotation.x = next;
  };
  const zoom = (delta: number) => {
    const w = world.current; if (!w) return;
    w.camera.position.z = Math.max(1.45, Math.min(6, w.camera.position.z + delta));
  };

  // 手势策略：旋转模式捏合拖动=转地球；选择模式捏合“点击”（位移<3% 屏宽）=选中。
  useScenePolicy('geography', sample => {
    if (sample.phase === 'cancel') { drag.current = null; return; }
    if (live.current.mode === 'rotate') {
      if (sample.phase === 'start') { drag.current = { scene: 'geography', x: sample.x, y: sample.y }; return; }
      if (drag.current?.scene === 'geography' && sample.pinching) {
        applyRotate(sample.x - drag.current.x, sample.y - drag.current.y);
        drag.current.x = sample.x; drag.current.y = sample.y;
        return;
      }
      if (drag.current?.scene === 'geography' && sample.phase === 'end') drag.current = null;
      return;
    }
    if (live.current.mode === 'select' && sample.phase === 'start') { drag.current = { scene: 'geography', x: sample.x, y: sample.y }; return; }
    if (live.current.mode === 'select' && sample.phase === 'end' && drag.current?.scene === 'geography') {
      const moved = Math.hypot(sample.x - drag.current.x, sample.y - drag.current.y);
      if (moved < 0.03) selectAt(drag.current.x, drag.current.y);
      drag.current = null;
    }
  });

  // 鼠标：拖动旋转（旋转模式）/ 点击选择（选择模式）；滚轮缩放。
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
      setMode('rotate'); setSelected(null); setRegionView(false); setAnswerState('none'); setAnswerRegion('');
      setExplanation(''); setCompleted(false); setHint(0); setStarted(Date.now()); setChat([]); setChatView(false); setInput(''); setStreaming(false);
    }
    if (e.intent === 'predict') {
      const target = clue.target;
      const ok = selected?.name === target;
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
    task, mode, hints: hint, explanation, completed,
    selected: selected ? { region: selected.zh, lat: Number(selected.lat.toFixed(2)), lon: Number(selected.lon.toFixed(2)) } : null,
    quiz: task === 'A' ? { target: clue.target, result: answerState } : null,
    aiTurns: chat.filter(m => m.role === 'user').length,
  }));

  const card = selected ? cardFor({ properties: { NAME: selected.name, CONTINENT: selected.continent }, geometry: { type: 'Polygon', coordinates: [] } }) : null;
  // AI 对话：发送一条消息并流式接收回复（打字机效果）。
  const send = async (text: string) => {
    const t = text.trim();
    if (!selected || streaming || !t) return;
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
      <div><div className="eyebrow">地理 · 数字地球</div><h2>世界地理探究</h2></div>
      <button onClick={() => emit('reset')}>重置任务</button>
    </div>
    <div className="presets">
      <button className={task === 'free' ? 'selected' : ''} onClick={() => { setTask('free'); emit('reset'); }}>演示模式</button>
      <button className={task === 'A' ? 'selected' : ''} onClick={() => { setTask('A'); emit('reset'); }}>任务 A · 线索定位</button>
      <button className={task === 'B' ? 'selected' : ''} onClick={() => { setTask('B'); emit('reset'); }}>任务 B · 区位分析</button>
    </div>
    <div className="task-card">{task === 'free' ? '拖动旋转地球，切到“选择”后点选区域，进入查看区位/地形/人文资料（可配 DeepSeek 生成讲解）。'
      : task === 'A' ? `根据线索在地球上选中目标国家，然后点“确认作答”：${clue.clue}`
      : '选择任意区域进入详情，观察区位、地形与人文的关系，回答下方问题并提交。'}</div>
    <div className="toolbar" style={{ marginTop: 12 }}>
      <span aria-label="操作模式" role="group" className="tool-toggle">
        <button aria-pressed={mode === 'rotate'} className={mode === 'rotate' ? 'selected' : ''} onClick={() => setMode('rotate')}>旋转</button>
        <button aria-pressed={mode === 'select'} className={mode === 'select' ? 'selected' : ''} onClick={() => setMode('select')}>选择</button>
      </span>
      <button onClick={() => zoom(-0.35)}>放大 +</button>
      <button onClick={() => zoom(0.35)}>缩小 −</button>
      <label className="small"><input type="checkbox" checked={graticule} onChange={e => setGraticule(e.target.checked)} /> 经纬网</label>
      <span className="help">{mode === 'rotate' ? '捏合或按住地球拖动即可旋转（鼠标滚轮缩放）' : '指向区域后捏合“点击”即可选中（鼠标单击）'}</span>
    </div>
    <div className="geo-host" ref={host}
      onPointerDown={e => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 忽略 */ } const p = canvasPos(e); pointerState.current = { down: true, moved: 0, x: p.x, y: p.y }; }}
      onPointerMove={e => {
        const s = pointerState.current; if (!s.down) return;
        const p = canvasPos(e);
        s.moved = Math.max(s.moved, Math.hypot(p.x - s.x, p.y - s.y));
        if (mode === 'rotate') applyRotate(p.x - s.x, p.y - s.y);
        s.x = p.x; s.y = p.y;
      }}
      onPointerUp={e => {
        const s = pointerState.current; s.down = false;
        if (mode === 'select' && s.moved < 0.02) { const p = canvasPos(e); selectAt(p.x, p.y); }
      }}
      onWheel={e => { e.preventDefault(); zoom(e.deltaY > 0 ? 0.2 : -0.2); }}>
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
            <button className="primary" style={{ width: 'auto' }} onClick={() => { setChatView(true); if (chat.length === 0) void send('请完整介绍这个区域。'); }}>AI 生成讲解 →</button>
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
          <p>当前选中：{selected?.zh ?? '（在选择模式下点选国家）'}</p>
          <button className="primary" disabled={!selected || answerState !== 'none'} onClick={() => emit('predict', selected?.zh)}>确认作答</button>
          {answerState !== 'none' && <p className={answerState === 'right' ? 'notice' : 'notice'}>{answerState === 'right' ? '✓ 回答正确！' : `✗ 选中的是${answerRegion}，正确答案线索再读一遍。`}</p>}
          <button onClick={() => { setClueIndex((clueIndex + 1) % CLUES.length); setAnswerState('none'); setAnswerRegion(''); setSelected(null); setHint(0); notify('已切换到新线索。'); }}>换一题</button>
        </> : task === 'B' ? <p>选择一个区域进入详情（或直接作答）：观察区位、地形与人文特征之间的关系，例如“地形如何影响人口分布”。</p>
        : <p>{selected ? `已选中 ${selected.zh}（${selected.lat.toFixed(1)}°, ${selected.lon.toFixed(1)}°）` : '未选择区域。切到“选择”模式后点选地球上的国家。'}</p>}
        {selected && <button onClick={() => setRegionView(true)}>进入区域详情</button>}
      </div>
      <div className="panel result">
        <h3>② 实时观察</h3>
        <div className="big-number">{selected ? selected.lat.toFixed(0) : '—'}<small>° 纬度</small></div>
        <p>{selected ? `经度 ${selected.lon.toFixed(1)}° · ${selected.continent}` : '旋转地球，选择模式下点选区域可读出经纬度。'}</p>
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
