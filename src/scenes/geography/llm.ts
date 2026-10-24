/** AI 讲解（前端）：流式调用本机服务端代理 /api/llm/chat。
 *  DeepSeek key 保存在服务端 .env，对用户完全透明；本模块不接触任何密钥。
 */
export type ChatMessage = { role: 'user' | 'assistant'; content: string };

/** 发起一轮对话并流式回调增量文本；返回 'ok' | 'unconfigured' | 'error'。 */
export async function streamRegionChat(
  regionZh: string, continent: string, history: ChatMessage[], onDelta: (delta: string) => void,
): Promise<'ok' | 'unconfigured' | 'error'> {
  try {
    const res = await fetch('/api/llm/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EmbodiedEdu': 'local-control' },
      body: JSON.stringify({ region: regionZh, continent, messages: history.slice(-10) }),
      signal: AbortSignal.timeout(65000),
    });
    if (res.status === 503) return 'unconfigured';
    if (!res.ok || !res.body) return 'error';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', received = false;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (payload === '[DONE]') return 'ok';
        try {
          const data = JSON.parse(payload);
          if (data.delta) { received = true; onDelta(data.delta as string); }
          if (data.error) return received ? 'ok' : 'error';
        } catch { /* 忽略不完整分片 */ }
      }
    }
    return received ? 'ok' : 'error';
  } catch { return 'error'; }
}
