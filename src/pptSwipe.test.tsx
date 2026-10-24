// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// 用一个可控的假手部输入替代摄像头：测试直接驱动 useHandInput 的采样回调。
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
const page = () => document.querySelector('.eyebrow')?.textContent ?? '';
const notice = () => document.querySelector('div[role="status"].help')?.textContent ?? '';

/** 以真实时间间隔送入一串采样，模拟“挥手”。 */
async function wave(from: number, to: number, options: { steps?: number; gap?: number; pinching?: boolean; y0?: number; y1?: number } = {}) {
  const { steps = 8, gap = 35, pinching = false, y0 = 0.5, y1 = 0.5 } = options;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    act(() => hand.emit!({ x: from + (to - from) * t, y: y0 + (y1 - y0) * t, phase: 'update', pinching }));
    await sleep(gap);
  }
}

beforeEach(() => {
  const ctx = new Proxy({}, { get: () => () => undefined, set: () => true });
  // jsdom 没有 WebGL：几何视图走降级分支；白板需要一个能接受调用的 2D 上下文。
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) =>
    type === '2d' ? ctx : null) as never);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  hand.emit = null;
});

describe('挥手翻页', () => {
  it('向右挥手翻到下一页，并给出识别反馈', async () => {
    render(<App />);
    expect(page()).toContain('1 / 3');
    await wave(0.2, 0.72);
    await waitFor(() => expect(page()).toContain('2 / 3'));
    expect(notice()).toContain('向右挥手');
  });

  it('向左挥手回到上一页', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /下一页/ }));
    expect(page()).toContain('2 / 3');
    await wave(0.75, 0.25);
    await waitFor(() => expect(page()).toContain('1 / 3'));
    expect(notice()).toContain('向左挥手');
  });

  it('捏合状态下的横向移动不翻页（避免伸手去点按钮时误翻）', async () => {
    render(<App />);
    await wave(0.2, 0.72, { pinching: true });
    expect(page()).toContain('1 / 3');
  });

  it('持续捏合（放松手型）下的大幅挥动也能翻页', async () => {
    render(<App />);
    // 捏合开始后有 0.3 秒静默；挥动持续超过静默期后应能翻页。
    await wave(0.15, 0.8, { steps: 16, gap: 40, pinching: true });
    await waitFor(() => expect(page()).toContain('2 / 3'));
  });

  it('一边挥舞一边大幅上下移动不翻页', async () => {
    render(<App />);
    await wave(0.2, 0.72, { y0: 0.25, y1: 0.75 });
    expect(page()).toContain('1 / 3');
  });

  it('本机 PowerPoint 模式下挥手直接调用翻页接口', async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ connected: true, presenting: true, file: 'demo.pptx', current: 1, total: 3 }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: '本机 PowerPoint' }));
    await screen.findByText(/demo\.pptx/);

    await wave(0.2, 0.72);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('action=next'), expect.anything()));
  });

  it('白板里左右移动仍然是绘制，不会翻页', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /✎\s*白板/ }));
    await wave(0.2, 0.72);
    fireEvent.click(screen.getByRole('button', { name: /▤\s*课件/ }));
    expect(page()).toContain('1 / 3');
  });
});

describe('课件激光笔手势', () => {
  it('比“2”手势命令开关激光笔', () => {
    render(<App />);
    const laser = screen.getByRole('button', { name: '激光笔' });
    expect(laser.className).not.toContain('selected');
    act(() => hand.emit!({ x: .5, y: .5, phase: 'update', pinching: false, command: 'laser' }));
    expect(laser.className).toContain('selected');
    act(() => hand.emit!({ x: .5, y: .5, phase: 'update', pinching: false, command: 'laser' }));
    expect(laser.className).not.toContain('selected');
  });
});

describe('白板手势工具切换', () => {
  it('指向画笔/橡皮按钮捏合即可切换工具', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /✎\s*白板/ }));
    const pen = screen.getByRole('button', { name: '画笔' });
    const eraser = screen.getByRole('button', { name: '橡皮' });
    expect(pen.className).toContain('selected');
    // 手势指针落在橡皮按钮上并捏合：走与课件按钮相同的“指向+捏合=点击”路径。
    // jsdom 未实现 elementFromPoint，直接注入返回橡皮按钮。
    document.elementFromPoint = vi.fn(() => eraser);
    act(() => hand.emit!({ x: 0.42, y: 0.18, phase: 'start', pinching: true }));
    delete (document as { elementFromPoint?: unknown }).elementFromPoint;
    expect(eraser.className).toContain('selected');
    expect(pen.className).not.toContain('selected');
  });

  it('数字手势命令切换画笔/橡皮', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /✎\s*白板/ }));
    const pen = screen.getByRole('button', { name: '画笔' });
    const eraser = screen.getByRole('button', { name: '橡皮' });
    // 模拟手部识别发出“比 3 → 橡皮”命令
    act(() => hand.emit!({ x: .5, y: .5, phase: 'update', pinching: false, command: 'eraser' }));
    expect(eraser.className).toContain('selected');
    // 再“比 2 → 画笔”切回
    act(() => hand.emit!({ x: .5, y: .5, phase: 'update', pinching: false, command: 'pen' }));
    expect(pen.className).toContain('selected');
  });
});
