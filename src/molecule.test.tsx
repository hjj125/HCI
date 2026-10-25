// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from './App';
import { A_QUIZ, B_TARGETS } from './scenes/molecule/MoleculeScene';

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

const navMolecule = () => fireEvent.click(screen.getByRole('button', { name: /⚛\s*分子搭建/ }));
const sceneSection = () => screen.getByRole('heading', { name: '分子搭建' }).closest('section') as HTMLElement;
const mainPanel = () => within(sceneSection().querySelector('.panel.prediction') as HTMLElement);

describe('化学 · 分子搭建场景', () => {
  it('场景接入：任务页签、分子画布、元素托盘渲染正常', () => {
    render(<App />);
    navMolecule();
    expect(screen.getByRole('heading', { name: '分子搭建' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '演示模式' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '任务 A · 价键预测' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '任务 B · 搭出目标分子' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '任务 C · 同分异构体' })).toBeTruthy();
    expect(screen.getByLabelText('分子画布')).toBeTruthy();
    expect(screen.getByRole('button', { name: '添加氢' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '添加氧' })).toBeTruthy();
  });

  it('添加原子 → 化学式与校验状态实时更新', () => {
    render(<App />);
    navMolecule();
    const section = sceneSection();
    fireEvent.click(screen.getByRole('button', { name: '添加氧' }));
    fireEvent.click(screen.getByRole('button', { name: '添加氢' }));
    fireEvent.click(screen.getByRole('button', { name: '添加氢' }));
    expect(within(section).getByText('H2O')).toBeTruthy();          // 化学式按原子计数
    expect(within(section).getByText(/互不相连/)).toBeTruthy();      // 未成键 → 混合物提示
  });

  it('任务 A：价键预测 → 判题 → 解释解锁提交', () => {
    render(<App />);
    navMolecule();
    fireEvent.click(screen.getByRole('button', { name: /任务 A/ }));
    expect((screen.getByRole('button', { name: '提交预测' }) as HTMLButtonElement).disabled).toBe(true);
    const q = mainPanel();
    fireEvent.click(q.getByRole('button', { name: '2' }));   // 氧的价数 2
    fireEvent.click(screen.getByRole('button', { name: '提交预测' }));
    expect(screen.getAllByText(/✓ 正确！氧的价数是 2/).length).toBeGreaterThanOrEqual(1);
    fireEvent.change(screen.getByLabelText('分子观察解释'), { target: { value: '氧最外层 6 个电子，还差 2 个。' } });
    expect((screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('任务 A：错误预测给出正确价数并允许换题', () => {
    render(<App />);
    navMolecule();
    fireEvent.click(screen.getByRole('button', { name: /任务 A/ }));
    const q = mainPanel();
    fireEvent.click(q.getByRole('button', { name: '1' }));   // 氧不是 1
    fireEvent.click(screen.getByRole('button', { name: '提交预测' }));
    expect(screen.getAllByText(/✗ 氧的价数是 2/).length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole('button', { name: '换一题' }));
    expect(screen.getByText(`一个${A_QUIZ[1].el === 'N' ? '氮' : ''}原子最多形成几个键？`)).toBeTruthy();
  });

  it('任务 B：目标与判题门控；任务 C：保存按钮门控', () => {
    render(<App />);
    navMolecule();
    fireEvent.click(screen.getByRole('button', { name: /任务 B/ }));
    expect(screen.getAllByText(new RegExp(B_TARGETS[0].formula)).length).toBeGreaterThanOrEqual(1);
    expect((screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /任务 C/ }));
    expect((screen.getByRole('button', { name: '保存为对比1' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
