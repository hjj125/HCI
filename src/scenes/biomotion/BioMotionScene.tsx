import { useEffect, useMemo, useRef, useState } from 'react';
import { bus } from '../../core/interaction';
import type { SceneProps } from '../types';
import { speak, useScenePolicy, useScenePosePolicy, useSceneSnapshot, useSceneVoicePolicy, useServices } from '../../core/services';
import { stabilize } from '../bodyangle/bodyAngle';
import { bestElbowAngle, flexState, musclePair, upperBodyVisible, BONES, POSE, type PosePoint } from './bioMotion';

type Task = 'free' | 'A' | 'B' | 'C';
type Reading = { landmarks: PosePoint[] | null; deg: number | null; side: 'left' | 'right' | null; framed: boolean };

/** 任务 A 选项（正确答案固定为第 0 项——教学事实）。 */
export const A_OPTIONS = [
  '肱二头肌收缩 · 肱三头肌舒张',
  '肱二头肌舒张 · 肱三头肌收缩',
  '两者都收缩',
  '两者都舒张',
];
const B_TARGET = 90;

/** 摄像头画面 + 骨架叠加：drawImage(video)（镜像）→ 骨线/关节 → 肘关节角度弧线与标注。 */
function PoseOverlay({ videoRef, landmarks, deg, side, showLabels, cameraOn }: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  landmarks: PosePoint[] | null; deg: number | null; side: 'left' | 'right' | null;
  showLabels: boolean; cameraOn: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const W = c.width, H = c.height;
    ctx.fillStyle = '#0c1727'; ctx.fillRect(0, 0, W, H);
    const v = videoRef.current;
    const hasFrame = cameraOn && v && v.readyState >= 2 && v.videoWidth > 0;
    // 等比 cover 映射：视频与关键点共用同一变换。
    const vw = hasFrame ? v!.videoWidth : 640, vh = hasFrame ? v!.videoHeight : 480;
    const s = Math.max(W / vw, H / vh);
    const dw = vw * s, dh = vh * s, ox = (W - dw) / 2, oy = (H - dh) / 2;
    if (hasFrame) {
      ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1);   // 镜像，与右下角预览一致
      ctx.drawImage(v!, ox, oy, dw, dh);
      ctx.restore();
      ctx.fillStyle = 'rgba(12,23,39,0.35)'; ctx.fillRect(0, 0, W, H);  // 压暗便于骨架可读
    }
    if (!landmarks) {
      ctx.fillStyle = '#7a8aa8'; ctx.font = '15px Inter, "Microsoft YaHei", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(cameraOn ? '请退后一些，让上半身完整入镜（头肩手臂）' : '启用摄像头手势后，这里会叠加显示你的骨架', W / 2, H / 2);
      ctx.textAlign = 'left';
      return;
    }
    const P = (i: number) => ({ x: ox + landmarks[i].x * dw, y: oy + landmarks[i].y * dh });
    // 骨线与关节。
    ctx.strokeStyle = '#38d8c1'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    for (const [a, b] of BONES) {
      if (landmarks[a].visibility < 0.4 || landmarks[b].visibility < 0.4) continue;
      const p = P(a), q = P(b);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    }
    ctx.fillStyle = '#8ff0dc';
    for (let i = 0; i < landmarks.length; i++) {
      if (landmarks[i].visibility < 0.4) continue;
      const p = P(i);
      ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.lineWidth = 1;
    // 肘关节角度弧线与标注。
    const elbowIdx = side === 'left' ? POSE.LEFT_ELBOW : POSE.RIGHT_ELBOW;
    const shoulderIdx = side === 'left' ? POSE.LEFT_SHOULDER : POSE.RIGHT_SHOULDER;
    const wristIdx = side === 'left' ? POSE.LEFT_WRIST : POSE.RIGHT_WRIST;
    if (deg != null && side) {
      const e = P(elbowIdx), sh = P(shoulderIdx), wr = P(wristIdx);
      const a1 = Math.atan2(sh.y - e.y, sh.x - e.x), a2 = Math.atan2(wr.y - e.y, wr.x - e.x);
      ctx.strokeStyle = '#f4c784'; ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(e.x, e.y, 44, Math.min(a1, a2), Math.max(a1, a2) > Math.min(a1, a2) + Math.PI ? Math.max(a1, a2) - Math.PI * 2 : Math.max(a1, a2));
      ctx.stroke(); ctx.lineWidth = 1;
      ctx.fillStyle = '#f4c784'; ctx.font = '600 22px Inter, "Microsoft YaHei", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`肘关节 ≈ ${deg.toFixed(0)}°`, e.x, e.y - 62);
    }
    if (showLabels) {
      ctx.font = '13px Inter, "Microsoft YaHei", sans-serif';
      const labels: [number, string][] = [[POSE.LEFT_SHOULDER, '肩关节'], [POSE.RIGHT_SHOULDER, '肩关节'], [POSE.LEFT_ELBOW, '肘关节'], [POSE.RIGHT_ELBOW, '肘关节'], [POSE.LEFT_WRIST, '腕'], [POSE.RIGHT_WRIST, '腕']];
      for (const [i, text] of labels) {
        if (landmarks[i].visibility < 0.5) continue;
        const p = P(i);
        ctx.fillStyle = 'rgba(9,18,32,.85)'; ctx.fillRect(p.x + 8, p.y - 20, 62, 20);
        ctx.fillStyle = '#b9d4f0'; ctx.fillText(text, p.x + 12, p.y - 6);
      }
    }
    ctx.textAlign = 'left';
  }, [landmarks, deg, side, showLabels, cameraOn, videoRef]);
  return <canvas ref={ref} width={960} height={540} aria-label="姿态叠加视图" />;
}

/** 肌肉收缩强度条。 */
function MuscleMeter({ name, intensity }: { name: string; intensity: number }) {
  const state = intensity > 0.5 ? '收缩' : '舒张';
  return <div>
    <p className="help" style={{ marginBottom: 4 }}>{name}：{state}（{Math.round(intensity * 100)}%）</p>
    <div className="muscle-meter"><i style={{ width: `${Math.round(intensity * 100)}%`, background: intensity > 0.5 ? '#29b99f' : '#31465f' }} /></div>
  </div>;
}

/** 生物实验一 · 运动系统：骨架叠加摄像头，探究关节与骨骼肌协作（屈肘/伸肘）。 */
export function BioMotionScene({ active }: SceneProps) {
  const { notify, pauseRecognition, handVideo } = useServices();
  const [task, setTask] = useState<Task>('free');
  const [reading, setReading] = useState<Reading>({ landmarks: null, deg: null, side: null, framed: false });
  const [lockedDeg, setLockedDeg] = useState<number | null>(null);
  const [showLabels, setShowLabels] = useState(false);
  const [aIndex, setAIndex] = useState(0);
  const [pred, setPred] = useState<'' | number>('');
  const [verdictA, setVerdictA] = useState<null | boolean>(null);
  const [savedC, setSavedC] = useState<{ state: string; deg: number; biceps: number; triceps: number }[]>([]);
  const [explanation, setExplanation] = useState('');
  const [completed, setCompleted] = useState(false);
  const [hint, setHint] = useState(0);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [stalled, setStalled] = useState(false);
  const lastActivity = useRef(Date.now());
  const hist = useRef<number[]>([]);
  const videoRef = handVideo;   // 共享 App 的摄像头画面（手部与姿态识别同源）
  const deg = lockedDeg ?? reading.deg;
  const flex = deg != null ? flexState(deg) : null;
  const muscles = deg != null ? musclePair(deg) : null;
  const bSatisfied = lockedDeg != null && Math.abs(lockedDeg - B_TARGET) <= 10;
  const cSatisfied = savedC.some(s => s.state === '屈肘') && savedC.some(s => s.state === '伸肘');
  const cameraOn = videoRef.current != null && videoRef.current.readyState >= 2;

  const emit = (intent: Parameters<typeof bus.emit>[0]['intent'], value?: string, source: Parameters<typeof bus.emit>[0]['source'] = 'mouse') =>
    bus.emit({ scene: 'bio-motion', source, intent, phase: 'end', value });

  const toggleLock = () => {
    setLockedDeg(v => {
      if (v != null) { notify('已解锁，恢复实时读数。'); return null; }
      const stable = stabilize(hist.current, 4);
      if (stable == null && reading.deg == null) { notify('还没有读数——让上半身入镜并弯曲手臂。'); return null; }
      const value = stable ?? reading.deg!;
      notify(`已锁定肘关节读数：${value.toFixed(1)}°（${flexState(value)}）`);
      return Number(value.toFixed(1));
    });
  };

  // 姿态策略：肘角 + 取景判定（30Hz）。
  const poseHist = useRef<number[]>([]);
  useScenePosePolicy('bio-motion', sample => {
    const best = bestElbowAngle(sample.landmarks);
    const framed = upperBodyVisible(sample.landmarks);
    setReading({ landmarks: sample.landmarks, deg: best?.deg ?? null, side: best?.side ?? null, framed });
    if (best != null) { hist.current.push(best.deg); if (hist.current.length > 30) hist.current.shift(); }
  });

  // 手势：指向画布捏合一下（几乎未移动）= 锁定/解锁，与量角器一致。
  const pinchAnchor = useRef<{ x: number; y: number } | null>(null);
  useScenePolicy('bio-motion', sample => {
    if (sample.phase === 'cancel') { pinchAnchor.current = null; return; }
    if (sample.phase === 'start') { pinchAnchor.current = { x: sample.x, y: sample.y }; return; }
    if (sample.phase === 'end') {
      if (pinchAnchor.current && Math.hypot(sample.x - pinchAnchor.current.x, sample.y - pinchAnchor.current.y) < 0.05) toggleLock();
      pinchAnchor.current = null;
    }
  });

  // 场景级语音：读数/锁定/解锁。
  useSceneVoicePolicy('bio-motion', text => {
    const t = text.replace(/\s/g, '');
    if (t.includes('解锁')) { setLockedDeg(null); notify('语音 · 已解锁'); return true; }
    if (t.includes('锁定')) { toggleLock(); return true; }
    if (t.includes('读数') || t.includes('什么状态')) {
      if (deg == null) { notify('还没有读数。'); return true; }
      const ms = speak(`肘关节约 ${Math.round(deg)} 度，${flexState(deg)}，${muscles!.note}`);
      if (ms) pauseRecognition(ms + 800);
      return true;
    }
    return false;
  });

  useEffect(() => bus.subscribe(e => {
    lastActivity.current = Date.now();
    if (e.scene !== 'bio-motion' && e.intent !== 'switch') return;
    if (e.intent === 'hint') setHint(v => Math.min(2, v + 1));
    if (e.intent === 'reset') {
      setPred(''); setVerdictA(null); setSavedC([]); setLockedDeg(null);
      setExplanation(''); setCompleted(false); setHint(0); setStartedAt(Date.now());
    }
    if (e.intent === 'predict' && task === 'A') {
      const ok = pred === 0;   // 教学事实：屈肘 = 二头收缩、三头舒张
      setVerdictA(ok);
      notify(ok ? '✓ 正确！屈肘时肱二头肌收缩、肱三头肌舒张。现在现场屈肘，看②的肌肉仪表验证。' : '✗ 屈肘时是「肱二头肌收缩 · 肱三头肌舒张」——现场屈肘看②的仪表验证。');
    }
    if (e.intent === 'submit') { setCompleted(true); notify(`任务已完成，用时 ${Math.round((Date.now() - startedAt) / 1000)} 秒。`); }
  }), [task, pred, startedAt, notify]);

  useEffect(() => {
    if (!active) { setStalled(false); return; }
    lastActivity.current = Date.now(); setStalled(false);
    const timer = setInterval(() => setStalled(Date.now() - lastActivity.current > 60000 && !completed), 5000);
    return () => clearInterval(timer);
  }, [active, completed]);

  useSceneSnapshot('bio-motion', () => ({
    startedAt: new Date(startedAt).toISOString(), durationSeconds: Math.round((Date.now() - startedAt) / 1000),
    task, elbowDegree: deg != null ? Number(deg.toFixed(1)) : null, lockedDegree: lockedDeg,
    flexState: flex, muscles: muscles ? { biceps: Number(muscles.biceps.toFixed(2)), triceps: Number(muscles.triceps.toFixed(2)) } : null,
    hints: hint, explanation, completed,
    quiz: task === 'A' ? { prediction: pred === '' ? null : A_OPTIONS[pred as number], correct: verdictA } : null,
    construct: task === 'B' ? { target: B_TARGET, satisfied: bSatisfied } : null,
    compare: task === 'C' ? { saved: savedC.map(s => ({ state: s.state, degree: Number(s.deg.toFixed(1)) })), satisfied: cSatisfied } : null,
  }));

  const HINTS: Record<Task, string[]> = {
    free: ['站远一点让上半身入镜，弯曲手臂看肘关节角度与肌肉条变化。', '指向画布捏合一下可锁定读数。', '伸直手臂再慢慢弯——注意两条肌肉条是互补的。'],
    A: ['想想掰手腕：谁在用力？', '骨骼肌只能牵拉骨、不能推开骨——所以每个动作都需要配对肌群。', '提交后现场屈肘，看仪表验证。'],
    B: ['大臂贴紧身体不动，只动小臂。', '手稳定后捏合一下锁定（±10° 内达成）。', '90° 时前臂与地面平行。'],
    C: ['先屈肘锁定并保存，再伸直手臂锁定并保存。', '对比两根肌肉条：一个动作里总是一收一舒。', '想想：如果只有一组肌肉，手臂能完成屈和伸吗？'],
  };

  return <section className="panel" hidden={!active}>
    <div className="task-head">
      <div><div className="eyebrow">生物 · 运动系统</div><h2>关节与骨骼肌</h2></div>
      <button onClick={() => emit('reset')}>重置任务</button>
    </div>
    <div className="presets">
      <button className={task === 'free' ? 'selected' : ''} onClick={() => { setTask('free'); emit('reset'); }}>演示模式</button>
      <button className={task === 'A' ? 'selected' : ''} onClick={() => { setTask('A'); emit('reset'); setAIndex(0); }}>任务 A · 肌肉协作预测</button>
      <button className={task === 'B' ? 'selected' : ''} onClick={() => { setTask('B'); emit('reset'); }}>任务 B · 屈肘 90°</button>
      <button className={task === 'C' ? 'selected' : ''} onClick={() => { setTask('C'); emit('reset'); }}>任务 C · 屈伸对比</button>
    </div>
    <div className="task-card">{task === 'free' ? '站远一点让上半身入镜：你的骨架会实时叠加在摄像头画面上。弯曲手臂，观察肘关节角度与肱二头肌/肱三头肌的收缩状态——一个动作里它们总是"一收一舒"。'
      : task === 'A' ? '预测：屈肘时，肱二头肌与肱三头肌各是什么状态？提交后现场屈肘，用肌肉仪表验证。'
      : task === 'B' ? '目标：屈肘到 90°（±10°）——大臂贴紧身体，小臂抬至与地面平行，稳定后锁定读数。'
      : '分别把「屈肘」和「伸肘」锁定并保存快照，对比两次的肌肉仪表，解释为什么需要两组肌肉协作。'}</div>
    <div className="toolbar" style={{ marginTop: 12 }}>
      <button onClick={toggleLock}>{lockedDeg != null ? '解锁读数' : '锁定读数'}</button>
      <label className="small"><input type="checkbox" checked={showLabels} onChange={e => setShowLabels(e.target.checked)} /> 关节标注</label>
      {task === 'C' && <button disabled={lockedDeg == null || savedC.length >= 2} onClick={() => { if (deg != null && flex) { const state = flex; const m = musclePair(deg); setSavedC(v => [...v.filter(x => x.state !== state), { state, deg, biceps: m.biceps, triceps: m.triceps }].slice(-2)); notify(`已保存${state}快照。`); } }}>保存当前状态快照</button>}
      <span className="help">{reading.landmarks && !reading.framed ? '取景不完整：' : '骨架为本地实时推理，'}不录制、不保存画面</span>
    </div>
    <div className="fn-host">
      <PoseOverlay videoRef={videoRef} landmarks={reading.landmarks} deg={deg} side={reading.side} showLabels={showLabels} cameraOn={cameraOn} />
    </div>
    <aside className="side" style={{ marginTop: 16 }}>
      <div className="panel prediction">
        <h3>① {task === 'A' ? '肌肉协作预测' : task === 'B' ? '屈肘 90°' : task === 'C' ? '屈伸对比' : '实时读数'}</h3>
        {task === 'A' ? <>
          <p className="help">屈肘时，肱二头肌与肱三头肌的状态是？</p>
          <div className="chips" style={{ gridTemplateColumns: '1fr' }}>
            {A_OPTIONS.map((opt, i) => <button key={i} disabled={!!verdictA} className={pred === i ? 'selected' : ''} onClick={() => setPred(i)}>{opt}</button>)}
          </div>
          <button className="primary" disabled={pred === '' || !!verdictA} onClick={() => emit('predict')}>提交预测</button>
          {verdictA !== null && <p className="notice">{verdictA ? '✓ 正确！现场屈肘，看②的肌肉仪表验证。' : '✗ 正确答案是「肱二头肌收缩 · 肱三头肌舒张」——现场屈肘验证。'}</p>}
        </> : task === 'B' ? <>
          <p>目标：肘关节 <b>{B_TARGET}°</b>（±10°）</p>
          <p className={bSatisfied ? 'notice' : 'help'}>{bSatisfied ? `✓ 达成！锁定读数 ${lockedDeg?.toFixed(1)}°。补充解释后提交。` : lockedDeg != null ? `锁定 ${lockedDeg?.toFixed(1)}°，还差 ${Math.abs(lockedDeg - B_TARGET).toFixed(1)}°——解锁微调再试。` : '摆好动作后点“锁定读数”。'}</p>
        </> : task === 'C' ? <>
          {savedC.length === 0 && <p className="help">还没有快照。先屈肘锁定并保存。</p>}
          {savedC.map((s, i) => <p key={i} className="help">{s.state}（{s.deg.toFixed(0)}°）：二头 {Math.round(s.biceps * 100)}% / 三头 {Math.round(s.triceps * 100)}%</p>)}
          {cSatisfied && <p className="notice">✓ 屈/伸两态已就绪！对比肌肉条，解释为什么要两组肌肉协作。</p>}
        </> : <p>{deg != null ? `肘关节 ${deg.toFixed(1)}°（${flex}）${lockedDeg != null ? ' · 已锁定' : ''}` : '等待入镜……'}</p>}
      </div>
      <div className="panel result">
        <h3>② 骨骼肌协作</h3>
        {muscles ? <>
          <MuscleMeter name="肱二头肌" intensity={muscles.biceps} />
          <div style={{ height: 10 }} />
          <MuscleMeter name="肱三头肌" intensity={muscles.triceps} />
          <p className="notice" style={{ marginTop: 12 }}>{muscles.note}。</p>
        </> : <p className="help">入镜后这里实时显示两块肌肉的收缩强度。骨骼肌只能牵拉骨、不能推开骨——屈伸动作靠两组肌肉"一收一舒"完成。</p>}
        <p className="help">关节角度与肌肉强度为确定性计算（教学模型），见 bioMotion 单元测试。</p>
      </div>
      <div className="panel hint">
        <h3>③ 提示与反思</h3>
        <button onClick={() => emit('hint')}>请求提示 {hint}/2</button>
        <p>{HINTS[task][Math.min(hint, 2)]}</p>
        {stalled && <p className="notice">已经停留超过 60 秒没有新操作。可以先自己再试一次，也可以点上面的“请求提示”。</p>}
        <textarea className="reflection" aria-label="运动系统观察解释" rows={3} value={explanation}
          placeholder={task === 'A' ? '屈肘时谁收缩、谁舒张？为什么？' : task === 'B' ? '你是如何控制肘关节角度的？' : '两组肌肉为什么要协作？'}
          onChange={e => setExplanation(e.target.value)} />
        {task !== 'free' && <button className="primary" disabled={!explanation.trim() || (task === 'A' ? !verdictA : task === 'B' ? !bSatisfied : !cSatisfied) || completed} onClick={() => emit('submit', explanation)}>{completed ? '任务已完成 ✓' : '提交观察解释'}</button>}
      </div>
    </aside>
  </section>;
}
