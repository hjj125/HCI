import { describe, it, expect } from 'vitest';
import { detectSwipe, SwipeDetector, type SwipeDirection } from './pptGesture';

type P = { x: number; y: number; time: number };
const sweep = (from: number, to: number, ms = 300, steps = 7, y0 = 0.5, y1 = 0.5): P[] =>
  Array.from({ length: steps }, (_, i) => {
    const t = i / (steps - 1);
    return { x: from + (to - from) * t, y: y0 + (y1 - y0) * t, time: 1000 + ms * t };
  });
const shift = (points: P[], dt: number): P[] => points.map(p => ({ ...p, time: p.time + dt }));
const feed = (detector: SwipeDetector, points: P[], pinching = false): SwipeDirection | null =>
  points.reduce<SwipeDirection | null>((found, p) => found ?? detector.push(p.x, p.y, p.time, { pinching }), null);

describe('挥手判定', () => {
  it('向右快速划过是 right，向左是 left', () => {
    expect(detectSwipe(sweep(0.2, 0.6))).toBe('right');
    expect(detectSwipe(sweep(0.7, 0.3))).toBe('left');
  });
  it('幅度太小不算挥手', () => expect(detectSwipe(sweep(0.4, 0.52))).toBeNull());
  it('挥得太慢不算挥手', () => expect(detectSwipe(sweep(0.2, 0.6, 1600, 9))).toBeNull());
  it('同时明显上下移动不算挥手', () => {
    expect(detectSwipe(sweep(0.2, 0.6, 300, 7, 0.3, 0.62))).toBeNull();
  });
  it('来回抖动不算挥手', () => {
    const jitter: P[] = [
      { x: 0.2, y: 0.5, time: 1000 }, { x: 0.5, y: 0.5, time: 1100 },
      { x: 0.3, y: 0.5, time: 1200 }, { x: 0.56, y: 0.5, time: 1300 },
      { x: 0.34, y: 0.5, time: 1400 }, { x: 0.6, y: 0.5, time: 1500 },
    ];
    expect(detectSwipe(jitter)).toBeNull();
  });
});

describe('挥手检测器', () => {
  it('一次挥手只触发一次，冷却结束后才能再次触发', () => {
    const detector = new SwipeDetector();
    expect(feed(detector, sweep(0.2, 0.6))).toBe('right');
    // 冷却期内（首次挥手结束于 1300ms，冷却到 2200ms）即使再挥也不翻页。
    expect(feed(detector, shift(sweep(0.2, 0.6), 350))).toBeNull();
    expect(feed(detector, shift(sweep(0.2, 0.6), 1300))).toBe('right');
  });

  it('捏合期间不判定挥手', () => {
    const detector = new SwipeDetector();
    expect(feed(detector, sweep(0.2, 0.6), true)).toBeNull();
  });

  it('捏合结束后要等一小段时间，避免伸手去点按钮被当成挥手', () => {
    const detector = new SwipeDetector();
    detector.push(0.5, 0.5, 1000, { pinching: true });
    expect(feed(detector, shift(sweep(0.2, 0.6, 200, 5), -500))).toBeNull();
    expect(feed(detector, shift(sweep(0.2, 0.6, 200, 5), 400))).toBe('right');
  });

  it('持续捏合中的大幅快速挥动仍可识别（放松手型挥手）', () => {
    const detector = new SwipeDetector();
    detector.push(0.3, 0.5, 1000, { pinching: true }); // 捏合开始：静默至 1300ms
    const pts = sweep(0.3, 0.7, 280, 8).map(p => ({ ...p, time: p.time + 320 })); // 1320–1600ms，保持捏合
    let hit: SwipeDirection | null = null;
    for (const p of pts) hit = detector.push(p.x, p.y, p.time, { pinching: true }) ?? hit;
    expect(hit).toBe('right');
  });

  it('捏合开始会清空此前积累的挥动轨迹', () => {
    const detector = new SwipeDetector();
    let hit: SwipeDirection | null = null;
    for (const p of sweep(0.3, 0.42, 150, 5)) hit = detector.push(p.x, p.y, p.time) ?? hit; // dx 0.12，不足以触发
    detector.push(0.42, 0.5, 1160, { pinching: true }); // 捏合开始 → 清空 + 静默至 1460ms
    // 静默期后继续移动 dx 0.13；若轨迹未被清空，两段合计 0.25 会触发翻页。
    for (const p of sweep(0.42, 0.55, 150, 5).map(q => ({ ...q, time: q.time + 460 })))
      hit = detector.push(p.x, p.y, p.time, { pinching: true }) ?? hit;
    expect(hit).toBeNull();
  });

  it('reset 后不会把两段小位移拼成一次挥手', () => {
    const detector = new SwipeDetector();
    const first = sweep(0.2, 0.32, 200, 4);
    const second = shift(sweep(0.32, 0.44, 200, 4), 250);
    for (const p of first) detector.push(p.x, p.y, p.time);
    detector.reset();
    let hit: SwipeDirection | null = null;
    for (const p of second) hit = detector.push(p.x, p.y, p.time) ?? hit;
    expect(hit).toBeNull();
  });
});
