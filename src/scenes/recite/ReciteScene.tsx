import { useEffect, useRef, useState } from 'react';
import { bus } from '../../core/interaction';
import type { SceneProps } from '../types';
import { speak, useScenePolicy, useSceneSnapshot, useSceneVoicePolicy, useServices } from '../../core/services';
import { alignTexts, score, type AlignUnit } from './recite';
import { POEMS, poemText } from './poems';

type Task = 'free' | 'A' | 'B' | 'C';
type Result = { units: AlignUnit[]; completeness: number; title: string; wrongSet: string[] };

const STATUS_LABEL: Record<string, string> = { match: '正确', wrong: '不符（可能同音）', missing: '漏字', extra: '多字' };

/** 语文实验一 · 古诗词背诵镜：对麦克风背诵，字符级对齐标注易错字（形成性工具，不做判分）。 */
export function ReciteScene({ active }: SceneProps) {
  const { notify, pauseRecognition } = useServices();
  const [task, setTask] = useState<Task>('free');
  const [poemIndex, setPoemIndex] = useState(0);
  const [showText, setShowText] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [dictIdx, setDictIdx] = useState(0);          // 听写模式：当前联（提示上句的下标/2）
  const [awaiting, setAwaiting] = useState(false);     // 正在等学生接下句
  const [answers, setAnswers] = useState<boolean[]>([]);
  const [savedC, setSavedC] = useState<{ title: string; completeness: number; wrongSet: string[] }[]>([]);
  const [explanation, setExplanation] = useState('');
  const [completed, setCompleted] = useState(false);
  const [hint, setHint] = useState(0);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [stalled, setStalled] = useState(false);
  const lastActivity = useRef(Date.now());
  const heardRef = useRef<string[]>([]);
  const live = useRef({ task, listening, awaiting, dictIdx, poemIndex });
  live.current = { task, listening, awaiting, dictIdx, poemIndex };
  const poem = POEMS[poemIndex];
  const couplets = Math.floor(poem.sentences.length / 2);
  const bSatisfied = result != null && result.title === poem.title && result.completeness >= 0.9;
  const cSatisfied = savedC.length >= 2;
  // 错字集合对比：第二次相对第一次 新出现 / 已改正。
  const [prevC, curC] = savedC.length === 2 ? [savedC[0], savedC[1]] : [null, null];
  const newMistakes = prevC && curC ? curC.wrongSet.filter(w => !prevC.wrongSet.includes(w)) : [];
  const fixed = prevC && curC ? prevC.wrongSet.filter(w => !curC.wrongSet.includes(w)) : [];

  const emit = (intent: Parameters<typeof bus.emit>[0]['intent'], value?: string, source: Parameters<typeof bus.emit>[0]['source'] = 'mouse') =>
    bus.emit({ scene: 'chinese-recite', source, intent, phase: 'end', value });

  const startRecite = () => {
    heardRef.current = []; setTranscript(''); setResult(null); setListening(true);
    notify(`背诵开始——对麦克风背诵《${poem.title}》，完成后点“结束背诵”。（需已开启语音命令）`);
  };
  const endRecite = () => {
    setListening(false);
    const units = alignTexts(poemText(poem), heardRef.current.join(''));
    const s = score(units);
    setResult({ units, completeness: s.completeness, title: poem.title, wrongSet: [...new Set([...s.wrong.map(w => w[0] ?? ''), ...s.missing])] });
    emit('point', `completeness:${s.completeness.toFixed(2)}`, 'voice');
    notify(`《${poem.title}》完整度 ${Math.round(s.completeness * 100)}%——不匹配的字可能同音，请对照原文核对。`);
  };

  // 听写模式：TTS 读上句（期间暂停识别防回听）→ 学生接下句 → 即时判句 → 下一联。
  const startDictation = () => {
    heardRef.current = []; setTranscript(''); setResult(null); setAnswers([]);
    setDictIdx(0); setListening(true); setAwaiting(false);
    notify('听写开始——听上句，接下句。');
    window.setTimeout(() => promptCouplet(0), 400);
  };
  const promptCouplet = (idx: number) => {
    const sentence = POEMS[live.current.poemIndex].sentences[idx * 2];
    const ms = speak(`上句：${sentence}`);
    if (ms) pauseRecognition(ms + 800);
    setAwaiting(true);
  };

  // 场景级语音：聆听中把转写累加为背诵内容；听写模式逐句即时判句。
  useSceneVoicePolicy('chinese-recite', text => {
    if (!live.current.listening) return false;
    if (live.current.task === 'A' && live.current.awaiting) {
      const poem = POEMS[live.current.poemIndex];
      const expected = poem.sentences[live.current.dictIdx * 2 + 1];
      const s = score(alignTexts(expected, text));
      const ok = s.completeness >= 0.8;
      setAnswers(v => [...v, ok]);
      notify(ok ? `✓ 下句正确（完整度 ${Math.round(s.completeness * 100)}%）。` : `△ 下句完整度 ${Math.round(s.completeness * 100)}%——漏/错：${[...s.missing, ...s.wrong].slice(0, 4).join('、') || '（无）'}`);
      const next = live.current.dictIdx + 1;
      if (next * 2 < poem.sentences.length) { setDictIdx(next); setAwaiting(false); window.setTimeout(() => promptCouplet(next), 500); }
      else { setListening(false); setAwaiting(false); notify('听写完成！全部联已作答。'); }
      return true;
    }
    heardRef.current.push(text);
    setTranscript(heardRef.current.join(' '));
    return true;
  });

  useEffect(() => bus.subscribe(e => {
    lastActivity.current = Date.now();
    if (e.scene !== 'chinese-recite' && e.intent !== 'switch') return;
    if (e.intent === 'hint') setHint(v => Math.min(2, v + 1));
    if (e.intent === 'reset') {
      setListening(false); setAwaiting(false); setTranscript(''); setResult(null); setAnswers([]);
      setDictIdx(0); setExplanation(''); setCompleted(false); setHint(0); setStartedAt(Date.now());
    }
    if (e.intent === 'submit') { setCompleted(true); notify(`任务已完成，用时 ${Math.round((Date.now() - startedAt) / 1000)} 秒。`); }
  }), [task, startedAt, notify]);

  useEffect(() => {
    if (!active) { setStalled(false); return; }
    lastActivity.current = Date.now(); setStalled(false);
    const timer = setInterval(() => setStalled(Date.now() - lastActivity.current > 60000 && !completed), 5000);
    return () => clearInterval(timer);
  }, [active, completed]);

  useSceneSnapshot('chinese-recite', () => ({
    startedAt: new Date(startedAt).toISOString(), durationSeconds: Math.round((Date.now() - startedAt) / 1000),
    task, poem: poem.title, listening, transcriptChars: transcript.replace(/\s/g, '').length,
    completeness: result ? Number(result.completeness.toFixed(3)) : null,
    hints: hint, explanation, completed,
    quiz: task === 'A' ? { answers } : null,
    construct: task === 'B' ? { satisfied: bSatisfied } : null,
    compare: task === 'C' ? { saved: savedC.map(s => ({ title: s.title, completeness: Number(s.completeness.toFixed(2)) })), satisfied: cSatisfied } : null,
  }));

  const HINTS: Record<Task, string[]> = {
    free: ['先点“显示原文”读一遍，再隐藏背诵。', '背诵完点“结束背诵”，系统逐字对照标出问题。', '黄色=与原文不符（可能同音），灰色虚线=漏字。'],
    A: ['听完上句，接下一句；不记得就先看原文再继续。', '接句完整度 ≥80% 判为通过。', '联想画面：明月—霜—抬头—低头。'],
    B: ['放慢语速、咬字清楚，ASR 识别更准。', '漏句是最常见的失分——按联的顺序背。', '结束后看黄色和灰色虚线的字，重点记它们。'],
    C: ['第一次背完点“保存结果”，改一改再背一次保存第二次。', '对比会列出“新出现的错字”和“已改正的错字”。', '进步的证据比分数更有价值。'],
  };

  return <section className="panel" hidden={!active}>
    <div className="task-head">
      <div><div className="eyebrow">语文 · 古诗词</div><h2>古诗词背诵镜</h2></div>
      <button onClick={() => emit('reset')}>重置任务</button>
    </div>
    <div className="presets">
      <button className={task === 'free' ? 'selected' : ''} onClick={() => { setTask('free'); emit('reset'); }}>演示模式</button>
      <button className={task === 'A' ? 'selected' : ''} onClick={() => { setTask('A'); emit('reset'); }}>任务 A · 听写接句</button>
      <button className={task === 'B' ? 'selected' : ''} onClick={() => { setTask('B'); emit('reset'); }}>任务 B · 全文背诵</button>
      <button className={task === 'C' ? 'selected' : ''} onClick={() => { setTask('C'); emit('reset'); }}>任务 C · 错字对比</button>
    </div>
    <div className="task-card">{task === 'free' ? '选择篇目，点“开始背诵”对麦克风背诵，再点“结束背诵”——系统逐字对照原文，标出正确、不符（可能同音）、漏字与多字。'
      : task === 'A' ? '听写接句：系统读上句，你接下句，每句即时反馈。全部联完成即达成。'
      : task === 'B' ? `全文背诵《${poem.title}》，完整度 ≥90% 达成。完成后在③提交你的易错字反思。`
      : '背两次、存两次：对比两次的错字集合，看到“新出现的错字”与“已改正的错字”——进步的证据比分数更重要。'}</div>
    <div className="toolbar" style={{ marginTop: 12 }}>
      <span className="eyebrow" style={{ marginRight: 0 }}>篇目</span>
      <select aria-label="选择篇目" value={poemIndex} onChange={e => { setPoemIndex(Number(e.target.value)); setResult(null); setTranscript(''); heardRef.current = []; setListening(false); }}>
        {POEMS.map((p, i) => <option key={p.id} value={i}>{p.title} · {p.author}</option>)}
      </select>
      <button onClick={() => setShowText(v => !v)}>{showText ? '隐藏原文' : '显示原文'}</button>
      {task === 'A'
        ? <button onClick={startDictation}>{listening ? '重新开始听写' : '开始听写'}</button>
        : listening
          ? <button onClick={endRecite}>结束背诵</button>
          : <button onClick={startRecite}>开始背诵</button>}
      {(task === 'B' || task === 'C' || task === 'free') && result &&
        <button disabled={!result || savedC.length >= 2} onClick={() => { setSavedC(v => [...v, { title: result.title, completeness: result.completeness, wrongSet: result.wrongSet }].slice(-2)); notify('已保存本次结果。'); }}>保存本次结果（错字本 {savedC.length}/2）</button>}
      <span className="help">背诵需开启语音命令；识别不保存音频，仅转写文本进学习记录</span>
    </div>
    {showText && <div className="task-card"><b>{poem.title} · {poem.author}</b><br />{poem.sentences.join('')}</div>}
    <div className="panel" style={{ marginTop: 14 }}>
      <h3>{task === 'A' ? `听写进度（第 ${Math.min(dictIdx + 1, couplets)}/${couplets} 联）` : '你的背诵 → 逐字对照'}</h3>
      {task === 'A' && listening && <p className="help">上句：{poem.sentences[Math.min(dictIdx, couplets - 1) * 2]}　——请接下句</p>}
      {task === 'A' && answers.length > 0 && <p>{answers.map((ok, i) => <span key={i} className={ok ? 'ok' : ''}>{ok ? '✓' : '△'} </span>)}</p>}
      {result ? <>
        <div className="big-number" style={{ fontSize: 32 }}>{Math.round(result.completeness * 100)}<small>% 完整度</small></div>
        <p style={{ lineHeight: 2.4, fontSize: 18 }}>{result.units.map((u, i) =>
          <span key={i} className={`al-${u.status}`} title={STATUS_LABEL[u.status]}>{u.expected ?? u.heard}</span>)}</p>
        <p className="help">绿=正确；黄=与原文不符（可能同音，请人工核对）；灰色虚线=漏字；红=多字。</p>
      </> : <>
        <p style={{ minHeight: 40 }}>{transcript || '（还没开始。背诵动作为语音专属——请先在导航栏开启语音命令。）'}</p>
        <p className="help">ASR 的同音转写无法区分“读错”与“听错”，本实验为形成性工具：不匹配处请对照原文人工复核。</p>
      </>}
      {task === 'C' && savedC.length > 0 && <div style={{ marginTop: 10 }}>
        {savedC.map((s, i) => <p key={i} className="help">第{i + 1}次：《{s.title}》完整度 {Math.round(s.completeness * 100)}%，问题字 {s.wrongSet.length ? s.wrongSet.join('、') : '无'}</p>)}
        {cSatisfied && <p className="notice">新出现的错字：{newMistakes.length ? newMistakes.join('、') : '无'}；已改正：{fixed.length ? fixed.join('、') : '无'}</p>}
      </div>}
    </div>
    <aside className="side" style={{ marginTop: 16 }}>
      <div className="panel prediction">
        <h3>① {task === 'A' ? '听写状态' : task === 'B' ? '背诵判定' : task === 'C' ? '错字本' : '当前篇目'}</h3>
        {task === 'A' ? <>
          <p className="help">{listening ? (awaiting ? '请接下句……' : '准备中……') : '点“开始听写”。'}</p>
          <p className={answers.length === couplets && answers.every(Boolean) ? 'notice' : 'help'}>{answers.length === couplets ? `${answers.filter(Boolean).length}/${couplets} 联通过${answers.every(Boolean) ? ' ——✓ 达成！补充解释后提交。' : '，未全部通过——可重新开始听写。'}` : `共 ${couplets} 联。`}</p>
        </> : task === 'B' ? <>
          <p className={bSatisfied ? 'notice' : 'help'}>{bSatisfied ? `✓ 达成！《${poem.title}》完整度 ${Math.round((result?.completeness ?? 0) * 100)}%。补充易错字反思后提交。` : result ? `完整度 ${Math.round(result.completeness * 100)}%，未达 90%——对照③的问题字再背一次。` : '点“开始背诵”。'}</p>
        </> : task === 'C' ? <>
          <p className={cSatisfied ? 'notice' : 'help'}>{cSatisfied ? '✓ 两次结果已就绪！对照上方“新出现/已改正”，解释你的进步后提交。' : `已存 ${savedC.length}/2 次——背完一次点“保存本次结果”。`}</p>
        </> : <p>《{poem.title}》· {poem.author}，共 {poem.sentences.length} 句。自由背诵练习。</p>}
      </div>
      <div className="panel result">
        <h3>② 易错字</h3>
        {result ? (result.wrongSet.length
          ? <p>{result.wrongSet.join('、')}</p>
          : <p className="ok">本次没有漏字或不符的字。</p>)
          : <p className="help">背诵结束后，这里列出本次的问题字（漏字 + 不符），供重点记忆。</p>}
        <p className="help">对齐算法：编辑距离 + 回溯（经典 DP，确定性），见 recite 单元测试。</p>
      </div>
      <div className="panel hint">
        <h3>③ 提示与反思</h3>
        <button onClick={() => emit('hint')}>请求提示 {hint}/2</button>
        <p>{HINTS[task][Math.min(hint, 2)]}</p>
        {stalled && <p className="notice">已经停留超过 60 秒没有新操作。可以先自己再试一次，也可以点上面的“请求提示”。</p>}
        <textarea className="reflection" aria-label="背诵反思" rows={3} value={explanation}
          placeholder={task === 'A' ? '哪一句最容易接错？' : task === 'B' ? '你的易错字是哪些？怎么记？' : '两次对比，你发现了什么进步？'}
          onChange={e => setExplanation(e.target.value)} />
        {task !== 'free' && <button className="primary" disabled={!explanation.trim() || (task === 'A' ? !(answers.length === couplets && answers.every(Boolean)) : task === 'B' ? !bSatisfied : !cSatisfied) || completed} onClick={() => emit('submit', explanation)}>{completed ? '任务已完成 ✓' : '提交观察解释'}</button>}
      </div>
    </aside>
  </section>;
}
