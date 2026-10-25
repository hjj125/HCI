// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from './App';
import { TARGETS } from './scenes/bodyangle/AngleScene';

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

const navAngle = () => fireEvent.click(screen.getByRole('button', { name: /∠\s*身体量角器/ }));
const sceneSection = () => screen.getByRole('heading', { name: '身体量角器' }).closest('section') as HTMLElement;
const mainPanel = () => within(sceneSection().querySelector('.panel.prediction') as HTMLElement);

describe('数学 · 身体量角器场景', () => {
  it('场景接入：任务页签、测量视图、模式切换与锁定按钮渲染正常', () => {
    render(<App />);
    navAngle();
    expect(screen.getByRole('heading', { name: '身体量角器' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '演示模式' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '任务 A · 角度预测' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '任务 B · 拼指定角' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '任务 C · 内角和探究' })).toBeTruthy();
    expect(screen.getByLabelText('角度测量视图')).toBeTruthy();
    expect(screen.getByLabelText('量角器刻度盘')).toBeTruthy();
    expect(screen.getByRole('button', { name: '锁定读数' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '双手角' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '虎口角' })).toBeTruthy();
  });

  it('任务 A：预测目标角类别 → 判题揭晓度数 → 解释解锁提交', () => {
    render(<App />);
    navAngle();
    fireEvent.click(screen.getByRole('button', { name: /任务 A/ }));
    expect((screen.getByRole('button', { name: '提交预测' }) as HTMLButtonElement).disabled).toBe(true);
    const q = mainPanel();
    fireEvent.click(q.getByRole('button', { name: '直角' }));   // TARGETS[0] = 90
    fireEvent.click(screen.getByRole('button', { name: '提交预测' }));
    expect(screen.getAllByText(/✓ 正确！目标角是 90°/).length).toBeGreaterThanOrEqual(1);
    fireEvent.change(screen.getByLabelText('角度观察解释'), { target: { value: '两条边互相垂直。' } });
    expect((screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('任务 A：错误预测给出正确类别', () => {
    render(<App />);
    navAngle();
    fireEvent.click(screen.getByRole('button', { name: /任务 A/ }));
    const q = mainPanel();
    fireEvent.click(q.getByRole('button', { name: '锐角' }));   // 90° 不是锐角
    fireEvent.click(screen.getByRole('button', { name: '提交预测' }));
    expect(screen.getAllByText(/✗ 目标角是 90°，属于直角/).length).toBeGreaterThanOrEqual(1);
  });

  it('任务 B 与任务 C：判题前置条件门控提交', () => {
    render(<App />);
    navAngle();
    fireEvent.click(screen.getByRole('button', { name: /任务 B/ }));
    expect(within(sceneSection()).getAllByText(/拼出/).length).toBeGreaterThanOrEqual(1);
    expect((screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(sceneSection()).getByText(/拼好角后点/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /任务 C/ }));
    expect(screen.getByRole('button', { name: '记录第 1 个角' })).toBeTruthy();
    expect((screen.getByRole('button', { name: '记录第 1 个角' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
