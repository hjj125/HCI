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

const navSeasons = () => fireEvent.click(screen.getByRole('button', { name: /☀\s*五带与四季/ }));

describe('地理 · 五带与四季场景', () => {
  it('场景接入：任务页签、五带/经纬网开关与日期滑杆渲染正常', () => {
    render(<App />);
    navSeasons();
    expect(screen.getByText('实验三 · 五带与四季')).toBeTruthy();
    expect(screen.getByRole('button', { name: '演示模式' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '任务 A · 五带昼夜预测' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '任务 B · 追寻极昼' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '任务 C · 影长实验' })).toBeTruthy();
    expect(screen.getByLabelText('日期')).toBeTruthy();
    expect(screen.getByLabelText('一天时刻')).toBeTruthy();
    expect(screen.getAllByLabelText(/五带$/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByLabelText(/经纬网/).length).toBeGreaterThanOrEqual(1);
  });

  it('任务 A：预测两个维度都选中才能提交，正确预测给出 ✓', () => {
    render(<App />);
    navSeasons();
    fireEvent.click(screen.getByRole('button', { name: /任务 A/ }));
    const submit = screen.getByRole('button', { name: '提交预测' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    // 第 1 题：北京 · 夏至 → 北温带 · 昼长夜短
    fireEvent.click(screen.getByRole('button', { name: '北温带' }));
    fireEvent.click(screen.getByRole('button', { name: '昼长夜短' }));
    expect((screen.getByRole('button', { name: '提交预测' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '提交预测' }));
    expect(screen.getByText(/✓ 正确！北京确实属于北温带、昼长夜短/)).toBeTruthy();
  });

  it('任务 A：错误预测展示正确答案并允许换题', () => {
    render(<App />);
    navSeasons();
    fireEvent.click(screen.getByRole('button', { name: /任务 A/ }));
    fireEvent.click(screen.getByRole('button', { name: '热带' }));
    fireEvent.click(screen.getByRole('button', { name: '昼夜平分' }));
    fireEvent.click(screen.getByRole('button', { name: '提交预测' }));
    expect(screen.getByText(/✗ 实际是北温带 · 昼长夜短/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '换一题' }));
    expect(screen.getAllByText(/新加坡/).length).toBeGreaterThan(0);
  });

  it('任务 B：春分开局未达成，日期调到夏至即极昼达成，未填写解释前锁定提交', () => {
    render(<App />);
    navSeasons();
    fireEvent.click(screen.getByRole('button', { name: /任务 B/ }));
    expect(screen.getAllByText(/摩尔曼斯克/).length).toBeGreaterThan(0);
    expect(screen.getByText(/尚未极昼/)).toBeTruthy();  // 春分开局：赤纬≈0，极昼不成立
    const submit = screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('日期'), { target: { value: '172' } });
    expect(screen.getByText(/✓ 达成！摩尔曼斯克此刻昼长/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('五带四季观察解释'), { target: { value: '夏至太阳直射北回归线，北极圈内整日不落。' } });
    expect((screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('任务 C：剖面影子视图渲染，调到当地正午自动判定达成', () => {
    render(<App />);
    navSeasons();
    fireEvent.click(screen.getByRole('button', { name: /任务 C/ }));
    expect(screen.getByLabelText('太阳视运动与影长剖面图')).toBeTruthy();
    expect(screen.getByText(/当前当地太阳时/)).toBeTruthy();
    const submit = screen.getByRole('button', { name: /提交观察解释/ }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    // 默认城市北京（东经 116.4°）：UTC 4.25 ≈ 当地正午 12:01
    fireEvent.change(screen.getByLabelText('一天时刻'), { target: { value: '4.25' } });
    expect(screen.getByText(/✓ 正午达成！影长已是一天中最短/)).toBeTruthy();
    expect(screen.getByText(/影长\/杆高/)).toBeTruthy();
  });
});
