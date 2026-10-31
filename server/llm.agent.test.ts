import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { agentSystemPrompt, agentUserContent, createLlmMiddleware, type ChatMessage } from './llm';

function call(middleware: ReturnType<typeof createLlmMiddleware>, options: { host?: string; origin?: string; token?: string; body?: string; path?: string } = {}) {
  const writes: string[] = [];
  const req = Object.assign(new EventEmitter(), {
    url: `/api/llm${options.path ?? '/agent'}`, method: 'POST',
    headers: { host: options.host ?? '127.0.0.1:5173', origin: options.origin ?? 'http://127.0.0.1:5173', 'x-embodiededu': options.token ?? 'local-control' },
    async *[Symbol.asyncIterator]() { if (options.body) yield Buffer.from(options.body); },
  });
  const res: any = {
    statusCode: 0, headers: {},
    setHeader: (k: string, v: string) => { res.headers[k] = v; },
    write: (c: string) => { writes.push(c); },
    end: (v?: string) => { if (v) res.body = v; },
  };
  return middleware(req as any, res).then(() => ({ status: res.statusCode, body: res.body ? JSON.parse(res.body) : null, stream: writes.join(''), headers: res.headers }));
}

const agentBody = JSON.stringify({
  scene: 'functions', sceneTitle: '人体函数绘图仪', mode: 'ask',
  snapshot: { strokes: 3, lastFit: null, task: 'B' },
  events: [{ source: 'mouse', intent: 'drag', phase: 'end' }, { source: 'hand', intent: 'drag', phase: 'update' }],
  question: '为什么我一直画不出正弦？',
  history: [{ role: 'user', content: '上一问' }, { role: 'assistant', content: '上一答' }],
});

describe('灵犀智能体接口 /api/llm/agent', () => {
  it('ask 模式：SSE 流式返回；上游收到灵犀人设 + 快照/事件/提问上下文', async () => {
    let captured: { system: string; messages: ChatMessage[] } | null = null;
    async function* fake(system: string, messages: ChatMessage[]) {
      captured = { system, messages: messages.map(m => ({ ...m })) };
      yield 'a';
    }
    const r = await call(createLlmMiddleware(() => (async function* () { yield 'geo'; })(), { apiKey: 'k', agentStream: fake }), { body: agentBody });
    expect(r.status).toBe(200);
    expect(r.headers['Content-Type']).toContain('text/event-stream');
    expect(r.stream).toContain('data: {"delta":"a"}');
    expect(r.stream.trimEnd().endsWith('data: [DONE]')).toBe(true);
    expect(captured!.system).toContain('灵犀');
    const last = captured!.messages[captured!.messages.length - 1];
    expect(last.role).toBe('user');
    expect(last.content).toContain('实验：人体函数绘图仪（functions）');
    expect(last.content).toContain('"strokes":3');
    expect(last.content).toContain('最近操作：mouse·drag，hand·drag');
    expect(last.content).toContain('学生提问：为什么我一直画不出正弦？');
    expect(captured!.messages).toHaveLength(3); // 2 条历史 + 1 条上下文
  });

  it('narrate 模式无需提问，历史最多保留 10 条', async () => {
    let count = -1;
    async function* fake(_s: string, messages: ChatMessage[]) { count = messages.length; yield '引导语'; }
    const longHistory = Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` } as ChatMessage));
    const r = await call(createLlmMiddleware(() => (async function* () { yield 'x'; })(), { apiKey: 'k', agentStream: fake }),
      { body: JSON.stringify({ scene: 'chem-molecule', sceneTitle: '分子搭建', mode: 'narrate', snapshot: {}, events: [], history: longHistory }) });
    expect(r.status).toBe(200);
    expect(count).toBe(11); // 10 条历史 + 1 条上下文
  });

  it('缺场景标识 / ask 缺提问 → 400', async () => {
    const m = createLlmMiddleware(() => (async function* () { yield 'x'; })(), { apiKey: 'k' });
    expect((await call(m, { body: JSON.stringify({ sceneTitle: 'x', mode: 'ask', question: 'q' }) })).status).toBe(400);
    expect((await call(m, { body: JSON.stringify({ scene: 'functions', mode: 'ask' }) })).status).toBe(400);
  });

  it('安全规则与地理讲解一致：远端主机 403', async () => {
    const r = await call(createLlmMiddleware(() => (async function* () { yield 'x'; })(), { apiKey: 'k' }), { host: 'evil.example', body: agentBody });
    expect(r.status).toBe(403);
  });

  it('快速连续请求触发 429 冷却', async () => {
    const m = createLlmMiddleware(() => (async function* () { yield 'x'; })(), { apiKey: 'k', agentStream: () => (async function* () { yield 'x'; })() });
    expect((await call(m, { body: agentBody })).status).toBe(200);
    expect((await call(m, { body: agentBody })).status).toBe(429);
  });

  it('未配置 key → 503 且不触达上游', async () => {
    const upstream = vi.fn(() => (async function* () { yield 'x'; })());
    const r = await call(createLlmMiddleware(upstream as any, { apiKey: '', agentStream: upstream as any }), { body: agentBody });
    if (r.status === 200) return; // 本机 .env 已配置时跳过
    expect(r.status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe('灵犀上下文与人设（纯函数）', () => {
  it('agentUserContent 组装快照/事件/提问，并截断超长快照', () => {
    const text = agentUserContent({
      scene: 'chem-molecule', sceneTitle: '分子搭建', mode: 'ask',
      snapshot: { big: 'x'.repeat(3000) },
      events: [{ source: 'hand', intent: 'drag', phase: 'update', value: undefined }, { source: 'voice', intent: 'switch', phase: 'end' }],
      question: '什么是价键？',
    });
    expect(text).toContain('实验：分子搭建（chem-molecule）');
    expect(text).toContain('学生提问：什么是价键？');
    expect(text).toContain('最近操作：hand·drag，voice·switch');
    expect(text.length).toBeLessThan(2200);
  });
  it('人设：narrate 强调只基于事实，ask 面向学生提问', () => {
    expect(agentSystemPrompt('narrate', '分子搭建')).toContain('不要编造');
    expect(agentSystemPrompt('ask', '分子搭建')).toContain('不要直接给出完整答案');
  });
});
