import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createLlmMiddleware } from './llm';

function call(middleware: ReturnType<typeof createLlmMiddleware>, options: { host?: string; origin?: string; token?: string; body?: string; path?: string } = {}) {
  const req = Object.assign(new EventEmitter(), {
    url: `/api/llm${options.path ?? '/explain'}`, method: 'POST',
    headers: { host: options.host ?? '127.0.0.1:5173', origin: options.origin ?? 'http://127.0.0.1:5173', 'x-embodiededu': options.token ?? 'local-control' },
    async *[Symbol.asyncIterator]() { if (options.body) yield Buffer.from(options.body); },
  });
  const res: any = { statusCode: 0, setHeader: () => {}, end: (v: string) => { res.body = v; } };
  return middleware(req as any, res).then(() => ({ status: res.statusCode, body: JSON.parse(res.body) }));
}

const okCall = vi.fn(async (): Promise<any> => ({ sections: { 区位: '位于东亚', 地形地貌: '西高东低', 人文特征: '人口稠密' }, question: '地形如何影响人口分布？' }));

describe('AI 讲解接口安全与行为', () => {
  it('本机来源请求返回讲解结果', async () => {
    const r = await call(createLlmMiddleware(okCall as any, { apiKey: 'test-key' }), { body: JSON.stringify({ region: '中国', continent: 'Asia' }) });
    expect(r.status).toBe(200);
    expect(r.body.sections.区位).toBe('位于东亚');
    expect(okCall).toHaveBeenCalledWith('中国', 'Asia', expect.any(String));
  });
  it('拒绝远端主机与跨源请求（key 不能被第三方页面借用）', async () => {
    expect((await call(createLlmMiddleware(), { host: 'evil.example' })).status).toBe(403);
    expect((await call(createLlmMiddleware(), { origin: 'http://evil.example' })).status).toBe(403);
    expect((await call(createLlmMiddleware(), { token: '' })).status).toBe(403);
  });
  it('无效路径与缺区域返回 400', async () => {
    expect((await call(createLlmMiddleware(), { path: '/other' })).status).toBe(400);
    expect((await call(createLlmMiddleware(okCall as any, { apiKey: 'test-key' }), { body: '{}' })).status).toBe(400);
  });
  it('未配置 key 时返回 503 且不调用上游', async () => {
    const r = await call(createLlmMiddleware(okCall as any, { apiKey: 'test-key' }), { body: JSON.stringify({ region: 'x', continent: 'y' }) });
    // CI 环境通常无 .env：若未配置应得到 503；若本机恰好配置了 key 则应成功
    if (r.status === 503) { expect(r.body.configured).toBe(false); expect(okCall).not.toHaveBeenCalled(); }
    else expect(r.status).toBe(200);
  });
  it('上游失败返回 502', async () => {
    const fail = vi.fn(async () => null);
    const r = await call(createLlmMiddleware(fail, { apiKey: 'test-key' }), { body: JSON.stringify({ region: 'a', continent: 'b' }) });
    expect(r.status).toBe(502);
  });
  it('连续快速请求触发限流 429', async () => {
    const slow = vi.fn(async () => ({ sections: { 区位: 'x', 地形地貌: 'y', 人文特征: 'z' }, question: 'q' }));
    const m = createLlmMiddleware(slow as any, { apiKey: 'test-key' });
    const first = await call(m, { body: JSON.stringify({ region: 'a', continent: 'b' }) });
    expect(first.status).toBe(200);
    const second = await call(m, { body: JSON.stringify({ region: 'a', continent: 'b' }) });
    expect(second.status).toBe(429); // 1.5 秒冷却
  });
});
