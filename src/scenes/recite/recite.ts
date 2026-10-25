/** 古诗词背诵镜内核：ASR 转写与原文的字符级对齐（Wagner-Fischer 编辑距离 + 回溯）。
 *  定位为形成性工具：ASR 的同音转写无法区分"读错"与"听错"，因此不匹配项一律
 *  标注"与原文不符（可能同音）"，不做判分性评价。
 */

export type AlignStatus = 'match' | 'wrong' | 'missing' | 'extra';
export type AlignUnit = { expected: string | null; heard: string | null; status: AlignStatus; index: number };

/** 去空白与中英文标点（篇目内置固定版本）。 */
export function normalize(text: string): string {
  return text.replace(/[\s，。！？；：、‘’“”《》〈〉（）()\[\]【】,.;:!?'"<>…·\-—_]/g, '');
}

/** 字符级对齐：返回按原文顺序排列的逐字单元。
 *  status：match=正确；wrong=与原文不符（可能同音）；missing=漏字；extra=多出的字。 */
export function alignTexts(expected: string, heard: string): AlignUnit[] {
  const e = [...normalize(expected)];
  const h = [...normalize(heard)];
  const m = e.length, n = h.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (e[i - 1] === h[j - 1] ? 0 : 1),
      );
    }
  }
  const units: AlignUnit[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (e[i - 1] === h[j - 1] ? 0 : 1)) {
      units.push({ expected: e[i - 1], heard: h[j - 1], status: e[i - 1] === h[j - 1] ? 'match' : 'wrong', index: i - 1 });
      i--; j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      units.push({ expected: e[i - 1], heard: null, status: 'missing', index: i - 1 });
      i--;
    } else {
      units.push({ expected: null, heard: h[j - 1], status: 'extra', index: m });
      j--;
    }
  }
  return units.reverse();
}

/** 完整度与错字清单。 */
export function score(units: AlignUnit[]): {
  total: number; matched: number; completeness: number;
  wrong: string[]; missing: string[]; extra: string[];
} {
  const total = units.filter(u => u.expected != null).length;
  const matched = units.filter(u => u.status === 'match').length;
  const wrong = units.filter(u => u.status === 'wrong').map(u => `${u.heard}（应为「${u.expected}」）`);
  const missing = units.filter(u => u.status === 'missing').map(u => `${u.expected}`);
  const extra = units.filter(u => u.status === 'extra').map(u => `${u.heard}`);
  const completeness = total === 0 ? 1 : matched / total;
  return { total, matched, completeness, wrong, missing, extra };
}
