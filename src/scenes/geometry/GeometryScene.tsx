import { useEffect, useMemo, useRef, useState } from 'react';
import { bus } from '../../core/interaction';
import type { SceneProps } from '../types';
import { useScenePolicy, useSceneSnapshot, useServices } from '../../core/services';
import { angleNormal, sectionCube, faceNames } from './geometry';
import { CubeView } from './CubeView';

type Snapshot = { az: number; el: number; offset: number; count: number; faces: string[]; flat: [number, number][] };
const HINTS = ['先观察，再按需请求提示。', '截面的每条边，来自切面与正方体一个面的交线。', '固定方向并缓慢移动切面，观察哪些面新加入或退出相交。', '尝试对角方向可得到六边形；靠近顶点可得到三角形。使用预设可核对结果。'];

/** 空间几何场景插件：演示模式 + 任务 A 预测验证 / B 寻找形状 / C 快照对比，切面经过面高亮。 */
export function GeometryScene({ active }: SceneProps) {
  const { notify, drag } = useServices();
  const [az, setAz] = useState(45), [el, setEl] = useState(35.264), [offset, setOffset] = useState(0);
  const [operation, setOperation] = useState<'position' | 'azimuth' | 'elevation'>('position');
  const [prediction, setPrediction] = useState(''), [submitted, setSubmitted] = useState(false), [hint, setHint] = useState(0);
  const [explanation, setExplanation] = useState(''), [completed, setCompleted] = useState(false);
  const [task, setTask] = useState<'free' | 'A' | 'B' | 'C'>('free'), [target, setTarget] = useState(4);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]), [lastFaces, setLastFaces] = useState<string[]>([]);
  const [history, setHistory] = useState<{ az: number; el: number; offset: number }[]>([]);
  const [started, setStarted] = useState(Date.now()), [stalled, setStalled] = useState(false);
  const lastActivity = useRef(Date.now());
  const slider = useRef<HTMLInputElement>(null), cubeHost = useRef<HTMLDivElement>(null);

  const normal = useMemo(() => angleNormal(az, el), [az, el]);
  const section = useMemo(() => sectionCube(normal, offset), [normal, offset]);
  const valid = section.kind === 'polygon' && !section.coincident, count = section.points.length;
  const faces = valid ? section.faces.map(i => faceNames[i]) : [];
  const newFaces = faces.filter(f => !lastFaces.includes(f));
  useEffect(() => { setLastFaces(faces); }, [faces.join(',')]);

  const emit = (intent: Parameters<typeof bus.emit>[0]['intent'], value?: string, source: Parameters<typeof bus.emit>[0]['source'] = 'mouse') =>
    bus.emit({ scene: 'geometry', source, intent, phase: 'end', value });
  const cancelOperation = () => {
    if (drag.current?.scene !== 'geometry' || !drag.current.initial) return;
    setAz(drag.current.initial.az); setEl(drag.current.initial.el); setOffset(drag.current.initial.offset);
    drag.current = null;
  };

  // 手势策略：捏合三维视图或滑块区域拖动调整当前模式参数（任务 A 提交预测前锁定）。
  useScenePolicy('geometry', sample => {
    if (sample.phase === 'cancel') { bus.emit({ scene: 'geometry', source: 'hand', intent: 'drag', phase: 'cancel' }); return; }
    if (task === 'A' && !submitted) return;
    const px = sample.x * window.innerWidth, py = sample.y * window.innerHeight;
    const rects = ([slider.current, cubeHost.current].filter(el => el != null) as HTMLElement[]).map(el => el.getBoundingClientRect());
    if (sample.phase === 'start') {
      if (rects.some(r => px >= r.left - 12 && px <= r.right + 12 && py >= r.top - 20 && py <= r.bottom + 20))
        bus.emit({ scene: 'geometry', source: 'hand', intent: 'drag', phase: 'start', position: { x: sample.x, y: sample.y } });
      return;
    }
    if (drag.current?.scene === 'geometry' && sample.phase === 'end') { bus.emit({ scene: 'geometry', source: 'hand', intent: 'drag', phase: 'end' }); return; }
    if (drag.current?.scene === 'geometry' && sample.pinching)
      bus.emit({ scene: 'geometry', source: 'hand', intent: 'drag', phase: 'update', position: { x: sample.x, y: sample.y } });
  });

  // 语义事件：切面参数调整、任务流程与撤销（鼠标/手势/语音共用）。
  useEffect(() => bus.subscribe(e => {
    lastActivity.current = Date.now();
    if (e.intent === 'drag' && e.scene === 'geometry') {
      if (e.phase === 'cancel') { cancelOperation(); return; }
      if (e.phase === 'start' && e.position) { drag.current = { scene: 'geometry', initial: { az, el, offset }, x: e.position.x, y: e.position.y }; return; }
      if (e.phase === 'update') {
        const a = drag.current;
        if (e.source === 'hand' && a?.scene === 'geometry' && a.initial && e.position) {
          const delta = e.position.x - a.x;
          if (operation === 'position') setOffset(Math.max(-1.8, Math.min(1.8, a.initial.offset + delta * 3.6)));
          if (operation === 'azimuth') setAz(Math.max(0, Math.min(360, a.initial.az + delta * 360)));
          if (operation === 'elevation') setEl(Math.max(-80, Math.min(80, a.initial.el - (e.position.y - a.y) * 160)));
        } else if (e.value) {
          const v = Number(e.value);
          if (operation === 'position') setOffset(v);
          if (operation === 'azimuth') setAz(v);
          if (operation === 'elevation') setEl(v);
        }
        return;
      }
      if (e.phase === 'end') {
        // 初始参数先取出再进更新器：更新器延迟执行时 drag.current 已被置空（回归修复）。
        const initial = drag.current?.scene === 'geometry' ? drag.current.initial : undefined;
        if (initial) setHistory(v => [...v, initial].slice(-30));
        drag.current = null;
        return;
      }
      return;
    }
    if (e.scene !== 'geometry') return;
    if (e.intent === 'undo') {
      cancelOperation();
      const previous = history.at(-1);
      if (previous) { setAz(previous.az); setEl(previous.el); setOffset(previous.offset); setHistory(v => v.slice(0, -1)); }
      return;
    }
    if (e.intent === 'reset') {
      cancelOperation(); setAz(45); setEl(35.264); setOffset(0); setPrediction(''); setSubmitted(false); setHint(0);
      setCompleted(false); setExplanation(''); setSnapshots([]); setLastFaces([]); setHistory([]); setStarted(Date.now());
      return;
    }
    if (e.intent === 'predict') { setSubmitted(true); notify('预测已记录。现在可以移动切面，并比较预测与观察。'); }
    if (e.intent === 'hint') setHint(v => Math.min(3, v + 1));
    if (e.intent === 'submit') { setCompleted(true); notify(`任务已完成，用时 ${Math.round((Date.now() - started) / 1000)} 秒。可导出过程记录。`); }
  }), [az, el, offset, operation, history, started]);

  // 停滞提醒：几何激活且超过 60 秒无操作时，出现一次非强制提示入口。
  useEffect(() => {
    if (!active) { setStalled(false); return; }
    lastActivity.current = Date.now(); setStalled(false);
    const timer = setInterval(() => setStalled(Date.now() - lastActivity.current > 60000 && !completed), 5000);
    return () => clearInterval(timer);
  }, [active, completed]);

  useSceneSnapshot('geometry', () => ({
    startedAt: new Date(started).toISOString(), durationSeconds: Math.round((Date.now() - started) / 1000),
    task, target: task === 'B' ? target : null, prediction, hints: hint,
    section: valid ? count : section.kind, sectionKind: section.kind, explanation, completed,
  }));

  const preset = (a: number, e2: number, d: number) => {
    cancelOperation(); setHistory(v => [...v, { az, el, offset }].slice(-30));
    setAz(a); setEl(e2); setOffset(d); setCompleted(false);
  };
  const range = {
    min: operation === 'position' ? -1.8 : operation === 'azimuth' ? 0 : -80,
    max: operation === 'position' ? 1.8 : operation === 'azimuth' ? 360 : 80,
    step: operation === 'position' ? .01 : 1,
    value: operation === 'position' ? offset : operation === 'azimuth' ? az : el,
  };
  const locked = task === 'A' && !submitted;

  return <section className="geometry-layout" hidden={!active}>
    <div className="panel geometry-main">
      <div className="task-head">
        <div><div className="eyebrow">数学 · 空间几何</div><h2>正方体截面探究</h2></div>
        <button onClick={() => emit('reset')}>重置任务</button>
      </div>
      <div className="presets">
        <button className={task === 'free' ? 'selected' : ''} onClick={() => { setTask('free'); emit('reset'); }}>演示模式</button>
        <button className={task === 'A' ? 'selected' : ''} onClick={() => { setTask('A'); emit('reset'); }}>任务 A · 预测验证</button>
        <button className={task === 'B' ? 'selected' : ''} onClick={() => { setTask('B'); emit('reset'); }}>任务 B · 寻找形状</button>
        <button className={task === 'C' ? 'selected' : ''} onClick={() => { setTask('C'); emit('reset'); }}>任务 C · 快照对比</button>
      </div>
      <div className="task-card">{task === 'free' ? '教师演示：拖动切面，截面与边数实时变化；琥珀色高亮显示切面经过的面。按需点“请求提示”获取讲解要点。' : task === 'A' ? '先预测初始切面的边数并提交，然后移动切面，观察并解释边数变化。' : task === 'B' ? `目标：构造一个 ${target} 边形截面，观察并解释切面经过了哪些面。` : '保存两个切面快照，比较边数变化，并解释哪些面加入或退出了相交。'}</div>
      <div className="presets">
        <button disabled={locked} onClick={() => preset(45, 35.264, 1.4)}>三边形预设</button>
        <button disabled={locked} onClick={() => preset(0, 0, 0)}>四边形预设</button>
        <button disabled={locked} onClick={() => preset(63.435, 53.301, 0.4)}>五边形预设</button>
        <button disabled={locked} onClick={() => preset(45, 35.264, 0)}>六边形预设</button>
        <button disabled={!history.length} onClick={() => emit('undo')}>撤销操作</button>
      </div>
      <div className="toolbar">
        <label>操作模式 <select value={operation} onChange={e => { cancelOperation(); setOperation(e.target.value as typeof operation); }}>
          <option value="position">切面位置</option><option value="azimuth">方向 · 方位角</option><option value="elevation">方向 · 仰角</option>
        </select></label>
        <output>{range.value.toFixed(2)}{operation === 'position' ? '' : '°'}</output>
      </div>
      <input ref={slider} aria-label="切面参数控制" type="range" {...range} disabled={locked}
        onPointerDown={() => bus.emit({ scene: 'geometry', source: 'mouse', intent: 'drag', phase: 'start', position: { x: 0, y: 0 } })}
        onChange={e => { if (!drag.current) setHistory(v => [...v, { az, el, offset }].slice(-30)); bus.emit({ scene: 'geometry', source: 'mouse', intent: 'drag', phase: 'update', position: { x: 0, y: 0 }, value: e.target.value }); }}
        onPointerUp={() => bus.emit({ scene: 'geometry', source: 'mouse', intent: 'drag', phase: 'end' })}
        onPointerCancel={() => bus.emit({ scene: 'geometry', source: 'mouse', intent: 'drag', phase: 'cancel' })} />
      <p className="help">{locked ? '先在右侧提交预测以解锁操作。' : '鼠标拖动滑块，或手势捏合三维视图/滑块区域后拖动；鼠标拖动三维背景可旋转观察视角。'}</p>
      <CubeView normal={normal} offset={offset} section={section} hostRef={cubeHost} />
    </div>
    <aside className="side">
      <div className="panel prediction">
        <h3>① {task === 'A' ? '提交预测' : task === 'B' ? '目标任务' : task === 'C' ? '快照对比' : '演示要点'}</h3>
        {task === 'A' ? <>
          <div className="chips">{[3, 4, 5, 6].map(n => <button disabled={submitted} className={prediction === String(n) ? 'selected' : ''} onClick={() => setPrediction(String(n))} key={n}>{n} 边</button>)}</div>
          <button className="primary" disabled={!prediction || submitted} onClick={() => emit('predict', `${prediction} 边，初始结果 ${count} 边`)}>{submitted ? '预测已记录' : '提交预测'}</button>
          {submitted && <p>你的初始预测：{prediction} 边。继续操作，比较当前结果。</p>}
        </> : task === 'B' ? <>
          <label>目标边数 <select value={target} onChange={e => { setTarget(+e.target.value); setCompleted(false); }}>{[3, 4, 5, 6].map(n => <option key={n}>{n}</option>)}</select></label>
          <p>{valid && count === target ? '已找到目标截面！请补充解释。' : '切换操作模式，调整位置和方向。所有目标均可通过预设验证。'}</p>
        </> : task === 'C' ? <>
          <div className="chips">{snapshots.map((s, i) => <button key={i} className="selected" onClick={() => preset(s.az, s.el, s.offset)}>{i + 1} · {s.count} 边形</button>)}</div>
          <button className="primary" disabled={!valid || snapshots.length >= 2} onClick={() => { setSnapshots(v => [...v, { az, el, offset, count, faces, flat: section.flat }]); notify(`已保存快照 ${snapshots.length + 1}：${count} 边形，切面经过 ${faces.length} 个面。`); }}>{snapshots.length >= 2 ? '已保存 2 个快照' : `保存当前截面 ${snapshots.length}/2`}</button>
          {snapshots.length === 2 && <div className="compare">
            {snapshots.map((s, i) => <div className="mini-section" key={i}><svg viewBox="-1.9 -1.9 3.8 3.8" aria-label={`快照${i + 1}轮廓`}><polygon points={s.flat.map(([x, y]) => `${x},${-y}`).join(' ')} /></svg></div>)}
            <p className="help" style={{ gridColumn: '1/-1' }}>边数 {snapshots[0].count} → {snapshots[1].count}；新增面：{snapshots[1].faces.filter(f => !snapshots[0].faces.includes(f)).join('、') || '无'}；退出面：{snapshots[0].faces.filter(f => !snapshots[1].faces.includes(f)).join('、') || '无'}。在下方解释这些变化。</p>
          </div>}
          {snapshots.length < 2 && <p className="help">调整切面保存第 1 个快照，再改变参数保存第 2 个，然后比较并解释。</p>}
        </> : <p>自由操作切面：移动位置、调整方位角与仰角，观察二维轮廓、边数与高亮面的联动。适合课堂讲解“截面的每条边来自切面与一个面的交线”。</p>}
      </div>
      <div className="panel result">
        <h3>② 实时观察 · 二维截面</h3>
        <div className="big-number">{valid ? count : '—'}<small>{valid ? '条边' : '特殊状态'}</small></div>
        <div className="mini-section">{section.kind === 'polygon' && <svg viewBox="-1.9 -1.9 3.8 3.8" aria-label="二维截面轮廓"><polygon points={section.flat.map(([x, y]) => `${x},${-y}`).join(' ')} /></svg>}</div>
        <p>{section.coincident ? '切面与正方体表面重合，此状态不作为普通截面判题。' : section.kind === 'none' ? '当前切面未穿过正方体。' : section.kind === 'degenerate' ? '临界状态：截面退化为点或线段。' : '三维切面与二维轮廓使用同一计算结果。'}</p>
        <p className="help">切面经过的面：{faces.length ? faces.map(f => newFaces.includes(f) ? `${f}▲` : f).join('、') : '—'}{newFaces.length ? '（▲ 新加入）' : ''}</p>
      </div>
      <div className="panel hint">
        <h3>③ 提示与反思</h3>
        <button onClick={() => emit('hint')}>请求提示 {hint}/3</button>
        <p>{HINTS[hint]}</p>
        {stalled && <p className="notice">已经停留超过 60 秒没有新操作。可以先自己再试一次，也可以点上面的“请求提示”。</p>}
        <textarea className="reflection" aria-label="观察解释" rows={3} value={explanation} placeholder="你观察到什么？为什么边数会变化？" onChange={e => setExplanation(e.target.value)} />
        {task !== 'free' && <button className="primary" disabled={!explanation.trim() || !valid || (task === 'A' ? !submitted : task === 'B' ? count !== target : task === 'C' ? snapshots.length < 2 : false) || completed} onClick={() => emit('submit', explanation)}>{completed ? '任务已完成 ✓' : '提交观察解释'}</button>}
      </div>
    </aside>
  </section>;
}
