/** AI 讲解（前端）：调用本机服务端代理 /api/llm/explain。
 *  DeepSeek key 保存在服务端 .env，对用户完全透明；本模块不接触任何密钥。
 */
export type Explanation = { sections: Record<'区位' | '地形地貌' | '人文特征', string>; question: string };

export async function explainRegion(regionZh: string, continent: string): Promise<{ data: Explanation | null; reason: 'unconfigured' | 'error' | null }> {
  try {
    const res = await fetch('/api/llm/explain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EmbodiedEdu': 'local-control' },
      body: JSON.stringify({ region: regionZh, continent }),
      signal: AbortSignal.timeout(45000),
    });
    if (res.status === 503) return { data: null, reason: 'unconfigured' };
    if (!res.ok) return { data: null, reason: 'error' };
    const data = await res.json();
    if (!data?.sections?.区位 && !data?.sections?.地形地貌 && !data?.sections?.人文特征) return { data: null, reason: 'error' };
    return { data: data as Explanation, reason: null };
  } catch { return { data: null, reason: 'error' }; }
}
