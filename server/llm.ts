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
    + '第一条回复的结构：'
    + '① 用【区位】开场，2–3 句说明经纬度位置、海陆位置与相邻区域；'
    + '② 自选 3–5 个最能体现该区域特色的板块，板块名自拟并加【】，从以下方面挑选：'
    + '地形地貌、气候、河流与湖泊、自然资源、自然灾害、植被与动物、农业与物产、工业与经济、'
    + '交通与城市、人口分布、语言与宗教、历史文化、世界遗产、环境问题（也可补充其他贴切方面）；'
    + '③ 最后一个板块固定为【追问】：提出一个把前面板块联系起来、引导学生探究的思考题（一句话）。'
    + '每个板块不超过 90 字，准确、通俗，讲清“为什么”；不要使用 Markdown。'
    + '之后每条回复不超过 150 字，鼓励学生观察与探究。';
}

/** 询问 DeepSeek 某国首都名与坐标（非流式，一次性 JSON）。返回 null 表示失败。 */
export async function askCapital(region: string, apiKey: string): Promise<{ capital: string; lat: number; lon: number } | null> {
  const baseUrl = readEnv('DEEPSEEK_BASE_URL') ?? 'https://api.deepseek.com';
  const model = readEnv('DEEPSEEK_MODEL') ?? 'deepseek-chat';
  const res = await fetch(baseUrl.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: '你是地理数据助手。只输出 JSON，格式：{"capital":"首都中文名","lat":数字纬度,"lon":数字经度}，不要任何其他文字。' },
        { role: 'user', content: '给出' + region + '的首都中文名与经纬度坐标（WGS84）。' },
      ],
      temperature: 0, max_tokens: 100,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) return null;
  try {
    const raw: string = (await res.json())?.choices?.[0]?.message?.content ?? '';
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const data = JSON.parse(m[0]);
    const lat = Number(data.lat), lon = Number(data.lon);
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { capital: String(data.capital ?? ''), lat, lon };
  } catch { return null; }
}

/** 调用 DeepSeek 并以异步迭代器逐段产出增量文本（可注入替换以便测试）。 */
export async function* callDeepSeekStream(region: string, continent: string, messages: ChatMessage[], apiKey: string): AsyncGenerator<string> {
  yield* callAgentStream(systemPrompt(region, continent), messages.map(m => ({ role: m.role, content: m.content })), apiKey, { temperature: 0.7, maxTokens: 700 });
}

/** 通用 DeepSeek 流式调用：system + messages（地理讲解与灵犀智能体共用底层；可注入替换以便测试）。 */
export async function* callAgentStream(system: string, messages: ChatMessage[], apiKey: string, opts: { temperature?: number; maxTokens?: number } = {}): AsyncGenerator<string> {
  const baseUrl = readEnv('DEEPSEEK_BASE_URL') ?? 'https://api.deepseek.com';
  const model = readEnv('DEEPSEEK_MODEL') ?? 'deepseek-chat';
  const res = await fetch(baseUrl.replace(/\/$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        { role: 'system', content: system },
        ...messages.map(m => ({ role: m.role, content: m.content.slice(0, 1000) })),
      ],
      temperature: opts.temperature ?? 0.7, max_tokens: opts.maxTokens ?? 700,
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

/** 灵犀默认参数：短回复、低 token（面向面板气泡）。 */
export async function* callLingXiStream(system: string, messages: ChatMessage[], apiKey: string): AsyncGenerator<string> {
  yield* callAgentStream(system, messages, apiKey, { temperature: 0.7, maxTokens: 300 });
}

/** 灵犀（具身教学智能体）人设：narrate=把规则计划的事实改写成口语引导；ask=回答学生自由提问。 */
export function agentSystemPrompt(mode: string, sceneTitle: string): string {
  if (mode === 'narrate') return '你是课堂里的具身教学智能体「灵犀」。基于给定的实验状态快照与最近操作，用中文口语写 1–2 句引导（总共不超过 60 字），面向中学生，亲切自然，结尾可带一个简短的探究性问题。只能使用给定事实，不要编造数据；不要使用 Markdown。';
  return `你是中学课堂的 AI 教学智能体「灵犀」，正在指导学生做「${sceneTitle}」实验。结合给定的实验状态与最近操作回答学生提问：口语化、不超过 150 字、面向中学生；先肯定学生的尝试，再给方向性引导（不要直接给出完整答案），结尾提一个探究性问题。不要使用 Markdown。`;
}

type AgentEventLine = { source?: unknown; intent?: unknown; phase?: unknown; value?: unknown };
type AgentBody = {
  scene: string; sceneTitle: string; mode: 'narrate' | 'ask';
  snapshot: Record<string, unknown>;
  events: AgentEventLine[];
  question?: string;
  history?: ChatMessage[];
};

/** 灵犀请求的上下文块：只有快照元数据、语义事件与提问文本（不含摄像头画面与音频）。 */
export function agentUserContent(b: AgentBody): string {
  const events = b.events.slice(-12)
    .map(e => `${String(e.source ?? '?')}·${String(e.intent ?? '?')}${e.value ? `[${String(e.value).slice(0, 24)}]` : ''}`)
    .join('，');
  return [
    `实验：${b.sceneTitle}（${b.scene}）`,
    `状态快照：${JSON.stringify(b.snapshot ?? {}).slice(0, 1800)}`,
    events ? `最近操作：${events}` : '',
    b.question ? `学生提问：${b.question}` : '',
  ].filter(Boolean).join('\n');
}

export function createLlmMiddleware(
  stream: (region: string, continent: string, messages: ChatMessage[], apiKey: string) => AsyncGenerator<string> = callDeepSeekStream,
  options: {
    apiKey?: string;
    askCapital?: (region: string, apiKey: string) => Promise<{ capital: string; lat: number; lon: number } | null>;
    /** 灵犀流（可注入替换以便测试）。 */
    agentStream?: (system: string, messages: ChatMessage[], apiKey: string) => AsyncGenerator<string>;
  } = {},
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
    // /chat：流式讲解；/capital：一次性首都坐标查询；/agent：灵犀教学智能体（同一限流与额度）。
    if (req.method !== 'POST' || (!url.pathname.endsWith('/chat') && !url.pathname.endsWith('/capital') && !url.pathname.endsWith('/agent'))) { send(400, { error: '无效的 AI 请求。' }); return; }
    const apiKey = readEnv('DEEPSEEK_API_KEY');
    const askCap = options.askCapital ?? askCapital;
    if (!apiKey) { send(503, { configured: false, error: 'AI 讲解未配置：请在项目根目录 .env 填入 DEEPSEEK_API_KEY 并重启服务（见 README）。' }); return; }
    if (Date.now() - lastCall < 800) { send(429, { error: '请求过于频繁，请稍候。' }); return; }
    const today = new Date().toDateString();
    if (today !== dailyReset) { dailyReset = today; dailyCount = 0; }
    if (dailyCount >= 300) { send(429, { error: '今日 AI 额度已用完（300 次/天）。' }); return; }
    // 读取请求体：/agent 为场景上下文（快照+事件+提问）；其余为区域 + 对话历史（最多 10 条，防滥用）。
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const isAgent = url.pathname.endsWith('/agent');
    let region = '', continent = '该大洲'; let messages: ChatMessage[] = [];
    let agentBody: AgentBody | null = null;
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (isAgent) {
        agentBody = {
          scene: String(parsed.scene ?? '').slice(0, 40),
          sceneTitle: String(parsed.sceneTitle ?? '').slice(0, 40) || '课堂实验',
          mode: parsed.mode === 'narrate' ? 'narrate' : 'ask',
          snapshot: parsed.snapshot && typeof parsed.snapshot === 'object' && !Array.isArray(parsed.snapshot) ? parsed.snapshot : {},
          events: Array.isArray(parsed.events) ? parsed.events.slice(-12) : [],
          question: parsed.question ? String(parsed.question).slice(0, 500) : undefined,
          history: Array.isArray(parsed.history) ? parsed.history.slice(-10) : [],
        };
      } else {
        region = String(parsed.region ?? '').slice(0, 80);
        continent = String(parsed.continent ?? '该大洲').slice(0, 40);
        if (Array.isArray(parsed.messages)) messages = parsed.messages.slice(-10);
      }
    } catch { /* 保持默认 */ }
    if (isAgent) {
      if (!agentBody?.scene) { send(400, { error: '缺少场景标识。' }); return; }
      if (agentBody.mode === 'ask' && !agentBody.question) { send(400, { error: '缺少提问内容。' }); return; }
    } else {
      if (!region) { send(400, { error: '缺少区域名称。' }); return; }
      if (url.pathname.endsWith('/chat') && messages.length === 0) { send(400, { error: '缺少提问内容。' }); return; }
    }
    lastCall = Date.now(); dailyCount++;
    // /capital：一次性 JSON 返回首都坐标（DeepSeek 兜底，内置表/缓存在前端）。
    if (url.pathname.endsWith('/capital')) {
      try {
        const cap = await askCap(region, apiKey);
        if (cap) { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(cap)); }
        else send(502, { error: 'AI 首都查询失败，请稍后重试。' });
      } catch { send(502, { error: 'AI 首都查询异常。' }); }
      return;
    }
    // SSE 流式响应：逐段转发增量文本（灵犀走 agentStream，地理讲解走 stream）。
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Accel-Buffering', 'no');
    res.statusCode = 200;
    const agentFn = options.agentStream ?? callLingXiStream;
    const upstream = agentBody
      ? agentFn(agentSystemPrompt(agentBody.mode, agentBody.sceneTitle),
        [...(agentBody.history ?? []), { role: 'user', content: agentUserContent(agentBody) }], apiKey)
      : stream(region, continent, messages, apiKey);
    try {
      for await (const delta of upstream) {
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
