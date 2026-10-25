import { useEffect, useMemo, useRef, useState } from 'react';
import { bus } from '../../core/interaction';
import type { SceneProps } from '../types';
import { speak, useScenePolicy, useSceneSnapshot, useSceneVoicePolicy, useServices } from '../../core/services';
import { findRegion, type RegionFeature } from './geoMath';
import { loadWorld, regionName } from './regionData';
import { SwipeDetector } from '../slides/pptGesture';
import {
  subsolarPoint, zoneOf, daylightHours, daylightState, altitudeAtSolarHour, shadowRatio, localTime,
  ZONE_ORDER, type Zone, type DaylightState,
} from './solarMath';
import { GlobeView, type GlobeHandle } from './GlobeView';

type Selection = { name: string; zh: string; lat: number; lon: number };
type Loc = { zh: string; lat: number; lon: number };

const DATES = [
  { label: '春分', doy: 80 }, { label: '夏至', doy: 172 }, { label: '秋分', doy: 266 }, { label: '冬至', doy: 355 },
];
const dateLabel = (doy: number) => DATES.find(d => d.doy === doy)?.label ?? `第 ${doy} 天`;
const monthApprox = (doy: number) => `约 ${Math.min(12, Math.floor(doy / 30.4) + 1)} 月`;

/** 任务 A 题库：给定节气，预测城市所属五带与昼夜长短（zoneOf + daylightHours 确定性判题）。 */
const QUIZ: (Loc & { doy: number })[] = [
  { zh: '北京', lat: 39.9, lon: 116.4, doy: 172 },      // 北温带 · 昼长夜短
  { zh: '新加坡', lat: 1.35, lon: 103.8, doy: 80 },     // 热带 · 昼夜平分
  { zh: '悉尼', lat: -33.9, lon: 151.2, doy: 355 },     // 南温带 · 昼长夜短（南半球盛夏）
  { zh: '摩尔曼斯克', lat: 68.97, lon: 33.1, doy: 355 }, // 北寒带 · 极夜
  { zh: '圣保罗', lat: -23.55, lon: -46.6, doy: 172 },  // 南温带（回归线外一点点）· 昼短夜长
];
/** 任务 B 构造目标：调整日期使目标地点出现极昼/极夜。 */
const B_TARGETS: (Loc & { mode: DaylightState })[] = [
  { zh: '摩尔曼斯克', lat: 68.97, lon: 33.1, mode: '极昼' },
  { zh: '朗伊尔城', lat: 78.23, lon: 15.6, mode: '极昼' },
  { zh: '中山站', lat: -69.37, lon: 76.4, mode: '极夜' },
];
/** 任务 C 影子实验室快捷城市（广州位于北回归线内，夏至正午“立竿无影”）。 */
const C_CITIES: Loc[] = [
  { zh: '北京', lat: 39.9, lon: 116.4 },
  { zh: '广州', lat: 23.13, lon: 113.26 },
  { zh: '新加坡', lat: 1.35, lon: 103.8 },
  { zh: '悉尼', lat: -33.9, lon: 151.2 },
  { zh: '摩尔曼斯克', lat: 68.97, lon: 33.1 },
];

const fmt = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

/** 剖面影子视图：地平线 + 当日太阳轨迹弧线 + 当前太阳位置 + 标杆与影长。
 *  面向赤道的剖面约定（北半球朝南/南半球朝北）：左东右西，正午太阳在中央。 */
function ShadowProfile({ lat, lon, utc, doy }: { lat: number; lon: number; utc: number; doy: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    const W = 560, H = 300, horizonY = 240, topY = 24;
    const decl = subsolarPoint(12, doy).lat;
    const arcX = (h: number) => W / 2 + ((h - 12) / 12) * (W * 0.42);
    const arcY = (alt: number) => horizonY - (Math.max(alt, -30) / 90) * (horizonY - topY);
    ctx.fillStyle = '#0d1830'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#16251d'; ctx.fillRect(0, horizonY, W, H - horizonY);
    ctx.strokeStyle = '#3d5a4a'; ctx.beginPath(); ctx.moveTo(0, horizonY); ctx.lineTo(W, horizonY); ctx.stroke();
    // 当日轨迹：高度角 > 0 用亮色实线（白天弧），其余暗色（夜里太阳在地平线下）。
    for (let h = 0.25; h <= 24; h += 0.25) {
      const alt = altitudeAtSolarHour(lat, decl, h);
      const prev = altitudeAtSolarHour(lat, decl, h - 0.25);
      ctx.strokeStyle = alt >= 0 ? '#ffd76a' : '#2b3a57';
      ctx.globalAlpha = alt >= 0 ? 0.9 : 0.55;
      ctx.beginPath(); ctx.moveTo(arcX(h - 0.25), arcY(prev)); ctx.lineTo(arcX(h), arcY(alt)); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#7a8aa8'; ctx.font = '12px sans-serif';
    ctx.textAlign = 'left'; ctx.fillText('东', 8, horizonY + 18);
    ctx.textAlign = 'right'; ctx.fillText('西', W - 8, horizonY + 18);
    ctx.textAlign = 'center'; ctx.fillText('正午', W / 2, horizonY + 18); ctx.textAlign = 'left';
    // 当前太阳位置。
    const solar = localTime(lon, utc);
    const sunX = arcX(solar), sunY = arcY(altitudeAtSolarHour(lat, decl, solar));
    ctx.shadowColor = '#ffcf4d'; ctx.shadowBlur = 16; ctx.fillStyle = '#ffcf4d';
    ctx.beginPath(); ctx.arc(sunX, sunY, 7, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    // 标杆与影子：影长 = ratio × 杆高；正午影子指向观测者（剖面里画成椭圆缩影）。
    const px = W / 2, poleH = 52;
    ctx.strokeStyle = '#d8c9a6'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(px, horizonY); ctx.lineTo(px, horizonY - poleH); ctx.stroke();
    const sr = shadowRatio(lat, lon, utc, doy);
    if (sr != null) {
      const dx = sunX - px;
      ctx.strokeStyle = '#9fb8a8'; ctx.lineWidth = 5;
      ctx.beginPath();
      if (Math.abs(dx) < 2) ctx.ellipse(px, horizonY + 5, Math.max(6, Math.min(sr, 2) * poleH * 0.5), 4, 0, 0, Math.PI * 2);
      else { ctx.moveTo(px, horizonY + 2); ctx.lineTo(px - Math.sign(dx) * Math.min(sr, 3.2) * poleH, horizonY + 2); }
      ctx.stroke();
    }
    ctx.lineWidth = 1;
  }, [lat, lon, utc, doy]);
  return <canvas ref={ref} className="shadow-view" width={560} height={300} aria-label="太阳视运动与影长剖面图" role="img" />;
}

/** 地理实验 3 · 五带与四季：直射点周年运动、五带划分、昼夜长短与太阳视运动影长探究。 */
export function SeasonsScene({ active }: SceneProps) {
  const { notify, drag, pauseRecognition } = useServices();
  const [task, setTask] = useState<'free' | 'A' | 'B' | 'C'>('free');
  const [features, setFeatures] = useState<RegionFeature[] | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [graticule, setGraticule] = useState(false);
  const [zones, setZones] = useState(true);
  const [highlightZone, setHighlightZone] = useState<Zone | null>(null);
  const [doy, setDoy] = useState(172);
  const [utc, setUtc] = useState(12);
  const [playing, setPlaying] = useState(false);
  const [quizIndex, setQuizIndex] = useState(0);
  const [predZone, setPredZone] = useState<'' | Zone>('');
  const [predState, setPredState] = useState<'' | DaylightState>('');
  const [verdict, setVerdict] = useState<null | { ok: boolean; zone: Zone; state: DaylightState }>(null);
  const [bIndex, setBIndex] = useState(0);
  const [cLoc, setCLoc] = useState<Loc>(C_CITIES[0]);
  const [cDone, setCDone] = useState(false);
  const [explanation, setExplanation] = useState('');
  const [completed, setCompleted] = useState(false);
  const [hint, setHint] = useState(0);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [stalled, setStalled] = useState(false);
  const lastActivity = useRef(Date.now());
  const host = useRef<HTMLDivElement>(null);
  const globe = useRef<GlobeHandle>(null);
  const swipe = useRef(new SwipeDetector());
  const twoHandsDist = useRef<number | null>(null);
  const pinchAnchor = useRef<{ x: number; y: number } | null>(null);
  const lastAim = useRef({ x: 0.5, y: 0.5 });
  const live = useRef({ features, task, cLoc });
  live.current = { features, task, cLoc };
  const quiz = QUIZ[quizIndex];
  const bTarget = B_TARGETS[bIndex];
  const subsolar = useMemo(() => subsolarPoint(utc, doy), [utc, doy]);
  const decl = subsolar.lat;
  const bHours = useMemo(() => daylightHours(bTarget.lat, decl), [bTarget.lat, decl]);
  const bState = daylightState(bHours);
  const bSatisfied = bState === bTarget.mode;
  const selHours = selected ? daylightHours(selected.lat, decl) : null;
  const cSolar = localTime(cLoc.lon, utc);
  const cAlt = altitudeAtSolarHour(cLoc.lat, decl, cSolar);
  const cShadow = shadowRatio(cLoc.lat, cLoc.lon, utc, doy);
  const cNoonOk = Math.abs(cSolar - 12) <= 0.25 && cShadow != null;
  const cCustom = !C_CITIES.some(c => c.zh === cLoc.zh);

  const emit = (intent: Parameters<typeof bus.emit>[0]['intent'], value?: string, source: Parameters<typeof bus.emit>[0]['source'] = 'mouse') =>
    bus.emit({ scene: 'geo-seasons', source, intent, phase: 'end', value });

  useEffect(() => { loadWorld().then(setFeatures).catch(() => notify('边界数据加载失败。')); }, [notify]);

  // 日期自动推进（演示“一年”）；setInterval 驱动，遮挡环境不冻结。
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setDoy(v => (v % 365) + 1), 100);
    return () => clearInterval(timer);
  }, [playing]);

  const selectAt = (nx: number, ny: number) => {
    const picked = globe.current?.pickAt(nx, ny);
    if (!picked) { notify('未指向地球。'); return; }
    const f = findRegion(live.current.features ?? [], picked.lon, picked.lat);
    const zh = f ? regionName(f) : '海洋';
    setSelected({ name: f?.properties.NAME ?? 'ocean', zh, lat: picked.lat, lon: picked.lon });
    if (live.current.task === 'C') setCLoc({ zh, lat: picked.lat, lon: picked.lon });
    notify(`已选中 ${zh}（${picked.lat.toFixed(1)}°, ${picked.lon.toFixed(1)}°）${live.current.task === 'C' ? '，影子实验室已切到该地' : ''}。`);
  };

  // 场景级语音策略：节气跳转、五带高亮、任务C“正午”；播报期间暂停识别防回听。
  const lastVoice = useRef({ text: '', at: 0 });
  useSceneVoicePolicy('geo-seasons', text => {
    const t = text.replace(/\s/g, '');
    const reply = (msg: string) => {
      const now = performance.now();
      if (lastVoice.current.text !== msg || now - lastVoice.current.at > 10000) {
        lastVoice.current = { text: msg, at: now };
        const ms = speak(msg);
        if (ms) pauseRecognition(ms + 800); // 播报期间暂停识别：防止喇叭声音被麦克风回听再触发
      }
    };
    const dateHit = DATES.find(d => t.includes(d.label));
    if (dateHit) {
      setPlaying(false); setDoy(dateHit.doy);
      reply(`已切换到${dateHit.label}，太阳直射${dateHit.doy === 172 ? '北回归线' : dateHit.doy === 355 ? '南回归线' : '赤道附近'}`);
      notify(`语音 · 已切换到${dateHit.label}`);
      return true;
    }
    const zoneHit = ZONE_ORDER.find(z => t.includes(z));
    if (zoneHit) {
      setHighlightZone(zoneHit);
      reply(`已高亮${zoneHit}`);
      notify(`语音 · 已高亮${zoneHit}`);
      return true;
    }
    if (t.includes('正午')) {
      const target = (((12 - live.current.cLoc.lon / 15) % 24) + 24) % 24;
      setPlaying(false); setUtc(Math.round(target * 4) / 4);
      reply(`已把${live.current.cLoc.zh}调到正午`);
      notify(`语音 · ${live.current.cLoc.zh}已调到当地正午`);
      return true;
    }
    return false;
  });

  // 手势：与找国家/晨昏线同词汇——捏合点击选中、捏合拖动旋转、挥手惯性、双手张合缩放。
  useScenePolicy('geo-seasons', sample => {
    if (sample.phase === 'cancel') { drag.current = null; pinchAnchor.current = null; swipe.current.reset(); twoHandsDist.current = null; globe.current?.freezeInertia(); return; }
    if (sample.phase === 'start') {
      globe.current?.freezeInertia();
      pinchAnchor.current = { x: sample.x, y: sample.y };
      drag.current = { scene: 'geo-seasons', x: sample.x, y: sample.y };
      return;
    }
    if (sample.phase === 'end') {
      if (drag.current?.scene === 'geo-seasons' && pinchAnchor.current &&
          Math.hypot(sample.x - pinchAnchor.current.x, sample.y - pinchAnchor.current.y) < 0.05) selectAt(lastAim.current.x, lastAim.current.y);
      drag.current = null; pinchAnchor.current = null; swipe.current.reset();
      return;
    }
    if (!sample.pinching) lastAim.current = { x: sample.x, y: sample.y };
    if (sample.hands && sample.hands.length >= 2) {
      const d = Math.hypot(sample.hands[0].x - sample.hands[1].x, sample.hands[0].y - sample.hands[1].y);
      if (twoHandsDist.current != null && Math.abs(d - twoHandsDist.current) > 0.008) globe.current?.zoom(-(d - twoHandsDist.current) * 2.4);
      twoHandsDist.current = d;
    } else twoHandsDist.current = null;
    if (!sample.pinching) {
      const dir = swipe.current.push(sample.x, sample.y, performance.now(), { pinching: false });
      if (dir) globe.current?.addSpin(dir === 'right' ? 1 : -1);
    } else swipe.current.reset();
    if (drag.current?.scene === 'geo-seasons' && sample.pinching && pinchAnchor.current &&
        Math.hypot(sample.x - pinchAnchor.current.x, sample.y - pinchAnchor.current.y) >= 0.05) {
      globe.current?.applyRotate(sample.x - drag.current.x, sample.y - drag.current.y);
      drag.current.x = sample.x; drag.current.y = sample.y;
    }
  });

  const pointerState = useRef<{ down: boolean; moved: number; x: number; y: number }>({ down: false, moved: 0, x: 0, y: 0 });
  const canvasPos = (e: React.PointerEvent | React.WheelEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  useEffect(() => bus.subscribe(e => {
    lastActivity.current = Date.now();
    if (e.scene !== 'geo-seasons' && e.intent !== 'switch') return;
    if (e.intent === 'run') setPlaying(true);
    if (e.intent === 'pause') setPlaying(false);
    if (e.intent === 'hint') setHint(v => Math.min(2, v + 1));
    if (e.intent === 'reset') {
      setSelected(null); setPredZone(''); setPredState(''); setVerdict(null); setHighlightZone(null);
      setExplanation(''); setCompleted(false); setHint(0); setStartedAt(Date.now()); setPlaying(false);
      setDoy(172); setUtc(12); setCDone(false);
    }
    if (e.intent === 'predict' && task === 'A') {
      const truthZone = zoneOf(quiz.lat);
      const truthState = daylightState(daylightHours(quiz.lat, subsolarPoint(12, quiz.doy).lat));
      const ok = predZone === truthZone && predState === truthState;
      setVerdict({ ok, zone: truthZone, state: truthState });
      setPlaying(false); setDoy(quiz.doy);
      globe.current?.flyTo(quiz.lat, quiz.lon);  // 把地球调到题目城市与日期，亲眼验证
      notify(ok ? '预测正确！观察五带边界与直射点位置，补充解释提交。' : `预测与实际不同——${quiz.zh}实际属于${truthZone}、${truthState}。观察直射点后重新思考。`);
    }
    if (e.intent === 'submit') { setCompleted(true); notify(`任务已完成，用时 ${Math.round((Date.now() - startedAt) / 1000)} 秒。`); }
  }), [task, predZone, predState, quiz, startedAt, notify]);

  // 任务 C 判题：当地太阳时距正午 15 分钟内且太阳已升（影长存在）→ 正午达成。
  useEffect(() => {
    if (task !== 'C' || cDone || !cNoonOk) return;
    setCDone(true);
    emit('predict', '正午');
    notify('✓ 正午达成！此刻影长最短。切换节气对比弧线，补充解释提交。');
  }, [task, cDone, cNoonOk, notify]);

  useEffect(() => {
    if (!active) { setStalled(false); return; }
    lastActivity.current = Date.now(); setStalled(false);
    const timer = setInterval(() => setStalled(Date.now() - lastActivity.current > 60000 && !completed), 5000);
    return () => clearInterval(timer);
  }, [active, completed]);

  useSceneSnapshot('geo-seasons', () => ({
    startedAt: new Date(startedAt).toISOString(), durationSeconds: Math.round((Date.now() - startedAt) / 1000),
    task, dayOfYear: doy, utc, hints: hint, explanation, completed,
    selected: selected ? { region: selected.zh, lat: Number(selected.lat.toFixed(2)), lon: Number(selected.lon.toFixed(2)) } : null,
    quiz: task === 'A' ? { city: quiz.zh, date: dateLabel(quiz.doy), predZone, predState, correct: verdict?.ok ?? null } : null,
    construct: task === 'B' ? { target: bTarget.zh, mode: bTarget.mode, satisfied: bSatisfied } : null,
    shadow: task === 'C' ? { city: cLoc.zh, latitude: Number(cLoc.lat.toFixed(2)), noonReached: cDone } : null,
  }));

  const zoneChips = ['热带', '北温带', '南温带', '北寒带', '南寒带'] as const;
  const stateChips = ['极昼', '昼长夜短', '昼夜平分', '昼短夜长', '极夜'] as const;

  return <section className="panel geo-panel" hidden={!active}>
    <div className="task-head">
      <div><div className="eyebrow">地理 · 数字地球</div><h2>实验三 · 五带与四季</h2></div>
      <button onClick={() => emit('reset')}>重置任务</button>
    </div>
    <div className="presets">
      <button className={task === 'free' ? 'selected' : ''} onClick={() => { setTask('free'); emit('reset'); }}>演示模式</button>
      <button className={task === 'A' ? 'selected' : ''} onClick={() => { setTask('A'); emit('reset'); setQuizIndex(0); }}>任务 A · 五带昼夜预测</button>
      <button className={task === 'B' ? 'selected' : ''} onClick={() => { setTask('B'); emit('reset'); setBIndex(0); setDoy(80); }}>任务 B · 追寻极昼</button>
      <button className={task === 'C' ? 'selected' : ''} onClick={() => { setTask('C'); emit('reset'); setCDone(false); }}>任务 C · 影长实验</button>
    </div>
    <div className="task-card">{task === 'free' ? '拖动日期滑杆或点击节气按钮，观察太阳直射点在回归线间往返、五带范围与昼夜长短的变化；点选国家查看它的五带与昼长。'
      : task === 'A' ? `预测：${dateLabel(quiz.doy)}时，${quiz.zh}（纬度 ${quiz.lat}°）属于哪个五带？昼夜长短是什么状态？提交后地球会转到该日期供你验证。`
      : task === 'B' ? `目标：调整日期滑杆，使「${bTarget.zh}」出现${bTarget.mode}；达成后补充解释并提交。`
      : '在地球上点选一个城市（或用快捷选择），拖动“一天时刻”滑杆让太阳沿弧线移动，把影长调到一天中最短——也就是当地正午。'}</div>
    <div className="toolbar" style={{ marginTop: 12 }}>
      <span className="eyebrow" style={{ marginRight: 0 }}>日期 第 {doy} 天</span>
      <input aria-label="日期" type="range" min={1} max={365} step={1} value={doy} onChange={e => { setPlaying(false); setDoy(Number(e.target.value)); }} style={{ width: 170 }} />
      <span className="small">{monthApprox(doy)} · {dateLabel(doy)}</span>
      <button onClick={() => emit(playing ? 'pause' : 'run')}>{playing ? '暂停' : '播放一年'}</button>
      {DATES.map(d => <button key={d.label} className={doy === d.doy ? 'selected' : ''} onClick={() => { setPlaying(false); setDoy(d.doy); }}>{d.label}</button>)}
      <span className="eyebrow" style={{ marginRight: 0 }}>时刻 UTC {fmt(utc)}</span>
      <input aria-label="一天时刻" type="range" min={0} max={23.75} step={0.25} value={utc} onChange={e => { setPlaying(false); setUtc(Number(e.target.value)); }} style={{ width: 140 }} />
      <label className="small"><input type="checkbox" checked={zones} onChange={e => setZones(e.target.checked)} /> 五带</label>
      <label className="small"><input type="checkbox" checked={graticule} onChange={e => setGraticule(e.target.checked)} /> 经纬网</label>
      <span className="help">太阳直射点：{decl.toFixed(1)}°, {subsolar.lon.toFixed(1)}° · 全部判定为确定性天文计算</span>
    </div>
    <div className="geo-host" ref={host}
      onPointerDown={e => { if ((e.target as HTMLElement).closest('.globe-overlay')) return; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 忽略 */ } const p = canvasPos(e); pointerState.current = { down: true, moved: 0, x: p.x, y: p.y }; }}
      onPointerMove={e => { const s = pointerState.current; if (!s.down) return; const p = canvasPos(e); s.moved = Math.max(s.moved, Math.hypot(p.x - s.x, p.y - s.y)); globe.current?.applyRotate(p.x - s.x, p.y - s.y); s.x = p.x; s.y = p.y; }}
      onPointerUp={e => { const s = pointerState.current; if (!s.down) return; s.down = false; if (s.moved < 0.02) { const p = canvasPos(e); selectAt(p.x, p.y); } }}
      onWheel={e => { if ((e.target as HTMLElement).closest('.globe-overlay')) return; e.preventDefault(); globe.current?.zoom(e.deltaY > 0 ? 0.2 : -0.2); }}>
      <GlobeView hostRef={host} ref={globe} features={features} selected={selected} graticule={graticule}
        zones={zones} subsolarMarker={{ lat: subsolar.lat, lon: subsolar.lon }} highlightZone={highlightZone} />
    </div>
    <aside className="side" style={{ marginTop: 16 }}>
      <div className="panel prediction">
        <h3>① {task === 'A' ? '五带与昼夜预测' : task === 'B' ? '构造目标' : task === 'C' ? '影子实验室地点' : '当前选择'}</h3>
        {task === 'A' ? <>
          <p className="help">{dateLabel(quiz.doy)} · {quiz.zh}（纬度 {quiz.lat}°）</p>
          <p className="small">它属于哪个五带？</p>
          <div className="chips">{zoneChips.map(z => <button key={z} disabled={!!verdict} className={predZone === z ? 'selected' : ''} onClick={() => setPredZone(z)}>{z}</button>)}</div>
          <p className="small">昼夜长短是什么状态？</p>
          <div className="chips">{stateChips.map(s => <button key={s} disabled={!!verdict} className={predState === s ? 'selected' : ''} onClick={() => setPredState(s)}>{s}</button>)}</div>
          <button className="primary" disabled={!predZone || !predState || !!verdict} onClick={() => emit('predict')}>提交预测</button>
          {verdict && <p className="notice">{verdict.ok ? `✓ 正确！${quiz.zh}确实属于${verdict.zone}、${verdict.state}。` : `✗ 实际是${verdict.zone} · ${verdict.state}——看看直射点在哪条纬线。`}</p>}
          <button onClick={() => { setQuizIndex((quizIndex + 1) % QUIZ.length); setPredZone(''); setPredState(''); setVerdict(null); setHint(0); notify('已切换到新题目。'); }}>换一题</button>
        </> : task === 'B' ? <>
          <p>{bTarget.mode === '极昼' ? '☀' : '☾'} 目标地点：
            <select value={bIndex} onChange={e => { setBIndex(Number(e.target.value)); setCompleted(false); }}>{B_TARGETS.map((t, i) => <option key={t.zh} value={i}>{t.zh} · 出现{t.mode}</option>)}</select>
          </p>
          <p className={bSatisfied ? 'notice' : 'help'}>{bSatisfied ? `✓ 达成！${bTarget.zh}此刻昼长 ${bHours.toFixed(1)} 小时，出现${bState}。补充解释后提交。` : `第 ${doy} 天（${dateLabel(doy)}）：${bTarget.zh}昼长 ${bHours.toFixed(1)} 小时，状态「${bState}」，尚未${bTarget.mode}。拖动日期滑杆尝试。`}</p>
        </> : task === 'C' ? <>
          <p>影子地点：
            <select value={cCustom ? '__custom' : cLoc.zh} onChange={e => { const c = C_CITIES.find(c => c.zh === e.target.value); if (c) { setCLoc(c); setCDone(false); } }}>
              {C_CITIES.map(c => <option key={c.zh} value={c.zh}>{c.zh}（{Math.abs(c.lat).toFixed(1)}°{c.lat >= 0 ? 'N' : 'S'}）</option>)}
              {cCustom && <option value="__custom">{cLoc.zh}（点选）</option>}
            </select>
          </p>
          <p className="help">也可直接在地球上点选城市，剖面视图会跟随切换（全局—局部视角联动）。</p>
          <p className={cDone ? 'notice' : 'help'}>{cDone ? '✓ 正午达成！影长已是一天中最短。' : `当前当地太阳时 ${fmt(cSolar)}——正午是 12:00，继续调整。`}</p>
        </> : <p>{selected ? `${selected.zh}：纬度 ${selected.lat.toFixed(1)}°，属于${zoneOf(selected.lat)}；${dateLabel(doy)}昼长 ${selHours?.toFixed(1)} 小时（${daylightState(selHours ?? 0)}）。` : '点选国家查看它的五带与昼长；也可以语音说“夏至”“北温带”。'}</p>}
      </div>
      <div className="panel result">
        <h3>② {task === 'C' ? '太阳视运动与影长' : '实时观察'}</h3>
        {task === 'C' ? <>
          <ShadowProfile lat={cLoc.lat} lon={cLoc.lon} utc={utc} doy={doy} />
          <div className="toolbar" style={{ margin: '10px 0 0' }}>
            <span className="eyebrow" style={{ marginRight: 0 }}>一天时刻 UTC {fmt(utc)}</span>
            <input aria-label="影长视图时刻" type="range" min={0} max={23.75} step={0.25} value={utc}
              onChange={e => { setPlaying(false); setUtc(Number(e.target.value)); }} style={{ flex: 1, minWidth: 160 }} />
            <span className="small">{cLoc.zh}当地 {fmt(cSolar)}</span>
          </div>
          <div className="shadow-meta">
            <span>当地太阳时 <b>{fmt(cSolar)}</b></span>
            <span>太阳高度角 <b>{cAlt > 0 ? `${cAlt.toFixed(1)}°` : '地平线下'}</b></span>
            <span>影长/杆高 <b>{cShadow != null ? cShadow.toFixed(2) : '—（太阳未升）'}</b></span>
            <span>{zoneOf(cLoc.lat)} · {dateLabel(doy)}</span>
          </div>
          <p className="help">{cShadow == null ? (daylightState(daylightHours(cLoc.lat, decl)) === '极夜' ? '极夜：太阳整日不升，全天无影。' : '太阳此刻在地平线下。') : `影子${Math.abs(localTime(cLoc.lon, utc) - 12) <= 0.25 ? '指向' + (cLoc.lat >= 0 ? '北' : '南') + '（正午，朝向观察者）' : cSolar < 12 ? '偏西（太阳在东）' : '偏东（太阳在西）'}。剖面视图面向赤道：左东右西。`}</p>
        </> : <>
          <div className="big-number">{decl.toFixed(1)}<small>° 太阳直射纬度</small></div>
          <p>{selected ? `${selected.zh}：${zoneOf(selected.lat)} · 昼长 ${selHours?.toFixed(1)}h · ${daylightState(selHours ?? 0)}` : `直射点经度 ${subsolar.lon.toFixed(1)}°（随 UTC 西移，每小时 15°）`}</p>
          <p className="help">直射点在南北回归线间往返（回归年 365 天）；热带直射、寒带极昼极夜，温带居中。</p>
        </>}
      </div>
      <div className="panel hint">
        <h3>③ 提示与反思</h3>
        <button onClick={() => emit('hint')}>请求提示 {hint}/2</button>
        <p>{['先观察，再按需请求提示。', task === 'A' ? '先看纬度落在哪两条分界纬线（±23.44°、±66.56°）之间；再看直射点在南还是北半球。' : task === 'B' ? '极昼只发生在极圈内：让太阳直射点与该地同在一个极向的半球，且直射纬度足够高。' : '影长最短 = 太阳高度角最高 = 当地太阳时 12:00。'][Math.min(hint, 2)]}</p>
        {stalled && <p className="notice">已经停留超过 60 秒没有新操作。可以先自己再试一次，也可以点上面的“请求提示”。</p>}
        <textarea className="reflection" aria-label="五带四季观察解释" rows={3} value={explanation}
          placeholder={task === 'A' ? '为什么这个城市属于这个五带？和直射点有什么关系？' : task === 'B' ? '为什么这一天这里会出现极昼/极夜？' : '影子长短和太阳高度角是什么关系？不同节气有何不同？'}
          onChange={e => setExplanation(e.target.value)} />
        {task !== 'free' && <button className="primary" disabled={!explanation.trim() || (task === 'A' ? !verdict?.ok : task === 'B' ? !bSatisfied : !cDone) || completed} onClick={() => emit('submit', explanation)}>{completed ? '任务已完成 ✓' : '提交观察解释'}</button>}
      </div>
    </aside>
  </section>;
}
