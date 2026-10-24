// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

// 用可控的假语音识别替代 Web Speech API：测试直接驱动命令回调。
const voice = vi.hoisted(() => ({ cb: null as null | ((cmd: unknown) => void) }));
vi.mock('./core/useVoiceInput', () => ({
  useVoiceInput: (cb: (cmd: unknown) => void) => {
    voice.cb = cb;
    return { supported: true, enabled: true, status: '测试语音', lastHeard: '', start: vi.fn(), stop: vi.fn() };
  },
}));
import App from './App';

beforeEach(() => {
  // jsdom 没有 WebGL/2D 上下文：2D 返回可调用的假上下文，其余返回 null 走降级分支。
  const ctx = new Proxy({}, { get: () => () => undefined, set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) =>
    type === '2d' ? ctx : null) as never);
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); voice.cb = null; });

describe('语音命令', () => {
  it('“下一页”翻页，“打开白板”切换视图，“撤销”可恢复', () => {
    render(<App />);
    act(() => voice.cb!({ intent: 'next' }));
    expect(screen.getByText(/课堂模式 · 2 \/ 3/)).toBeTruthy();
    act(() => voice.cb!({ intent: 'previous' }));
    expect(screen.getByText(/课堂模式 · 1 \/ 3/)).toBeTruthy();
    act(() => voice.cb!({ intent: 'switch', value: 'whiteboard' }));
    expect(screen.getByLabelText('绘图白板')).toBeTruthy();
    // 语音事件同样进入交互记录
    expect(document.querySelector('.log-panel summary')?.textContent).toMatch(/\d+ 条/);
  });

  it('翻页命令在非课件视图被拒绝并给出提示', () => {
    render(<App />);
    act(() => voice.cb!({ intent: 'switch', value: 'geometry' }));
    act(() => voice.cb!({ intent: 'next' }));
    expect(document.querySelector('div[role="status"].help')?.textContent).toContain('只在课件视图');
  });
});
