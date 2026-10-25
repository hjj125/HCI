import { useEffect, useRef, useState } from 'react';
import { bus } from '../../core/interaction';
import type { SceneProps } from '../types';
import { speak, useScenePolicy, useSceneSnapshot, useSceneVoicePolicy, useServices } from '../../core/services';
import type { HandSample } from '../../core/useHandInput';
import { angleAt, twoHandAngle, thumbIndexAngle, classifyAngle, isWithin, stabilize, type Pt } from './bodyAngle';

type Task = 'free' | 'A' | 'B' | 'C';
type Mode = 'two' | 'thumb';

/** 任务 A 目标角（换一题循环）。 */
export const TARGETS = [90, 60, 120, 45, 150, 30, 135];
const B_TARGETS = [60, 90, 120, 45];               // 任务 B 拼指定角（±8°）
const CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
const CLASSES = ['锐角', '直角', '钝角', '平角'] as const;
type AngleClass = (typeof CLASSES)[number];

/** 测量视图：手部骨架叠加 + 顶点角度弧线 + 大号度数。 */
function MeasureView({ landmarks, deg, mode, locked }: { landmarks: Pt[][] | null; deg: number | null; mode: Mode; locked: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const W = c.width, H = c.height;
    const px = (p: Pt) => ({ x: p.x * W, y: p.y * H });
    ctx.fillStyle = '#0c1727'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#16233b'; ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) { ctx.beginPath(); ctx.moveTo((i / 10) * W, 0); ctx.lineTo((i / 10) * W, H); ctx.stroke(); }
    if (landmarks) {
      ctx.strokeStyle = '#38d8c1'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      for (const hand of landmarks) {
        for (const [a, b] of CONNECTIONS) {
          const p = px(hand[a]), q = px(hand[b]);
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
        }
        ctx.fillStyle = '#8ff0dc';
        for (const p of hand.map(px)) { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill(); }
      }
    }
    // 顶点角度弧线：双手角顶点=两腕中点；虎口角顶点=拇指掌根。
    if (landmarks && deg != null && ((mode === 'two' && landmarks.length >= 2) || (mode === 'thumb' && landmarks.length >= 1))) {
      let vertex: Pt, r1: Pt, r2: Pt;
      if (mode === 'two') {
        vertex = px({ x: (landmarks[0][0].x + landmarks[1][0].x) / 2, y: (landmarks[0][0].y + landmarks[1][0].y) / 2 });
        r1 = px(landmarks[0][8]); r2 = px(landmarks[1][8]);
      } else {
        vertex = px(landmarks[0][2]); r1 = px(landmarks[0][4]); r2 = px(landmarks[0][8]);
      }
      const a1 = Math.atan2(r1.y - vertex.y, r1.x - vertex.x);
      const a2 = Math.atan2(r2.y - vertex.y, r2.x - vertex.x);
      ctx.strokeStyle = locked ? '#f4c784' : '#ffd76a'; ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(vertex.x, vertex.y, 46, Math.min(a1, a2), Math.max(a1, a2) > Math.min(a1, a2) + Math.PI ? Math.max(a1, a2) - Math.PI * 2 : Math.max(a1, a2));
      ctx.stroke(); ctx.lineWidth = 1;
    }
    ctx.fillStyle = deg != null ? (locked ? '#f4c784' : '#5de0c6') : '#5a6d8c';
    ctx.font = '600 64px Inter, "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(deg != null ? `${deg.toFixed(1)}°` : '—', W / 2, 96);
    ctx.font = '16px Inter, "Microsoft YaHei", sans-serif';
    ctx.fillText(locked ? '已锁定（再捏合一下/点击解锁）' : '实时读数', W / 2, 126);
    if (!landmarks) {
      ctx.fillStyle = '#7a8aa8'; ctx.font = '15px Inter, "Microsoft YaHei", sans-serif';
      ctx.fillText('启用摄像头后：双手各伸出一根食指拼一个角（或切换为单手虎口角）', W / 2, H / 2 + 60);
    }
    ctx.textAlign = 'left';
  }, [landmarks, deg, mode, locked]);
  return <canvas ref={ref} width={1200} height={460} aria-label="角度测量视图" className="fn-host-canvas" />;
}

/** 量角器刻度盘：当前读数指针 + 目标角扇形。 */
function ProtractorDisc({ deg, target, targetVisible }: { deg: number | null; target: number | null; targetVisible: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const W = c.width, H = c.height, cx = W / 2, cy = H * 0.86, R = W * 0.42;
    ctx.fillStyle = '#0c1526'; ctx.fillRect(0, 0, W, H);
    // 目标角扇形（±8°）
    if (targetVisible && target != null) {
      ctx.fillStyle = '#29b99f33';
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, R, Math.PI - ((target + 8) / 180) * Math.PI, Math.PI - ((target - 8) / 180) * Math.PI);
      ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = '#33507a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, R, Math.PI, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();
    ctx.fillStyle = '#7a8aa8'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    for (let d = 0; d <= 180; d += 15) {
      const a = Math.PI - (d / 180) * Math.PI;
      const x1 = cx + Math.cos(a) * R, y1 = cy + Math.sin(a) * R;
      const x2 = cx + Math.cos(a) * (R - (d % 45 === 0 ? 14 : 7)), y2 = cy + Math.sin(a) * (R - (d % 45 === 0 ? 14 : 7));
      ctx.strokeStyle = '#4a5f85'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      if (d % 45 === 0) ctx.fillText(String(d), cx + Math.cos(a) * (R - 26), cy + Math.sin(a) * (R - 26) + 4);
    }
    if (deg != null) {
      const a = Math.PI - (Math.max(0, Math.min(180, deg)) / 180) * Math.PI;
      ctx.strokeStyle = '#f4c784'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke();
      ctx.lineWidth = 1;
    }
  }, [deg, target, targetVisible]);
  return <canvas ref={ref} width={260} height={220} className="moon-disc" style={{ borderRadius: 12 }} aria-label="量角器刻度盘" role="img" />;
}

/** 数学实验三 · 身体量角器：用双手（或虎口）拼出角度，landmark 夹角实时测量。 */
export function AngleScene({ active }: SceneProps) {
  const { notify, pauseRecognition } = useServices();
  const [task, setTask] = useState<Task>('free');
  const [mode, setMode] = useState<Mode>('two');
  const [reading, setReading] = useState<{ landmarks: Pt[][] | null; deg: number | null }>({ landmarks: null, deg: null });
  const [lockedDeg, setLockedDeg] = useState<number | null>(null);
  const [aIndex, setAIndex] = useState(0);
  const [predClass, setPredClass] = useState<'' | AngleClass>('');
  const [verdictA, setVerdictA] = useState<null | boolean>(null);
  const [bIndex, setBIndex] = useState(0);
  const [anglesC, setAnglesC] = useState<number[]>([]);
  const [explanation, setExplanation] = useState('');
  const [completed, setCompleted] = useState(false);
  const [hint, setHint] = useState(0);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [stalled, setStalled] = useState(false);
  const lastActivity = useRef(Date.now());
  const hist = useRef<number[]>([]);
  const live = useRef({ mode });
  live.current = { mode };
  const targetA = TARGETS[aIndex];
  const targetB = B_TARGETS[bIndex];
  const deg = lockedDeg ?? reading.deg;
  const bSatisfied = lockedDeg != null && isWithin(lockedDeg, targetB, 8);
  const sumC = anglesC.reduce((s, v) => s + v, 0);
  const cSatisfied = anglesC.length >= 3 && Math.abs(sumC - 180) <= 12;

  const emit = (intent: Parameters<typeof bus.emit>[0]['intent'], value?: string, source: Parameters<typeof bus.emit>[0]['source'] = 'mouse') =>
    bus.emit({ scene: 'math-bodyangle', source, intent, phase: 'end', value });

  const toggleLock = () => {
    setLockedDeg(v => {
      if (v != null) { notify('已解锁，恢复实时读数。'); return null; }
      const stable = stabilize(hist.current, 3);
      if (stable == null && reading.deg == null) { notify('还没有读数——先让双手入镜。'); return null; }
      const value = stable ?? reading.deg!;
      notify(`已锁定读数：${value.toFixed(1)}°${stable == null ? '（手还在动，建议保持稳定后重新锁定）' : ''}`);
      return Number(value.toFixed(1));
    });
  };

  // 手势策略：landmark → 读数；指向画布捏合一下（几乎未移动）= 锁定/解锁。
  const pinchAnchor = useRef<{ x: number; y: number } | null>(null);
  useScenePolicy('math-bodyangle', (sample: HandSample) => {
    if (sample.phase === 'cancel') { pinchAnchor.current = null; return; }
    if (sample.phase === 'start') { pinchAnchor.current = { x: sample.x, y: sample.y }; return; }
    if (sample.phase === 'end') {
      if (pinchAnchor.current && Math.hypot(sample.x - pinchAnchor.current.x, sample.y - pinchAnchor.current.y) < 0.05) toggleLock();
      pinchAnchor.current = null;
      return;
    }
    const lms = sample.landmarks ?? null;
    let deg: number | null = null;
    if (lms) deg = live.current.mode === 'two' ? twoHandAngle(lms) : thumbIndexAngle(lms[0]);
    if (deg != null) {
      hist.current.push(deg);
      if (hist.current.length > 30) hist.current.shift();
    }
    setReading({ landmarks: lms, deg });
  });

  // 场景级语音：锁定/解锁/读数（TTS 播报防自激）。
  useSceneVoicePolicy('math-bodyangle', text => {
    const t = text.replace(/\s/g, '');
    if (t.includes('解锁')) { setLockedDeg(null); notify('语音 · 已解锁'); return true; }
    if (t.includes('锁定')) { toggleLock(); notify('语音 · 尝试锁定读数'); return true; }
    if (t.includes('读数') || t.includes('多少度')) {
      const d = lockedDeg ?? reading.deg;
      if (d == null) { notify('还没有读数。'); return true; }
      const ms = speak(`当前角度约 ${Math.round(d)} 度，${classifyAngle(d)}`);
      if (ms) pauseRecognition(ms + 800);
      return true;
    }
    return false;
  });

  useEffect(() => bus.subscribe(e => {
    lastActivity.current = Date.now();
    if (e.scene !== 'math-bodyangle' && e.intent !== 'switch') return;
    if (e.intent === 'hint') setHint(v => Math.min(2, v + 1));
    if (e.intent === 'reset') {
      setPredClass(''); setVerdictA(null); setAnglesC([]); setLockedDeg(null);
      setExplanation(''); setCompleted(false); setHint(0); setStartedAt(Date.now());
    }
    if (e.intent === 'predict' && task === 'A') {
      const truth = classifyAngle(targetA);
      const ok = predClass === truth;
      setVerdictA(ok);
      notify(ok ? `✓ 正确！${targetA}° 是${truth}。` : `✗ ${targetA}° 是${truth}——对照量角器刻度盘再看一次。`);
    }
    if (e.intent === 'submit') { setCompleted(true); notify(`任务已完成，用时 ${Math.round((Date.now() - startedAt) / 1000)} 秒。`); }
  }), [task, predClass, targetA, startedAt, notify]);

  useEffect(() => {
    if (!active) { setStalled(false); return; }
    lastActivity.current = Date.now(); setStalled(false);
    const timer = setInterval(() => setStalled(Date.now() - lastActivity.current > 60000 && !completed), 5000);
    return () => clearInterval(timer);
  }, [active, completed]);

  useSceneSnapshot('math-bodyangle', () => ({
    startedAt: new Date(startedAt).toISOString(), durationSeconds: Math.round((Date.now() - startedAt) / 1000),
    task, mode, lastDegree: deg != null ? Number(deg.toFixed(1)) : null, lockedDegree: lockedDeg,
    hints: hint, explanation, completed,
    quiz: task === 'A' ? { target: targetA, prediction: predClass || null, correct: verdictA } : null,
    construct: task === 'B' ? { target: targetB, satisfied: bSatisfied } : null,
    sum: task === 'C' ? { angles: anglesC.map(v => Number(v.toFixed(1))), sum: Number(sumC.toFixed(1)), satisfied: cSatisfied } : null,
  }));

  const HINTS: Record<Task, string[]> = {
    free: ['双手各伸一根食指，慢慢张开合拢，看读数变化。', '切换到虎口角模式，单手也能量锐角。', '手保持不动约 0.3 秒，捏合一下即可锁定读数。'],
    A: ['锐角小于 90°，钝角大于 90°，直角正好 90°。', '想象量角器：把目标角和右手直角比一比。', '三角尺上的直角是现成的参照物。'],
    B: ['先拼一个大约的角，再微调手指张合。', '手稳定住，捏合一下锁定读数（±8° 内算达成）。', '90° 就是前臂互相垂直的感觉。'],
    C: ['依次摆三个角：每个都稳定后锁定，再点“记录”。', '三个角加起来应该非常接近 180°。', '差一点很正常——真实测量都有误差，想想误差从哪来。'],
  };

  return <section className="panel" hidden={!active}>
    <div className="task-head">
      <div><div className="eyebrow">数学 · 具身测量</div><h2>身体量角器</h2></div>
      <button onClick={() => emit('reset')}>重置任务</button>
    </div>
    <div className="presets">
      <button className={task === 'free' ? 'selected' : ''} onClick={() => { setTask('free'); emit('reset'); }}>演示模式</button>
      <button className={task === 'A' ? 'selected' : ''} onClick={() => { setTask('A'); emit('reset'); setAIndex(0); }}>任务 A · 角度预测</button>
      <button className={task === 'B' ? 'selected' : ''} onClick={() => { setTask('B'); emit('reset'); setBIndex(0); }}>任务 B · 拼指定角</button>
      <button className={task === 'C' ? 'selected' : ''} onClick={() => { setTask('C'); emit('reset'); }}>任务 C · 内角和探究</button>
    </div>
    <div className="task-card">{task === 'free' ? '双手各伸出一根食指，张开就是一个角：屏幕实时显示度数。手稳定后捏合一下（或点击“锁定读数”）可冻结读数；也可以切换为单手虎口角量锐角。'
      : task === 'A' ? `屏幕量角器上有一个 ${targetA}° 的目标角（隐藏刻度数字）：先预测它是锐角、直角、钝角还是平角，提交后揭晓。`
      : task === 'B' ? `目标：用${mode === 'two' ? '双手食指' : '虎口'}拼出 ${targetB}° 的角，稳定后锁定读数（±8° 内达成）。`
      : '依次摆出三个角：每个稳定后锁定并点“记录”，三个角都记录后系统求和——看看离 180° 差多少，想想误差从哪里来。'}</div>
    <div className="toolbar" style={{ marginTop: 12 }}>
      <span role="group" aria-label="测量模式">
        <button className={mode === 'two' ? 'selected' : ''} onClick={() => { setMode('two'); setLockedDeg(null); hist.current = []; }}>双手角</button>
        <button className={mode === 'thumb' ? 'selected' : ''} onClick={() => { setMode('thumb'); setLockedDeg(null); hist.current = []; }}>虎口角</button>
      </span>
      <button onClick={toggleLock}>{lockedDeg != null ? '解锁读数' : '锁定读数'}</button>
      {task === 'C' && <>
        <button disabled={lockedDeg == null || anglesC.length >= 3} onClick={() => { if (lockedDeg != null) { setAnglesC(v => [...v, lockedDeg]); notify(`已记录第 ${anglesC.length + 1} 个角：${lockedDeg.toFixed(1)}°。`); } }}>记录第 {anglesC.length + 1} 个角</button>
        <button disabled={!anglesC.length} onClick={() => setAnglesC([])}>清除记录</button>
      </>}
      <span className="help">骨架为手部关键点示意（摄像头画面见右下角）；锁定用最近读数的中位数，抗手抖</span>
    </div>
    <div className="fn-host" onClick={() => { /* 画布点击由按钮与捏合承担，避免误触锁定 */ }}>
      <MeasureView landmarks={reading.landmarks} deg={deg} mode={mode} locked={lockedDeg != null} />
    </div>
    <aside className="side" style={{ marginTop: 16 }}>
      <div className="panel prediction">
        <h3>① {task === 'A' ? '角度预测' : task === 'B' ? '拼指定角' : task === 'C' ? '内角和记录' : '当前读数'}</h3>
        {task === 'A' ? <>
          <p className="help">目标角是哪一类？（看量角器扇形，数字揭晓前先预测）</p>
          <div className="chips">{CLASSES.map(c => <button key={c} disabled={!!verdictA} className={predClass === c ? 'selected' : ''} onClick={() => setPredClass(c)}>{c}</button>)}</div>
          <button className="primary" disabled={!predClass || !!verdictA} onClick={() => emit('predict')}>提交预测</button>
          {verdictA !== null && <p className="notice">{verdictA ? `✓ 正确！目标角是 ${targetA}°，属于${classifyAngle(targetA)}。` : `✗ 目标角是 ${targetA}°，属于${classifyAngle(targetA)}——对照②的刻度盘。`}</p>}
          <button onClick={() => { setAIndex((aIndex + 1) % TARGETS.length); setPredClass(''); setVerdictA(null); setHint(0); notify('已切换到新目标角。'); }}>换一题</button>
        </> : task === 'B' ? <>
          <p>目标：拼出 <b>{targetB}°</b>（±8°）</p>
          <p className={bSatisfied ? 'notice' : 'help'}>{bSatisfied ? `✓ 达成！锁定读数 ${lockedDeg?.toFixed(1)}°。补充解释后提交。` : lockedDeg != null ? `锁定读数 ${lockedDeg?.toFixed(1)}°，还差 ${Math.abs(lockedDeg - targetB).toFixed(1)}°——解锁微调再试。` : '拼好角后点“锁定读数”参与判题。'}</p>
        </> : task === 'C' ? <>
          {anglesC.length === 0 && <p className="help">还没有记录。摆第一个角并锁定。</p>}
          {anglesC.map((v, i) => <p key={i} className="help">角{i + 1}：{v.toFixed(1)}°</p>)}
          {anglesC.length === 3 && <p className={cSatisfied ? 'notice' : 'help'}>三内角之和 = {sumC.toFixed(1)}°{cSatisfied ? '，与 180° 的偏差在容差内 ✓。' : `，与 180° 相差 ${Math.abs(sumC - 180).toFixed(1)}°——先解锁微调重试。`}</p>}
        </> : <p>{deg != null ? `实时读数 ${deg.toFixed(1)}°（${classifyAngle(deg)}）${lockedDeg != null ? ' · 已锁定' : ''}` : '等待手部入镜……'}</p>}
      </div>
      <div className="panel result">
        <h3>② 量角器</h3>
        <ProtractorDisc deg={deg} target={task === 'A' ? targetA : task === 'B' ? targetB : null}
          targetVisible={task === 'B' || (task === 'A' && verdictA !== null)} />
        <p className="help" style={{ marginTop: 8 }}>青色指针 = 当前读数；绿色扇形 = 目标角范围（±8°）。测量来自手部关键点夹角，确定性计算。</p>
      </div>
      <div className="panel hint">
        <h3>③ 提示与反思</h3>
        <button onClick={() => emit('hint')}>请求提示 {hint}/2</button>
        <p>{HINTS[task][Math.min(hint, 2)]}</p>
        {stalled && <p className="notice">已经停留超过 60 秒没有新操作。可以先自己再试一次，也可以点上面的“请求提示”。</p>}
        <textarea className="reflection" aria-label="角度观察解释" rows={3} value={explanation}
          placeholder={task === 'A' ? '你如何区分锐角/直角/钝角？' : task === 'B' ? '拼角时你用了什么参照物？' : '三个角的和与 180° 差多少？误差从哪来？'}
          onChange={e => setExplanation(e.target.value)} />
        {task !== 'free' && <button className="primary" disabled={!explanation.trim() || (task === 'A' ? !verdictA : task === 'B' ? !bSatisfied : !cSatisfied) || completed} onClick={() => emit('submit', explanation)}>{completed ? '任务已完成 ✓' : '提交观察解释'}</button>}
      </div>
    </aside>
  </section>;
}
