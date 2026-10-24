import { useEffect, useRef, useState } from 'react';
import { bus } from '../../core/interaction';
import type { SceneProps } from '../types';
import { useScenePolicy, useSceneSettings, useServices } from '../../core/services';
import { SwipeDetector } from './pptGesture';
import { PowerPointPanel } from './PowerPointPanel';

const slideTitles = ['让知识，可以被操作', '先预测，再操作与验证', '一个平面，能切出哪些形状？'];
const slideTexts = [
  '通过身体动作、可见对象和即时反馈，连接课堂讲解与动手探究。',
  '进入白板画一个正方体，再进入几何任务，亲手探索切面变化。',
  '三角形、四边形、五边形、六边形……观察切面经过哪些面，尝试解释变化。',
];

/** 课件场景插件：应用内课件 / 本机 PowerPoint 放映控制 + 挥手翻页 + 激光笔。 */
export function SlidesScene({ active }: SceneProps) {
  const { notify } = useServices();
  const { laser, setLaser, pptMode, setPptMode, backgroundCamera, setBackgroundCamera } = useSceneSettings();
  const [slide, setSlide] = useState(0);
  const [images, setImages] = useState<string[]>([]);
  const [pptStatus, setPptStatus] = useState('尚未连接 PowerPoint');
  const [pptBusy, setPptBusy] = useState(false);
  const pptLock = useRef(false), pptLast = useRef(0);
  const swipe = useRef(new SwipeDetector());
  const urls = useRef<string[]>([]);
  useEffect(() => () => { urls.current.forEach(URL.revokeObjectURL); }, []);

  const emit = (intent: Parameters<typeof bus.emit>[0]['intent'], value?: string, source: Parameters<typeof bus.emit>[0]['source'] = 'mouse') =>
    bus.emit({ scene: 'slides', source, intent, phase: 'end', value });
  const toggleLaser = () => {
    setLaser(!laser);
    notify(laser ? '激光笔已关闭。' : '激光笔已开启 · 移动手指即可指示重点。');
  };
  const pptControl = async (action: 'status' | 'next' | 'previous') => {
    if (pptLock.current || (action !== 'status' && Date.now() - pptLast.current < 900)) return;
    pptLock.current = true; setPptBusy(true); if (action !== 'status') pptLast.current = Date.now();
    try {
      const r = await fetch('/api/powerpoint?action=' + action, { method: 'POST', headers: { 'X-EmbodiedEdu': 'local-control' } });
      const data = await r.json();
      setPptStatus(data.error ? '控制未完成：' + data.error : !data.connected ? '连接失败，请先打开 PowerPoint' : !data.presenting ? '已连接 ' + data.file + '；请先按 F5 开始放映' : `${data.file} · 第 ${data.current} / ${data.total} 页`);
    } catch { setPptStatus('本地控制服务不可用，请在 Windows 上通过 npm run dev 启动。'); }
    finally { pptLock.current = false; setPptBusy(false); }
  };

  // 手势策略：课件视图内左右挥手翻页；比“2”开关激光笔。
  useScenePolicy('slides', sample => {
    if (sample.phase !== 'cancel') {
      const direction = swipe.current.push(sample.x, sample.y, performance.now(), { pinching: sample.pinching });
      if (direction) emit(direction === 'right' ? 'next' : 'previous', undefined, 'hand');
    } else swipe.current.reset();
    if (sample.command === 'laser') toggleLaser();
  });

  // 语义事件：翻页命令（按钮/键盘/手势/语音共用）与激光笔。
  useEffect(() => bus.subscribe(e => {
    if (e.intent === 'switch') { swipe.current.reset(); return; }
    if (e.scene !== 'slides') return;
    if (e.intent === 'laser') { toggleLaser(); return; }
    if (e.source === 'hand' && e.intent === 'next') notify('已识别向右挥手 · 下一页');
    if (e.source === 'hand' && e.intent === 'previous') notify('已识别向左挥手 · 上一页');
    if (e.intent === 'next' && pptMode) { void pptControl('next'); return; }
    if (e.intent === 'previous' && pptMode) { void pptControl('previous'); return; }
    if (e.intent === 'next') setSlide(v => Math.min((images.length || 3) - 1, v + 1));
    if (e.intent === 'previous') setSlide(v => Math.max(0, v - 1));
  }), [pptMode, laser, images.length, notify]);

  // 键盘：方向键翻页、L 键开关激光笔（仅激活时）。
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight') emit('next', undefined, 'keyboard');
      if (e.key === 'ArrowLeft') emit('previous', undefined, 'keyboard');
      if (e.key === 'l' || e.key === 'L') toggleLaser();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active, laser]);

  return <section className="panel slide-panel" hidden={!active}>
    <div className="toolbar">
      <button className={!pptMode ? 'selected' : ''} onClick={() => setPptMode(false)}>应用内课件</button>
      <button className={pptMode ? 'selected' : ''} onClick={() => { setPptMode(true); void pptControl('status'); }}>本机 PowerPoint</button>
      {pptMode && <button disabled={pptBusy} onClick={() => void pptControl('status')}>检测连接</button>}
    </div>
    {pptMode
      ? <PowerPointPanel backgroundCamera={backgroundCamera} onBackgroundChange={setBackgroundCamera} laser={laser} onToggleLaser={toggleLaser} status={pptStatus} busy={pptBusy} onControl={a => a === 'status' ? void pptControl(a) : emit(a)} />
      : <>
        <div className="eyebrow">课堂模式 · {slide + 1} / {images.length || 3}</div>
        {images.length
          ? <img src={images[slide]} alt={`课件第 ${slide + 1} 页`} style={{ width: '100%', height: 360, objectFit: 'contain', marginTop: 20 }} />
          : <><h1>{slideTitles[slide]}</h1><p>{slideTexts[slide]}</p></>}
        <div className="slide-controls">
          <button disabled={slide === 0} onClick={() => emit('previous')}>← 上一页</button>
          <button disabled={slide === (images.length || 3) - 1} onClick={() => emit('next')}>下一页 →</button>
          <button className={laser ? 'selected' : ''} onClick={toggleLaser}>激光笔</button>
          <button onClick={() => emit('switch', 'whiteboard')}>打开白板</button>
        </div>
        <p className="help">手掌向左/向右挥动可翻页；比“2”保持约 0.6 秒开关激光笔（或按 L 键）；也支持方向键，或切换到本机 PowerPoint 控制。</p>
        <label className="small">导入图片课件 <input className="file-input" type="file" accept="image/png,image/jpeg,image/webp" multiple onChange={e => {
          const files = Array.from(e.target.files || []);
          if (files.length) {
            urls.current.forEach(URL.revokeObjectURL);
            urls.current = files.map(f => URL.createObjectURL(f));
            setImages([...urls.current]); setSlide(0);
          }
        }} /></label>
      </>}
  </section>;
}
