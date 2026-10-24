import { useCallback, useEffect, useRef, useState } from 'react';
import { matchVoiceCommand, type VoiceIntent } from './interaction';

/**
 * 有限语音命令：浏览器 Web Speech API（Edge/Chrome），中文连续识别。
 * 识别到命令短语后交给回调，由 App 转成统一交互事件——与手势/鼠标共用同一事件总线。
 * 语音为显式启用；识别服务由浏览器提供，本应用不保存任何音频或转写。
 */
export function useVoiceInput(onCommand: (cmd: VoiceIntent) => void) {
  const callback = useRef(onCommand); callback.current = onCommand;
  const recognition = useRef<{ start(): void; stop(): void; abort(): void } | null>(null);
  const enabled = useRef(false);
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  const [status, setStatus] = useState('未启用');
  const [lastHeard, setLastHeard] = useState('');
  const stop = useCallback(() => {
    enabled.current = false;
    try { recognition.current?.stop(); } catch { /* 已停止 */ }
    recognition.current = null;
    setActive(false); setStatus('已关闭'); setLastHeard('');
  }, []);
  const start = useCallback(() => {
    const w = window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR || enabled.current) return;
    const r: any = new SR();
    r.lang = 'zh-CN'; r.continuous = true; r.interimResults = true;
    r.onresult = (event: any) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i], text = String(res[0].transcript).trim();
        if (res.isFinal) {
          if (!text) continue;
          setLastHeard(text);
          const cmd = matchVoiceCommand(text);
          if (cmd) { setStatus(`已执行：${text}`); callback.current(cmd); }
          else setStatus(`未识别命令：${text}`);
        } else interim += text;
      }
      if (interim.trim()) setLastHeard(interim.trim());
    };
    r.onerror = (event: any) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        enabled.current = false; setActive(false); setStatus('麦克风权限被拒绝，请在浏览器地址栏允许后重试');
      } else if (event.error !== 'no-speech') setStatus(`语音识别异常：${event.error}`);
    };
    r.onend = () => { if (enabled.current) { try { r.start(); } catch { /* 重复启动 */ } } };
    recognition.current = r; enabled.current = true;
    setActive(true); setStatus('聆听中… 可说：下一页 / 上一页 / 白板 / 课件 / 几何 / 撤销 / 重置 / 提示 / 激光笔 / 关闭语音');
    try { r.start(); } catch { /* 已在运行 */ }
  }, []);
  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    setSupported(!!(w.SpeechRecognition ?? w.webkitSpeechRecognition));
    return () => { enabled.current = false; try { recognition.current?.abort(); } catch { /* 忽略 */ } };
  }, []);
  return { supported, enabled: active, status, lastHeard, start, stop };
}
