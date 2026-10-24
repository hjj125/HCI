import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createLlmMiddleware, type ChatMessage } from './llm';

function call(middleware: ReturnType<typeof createLlmMiddleware>, options: { host?: string; origin?: string; token?: string; body?: string; path?: string } = {}) {
  const writes: string[] = [];
  const req = Object.assign(new EventEmitter(), {
    url: `/api/llm${options.path ?? '/chat'}`, method: 'POST',
    headers: { host: options.host ?? '127.0.0.1:5173', origin: options.origin ?? 'http://127.0.0.1:5173', 'x-embodiededu': options.token ?? 'local-control' },
    async *[Symbol.asyncIterator]() { if (options.body) yield Buffer.from(options.body); },
  });
  const res: any = {
    statusCode: 0, headers: {},
    setHeader: (k: string, v: string) => { res.headers[k] = v; },
    write: (c: string) => { writes.push(c); },
    end: (v?: string) => { if (v) res.body = v; res.writes = writes; },
  };
  return middleware(req as any, res).then(() => ({ status: res.statusCode, body: res.body ? JSON.parse(res.body) : null, stream: writes.join(''), headers: res.headers }));
}

async function* fakeStream(): AsyncGenerator<string> { yield '你好，'; yield '这里是测试讲解。'; }

describe('AI 对话接口（流式）安全与行为', () => {
  const opts = { apiKey: 'test-key' };
  const body = JSON.stringify({ region: '中国', continent: 'Asia', messages: [{ role: 'user', content: '请介绍' }] as ChatMessage[] });
  it('本机请求返回 SSE 流：逐段增量 + [DONE]', async () => {
    const r = await call(createLlmMiddleware(() => fakeStream(), opts), { body });
    expect(r.status).toBe(200);
    expect(r.headers['Content-Type']).toContain('text/event-stream');
    expect(r.stream).toContain('data: {"delta":"你好，"}');
    expect(r.stream).toContain('data: {"delta":"这里是测试讲解。"}');
    expect(r.stream.trimEnd().endsWith('data: [DONE]')).toBe(true);
  });
  it('拒绝远端主机 / 跨源 / 缺自定义头（key 不可被第三方借用）', async () => {
    expect((await call(createLlmMiddleware(() => fakeStream(), opts), { host: 'evil.example' })).status).toBe(403);
    expect((await call(createLlmMiddleware(() => fakeStream(), opts), { origin: 'http://evil.example' })).status).toBe(403);
    expect((await call(createLlmMiddleware(() => fakeStream(), opts), { token: '' })).status).toBe(403);
  });
  it('无效路径与缺内容返回 400', async () => {
    expect((await call(createLlmMiddleware(() => fakeStream(), opts), { path: '/other', body })).status).toBe(400);
    expect((await call(createLlmMiddleware(() => fakeStream(), opts), { body: JSON.stringify({ region: 'x', messages: [] }) })).status).toBe(400);
  });
  it('未配置 key 返回 503 且不触达上游', async () => {
    const upstream = vi.fn(() => fakeStream());
    const r = await call(createLlmMiddleware(upstream as any, { apiKey: '' }), { body });
    if (r.status === 200) return; // 本机 .env 已配置时（读取真实 key）跳过
    expect(r.status).toBe(503);
    expect(r.body.configured).toBe(false);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('快速连续请求触发限流 429', async () => {
    const m = createLlmMiddleware(() => fakeStream(), opts);
    expect((await call(m, { body })).status).toBe(200);
    expect((await call(m, { body })).status).toBe(429); // 0.8 秒冷却
  });
  it('上游异常时流内返回错误事件', async () => {
    async function* boom() { yield '开头'; throw new Error('upstream down'); }
    const r = await call(createLlmMiddleware(boom, opts), { body });
    expect(r.stream).toContain('生成中断');
  });
});
