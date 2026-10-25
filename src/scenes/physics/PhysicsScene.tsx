import { useEffect, useRef, useState } from 'react';
import { bus } from '../../core/interaction';
import type { SceneProps } from '../types';
import { useScenePolicy, useSceneSnapshot, useServices } from '../../core/services';
import { step, speed, inTarget, clampForce, makeWaypoints, GAME_START, GAME_GOAL, COLLECT_R, MAX_FORCE, type Body, type Force, type Vec2 } from './mechanics';

const HINTS = [
  '先观察，再按需请求提示。',
  '力不直接决定位置，它改变的是速度——先想 v 会怎么变。',
  '把力拖到与运动方向垂直试试：轨迹弯曲，而短时间内速率几乎不变。',
  '任务 A：不施力时速度保持不变（牛顿第一定律）。任务 B：先朝目标施力，途中再调整方向“刹车”。',
];
const INITIAL: Body = { x: 3, y: 5, vx: 1.5, vy: 0 };
const REST: Body = { x: 3, y: 5, vx: 0, vy: 0 };
const DEFAULT_FORCE: Force = { magnitude: 0, angle: 90 };
const TARGET = { x: 15, y: 8, r: 1 };
const TASK_A_SECONDS = 5, TASK_B_SECONDS = 20;
const PREDICTIONS = [
  { id: 'stop', text: '逐渐慢下来，最后停止' },
  { id: 'keep', text: '保持 1.5 m/s 向右匀速直行' },
  { id: 'faster', text: '越来越快' },
];
type Snap = { label: string; trail: Vec2[]; finalSpeed: number; displacement: number };

/** 物理场景插件：力与运动——拖动力矢量改变大小/方向，确定性牛顿仿真验证预测。 */
export function PhysicsScene({ active }: SceneProps) {
  const { notify, drag } = useServices();
  const [task, setTask] = useState<'free' | 'A' | 'B' | 'C' | 'game'>('free');
  const [body, setBody] = useState<Body>(INITIAL);
  const [force, setForce] = useState<Force>(DEFAULT_FORCE);
  const [running, setRunning] = useState(false);
  const [trail, setTrail] = useState<Vec2[]>([[INITIAL.x, INITIAL.y]]);
  const [prediction, setPrediction] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [observed, setObserved] = useState<string | null>(null);
  const [explanation, setExplanation] = useState('');
  const [completed, setCompleted] = useState(false);
  const [hint, setHint] = useState(0);
  const [history, setHistory] = useState<Force[]>([]);
  const [snaps, setSnaps] = useState<Snap[]>([]);
  // 挑战模式 · 星际巡游：按顺序收集途经点后进入终点；计时从首次运行累计。
  const [waypoints, setWaypoints] = useState<[number, number][]>(() => makeWaypoints(3));
  const [collected, setCollected] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [gameStats, setGameStats] = useState<{ seconds: number; thrusts: number; attempts: number } | null>(null);
  const collectedRef = useRef(0);
  const attemptsRef = useRef(0);
  const thrustsRef = useRef(0);
  const [started, setStarted] = useState(Date.now());
  const [stalled, setStalled] = useState(false);
  const lastActivity = useRef(Date.now());
  const canvas = useRef<HTMLCanvasElement>(null);
  const runSeconds = useRef(0);
  const live = useRef({ body, force, task, waypoints: waypoints as [number, number][] });
  live.current = { body, force, task, waypoints };
  // 游戏进度以 ref 为准（仿真循环内同步读写，绕开 React 批处理时序）。
  const gameRef = useRef({ waypoints, collected: 0 });
  gameRef.current = { waypoints, collected: collectedRef.current };

  const emit = (intent: Parameters<typeof bus.emit>[0]['intent'], value?: string, source: Parameters<typeof bus.emit>[0]['source'] = 'mouse') =>
    bus.emit({ scene: 'physics', source, intent, phase: 'end', value });

  const resetRun = (keepForce = true) => {
    runSeconds.current = 0; setRunning(false); setBody(INITIAL);
    setTrail([[INITIAL.x, INITIAL.y]]); setObserved(null); setCompleted(false);
    if (!keepForce) setForce(DEFAULT_FORCE);
  };

  // 仿真循环：固定步长推进，任务 A/B 有时限，出可见观测区即停。
  // 用 setInterval 而非 requestAnimationFrame 驱动：页面被遮挡时渲染器会冻结 rAF
  // （visibilityState 仍为 visible），仿真会无声停摆；定时器不受渲染节流影响。
  useEffect(() => {
    if (!running) return;
    let last = performance.now(), acc = 0;
    const timer = setInterval(() => {
      acc += Math.min(performance.now() - last, 100); last = performance.now();
      while (acc >= 16.6) {
        acc -= 16.6;
        const s = live.current;
        const next = step(s.body, s.task === 'A' ? { magnitude: 0, angle: s.force.angle } : s.force, 1 / 60);
        runSeconds.current += 1 / 60;
        if (s.task === 'game') {
          // 顺序收集途经点 → 终点；出界送回起点（计时继续，天然惩罚）。
          const g = gameRef.current;
          if (g.collected < g.waypoints.length) {
            const wp = g.waypoints[g.collected];
            if (Math.hypot(next.x - wp[0], next.y - wp[1]) < COLLECT_R) {
              collectedRef.current += 1; gameRef.current.collected = collectedRef.current;
              setCollected(collectedRef.current);
              notify(collectedRef.current === g.waypoints.length
                ? '全部途经点已收集 ✓ 前往终点传送门！'
                : '途经点 ' + collectedRef.current + ' ✓ 已收集');
            }
          } else if (inTarget(next, GAME_GOAL)) {
            setRunning(false); setCompleted(true);
            const stats = { seconds: runSeconds.current, thrusts: thrustsRef.current, attempts: attemptsRef.current };
            setGameStats(stats);
            notify('🏁 挑战成功！用时 ' + stats.seconds.toFixed(1) + ' 秒，施力 ' + stats.thrusts + ' 次，出界 ' + stats.attempts + ' 次');
            return;
          }
          if (next.x < -0.8 || next.x > 20.8 || next.y < -0.8 || next.y > 10.8) {
            attemptsRef.current += 1; setAttempts(attemptsRef.current);
            setBody({ x: GAME_START[0], y: GAME_START[1], vx: 0, vy: 0 });
            setTrail([[GAME_START[0], GAME_START[1]]]);
            notify('漂出观测区（第 ' + attemptsRef.current + ' 次），已送回起点——计时继续');
            return;
          }
          setBody(next);
          setTrail(t => (t.length > 4000 ? t : [...t, [next.x, next.y]]));
          return;
        }
        setBody(next);
        setTrail(t => (t.length > 4000 ? t : [...t, [next.x, next.y]]));
        const out = next.x < -0.8 || next.x > 20.8 || next.y < -0.8 || next.y > 10.8; // 出可见观测区即停
        const hit = s.task === 'B' && inTarget(next, TARGET);
        const timeUp = s.task === 'A' ? runSeconds.current >= TASK_A_SECONDS : s.task === 'B' ? runSeconds.current >= TASK_B_SECONDS : false;
        if (hit) {
          setRunning(false); setCompleted(true);
          notify('任务 B 完成：探测器进入目标区！补充解释后提交。');
        } else if (timeUp || out) {
          setRunning(false);
          if (s.task === 'A') {
            const v = speed(next);
            const verdict = Math.abs(v - INITIAL.vx) < 0.01 && Math.abs(next.y - INITIAL.y) < 0.01 && next.vx > 0
              ? `实际结果：5 秒后仍以 ${v.toFixed(2)} m/s 向右匀速前进，位置 x=${next.x.toFixed(1)} m。`
              : `实际结果：末速率 ${v.toFixed(2)} m/s。`;
            setObserved(verdict + (prediction === 'keep' ? ' 你的预测正确！' : ' 预测与观察不同——这正是值得讨论的直觉。'));
          } else notify(out ? '探测器到达观测区边缘，已暂停。调整力矢量后重新开始。' : '时间到，已暂停。调整力矢量后可重新开始。');
        }
      }
    }, 16);
    return () => clearInterval(timer);
  }, [running, prediction, notify]);

  // 世界坐标 ↔ 画布坐标（世界 22×13 m 视野，中心 (10,5)）。
  const view = () => {
    const c = canvas.current!;
    const scale = Math.min(c.width / 22, c.height / 13);
    return { c, scale, ox: c.width / 2, oy: c.height / 2 };
  };
  /** 力矢量头部：画布内部坐标（用于绘制）与视口坐标（用于手势命中判定）。 */
  const headCanvas = () => {
    const { scale, ox, oy } = view();
    const rad = (force.angle * Math.PI) / 180, len = 1.2 + force.magnitude * scale * 0.45;
    return { x: ox + (body.x - 10) * scale + Math.cos(rad) * len, y: oy - (body.y - 5) * scale - Math.sin(rad) * len };
  };
  const headViewport = () => {
    const c = canvas.current; if (!c) return null;
    const r = c.getBoundingClientRect();
    const h = headCanvas();
    return { x: r.left + (h.x * r.width) / c.width, y: r.top + (h.y * r.height) / c.height, r };
  };

  // 手势策略：捏合力矢量箭头头部拖动 = 同时改变力的大小与方向（任务 A 中力固定为零）。
  // 命中判定在视口坐标系进行；事件位置统一换算为画布归一化坐标。
  useScenePolicy('physics', sample => {
    if (sample.phase === 'cancel') { bus.emit({ scene: 'physics', source: 'hand', intent: 'drag', phase: 'cancel' }); return; }
    if (task === 'A') return;
    const px = sample.x * window.innerWidth, py = sample.y * window.innerHeight;
    const head = headViewport(); if (!head) return;
    const toCanvas = (x: number, y: number) => ({ x: (x - head.r.left) / head.r.width, y: (y - head.r.top) / head.r.height });
    if (sample.phase === 'start') {
      if (Math.hypot(px - head.x, py - head.y) < 52)
        bus.emit({ scene: 'physics', source: 'hand', intent: 'drag', phase: 'start', position: toCanvas(px, py) });
      return;
    }
    if (drag.current?.scene === 'physics' && sample.phase === 'end') { bus.emit({ scene: 'physics', source: 'hand', intent: 'drag', phase: 'end' }); return; }
    if (drag.current?.scene === 'physics' && sample.pinching) {
      const p = toCanvas(px, py);
      bus.emit({ scene: 'physics', source: 'hand', intent: 'drag', phase: 'update', position: p });
    }
  });

  // 指针（手势/鼠标，画布归一化坐标）→ 力矢量：以物体为原点，指向=方向，距离=大小。
  const pointerToForce = (nx: number, ny: number) => {
    const c = canvas.current!;
    const { scale, ox, oy } = view();
    const px = nx * c.width, py = ny * c.height;
    const bx = ox + (body.x - 10) * scale, by = oy - (body.y - 5) * scale;
    return clampForce(Math.hypot(px - bx, py - by) / (scale * 0.45), Math.atan2(by - py, px - bx) * 180 / Math.PI);
  };

  useEffect(() => bus.subscribe(e => {
    lastActivity.current = Date.now();
    if (e.intent === 'drag' && e.scene === 'physics') {
      if (e.phase === 'cancel') {
        if (drag.current?.scene === 'physics' && drag.current.initial) setForce({ magnitude: drag.current.initial.magnitude, angle: drag.current.initial.angle });
        drag.current = null; return;
      }
      if (e.phase === 'start') { drag.current = { scene: 'physics', initial: { ...force }, x: 0, y: 0 }; return; }
      if (e.phase === 'update' && drag.current?.scene === 'physics' && e.position)
        setForce(pointerToForce(e.position.x, e.position.y));
      if (e.phase === 'end' && drag.current?.scene === 'physics') {
        if (task === 'game') thrustsRef.current += 1; // 一次拖拽释放 = 一次施力
        const before = drag.current.initial;
        if (before) setHistory(v => [...v, { magnitude: before.magnitude, angle: before.angle }].slice(-30));
        drag.current = null;
      }
      return;
    }
    if (e.scene !== 'physics') return;
    if (e.intent === 'run') {
      if (task === 'A' && !submitted) { notify('任务 A：先提交预测，再运行验证。'); return; }
      if (task === 'game' && gameStats) { notify('本局已结束，点“再来一局”开新挑战。'); return; }
      const start = task === 'game' ? { x: GAME_START[0], y: GAME_START[1], vx: 0, vy: 0 } : task === 'B' ? REST : INITIAL;
      runSeconds.current = 0; setBody(start); setTrail([[start.x, start.y]]); setObserved(null); setCompleted(false); setRunning(true);
    }
    if (e.intent === 'pause') setRunning(false);
    if (e.intent === 'reset') {
      resetRun(false); setPrediction(''); setSubmitted(false); setExplanation(''); setHint(0); setSnaps([]); setHistory([]); setStarted(Date.now()); setStalled(false);
      if (task === 'game') {
        collectedRef.current = 0; attemptsRef.current = 0; thrustsRef.current = 0;
        setCollected(0); setAttempts(0); setGameStats(null); setWaypoints(makeWaypoints(3));
        const s0 = { x: GAME_START[0], y: GAME_START[1], vx: 0, vy: 0 };
        setBody(s0); setTrail([[s0.x, s0.y]]);
      }
    }
    if (e.intent === 'undo') {
      if (drag.current?.scene === 'physics' && drag.current.initial) { setForce({ magnitude: drag.current.initial.magnitude, angle: drag.current.initial.angle }); drag.current = null; }
      const prev = history.at(-1);
      if (prev) { setForce(prev); setHistory(v => v.slice(0, -1)); }
    }
    if (e.intent === 'predict') { setSubmitted(true); notify('预测已记录。现在点击“开始”，观察 5 秒后发生了什么。'); }
    if (e.intent === 'hint') setHint(v => Math.min(3, v + 1));
    if (e.intent === 'submit') { setCompleted(true); notify(`任务已完成，用时 ${Math.round((Date.now() - started) / 1000)} 秒。可导出过程记录。`); }
  }), [task, submitted, force, history, body, started, prediction, notify]);

  // 空格 = 开始/暂停（键盘备用路径）。
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === 'Space') { e.preventDefault(); emit(running ? 'pause' : 'run', undefined, 'keyboard'); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, running]);

  useEffect(() => {
    if (!active) { setStalled(false); return; }
    lastActivity.current = Date.now(); setStalled(false);
    const timer = setInterval(() => setStalled(Date.now() - lastActivity.current > 60000 && !completed), 5000);
    return () => clearInterval(timer);
  }, [active, completed]);

  useSceneSnapshot('physics', () => ({
    startedAt: new Date(started).toISOString(), durationSeconds: Math.round((Date.now() - started) / 1000),
    task, prediction, observed, hints: hint, force, completed, finalSpeed: Number(speed(body).toFixed(3)),
  }));

  // 画布绘制：网格、目标、轨迹、物体、力（红）与速度（绿）矢量。
  useEffect(() => {
    if (!active) return;
    const c = canvas.current; if (!c) return;
    const ctx = c.getContext('2d')!; const { scale, ox, oy } = view();
    const W = (x: number) => ox + (x - 10) * scale, H = (y: number) => oy - (y - 5) * scale;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.strokeStyle = 'rgba(159,185,213,0.10)'; ctx.lineWidth = 1;
    for (let x = -1; x <= 21; x++) { ctx.beginPath(); ctx.moveTo(W(x), 0); ctx.lineTo(W(x), c.height); ctx.stroke(); }
    for (let y = -1; y <= 11; y++) { ctx.beginPath(); ctx.moveTo(0, H(y)); ctx.lineTo(c.width, H(y)); ctx.stroke(); }
    if (task === 'B') {
      ctx.strokeStyle = '#f4c784'; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.arc(W(TARGET.x), H(TARGET.y), TARGET.r * scale, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#f4c784'; ctx.font = '12px sans-serif'; ctx.fillText('目标', W(TARGET.x) - 12, H(TARGET.y) - TARGET.r * scale - 6);
    }
    ctx.strokeStyle = '#5de0c6'; ctx.lineWidth = 2; ctx.beginPath();
    trail.forEach(([x, y], i) => (i ? ctx.lineTo(W(x), H(y)) : ctx.moveTo(W(x), H(y))));
    ctx.stroke();
    const arrow = (from: { x: number; y: number }, angle: number, len: number, color: string, label: string) => {
      const rad = (angle * Math.PI) / 180;
      const x2 = from.x + Math.cos(rad) * len, y2 = from.y - Math.sin(rad) * len;
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x2 + Math.cos(rad) * 10, y2 - Math.sin(rad) * 10);
      ctx.lineTo(x2 + Math.cos(rad + 2.6) * 9, y2 - Math.sin(rad + 2.6) * 9);
      ctx.lineTo(x2 + Math.cos(rad - 2.6) * 9, y2 - Math.sin(rad - 2.6) * 9);
      ctx.closePath(); ctx.fill();
      ctx.font = 'bold 13px sans-serif'; ctx.fillText(label, x2 + 6, y2 - 6);
    };
    const bx = W(body.x), by = H(body.y);
    if (task !== 'A' || force.magnitude > 0) arrow({ x: bx, y: by }, force.angle, 1.2 + force.magnitude * scale * 0.45, '#ff5a5a', `F=${force.magnitude.toFixed(1)}N`);
    const v = speed(body);
    if (v > 0.01) arrow({ x: bx, y: by }, Math.atan2(body.vy, body.vx) * 180 / Math.PI, 1.2 + v * scale * 0.32, '#6ee7a0', `v=${v.toFixed(1)}`);
    if (task === 'game') {
      // 起点停机坪（绿色）
      ctx.strokeStyle = '#6ee7a0'; ctx.lineWidth = 2; ctx.setLineDash([7, 6]);
      ctx.beginPath(); ctx.arc(W(GAME_START[0]), H(GAME_START[1]), 0.7 * scale, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = '#6ee7a0'; ctx.font = '12px sans-serif';
      ctx.fillText('起点', W(GAME_START[0]) - 14, H(GAME_START[1]) + 0.9 * scale + 14);
      // 终点传送门（琥珀，脉冲）
      const pulse = 1 + 0.08 * Math.sin(performance.now() / 300);
      ctx.strokeStyle = '#f4c784'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(W(GAME_GOAL.x), H(GAME_GOAL.y), GAME_GOAL.r * scale * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 0.25; ctx.fillStyle = '#f4c784';
      ctx.beginPath(); ctx.arc(W(GAME_GOAL.x), H(GAME_GOAL.y), GAME_GOAL.r * scale * 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1; ctx.fillStyle = '#f4c784'; ctx.fillText('终点', W(GAME_GOAL.x) - 14, H(GAME_GOAL.y) - GAME_GOAL.r * scale - 8);
      // 途经信标（青色，未收集脉冲；已收集打勾变暗）
      waypoints.forEach((w, i) => {
        const done = i < collected;
        const r = 0.55 * scale * (done ? 1 : 1 + 0.1 * Math.sin(performance.now() / 250 + i));
        ctx.strokeStyle = done ? '#3a5a52' : '#5de0c6'; ctx.lineWidth = done ? 1.5 : 2.5;
        ctx.beginPath(); ctx.arc(W(w[0]), H(w[1]), r, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = done ? '#3a5a52' : '#5de0c6'; ctx.font = 'bold 14px sans-serif';
        ctx.fillText(done ? '✓' : ['①', '②', '③'][i], W(w[0]) - (done ? 6 : 7), H(w[1]) + 5);
      });
      if (gameStats) {
        ctx.fillStyle = '#f4c784'; ctx.font = 'bold 34px sans-serif';
        ctx.fillText('🏁 挑战成功！', c.width / 2 - 110, c.height / 2 - 60);
      }
    }
    ctx.fillStyle = '#e5edf7'; ctx.beginPath(); ctx.arc(bx, by, 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#7ae8d4'; ctx.lineWidth = 2; ctx.stroke();
  }, [active, body, force, trail, task]);

  const lockedA = task === 'A' && !submitted;
  const snapLabel = `F=${force.magnitude.toFixed(1)}N@${Math.round(force.angle)}°`;
  const saveSnap = () => {
    const displacement = Math.hypot(body.x - INITIAL.x, body.y - INITIAL.y);
    setSnaps(v => [...v, { label: snapLabel, trail: [...trail], finalSpeed: speed(body), displacement }]);
    notify(`已保存轨迹 ${snaps.length + 1}：${snapLabel}。`);
  };

  return <section className="panel physics-panel" hidden={!active}>
    <div className="task-head">
      <div><div className="eyebrow">物理 · 力与运动</div><h2>探测器与力矢量</h2></div>
      <button onClick={() => emit('reset')}>重置任务</button>
    </div>
    <div className="presets">
      <button className={task === 'free' ? 'selected' : ''} onClick={() => { setTask('free'); emit('reset'); }}>演示模式</button>
      <button className={task === 'A' ? 'selected' : ''} onClick={() => { setTask('A'); emit('reset'); }}>任务 A · 预测验证</button>
      <button className={task === 'B' ? 'selected' : ''} onClick={() => { setTask('B'); emit('reset'); }}>任务 B · 抵达目标</button>
      <button className={task === 'C' ? 'selected' : ''} onClick={() => { setTask('C'); emit('reset'); }}>任务 C · 轨迹对比</button>
      <button className={task === 'game' ? 'selected' : ''} onClick={() => { setTask('game'); setTimeout(() => emit('reset'), 0); }}>挑战 · 星际巡游</button>
    </div>
    <div className="task-card">{task === 'free' ? '教师演示：拖动红色力矢量改变大小与方向，点击开始观察速度（绿）如何响应；不施力时保持匀速直行。'
      : task === 'A' ? '探测器正以 1.5 m/s 向右匀速航行，本任务中力恒为零。预测：5 秒后它会怎样？提交后运行验证。'
      : task === 'B' ? `探测器从静止出发（初速 0）。目标：调整力矢量，让它在 ${TASK_B_SECONDS} 秒内进入琥珀色目标区（半径 1 m）。`
      : task === 'game' ? '按 ①→②→③ 顺序收集全部信标，最后进入终点传送门。计时从首次“开始”累计，出界送回起点但计时不停。'
      : '用不同施力方案各跑一次，保存两条轨迹并排比较，解释力如何造成差异。'}</div>
    <div className="slide-controls" style={{ marginTop: 14 }}>
      <button className="primary" style={{ width: 'auto' }} disabled={lockedA} onClick={() => emit(running ? 'pause' : 'run')}>{running ? '暂停' : '开始'}</button>
      <button onClick={() => emit('pause')} disabled={!running}>停止</button>
      <button disabled={!history.length} onClick={() => emit('undo')}>撤销操作</button>
      <span className="help" style={{ alignSelf: 'center' }}>空格=开始/暂停；语音“开始/暂停/重置”同样可用{running ? ` · 已运行 ${runSeconds.current.toFixed(1)} s` : ''}</span>
    </div>
    <canvas ref={canvas} width={960} height={560} aria-label="力与运动仿真视图"
      onPointerDown={e => {
        if (task === 'A') return;
        const head = headCanvas(), r = e.currentTarget.getBoundingClientRect();
        const px = e.clientX - r.left, py = e.clientY - r.top;
        if (Math.hypot(px - (head.x * r.width) / e.currentTarget.width, py - (head.y * r.height) / e.currentTarget.height) < 40)
          bus.emit({ scene: 'physics', source: 'mouse', intent: 'drag', phase: 'start', position: { x: px / r.width, y: py / r.height } });
      }}
      onPointerMove={e => {
        if (drag.current?.scene !== 'physics') return;
        const r = e.currentTarget.getBoundingClientRect();
        bus.emit({ scene: 'physics', source: 'mouse', intent: 'drag', phase: 'update', position: { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height } });
      }}
      onPointerUp={() => drag.current?.scene === 'physics' && bus.emit({ scene: 'physics', source: 'mouse', intent: 'drag', phase: 'end' })}
      onPointerCancel={() => bus.emit({ scene: 'physics', source: 'mouse', intent: 'drag', phase: 'cancel' })} />
    <p className="help">{task === 'A' ? '任务 A 中力恒为零：这正是验证“没有力会怎样”的实验条件。' : '鼠标或手势捏合红色箭头头部拖动即可改变力（大小=离物体的距离，方向=指向）；绿色箭头是当前速度。'}</p>
    <aside className="side" style={{ marginTop: 16 }}>
      <div className="panel prediction">
        <h3>① {task === 'A' ? '提交预测' : task === 'B' ? '目标任务' : task === 'C' ? '轨迹快照' : task === 'game' ? '星际巡游' : '演示要点'}</h3>
        {task === 'A' ? <>
          <div className="chips">{PREDICTIONS.map(p => <button key={p.id} disabled={submitted} className={prediction === p.id ? 'selected' : ''} onClick={() => setPrediction(p.id)}>{p.text}</button>)}</div>
          <button className="primary" disabled={!prediction || submitted} onClick={() => emit('predict', PREDICTIONS.find(p => p.id === prediction)?.text)}>{submitted ? '预测已记录' : '提交预测'}</button>
          {observed && <p className="notice">{observed}</p>}
        </> : task === 'B' ? <p>{completed ? '已抵达目标区！补充解释后提交。' : `目标在东北方向 ${(Math.hypot(TARGET.x - INITIAL.x, TARGET.y - INITIAL.y)).toFixed(1)} m 处。初速为 0：只靠力矢量到达。可以先朝目标施力，中途调整方向。`}</p>
        : task === 'game' ? <>
          <div className="chips">
            {waypoints.map((w, i) => <button key={i} disabled className={i < collected ? 'selected' : ''}>{['①', '②', '③'][i]} 信标 {i < collected ? '✓' : ''}</button>)}
          </div>
          {gameStats
            ? <div className="notice">🏁 成功！用时 {gameStats.seconds.toFixed(1)} 秒 · 施力 {gameStats.thrusts} 次 · 出界 {gameStats.attempts} 次<br /><button onClick={() => emit('reset')}>再来一局（新地图）</button></div>
            : <p className="help">已收集 {collected}/{waypoints.length} · 出界 {attempts} 次。提示：先给一次大力朝向①，途中用小力修正；惯性会替你省力。</p>}
          <button onClick={() => emit('reset')}>换一张星图</button>
        </>
        : task === 'C' ? <>
          <div className="chips">{snaps.map((s, i) => <button key={i} className="selected">{i + 1} · {s.label}</button>)}</div>
          <button className="primary" disabled={trail.length < 6 || snaps.length >= 2 || running} onClick={saveSnap}>{snaps.length >= 2 ? '已保存 2 条轨迹' : `保存当前轨迹 ${snaps.length}/2`}</button>
          {snaps.length === 2 && <div className="compare">
            {snaps.map((s, i) => <div className="mini-section" key={i}>
              <svg viewBox="0 0 22 13" aria-label={`轨迹${i + 1}`}><polyline points={s.trail.map(([x, y]) => `${x},${13 - y}`).join(' ')} /></svg>
            </div>)}
            <p className="help" style={{ gridColumn: '1/-1' }}>方案 {snaps[0].label} → 位移 {snaps[0].displacement.toFixed(1)} m、末速 {snaps[0].finalSpeed.toFixed(1)}；方案 {snaps[1].label} → 位移 {snaps[1].displacement.toFixed(1)} m、末速 {snaps[1].finalSpeed.toFixed(1)}。在下方解释差异。</p>
          </div>}
          {snaps.length < 2 && <p className="help">跑一次保存，换力矢量再跑一次保存，然后对比。</p>}
        </> : <p>红色=F（拖动改变），绿色=v（由仿真给出）。试试：与 v 同向 → 加速；反向 → 先停再倒退；垂直 → 拐弯。始终不施力 → 匀速直行。</p>}
      </div>
      <div className="panel result">
        <h3>② 实时观察</h3>
        <div className="big-number">{task === 'game' ? (gameStats ? gameStats.seconds.toFixed(1) : runSeconds.current.toFixed(1)) : speed(body).toFixed(1)}<small>{task === 'game' ? '秒 · 巡游计时' : 'm/s 当前速率'}</small></div>
        <p>力：{force.magnitude.toFixed(1)} N @ {Math.round(force.angle)}°（上限 {MAX_FORCE} N，质量 1 kg）</p>
        <p className="help">位置 x={body.x.toFixed(1)} m, y={body.y.toFixed(1)} m；运行时长 {runSeconds.current.toFixed(1)} s。仿真为确定性牛顿积分（半隐式欧拉），结果可复现。</p>
      </div>
      <div className="panel hint">
        <h3>③ 提示与反思</h3>
        <button onClick={() => emit('hint')}>请求提示 {hint}/3</button>
        <p>{HINTS[hint]}</p>
        {stalled && <p className="notice">已经停留超过 60 秒没有新操作。可以先自己再试一次，也可以点上面的“请求提示”。</p>}
        <textarea className="reflection" aria-label="物理观察解释" rows={3} value={explanation} placeholder="你观察到什么？力和速度是什么关系？" onChange={e => setExplanation(e.target.value)} />
        {task !== 'free' && <button className="primary" disabled={!explanation.trim() || (task === 'A' ? !submitted || !observed : task === 'B' ? !completed : task === 'C' ? snaps.length < 2 : false) || (completed && task !== 'A' && task !== 'B')} onClick={() => emit('submit', explanation)}>{completed ? '任务已完成 ✓' : '提交观察解释'}</button>}
      </div>
    </aside>
  </section>;
}
