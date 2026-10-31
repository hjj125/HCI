import { useEffect, useMemo, useRef, useState } from 'react';
import { bus } from '../../core/interaction';
import type { SceneProps } from '../types';
import { speak, useSceneAgent, useScenePolicy, useSceneSnapshot, useSceneVoicePolicy, useServices } from '../../core/services';
import { sleep } from '../../core/agent/scheduler';
import { MoleculeView, type MoleculeHandle } from './MoleculeView';
import { MOLECULE_DEMOS } from './agentAdapter';
import { goalFromSpec, planBuild, predictState, type BuildAction } from './buildPlanner';
import { geometryLabels, vseprLayout } from './vsepr';
import {
  bondKey, freeValenceHint, fullValenceIds, isomerDifferent, molecularFormula, validateMolecule,
  ELEMENT_ZH, NAME_ZH, VALENCE,
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
  // VSEPR 理想几何：targets 为理想坐标（null = 自由摆放走弹簧物理）；fullIds 为满价原子（灰调）。
  const [geoMode, setGeoMode] = useState<'vsepr' | 'free'>('vsepr');
  const targets = useMemo(() => (geoMode === 'vsepr' ? vseprLayout(atoms, bonds) : null), [geoMode, atoms, bonds]);
  const fullIds = useMemo(() => new Set(fullValenceIds(atoms, bonds)), [atoms, bonds]);
  const geoLines = useMemo(
    () => geometryLabels(atoms, bonds).map(({ id, el, info }) => `${ELEMENT_ZH[el]}#${id}：${info.zh}${info.angle != null ? `，键角约 ${info.angle}°` : ''}`),
    [atoms, bonds],
  );

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

  // 灵犀演示：按脚本数据逐个添加原子、逐对成键（不经过点选 UI，用 updater 读最新状态）。
  const agentBond = (a: number, b: number, order: 1 | 2) => {
    setBonds(v => {
      const key = bondKey(a, b);
      const existing = v.find(x => bondKey(x.a, x.b) === key);
      if (existing && existing.order === order) return v;
      if (existing) return v.map(x => (bondKey(x.a, x.b) === key ? { ...x, order } : x));
      return [...v, { a: Math.min(a, b), b: Math.max(a, b), order }];
    });
  };
  const demoCancel = useRef(false);
  // 学生插手的时间戳（软打断）：闭环搭建器等安静 1.2 秒后重新感知、自适应继续。
  const disturbRef = useRef(0);
  // 每渲染刷新的画布快照——闭环搭建器的"眼睛"。
  const molRef = useRef({ atoms, bonds });
  molRef.current = { atoms, bonds };

  // 指向：把出事原子选中——高亮 + 键数徽标（"键 5/4（超价！）"）+ 手指点过去，就是灵犀的身体指示。
  const highlightError = () => {
    const err = validation.errors[0];
    if (err?.atoms.length) {
      setSelected(err.atoms[0]);
      view.current?.handShow(true);
      view.current?.handToAtom(err.atoms[0]);
      setTimeout(() => view.current?.handShow(false), 1800);
      notify(`灵犀帮你指出来了：${err.detail}`);
    }
  };

  // 就地修复：不重搭，在学生的分子上动手——优先拆一个多余的末端氢，其次降双键为单键。
  // 行动前用世界模型预测结果，行动后核对："预测-行动-观察"，和任务卡教学生的方法论一致。
  const repairOvervalence = async (voice: (text: string) => void = notify) => {
    const err = validation.errors.find(e => e.kind === 'overvalence');
    if (!err) { voice('现在没有超价的原子——没什么要修的。'); return; }
    demoCancel.current = false;
    await sleep(350); if (demoCancel.current) return;
    const u = err.atoms[0];
    const atom = atoms.find(a => a.id === u);
    if (!atom) { voice('出错的原子已经不在画布上了。'); return; }
    const atomZh = ELEMENT_ZH[atom.el];
    const touching = bonds.filter(b => b.a === u || b.b === u);
    const usedNow = touching.reduce((s, b) => s + b.order, 0);
    const extraH = [...touching].reverse().find(b => {
      if (b.order !== 1) return false;
      const other = b.a === u ? b.b : b.a;
      const neighbor = atoms.find(a => a.id === other);
      const deg = bonds.filter(x => x.a === other || x.b === other).reduce((s, x) => s + x.order, 0);
      return neighbor?.el === 'H' && deg === 1;
    });
    view.current?.handShow(true);
    if (extraH) {
      const hid = extraH.a === u ? extraH.b : extraH.a;
      const pred = predictState(atoms, bonds, { kind: 'remove', id: hid });
      voice(`灵犀先预测：拆掉 #${hid} 后，${atomZh}#${u} 键数 ${usedNow} → ${usedNow - 1}，分子${pred.valid ? '仍然合法' : '可能还有别的问题'}——看好了。`);
      view.current?.handToAtom(hid);
      await sleep(420); if (demoCancel.current) { view.current?.handShow(false); return; }
      view.current?.handPinch(true);
      await sleep(180); if (demoCancel.current) { view.current?.handShow(false); return; }
      setAtoms(v => v.filter(a => a.id !== hid));
      setBonds(v => v.filter(b => b !== extraH));
      setSelected(u);
      await sleep(160);
      view.current?.handPinch(false);
      await sleep(600); if (demoCancel.current) { view.current?.handShow(false); return; }
      const usedAfter = molRef.current.bonds.filter(b => b.a === u || b.b === u).reduce((s, b) => s + b.order, 0);
      voice(`${usedAfter === usedNow - 1 ? '预测应验了' : '实际和预测有出入——看②面板重新判一判'}：键数 ${usedNow} → ${usedAfter}。想一想：为什么拆氢而不是拆碳？可以打字告诉灵犀。`);
    } else {
      const dbl = [...touching].reverse().find(b => b.order === 2);
      if (dbl) {
        voice(`没有多余的氢可拆——灵犀预测：把一根双键降为单键，${atomZh}#${u} 键数 ${usedNow} → ${usedNow - 1}。`);
        view.current?.handToAtom(u);
        await sleep(380); if (demoCancel.current) { view.current?.handShow(false); return; }
        view.current?.handPinch(true);
        await sleep(180); if (demoCancel.current) { view.current?.handShow(false); return; }
        setBonds(v => v.map(b => (b === dbl ? { ...b, order: 1 as const } : b)));
        setSelected(u);
        await sleep(160);
        view.current?.handPinch(false);
        await sleep(600); if (demoCancel.current) { view.current?.handShow(false); return; }
        voice(`修好了：键数 ${usedNow} → ${usedNow - 1}。想一想：什么时候该降键级、什么时候该拆原子？`);
      } else {
        voice('这个超价没法只靠拆键修复——试试清空后按价数重新搭，或者直接问灵犀为什么。');
      }
    }
    view.current?.handShow(false);
  };

  useSceneAgent('chem-molecule', {
    run: async (script, param, say) => {
      const voice = say ?? notify; // 灵犀的声音：气泡打字机 + TTS；缺省回退顶部通知
      if (script === 'highlight-error') highlightError();
      else if (script === 'repair-overvalence') await repairOvervalence(voice);
      else if (script === 'demo-springback') await runSpringback(voice);
      else await runBuildLoop(script, voice);
    },
    disturb: () => { disturbRef.current = Date.now(); },
    cancel: () => { demoCancel.current = true; },
  });

  // 手的动作编排：每个动作都"手先到 → 捏合 → 执行"——身体可见。
  const performAction = async (act: BuildAction) => {
    if (act.kind === 'add') {
      view.current?.handToFree();
      view.current?.handPinch(true);
      await sleep(240); if (demoCancel.current) return;
      addAtom(act.el);
      await sleep(160);
      view.current?.handPinch(false);
    } else if (act.kind === 'remove') {
      view.current?.handToAtom(act.id);
      await sleep(240); if (demoCancel.current) return;
      view.current?.handPinch(true);
      await sleep(150);
      setAtoms(v => v.filter(a => a.id !== act.id));
      setBonds(v => v.filter(b => b.a !== act.id && b.b !== act.id));
      await sleep(140);
      view.current?.handPinch(false);
    } else {
      view.current?.handToAtom(act.a);
      await sleep(220); if (demoCancel.current) return;
      view.current?.handPinch(true);
      view.current?.handToAtom(act.b);
      await sleep(280); if (demoCancel.current) return;
      agentBond(act.a, act.b, act.order);
      await sleep(150);
      view.current?.handPinch(false);
    }
  };

  /**
   * 闭环搭建器：感知（molRef 最新原子/键）→ 规划（planBuild 求差）→ 预测（世界模型 = 判题内核）
   * → 手到位执行 → 复核（实际 vs 预测，不符就解释并在下一轮重规划）→ 达成后收尾 + 苏格拉底反问。
   * 学生插手（disturb）不取消演示：等安静 1.2 秒后重新感知、自适应继续；清空画布则优雅收场。
   */
  const runBuildLoop = async (script: string, voice: (text: string) => void = notify) => {
    const spec = MOLECULE_DEMOS[script];
    if (!spec) return;
    demoCancel.current = false;
    disturbRef.current = 0;
    view.current?.handShow(true);
    view.current?.handToFree();
    clearAll();
    await sleep(480); if (demoCancel.current) { view.current?.handShow(false); return; }
    const goal = goalFromSpec(spec);
    let seenDisturb = 0;
    for (let guard = 0; guard < 220; guard++) {
      if (disturbRef.current && Date.now() - disturbRef.current < 1200) { await sleep(180); continue; }
      if (disturbRef.current !== seenDisturb) {
        seenDisturb = disturbRef.current;
        if (!molRef.current.atoms.length) {
          voice('好，画布空了——想再看一遍就说"搭一个"分子名。');
          view.current?.handShow(false);
          return;
        }
        voice('灵犀注意到你动了画布——重新看一眼，接着搭。');
      }
      const { atoms: curAtoms, bonds: curBonds } = molRef.current;
      const actions = planBuild(goal, curAtoms, curBonds);
      if (!actions.length) break;
      const act = actions[0];
      const pred = predictState(curAtoms, curBonds, act);
      await performAction(act);
      if (demoCancel.current) { view.current?.handShow(false); return; }
      await sleep(320);
      if (demoCancel.current) { view.current?.handShow(false); return; }
      if (pred.formula !== molecularFormula(molRef.current.atoms)) {
        voice('和你动手的时候撞上了——没关系，灵犀重新看一眼，接着搭。');
      }
    }
    view.current?.handShow(false);
    const f = molecularFormula(molRef.current.atoms);
    const ok = validateMolecule(molRef.current.atoms, molRef.current.bonds).ok;
    voice(ok
      ? `搭好了：${f}${NAME_ZH[f] ? `（${NAME_ZH[f]}）` : ''}。${spec.summary}${spec.quiz ? ` 想一想：${spec.quiz}` : ''}`
      : `这一轮搭到接近了——当前是 ${f}。哪里不对，可以问灵犀，或者说"再来一遍"。`);
  };

  /** 推氢回弹：把一个末端氢拖离理想位、松手——理想几何缓动把它弹回 VSEPR 的位置。 */
  const runSpringback = async (voice: (text: string) => void = notify) => {
    if (geoMode !== 'vsepr') { voice('推氢回弹要在「理想 VSEPR」几何下看——先在工具栏切过去。'); return; }
    const target = molRef.current.atoms.find(a => a.el === 'H'
      && molRef.current.bonds.filter(b => b.a === a.id || b.b === a.id).reduce((s, b) => s + b.order, 0) === 1);
    if (!target) { voice('画布上还没有带氢的分子——先搭一个再试。'); return; }
    demoCancel.current = false;
    view.current?.handShow(true);
    view.current?.handToAtom(target.id);
    await sleep(420); if (demoCancel.current) { view.current?.handShow(false); return; }
    view.current?.handPinch(true);
    await sleep(220); if (demoCancel.current) { view.current?.handShow(false); return; }
    view.current?.nudgeAtom(target.id);
    await sleep(760);
    view.current?.handPinch(false);
    await sleep(950);
    view.current?.handShow(false);
    if (demoCancel.current) return;
    voice('看——松手后它弹回了理想位置。几何不是灵犀规定的，是 VSEPR 这个"环境的约束"。');
  };

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

  // 场景级语音：添加元素 / 删除选中 / 清除重来 / 语音直通灵犀演示（"搭一个水分子""演示甲烷"）。
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
    if (t.includes('搭') || t.includes('演示')) {
      const demo = ([['水', 'demo-water'], ['氧气', 'demo-oxygen'], ['二氧化碳', 'demo-co2'], ['氨', 'demo-ammonia'], ['甲烷', 'demo-methane']] as const)
        .find(([w]) => t.includes(w));
      if (demo) {
        const msg = `好——看灵犀搭${demo[0] === '水' ? '一个水分子' : demo[0]}。`;
        notify(msg);
        const ms = speak(msg);
        if (ms) pauseRecognition(ms + 800);
        void runBuildLoop(demo[1]);
        return true;
      }
    }
    if (t.includes('推')) { notify('语音 · 灵犀推氢回弹'); void runSpringback(); return true; }
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
    task, geoMode,
    atomCount: atoms.length, bondCount: bonds.length,
    formula, nameZh: NAME_ZH[formula] ?? null, valid: validation.ok, errors: validation.errors.map(e => e.detail),
    valenceHint: freeValenceHint(atoms, bonds),
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
      <button onClick={() => setGeoMode(m => (m === 'vsepr' ? 'free' : 'vsepr'))}
        title="理想 VSEPR：原子回到价层电子对互斥模型的理想位置（拖动后松手会弹回）；自由摆放保留弹簧布局，可随意摆姿势。">几何：{geoMode === 'vsepr' ? '理想 VSEPR' : '自由摆放'}</button>
      <span className="help">点选两个原子=成键；已键合再点=升双键；再点=断键。语音可说“添加氧”“删除”“清除”“搭一个水分子”。</span>
    </div>
    <div className="geo-host" ref={host} role="img" aria-label="分子画布"
      onPointerDown={e => { const r = e.currentTarget.getBoundingClientRect(); view.current?.pointer('start', (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); }}
      onPointerMove={e => { const r = e.currentTarget.getBoundingClientRect(); view.current?.pointer('update', (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); }}
      onPointerUp={e => { const r = e.currentTarget.getBoundingClientRect(); view.current?.pointer('end', (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height); }}
      onPointerCancel={() => view.current?.pointer('cancel', 0, 0)}
      onWheel={e => { e.preventDefault(); view.current?.zoom(e.deltaY > 0 ? 0.2 : -0.2); }}>
      <MoleculeView hostRef={host} ref={view} atoms={atoms} bonds={bonds} selectedId={selected} onAtomClick={handleAtomClick} targets={targets} fullIds={fullIds} />
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
        {NAME_ZH[formula] && <p className="help">中文名：{NAME_ZH[formula]}</p>}
        {validation.ok
          ? <p className="help">{atoms.length ? '✓ 合法分子：无超价、整体连通。' : '空画布。'}</p>
          : <div>{validation.errors.map((e, i) => <p key={i} className="notice" style={{ marginTop: 8 }}>⚠ {e.detail}</p>)}</div>}
        <p className="help">{freeValenceHint(atoms, bonds)}</p>
        {geoLines.length > 0 && <p className="help">中心原子几何（VSEPR 近似）：{geoLines.slice(0, 3).join('；')}{geoLines.length > 3 ? ' 等' : ''}。</p>}
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
