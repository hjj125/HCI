// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// 用可控的假手部输入替代摄像头：直接驱动 useHandInput 的采样回调。
const hand = vi.hoisted(() => ({ emit: null as null | ((sample: unknown) => void) }));
vi.mock('./core/useHandInput', () => ({
  useHandInput: (callback: (sample: unknown) => void) => {
    hand.emit = callback;
    return {
      video: { current: null }, start: vi.fn(), stop: vi.fn(), cancel: vi.fn(),
      status: '测试手势输入', enabled: true, loading: false, cursor: null,
    };
  },
}));
import App from './App';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const notice = () => document.querySelector('div[role="status"].help')?.textContent ?? '';

/** 以真实时间间隔送入一串采样，模拟“挥手”。 */
async function wave(from: number, to: number, extra: Record<string, unknown> = {}) {
  const steps = 8, gap = 35;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    act(() => hand.emit!({ x: from + (to - from) * t, y: 0.5, phase: 'update', pinching: false, ...extra }));
    await sleep(gap);
  }
}

beforeEach(() => {
  const ctx = new Proxy({}, { get: () => () => undefined, set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) =>
    type === '2d' ? ctx : null) as never);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // jsdom 未实现 elementFromPoint：start 采样的按钮检查需要它，注入返回空。
  (document as { elementFromPoint?: unknown }).elementFromPoint = vi.fn(() => null);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ features: [] }) })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); hand.emit = null; });

describe('找国家手势', () => {
  it('单手向右挥动给地球旋转冲量并给出反馈', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /◉\s*找国家/ }));
    await wave(0.2, 0.72);
    await waitFor(() => expect(notice()).toContain('已识别向右挥手 · 地球向右旋转'));
  });

  it('向下挥动给俯仰冲量并提示转向北半球', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /◉\s*找国家/ }));
    // 垂直挥手：y 从 0.35 → 0.75（屏幕坐标向下）
    const steps = 8, gap = 35;
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      act(() => hand.emit!({ x: 0.5, y: 0.35 + 0.4 * t, phase: 'update', pinching: false }));
      await sleep(gap);
    }
    await waitFor(() => expect(notice()).toContain('已识别向下挥手 · 视角转向北半球'));
  });

  it('捏合选中国家后撤手不会带动地球旋转（撤手静默期）', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /◉\s*找国家/ }));
    // 捏合选择：start → end
    act(() => hand.emit!({ x: .5, y: .4, phase: 'start', pinching: true }));
    act(() => hand.emit!({ x: .5, y: .4, phase: 'end', pinching: false }));
    // 立刻快速撤手（横向大幅移动，若无静默期会被判定为挥手）
    await wave(0.3, 0.8);
    await sleep(300);
    expect(notice()).not.toContain('已识别向');
  });

  it('捏合长按 0.7 秒直接进入区域详情', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /◉s*找国家/ }));
    act(() => hand.emit!({ x: .5, y: .4, phase: 'start', pinching: true }));
    for (let i = 0; i < 10; i++) {
      act(() => hand.emit!({ x: .5 + (Math.random() - .5) * 0.01, y: .4, phase: 'update', pinching: true }));
      await sleep(90); // 累计约 0.9 秒
    }
    await waitFor(() => expect(notice()).toContain('已进入区域详情'));
  });

  it('双手张合样本与张开手掌悬停不导致崩溃（缩放在 WebGL 不可用时安全跳过）', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /◉\s*找国家/ }));
    act(() => hand.emit!({ x: .3, y: .4, phase: 'update', pinching: false, hands: [{ x: .3, y: .5 }, { x: .6, y: .5 }], openPalm: true }));
    await sleep(50);
    act(() => hand.emit!({ x: .3, y: .4, phase: 'update', pinching: false, hands: [{ x: .3, y: .5 }, { x: .7, y: .5 }], openPalm: true }));
    await sleep(50);
    expect(screen.getByText('实验一 · 找国家')).toBeTruthy();   // 页面仍然健康
    expect(notice()).not.toContain('不可用');
  });
});
