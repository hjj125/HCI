import { useEffect, useMemo, useRef, useState } from 'react';
import { bus } from '../../core/interaction';
import type { SceneProps } from '../types';
import { speak, useScenePolicy, useSceneSnapshot, useSceneVoicePolicy, useServices } from '../../core/services';
import { MoleculeView, type MoleculeHandle } from './MoleculeView';
import {
  bondKey, isomerDifferent, molecularFormula, validateMolecule, ELEMENT_ZH,
  type Atom, type Bond, type Element,
} from './molecule';

type Task = 'free' | 'A' | 'B' | 'C';
type Snapshot = { atoms: Atom[]; bonds: Bond[] };

const ELEMENTS: Element[] = ['H', 'C', 'N', 'O'];
/** 任务 A 价键预测题库。 */
export const A_QUIZ: { el: Element; ans: number }[] = [
  { el: 'O', ans: 2 }, { el: 'N', ans: 3 }, { el: 'C', ans: 4 }, { el: 'H', ans: 1 },
];
/** 任务 B 目标分子（化学式判题：合法 + 希尔式一致）。 */
export const B_TARGETS: { formula: string; zh: string }[] = [
  { formula: 'H2O', zh: '水' }, { formula: 'O2', zh: '氧气' }, { formula: 'CO2', zh: '二氧化碳' },
  { formula: 'NH3', zh: '氨' }, { formula: 'CH4', zh: '甲烷' },
];

/** 化学实验一 · 分子搭建：捏合点选原子成键，搭出分子模型（价键规则确定性判题）。 */
export function MoleculeScene({ active }: SceneProps) {
  const { notify, pauseRecognition } = useServices();
  const [task, setTask] = useState<Task>('free');
  const [atoms, setAtoms] = useState<Atom[]>([]);
  const [bonds, setBonds] = useState<Bond[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [aIndex, setAIndex] = useState(0);
  const [pred, setPred] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [verdictA, setVerdictA] = useState<null | boolean>(null);
  const [bIndex, setBIndex] = useState(0);
  const [savedC, setSavedC] = useState<(Snapshot & { formula: string })[]>([]);
  const [explanation, setExplanation] = useState('');
  const [completed, setCompleted] = useState(false);
  const [hint, setHint] = useState(0);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [stalled, setStalled] = useState(false);
  const lastActivity = useRef(Date.now());
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<MoleculeHandle>(null);
  const nextId = useRef(1);
  const live = useRef({ selected, task });
  live.current = { selected, task };
  const aQuiz = A_QUIZ[aIndex];
  const bTarget = B_TARGETS[bIndex];
  const validation = useMemo(() => validateMolecule(atoms, bonds), [atoms, bonds]);
  const formula = useMemo(() => molecularFormula(atoms), [atoms]);
  const bSatisfied = atoms.length > 0 && validation.ok && formula === bTarget.formula;
  const cSatisfied = savedC.length === 2 && isomerDifferent(savedC[0].atoms, savedC[0].bonds, savedC[1].atoms, savedC[1].bonds);

  const emit = (intent: Parameters<typeof bus.emit>[0]['intent'], value?: string, source: Parameters<typeof bus.emit>[0]['source'] = 'mouse') =>
    bus.emit({ scene: 'chem-molecule', source, intent, phase: 'end', value });

  const addAtom = (el: Element) => {
    setAtoms(v => [...v, { id: nextId.current++, el }]);
    notify(`已添加一个${ELEMENT_ZH[el]}原子。`);
  };
  const removeSelected = () => {
    if (selected == null) { notify('先点选一个原子再删除。'); return; }
    setAtoms(v => v.filter(a => a.id !== selected));
    setBonds(v => v.filter(b => b.a !== selected && b.b !== selected));
    setSelected(null);
    notify('已删除选中的原子及其键。');
  };
  const clearAll = () => { setAtoms([]); setBonds([]); setSelected(null); notify('画布已清空。'); };

  /** 点选语义：第一个=选中；第二个 → 无键成键、单键升双键、双键断开。 */
  const handleAtomClick = (id: number) => {
    const cur = live.current.selected;
    if (cur == null) { setSelected(id); notify(`选中 ${ELEMENT_ZH[atoms.find(a => a.id === id)!.el]} 原子 #${id}——再点另一个原子成键。`); return; }
    if (cur === id) { setSelected(null); notify('已取消选中。'); return; }
    const key = bondKey(cur, id);
    const existing = bonds.find(b => bondKey(b.a, b.b) === key);
    if (!existing) {
      setBonds(v => [...v, { a: Math.min(cur, id), b: Math.max(cur, id), order: 1 }]);
      notify('已成键（单键）。再对同一对原子点选可升级为双键。');
    } else if (existing.order === 1) {
      setBonds(v => v.map(b => (bondKey(b.a, b.b) === key ? { ...b, order: 2 as const } : b)));
      notify('已升级为双键。再点选一次则断开。');
    } else {
      setBonds(v => v.filter(b => bondKey(b.a, b.b) !== key));
      notify('已断开该键。');
    }
    setSelected(null);
  };

  // 手势：把捏合/移动换算成画布归一化坐标交给视图（与鼠标同一路径）。
  useScenePolicy('chem-molecule', sample => {
    if (!host.current) return;
    if (sample.phase === 'cancel') { view.current?.pointer('cancel', 0, 0); return; }
    const rect = host.current.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (sample.x * window.innerWidth - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (sample.y * window.innerHeight - rect.top) / rect.height));
    view.current?.pointer(sample.phase, nx, ny);
  });

  // 场景级语音：添加元素 / 删除选中 / 清除重来。
  const lastVoice = useRef({ text: '', at: 0 });
  useSceneVoicePolicy('chem-molecule', text => {
    const t = text.replace(/\s/g, '');
    const el = (['氢', '碳', '氮', '氧'] as const).find(z => t.includes(`添加${z}`) || t.includes(`来一个${z}`));
    if (el) {
      const e = (Object.keys(ELEMENT_ZH) as Element[]).find(k => ELEMENT_ZH[k] === el)!;
      addAtom(e);
      const msg = `已添加${el}原子`;
      const now = performance.now();
      if (lastVoice.current.text !== msg || now - lastVoice.current.at > 10000) {
        lastVoice.current = { text: msg, at: now };
        const ms = speak(msg);
        if (ms) pauseRecognition(ms + 800);
      }
      return true;
    }
    if (t.includes('删除')) { removeSelected(); return true; }
    if (t.includes('清除') || t.includes('重来')) { clearAll(); return true; }
    return false;
  });

  useEffect(() => bus.subscribe(e => {
    lastActivity.current = Date.now();
    if (e.scene !== 'chem-molecule' && e.intent !== 'switch') return;
    if (e.intent === 'hint') setHint(v => Math.min(2, v + 1));
    if (e.intent === 'reset') {
      setPred(0); setVerdictA(null); setExplanation(''); setCompleted(false); setHint(0); setStartedAt(Date.now());
    }
    if (e.intent === 'predict' && task === 'A') {
      const ok = pred === aQuiz.ans;
      setVerdictA(ok);
      notify(ok ? `✓ 正确！${ELEMENT_ZH[aQuiz.el]}原子的价数是 ${aQuiz.ans}。用托盘搭一下验证吧。` : `✗ ${ELEMENT_ZH[aQuiz.el]}原子的价数是 ${aQuiz.ans}——再想想它的最外层电子。`);
    }
    if (e.intent === 'submit') { setCompleted(true); notify(`任务已完成，用时 ${Math.round((Date.now() - startedAt) / 1000)} 秒。`); }
  }), [task, pred, aQuiz, startedAt, notify]);

  useEffect(() => {
    if (!active) { setStalled(false); return; }
    lastActivity.current = Date.now(); setStalled(false);
    const timer = setInterval(() => setStalled(Date.now() - lastActivity.current > 60000 && !completed), 5000);
    return () => clearInterval(timer);
  }, [active, completed]);

  useSceneSnapshot('chem-molecule', () => ({
    startedAt: new Date(startedAt).toISOString(), durationSeconds: Math.round((Date.now() - startedAt) / 1000),
    task, atomCount: atoms.length, bondCount: bonds.length,
    formula, valid: validation.ok, errors: validation.errors.map(e => e.detail),
    hints: hint, explanation, completed,
    quiz: task === 'A' ? { element: aQuiz.el, prediction: pred || null, correct: verdictA } : null,
    construct: task === 'B' ? { target: bTarget.formula, satisfied: bSatisfied } : null,
    compare: task === 'C' ? { saved: savedC.map(s => s.formula), satisfied: cSatisfied } : null,
  }));

  const HINTS: Record<Task, string[]> = {
    free: ['从托盘添加几个原子，点选两个原子即可成键。', '同一对原子再点一次升为双键，再点一次断开。', '按住原子拖动可以摆姿势（不影响判题）。'],
    A: ['价数 = 能形成的键数：氢 1、氧 2、氮 3、碳 4。', '想最外层电子：氧有 6 个，还差 2 个凑 8。', '提交后用托盘现场搭一下验证你的答案。'],
    B: ['先摆够原子，再逐对点选成键。', '氧分子需要一根双键（O=O）；二氧化碳两个双键（O=C=O）。', '右栏会实时显示化学式和超价/不连通提示。'],
    C: ['用 4 个碳和 10 个氢：先搭一条直链（正丁烷）保存。', '再搭一个中心碳连三个碳的“叉”（异丁烷）保存。', '两种结构化学式相同、连接方式不同——这就是同分异构体。'],
  };

  return <section className="panel" hidden={!active}>
    <div className="task-head">
      <div><div className="eyebrow">化学 · 分子与价键</div><h2>分子搭建</h2></div>
      <button onClick={() => emit('reset')}>重置任务</button>
    </div>
    <div className="presets">
      <button className={task === 'free' ? 'selected' : ''} onClick={() => { setTask('free'); emit('reset'); }}>演示模式</button>
      <button className={task === 'A' ? 'selected' : ''} onClick={() => { setTask('A'); emit('reset'); setAIndex(0); }}>任务 A · 价键预测</button>
      <button className={task === 'B' ? 'selected' : ''} onClick={() => { setTask('B'); emit('reset'); setBIndex(0); }}>任务 B · 搭出目标分子</button>
      <button className={task === 'C' ? 'selected' : ''} onClick={() => { setTask('C'); emit('reset'); }}>任务 C · 同分异构体</button>
    </div>
    <div className="task-card">{task === 'free' ? '从托盘添加原子，指向一个原子捏合（或鼠标点击）选中，再点另一个原子即成键；同一对再点升为双键、再点断开。按住原子可拖动摆姿势。'
      : task === 'A' ? `预测：一个${ELEMENT_ZH[aQuiz.el]}原子最多能形成几个键？提交后用托盘现场搭一下验证。`
      : task === 'B' ? `目标：搭出「${bTarget.zh}」（${bTarget.formula}）。要求分子合法：无超价、整体连通。达成后补充解释并提交。`
      : '用 4 个碳和 10 个氢搭出两种不同的连接方式（如直链与叉链），分别保存为对比①②——化学式相同而结构不同，即同分异构体。'}</div>
    <div className="toolbar" style={{ marginTop: 12 }}>
      {ELEMENTS.map(el => <button key={el} onClick={() => addAtom(el)}>添加{ELEMENT_ZH[el]}</button>)}
      <button onClick={removeSelected}>删除选中</button>
      <button onClick={clearAll}>清空画布</button>
      <span className="help">点选两个原子=成键；已键合再点=升双键；再点=断键。语音可说“添加氧”“删除”“清除”。</span>
    </div>
    <div className="geo-host" ref={host} role="img" aria-label="分子画布"
      onPointerDown={e => { const r = e.currentTarget.getBoundingClientRect(); view.current?.pointer('start', (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); }}
      onPointerMove={e => { const r = e.currentTarget.getBoundingClientRect(); view.current?.pointer('update', (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); }}
      onPointerUp={e => { const r = e.currentTarget.getBoundingClientRect(); view.current?.pointer('end', (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); }}
      onPointerCancel={() => view.current?.pointer('cancel', 0, 0)}
      onWheel={e => { e.preventDefault(); view.current?.zoom(e.deltaY > 0 ? 0.2 : -0.2); }}>
      <MoleculeView hostRef={host} ref={view} atoms={atoms} bonds={bonds} selectedId={selected} onAtomClick={handleAtomClick} />
    </div>
    <aside className="side" style={{ marginTop: 16 }}>
      <div className="panel prediction">
        <h3>① {task === 'A' ? '价键预测' : task === 'B' ? '构造目标' : task === 'C' ? '异构对比' : '当前分子'}</h3>
        {task === 'A' ? <>
          <p className="help">一个{ELEMENT_ZH[aQuiz.el]}原子最多形成几个键？</p>
          <div className="chips">{[1, 2, 3, 4].map(n => <button key={n} disabled={!!verdictA} className={pred === n ? 'selected' : ''} onClick={() => setPred(n as 1 | 2 | 3 | 4)}>{n}</button>)}</div>
          <button className="primary" disabled={!pred || !!verdictA} onClick={() => emit('predict')}>提交预测</button>
          {verdictA !== null && <p className="notice">{verdictA ? `✓ 正确！${ELEMENT_ZH[aQuiz.el]}的价数是 ${aQuiz.ans}。` : `✗ ${ELEMENT_ZH[aQuiz.el]}的价数是 ${aQuiz.ans}。`}</p>}
          <button onClick={() => { setAIndex((aIndex + 1) % A_QUIZ.length); setPred(0); setVerdictA(null); setHint(0); notify('已切换到新题目。'); }}>换一题</button>
        </> : task === 'B' ? <>
          <p>目标：<b>{bTarget.zh}（{bTarget.formula}）</b></p>
          <p className={bSatisfied ? 'notice' : 'help'}>{bSatisfied ? `✓ 达成！当前分子 ${formula} 合法且与目标一致。补充解释后提交。` : `当前 ${formula}——还要满足：无超价、整体连通。`}</p>
        </> : task === 'C' ? <>
          {savedC.length === 0 && <p className="help">还没有保存的结构。搭好第一种后保存为对比①。</p>}
          {savedC.map((s, i) => <p key={i} className="help">对比{i + 1}：{s.formula}（{s.atoms.length} 个原子，{s.bonds.length} 根键）</p>)}
          <div className="task-actions">
            <button disabled={!atoms.length || savedC.length >= 2} onClick={() => { setSavedC(v => [...v, { atoms: [...atoms], bonds: bonds.map(b => ({ ...b })), formula }].slice(-2)); notify('已保存当前结构。'); }}>保存为对比{savedC.length + 1}</button>
          </div>
          {savedC.length === 2 && <p className={cSatisfied ? 'notice' : 'help'}>{cSatisfied ? '✓ 两种结构化学式相同、连接方式不同——同分异构体达成！' : '两种结构的化学式或连接方式不满足同分异构条件——清空一个重新搭。'}</p>}
        </> : <p>{atoms.length ? `共 ${atoms.length} 个原子、${bonds.length} 根键。` : '画布为空。从上方托盘添加原子开始。'}</p>}
      </div>
      <div className="panel result">
        <h3>② 分子状态</h3>
        <div className="big-number" style={{ fontSize: 30 }}>{formula}</div>
        {validation.ok
          ? <p className="help">{atoms.length ? '✓ 合法分子：无超价、整体连通。' : '空画布。'}</p>
          : <div>{validation.errors.map((e, i) => <p key={i} className="notice" style={{ marginTop: 8 }}>⚠ {e.detail}</p>)}</div>}
        <p className="help">判题 = 价键规则 + 连通性 + 希尔式（教科书顺序），全部离线确定性计算。</p>
      </div>
      <div className="panel hint">
        <h3>③ 提示与反思</h3>
        <button onClick={() => emit('hint')}>请求提示 {hint}/2</button>
        <p>{HINTS[task][Math.min(hint, 2)]}</p>
        {stalled && <p className="notice">已经停留超过 60 秒没有新操作。可以先自己再试一次，也可以点上面的“请求提示”。</p>}
        <textarea className="reflection" aria-label="分子观察解释" rows={3} value={explanation}
          placeholder={task === 'A' ? '价数和最外层电子有什么关系？' : task === 'B' ? '这个分子的结构是怎样的？' : '两种结构的相同与不同分别是什么？'}
          onChange={e => setExplanation(e.target.value)} />
        {task !== 'free' && <button className="primary" disabled={!explanation.trim() || (task === 'A' ? !verdictA : task === 'B' ? !bSatisfied : !cSatisfied) || completed} onClick={() => emit('submit', explanation)}>{completed ? '任务已完成 ✓' : '提交观察解释'}</button>}
      </div>
    </aside>
  </section>;
}
