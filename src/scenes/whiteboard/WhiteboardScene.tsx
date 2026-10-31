import { useEffect, useRef, useState } from 'react';
import { bus } from '../../core/interaction';
import type { SceneProps } from '../types';
import { useScenePolicy, useSceneSnapshot, useSceneSettings, useServices } from '../../core/services';
import type { HandSample } from '../../core/useHandInput';
import { stabilizePoint, moved, JITTER_GATE, type Pt } from './stabilize';

type Stroke = { points: { x: number; y: number }[]; color: string; width: number; eraser?: boolean };

/** 白板场景插件：捏合/空格落笔绘制，画笔/橡皮/颜色/粗细，撤销与清空。 */
export function WhiteboardScene({ active }: SceneProps) {
  const { notify, cancelHand, drag } = useServices();
  const { fistUndo, setFistUndo, penInput, setPenInput, tool, setTool } = useSceneSettings();
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [color, setColor] = useState('#38bdf8');
  const [width, setWidth] = useState(4);
  const canvas = useRef<HTMLCanvasElement>(null);
  const spaceDown = useRef(false), spaceWriting = useRef(false);
  // 隔空书写稳定器：One Euro 自适应滤波 + 最小点距门限（鼠标路径不经过，无延迟代价）。
  const penPt = useRef<Pt | null>(null);
  const penLast = useRef<Pt | null>(null);
  const penT = useRef(0);

  const emitDrag = (phase: 'start' | 'update' | 'end' | 'cancel', position?: { x: number; y: number }, source: 'mouse' | 'hand' | 'keyboard' = 'mouse') =>
    bus.emit({ scene: 'whiteboard', source, intent: 'drag', phase, position });

  const cancelOperation = () => {
    if (drag.current?.scene !== 'whiteboard') return;
    setStrokes(v => v.slice(0, -1));
    drag.current = null;
  };

  // 手势策略：空格模式先把落笔状态合并进采样；捏合点按钮由壳处理，画布内捏合=落笔。
  useScenePolicy('whiteboard', (raw: HandSample) => {
    let sample = raw;
    if (penInput === 'space' && sample.phase !== 'cancel') {
      const down = spaceDown.current;
      sample = { ...sample, pinching: down, command: sample.command, phase: down && !spaceWriting.current ? 'start' : !down && spaceWriting.current ? 'end' : 'update' };
      spaceWriting.current = down;
    }
    if (sample.phase === 'cancel') spaceWriting.current = false;
    if (sample.command === 'undo') { if (drag.current) bus.emit({ scene: 'whiteboard', source: 'hand', intent: 'drag', phase: 'end' }); bus.emit({ scene: 'whiteboard', source: 'hand', intent: 'undo', phase: 'end' }); notify('已撤销一次操作，张开手后可继续书写。'); return; }
    // 数字手势切换工具：空格书写中不响应，避免书写姿势变化误切换。
    if ((sample.command === 'pen' || sample.command === 'eraser') && !spaceDown.current) {
      cancelOperation(); setTool(sample.command);
      notify(sample.command === 'pen' ? '数字手势 · 已切换为画笔，捏合继续书写。' : '数字手势 · 已切换为橡皮，捏合移动即可擦除。');
      return;
    }
    if (sample.phase === 'cancel') { penPt.current = null; penLast.current = null; penT.current = 0; emitDrag('cancel', undefined, 'hand'); return; }
    const px = sample.x * window.innerWidth, py = sample.y * window.innerHeight;
    if (sample.phase === 'start') {
      // 空格落笔产生的 start 未经壳的按钮检查，这里补上：指向按钮时空格起笔仍是点击。
      const element = document.elementFromPoint(px, py);
      if (element instanceof HTMLElement) {
        const button = element.closest('button');
        if (button && !button.disabled) { button.click(); return; }
      }
    }
    const rect = canvas.current?.getBoundingClientRect();
    if (sample.phase === 'start') {
      if (rect && px >= rect.left - 12 && px <= rect.right + 12 && py >= rect.top - 20 && py <= rect.bottom + 20) {
        const start = { x: Math.max(0, Math.min(1, (px - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (py - rect.top) / rect.height)) };
        penPt.current = null; penLast.current = start; penT.current = 0;   // 起笔直通，滤波从零状态开始
        emitDrag('start', start, 'hand');
      }
      return;
    }
    if (drag.current?.scene === 'whiteboard' && sample.phase === 'end') { penPt.current = null; penLast.current = null; penT.current = 0; emitDrag('end', undefined, 'hand'); return; }
    if (drag.current?.scene === 'whiteboard' && sample.pinching && rect) {
      const target = { x: Math.max(0, Math.min(1, (px - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (py - rect.top) / rect.height)) };
      const now = performance.now();
      const dt = penT.current ? (now - penT.current) / 1000 : 0.024;
      penT.current = now;
      const p = stabilizePoint(penPt.current, target, dt);
      penPt.current = p;
      if (!penLast.current || moved(penLast.current, p) >= JITTER_GATE) {
        penLast.current = p;
        emitDrag('update', p, 'hand');
      }
    }
  });

  // 语义事件：绘制与撤销（鼠标/手势共用）。
  useEffect(() => bus.subscribe(e => {
    if (e.scene !== 'whiteboard') return;
    if (e.intent === 'drag') {
      if (e.phase === 'cancel') { cancelOperation(); return; }
      if (e.phase === 'start' && e.position) {
        drag.current = { scene: 'whiteboard', x: e.position.x, y: e.position.y };
        setStrokes(v => [...v, { points: [e.position!], color, width: tool === 'eraser' ? 40 : width, eraser: tool === 'eraser' }]);
      }
      if (e.phase === 'update' && e.position && drag.current?.scene === 'whiteboard')
        setStrokes(v => v.map((s, i) => i === v.length - 1 ? { ...s, points: [...s.points, e.position!] } : s));
      if (e.phase === 'end' && drag.current?.scene === 'whiteboard') drag.current = null;
      return;
    }
    if (e.intent === 'undo') { cancelOperation(); setStrokes(v => v.slice(0, -1)); }
  }), [color, width, tool]);

  // 空格落笔：按住空格 = 捏合；失焦自动抬笔。
  useEffect(() => {
    if (!active) return;
    const release = () => {
      spaceDown.current = false; spaceWriting.current = false;
      if (drag.current?.scene === 'whiteboard') emitDrag('end', undefined, 'keyboard');
    };
    const keydown = (e: KeyboardEvent) => {
      if (penInput === 'space' && e.code === 'Space' && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLSelectElement)) { e.preventDefault(); spaceDown.current = true; }
    };
    const keyup = (e: KeyboardEvent) => { if (e.code === 'Space' && penInput === 'space') { e.preventDefault(); release(); } };
    window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', release);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', release); release(); };
  }, [active, penInput]);

  // 画布重绘：笔迹用二次曲线平滑，橡皮用 destination-out。
  const paint = () => {
    const c = canvas.current; if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    strokes.forEach(s => {
      ctx.globalCompositeOperation = s.eraser ? 'destination-out' : 'source-over';
      ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = s.width; ctx.beginPath();
      if (s.points.length > 1) {
        ctx.moveTo(s.points[0].x * c.width, s.points[0].y * c.height);
        for (let i = 1; i < s.points.length - 1; i++) {
          const a = s.points[i], b = s.points[i + 1];
          ctx.quadraticCurveTo(a.x * c.width, a.y * c.height, (a.x + b.x) / 2 * c.width, (a.y + b.y) / 2 * c.height);
        }
        const last = s.points[s.points.length - 1];
        ctx.lineTo(last.x * c.width, last.y * c.height); ctx.stroke();
      }
      if (s.points.length === 1) { ctx.beginPath(); ctx.arc(s.points[0].x * c.width, s.points[0].y * c.height, s.width / 2, 0, Math.PI * 2); ctx.fill(); }
    });
    ctx.globalCompositeOperation = 'source-over';
  };
  useEffect(paint, [strokes]);

  const pointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };
  useSceneSnapshot('whiteboard', () => ({ strokes: strokes.length }));

  return <section className="panel whiteboard-panel" hidden={!active}>
    <div className="toolbar">
      <span className="eyebrow">白板 · 指向画布并捏合，或按住鼠标绘制</span>
      <label>颜色<input aria-label="笔迹颜色" type="color" value={color} onChange={e => setColor(e.target.value)} /></label>
      <label>粗细<select value={width} onChange={e => setWidth(Number(e.target.value))}>{[2, 4, 8, 12].map(n => <option key={n}>{n}</option>)}</select></label>
      <button disabled={!strokes.length} onClick={() => bus.emit({ scene: 'whiteboard', source: 'mouse', intent: 'undo', phase: 'end' })}>撤销</button>
      <button disabled={!strokes.length} onClick={() => { if (confirm('确定清空所有笔迹？')) { cancelOperation(); setStrokes([]); notify('白板已清空'); } }}>清空</button>
    </div>
    <div className="toolbar" style={{ marginTop: 12 }}>
      <span aria-label="工具" role="group" className="tool-toggle">
        <button aria-pressed={tool === 'pen'} className={tool === 'pen' ? 'selected' : ''} onClick={() => { cancelOperation(); setTool('pen'); }}>画笔</button>
        <button aria-pressed={tool === 'eraser'} className={tool === 'eraser' ? 'selected' : ''} onClick={() => { cancelOperation(); setTool('eraser'); }}>橡皮</button>
      </span>
      <label>落笔方式<select value={penInput} onChange={e => { const next = e.target.value as 'pinch' | 'space'; cancelOperation(); cancelHand(); setPenInput(next); }}>
        <option value="pinch">捏合落笔</option><option value="space">空格落笔</option>
      </select></label>
      <label className="small"><input type="checkbox" checked={fistUndo} onChange={e => setFistUndo(e.target.checked)} /> 握拳 0.6 秒撤销（捏合模式）</label>
    </div>
    <p className="help">{penInput === 'space' ? '伸出食指移动，按住空格落笔，松开空格抬笔。' : '捏合落笔，张开两指抬笔移位，再捏合开始下一笔。'} 橡皮擦使用同样的落笔方式。工具手势：比“2”保持约 0.6 秒切换画笔，比“3”切换橡皮。</p>
    <canvas ref={canvas} width={1200} height={650} aria-label="绘图白板"
      onPointerDown={e => { try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 合成事件没有活动指针，忽略 */ } emitDrag('start', pointer(e)); }}
      onPointerMove={e => { if (drag.current?.scene === 'whiteboard') emitDrag('update', pointer(e)); }}
      onPointerUp={() => emitDrag('end')}
      onPointerCancel={() => emitDrag('cancel')} />
    <p className="help">松开提交笔迹；追踪丢失将取消本次未完成笔迹。切换页面后保留已完成内容。</p>
  </section>;
}
