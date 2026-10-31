import { useEffect, useRef, useState } from 'react';
import { bus } from '../../core/interaction';
import type { SceneProps } from '../types';
import { useScenePolicy, useSceneSnapshot, useSceneVoicePolicy, useServices } from '../../core/services';
import { BloomVerseView, PALETTES, type BloomVerseHandle, type PaletteId, type Quality } from './BloomVerseView';
import { GestureEngine, type DriveGesture } from './gesture';
import { FLOWERS } from './flower';
import type { Landmark } from './bloom';

const GESTURE_HINT: Record<DriveGesture, string> = {
  idle: '伸出你的手 · 握拳收拢花苞，五指张开让花绽放',
  bloom: '绽放中 · 张开的幅度就是花朵开放的程度',
  pinch: '捏合缩放 · 拇指食指拉远放大、捏紧缩小，绽放度已锁定',
  spin: '旋转 · 手掌左右移动，花朵随惯性转动',
  storm: '花瓣风暴！花朵将散落重聚',
  sea: '花海 · 双手拉远让花园扩散，双手靠近重新汇聚',
};

/** 美术实验二 · BloomVerse 指尖绽放：程序化 3D 花朵 × 六种手势（开合/旋转/捏合/挥手风暴/双手花海）。 */
export function BloomScene({ active }: SceneProps) {
  const { notify, handVideo } = useServices();
  const [speciesIdx, setSpeciesIdx] = useState(0);
  const [palette, setPalette] = useState<PaletteId>('gild');
  const [quality, setQuality] = useState<Quality>('high');
  const [debug, setDebug] = useState(false);
  const [previewOn, setPreviewOn] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const [ritual, setRitual] = useState<'seed' | 'invite' | 'live'>('seed');
  const [readout, setReadout] = useState({ bloom: 0, gesture: 'idle' as DriveGesture, hands: 0 });
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<BloomVerseHandle>(null);
  const preview = useRef<HTMLVideoElement>(null);
  const debugCanvas = useRef<HTMLCanvasElement>(null);
  const startedAt = useRef(Date.now());

  // 手势引擎：策略采样 → 驾驶状态（视图每帧读取同一对象）。
  const engine = useRef(new GestureEngine());
  const drive = useRef(engine.current.state);
  const introStart = useRef(0);
  const lastHandAt = useRef(0);
  // 鼠标模式（手在画面时手势优先，但单击切换绽放始终可用）。
  const mouse = useRef({ x: 0.5, y: 0.5, inside: false, lastX: 0.5, sea: false });

  const emit = (intent: Parameters<typeof bus.emit>[0]['intent'], value?: string) =>
    bus.emit({ scene: 'art-bloom', source: 'mouse', intent, phase: 'end', value });

  // 开场仪式：记录起始时间即可——生长进度由视图按真实时间计算（不受定时器节流影响）。
  useEffect(() => { if (active && !introStart.current) introStart.current = Date.now(); }, [active]);

  // 摄像头开启检测：共享 video 出现媒体流 → 进入 live。
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      const stream = handVideo.current?.srcObject as MediaStream | null;
      if (stream && ritual !== 'live') setRitual('live');
      const pv = preview.current;
      if (pv && previewOn && stream && pv.srcObject !== stream) { pv.srcObject = stream; pv.play().catch(() => { }); }
    }, 400);
    return () => clearInterval(timer);
  }, [active, ritual, previewOn, handVideo]);

  // 手势策略：引擎推进 + 调试骨架绘制。
  useScenePolicy('art-bloom', sample => {
    if (sample.phase === 'cancel') { lastHandAt.current = 0; return; }
    const hands = sample.landmarks;
    if (!hands?.length) return;
    lastHandAt.current = Date.now();
    drive.current = engine.current.update(Date.now(), hands);
    if (debug) {
      const c = debugCanvas.current; const ctx = c?.getContext('2d');
      if (c && ctx) {
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.fillStyle = '#8ff0dc';
        for (const hand of hands) for (const p of hand) {
          ctx.globalAlpha = 0.85;
          ctx.beginPath();
          ctx.arc(p.x * c.width, p.y * c.height, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }
  });

  // 读数轮询 + 开场阶段推进（按真实时间，不受节流影响）。
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      setReadout({
        bloom: view.current?.getBloom() ?? 0,
        gesture: drive.current.gesture,
        hands: drive.current.handCount,
      });
      if (ritual === 'seed' && introStart.current && Date.now() - introStart.current > 3400) setRitual('invite');
    }, 250);
    return () => clearInterval(timer);
  }, [active, ritual]);

  // 鼠标模式：旋转惯性衰减（仅当手不在画面）。
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (Date.now() - lastHandAt.current < 800) return;
      drive.current.spinTarget *= 0.9;
    }, 60);
    return () => clearInterval(timer);
  }, [active]);

  const mouseActive = () => Date.now() - lastHandAt.current >= 800;
  const pushMouseSpin = (nx: number) => {
    const dx = nx - mouse.current.lastX;
    mouse.current.lastX = nx;
    drive.current.spinTarget = Math.max(-2.4, Math.min(2.4, drive.current.spinTarget * 0.5 + dx * 16));
  };

  const stagePos = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  // 场景级语音：花种 / 色盘 / 盛开收拢 / 吹散 / 花海。
  useSceneVoicePolicy('art-bloom', text => {
    const t = text.replace(/\s/g, '');
    const act = (msg: string, fn: () => void) => { fn(); notify(`语音 · ${msg}`); return true; };
    const fi = FLOWERS.findIndex(f => t.includes(f.name));
    if (fi >= 0) return act(`切换到${FLOWERS[fi].name}`, () => setSpeciesIdx(fi));
    const pi = PALETTES.findIndex(p => t.includes(p.name.slice(0, 2)));
    if (pi >= 0) return act(`切换到${PALETTES[pi].name}`, () => setPalette(PALETTES[pi].id));
    if (t.includes('盛开')) return act('全开', () => { drive.current.bloomTarget = 1; });
    if (t.includes('收拢') || t.includes('花苞')) return act('花苞收拢', () => { drive.current.bloomTarget = 0.05; });
    if (t.includes('吹散') || t.includes('风暴')) return act('花瓣风暴', () => drive.current.stormQueue.push({ dirX: 1, dirY: 0, power: 1 }));
    if (t.includes('花海')) return act('花海模式', () => { drive.current.sea = !drive.current.sea; drive.current.seaRadius = 1.4; });
    return false;
  });

  useEffect(() => bus.subscribe(e => {
    if (e.scene !== 'art-bloom') return;
    if (e.intent === 'reset') {
      drive.current.bloomTarget = 0.05; drive.current.scaleTarget = 1; drive.current.sea = false;
      notify('回到花苞，重新开始。');
    }
  }), [notify]);

  useSceneSnapshot('art-bloom', () => ({
    startedAt: new Date(startedAt.current).toISOString(),
    durationSeconds: Math.round((Date.now() - startedAt.current) / 1000),
    species: FLOWERS[speciesIdx].name,
    palette: PALETTES.find(p => p.id === palette)?.name,
    quality,
    bloom: Number((view.current?.getBloom() ?? 0).toFixed(3)),
    gesture: drive.current.gesture,
    hands: drive.current.handCount,
    sea: drive.current.sea,
  }));

  const exportPhoto = () => {
    const url = view.current?.snapshot();
    if (!url) { notify('视图未就绪。'); return; }
    const a = document.createElement('a');
    a.href = url; a.download = 'BloomVerse.png'; a.click();
    notify('作品已导出（PNG）。');
  };

  const startCamera = () => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('启用摄像头手势'));
    if (btn) { btn.click(); notify('正在请求摄像头…'); }
    else notify('请在左下角点击「启用摄像头手势」。');
  };

  const species = FLOWERS[speciesIdx];
  const hint = readout.hands > 0 ? GESTURE_HINT[readout.gesture]
    : mouse.current.inside || ritual === 'live'
      ? '鼠标模式 · 单击切换绽放/收拢，左右拖动旋转，滚轮缩放，双击吹散花瓣'
      : GESTURE_HINT.idle;

  return <section className="panel bloom-scene" hidden={!active}>
    <div className="task-head">
      <div><div className="eyebrow">美术 · BloomVerse</div><h2>指尖绽放 · 手势开花</h2></div>
      <button onClick={() => emit('reset')}>重置</button>
    </div>
    <div className="bloom-stage" ref={host}
      onPointerMove={e => {
        if (!mouseActive()) return;
        const p = stagePos(e);
        mouse.current.x = p.x; mouse.current.y = p.y; mouse.current.inside = true;
        drive.current.handX = p.x; drive.current.handY = p.y;
        drive.current.present = true;
        pushMouseSpin(p.x);
      }}
      onPointerDown={e => {
        // 单击切换绽放/收拢（保持语义：点一下保持盛开，再点收拢）；位置与旋转让位给手势。
        const p = stagePos(e);
        mouse.current.inside = true;
        mouse.current.lastX = p.x;
        if (!mouseActive()) return;
        drive.current.bloomTarget = drive.current.bloomTarget > 0.5 ? 0.06 : 1;
      }}
      onPointerLeave={() => { mouse.current.inside = false; if (mouseActive()) drive.current.present = false; }}
      onDoubleClick={() => { if (mouseActive()) drive.current.stormQueue.push({ dirX: 1, dirY: 0, power: 1 }); }}
      onWheel={e => {
        if (!mouseActive()) return;
        e.preventDefault();
        drive.current.scaleTarget = Math.max(0.55, Math.min(1.6, drive.current.scaleTarget * (e.deltaY < 0 ? 1.12 : 0.89)));
      }}>
      <BloomVerseView hostRef={host} ref={view} active={active} species={speciesIdx} palette={palette} quality={quality} drive={drive} introStart={introStart} />

      {/* 品牌与提示层 */}
      <div className="bloom-brand">BloomVerse<span>指尖绽放</span></div>
      <div className="bloom-hint">{hint}</div>
      <div className="bloom-status">
        <span>{species.name}</span>
        <i />
        <span>绽放 {Math.round(readout.bloom * 100)}%</span>
        <i />
        <span>{readout.gesture === 'idle' ? '等待手势' : readout.gesture === 'sea' ? '花海' : readout.gesture === 'storm' ? '风暴' : readout.gesture === 'pinch' ? '缩放' : readout.gesture === 'spin' ? '旋转' : '绽放'}</span>
        {readout.hands > 1 && <><i /><span>双手</span></>}
      </div>

      {/* 侧边玻璃面板：花种 / 色盘 / 画质 / 工具 */}
      <div className={`bloom-panel${panelOpen ? '' : ' collapsed'}`}>
        <button className="bloom-panel-tab" onClick={() => setPanelOpen(v => !v)} aria-label="收起或展开面板">{panelOpen ? '›' : '‹'}</button>
        {panelOpen && <>
          <div className="bloom-group">
            <div className="bloom-label">花种</div>
            {FLOWERS.map((f, i) => <button key={f.id} className={`bloom-chip${speciesIdx === i ? ' selected' : ''}`} onClick={() => setSpeciesIdx(i)}>{f.name}</button>)}
          </div>
          <div className="bloom-group">
            <div className="bloom-label">色盘</div>
            <div className="bloom-dots">
              {PALETTES.map(p => <button key={p.id} className={`bloom-dot${palette === p.id ? ' selected' : ''}`} style={{ background: `linear-gradient(135deg, ${p.root}, ${p.tip})` }}
                title={p.name} aria-label={p.name} onClick={() => setPalette(p.id)} />)}
            </div>
          </div>
          <div className="bloom-group">
            <div className="bloom-label">画质</div>
            <div className="bloom-seg">
              {(['high', 'medium', 'low'] as Quality[]).map(q => <button key={q} className={quality === q ? 'selected' : ''} onClick={() => setQuality(q)}>{{ high: '高', medium: '中', low: '低' }[q]}</button>)}
            </div>
          </div>
          <div className="bloom-group bloom-tools">
            <button onClick={() => drive.current.stormQueue.push({ dirX: 1, dirY: 0, power: 1 })}>花瓣风暴</button>
            <button className={drive.current.sea ? 'selected' : ''} onClick={() => {
              drive.current.sea = !drive.current.sea;
              drive.current.seaRadius = 1.4;
              if (drive.current.sea) drive.current.bloomTarget = 1;   // 花海需要主花同放
            }}>花海</button>
            <button onClick={exportPhoto}>导出</button>
          </div>
          <label className="bloom-switch">
            <input type="checkbox" checked={debug} onChange={e => { setDebug(e.target.checked); if (!e.target.checked) { const c = debugCanvas.current?.getContext('2d'); c?.clearRect(0, 0, 200, 150); } }} />
            手势调试 · 显示关键点
          </label>
          {debug && <canvas ref={debugCanvas} width={200} height={150} className="bloom-debug" aria-label="手势关键点调试视图" />}
        </>}
      </div>

      {/* 摄像头预览 */}
      {previewOn && <div className="bloom-preview">
        <video ref={preview} muted playsInline autoPlay />
        <span>摄像头 · 本地识别</span>
      </div>}

      {/* 开场仪式遮罩 */}
      {ritual !== 'live' && (
        <div className="bloom-veil" style={{ opacity: ritual === 'invite' ? 0.86 : 1 }}>
          {ritual === 'invite' && <div className="bloom-invite">
            <h3>伸出你的手，让万物绽放</h3>
            <p>开启摄像头，用手势让花朵生长、绽放、旋转与飞散。</p>
            <div className="bloom-invite-actions">
              <button className="primary" onClick={startCamera}>开启摄像头</button>
              <button onClick={() => setRitual('live')}>先用鼠标体验</button>
            </div>
            <p className="small">摄像头画面仅在本机浏览器内推理，不录制、不上传。</p>
          </div>}
        </div>
      )}
    </div>

    <aside className="side bloom-side">
      <div className="panel">
        <h3>手势指南</h3>
        <div className="bloom-legend">
          <div><b>握拳 / 张开</b><span>花苞 ⇄ 绽放（连续控制）</span></div>
          <div><b>手掌左右移动</b><span>带动花朵旋转（惯性）</span></div>
          <div><b>双指捏合</b><span>缩放花朵，锁定开放度</span></div>
          <div><b>快速挥手</b><span>花瓣风暴，散落重聚</span></div>
          <div><b>双手张开</b><span>花海扩散，掌距控制范围</span></div>
        </div>
        <p className="help" style={{ marginTop: 10 }}>{species.note} 支持 {species.layers.length} 层 {species.layers.reduce((n, l) => n + l.petals, 0)} 片真实曲面花瓣与叶序花芯。</p>
      </div>
      <div className="panel">
        <h3>会话</h3>
        <p className="help">绽放度 {(readout.bloom * 100).toFixed(0)}% · 手势 {readout.gesture === 'idle' ? '等待' : readout.gesture} · 画质 {quality === 'high' ? '高' : quality === 'medium' ? '中' : '低'}</p>
        <label className="bloom-switch">
          <input type="checkbox" checked={previewOn} onChange={e => setPreviewOn(e.target.checked)} />
          显示摄像头预览（右下角）
        </label>
      </div>
    </aside>
  </section>;
}
