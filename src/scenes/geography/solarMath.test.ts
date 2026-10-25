import { describe, it, expect } from 'vitest';
import { subsolarPoint, sunVector, isDaylight, localTime } from './solarMath';
import { latLonToVector3 } from './geoMath';

describe('晨昏线天文内核', () => {
  it('UTC 正午太阳直射经度 0°，UTC 午夜直射 180°', () => {
    expect(subsolarPoint(12, 80).lon).toBeCloseTo(0, 10);
    expect(subsolarPoint(0, 80).lon).toBeCloseTo(180, 10);
    expect(subsolarPoint(18, 80).lon).toBeCloseTo(-90, 10);
  });
  it('赤纬：夏至为正（北半球夏季），冬至为负', () => {
    expect(subsolarPoint(12, 172).lat).toBeGreaterThan(20);
    expect(subsolarPoint(12, 355).lat).toBeLessThan(-20);
    expect(Math.abs(subsolarPoint(12, 80).lat)).toBeLessThan(1); // 春分近乎 0
  });
  it('昼夜判定：直射点为昼，对跖点为夜', () => {
    expect(isDaylight(0, 0, 12, 80)).toBe(true);
    expect(isDaylight(0, 180, 12, 80)).toBe(false);
    expect(isDaylight(0, -90, 18, 80)).toBe(true);  // UTC18 直射西经 90
    expect(isDaylight(60, 30, 0, 172)).toBe(false); // 夏至午夜的高纬夜
  });
  it('北京 UTC 20:00 时纽约处于白昼（西五区午后）', () => {
    expect(isDaylight(40.7, -74, 12, 80)).toBe(true);
    expect(isDaylight(39.9, 116.4, 12, 80)).toBe(false); // 北京当地约 19:45，已是黑夜
    expect(isDaylight(39.9, 116.4, 16, 80)).toBe(false); // 北京约午夜
  });
  it('当地时间换算与太阳向量一致性', () => {
    expect(localTime(116.4, 4)).toBeCloseTo(11.76, 6);   // 东经116.4° ≈ UTC+7.76
    expect(localTime(-74, 12)).toBeCloseTo(7.0667, 3);
    expect(localTime(180, 23)).toBeCloseTo(11, 10);       // 跨日回绕
    const s = subsolarPoint(9, 172);
    const v = sunVector(9, 172);
    const expect0 = latLonToVector3(s.lat, s.lon, 1);
    expect(v[0]).toBeCloseTo(expect0[0], 9);
    expect(v[2]).toBeCloseTo(expect0[2], 9);
  });
});
