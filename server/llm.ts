import { readFileSync } from 'node:fs';
import type { Plugin, Connect } from 'vite';

/**
 * AI 讲解服务端代理（DeepSeek）。
 * API key 保存在项目根目录 .env（DEEPSEEK_API_KEY），只存在于本机服务端，
 * 永不下发给浏览器——对课堂用户完全透明。
 * 安全规则与本机 PowerPoint 桥接一致：仅 localhost、校验同源与自定义头、限流限额。
 */
export type Explanation = { sections: Record<'区位' | '地形地貌' | '人文特征', string>; question: string };

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

const SYSTEM_PROMPT = '你是中学地理课堂的讲解助手。输出面向中学生、每个板块不超过 90 字。严格按以下格式输出，不要使用 Markdown：\n【区位】…\n【地形地貌】…\n【人文特征】…\n【追问】提出一个引导探究的思考题（一句话）。';

export async function callDeepSeek(region: string, continent: string, apiKey: string): Promise<Explanation | null> {
  const baseUrl = readEnv('DEEPSEEK_BASE_URL') ?? 'https://api.deepseek.com';
  const model = readEnv('DEEPSEEK_MODEL') ?? 'deepseek-chat';
  const res = await fetch(baseUrl.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `请介绍地理区域：${region}（${continent}）。围绕区位、地形地貌、人文特征三个板块，强调它们之间的联系。` },
      ],
      temperature: 0.7, max_tokens: 600,
    }),
    signal: AbortSignal.timeout(40000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text: string = data?.choices?.[0]?.message?.content ?? '';
  const pick = (label: string) => {
    const m = text.match(new RegExp(`【${label}】\\s*([\\s\\S]*?)(?=【|$)`));
    return m ? m[1].trim() : '';
  };
  const sections = { 区位: pick('区位'), 地形地貌: pick('地形地貌'), 人文特征: pick('人文特征') };
  if (!sections.区位 && !sections.地形地貌 && !sections.人文特征) return null;
  return { sections, question: pick('追问') };
}

export function createLlmMiddleware(
  call: (region: string, continent: string, apiKey: string) => Promise<Explanation | null> = callDeepSeek,
  options: { apiKey?: string } = {},
): Connect.NextHandleFunction {
  let busy = false, lastCall = 0, dailyCount = 0, dailyReset = new Date().toDateString();
  return async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    const send = (status: number, value: unknown) => { res.statusCode = status; res.end(JSON.stringify(value)); };
    const host = req.headers.host ?? '';
    // 与 PowerPoint 桥接相同的本地安全规则：仅本机、同源、自定义头，杜绝第三方页面借 key 代理调用。
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ||
      (req.headers.origin && req.headers.origin !== `http://${host}` && req.headers.origin !== `https://${host}`) ||
      req.headers['x-embodiededu'] !== 'local-control') {
      send(403, { error: '仅允许本机工作台访问 AI 讲解接口。' }); return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    // 兼容挂载时已剥前缀（/explain）与全路径（/api/llm/explain）两种形式。
    if (req.method !== 'POST' || !url.pathname.endsWith('/explain')) { send(400, { error: '无效的 AI 讲解请求。' }); return; }
    const apiKey = options.apiKey ?? readEnv('DEEPSEEK_API_KEY');
    if (!apiKey) { send(503, { configured: false, error: 'AI 讲解未配置：请在项目根目录 .env 填入 DEEPSEEK_API_KEY 并重启服务（见 README）。' }); return; }
    if (busy || Date.now() - lastCall < 1500) { send(429, { error: '请求过于频繁，请稍候。' }); return; }
    const today = new Date().toDateString();
    if (today !== dailyReset) { dailyReset = today; dailyCount = 0; }
    if (dailyCount >= 200) { send(429, { error: '今日 AI 讲解额度已用完（200 次/天）。' }); return; }
    // 读取请求体
    const body: Buffer[] = [];
    for await (const chunk of req) body.push(chunk as Buffer);
    let region = '', continent = '';
    try { const parsed = JSON.parse(Buffer.concat(body).toString('utf8')); region = String(parsed.region ?? ''); continent = String(parsed.continent ?? ''); } catch { /* 保持空 */ }
    if (!region) { send(400, { error: '缺少区域名称。' }); return; }
    busy = true; lastCall = Date.now(); dailyCount++;
    try {
      const explanation = await call(region, continent, apiKey);
      if (explanation) send(200, explanation);
      else send(502, { error: 'AI 讲解生成失败，请稍后重试。' });
    } catch {
      send(502, { error: 'AI 讲解服务异常。' });
    } finally { busy = false; }
  };
}

export function llmPlugin(): Plugin {
  return {
    name: 'embodiededu-llm',
    configureServer(server) { server.middlewares.use('/api/llm', createLlmMiddleware()); },
    configurePreviewServer(server) { server.middlewares.use('/api/llm', createLlmMiddleware()); },
  };
}
