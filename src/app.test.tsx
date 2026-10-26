// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from './App';

// 记录白板画笔调用，用来确认“真的画了线”而不只是状态变了。
let draw: string[] = [];
const rect = (width: number, height: number) =>
  ({ left: 0, top: 0, width, height, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

beforeEach(() => {
  draw = [];
  const ctx = new Proxy({}, {
    get(_target, key) {
      if (key === 'canvas') return null;
      return () => { draw.push(String(key)); };
    },
    set() { return true; },
  });
  // WebGL 在 jsdom 中不可用：返回 null 让 CubeView 走降级分支；2D 返回记录用的假上下文。
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) =>
    type === '2d' ? ctx : null) as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(rect(1200, 650));
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(() => {});
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: () => {} });
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });
  // jsdom 没有 WebGL，CubeView 会走降级分支；过滤掉 three 的预期报错，其他错误照常输出。
  const originalError = console.error;
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (String(args.join(' ')).includes('THREE.WebGLRenderer')) return;
    originalError(...args);
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const nav = (label: RegExp) => fireEvent.click(screen.getByRole('button', { name: label }));
const peek = (canvas: Element, type: string, x: number, y: number) =>
  fireEvent(canvas, new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));
const setRange = (el: Element, value: string) => {
  fireEvent.input(el, { target: { value } });
  fireEvent.change(el, { target: { value } });
};

describe('课件视图', () => {
  it('默认是第 1 页，可前后翻页且首页禁用“上一页”', () => {
    render(<App />);
    nav(/▤\s*课件/);
    expect(screen.getByText(/课堂模式 · 1 \/ 3/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /上一页/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /下一页/ }));
    expect(screen.getByText(/课堂模式 · 2 \/ 3/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /上一页/ }));
    expect(screen.getByText(/课堂模式 · 1 \/ 3/)).toBeTruthy();
  });

  it('方向键只在课件模式生效，不会在别的模式里偷偷改页码', () => {
    render(<App />);
    nav(/✎\s*白板/);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    nav(/▤\s*课件/);
    expect(screen.getByText(/课堂模式 · 1 \/ 3/)).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText(/课堂模式 · 2 \/ 3/)).toBeTruthy();
  });

  it('激光笔可按钮/L 键开关，切换视图后自动关闭', () => {
    render(<App />);
    nav(/▤\s*课件/);
    const laser = screen.getByRole('button', { name: '激光笔' });
    expect(laser.className).not.toContain('selected');
    fireEvent.click(laser);
    expect(laser.className).toContain('selected');
    fireEvent.keyDown(window, { key: 'l' });
    expect(screen.getByRole('button', { name: '激光笔' }).className).not.toContain('selected');
    fireEvent.keyDown(window, { key: 'l' });
    expect(screen.getByRole('button', { name: '激光笔' }).className).toContain('selected');
    nav(/✎\s*白板/);
    nav(/▤\s*课件/);
    expect(screen.getByRole('button', { name: '激光笔' }).className).not.toContain('selected');
  });
});

describe('白板视图', () => {
  it('鼠标可绘制笔迹，撤销与清空生效', () => {
    render(<App />);
    nav(/✎\s*白板/);
    const canvas = screen.getByLabelText('绘图白板');
    const undo = screen.getByRole('button', { name: '撤销' }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);

    peek(canvas, 'pointerdown', 100, 100);
    peek(canvas, 'pointermove', 200, 160);
    peek(canvas, 'pointermove', 260, 220);
    peek(canvas, 'pointerup', 260, 220);
    expect(draw).toContain('stroke');
    expect(undo.disabled).toBe(false);

    fireEvent.click(undo);
    expect(undo.disabled).toBe(true);

    peek(canvas, 'pointerdown', 40, 40);
    peek(canvas, 'pointermove', 80, 80);
    peek(canvas, 'pointerup', 80, 80);
    expect(undo.disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '清空' }));
    expect(undo.disabled).toBe(true);
  });

  it('切到别的视图再回来，已完成的笔迹保留', () => {
    render(<App />);
    nav(/✎\s*白板/);
    const canvas = screen.getByLabelText('绘图白板');
    peek(canvas, 'pointerdown', 100, 100);
    peek(canvas, 'pointermove', 150, 150);
    peek(canvas, 'pointerup', 150, 150);
    nav(/◇\s*空间几何/);
    nav(/✎\s*白板/);
    expect((screen.getByRole('button', { name: '撤销' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('白板可切换工具与落笔方式，握拳撤销可勾选', () => {
    render(<App />);
    nav(/✎\s*白板/);
    fireEvent.change(screen.getByLabelText('落笔方式'), { target: { value: 'space' } });
    expect(screen.getByText(/按住空格落笔/)).toBeTruthy();
    const pen = screen.getByRole('button', { name: '画笔' });
    const eraser = screen.getByRole('button', { name: '橡皮' });
    expect(pen.className).toContain('selected');
    fireEvent.click(eraser);
    expect(eraser.className).toContain('selected');
    expect(pen.className).not.toContain('selected');
    fireEvent.click(pen);
    expect(pen.className).toContain('selected');
    const fist = screen.getByLabelText(/握拳 0.6 秒撤销/) as HTMLInputElement;
    fireEvent.click(fist);
    expect(fist.checked).toBe(true);
  });
});

describe('空间几何任务', () => {
  it('演示模式为默认：进入即可操作，无需先提交预测', () => {
    render(<App />);
    nav(/◇\s*空间几何/);
    expect(screen.getByRole('heading', { name: '正方体截面探究' })).toBeTruthy();
    const slider = screen.getByLabelText('切面参数控制') as HTMLInputElement;
    expect(slider.disabled).toBe(false);
    expect((screen.getByRole('button', { name: '三边形预设' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/自由操作切面/)).toBeTruthy();
  });

  it('任务 A 在提交预测前锁定操作，提交后解锁预设与滑块', () => {
    render(<App />);
    nav(/◇\s*空间几何/);
    expect(screen.getByRole('heading', { name: '正方体截面探究' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /任务 A/ }));
    const slider = screen.getByLabelText('切面参数控制') as HTMLInputElement;
    expect(slider.disabled).toBe(true);
    expect((screen.getByRole('button', { name: '三边形预设' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '6 边' }));
    fireEvent.click(screen.getByRole('button', { name: /提交预测/ }));
    expect(slider.disabled).toBe(false);
    expect(screen.getByText(/你的初始预测：6 边/)).toBeTruthy();
    expect((screen.getByRole('button', { name: '三边形预设' }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '三边形预设' }));
    expect(document.querySelector('.big-number')?.textContent).toBe('3条边');
    fireEvent.click(screen.getByRole('button', { name: '六边形预设' }));
    expect(document.querySelector('.big-number')?.textContent).toBe('6条边');
  });

  it('四个预设分别给出 3/4/5/6 边截面', () => {
    render(<App />);
    nav(/◇\s*空间几何/);
    fireEvent.click(screen.getByRole('button', { name: /任务 B/ }));
    const cases: [string, string][] = [['三边形预设', '3条边'], ['四边形预设', '4条边'], ['五边形预设', '5条边'], ['六边形预设', '6条边']];
    for (const [button, expected] of cases) {
      fireEvent.click(screen.getByRole('button', { name: button }));
      expect(document.querySelector('.big-number')?.textContent).toBe(expected);
    }
  });

  it('滑块改参数会同步到读数与截面', () => {
    render(<App />);
    nav(/◇\s*空间几何/);
    fireEvent.click(screen.getByRole('button', { name: /任务 A/ }));
    fireEvent.click(screen.getByRole('button', { name: '4 边' }));
    fireEvent.click(screen.getByRole('button', { name: /提交预测/ }));
    const slider = screen.getByLabelText('切面参数控制');
    setRange(slider, '1.2');
    expect(document.querySelector('output')?.textContent).toBe('1.20');
    // 初始方向为体对角线，切面推到 1.2 已靠近顶点，截面退化为三角形。
    expect(document.querySelector('.big-number')?.textContent).toBe('3条边');
  });

  it('任务 B 可通过预设达成目标并提交解释', () => {
    render(<App />);
    nav(/◇\s*空间几何/);
    fireEvent.click(screen.getByRole('button', { name: /任务 B/ }));
    fireEvent.change(screen.getByLabelText('目标边数'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: '四边形预设' }));
    expect(screen.getByText(/已找到目标截面/)).toBeTruthy();

    const submit = screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('观察解释'), { target: { value: '切面平行于上下两个面。' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(document.querySelector('div[role="status"].help')?.textContent).toContain('用时');
  });

  it('提示按钮按 0/3 → 1/3 递增并给出对应文案', () => {
    render(<App />);
    nav(/◇\s*空间几何/);
    fireEvent.click(screen.getByRole('button', { name: /请求提示/ }));
    expect(screen.getByRole('button', { name: '请求提示 1/3' })).toBeTruthy();
    expect(screen.getByText(/每条边，来自切面与正方体一个面的交线/)).toBeTruthy();
  });

  it('拖动滑块并松开不会崩溃（回归：状态更新器读取已置空的 ref）', () => {
    render(<App />);
    nav(/◇\s*空间几何/);
    const slider = screen.getByLabelText('切面参数控制');
    fireEvent.pointerDown(slider);
    setRange(slider, '1.2');
    fireEvent.pointerUp(slider);
    // 修复前：pointerup 后 React 因 null.initial 崩溃并卸载整棵树。
    expect(document.querySelector('.big-number')?.textContent).toBe('3条边');
    // 撤销应能回到拖动前的参数（历史在松手时正确入栈）。
    fireEvent.click(screen.getByRole('button', { name: '撤销操作' }));
    expect(document.querySelector('output')?.textContent).toBe('0.00');
  });

  it('任务 C 可保存两个快照、对比边数变化并提交解释', () => {
    render(<App />);
    nav(/◇\s*空间几何/);
    fireEvent.click(screen.getByRole('button', { name: /任务 C/ }));
    // 默认切面为六边形，直接保存第 1 个快照
    fireEvent.click(screen.getByRole('button', { name: /保存当前截面/ }));
    fireEvent.click(screen.getByRole('button', { name: '三边形预设' }));
    fireEvent.click(screen.getByRole('button', { name: /保存当前截面/ }));
    expect(screen.getByText(/边数 6 → 3/)).toBeTruthy();
    const submit = screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('观察解释'), { target: { value: '靠近顶点后三个面退出了相交。' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(document.querySelector('div[role="status"].help')?.textContent).toContain('用时');
  });

  it('实时面板显示切面经过的面', () => {
    render(<App />);
    nav(/◇\s*空间几何/);
    expect(screen.getByText(/切面经过的面：/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '四边形预设' }));
    expect(document.querySelector('.result .help')?.textContent).toContain('、');
  });
});

describe('记录与导出', () => {
  it('导出 JSON 含任务、耗时、提示次数与事件列表', async () => {
    render(<App />);
    nav(/◇\s*空间几何/);
    fireEvent.click(screen.getByRole('button', { name: /请求提示/ }));
    fireEvent.click(screen.getByRole('button', { name: '导出 JSON 记录', hidden: true }));

    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    const blob = (URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    const data = JSON.parse(await blob.text());
    expect(data.version).toBe(2);
    expect(data.task).toBe('free');
    expect(typeof data.durationSeconds).toBe('number');
    expect(data.hints).toBe(1);
    expect(Array.isArray(data.events)).toBe(true);
    expect(data.events.length).toBeGreaterThan(0);
  });
});

describe('本机 PowerPoint 桥接', () => {
  it('检测连接后显示文件名与页码，并发送翻页命令', async () => {
    const fetchMock = vi.fn(async () => ({
      json: async () => ({ connected: true, presenting: true, file: 'demo.pptx', current: 1, total: 3 }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    nav(/▤\s*课件/);
    fireEvent.click(screen.getByRole('button', { name: '本机 PowerPoint' }));
    await screen.findByText(/demo\.pptx/);
    fireEvent.click(screen.getByRole('button', { name: /下一步/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('action=next'), expect.anything()));
  });
});
