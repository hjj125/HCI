// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from './App';
import { POEMS, poemText } from './scenes/recite/poems';

beforeEach(() => {
  const ctx = new Proxy({}, { get: () => () => undefined, set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) =>
    type === '2d' ? ctx : null) as never);
  const originalError = console.error;
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (String(args.join(' ')).includes('THREE.WebGLRenderer')) return;
    originalError(...args);
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ features: [] }) })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const navRecite = () => fireEvent.click(screen.getByRole('button', { name: /文\s*背诵镜/ }));
const sceneSection = () => screen.getByRole('heading', { name: '古诗词背诵镜' }).closest('section') as HTMLElement;

describe('语文 · 古诗词背诵镜场景', () => {
  it('场景接入：任务页签、篇目选择与原文显示', () => {
    render(<App />);
    navRecite();
    expect(screen.getByRole('heading', { name: '古诗词背诵镜' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '演示模式' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '任务 A · 听写接句' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '任务 B · 全文背诵' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '任务 C · 错字对比' })).toBeTruthy();
    expect(screen.getByLabelText('选择篇目')).toBeTruthy();
    expect(screen.getByRole('button', { name: '显示原文' })).toBeTruthy();
    expect(screen.queryByText(/床前明月光/)).toBeNull();   // 原文默认隐藏
    fireEvent.click(screen.getByRole('button', { name: '显示原文' }));
    expect(screen.getByText(poemText(POEMS[0]))).toBeTruthy();
  });

  it('任务 B：空背诵结束 → 完整度 0%，未达成前锁定提交', () => {
    render(<App />);
    navRecite();
    fireEvent.click(screen.getByRole('button', { name: /任务 B/ }));
    const submit = screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '开始背诵' }));
    fireEvent.click(screen.getByRole('button', { name: '结束背诵' }));
    expect(screen.getAllByText(/0%/).length).toBeGreaterThanOrEqual(1);   // jsdom 无语音 → 空转写
    expect(screen.getByText(/未达 90%/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('任务 A：开始听写出现上句提示；任务 C：背诵后保存、错字本计数', () => {
    render(<App />);
    navRecite();
    fireEvent.click(screen.getByRole('button', { name: /任务 A/ }));
    fireEvent.click(screen.getByRole('button', { name: '开始听写' }));
    expect(within(sceneSection()).getByText(/上句：床前明月光/)).toBeTruthy();
    expect(within(sceneSection()).getByText(/共 2 联/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /任务 C/ }));
    expect((screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '开始背诵' }));
    fireEvent.click(screen.getByRole('button', { name: '结束背诵' }));
    const save = screen.getByRole('button', { name: /保存本次结果/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(screen.getByText(/已存 1\/2 次/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
