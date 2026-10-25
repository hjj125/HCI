// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import App from './App';

beforeEach(() => {
  const ctx = new Proxy({}, { get: () => () => undefined, set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((type: string) =>
    type === '2d' ? ctx : null) as never);
  const originalError = console.error;
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (String(args.join(' ')).includes('THREE.WebGLRenderer')) return;
    originalError(...args);
  });
  // 边界数据：GeoJSON 在 jsdom 中通过 fetch 加载，mock 一个最小国家集合
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    json: async () => String(url).includes('world-110m')
      ? { features: [{ type: 'Feature', properties: { NAME: 'Testland', NAME_ZH: '测试国', CONTINENT: 'Asia' }, geometry: { type: 'MultiPolygon', coordinates: [[[[100, 20], [110, 20], [110, 30], [100, 30], [100, 20]]]] } }] }
      : {},
  })));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const navGeo = () => fireEvent.click(screen.getByRole('button', { name: /◉\s*找国家/ }));

describe('地理 · 找国家场景', () => {
  it('场景接入：任务页签、操作模式与经纬网开关渲染正常', () => {
    render(<App />);
    navGeo();
    expect(screen.getByText('实验一 · 找国家')).toBeTruthy();
    expect(screen.getByRole('button', { name: '任务 A · 线索定位' })).toBeTruthy();
    expect(screen.getAllByLabelText(/经纬网/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: '演示模式' })).toBeTruthy();
  });

  it('任务 A 展示线索并要求先选中再作答', () => {
    render(<App />);
    navGeo();
    fireEvent.click(screen.getByRole('button', { name: /任务 A/ }));
    expect(screen.getByText(/根据线索在地球上选中目标国家/)).toBeTruthy();
    const answer = screen.getByRole('button', { name: '确认作答' }) as HTMLButtonElement;
    expect(answer.disabled).toBe(true);   // 未选中区域前锁定
    expect(screen.getByText(/换一题/)).toBeTruthy();
  });

  it('提示分级与解释提交流程存在', () => {
    render(<App />);
    navGeo();
    fireEvent.click(screen.getByRole('button', { name: /任务 B/ }));
    fireEvent.click(screen.getByRole('button', { name: /请求提示/ }));
    expect(screen.getByRole('button', { name: '请求提示 1/2' })).toBeTruthy();
    const submit = screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);   // 未选择区域且未填写解释
  });
});
