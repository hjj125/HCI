import { describe, expect, it, vi } from 'vitest';
import { createAgentController, type AgentControllerDeps } from './controller';
import type { SceneId } from '../interaction';

function makeDeps(over: Partial<AgentControllerDeps> = {}) {
  const say = vi.fn();
  const appendDelta = vi.fn();
  const emit = vi.fn();
  const onStateChange = vi.fn();
  let t = 1_000_000;
  const deps: AgentControllerDeps = {
    scene: () => 'chem-molecule' as SceneId,
    getSnapshot: () => ({}),
    getAdapter: () => undefined,
    say, appendDelta, emit, onStateChange,
    now: () => t,
    ...over,
  };
  return { deps, say, appendDelta, emit, onStateChange, advance: (ms: number) => { t += ms; } };
}

const SNAPSHOT_B = {
  task: 'B', completed: false, atomCount: 1, bondCount: 0, formula: 'H', valid: true, errors: [], hints: 0,
  construct: { target: 'H2O', satisfied: false }, quiz: null, compare: null,
};

describe('灵犀运行时控制器', () => {
  it('未登记适配器的场景不决策', async () => {
    const d = makeDeps();
    const ctl = createAgentController(d.deps);
    await ctl.poll();
    expect(d.say).not.toHaveBeenCalled();
  });

  it('轮询命中规则 → 说话；同一触发键冷却期内不重复', async () => {
    const d = makeDeps({
      getSnapshot: () => ({ task: 'B', completed: false, atomCount: 6, errors: ['碳原子（#3）的键数 5 超过了它的价数 4'], construct: null }),
      getAdapter: () => ({ run: vi.fn(), cancel: vi.fn() }),
    });
    const ctl = createAgentController(d.deps);
    await ctl.poll();
    expect(d.say).toHaveBeenCalledWith(expect.stringContaining('碳原子（#3）的键数 5'));
    d.say.mockClear();
    d.advance(1000);
    await ctl.poll();
    expect(d.say).not.toHaveBeenCalled();
    d.advance(90_000);
    await ctl.poll();
    expect(d.say).toHaveBeenCalledWith(expect.stringContaining('碳原子（#3）的键数 5'));
  });

  it('提议路径：等待确认，acceptOffer 后才执行 say+demo 并记录 agent·run 事件', async () => {
    const run = vi.fn(async () => { /* 演示脚本即刻完成 */ });
    const d = makeDeps({ getSnapshot: () => SNAPSHOT_B, getAdapter: () => ({ run, cancel: vi.fn() }) });
    const ctl = createAgentController(d.deps);
    await ctl.poll();
    expect(d.onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ offer: { label: expect.stringContaining('水') } }));
    expect(run).not.toHaveBeenCalled();
    await ctl.acceptOffer();
    expect(run).toHaveBeenCalledWith('demo-water', undefined, expect.any(Function));
    const kinds = d.emit.mock.calls.map(c => `${c[0].source}·${c[0].intent}/${c[0].phase}${c[0].value ? ':' + c[0].value : ''}`);
    expect(kinds).toContain('agent·run/start:demo-water');
    expect(kinds).toContain('agent·run/end:demo-water');
  });

  it('学生操作打断演示：调用适配器 cancel、不再发 end、恢复 idle', async () => {
    const gate: { release: (() => void) | null } = { release: null };
    const run = vi.fn(() => new Promise<void>(r => { gate.release = r; }));
    const cancel = vi.fn();
    const d = makeDeps({ getSnapshot: () => SNAPSHOT_B, getAdapter: () => ({ run, cancel }) });
    const ctl = createAgentController(d.deps);
    await ctl.poll();
    const accepting = ctl.acceptOffer();
    await Promise.resolve(); // 让 executeSteps 走到 await adapter.run
    expect(d.onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'acting' }));
    ctl.onBusEvent({ scene: 'chem-molecule', source: 'mouse', intent: 'drag', phase: 'end' });
    expect(cancel).toHaveBeenCalledTimes(1);
    gate.release?.();
    await accepting;
    const kinds = d.emit.mock.calls.map(c => `${c[0].intent}/${c[0].phase}`);
    expect(kinds).toContain('run/start');
    expect(kinds).not.toContain('run/end');
    expect(d.onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'idle', offer: null }));
  });

  it('软打断：适配器实现 disturb 时学生操作不取消演示，run/end 正常发出', async () => {
    const gate: { release: (() => void) | null } = { release: null };
    const run = vi.fn(() => new Promise<void>(r => { gate.release = r; }));
    const cancel = vi.fn();
    const disturb = vi.fn();
    const d = makeDeps({ getSnapshot: () => SNAPSHOT_B, getAdapter: () => ({ run, cancel, disturb }) });
    const ctl = createAgentController(d.deps);
    await ctl.poll();
    const accepting = ctl.acceptOffer();
    await Promise.resolve();
    ctl.onBusEvent({ scene: 'chem-molecule', source: 'mouse', intent: 'drag', phase: 'end' });
    expect(disturb).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
    expect(d.onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'acting' }));
    gate.release?.();
    await accepting;
    const kinds = d.emit.mock.calls.map(c => `${c[0].intent}/${c[0].phase}`);
    expect(kinds).toContain('run/end');
  });

  it('提问：流式增量写入气泡；unconfigured 回退提示', async () => {
    const d = makeDeps({
      askStream: vi.fn(async (_q, _h, _p, onDelta) => { onDelta('斜率是方向的变化率。'); return 'ok' as const; }),
      getAdapter: () => ({ run: vi.fn(), cancel: vi.fn() }),
    });
    const ctl = createAgentController(d.deps);
    await ctl.ask('什么是斜率？');
    expect(d.say).toHaveBeenCalledWith('');
    expect(d.appendDelta).toHaveBeenCalledWith('斜率是方向的变化率。');
    expect(d.onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'idle' }));

    const d2 = makeDeps({
      askStream: vi.fn(async () => 'unconfigured' as const),
      getAdapter: () => ({ run: vi.fn(), cancel: vi.fn() }),
    });
    await createAgentController(d2.deps).ask('为什么？');
    expect(d2.say.mock.calls.some(c => String(c[0]).includes('.env'))).toBe(true);
  });

  it('关闭后不再轮询；场景切换清冷却并复位', async () => {
    const cancel = vi.fn();
    const gate: { release: (() => void) | null } = { release: null };
    const run = vi.fn(() => new Promise<void>(r => { gate.release = r; }));
    const d = makeDeps({ getSnapshot: () => SNAPSHOT_B, getAdapter: () => ({ run, cancel }) });
    const ctl = createAgentController(d.deps);
    await ctl.poll();
    const accepting = ctl.acceptOffer();
    await Promise.resolve();
    ctl.onSceneChange();
    expect(cancel).toHaveBeenCalledTimes(1);
    gate.release?.();
    await accepting;
    ctl.setEnabled(false);
    expect(d.onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'off' }));
    d.say.mockClear();
    await ctl.poll();
    expect(d.say).not.toHaveBeenCalled();
  });
});
