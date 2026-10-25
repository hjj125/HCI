/** 教学常用国家首都内置表（确定性、离线）：
 *  语音定位/选中时，黄点落在首都并显示首都名；表中没有的国家由 DeepSeek 兜底（缓存到 localStorage）。
 *  坐标为公开常识数据（WGS84 近似，教学演示精度足够）。
 */
export type Capital = { zh: string; lat: number; lon: number };
export const CAPITALS: Record<string, Capital> = {
  'China': { zh: '北京', lat: 39.90, lon: 116.40 },
  'Japan': { zh: '东京', lat: 35.68, lon: 139.69 },
  'United States of America': { zh: '华盛顿', lat: 38.90, lon: -77.04 },
  'United Kingdom': { zh: '伦敦', lat: 51.51, lon: -0.13 },
  'France': { zh: '巴黎', lat: 48.86, lon: 2.35 },
  'Germany': { zh: '柏林', lat: 52.52, lon: 13.40 },
  'Russia': { zh: '莫斯科', lat: 55.76, lon: 37.62 },
  'India': { zh: '新德里', lat: 28.61, lon: 77.21 },
  'Korea': { zh: '首尔', lat: 37.57, lon: 126.98 },
  'Dem. Rep. Korea': { zh: '平壤', lat: 39.03, lon: 125.75 },
  'Egypt': { zh: '开罗', lat: 30.04, lon: 31.24 },
  'Australia': { zh: '堪培拉', lat: -35.28, lon: 149.13 },
  'Brazil': { zh: '巴西利亚', lat: -15.79, lon: -47.88 },
  'Argentina': { zh: '布宜诺斯艾利斯', lat: -34.60, lon: -58.38 },
  'Canada': { zh: '渥太华', lat: 45.42, lon: -75.70 },
  'Italy': { zh: '罗马', lat: 41.90, lon: 12.50 },
  'Spain': { zh: '马德里', lat: 40.42, lon: -3.70 },
  'Indonesia': { zh: '雅加达', lat: -6.21, lon: 106.85 },
  'South Africa': { zh: '比勒陀利亚', lat: -25.75, lon: 28.19 },
  'Turkey': { zh: '安卡拉', lat: 39.93, lon: 32.86 },
};
/** localStorage 缓存：AI 返回的首都坐标（键为 GeoJSON NAME）。 */
const CACHE_KEY = 'embodiededu-capitals';
export function capitalOf(name: string): Capital | undefined {
  if (CAPITALS[name]) return CAPITALS[name];
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Record<string, Capital>;
    return cached[name];
  } catch { return undefined; }
}
export function cacheCapital(name: string, cap: Capital) {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Record<string, Capital>;
    cached[name] = cap;
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
  } catch { /* 存储不可用时静默 */ }
}

/** 解析首都（带弹窗提示状态回调）：内置表/缓存命中立即返回；否则询问 DeepSeek 并缓存。 */
export async function resolveCapital(
  regionZh: string, name: string,
  onAsk?: () => void,
): Promise<{ capital: Capital; source: 'builtin' | 'cache' | 'ai' } | null> {
  const local = capitalOf(name);
  if (local) return { capital: local, source: CAPITALS[name] ? 'builtin' : 'cache' };
  onAsk?.();
  try {
    const res = await fetch('/api/llm/capital', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-EmbodiedEdu': 'local-control' },
      body: JSON.stringify({ region: regionZh }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.capital || !isFinite(data.lat)) return null;
    const cap = { zh: String(data.capital), lat: Number(data.lat), lon: Number(data.lon) };
    cacheCapital(name, cap);
    return { capital: cap, source: 'ai' };
  } catch { return null; }
}
