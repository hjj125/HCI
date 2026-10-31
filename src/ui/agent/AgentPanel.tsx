import { useEffect, useState } from 'react';
import type { AgentPhase } from '../../core/agent/types';
import type { AgentRuntimeView } from '../../core/agent/useAgentRuntime';

const PHASE_LABEL: Record<AgentPhase, string> = {
  off: '已关闭', idle: '待命', perceiving: '观察中', thinking: '思考中', acting: '演示中', speaking: '说话中',
};

/** 灵犀化身：四态动画由 phase 类驱动（呼吸/眨眼/思考/演示光环）。 */
function AgentAvatar({ phase }: { phase: AgentPhase }) {
  return <svg className={`agent-avatar ph-${phase}`} viewBox="0 0 48 52" width={40} height={44} aria-hidden>
    <defs>
      <linearGradient id="lingxi-head" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#e7fbf5" /><stop offset="1" stopColor="#bfeee2" />
      </linearGradient>
    </defs>
    <line className="aa-ant" x1="24" y1="12" x2="24" y2="6" />
    <circle className="aa-spark" cx="24" cy="4.6" r="2.6" />
    <circle className="aa-head" cx="24" cy="30" r="17" />
    <circle className="aa-eye" cx="18.5" cy="28" r="2.2" />
    <circle className="aa-eye" cx="29.5" cy="28" r="2.2" />
    <path className="aa-mouth" d="M19 35q5 3.6 10 0" />
    <circle className="aa-ring" cx="24" cy="30" r="17" />
  </svg>;
}

/** 具身教学智能体「灵犀」浮动面板：化身 + 打字机气泡 + 演示提议 + 自由提问。 */
export function AgentPanel({ phase, bubble, offer, ttsOn, setTtsOn, accept, dismiss, ask, enabled, open, setOpen, sceneTitle, cameraOn }: AgentRuntimeView) {
  const [shown, setShown] = useState('');
  const [draft, setDraft] = useState('');
  // 打字机：目标文本变化时从已显示长度续写（流式追加不重置动画）；折叠面板无需动画，直接显示全文。
  useEffect(() => {
    if (!open) { setShown(bubble); return; }
    if (shown === bubble) return;
    let i = 0;
    if (bubble.startsWith(shown)) i = shown.length; else setShown('');
    const t = setInterval(() => {
      i++;
      setShown(bubble.slice(0, i));
      if (i >= bubble.length) clearInterval(t);
    }, 18);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bubble, open]);
  if (!enabled) return null;
  const busy = phase === 'acting' || phase === 'thinking';
  const send = () => { const q = draft.trim(); if (!q || busy) return; setDraft(''); void ask(q); };
  if (!open) return <div className={`agent-layer${cameraOn ? ' lift' : ''}`}>
    <button className="agent-tab" onClick={() => setOpen(true)} title={`灵犀 · AI 教学智能体（${PHASE_LABEL[phase]}）`} aria-label="打开灵犀智能体面板">
      <AgentAvatar phase={phase} /><span>灵犀</span>
    </button>
  </div>;
  return <div className={`agent-layer${cameraOn ? ' lift' : ''}`}>
    <section className="agent-panel" role="log" aria-label={`灵犀智能体面板 · ${PHASE_LABEL[phase]}`}>
      <header>
        <AgentAvatar phase={phase} />
        <div className="agent-id">
          <b>灵犀 <span className="small">{sceneTitle}</span></b>
          <span className={`agent-chip chip-${phase}`}>{PHASE_LABEL[phase]}</span>
        </div>
        <button className="agent-min" aria-label="收起灵犀面板" onClick={() => setOpen(false)}>—</button>
      </header>
      <div className="agent-bubble">{shown || '…'}</div>
      {offer && <div className="agent-offer">
        <button className="agent-go" disabled={busy} onClick={() => void accept()}>{offer.label}</button>
        <button className="agent-skip" disabled={busy} onClick={() => dismiss()}>下次再说</button>
      </div>}
      <div className="agent-ask">
        <input value={draft} placeholder="问灵犀一句……" aria-label="向灵犀提问"
          disabled={busy} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send(); }} />
        <button disabled={busy || !draft.trim()} onClick={send}>发送</button>
      </div>
      <footer className="agent-foot">
        <label><input type="checkbox" checked={ttsOn} onChange={e => setTtsOn(e.target.checked)} />语音播报</label>
        <span>感知快照与操作事件 · 不含画面</span>
      </footer>
    </section>
  </div>;
}
