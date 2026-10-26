import { useEffect, useMemo, useRef, useState } from 'react';
import { bus } from '../../core/interaction';
import type { SceneProps } from '../types';
import { speak, useScenePolicy, useSceneSnapshot, useSceneVoicePolicy, useServices } from '../../core/services';
import { SwipeDetector } from '../slides/pptGesture';
import { PotteryView, type PotteryHandle } from './PotteryView';
import {
  BASE_CLAY, classifyShape, clipProfile, coverageRatio, defaultProfile, pinchProfile, potMetrics, scaleRadius,
  smoothProfile, stretchProfile, strokeSegments, symmetricStamps,
  type Profile, type TexPoint,
} from './pottery';

type Task = 'free' | 'A' | 'B' | 'C';
type Mode = 'throw' | 'paint';

export const GLAZES: { name: string; rgb: string }[] = [
  { name: '青花', rgb: '#1e4b8f' }, { name: '釉里红', rgb: '#a0342c' }, { name: '豆青', rgb: '#7a9a7e' },
  { name: '赭石', rgb: '#8c5a2b' }, { name: '天青', rgb: '#7fb3c8' }, { name: '钴蓝', rgb: '#2b3f8c' },
  { name: '姜黄', rgb: '#c8912e' }, { name: '黑釉', rgb: '#1c1c22' }, { name: '珊瑚', rgb: '#d4674f' },
  { name: '白釉', rgb: '#e8e2d4' },
];
const BRUSH_PX = [10, 18, 30];
export const B_TARGETS: { zh: string; check: (m: ReturnType<typeof potMetrics>) => boolean }[] = [
  { zh: '高瘦的瓶', check: m => m.aspect >= 1.4 },
  { zh: '宽扁的碗', check: m => m.aspect <= 0.85 && m.maxRy <= 0.45 },
];
const TEX_W = 1024, TEX_H = 512;
/** 任务 A 选项（正确答案固定为第 0 项——真实拉坯规律：向上提拉，器壁变高变薄）。 */
export const A_OPTIONS = ['变高变薄', '变矮变厚', '基本不变'];

/** 侧栏轮廓编辑器：陶坯侧影 + 可拖控制点（鼠标完整备用路径）。 */
function ProfileEditor({ profile, onChange }: { profile: Profile; onChange: (p: Profile) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<number | null>(null);
  const W = 220, H = 170, cx = W / 2, rScale = 82, hTop = 12, hScale = 138;
  const ptXY = (p: { y: number; r: number }) => ({ x: cx + p.r * rScale, y: H - hTop - p.y * hScale });
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    ctx.fillStyle = '#0c1727'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#182740'; ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
    // 轮盘基线
    ctx.strokeStyle = '#26394f'; ctx.beginPath(); ctx.moveTo(20, H - 14); ctx.lineTo(W - 20, H - 14); ctx.stroke();
    const sorted = [...profile].sort((a, b) => a.y - b.y);
    // 陶坯侧影：填充陶土色，一眼读出"这是个器物"
    ctx.fillStyle = '#c9a986'; ctx.beginPath();
    sorted.forEach((p, i) => { const q = ptXY(p); if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); });
    for (let i = sorted.length - 1; i >= 0; i--) { const q = ptXY({ ...sorted[i], r: -sorted[i].r }); ctx.lineTo(q.x, q.y); }
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#8a6b4a'; ctx.lineWidth = 2; ctx.stroke(); ctx.lineWidth = 1;
    ctx.fillStyle = '#f4c784';
    for (const p of sorted) { const q = ptXY(p); ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, Math.PI * 2); ctx.fill(); }
  }, [profile]);
  const nearest = (x: number, y: number): number | null => {
    let best: number | null = null, bestD = 18;
    profile.forEach((p, i) => {
      const q = ptXY(p);
      const d = Math.hypot(q.x - x, q.y - y);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  };
  const local = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
  };
  return <canvas ref={ref} width={W} height={H} className="profile-editor" aria-label="轮廓编辑器"
    onPointerDown={e => { const p = local(e); drag.current = nearest(p.x, p.y); }}
    onPointerMove={e => {
      const i = drag.current; if (i == null) return;
      const p = local(e);
      const next = profile.map((q, k) => k === i ? {
        y: Math.max(0.02, Math.min(1.2, (H - hTop - p.y) / hScale)),
        r: Math.max(0.05, Math.min(1, Math.abs(p.x - cx) / rScale)),
      } : q);
      onChange(next);
    }}
    onPointerUp={() => { if (drag.current != null) onChange([...profile].sort((a, b) => a.y - b.y)); drag.current = null; }}
    onPointerCancel={() => { drag.current = null; }} />;
}

/** 美术实验一 · 陶艺工坊：手势拉坯塑形 + 对称纹样彩绘（虚拟陶轮）。 */
export function PotteryScene({ active }: SceneProps) {
  const { notify, pauseRecognition } = useServices();
  const [task, setTask] = useState<Task>('free');
  const [mode, setMode] = useState<Mode>('throw');
  const [profile, setProfile] = useState<Profile>(defaultProfile);
  const [glazeIdx, setGlazeIdx] = useState(0);
  const [brush, setBrush] = useState<1 | 2 | 3>(2);
  const [symmetry, setSymmetry] = useState<1 | 2 | 4 | 8>(1);
  const [cutY, setCutY] = useState(0.7);
  const [coverage, setCoverage] = useState(0);
  const [usedGlazeCount, setUsedGlazeCount] = useState(0);
  const [symUsed, setSymUsed] = useState(1);
  const [aIndex, setAIndex] = useState(0);
  const [pred, setPred] = useState<'' | number>('');
  const [verdictA, setVerdictA] = useState<null | boolean>(null);
  const [bIndex, setBIndex] = useState(0);
  const [explanation, setExplanation] = useState('');
  const [completed, setCompleted] = useState(false);
  const [hint, setHint] = useState(0);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [stalled, setStalled] = useState(false);
  const lastActivity = useRef(Date.now());
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<PotteryHandle>(null);
  const tex = useRef<HTMLCanvasElement | null>(null);
  const paintVersion = useRef(0);
  const lastUV = useRef<TexPoint | null>(null);
  const usedGlazes = useRef(new Set<string>());
  const symUsedRef = useRef(1);
  const swipe = useRef(new SwipeDetector());
  const boost = useRef(0);
  const wheelSpeed = (mode === 'paint' ? 0.22 : 1.1) + boost.current;   // 彩绘慢轮上釉；挥手冲量衰减中
  const metrics = useMemo(() => potMetrics(profile), [profile]);
  const shape = useMemo(() => classifyShape(profile), [profile]);
  const bTarget = B_TARGETS[bIndex];
  const bSatisfied = bTarget.check(metrics);
  const cSatisfied = coverage >= 0.06 && usedGlazeCount >= 2 && symUsed >= 2;

  const emit = (intent: Parameters<typeof bus.emit>[0]['intent'], value?: string, source: Parameters<typeof bus.emit>[0]['source'] = 'mouse') =>
    bus.emit({ scene: 'art-pottery', source, intent, phase: 'end', value });

  // 素坯底色（纯色+陶土颗粒，颗粒偏差在覆盖率容差内）填充；创建纹理画布。
  useEffect(() => {
    const c = document.createElement('canvas');
    c.width = TEX_W; c.height = TEX_H;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.fillStyle = `rgb(${BASE_CLAY[0]},${BASE_CLAY[1]},${BASE_CLAY[2]})`;
      ctx.fillRect(0, 0, TEX_W, TEX_H);
      for (let i = 0; i < 900; i++) {   // 陶土颗粒
        const a = Math.round(Math.random() * 10 - 5);
        ctx.fillStyle = `rgba(${201 + a},${169 + a},${134 + a},0.55)`;
        ctx.beginPath(); ctx.arc(Math.random() * TEX_W, Math.random() * TEX_H, Math.random() * 1.6 + 0.4, 0, Math.PI * 2); ctx.fill();
      }
    }
    tex.current = c;
  }, []);

  const clearPaint = () => {
    const ctx = tex.current?.getContext('2d'); if (!ctx) return;
    ctx.fillStyle = `rgb(${BASE_CLAY[0]},${BASE_CLAY[1]},${BASE_CLAY[2]})`; ctx.fillRect(0, 0, TEX_W, TEX_H);
    paintVersion.current++; setPaintV(v => v + 1); setCoverage(0); usedGlazes.current.clear(); setUsedGlazeCount(0);
    notify('彩绘已清除，回到素坯。');
  };

  const stampAt = (uv: TexPoint) => {
    const ctx = tex.current?.getContext('2d'); if (!ctx) return;
    const glaze = GLAZES[glazeIdx];
    ctx.fillStyle = glaze.rgb;
    const radius = BRUSH_PX[brush - 1];
    const stamps = symmetricStamps([uv], symmetry);
    for (const s of stamps) {
      ctx.beginPath(); ctx.arc(s.u * TEX_W, (1 - s.v) * TEX_H, radius, 0, Math.PI * 2); ctx.fill();
    }
    usedGlazes.current.add(glaze.name); setUsedGlazeCount(usedGlazes.current.size);
    symUsedRef.current = Math.max(symUsedRef.current, symmetry); setSymUsed(symUsedRef.current);
    paintVersion.current++; setPaintV(v => v + 1);
  };
  const [paintV, setPaintV] = useState(0);

  const endStroke = () => {
    lastUV.current = null;
    const ctx = tex.current?.getContext('2d');
    if (ctx) setCoverage(coverageRatio(ctx.getImageData(0, 0, TEX_W, TEX_H).data, BASE_CLAY));
  };

  // 手势与鼠标：拉坯（双层）与彩绘统一入口。
  const anchors = useRef<{ d0: number; y0: number; profile: Profile } | null>(null);
  const pinchLastX = useRef<number | null>(null);
  const applyThrow = (sampleX: number, sampleY: number, hands: { x: number; y: number }[] | undefined, start: boolean) => {
    if (start) {
      if (hands && hands.length >= 2) {
        const d = Math.hypot(hands[0].x - hands[1].x, hands[0].y - hands[1].y);
        anchors.current = { d0: d, y0: (hands[0].y + hands[1].y) / 2, profile };
        pinchLastX.current = null;
      } else {
        anchors.current = null;
        pinchLastX.current = sampleX;
      }
      return;
    }
    if (hands && hands.length >= 2 && anchors.current) {
      // 双手整体变形：同向上下=拉长/压缩（从锚点快照出发，避免增量漂移）。
      const d = Math.hypot(hands[0].x - hands[1].x, hands[0].y - hands[1].y);
      const avgY = (hands[0].y + hands[1].y) / 2;
      const base = anchors.current.profile;
      let next = stretchProfile(base, Math.max(0.5, Math.min(1.5, 1 + (anchors.current.y0 - avgY) * 2.2)));
      next = scaleRadius(next, Math.max(0.45, Math.min(1.6, 1 + (d - anchors.current.d0) * 2.6)));
      setProfile(smoothProfile(next, 1));
      return;
    }
    if (pinchLastX.current != null) {
      // 捏泥式：手指"碰哪捏哪"——raycast 命中陶坯取作用高度与内外侧；手在坯附近但没碰到泥时用代理柱，离坯太远退回屏幕映射。
      const hit = view.current?.pick(sampleX, sampleY);
      const yA = Math.max(0.05, Math.min(1.15, hit ? hit.py : 1.1 - sampleY * 1.1));
      const dirSign = hit ? hit.dirSign : (sampleX < 0.5 ? -1 : 1);
      const dx = sampleX - pinchLastX.current;
      pinchLastX.current = sampleX;
      if (Math.abs(dx) > 0.0005) setProfile(p => smoothProfile(pinchProfile(p, yA, dx * dirSign * 1.6), 1));
    }
  };

  const paintAt = (nx: number, ny: number, isStart: boolean) => {
    const hit = view.current?.pick(nx, ny);
    if (!hit || !hit.onClay) { lastUV.current = null; return; }   // 没碰到泥不落笔
    if (isStart || !lastUV.current) { lastUV.current = hit; stampAt(hit); return; }
    const stamps = strokeSegments(lastUV.current, hit, BRUSH_PX[brush - 1] / (TEX_W * 0.5));
    for (const s of symmetricStamps(stamps, symmetry)) {
      const ctx = tex.current?.getContext('2d'); if (!ctx) return;
      ctx.fillStyle = GLAZES[glazeIdx].rgb;
      ctx.beginPath(); ctx.arc(s.u * TEX_W, (1 - s.v) * TEX_H, BRUSH_PX[brush - 1], 0, Math.PI * 2); ctx.fill();
    }
    usedGlazes.current.add(GLAZES[glazeIdx].name); setUsedGlazeCount(usedGlazes.current.size);
    symUsedRef.current = Math.max(symUsedRef.current, symmetry); setSymUsed(symUsedRef.current);
    lastUV.current = hit;
    paintVersion.current++; setPaintV(v => v + 1);
  };

  const canvasPos = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  // 手势策略：彩绘=捏合落笔移动；拉坯=双手整体变形，单手捏泥；挥手=转轮加速。
  useScenePolicy('art-pottery', sample => {
    lastActivity.current = Date.now();
    if (sample.phase === 'cancel') { anchors.current = null; lastUV.current = null; swipe.current.reset(); return; }
    const inCanvas = true; // 画布占主区，采样统一进入；误触由阈值与模式门控约束
    void inCanvas;
    if (mode === 'paint') {
      if (sample.phase === 'start') { const r = host.current?.getBoundingClientRect(); if (r) paintAt((sample.x * window.innerWidth - r.left) / r.width, (sample.y * window.innerHeight - r.top) / r.height, true); return; }
      if (sample.phase === 'update' && sample.pinching && lastUV.current) { const r = host.current?.getBoundingClientRect(); if (r) paintAt((sample.x * window.innerWidth - r.left) / r.width, (sample.y * window.innerHeight - r.top) / r.height, false); return; }
      if (sample.phase === 'end') { endStroke(); return; }
    }
    if (mode === 'throw') {
      if (sample.phase === 'start' && sample.pinching) { applyThrow(sample.x, sample.y, sample.hands, true); return; }
      if (sample.phase === 'update' && sample.pinching) { applyThrow(sample.x, sample.y, sample.hands, false); return; }
      if (sample.phase === 'end') { anchors.current = null; setProfile(p => smoothProfile(p, 1)); return; }
    }
    if (!sample.pinching) {
      const dir = swipe.current.push(sample.x, sample.y, performance.now(), { pinching: false });
      if (dir) { boost.current = Math.min(2.4, boost.current + 0.7); notify('挥手 · 陶轮加速'); }
    } else swipe.current.reset();
  });

  // 转速冲量衰减。
  useEffect(() => {
    const timer = setInterval(() => {
      if (boost.current > 0.01) { boost.current *= 0.96; setWheelTick(v => v + 1); }
    }, 120);
    return () => clearInterval(timer);
  }, []);
  const [, setWheelTick] = useState(0);

  // 场景级语音：整体变形口令、模式与釉色。
  useSceneVoicePolicy('art-pottery', text => {
    const t = text.replace(/\s/g, '');
    const act = (msg: string, fn: () => void) => { fn(); notify(`语音 · ${msg}`); return true; };
    if (t.includes('拉长') || t.includes('变高')) return act('拉长', () => setProfile(p => smoothProfile(stretchProfile(p, 1.12), 1)));
    if (t.includes('压缩') || t.includes('变矮')) return act('压缩', () => setProfile(p => smoothProfile(stretchProfile(p, 0.89), 1)));
    if (t.includes('变胖') || t.includes('变粗')) return act('变胖', () => setProfile(p => smoothProfile(scaleRadius(p, 1.12), 1)));
    if (t.includes('变瘦') || t.includes('变细')) return act('变瘦', () => setProfile(p => smoothProfile(scaleRadius(p, 0.89), 1)));
    if (t.includes('清除彩绘')) return act('清除彩绘', clearPaint);
    if (t.includes('彩绘') || t.includes('上釉')) { setMode('paint'); return act('切换到彩绘', () => { }); }
    if (t.includes('拉坯') || t.includes('塑形')) { setMode('throw'); return act('切换到拉坯', () => { }); }
    const glaze = GLAZES.find(g => t.includes(g.name));
    if (glaze) { setGlazeIdx(GLAZES.indexOf(glaze)); return act(`已选${glaze.name}釉`, () => { }); }
    return false;
  });

  useEffect(() => bus.subscribe(e => {
    lastActivity.current = Date.now();
    if (e.scene !== 'art-pottery' && e.intent !== 'switch') return;
    if (e.intent === 'hint') setHint(v => Math.min(2, v + 1));
    if (e.intent === 'reset') {
      setProfile(defaultProfile()); setPred(''); setVerdictA(null); setExplanation(''); setCompleted(false); setHint(0); setStartedAt(Date.now());
    }
    if (e.intent === 'predict' && task === 'A') {
      const ok = pred === 0;   // 真实拉坯规律：向上提拉 → 器壁变高变薄
      setVerdictA(ok);
      notify(ok ? '✓ 正确！向上提拉会让器壁变高、变薄。现场试一试验证。' : '✗ 实际是「变高变薄」——泥料体积不变，拉高必然变薄。现场试一试。');
    }
    if (e.intent === 'submit') { setCompleted(true); notify(`任务已完成，用时 ${Math.round((Date.now() - startedAt) / 1000)} 秒。`); }
  }), [task, pred, startedAt, notify]);

  useEffect(() => {
    if (!active) { setStalled(false); return; }
    lastActivity.current = Date.now(); setStalled(false);
    const timer = setInterval(() => setStalled(Date.now() - lastActivity.current > 60000 && !completed), 5000);
    return () => clearInterval(timer);
  }, [active, completed]);

  useSceneSnapshot('art-pottery', () => ({
    startedAt: new Date(startedAt).toISOString(), durationSeconds: Math.round((Date.now() - startedAt) / 1000),
    task, mode,
    profile: profile.map(p => ({ y: Number(p.y.toFixed(2)), r: Number(p.r.toFixed(2)) })),
    metrics: { height: Number(metrics.height.toFixed(2)), maxR: Number(metrics.maxR.toFixed(2)), aspect: Number(metrics.aspect.toFixed(2)) },
    shape, glaze: GLAZES[glazeIdx].name, symmetry, coverage: Number(coverage.toFixed(3)), usedGlazeCount,
    hints: hint, explanation, completed,
    quiz: task === 'A' ? { prediction: pred === '' ? null : A_OPTIONS[pred as number], correct: verdictA } : null,
    construct: task === 'B' ? { target: bTarget.zh, satisfied: bSatisfied } : null,
    compare: task === 'C' ? { coverage: Number(coverage.toFixed(3)), usedGlazeCount, symmetryUsed: symUsed, satisfied: cSatisfied } : null,
  }));

/** 任务 A 选项（正确答案固定为第 0 项——真实拉坯规律）。 */
  const downloadBlob = (blob: Blob, name: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const exportPhoto = () => {
    const url = view.current?.snapshot();
    if (!url) { notify('视图未就绪。'); return; }
    const a = document.createElement('a'); a.href = url; a.download = '陶艺作品.png'; a.click();
    notify('作品照片已导出（PNG）。');
  };
  const exportModel = () => {
    view.current?.exportGLB().then(blob => { downloadBlob(blob, '陶艺作品.glb'); notify('3D 模型已导出（GLB，含彩绘贴图）。'); })
      .catch(() => notify('3D 模型导出失败——请确认三维视图已加载。'));
  };

  const HINTS: Record<Task, string[]> = {
    free: ['单手捏合后左右移动=在对应高度收放器壁；双手捏合同向上下=拉长/压缩。', '切换到彩绘模式，捏合落笔在陶坯上上釉。', '挥手可以让陶轮加速。'],
    A: ['泥料总量不变：拉高时泥去哪里了？', '观察真实拉坯视频：向上提拉时器壁越来越薄。', '提交后现场用双手向上提验证。'],
    B: ['瓶 = 明显瘦高；碗 = 宽扁且最宽处靠下。', '双手捏合同向向上提可以快速拉高。', '看①的长宽比读数，接近目标即可（不用精确）。'],
    C: ['先在工具栏选一种对称（如 4 重），画一条弧线会自动复制成对称纹样。', '换第二种釉色继续装饰，满足“两种釉色”。', '对称与重复是传统纹样（如青花缠枝）的基本骨架。'],
  };

  return <section className="panel" hidden={!active}>
    <div className="task-head">
      <div><div className="eyebrow">美术 · 陶艺</div><h2>陶艺工坊</h2></div>
      <button onClick={() => emit('reset')}>重置任务</button>
    </div>
    <div className="presets">
      <button className={task === 'free' ? 'selected' : ''} onClick={() => { setTask('free'); emit('reset'); }}>演示模式</button>
      <button className={task === 'A' ? 'selected' : ''} onClick={() => { setTask('A'); emit('reset'); }}>任务 A · 拉坯规律</button>
      <button className={task === 'B' ? 'selected' : ''} onClick={() => { setTask('B'); emit('reset'); setBIndex(0); }}>任务 B · 造型挑战</button>
      <button className={task === 'C' ? 'selected' : ''} onClick={() => { setTask('C'); emit('reset'); setMode('paint'); }}>任务 C · 对称纹样彩绘</button>
    </div>
    <div className="task-card">{task === 'free'
      ? '拉坯：单手捏合后左右移动=在对应高度收放器壁；双手捏合同向上下=拉长/压缩、张合=胖瘦。切到彩绘模式，捏合落笔即可上釉，支持对称纹样。'
      : task === 'A' ? '预测：双手捏住陶坯向上提拉，器壁会发生什么变化？提交后现场操作验证。'
      : task === 'B' ? `造型挑战：拉出「${bTarget.zh}」。长宽比读数在①面板，接近目标即达成。`
      : '选择至少 2 重对称与两种釉色，在陶坯上绘制装饰纹样——覆盖率与颜色种数达标即达成。'}</div>
    <div className="toolbar" style={{ marginTop: 12 }}>
      <span role="group" aria-label="模式">
        <button className={mode === 'throw' ? 'selected' : ''} onClick={() => setMode('throw')}>拉坯</button>
        <button className={mode === 'paint' ? 'selected' : ''} onClick={() => { setMode('paint'); notify('彩绘模式：捏合落笔，转轮已减速。'); }}>彩绘</button>
      </span>
      {mode === 'paint' && <>
        {GLAZES.map((g, i) => <button key={g.name} className={glazeIdx === i ? 'selected' : ''} style={{ padding: '7px 10px' }} onClick={() => setGlazeIdx(i)}>{g.name}</button>)}
        <span role="group" aria-label="笔刷"> {[1, 2, 3].map(b => <button key={b} className={brush === b ? 'selected' : ''} onClick={() => setBrush(b as 1 | 2 | 3)}>笔{b}</button>)} </span>
        <span role="group" aria-label="对称"> {[1, 2, 4, 8].map(n => <button key={n} className={symmetry === n ? 'selected' : ''} onClick={() => setSymmetry(n as 1 | 2 | 4 | 8)}>{n === 1 ? '自由' : `${n}重对称`}</button>)} </span>
        <button onClick={clearPaint}>清除彩绘</button>
      </>}
      {mode === 'throw' && <>
        <span className="eyebrow" style={{ marginRight: 0 }}>切割高度 {cutY.toFixed(2)}</span>
        <input aria-label="切割高度" type="range" min={0.1} max={1.1} step={0.05} value={cutY} onChange={e => setCutY(Number(e.target.value))} style={{ width: 120 }} />
        <button onClick={() => { setProfile(p => clipProfile(p, cutY)); notify(`已沿高度 ${cutY.toFixed(2)} 水平切割。`); }}>执行切割</button>
      </>}
      <button onClick={exportPhoto}>导出作品照</button>
      <button onClick={exportModel}>导出3D模型</button>
      <span className="help">{mode === 'paint' ? '捏合=落笔，转轮自动减速；对称档位会把笔画复制成环形纹样' : '单手捏合=捏泥塑形；双手捏合=整体拉长/胖瘦；鼠标可用下方轮廓编辑器'}</span>
    </div>
    <div className="geo-host" ref={host} onWheel={e => { e.preventDefault(); view.current?.zoom(e.deltaY > 0 ? 0.2 : -0.2); }}
      onPointerDown={e => { if (mode === 'paint') { const p = canvasPos(e); paintAt(p.x, p.y, true); } }}
      onPointerMove={e => { if (mode === 'paint' && lastUV.current) { const p = canvasPos(e); paintAt(p.x, p.y, false); } }}
      onPointerUp={() => { if (mode === 'paint') endStroke(); }}
      onPointerCancel={() => { if (mode === 'paint') endStroke(); }}>
      <PotteryView hostRef={host} ref={view} profile={profile} textureCanvas={tex.current} paintVersion={paintV} speed={wheelSpeed} />
    </div>
    <aside className="side" style={{ marginTop: 16 }}>
      <div className="panel prediction">
        <h3>① {task === 'A' ? '拉坯规律预测' : task === 'B' ? '造型挑战' : task === 'C' ? '纹样彩绘' : '当前造型'}</h3>
        {task === 'A' ? <>
          <p className="help">双手捏住陶坯向上提拉，器壁会？</p>
          <div className="chips" style={{ gridTemplateColumns: '1fr' }}>
            {A_OPTIONS.map((opt, i) => <button key={i} disabled={!!verdictA} className={pred === i ? 'selected' : ''} onClick={() => setPred(i)}>{opt}</button>)}
          </div>
          <button className="primary" disabled={pred === '' || !!verdictA} onClick={() => emit('predict')}>提交预测</button>
          {verdictA !== null && <p className="notice">{verdictA ? '✓ 正确！现场双手向上提拉验证。' : '✗ 实际是「变高变薄」——现场验证。'}</p>}
        </> : task === 'B' ? <>
          <p>目标：<b>{bTarget.zh}</b></p>
          <p className={bSatisfied ? 'notice' : 'help'}>{bSatisfied ? `✓ 达成！当前造型长宽比 ${metrics.aspect.toFixed(2)}。补充解释后提交。` : `当前长宽比 ${metrics.aspect.toFixed(2)}——继续调整。`}</p>
        </> : task === 'C' ? <>
          <p className="help">对称 {symUsed} 重 · 釉色 {usedGlazeCount} 种 · 覆盖率 {(coverage * 100).toFixed(1)}%</p>
          <p className={cSatisfied ? 'notice' : 'help'}>{cSatisfied ? '✓ 达成！纹样、釉色与覆盖率都达标。补充反思后提交。' : '需要：覆盖率 ≥6%、至少 2 种釉色、≥2 重对称。'}</p>
        </> : <>
          <p>形状：<b>{shape}</b> · 长宽比 {metrics.aspect.toFixed(2)}</p>
          <p className="help">高度 {metrics.height.toFixed(2)} · 最大半径 {metrics.maxR.toFixed(2)} · 体积 {metrics.volume.toFixed(3)}</p>
        </>}
      </div>
      <div className="panel result">
        <h3>② 轮廓编辑器（鼠标备用）</h3>
        <ProfileEditor profile={profile} onChange={setProfile} />
        <p className="help" style={{ marginTop: 8 }}>拖动琥珀色控制点调整侧影轮廓；手势不便时用它完成全部造型任务。</p>
      </div>
      <div className="panel hint">
        <h3>③ 提示与反思</h3>
        <button onClick={() => emit('hint')}>请求提示 {hint}/2</button>
        <p>{HINTS[task][Math.min(hint, 2)]}</p>
        {stalled && <p className="notice">已经停留超过 60 秒没有新操作。可以先自己再试一次，也可以点上面的“请求提示”。</p>}
        <textarea className="reflection" aria-label="陶艺观察解释" rows={3} value={explanation}
          placeholder={task === 'A' ? '为什么拉高器壁会变薄？' : task === 'B' ? '你是怎么控制长宽比的？' : '对称与重复在纹样设计里起什么作用？'}
          onChange={e => setExplanation(e.target.value)} />
        {task !== 'free' && <button className="primary" disabled={!explanation.trim() || (task === 'A' ? !verdictA : task === 'B' ? !bSatisfied : !cSatisfied) || completed} onClick={() => emit('submit', explanation)}>{completed ? '任务已完成 ✓' : '提交观察解释'}</button>}
      </div>
    </aside>
  </section>;
}
