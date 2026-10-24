import { readFileSync } from 'node:fs';
import type { Plugin, Connect } from 'vite';

/**
 * AI 讲解服务端代理（DeepSeek，流式）。
 * API key 保存在项目根目录 .env（DEEPSEEK_API_KEY），只存在于本机服务端，永不下发浏览器。
 * POST /api/llm/chat  { region, continent, messages: [{role:'user'|'assistant', content}] }
 * 返回 text/event-stream：data: {"delta":"…"} 逐段输出，最后 data: [DONE]。
 * 安全规则与本机 PowerPoint 桥接一致：仅 localhost、校验同源与自定义头、限流限额。
 */
export type ChatMessage = { role: 'user' | 'assistant'; content: string };

function readEnv(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  try {
    const raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[1] === key) {
        const value = m[2].replace(/^["']|["']$/g, '').trim();
        if (value) return value;
      }
    }
  } catch { /* 无 .env 文件 */ }
  return undefined;
}

function systemPrompt(region: string, continent: string): string {
  return `你是中学地理课堂的讲解助手，当前讨论的区域是「${region}」（位于${continent}，大洲仅作背景）。`
    + '第一条回复请严格按【区位】【地形地貌】【人文特征】【追问】四个板块介绍该区域本身；'
    + '之后每条回复不超过 150 字，准确、通俗，鼓励学生观察与探究。不要使用 Markdown。';
}

/** 调用 DeepSeek 并以异步迭代器逐段产出增量文本（可注入替换以便测试）。 */
export async function* callDeepSeekStream(region: string, continent: string, messages: ChatMessage[], apiKey: string): AsyncGenerator<string> {
  const baseUrl = readEnv('DEEPSEEK_BASE_URL') ?? 'https://api.deepseek.com';
  const model = readEnv('DEEPSEEK_MODEL') ?? 'deepseek-chat';
  const res = await fetch(baseUrl.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt(region, continent) },
        ...messages.map(m => ({ role: m.role, content: m.content.slice(0, 1000) })),
      ],
      temperature: 0.7, max_tokens: 700,
    }),
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok || !res.body) throw new Error(`upstream ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
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
      if (payload === '[DONE]') return;
      try {
        const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
        if (delta) yield delta as string;
      } catch { /* 忽略不完整分片 */ }
    }
  }
}

export function createLlmMiddleware(
  stream: (region: string, continent: string, messages: ChatMessage[], apiKey: string) => AsyncGenerator<string> = callDeepSeekStream,
): Connect.NextHandleFunction {
  let lastCall = 0, dailyCount = 0, dailyReset = new Date().toDateString();
  return async (req, res) => {
    const send = (status: number, value: unknown) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.statusCode = status; res.end(JSON.stringify(value));
    };
    const host = req.headers.host ?? '';
    // 与 PowerPoint 桥接相同的本地安全规则：仅本机、同源、自定义头，杜绝第三方页面借 key 代理调用。
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ||
      (req.headers.origin && req.headers.origin !== `http://${host}` && req.headers.origin !== `https://${host}`) ||
      req.headers['x-embodiededu'] !== 'local-control') {
      send(403, { error: '仅允许本机工作台访问 AI 讲解接口。' }); return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    // 兼容挂载时已剥前缀（/chat）与全路径（/api/llm/chat）两种形式。
    if (req.method !== 'POST' || !url.pathname.endsWith('/chat')) { send(400, { error: '无效的 AI 请求。' }); return; }
    const apiKey = readEnv('DEEPSEEK_API_KEY');
    if (!apiKey) { send(503, { configured: false, error: 'AI 讲解未配置：请在项目根目录 .env 填入 DEEPSEEK_API_KEY 并重启服务（见 README）。' }); return; }
    if (Date.now() - lastCall < 800) { send(429, { error: '请求过于频繁，请稍候。' }); return; }
    const today = new Date().toDateString();
    if (today !== dailyReset) { dailyReset = today; dailyCount = 0; }
    if (dailyCount >= 300) { send(429, { error: '今日 AI 额度已用完（300 次/天）。' }); return; }
    // 读取请求体：区域 + 对话历史（最多保留最近 10 条，防止滥用）。
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    let region = '', continent = '该大洲'; let messages: ChatMessage[] = [];
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      region = String(parsed.region ?? '').slice(0, 80);
      continent = String(parsed.continent ?? '该大洲').slice(0, 40);
      if (Array.isArray(parsed.messages)) messages = parsed.messages.slice(-10);
    } catch { /* 保持默认 */ }
    if (!region || messages.length === 0) { send(400, { error: '缺少区域或提问内容。' }); return; }
    lastCall = Date.now(); dailyCount++;
    // SSE 流式响应：逐段转发增量文本。
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    res.statusCode = 200;
    try {
      for await (const delta of stream(region, continent, messages, apiKey)) {
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
      res.write('data: [DONE]\n\n');
    } catch {
      res.write(`data: ${JSON.stringify({ error: 'AI 讲解生成中断，请重试。' })}\n\n`);
    } finally { res.end(); }
  };
}

export function llmPlugin(): Plugin {
  return {
    name: 'embodiededu-llm',
    configureServer(server) { server.middlewares.use('/api/llm', createLlmMiddleware()); },
    configurePreviewServer(server) { server.middlewares.use('/api/llm', createLlmMiddleware()); },
  };
}
