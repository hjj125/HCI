/** DeepSeek 讲解生成（可选在线增强）。
 *  - 显式触发、key 用户自备（localStorage，不入 git）；
 *  - 只发送区域名称等文本，不上传任何本地数据；
 *  - 任何失败返回 null，调用方降级到内置资料卡。
 */
export type LlmConfig = { baseUrl: string; apiKey: string; model: string };
const STORAGE_KEY = 'embodiededu-llm';

export function getLlmConfig(): LlmConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as LlmConfig;
    return c.apiKey ? c : null;
  } catch { return null; }
}

export function saveLlmConfig(config: LlmConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export type Explanation = { sections: Record<'区位' | '地形地貌' | '人文特征', string>; question: string };

/** 生成一个区域的讲解：三个板块 + 一个探究追问。返回 null 表示失败/未配置。 */
export async function explainRegion(regionZh: string, continent: string): Promise<Explanation | null> {
  const config = getLlmConfig();
  if (!config) return null;
  const system = '你是中学地理课堂的讲解助手。输出面向中学生、每个板块不超过 90 字。严格按以下格式输出，不要使用 Markdown：\n【区位】…\n【地形地貌】…\n【人文特征】…\n【追问】提出一个引导探究的思考题（一句话）。';
  const user = `请介绍地理区域：${regionZh}（${continent}）。围绕区位、地形地貌、人文特征三个板块，强调它们之间的联系。`;
  try {
    const res = await fetch(config.baseUrl.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model || 'deepseek-chat', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.7, max_tokens: 600 }),
      signal: AbortSignal.timeout(30000),
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
  } catch { return null; }
}
