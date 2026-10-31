/** 灵犀（具身教学智能体）的前端 LLM 通道：调用本机服务端代理 /api/llm/agent。
 *  与地理 AI 讲解共用同一安全规则（仅本机、同源、自定义头、限流）；key 在服务端 .env，本模块不接触密钥。
 *  请求只包含场景快照元数据、语义事件与提问文本——不含摄像头画面与音频。
 */
export type AgentChatMessage = { role: 'user' | 'assistant'; content: string };

export type AgentLlmEvent = { scene: string; source: string; intent: string; phase: string; value?: string };

export type AgentLlmPayload = {
  scene: string;
  sceneTitle: string;
  mode: 'narrate' | 'ask';
  snapshot: Record<string, unknown>;
  events: AgentLlmEvent[];
  question?: string;
  history?: AgentChatMessage[];
};

/** 发起一次灵犀 LLM 请求并流式回调增量文本；返回 'ok' | 'unconfigured' | 'error'。 */
export async function streamAgentChat(payload: AgentLlmPayload, onDelta: (delta: string) => void): Promise<'ok' | 'unconfigured' | 'error'> {
  try {
    const res = await fetch('/api/llm/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EmbodiedEdu': 'local-control' },
      body: JSON.stringify({ ...payload, history: payload.history?.slice(-10) }),
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
        const data = t.slice(5).trim();
        if (data === '[DONE]') return 'ok';
        try {
          const parsed = JSON.parse(data);
          if (parsed.delta) { received = true; onDelta(parsed.delta as string); }
          if (parsed.error) return received ? 'ok' : 'error';
        } catch { /* 忽略不完整分片 */ }
      }
    }
    return received ? 'ok' : 'error';
  } catch { return 'error'; }
}
