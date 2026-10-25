import { describe, it, expect } from 'vitest';
import {
  SYNODIC_MONTH, moonAgeToElongation, phaseFromElongation, moonAgeOn, moonPhaseOnDate,
  lunarDayToAge, visibleHours, visibilityNote, phaseShape,
} from './moonMath';

describe('月相仪天文内核', () => {
  it('月龄→距角：线性映射与回绕', () => {
    expect(moonAgeToElongation(0)).toBeCloseTo(0, 9);
    expect(moonAgeToElongation(SYNODIC_MONTH / 4)).toBeCloseTo(90, 6);
    expect(moonAgeToElongation(SYNODIC_MONTH / 2)).toBeCloseTo(180, 6);
    expect(moonAgeToElongation(SYNODIC_MONTH)).toBeCloseTo(0, 6);   // 回绕
    expect(moonAgeToElongation(-1)).toBeCloseTo(360 - 360 / SYNODIC_MONTH, 6);
  });
  it('距角→月相名与照亮比例：四相精确，中间段正确', () => {
    expect(phaseFromElongation(0).name).toBe('新月');
    expect(phaseFromElongation(0).illumination).toBeCloseTo(0, 9);
    expect(phaseFromElongation(90).name).toBe('上弦月');
    expect(phaseFromElongation(90).illumination).toBeCloseTo(0.5, 9);
    expect(phaseFromElongation(180).name).toBe('满月');
    expect(phaseFromElongation(180).illumination).toBeCloseTo(1, 9);
    expect(phaseFromElongation(270).name).toBe('下弦月');
    expect(phaseFromElongation(30).name).toBe('蛾眉月');
    expect(phaseFromElongation(135).name).toBe('盈凸月');
    expect(phaseFromElongation(225).name).toBe('亏凸月');
    expect(phaseFromElongation(315).name).toBe('残月');
    expect(phaseFromElongation(359.9).name).toBe('新月');  // 回绕边界
  });
  it('朔日锚点：锚点日为新月，半个月后为满月', () => {
    const anchor = new Date('2000-01-06T18:14:00Z');
    expect(moonAgeOn(anchor)).toBeCloseTo(0, 6);
    expect(moonPhaseOnDate(anchor).name).toBe('新月');
    const full = new Date(anchor.getTime() + (SYNODIC_MONTH / 2) * 86400000);
    expect(moonPhaseOnDate(full).name).toBe('满月');
    const next = new Date(anchor.getTime() + SYNODIC_MONTH * 86400000);
    expect(moonPhaseOnDate(next).name).toBe('新月');   // 一个朔望月后回到新月
  });
  it('农历日→月龄：初一为朔、十五接近望', () => {
    expect(lunarDayToAge(1)).toBeCloseTo(0, 9);
    const full = lunarDayToAge(15);
    expect(phaseFromElongation(moonAgeToElongation(full)).name).toBe('满月');
    expect(phaseFromElongation(moonAgeToElongation(lunarDayToAge(8))).name).toBe('上弦月');
  });
  it('可见时长：新月 0h、上下弦 6h、满月 12h；口诀按相位给出', () => {
    expect(visibleHours(0)).toBeCloseTo(0, 9);
    expect(visibleHours(90)).toBeCloseTo(6, 9);
    expect(visibleHours(180)).toBeCloseTo(12, 9);
    expect(visibleHours(270)).toBeCloseTo(6, 9);
    expect(visibilityNote('满月')).toContain('整夜');
    expect(visibilityNote('上弦月')).toContain('前半夜');
  });
  it('地面视角亮面形状：新月无亮、上弦右半、满月全亮、下弦左半', () => {
    expect(phaseShape(0)).toEqual({ litSide: 'none', terminator: 1 });
    expect(phaseShape(90)).toEqual({ litSide: 'right', terminator: 0 });
    expect(phaseShape(180)).toEqual({ litSide: 'full', terminator: 1 });
    expect(phaseShape(270)).toEqual({ litSide: 'left', terminator: 0 });
    expect(phaseShape(60)).toEqual({ litSide: 'right', terminator: Math.cos(Math.PI / 3) });
    expect(phaseShape(300).litSide).toBe('left');
  });
});
