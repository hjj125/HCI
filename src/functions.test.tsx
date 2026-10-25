// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from './App';
import { bus } from './core/interaction';
import { A_TARGETS, B_TARGETS } from './scenes/functions/taskLogic';

beforeEach(() => {
  const ctx = new Proxy({}, { get: () => () => undefined, set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) =>
    type === '2d' ? ctx : null) as never);
  const originalError = console.error;
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (String(args.join(' ')).includes('THREE.WebGLRenderer')) return;
    originalError(...args);
  });
  // 边界数据：GeoJSON 在 jsdom 中通过 fetch 加载（地理场景挂载即请求），mock 空集合即可
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ features: [] }) })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const navFn = () => fireEvent.click(screen.getByRole('button', { name: /∿\s*函数绘图/ }));

/** 通过事件总线注入一笔确定性笔迹（鼠标与手势在场景内走同一条 drag 路径）。
 *  bus.emit 在 React 事件之外，需用 act 包裹让状态更新刷出后再断言。 */
const drawStroke = (f: (x: number) => number, n = 61) => act(() => {
  bus.emit({ scene: 'functions', source: 'mouse', intent: 'drag', phase: 'start', position: { x: 0, y: (1 - f(-1)) / 2 } });
  for (let i = 1; i < n; i++) {
    const xm = -1 + (2 * i) / (n - 1);
    bus.emit({ scene: 'functions', source: 'mouse', intent: 'drag', phase: 'update', position: { x: (xm + 1) / 2, y: (1 - f(xm)) / 2 } });
  }
  bus.emit({ scene: 'functions', source: 'mouse', intent: 'drag', phase: 'end' });
});

describe('数学 · 人体函数绘图仪场景', () => {
  it('场景接入：任务页签与函数画布渲染正常', () => {
    render(<App />);
    navFn();
    expect(screen.getByText('人体函数绘图仪')).toBeTruthy();
    expect(screen.getByRole('button', { name: '演示模式' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '任务 A · 看曲线猜类型' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '任务 B · 听指令画函数' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '任务 C · 双曲线对比' })).toBeTruthy();
    expect(screen.getByLabelText('函数画布')).toBeTruthy();
  });

  it('演示模式：画一笔上升直线，识别为直线并给出表达式', () => {
    render(<App />);
    navFn();
    drawStroke(x => 0.5 * x + 0.1);
    expect(screen.getByText(/识别成功：直线 · y ≈ 0\.50x \+ 0\.10/)).toBeTruthy();
    expect(screen.getAllByText(/y ≈ 0\.50x \+ 0\.10/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/斜率 k = 0\.50/)).toBeTruthy();
  });

  it('任务 A：预测族别 → 判题 → 解释解锁提交', () => {
    render(<App />);
    navFn();
    fireEvent.click(screen.getByRole('button', { name: /任务 A/ }));
    const submit = screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    const predict = screen.getByRole('button', { name: '提交预测' }) as HTMLButtonElement;
    expect(predict.disabled).toBe(true);   // 未选族别前锁定
    fireEvent.click(screen.getByRole('button', { name: A_TARGETS[0].family === 'linear' ? '直线' : '抛物线' }));
    fireEvent.click(screen.getByRole('button', { name: '提交预测' }));
    expect(screen.getByText(/✓ 正确！答案是/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('函数观察解释'), { target: { value: '虚线没有弯折，是一直线。' } });
    expect((screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('任务 B：画出符合指令的直线即达成，解释解锁提交', () => {
    render(<App />);
    navFn();
    fireEvent.click(screen.getByRole('button', { name: /任务 B/ }));
    expect(screen.getAllByText(B_TARGETS[0].prompt).length).toBeGreaterThanOrEqual(1);
    expect((screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement).disabled).toBe(true);
    drawStroke(x => 0.6 * x + 0.1);
    expect(screen.getByText(/✓ 达成！最近一笔符合「上升的直线」/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('函数观察解释'), { target: { value: '手指匀速上移，斜率为正。' } });
    expect((screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('任务 B：画出的形状不符合指令时明确提示未达成', () => {
    render(<App />);
    navFn();
    fireEvent.click(screen.getByRole('button', { name: /任务 B/ }));
    drawStroke(x => -0.6 * x + 0.1);  // 下降直线 ≠ 上升
    expect(screen.getByText(/还不符合「上升的直线」/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('任务 C：两笔自动存为对比①②，表达式并排展示', () => {
    render(<App />);
    navFn();
    fireEvent.click(screen.getByRole('button', { name: /任务 C/ }));
    drawStroke(x => 0.5 * x + 0.1);
    expect(screen.getByText(/对比1：直线/)).toBeTruthy();
    drawStroke(x => 0.4 * Math.sin(2 * Math.PI * x / 2));
    expect(screen.getByText(/对比2：正弦/)).toBeTruthy();
    expect(screen.getByText(/✓ 两笔已就绪！/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('函数观察解释'), { target: { value: '第一笔斜率恒定，第二笔上下起伏。' } });
    expect((screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});
