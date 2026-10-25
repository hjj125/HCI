import { describe, it, expect } from 'vitest';
import { alignTexts, score, normalize } from './recite';
import { POEMS, poemText } from './poems';

describe('背诵镜内核 · 字符对齐', () => {
  it('完全一致 → 全部正确，完整度 1', () => {
    const units = alignTexts('床前明月光', '床前明月光');
    expect(units.every(u => u.status === 'match')).toBe(true);
    expect(score(units).completeness).toBe(1);
  });
  it('漏字：床前光 → 中间两字标 missing，顺序保持', () => {
    const units = alignTexts('床前明月光', '床前光');
    expect(units.map(u => u.status)).toEqual(['match', 'match', 'missing', 'missing', 'match']);
    const s = score(units);
    expect(s.missing).toEqual(['明', '月']);
    expect(s.completeness).toBeCloseTo(3 / 5, 9);
  });
  it('错字：霜→霜打错字，标注原文', () => {
    const units = alignTexts('疑是地上霜', '疑是地上双');
    const s = score(units);
    expect(s.wrong).toEqual(['双（应为「霜」）']);
    expect(s.completeness).toBeCloseTo(4 / 5, 9);
  });
  it('多字：结尾添字标 extra', () => {
    const units = alignTexts('低头思故乡', '低头思故乡啊');
    expect(units.filter(u => u.status === 'extra').map(u => u.heard)).toEqual(['啊']);
  });
  it('标点与空白归一化：带标点的原文 vs 口语转写全部对上', () => {
    const units = alignTexts('床前明月光，疑是地上霜。', '床前明月光疑是地上霜');
    expect(score(units).completeness).toBe(1);
  });
  it('空转写 → 全部漏字，完整度 0', () => {
    const s = score(alignTexts('千山鸟飞绝', ''));
    expect(s.completeness).toBe(0);
    expect(s.missing).toEqual([...normalize('千山鸟飞绝')]);
  });
  it('双方皆空 → 完整度 1（无内容可背）', () => {
    expect(score(alignTexts('', '')).completeness).toBe(1);
  });
  it('重复字句不错位（"鹅鹅鹅"）', () => {
    const units = alignTexts('鹅鹅鹅', '鹅鹅鹅');
    expect(units.every(u => u.status === 'match')).toBe(true);
    const oneShort = alignTexts('鹅鹅鹅', '鹅鹅');
    expect(score(oneShort).missing).toEqual(['鹅']);
  });
});

describe('篇目库', () => {
  it('8 首篇目、标题作者齐全、句子拼接为全文', () => {
    expect(POEMS.length).toBeGreaterThanOrEqual(8);
    for (const p of POEMS) {
      expect(p.title.length).toBeGreaterThan(0);
      expect(p.author).toBeTruthy();
      expect(poemText(p).length).toBeGreaterThan(10);
    }
  });
  it('每首句子数为偶数（听写模式按联出题）', () => {
    for (const p of POEMS) expect(p.sentences.length % 2).toBe(0);
  });
});
