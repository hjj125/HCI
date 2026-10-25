import { useEffect, useRef, useState } from 'react';
import { bus } from '../../core/interaction';
import type { SceneProps } from '../types';
import { speak, useScenePolicy, useSceneSnapshot, useSceneVoicePolicy, useServices } from '../../core/services';
import type { HandSample } from '../../core/useHandInput';
import { classify, evaluate, type FunctionFamily, type FunctionFit, type Sample } from './functionFit';
import { A_TARGETS, B_TARGETS, formatFit } from './taskLogic';

type Task = 'free' | 'A' | 'B' | 'C';
type Point = { x: number; y: number }; // 画布归一化坐标 [0,1]²（u 向右、v 向下）

const FAMILY_LABEL: Record<FunctionFamily, string> = { linear: '直线', quadratic: '抛物线', sine: '正弦' };
const FAMILIES: FunctionFamily[] = ['linear', 'quadratic', 'sine'];
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
/** 画布坐标 → 数学坐标：x∈[-1,1] 向右，y∈[-1,1] 向上。 */
const toMath = (p: Point): Sample => ({ x: p.x * 2 - 1, y: 1 - 2 * p.y });

const HINTS: Record<Task, string[]> = {
  free: ['先随意画几笔，看看系统把你的手势认成了什么。', '幅度太小的笔迹会被拒识——画得舒展一些。', '试试同一形状画三遍，看表达式稳不稳定。'],
  A: ['先看曲线整体走向：一直升或一直降是直线，只弯一次是抛物线，来回起伏是正弦。', '数弯折次数：零次=直线，一次=抛物线，两次以上=正弦。', '看对称性：正弦上下对称，抛物线只朝一个方向弯。'],
  B: ['看清目标里的方向词：上升/下降/开口方向。', '幅度要明显——贴着中线画会被当成"没画东西"拒识。', '一次从左到右扫完，中途不要停顿或折返；拿不准可看参考虚线。'],
  C: ['画完第一笔会自动存为对比①，再画一笔存为对比②。', '对比两行表达式：斜率、开口方向还是振幅变了？', '试着只改变一个量（比如振幅），差异会一目了然。'],
};

/** 函数画布：网格坐标轴 + 目标虚线 + 笔迹 + 拟合曲线。 */
function FunctionCanvas({ stroke, fit, target, targetVisible, pointerProps }: {
  stroke: Point[]; fit: FunctionFit | null; target: ((x: number) => number) | null; targetVisible: boolean;
  pointerProps: React.ComponentProps<'canvas'>;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const W = c.width, H = c.height;
    const px = (xm: number) => ((xm + 1) / 2) * W;
    const py = (ym: number) => ((1 - ym) / 2) * H;
    const curve = (f: (x: number) => number) => {
      ctx.beginPath();
      for (let i = 0; i <= 120; i++) {
        const xm = -1 + (2 * i) / 120;
        const X = px(xm), Y = py(Math.max(-1.1, Math.min(1.1, f(xm))));
        if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      }
      ctx.stroke();
    };
    ctx.fillStyle = '#0c1727'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#182740'; ctx.lineWidth = 1;
    for (let i = 1; i < 10; i++) {
      ctx.beginPath(); ctx.moveTo((i / 10) * W, 0); ctx.lineTo((i / 10) * W, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, (i / 10) * H); ctx.lineTo(W, (i / 10) * H); ctx.stroke();
    }
    ctx.strokeStyle = '#33507a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.lineWidth = 1;
    if (targetVisible && target) {
      ctx.strokeStyle = '#6f8fc0'; ctx.setLineDash([12, 9]); ctx.lineWidth = 3;
      curve(target); ctx.setLineDash([]); ctx.lineWidth = 1;
    }
    if (stroke.length > 1) {
      ctx.strokeStyle = '#38d8c1'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(stroke[0].x * W, stroke[0].y * H);
      for (const p of stroke) ctx.lineTo(p.x * W, p.y * H);
      ctx.stroke(); ctx.lineWidth = 1;
    }
    if (fit) {
      ctx.strokeStyle = '#f4c784'; ctx.lineWidth = 3;
      curve(x => evaluate(fit, x)); ctx.lineWidth = 1;
    }
  }, [stroke, fit, target, targetVisible]);
  return <canvas ref={ref} width={1200} height={560} aria-label="函数画布" {...pointerProps} />;
}

/** 数学实验二 · 人体函数绘图仪：手势横扫采样（指尖高度=函数值）→ 拟合识别 → 任务 A/B/C。 */
export function FunctionsScene({ active }: SceneProps) {
  const { notify, drag, pauseRecognition } = useServices();
  const [task, setTask] = useState<Task>('free');
  const [stroke, setStroke] = useState<Point[]>([]);
  const [fit, setFit] = useState<FunctionFit | null>(null);
  const [aIndex, setAIndex] = useState(0);
  const [predFamily, setPredFamily] = useState<'' | FunctionFamily>('');
  const [verdictA, setVerdictA] = useState<null | boolean>(null);
  const [bIndex, setBIndex] = useState(0);
  const [savedC, setSavedC] = useState<FunctionFit[]>([]);
  const [strokeCount, setStrokeCount] = useState(0);
  const [explanation, setExplanation] = useState('');
  const [completed, setCompleted] = useState(false);
  const [hint, setHint] = useState(0);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [stalled, setStalled] = useState(false);
  const lastActivity = useRef(Date.now());
  const host = useRef<HTMLDivElement>(null);
  const strokeRef = useRef<Point[]>([]);
  const live = useRef({ task, aTarget: A_TARGETS[0], bTarget: B_TARGETS[0] });
  live.current = { task, aTarget: A_TARGETS[aIndex], bTarget: B_TARGETS[bIndex] };
  const aTarget = A_TARGETS[aIndex];
  const bTarget = B_TARGETS[bIndex];
  const bSatisfied = fit ? bTarget.check(fit) : false;
  const cSatisfied = savedC.length >= 2;

  const emit = (intent: Parameters<typeof bus.emit>[0]['intent'], value?: string, source: Parameters<typeof bus.emit>[0]['source'] = 'mouse') =>
    bus.emit({ scene: 'functions', source, intent, phase: 'end', value });
  const emitDrag = (phase: 'start' | 'update' | 'end' | 'cancel', position?: Point, source: 'mouse' | 'hand' | 'keyboard' = 'mouse') =>
    bus.emit({ scene: 'functions', source, intent: 'drag', phase, position });

  /** 一笔完成：过短/过平给出引导，识别成功则更新拟合并按任务推进。 */
  const finishStroke = (pts: Point[]) => {
    setStrokeCount(c => c + 1);
    if (pts.length < 8) { notify('这一笔太短——捏合落笔后，请从画布左侧一路扫到右侧再松开。'); return; }
    const r = classify(pts.map(toMath));
    if (!r) { notify('没认出这一笔。幅度至少占画布高度的一成，且尽量保持在画布内，再试一次。'); return; }
    setFit(r);
    emit('point', r.family, 'hand');
    notify(`识别成功：${FAMILY_LABEL[r.family]} · ${formatFit(r)}`);
    if (live.current.task === 'B') {
      const ok = live.current.bTarget.check(r);
      notify(ok ? `✓ 达成！这一笔符合「${live.current.bTarget.zh}」。补充解释后提交。` : `这一笔是${FAMILY_LABEL[r.family]}——还不符合「${live.current.bTarget.zh}」，参考提示再试一次。`);
    }
    if (live.current.task === 'C') setSavedC(v => [...v, r].slice(-2));
  };

  // 语义事件：鼠标与手势共用同一条 drag 路径（白板模式）；任务与撤销、语音同源。
  useEffect(() => bus.subscribe(e => {
    lastActivity.current = Date.now();
    if (e.scene !== 'functions' && e.intent !== 'switch') return;
    if (e.intent === 'drag') {
      if (e.phase === 'cancel') { drag.current = null; clearStroke(); return; }
      if (e.phase === 'start' && e.position) {
        drag.current = { scene: 'functions', x: e.position.x, y: e.position.y };
        strokeRef.current = [e.position]; setStroke(strokeRef.current);
        return;
      }
      if (e.phase === 'update' && e.position && drag.current?.scene === 'functions') {
        drag.current.x = e.position.x; drag.current.y = e.position.y;
        const last = strokeRef.current[strokeRef.current.length - 1];
        if (!last || Math.hypot(e.position.x - last.x, e.position.y - last.y) > 0.006) {
          strokeRef.current = [...strokeRef.current, e.position]; setStroke(strokeRef.current);
        }
        return;
      }
      if (e.phase === 'end' && drag.current?.scene === 'functions') {
        drag.current = null;
        if (strokeRef.current.length) finishStroke(strokeRef.current);
        return;
      }
    }
    if (e.intent === 'undo') { setFit(null); clearStroke(); setSavedC(v => v.slice(0, -1)); notify('已撤销最后一笔。'); }
    if (e.intent === 'hint') setHint(v => Math.min(2, v + 1));
    if (e.intent === 'reset') {
      clearStroke(); setFit(null); setPredFamily(''); setVerdictA(null); setSavedC([]);
      setExplanation(''); setCompleted(false); setHint(0); setStartedAt(Date.now());
    }
    if (e.intent === 'predict' && task === 'A') {
      const ok = predFamily === aTarget.family;
      setVerdictA(ok);
      notify(ok ? `✓ 正确！这就是${aTarget.zh}：${aTarget.eq}。用身体把它画出来感受一下，再提交解释。` : `✗ 它其实是${FAMILY_LABEL[aTarget.family]}：${aTarget.eq}。对比你选的「${predFamily ? FAMILY_LABEL[predFamily] : '—'}」再观察。`);
    }
    if (e.intent === 'submit') { setCompleted(true); notify(`任务已完成，用时 ${Math.round((Date.now() - startedAt) / 1000)} 秒。`); }
  }), [task, predFamily, aTarget, bTarget, startedAt, notify]);

  // 手势策略：视口坐标 → 画布相对坐标，与鼠标走同一条 drag 路径（画布 ±边距内起笔）。
  useScenePolicy('functions', (sample: HandSample) => {
    if (sample.phase === 'cancel') { emitDrag('cancel', undefined, 'hand'); return; }
    const px = sample.x * window.innerWidth, py = sample.y * window.innerHeight;
    const rect = host.current?.getBoundingClientRect();
    if (sample.phase === 'start') {
      if (rect && px >= rect.left - 12 && px <= rect.right + 12 && py >= rect.top - 20 && py <= rect.bottom + 20)
        emitDrag('start', { x: clamp01((px - rect.left) / rect.width), y: clamp01((py - rect.top) / rect.height) }, 'hand');
      return;
    }
    if (drag.current?.scene === 'functions' && sample.phase === 'end') { emitDrag('end', undefined, 'hand'); return; }
    if (drag.current?.scene === 'functions' && sample.pinching && rect)
      emitDrag('update', { x: clamp01((px - rect.left) / rect.width), y: clamp01((py - rect.top) / rect.height) }, 'hand');
  });

  // 场景级语音：任务A 口头预测族；"清除/重画"清空笔迹。
  useSceneVoicePolicy('functions', text => {
    const t = text.replace(/\s/g, '');
    const fam: FunctionFamily | null = t.includes('抛物线') ? 'quadratic'
      : (t.includes('正弦') || t.includes('波浪')) ? 'sine' : t.includes('直线') ? 'linear' : null;
    if (fam) {
      if (live.current.task === 'A') setPredFamily(fam);
      notify(`语音 · 已选择「${FAMILY_LABEL[fam]}」`);
      const ms = speak(`已选择${FAMILY_LABEL[fam]}`);
      if (ms) pauseRecognition(ms + 800);
      return true;
    }
    if (t.includes('清除') || t.includes('重画')) {
      clearStroke(); setFit(null);
      notify('已清除笔迹，可以重画。');
      return true;
    }
    return false;
  });

  const pointerState = useRef<{ down: boolean }>({ down: false });
  const pointerPos = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  };
  const pointerProps = {
    onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => {
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 合成事件没有活动指针 */ }
      pointerState.current.down = true;
      emitDrag('start', pointerPos(e));
    },
    onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => { if (drag.current?.scene === 'functions') emitDrag('update', pointerPos(e)); },
    onPointerUp: () => { if (pointerState.current.down) { pointerState.current.down = false; emitDrag('end'); } },
    onPointerCancel: () => emitDrag('cancel'),
  };

  useEffect(() => {
    if (!active) { setStalled(false); return; }
    lastActivity.current = Date.now(); setStalled(false);
    const timer = setInterval(() => setStalled(Date.now() - lastActivity.current > 60000 && !completed), 5000);
    return () => clearInterval(timer);
  }, [active, completed]);

  useSceneSnapshot('functions', () => ({
    startedAt: new Date(startedAt).toISOString(), durationSeconds: Math.round((Date.now() - startedAt) / 1000),
    task, hints: hint, explanation, completed, strokes: strokeCount,
    lastFit: fit ? { family: fit.family, rmse: Number(fit.rmse.toFixed(4)) } : null,
    quiz: task === 'A' ? { target: aTarget.zh, prediction: predFamily || null, correct: verdictA } : null,
    construct: task === 'B' ? { target: bTarget.zh, satisfied: bSatisfied } : null,
    compare: task === 'C' ? { saved: savedC.map(formatFit) } : null,
  }));

  // 笔迹清空的统一入口：引用与渲染状态一起清。
  function clearStroke() { strokeRef.current = []; setStroke([]); }

  const taskHint = HINTS[task];
  return <section className="panel fn-panel" hidden={!active}>
    <div className="task-head">
      <div><div className="eyebrow">数学 · 函数绘图</div><h2>人体函数绘图仪</h2></div>
      <button onClick={() => emit('reset')}>重置任务</button>
    </div>
    <div className="presets">
      <button className={task === 'free' ? 'selected' : ''} onClick={() => { setTask('free'); emit('reset'); }}>演示模式</button>
      <button className={task === 'A' ? 'selected' : ''} onClick={() => { setTask('A'); emit('reset'); setAIndex(0); }}>任务 A · 看曲线猜类型</button>
      <button className={task === 'B' ? 'selected' : ''} onClick={() => { setTask('B'); emit('reset'); setBIndex(0); }}>任务 B · 听指令画函数</button>
      <button className={task === 'C' ? 'selected' : ''} onClick={() => { setTask('C'); emit('reset'); }}>任务 C · 双曲线对比</button>
    </div>
    <div className="task-card">{task === 'free' ? '捏合落笔（或按住鼠标），从画布左侧一路扫到右侧：手指的高度就是函数值 y，横向位置是自变量 x。松开抬笔，系统识别曲线类型并给出表达式。'
      : task === 'A' ? `先观察虚线的目标曲线，预测它属于哪一族再提交；揭晓后用身体把它画出来，验证你的判断。`
      : task === 'B' ? bTarget.prompt
      : '画第一笔（自动存为对比①），再画一笔形状不同的（对比②），对比两条表达式并解释差异在哪里。'}</div>
    <div ref={host} className="fn-host">
      <FunctionCanvas stroke={stroke} fit={fit} target={task === 'A' ? aTarget.f : task === 'B' && hint >= 2 ? bTarget.ref : null}
        targetVisible={task === 'A' || (task === 'B' && hint >= 2)} pointerProps={pointerProps} />
    </div>
    <aside className="side" style={{ marginTop: 16 }}>
      <div className="panel prediction">
        <h3>① {task === 'A' ? '预测族别' : task === 'B' ? '构造目标' : task === 'C' ? '对比结果' : '识别结果'}</h3>
        {task === 'A' ? <>
          <p className="help">虚线目标曲线是哪一族？</p>
          <div className="chips">
            {FAMILIES.map(f => <button key={f} disabled={!!verdictA} className={predFamily === f ? 'selected' : ''} onClick={() => setPredFamily(f)}>{FAMILY_LABEL[f]}</button>)}
          </div>
          <button className="primary" disabled={!predFamily || !!verdictA} onClick={() => emit('predict')}>提交预测</button>
          {verdictA !== null && <p className="notice">{verdictA ? `✓ 正确！答案是${FAMILY_LABEL[aTarget.family]}：${aTarget.eq}` : `✗ 答案是${FAMILY_LABEL[aTarget.family]}：${aTarget.eq}——再画一笔感受一下。`}</p>}
          <button onClick={() => { setAIndex((aIndex + 1) % A_TARGETS.length); setPredFamily(''); setVerdictA(null); setHint(0); notify('已切换到新题目。'); }}>换一题</button>
        </> : task === 'B' ? <>
          <p>{bTarget.prompt}</p>
          <p className={bSatisfied ? 'notice' : 'help'}>{bSatisfied ? `✓ 达成！最近一笔符合「${bTarget.zh}」。补充解释后提交。` : '画一笔试试——识别结果会显示在右侧，满足条件即达成。'}</p>
        </> : task === 'C' ? <>
          {savedC.length === 0 && <p className="help">还没有笔迹。画第一笔（如一条直线）。</p>}
          {savedC.map((s, i) => <p key={i} className="help">对比{i + 1}：{FAMILY_LABEL[s.family]} · {formatFit(s)}</p>)}
          {savedC.length === 1 && <p className="help">再画一笔形状不同的（如一个波），完成对比。</p>}
          {cSatisfied && <p className="notice">✓ 两笔已就绪！对比表达式，解释差异后提交。</p>}
        </> : <p>{fit ? `最近一笔：${FAMILY_LABEL[fit.family]}（识别残差 ${fit.rmse.toFixed(3)}）` : '还没有笔迹。捏合或按住鼠标，从左到右画一笔。'}</p>}
      </div>
      <div className="panel result">
        <h3>② 拟合识别</h3>
        {fit ? <>
          <div className="big-number" style={{ fontSize: 22 }}>{FAMILY_LABEL[fit.family]}</div>
          <p>{formatFit(fit)}</p>
          <p className="help">{fit.family === 'linear' ? `斜率 k = ${fit.k.toFixed(2)}（每扫过一个画布宽，高度变化 ${fit.k.toFixed(2)}），截距 b = ${fit.b.toFixed(2)}。`
            : fit.family === 'quadratic' ? `开口${fit.a > 0 ? '向上（碗）' : '向下（拱）'}，弯曲程度 a = ${fit.a.toFixed(2)}。`
            : `振幅 ${fit.amp.toFixed(2)}，周期 ${fit.period.toFixed(2)} 个画布宽，中线 y = ${fit.mid.toFixed(2)}。`}</p>
        </> : <p className="help">画一笔后，这里会显示识别出的函数族、表达式与参数含义。</p>}
        <p className="help">识别 = 最小二乘拟合 + 族间简约性比较（离线确定性计算，见 functionFit 单测）。</p>
      </div>
      <div className="panel hint">
        <h3>③ 提示与反思</h3>
        <button onClick={() => emit('hint')}>请求提示 {hint}/2</button>
        <p>{taskHint[Math.min(hint, 2)]}</p>
        {stalled && <p className="notice">已经停留超过 60 秒没有新操作。可以先自己再试一次，也可以点上面的“请求提示”。</p>}
        <textarea className="reflection" aria-label="函数观察解释" rows={3} value={explanation}
          placeholder={task === 'A' ? '你根据什么判断曲线的族别？' : task === 'B' ? '怎样用手势控制斜率/开口方向/周期？' : '两次的表达式哪里不同？对应手势的什么变化？'}
          onChange={e => setExplanation(e.target.value)} />
        {task !== 'free' && <button className="primary" disabled={!explanation.trim() || (task === 'A' ? !verdictA : task === 'B' ? !bSatisfied : !cSatisfied) || completed} onClick={() => emit('submit', explanation)}>{completed ? '任务已完成 ✓' : '提交观察解释'}</button>}
      </div>
    </aside>
  </section>;
}
