import { useEffect, useMemo, useRef, useState } from 'react';
import { bus } from '../../core/interaction';
import type { SceneProps } from '../types';
import { useScenePolicy, useSceneSnapshot, useServices } from '../../core/services';
import { findRegion, type RegionFeature } from './geoMath';
import { loadWorld, regionName } from './regionData';
import { SwipeDetector } from '../slides/pptGesture';
import { isDaylight, localTime, subsolarPoint, sunVector } from './solarMath';
import { GlobeView, type GlobeHandle } from './GlobeView';

type Selection = { name: string; zh: string; lat: number; lon: number };

/** 任务 A 题库：给定 UTC 时刻，预测目标城市位于昼/夜半球（isDaylight 确定性判题）。 */
const QUIZ = [
  { from: '北京', to: '纽约', utc: 12, toLat: 40.7, toLon: -74.0 },
  { from: '伦敦', to: '东京', utc: 0, toLat: 35.7, toLon: 139.7 },
  { from: '开罗', to: '悉尼', utc: 20, toLat: -33.9, toLon: 151.2 },
  { from: '上海', to: '巴黎', utc: 23, toLat: 48.9, toLon: 2.35 },
  { from: '莫斯科', to: '洛杉矶', utc: 3, toLat: 34.1, toLon: -118.2 },
];
/** 任务 B 构造目标：调整时间使指定国家全境白昼/黑夜。 */
const B_TARGETS = [
  { name: 'Japan', zh: '日本', mode: 'day' as const },
  { name: 'Egypt', zh: '埃及', mode: 'day' as const },
  { name: 'Australia', zh: '澳大利亚', mode: 'night' as const },
  { name: 'Argentina', zh: '阿根廷', mode: 'day' as const },
  { name: 'New Zealand', zh: '新西兰', mode: 'night' as const },
];
const DATES = [
  { label: '春分', doy: 80 }, { label: '夏至', doy: 172 }, { label: '秋分', doy: 266 }, { label: '冬至', doy: 355 },
];

/** 国家全境是否满足昼夜条件：对多边形采样点逐一判定（确定性）。 */
function wholeCountrySatisfies(f: RegionFeature | undefined, mode: 'day' | 'night', utc: number, doy: number): boolean {
  if (!f) return false;
  const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][];
  const samples: number[][] = [];
  for (const poly of polys) for (const ring of poly) for (let i = 0; i < ring.length; i += Math.max(4, Math.floor(ring.length / 30))) samples.push(ring[i]);
  if (!samples.length) return false;
  return samples.every(([lon, lat]) => isDaylight(lat, lon, utc, doy) === (mode === 'day'));
}

const fmt = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

/** 地理实验 2 · 晨昏线：昼夜半球 + 城市灯光，时间/节气可控，时区与昼夜探究。 */
export function DayNightScene({ active }: SceneProps) {
  const { notify, drag } = useServices();
  const [task, setTask] = useState<'free' | 'A' | 'B'>('free');
  const [features, setFeatures] = useState<RegionFeature[] | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [graticule, setGraticule] = useState(false);
  const [utc, setUtc] = useState(12);
  const [doy, setDoy] = useState(172);
  const [playing, setPlaying] = useState(false);
  const [quizIndex, setQuizIndex] = useState(0);
  const [prediction, setPrediction] = useState<'' | 'day' | 'night'>('');
  const [verdict, setVerdict] = useState<null | { ok: boolean; answer: string }>(null);
  const [bIndex, setBIndex] = useState(0);
  const [explanation, setExplanation] = useState('');
  const [completed, setCompleted] = useState(false);
  const [hint, setHint] = useState(0);
  const [started, setStarted] = useState(Date.now());
  const [stalled, setStalled] = useState(false);
  const lastActivity = useRef(Date.now());
  const host = useRef<HTMLDivElement>(null);
  const globe = useRef<GlobeHandle>(null);
  const swipe = useRef(new SwipeDetector());
  const twoHandsDist = useRef<number | null>(null);
  const lastAim = useRef({ x: 0.5, y: 0.5 });
  const pinchAnchor = useRef<{ x: number; y: number } | null>(null);
  const live = useRef({ features });
  live.current = { features };
  const quiz = QUIZ[quizIndex];
  const bTarget = B_TARGETS[bIndex];
  const subsolar = useMemo(() => subsolarPoint(utc, doy), [utc, doy]);
  const sunDir = useMemo(() => sunVector(utc, doy), [utc, doy]);
  const bFeature = useMemo(() => features?.find(f => f.properties.NAME === bTarget.name), [features, bTarget.name]);
  const bSatisfied = useMemo(() => wholeCountrySatisfies(bFeature, bTarget.mode, utc, doy), [bFeature, bTarget.mode, utc, doy]);
  const selectedDay = selected ? isDaylight(selected.lat, selected.lon, utc, doy) : null;
  const selectedLocal = selected ? localTime(selected.lon, utc) : null;

  const emit = (intent: Parameters<typeof bus.emit>[0]['intent'], value?: string, source: Parameters<typeof bus.emit>[0]['source'] = 'mouse') =>
    bus.emit({ scene: 'geo-daynight', source, intent, phase: 'end', value });

  useEffect(() => { loadWorld().then(setFeatures).catch(() => notify('边界数据加载失败。')); }, [notify]);

  // 时间自动流逝（演示“地球自转一天”）；setInterval 驱动，遮挡环境不冻结。
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setUtc(v => Math.round(((v + 0.1) % 24) * 100) / 100), 120);
    return () => clearInterval(timer);
  }, [playing]);

  const selectAt = (nx: number, ny: number) => {
    const picked = globe.current?.pickAt(nx, ny);
    const f = picked ? findRegion(live.current.features ?? [], picked.lon, picked.lat) : null;
    if (!picked) { notify('未指向地球。'); return; }
    if (!f) { setSelected({ name: 'ocean', zh: '海洋', lat: picked.lat, lon: picked.lon }); notify('选中海洋。'); return; }
    setSelected({ name: f.properties.NAME, zh: regionName(f), lat: picked.lat, lon: picked.lon });
    notify(`已选中 ${regionName(f)}`);
  };

  // 手势：与找国家实验同词汇——捏合点击选中、捏合拖动旋转、左右挥手惯性自转、双手张合缩放。
  useScenePolicy('geo-daynight', sample => {
    if (sample.phase === 'cancel') { drag.current = null; pinchAnchor.current = null; swipe.current.reset(); twoHandsDist.current = null; globe.current?.freezeInertia(); return; }
    if (sample.phase === 'start') {
      globe.current?.freezeInertia();
      pinchAnchor.current = { x: sample.x, y: sample.y };
      drag.current = { scene: 'geo-daynight', x: sample.x, y: sample.y };
      return;
    }
    if (sample.phase === 'end') {
      if (drag.current?.scene === 'geo-daynight' && pinchAnchor.current &&
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
    if (drag.current?.scene === 'geo-daynight' && sample.pinching && pinchAnchor.current &&
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
    if (e.scene !== 'geo-daynight' && e.intent !== 'switch') return;
    if (e.intent === 'run') setPlaying(true);
    if (e.intent === 'pause') setPlaying(false);
    if (e.intent === 'hint') setHint(v => Math.min(2, v + 1));
    if (e.intent === 'reset') {
      setSelected(null); setPrediction(''); setVerdict(null); setExplanation('');
      setCompleted(false); setHint(0); setStarted(Date.now()); setPlaying(false); setUtc(12);
    }
    if (e.intent === 'predict' && task === 'A') {
      const truth = isDaylight(quiz.toLat, quiz.toLon, quiz.utc, doy);
      const ok = prediction !== '' && (prediction === 'day') === truth;
      setVerdict({ ok, answer: truth ? '白昼' : '黑夜' });
      setUtc(quiz.utc);  // 把地球调到题目时刻，让学生亲眼验证
      notify(ok ? '预测正确！观察晨昏线验证后，补充解释提交。' : `预测与实际不同——实际是${truth ? '白昼' : '黑夜'}。观察晨昏线，重新思考。`);
    }
    if (e.intent === 'submit') { setCompleted(true); notify(`任务已完成，用时 ${Math.round((Date.now() - started) / 1000)} 秒。`); }
  }), [task, prediction, quiz, doy, started, notify]);

  useEffect(() => {
    if (!active) { setStalled(false); return; }
    lastActivity.current = Date.now(); setStalled(false);
    const timer = setInterval(() => setStalled(Date.now() - lastActivity.current > 60000 && !completed), 5000);
    return () => clearInterval(timer);
  }, [active, completed]);

  useSceneSnapshot('geo-daynight', () => ({
    startedAt: new Date(started).toISOString(), durationSeconds: Math.round((Date.now() - started) / 1000),
    task, utc, dayOfYear: doy, hints: hint, explanation, completed,
    quiz: task === 'A' ? { from: quiz.from, to: quiz.to, prediction, correct: verdict?.answer ?? null } : null,
    construct: task === 'B' ? { target: bTarget.zh, mode: bTarget.mode === 'day' ? '全境白昼' : '全境黑夜', satisfied: bSatisfied } : null,
  }));

  return <section className="panel geo-panel" hidden={!active}>
    <div className="task-head">
      <div><div className="eyebrow">地理 · 数字地球</div><h2>实验二 · 晨昏线</h2></div>
      <button onClick={() => emit('reset')}>重置任务</button>
    </div>
    <div className="presets">
      <button className={task === 'free' ? 'selected' : ''} onClick={() => { setTask('free'); emit('reset'); }}>演示模式</button>
      <button className={task === 'A' ? 'selected' : ''} onClick={() => { setTask('A'); emit('reset'); setQuizIndex(0); }}>任务 A · 昼夜预测</button>
      <button className={task === 'B' ? 'selected' : ''} onClick={() => { setTask('B'); emit('reset'); setBIndex(0); }}>任务 B · 追寻白昼</button>
    </div>
    <div className="task-card">{task === 'free' ? '拖动时间滑杆或点击“播放”，观察晨昏线扫过地球、夜半球城市灯光亮起；点选国家查看当地太阳时与昼夜。'
      : task === 'A' ? `预测：UTC ${fmt(quiz.utc)}（${quiz.from}时间参考）时，${quiz.to} 位于哪个半球？提交后地球会调到该时刻供你验证。`
      : `目标：调整 UTC 时间，使「${bTarget.zh}」${bTarget.mode === 'day' ? '全境处于白昼' : '全境处于黑夜'}；达成后补充解释并提交。`}</div>
    <div className="toolbar" style={{ marginTop: 12 }}>
      <span className="eyebrow" style={{ marginRight: 0 }}>UTC {fmt(utc)}</span>
      <input aria-label="UTC 时间" type="range" min={0} max={23.75} step={0.25} value={utc} onChange={e => { setPlaying(false); setUtc(Number(e.target.value)); }} style={{ width: 200 }} />
      <button onClick={() => emit(playing ? 'pause' : 'run')}>{playing ? '暂停' : '播放'}</button>
      {DATES.map(d => <button key={d.label} className={doy === d.doy ? 'selected' : ''} onClick={() => setDoy(d.doy)}>{d.label}</button>)}
      <label className="small"><input type="checkbox" checked={graticule} onChange={e => setGraticule(e.target.checked)} /> 经纬网</label>
      <span className="help">太阳直射点：{subsolar.lat.toFixed(1)}°, {subsolar.lon.toFixed(1)}° · 昼夜判定为确定性天文计算</span>
    </div>
    <div className="geo-host" ref={host}
      onPointerDown={e => { if ((e.target as HTMLElement).closest('.globe-overlay')) return; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 忽略 */ } const p = canvasPos(e); pointerState.current = { down: true, moved: 0, x: p.x, y: p.y }; }}
      onPointerMove={e => { const s = pointerState.current; if (!s.down) return; const p = canvasPos(e); s.moved = Math.max(s.moved, Math.hypot(p.x - s.x, p.y - s.y)); globe.current?.applyRotate(p.x - s.x, p.y - s.y); s.x = p.x; s.y = p.y; }}
      onPointerUp={e => { const s = pointerState.current; if (!s.down) return; s.down = false; if (s.moved < 0.02) { const p = canvasPos(e); selectAt(p.x, p.y); } }}
      onWheel={e => { if ((e.target as HTMLElement).closest('.globe-overlay')) return; e.preventDefault(); globe.current?.zoom(e.deltaY > 0 ? 0.2 : -0.2); }}>
      <GlobeView hostRef={host} ref={globe} features={features} selected={selected} graticule={graticule} night sunDirection={sunDir} />
    </div>
    <aside className="side" style={{ marginTop: 16 }}>
      <div className="panel prediction">
        <h3>① {task === 'A' ? '昼夜预测' : task === 'B' ? '构造目标' : '当前选择'}</h3>
        {task === 'A' ? <>
          <p className="help">UTC {fmt(quiz.utc)} 时，{quiz.from}与{quiz.to}分别在哪一侧？</p>
          <div className="chips">
            <button disabled={!!verdict} className={prediction === 'day' ? 'selected' : ''} onClick={() => setPrediction('day')}>{quiz.to} · 白昼</button>
            <button disabled={!!verdict} className={prediction === 'night' ? 'selected' : ''} onClick={() => setPrediction('night')}>{quiz.to} · 黑夜</button>
          </div>
          <button className="primary" disabled={!prediction || !!verdict} onClick={() => emit('predict', prediction === 'day' ? '白昼' : '黑夜')}>提交预测</button>
          {verdict && <p className="notice">{verdict.ok ? `✓ 正确！${quiz.to}此时确实处于${verdict.answer}。` : `✗ 实际是${verdict.answer}——看看晨昏线与${quiz.to}的位置关系。`}</p>}
          <button onClick={() => { setQuizIndex((quizIndex + 1) % QUIZ.length); setPrediction(''); setVerdict(null); setHint(0); notify('已切换到新题目。'); }}>换一题</button>
        </> : task === 'B' ? <>
          <p>{bTarget.mode === 'day' ? '☀' : '☾'} 目标国家：
            <select value={bIndex} onChange={e => { setBIndex(Number(e.target.value)); setCompleted(false); }}>{B_TARGETS.map((t, i) => <option key={t.name} value={i}>{t.zh} · {t.mode === 'day' ? '全境白昼' : '全境黑夜'}</option>)}</select>
          </p>
          <p className={bSatisfied ? 'notice' : 'help'}>{bSatisfied ? `✓ 达成！${bTarget.zh}已${bTarget.mode === 'day' ? '全境白昼' : '全境黑夜'}。补充解释后提交。` : `当前 UTC ${fmt(utc)} 下，${bTarget.zh}尚有部分区域处于${bTarget.mode === 'day' ? '黑夜' : '白昼'}。拖动时间滑杆尝试。`}</p>
        </> : <p>{selected ? `${selected.zh}：当地太阳时约 ${fmt(selectedLocal ?? 0)}，此刻处于${selectedDay ? '白昼 ☀' : '黑夜 ☾'}。` : '点选国家查看当地太阳时与昼夜状态。'}</p>}
      </div>
      <div className="panel result">
        <h3>② 实时观察</h3>
        <div className="big-number">{selectedLocal !== null ? fmt(selectedLocal) : fmt(utc)}<small>{selected ? `${selected.zh || '当地'}太阳时` : 'UTC'}</small></div>
        <p>{selected ? `${selected.zh}：${selectedDay ? '白昼 ☀' : '黑夜 ☾'}` : '太阳直射点 ' + subsolar.lat.toFixed(1) + '°, ' + subsolar.lon.toFixed(1) + '°'}</p>
        <p className="help">晨昏线 = 昼夜半球分界；太阳直射点随 UTC 东移（每小时 15°）、随节气在南北回归线间移动。全部判定为离线确定性计算。</p>
      </div>
      <div className="panel hint">
        <h3>③ 提示与反思</h3>
        <button onClick={() => emit('hint')}>请求提示 {hint}/2</button>
        <p>{['先观察，再按需请求提示。', '经度每 15° = 1 小时；先算目标与直射点相差几小时。', task === 'B' ? '让太阳直射点经度尽量接近目标国家中心经度。' : '直射点以东 90° 内为白昼，以西 90° 内为黑夜；正对/背对太阳决定昼夜。'][Math.min(hint, 2)]}</p>
        {stalled && <p className="notice">已经停留超过 60 秒没有新操作。可以先自己再试一次，也可以点上面的“请求提示”。</p>}
        <textarea className="reflection" aria-label="晨昏线观察解释" rows={3} value={explanation} placeholder={task === 'B' ? `为什么这个时刻${bTarget.zh}能${bTarget.mode === 'day' ? '全境白昼' : '全境黑夜'}？` : '晨昏线与经度、时间是什么关系？'} onChange={e => setExplanation(e.target.value)} />
        {task !== 'free' && <button className="primary" disabled={!explanation.trim() || (task === 'A' ? !verdict?.ok : !bSatisfied) || completed} onClick={() => emit('submit', explanation)}>{completed ? '任务已完成 ✓' : '提交观察解释'}</button>}
      </div>
    </aside>
  </section>;
}
