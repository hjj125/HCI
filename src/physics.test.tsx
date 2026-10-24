// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from './App';

let draw: string[] = [];
beforeEach(() => {
  draw = [];
  const ctx = new Proxy({}, {
    get(_t, key) { if (key === 'canvas') return null; return () => { draw.push(String(key)); }; },
    set() { return true; },
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) =>
    type === '2d' ? ctx : null) as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(
    ({ left: 0, top: 0, width: 960, height: 560, right: 960, bottom: 560, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect);
  const originalError = console.error;
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (String(args.join(' ')).includes('THREE.WebGLRenderer')) return;
    originalError(...args);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const navPhysics = () => fireEvent.click(screen.getByRole('button', { name: /⬡\s*力与运动/ }));

describe('物理 · 力与运动场景', () => {
  it('演示模式默认可用：开始/暂停切换，画布与读数正常渲染', () => {
    render(<App />);
    navPhysics();
    expect(screen.getByLabelText('力与运动仿真视图')).toBeTruthy();
    expect(screen.getByText(/m\/s 当前速率/)).toBeTruthy();
    const run = screen.getByRole('button', { name: '开始' }) as HTMLButtonElement;
    expect(run.disabled).toBe(false);
    fireEvent.click(run);
    expect(screen.getByRole('button', { name: '暂停' })).toBeTruthy();   // 运行中
    fireEvent.click(screen.getByRole('button', { name: '暂停' }));
    expect(screen.getByRole('button', { name: '开始' })).toBeTruthy();   // 已暂停
    expect(draw).toContain('stroke');                                     // 画布确实绘制了矢量/轨迹
  });

  it('任务 A 在提交预测前锁定运行，提交后解锁', () => {
    render(<App />);
    navPhysics();
    fireEvent.click(screen.getByRole('button', { name: /任务 A/ }));
    expect((screen.getByRole('button', { name: '开始' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '保持 1.5 m/s 向右匀速直行' }));
    fireEvent.click(screen.getByRole('button', { name: /提交预测/ }));
    expect((screen.getByRole('button', { name: '开始' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/现在点击“开始”/)).toBeTruthy();
  });

  it('拖动力矢量头部可改变力的大小（画布↔视口坐标换算）', () => {
    render(<App />);
    navPhysics();
    const c = screen.getByLabelText('力与运动仿真视图');
    const mk = (type: string, x: number, y: number) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1 });
    // 默认力为 0，箭头头部就在物体（画布内部约 178,280）旁；从这里拖出。
    fireEvent(c, mk('pointerdown', 180, 280));
    fireEvent(c, mk('pointermove', 460, 130));
    fireEvent(c, mk('pointerup', 460, 130));
    // 距离约 319px，远超上限 → 应裁剪为 4.0 N，方向指向右上。
    expect(screen.getByText(/力：4\.0 N @/)).toBeTruthy();
  });

  it('任务 C 快照入口在无轨迹时禁用', () => {
    render(<App />);
    navPhysics();
    fireEvent.click(screen.getByRole('button', { name: /任务 C/ }));
    expect((screen.getByRole('button', { name: /保存当前轨迹 0\/2/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/跑一次保存，换力矢量再跑一次保存/)).toBeTruthy();
  });
});
