// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import App from './App';
import { QUIZ } from './scenes/geography/MoonPhaseScene';

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

const navMoon = () => fireEvent.click(screen.getByRole('button', { name: /☾\s*月相仪/ }));
const setAge = (v: string) => act(() => { fireEvent.change(screen.getByLabelText('月龄'), { target: { value: v } }); });
/** 任务 A 的相位 chips 在侧栏 ① 面板内（工具栏也有同名快捷相位按钮，需作用域限定）。 */
const quizPanel = () => {
  const section = screen.getByText('实验四 · 月相仪').closest('section')!;
  return within(section.querySelector('.panel.prediction') as HTMLElement);
};

describe('地理 · 月相仪场景', () => {
  it('场景接入：任务页签、月龄滑杆与地面视角月相盘渲染正常', () => {
    render(<App />);
    navMoon();
    expect(screen.getByText('实验四 · 月相仪')).toBeTruthy();
    expect(screen.getByRole('button', { name: '演示模式' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '任务 A · 月相预测' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '任务 B · 追寻上弦月' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '任务 C · 朔望对比' })).toBeTruthy();
    expect(screen.getByLabelText('月龄')).toBeTruthy();
    expect(screen.getByLabelText('地面视角月相')).toBeTruthy();
    expect(screen.getByRole('button', { name: '今天' })).toBeTruthy();
  });

  it('任务 A：预测农历月相 → 判题 → 解释解锁提交', () => {
    render(<App />);
    navMoon();
    fireEvent.click(screen.getByRole('button', { name: /任务 A/ }));
    expect(screen.getByText('农历15的晚上，月亮是什么相？')).toBeTruthy();
    expect((screen.getByRole('button', { name: '提交预测' }) as HTMLButtonElement).disabled).toBe(true);
    const q = quizPanel();
    fireEvent.click(q.getByRole('button', { name: '满月' }));   // 农历 15 → 满月
    fireEvent.click(screen.getByRole('button', { name: '提交预测' }));
    expect(screen.getAllByText(/✓ 正确！农历15确实是满月/).length).toBeGreaterThanOrEqual(1);
    fireEvent.change(screen.getByLabelText('月相观察解释'), { target: { value: '地球在太阳和月亮中间，亮面朝向我们。' } });
    expect((screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('任务 A：错误预测给出正确答案并允许换题', () => {
    render(<App />);
    navMoon();
    fireEvent.click(screen.getByRole('button', { name: /任务 A/ }));
    const q = quizPanel();
    fireEvent.click(q.getByRole('button', { name: '新月' }));   // 农历 15 实际是满月
    fireEvent.click(screen.getByRole('button', { name: '提交预测' }));
    expect(screen.getAllByText(/✗ 农历15实际是满月/).length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole('button', { name: '换一题' }));
    expect(screen.getByText(`农历${QUIZ[1].lunarDay}的晚上，月亮是什么相？`)).toBeTruthy();
  });

  it('任务 B：月龄调到上弦（距角 90°±5°）即达成', () => {
    render(<App />);
    navMoon();
    fireEvent.click(screen.getByRole('button', { name: /任务 B/ }));
    expect(screen.getByText(/当前距角/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement).disabled).toBe(true);
    setAge('7.4');   // 7.4/29.53×360 ≈ 90.2°
    expect(screen.getByText(/✓ 达成！当前距角 90\./)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('月相观察解释'), { target: { value: '月亮转到侧面 90°，亮面朝西。' } });
    expect((screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('任务 C：保存新月与满月两帧快照后达成', () => {
    render(<App />);
    navMoon();
    fireEvent.click(screen.getByRole('button', { name: /任务 C/ }));
    const save = screen.getByRole('button', { name: '保存当前月相' });
    setAge('0');
    fireEvent.click(save);
    expect(screen.getByText(/快照1：新月/)).toBeTruthy();
    setAge('14.77');
    fireEvent.click(save);
    expect(screen.getByText(/快照2：满月/)).toBeTruthy();
    expect(screen.getByText(/✓ 朔望两帧已就绪！/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('月相观察解释'), { target: { value: '月亮绕了半圈，亮面从背对变为朝向我们。' } });
    expect((screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});
