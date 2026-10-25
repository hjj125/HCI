import { describe, it, expect } from 'vitest';
import { elbowAngle, bestElbowAngle, flexState, musclePair, upperBodyVisible, BONES, type PosePoint } from './bioMotion';

const pt = (x: number, y: number, visibility = 1): PosePoint => ({ x, y, visibility });

/** 构造一个 33 点骨架：右臂肩(0.4,0.2) 肘(0.5,0.3) 腕(0.6,0.2) → 肘角 90°；左臂在画面外。 */
function makePose(rightElbowDegAt = { sx: 0.4, sy: 0.2, ex: 0.5, ey: 0.3, wx: 0.6, wy: 0.2 }): PosePoint[] {
  const lms: PosePoint[] = Array.from({ length: 33 }, () => pt(0, 0, 0.1));
  lms[11] = pt(0.3, 0.25); lms[12] = pt(rightElbowDegAt.sx, rightElbowDegAt.sy);   // 左肩低可见/右肩可见
  lms[13] = pt(0, 0, 0.1); lms[14] = pt(rightElbowDegAt.ex, rightElbowDegAt.ey);
  lms[15] = pt(0, 0, 0.1); lms[16] = pt(rightElbowDegAt.wx, rightElbowDegAt.wy);
  lms[23] = pt(0.3, 0.6); lms[24] = pt(0.45, 0.6);
  return lms;
}

describe('生物·运动系统内核', () => {
  it('肘关节角度：右臂直角配置 → 90°；可见性不足 → null', () => {
    const pose = makePose();
    expect(elbowAngle(pose, 'right')).toBeCloseTo(90, 6);
    expect(elbowAngle(pose, 'left')).toBeNull();   // 左臂关键点 visibility 0.1
  });
  it('bestElbowAngle 自动选可见一侧', () => {
    const r = bestElbowAngle(makePose());
    expect(r?.side).toBe('right');
    expect(r?.deg).toBeCloseTo(90, 6);
    expect(bestElbowAngle([])).toBeNull();
  });
  it('屈伸状态阈值：≤100 屈肘、≥160 伸肘、中间半屈', () => {
    expect(flexState(60)).toBe('屈肘');
    expect(flexState(100)).toBe('屈肘');
    expect(flexState(130)).toBe('半屈');
    expect(flexState(160)).toBe('伸肘');
    expect(flexState(178)).toBe('伸肘');
  });
  it('肌肉协作：屈肘二头1/三头0，伸肘相反，随角度单调', () => {
    const flexed = musclePair(60);
    expect(flexed.biceps).toBeCloseTo(1, 9);
    expect(flexed.triceps).toBeCloseTo(0, 9);
    const extended = musclePair(160);
    expect(extended.biceps).toBeCloseTo(0, 9);
    expect(extended.triceps).toBeCloseTo(1, 9);
    expect(musclePair(120).biceps).toBeCloseTo(0.4, 9);
    expect(musclePair(150).biceps).toBeGreaterThan(musclePair(130).biceps ? 0 : -1);
    expect(musclePair(140).biceps).toBeLessThan(musclePair(120).biceps);
    expect(musclePair(80).note).toContain('二头肌收缩');
  });
  it('取景判定：肩可见且至少一条手臂可见', () => {
    expect(upperBodyVisible(makePose())).toBe(true);
    const dark = makePose().map(p => ({ ...p, visibility: 0.2 }));
    expect(upperBodyVisible(dark)).toBe(false);
  });
  it('骨骼连接对包含躯干与双臂主链', () => {
    const has = (a: number, b: number) => BONES.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
    expect(has(11, 12)).toBe(true);   // 双肩
    expect(has(13, 15)).toBe(true);   // 左肘-腕
    expect(has(23, 24)).toBe(true);   // 双髋
    expect(has(12, 14)).toBe(true);   // 右肩-肘
  });
});
