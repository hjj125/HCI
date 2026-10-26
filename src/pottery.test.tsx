// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from './App';
import { A_OPTIONS } from './scenes/art/PotteryScene';

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

const navPottery = () => fireEvent.click(screen.getByRole('button', { name: /∪\s*陶艺工坊/ }));
const sceneSection = () => screen.getByRole('heading', { name: '陶艺工坊' }).closest('section') as HTMLElement;
const mainPanel = () => within(sceneSection().querySelector('.panel.prediction') as HTMLElement);

describe('美术 · 陶艺工坊场景', () => {
  it('场景接入：任务页签、模式切换、釉色盘与轮廓编辑器渲染正常', () => {
    render(<App />);
    navPottery();
    expect(screen.getByRole('heading', { name: '陶艺工坊' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '演示模式' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '任务 A · 拉坯规律' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '任务 B · 造型挑战' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '任务 C · 对称纹样彩绘' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '拉坯' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '彩绘' })).toBeTruthy();
    expect(screen.getByLabelText('轮廓编辑器')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '彩绘' }));
    expect(screen.getByRole('button', { name: '青花' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '4重对称' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '清除彩绘' })).toBeTruthy();
  });

  it('任务 A：拉坯规律预测 → 判题 → 解释解锁提交', () => {
    render(<App />);
    navPottery();
    fireEvent.click(screen.getByRole('button', { name: /任务 A/ }));
    expect((screen.getByRole('button', { name: '提交预测' }) as HTMLButtonElement).disabled).toBe(true);
    const q = mainPanel();
    fireEvent.click(q.getByRole('button', { name: '变高变薄' }));
    fireEvent.click(screen.getByRole('button', { name: '提交预测' }));
    expect(screen.getAllByText(/✓ 正确！现场双手向上提拉验证/).length).toBeGreaterThanOrEqual(1);
    fireEvent.change(screen.getByLabelText('陶艺观察解释'), { target: { value: '泥量不变，拉高必然变薄。' } });
    expect((screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('任务 A：错误预测给出正确规律', () => {
    render(<App />);
    navPottery();
    fireEvent.click(screen.getByRole('button', { name: /任务 A/ }));
    const q = mainPanel();
    fireEvent.click(q.getByRole('button', { name: '变矮变厚' }));
    fireEvent.click(screen.getByRole('button', { name: '提交预测' }));
    expect(screen.getAllByText(/✗ 实际是「变高变薄」/).length).toBeGreaterThanOrEqual(1);
  });

  it('任务 B 与任务 C：判题前置条件门控提交', () => {
    render(<App />);
    navPottery();
    fireEvent.click(screen.getByRole('button', { name: /任务 B/ }));
    expect(within(sceneSection()).getAllByText(/高瘦的瓶/).length).toBeGreaterThanOrEqual(1);
    expect((screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /任务 C/ }));
    expect(within(sceneSection()).getByText(/需要：覆盖率/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
