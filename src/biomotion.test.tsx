// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from './App';
import { A_OPTIONS } from './scenes/biomotion/BioMotionScene';

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

const navBio = () => fireEvent.click(screen.getByRole('button', { name: /⦾\s*运动系统/ }));
const sceneSection = () => screen.getByRole('heading', { name: '关节与骨骼肌' }).closest('section') as HTMLElement;
const mainPanel = () => within(sceneSection().querySelector('.panel.prediction') as HTMLElement);

describe('生物 · 运动系统场景', () => {
  it('场景接入：任务页签、姿态叠加视图与锁定按钮渲染正常', () => {
    render(<App />);
    navBio();
    expect(screen.getByRole('heading', { name: '关节与骨骼肌' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '演示模式' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '任务 A · 肌肉协作预测' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '任务 B · 屈肘 90°' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '任务 C · 屈伸对比' })).toBeTruthy();
    expect(screen.getByLabelText('姿态叠加视图')).toBeTruthy();
    expect(screen.getByRole('button', { name: '锁定读数' })).toBeTruthy();
  });

  it('任务 A：肌肉协作预测 → 判题 → 解释解锁提交', () => {
    render(<App />);
    navBio();
    fireEvent.click(screen.getByRole('button', { name: /任务 A/ }));
    expect((screen.getByRole('button', { name: '提交预测' }) as HTMLButtonElement).disabled).toBe(true);
    const q = mainPanel();
    fireEvent.click(q.getByRole('button', { name: A_OPTIONS[0] }));   // 正确答案
    fireEvent.click(screen.getByRole('button', { name: '提交预测' }));
    expect(screen.getAllByText(/✓ 正确！屈肘时肱二头肌收缩/).length).toBeGreaterThanOrEqual(1);
    fireEvent.change(screen.getByLabelText('运动系统观察解释'), { target: { value: '骨骼肌只能牵拉，屈伸需要配对肌群。' } });
    expect((screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('任务 A：错误预测给出正确答案', () => {
    render(<App />);
    navBio();
    fireEvent.click(screen.getByRole('button', { name: /任务 A/ }));
    const q = mainPanel();
    fireEvent.click(q.getByRole('button', { name: A_OPTIONS[2] }));   // 两者都收缩（迷思）
    fireEvent.click(screen.getByRole('button', { name: '提交预测' }));
    expect(screen.getAllByText(/✗ 正确答案是「肱二头肌收缩 · 肱三头肌舒张」/).length).toBeGreaterThanOrEqual(1);
  });

  it('任务 B 与任务 C：判题前置条件门控提交', () => {
    render(<App />);
    navBio();
    fireEvent.click(screen.getByRole('button', { name: /任务 B/ }));
    expect(screen.getByText(/摆好动作后点/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /任务 C/ }));
    expect(screen.getByText(/还没有快照/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
