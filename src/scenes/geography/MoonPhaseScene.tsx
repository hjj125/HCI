import { useEffect, useMemo, useRef, useState } from 'react';
import { bus } from '../../core/interaction';
import type { SceneProps } from '../types';
import { speak, useScenePolicy, useSceneSnapshot, useSceneVoicePolicy, useServices } from '../../core/services';
import { SwipeDetector } from '../slides/pptGesture';
import {
  SYNODIC_MONTH, moonAgeToElongation, phaseFromElongation, moonPhaseOnDate, lunarDayToAge,
  visibleHours, visibilityNote, phaseShape, type MoonPhaseName,
} from './moonMath';
import { MoonView, type MoonHandle } from './MoonView';

type Task = 'free' | 'A' | 'B' | 'C';

const PHASES: MoonPhaseName[] = ['新月', '蛾眉月', '上弦月', '盈凸月', '满月', '亏凸月', '下弦月', '残月'];
const PHASE_AGE: Partial<Record<MoonPhaseName, number>> = { 新月: 0, 上弦月: SYNODIC_MONTH / 4, 满月: SYNODIC_MONTH / 2, 下弦月: (SYNODIC_MONTH * 3) / 4 };

/** 任务 A 题库：给定农历日预测月相（lunarDayToAge + phaseFromElongation 确定性判题）。 */
export const QUIZ = [
  { lunarDay: 15 }, { lunarDay: 8 }, { lunarDay: 23 }, { lunarDay: 3 }, { lunarDay: 27 },
];
/** 任务 B 构造目标：把月亮调到指定相位（距角 ±5° 判定）。 */
const B_TARGETS: { name: MoonPhaseName; elong: number }[] = [
  { name: '上弦月', elong: 90 }, { name: '满月', elong: 180 }, { name: '下弦月', elong: 270 },
];
const lunarDayOf = (age: number) => Math.min(30, Math.floor((age / SYNODIC_MONTH) * 30) + 1);

/** 地面视角月相盘：月相的本义是"从地球看到的形状"——明暗界线为椭圆，半宽 = R·|cos 距角|。 */
function MoonDisc({ elongDeg }: { elongDeg: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const W = c.width, H = c.height, cx = W / 2, cy = H / 2, R = W * 0.42;
    const { litSide, terminator } = phaseShape(elongDeg);
    const { illumination } = phaseFromElongation(elongDeg);
    ctx.fillStyle = '#0c1526'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#2a3550';
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    const lit = '#f5e9c8';
    if (litSide === 'full') {
      ctx.fillStyle = lit; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    } else if (litSide !== 'none') {
      ctx.fillStyle = lit;
      ctx.beginPath();
      if (litSide === 'right') ctx.arc(cx, cy, R, -Math.PI / 2, Math.PI / 2);
      else ctx.arc(cx, cy, R, Math.PI / 2, (3 * Math.PI) / 2);
      ctx.closePath(); ctx.fill();
      // 界线椭圆：照亮过半（凸月）为亮，不过半（蛾眉/残月）为暗（从亮半圆上挖掉）。
      ctx.fillStyle = illumination > 0.5 ? lit : '#2a3550';
      ctx.beginPath(); ctx.ellipse(cx, cy, R * terminator, R, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = '#4a5f85'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  }, [elongDeg]);
  return <canvas ref={ref} width={260} height={260} className="moon-disc" aria-label="地面视角月相" role="img" />;
}

/** 地理实验四 · 月相仪：拖动月球公转，理解朔望圆缺的成因与周期。 */
export function MoonPhaseScene({ active }: SceneProps) {
  const { notify, drag, pauseRecognition } = useServices();
  const [task, setTask] = useState<Task>('free');
  const [age, setAge] = useState(() => moonPhaseOnDate(new Date()).ageDays);
  const [playing, setPlaying] = useState(false);
  const [quizIndex, setQuizIndex] = useState(0);
  const [predName, setPredName] = useState<'' | MoonPhaseName>('');
  const [verdict, setVerdict] = useState<null | { ok: boolean; name: MoonPhaseName }>(null);
  const [bIndex, setBIndex] = useState(0);
  const [savedC, setSavedC] = useState<{ name: MoonPhaseName; illumination: number }[]>([]);
  const [explanation, setExplanation] = useState('');
  const [completed, setCompleted] = useState(false);
  const [hint, setHint] = useState(0);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [stalled, setStalled] = useState(false);
  const lastActivity = useRef(Date.now());
  const host = useRef<HTMLDivElement>(null);
  const moon = useRef<MoonHandle>(null);
  const swipe = useRef(new SwipeDetector());
  const vel = useRef(0);
  const twoHandsDist = useRef<number | null>(null);
  const pinchAnchor = useRef<{ x: number; y: number } | null>(null);
  const live = useRef({ playing });
  live.current = { playing };
  const quiz = QUIZ[quizIndex];
  const bTarget = B_TARGETS[bIndex];
  const elong = useMemo(() => moonAgeToElongation(age), [age]);
  const phase = useMemo(() => phaseFromElongation(elong), [elong]);
  const bSatisfied = Math.abs(elong - bTarget.elong) <= 5;
  const cSatisfied = savedC.some(s => s.name === '新月') && savedC.some(s => s.name === '满月');

  const emit = (intent: Parameters<typeof bus.emit>[0]['intent'], value?: string, source: Parameters<typeof bus.emit>[0]['source'] = 'mouse') =>
    bus.emit({ scene: 'geo-moonphase', source, intent, phase: 'end', value });

  // 播放一个月 + 挥手冲量的惯性推进（一个定时器统一驱动）。
  useEffect(() => {
    const timer = setInterval(() => {
      if (playing) setAge(a => (a + 0.12) % SYNODIC_MONTH);
      else if (Math.abs(vel.current) > 0.002) {
        setAge(a => { const v = (a + vel.current) % SYNODIC_MONTH; return v < 0 ? v + SYNODIC_MONTH : v; });
        vel.current *= 0.88;
        if (Math.abs(vel.current) <= 0.002) vel.current = 0;
      }
    }, 90);
    return () => clearInterval(timer);
  }, [playing]);

  // 场景级语音：四相跳转与"今天"查询；播报后暂停识别防回听。
  const lastVoice = useRef({ text: '', at: 0 });
  useSceneVoicePolicy('geo-moonphase', text => {
    const t = text.replace(/\s/g, '');
    const hit = (msg: string, target: number) => {
      setPlaying(false); setAge(((target % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH);
      const now = performance.now();
      if (lastVoice.current.text !== msg || now - lastVoice.current.at > 10000) {
        lastVoice.current = { text: msg, at: now };
        const ms = speak(msg);
        if (ms) pauseRecognition(ms + 800);
      }
      notify(`语音 · ${msg}`);
      return true;
    };
    if (t.includes('新月') || t.includes('朔')) return hit('已调到新月', 0);
    if (t.includes('上弦')) return hit('已调到上弦月', SYNODIC_MONTH / 4);
    if (t.includes('满月') || t.includes('望')) return hit('已调到满月', SYNODIC_MONTH / 2);
    if (t.includes('下弦')) return hit('已调到下弦月', (SYNODIC_MONTH * 3) / 4);
    if (t.includes('今天') || t.includes('今晚')) {
      const today = moonPhaseOnDate(new Date());
      return hit(`今天是${today.name}，照亮约 ${Math.round(today.illumination * 100)}%（教学近似）`, today.ageDays);
    }
    return false;
  });

  // 手势：捏合拖动=直接调月龄、左右挥手=月龄冲量（惯性）、双手张合=缩放视角。
  useScenePolicy('geo-moonphase', sample => {
    if (sample.phase === 'cancel') { drag.current = null; pinchAnchor.current = null; swipe.current.reset(); twoHandsDist.current = null; vel.current = 0; return; }
    if (sample.phase === 'start') {
      vel.current = 0;
      pinchAnchor.current = { x: sample.x, y: sample.y };
      drag.current = { scene: 'geo-moonphase', x: sample.x, y: sample.y };
      return;
    }
    if (sample.phase === 'end') {
      drag.current = null; pinchAnchor.current = null; swipe.current.reset();
      return;
    }
    if (sample.hands && sample.hands.length >= 2) {
      const d = Math.hypot(sample.hands[0].x - sample.hands[1].x, sample.hands[0].y - sample.hands[1].y);
      if (twoHandsDist.current != null && Math.abs(d - twoHandsDist.current) > 0.008) moon.current?.zoom((d - twoHandsDist.current) * 2.0);
      twoHandsDist.current = d;
    } else twoHandsDist.current = null;
    if (!sample.pinching) {
      const dir = swipe.current.push(sample.x, sample.y, performance.now(), { pinching: false });
      if (dir) { vel.current = dir === 'right' ? 0.28 : -0.28; setPlaying(false); notify(dir === 'right' ? '挥手 · 时间快进' : '挥手 · 时间回退'); }
    } else swipe.current.reset();
    if (drag.current?.scene === 'geo-moonphase' && sample.pinching && pinchAnchor.current) {
      const dx = sample.x - drag.current.x;
      if (Math.abs(dx) > 0) {
        setPlaying(false);
        setAge(a => { const v = (a + dx * 0.55) % SYNODIC_MONTH; return v < 0 ? v + SYNODIC_MONTH : v; });
        drag.current.x = sample.x; drag.current.y = sample.y;
      }
    }
  });

  const pointerState = useRef<{ down: boolean; x: number }>({ down: false, x: 0 });
  useEffect(() => bus.subscribe(e => {
    lastActivity.current = Date.now();
    if (e.scene !== 'geo-moonphase' && e.intent !== 'switch') return;
    if (e.intent === 'run') setPlaying(true);
    if (e.intent === 'pause') setPlaying(false);
    if (e.intent === 'hint') setHint(v => Math.min(2, v + 1));
    if (e.intent === 'reset') {
      setPredName(''); setVerdict(null); setSavedC([]); setExplanation(''); setCompleted(false);
      setHint(0); setStartedAt(Date.now()); setPlaying(false); vel.current = 0;
    }
    if (e.intent === 'predict' && task === 'A') {
      const truth = phaseFromElongation(moonAgeToElongation(lunarDayToAge(quiz.lunarDay)));
      const ok = predName === truth.name;
      setVerdict({ ok, name: truth.name });
      setPlaying(false); setAge(lunarDayToAge(quiz.lunarDay));
      notify(ok ? `✓ 正确！农历${quiz.lunarDay}确实是${truth.name}，照亮 ${Math.round(truth.illumination * 100)}%。` : `✗ 农历${quiz.lunarDay}实际是${truth.name}（照亮 ${Math.round(truth.illumination * 100)}%）——观察月球的朝向再想想。`);
    }
    if (e.intent === 'submit') { setCompleted(true); notify(`任务已完成，用时 ${Math.round((Date.now() - startedAt) / 1000)} 秒。`); }
  }), [task, predName, quiz, startedAt, notify]);

  useEffect(() => {
    if (!active) { setStalled(false); return; }
    lastActivity.current = Date.now(); setStalled(false);
    const timer = setInterval(() => setStalled(Date.now() - lastActivity.current > 60000 && !completed), 5000);
    return () => clearInterval(timer);
  }, [active, completed]);

  useSceneSnapshot('geo-moonphase', () => ({
    startedAt: new Date(startedAt).toISOString(), durationSeconds: Math.round((Date.now() - startedAt) / 1000),
    task, moonAge: Number(age.toFixed(2)), elongation: Number(elong.toFixed(1)),
    phase: phase.name, illumination: Number(phase.illumination.toFixed(3)),
    hints: hint, explanation, completed,
    quiz: task === 'A' ? { lunarDay: quiz.lunarDay, prediction: predName || null, correct: verdict?.ok ?? null } : null,
    construct: task === 'B' ? { target: bTarget.name, satisfied: bSatisfied } : null,
    compare: task === 'C' ? { saved: savedC } : null,
  }));

  const HINTS: Record<Task, string[]> = {
    free: ['拖动月球或月龄滑杆，看它绕地球公转一圈的变化。', '月球被照亮的一半永远朝太阳——变的是我们看到的角度。', '按“今天”查看真实日期对应的月相（教学近似）。'],
    A: ['先想日-地-月的相对位置：农历十五，地球在太阳和月亮中间。', '农历三十/初一，月亮在太阳和地球之间，亮面背对我们。', '对照②里的地面视角：你看到的是亮面的哪一部分？'],
    B: ['上弦月 = 月亮转到地球-太阳连线的侧面 90°。', '拖动月龄，看“距角”接近 90°。', '上弦月约在农历初七前后。'],
    C: ['新月和满月差半个月：月亮正好绕了半圈。', '新月照亮 0%，满月照亮 100%。', '想想为什么满月整夜可见，而新月夜间不可见。'],
  };

  return <section className="panel geo-panel" hidden={!active}>
    <div className="task-head">
      <div><div className="eyebrow">地理 · 数字地球</div><h2>实验四 · 月相仪</h2></div>
      <button onClick={() => emit('reset')}>重置任务</button>
    </div>
    <div className="presets">
      <button className={task === 'free' ? 'selected' : ''} onClick={() => { setTask('free'); emit('reset'); }}>演示模式</button>
      <button className={task === 'A' ? 'selected' : ''} onClick={() => { setTask('A'); emit('reset'); setQuizIndex(0); }}>任务 A · 月相预测</button>
      <button className={task === 'B' ? 'selected' : ''} onClick={() => { setTask('B'); emit('reset'); setBIndex(0); setAge(0); }}>任务 B · 追寻上弦月</button>
      <button className={task === 'C' ? 'selected' : ''} onClick={() => { setTask('C'); emit('reset'); }}>任务 C · 朔望对比</button>
    </div>
    <div className="task-card">{task === 'free' ? '捏合拖动（或拖动滑杆）让月球绕地球公转：右侧是同一时刻从地球看到的月相。注意月球亮面永远朝太阳，变的是我们看到的角度。'
      : task === 'A' ? `预测：农历${quiz.lunarDay}的晚上，月亮是什么相？提交后月球会转到该日期供你验证。`
      : task === 'B' ? `目标：调整月龄，使月亮成为「${bTarget.name}」（距角 ${bTarget.elong}°±5°）；达成后补充解释并提交。`
      : '分别把月亮调到「新月」和「满月」，各保存一次对比快照；观察照亮比例与可见时段的差异，解释为什么十五的月亮圆。'}</div>
    <div className="toolbar" style={{ marginTop: 12 }}>
      <span className="eyebrow" style={{ marginRight: 0 }}>月龄 {age.toFixed(1)} 天</span>
      <input aria-label="月龄" type="range" min={0} max={29.5} step={0.05} value={Math.min(age, 29.5)} onChange={e => { setPlaying(false); vel.current = 0; setAge(Number(e.target.value)); }} style={{ width: 190 }} />
      <span className="small">农历约 {lunarDayOf(age)} 日</span>
      <button onClick={() => emit(playing ? 'pause' : 'run')}>{playing ? '暂停' : '播放一月'}</button>
      {(['新月', '上弦月', '满月', '下弦月'] as MoonPhaseName[]).map(name =>
        <button key={name} className={phase.name === name ? 'selected' : ''} onClick={() => { setPlaying(false); vel.current = 0; setAge(PHASE_AGE[name] ?? 0); }}>{name}</button>)}
      <button onClick={() => { const today = moonPhaseOnDate(new Date()); setPlaying(false); vel.current = 0; setAge(today.ageDays); notify(`今天（教学近似）：${today.name}，照亮约 ${Math.round(today.illumination * 100)}%。`); }}>今天</button>
      <span className="help">距角 {elong.toFixed(0)}° · 照亮 {(phase.illumination * 100).toFixed(0)}% · 确定性天文近似</span>
    </div>
    <div className="geo-host" ref={host}
      onWheel={e => { e.preventDefault(); moon.current?.zoom(e.deltaY > 0 ? 0.2 : -0.2); }}>
      <MoonView hostRef={host} ref={moon} ageDays={age} />
    </div>
    <aside className="side" style={{ marginTop: 16 }}>
      <div className="panel prediction">
        <h3>① {task === 'A' ? '月相预测' : task === 'B' ? '构造目标' : task === 'C' ? '对比快照' : '当前月相'}</h3>
        {task === 'A' ? <>
          <p className="help">农历{quiz.lunarDay}的晚上，月亮是什么相？</p>
          <div className="chips">{PHASES.map(p => <button key={p} disabled={!!verdict} className={predName === p ? 'selected' : ''} onClick={() => setPredName(p)}>{p}</button>)}</div>
          <button className="primary" disabled={!predName || !!verdict} onClick={() => emit('predict')}>提交预测</button>
          {verdict && <p className="notice">{verdict.ok ? `✓ 正确！农历${quiz.lunarDay}确实是${verdict.name}。` : `✗ 农历${quiz.lunarDay}实际是${verdict.name}——看②的地面视角。`}</p>}
          <button onClick={() => { setQuizIndex((quizIndex + 1) % QUIZ.length); setPredName(''); setVerdict(null); setHint(0); notify('已切换到新题目。'); }}>换一题</button>
        </> : task === 'B' ? <>
          <p>目标相位：<b>{bTarget.name}</b>（距角 {bTarget.elong}°±5°）</p>
          <p className={bSatisfied ? 'notice' : 'help'}>{bSatisfied ? `✓ 达成！当前距角 ${elong.toFixed(1)}°，正是${bTarget.name}。补充解释后提交。` : `当前距角 ${elong.toFixed(1)}°——拖动月龄接近 ${bTarget.elong}°。`}</p>
        </> : task === 'C' ? <>
          {savedC.length === 0 && <p className="help">还没有快照。把月亮调到「新月」保存一次。</p>}
          {savedC.map((s, i) => <p key={i} className="help">快照{i + 1}：{s.name} · 照亮 {Math.round(s.illumination * 100)}%</p>)}
          <button disabled={savedC.length >= 2} onClick={() => { setSavedC(v => [...v.filter(s => s.name !== phase.name), { name: phase.name, illumination: phase.illumination }].slice(-2)); notify(`已保存${phase.name}快照。`); }}>保存当前月相</button>
          {cSatisfied && <p className="notice">✓ 朔望两帧已就绪！对比照亮比例与可见时段，解释后提交。</p>}
        </> : <p>{phase.name} · 照亮 {(phase.illumination * 100).toFixed(0)}% · {visibilityNote(phase.name)}</p>}
      </div>
      <div className="panel result">
        <h3>② 地面视角</h3>
        <MoonDisc elongDeg={elong} />
        <p style={{ marginTop: 10 }}>月龄 {age.toFixed(1)} 天 · 农历约 {lunarDayOf(age)} 日</p>
        <p>{phase.name} · 照亮 {(phase.illumination * 100).toFixed(0)}% · 夜间可见约 {visibleHours(elong).toFixed(0)} 小时</p>
        <p className="help">{visibilityNote(phase.name)}。上为太空视角（俯视轨道），下为从地球看到的形状。</p>
      </div>
      <div className="panel hint">
        <h3>③ 提示与反思</h3>
        <button onClick={() => emit('hint')}>请求提示 {hint}/2</button>
        <p>{HINTS[task][Math.min(hint, 2)]}</p>
        {stalled && <p className="notice">已经停留超过 60 秒没有新操作。可以先自己再试一次，也可以点上面的“请求提示”。</p>}
        <textarea className="reflection" aria-label="月相观察解释" rows={3} value={explanation}
          placeholder={task === 'A' ? '你是根据什么判断月相的？' : task === 'B' ? '上弦月时日-地-月是什么相对位置？' : '为什么十五的月亮圆？'}
          onChange={e => setExplanation(e.target.value)} />
        {task !== 'free' && <button className="primary" disabled={!explanation.trim() || (task === 'A' ? !verdict?.ok : task === 'B' ? !bSatisfied : !cSatisfied) || completed} onClick={() => emit('submit', explanation)}>{completed ? '任务已完成 ✓' : '提交观察解释'}</button>}
      </div>
    </aside>
  </section>;
}
