import { describe, it, expect } from 'vitest';
import {
  subsolarPoint, sunVector, isDaylight, localTime,
  zoneOf, daylightHours, daylightState, altitudeAtSolarHour, solarAltitude, shadowRatio, sunriseSunset,
} from './solarMath';
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

describe('五带与四季内核', () => {
  it('五带划分：赤道/回归线内为热带，中纬温带，极圈内寒带', () => {
    expect(zoneOf(0)).toBe('热带');
    expect(zoneOf(20)).toBe('热带');
    expect(zoneOf(23.44)).toBe('北温带');
    expect(zoneOf(40)).toBe('北温带');
    expect(zoneOf(66.56)).toBe('北寒带');
    expect(zoneOf(80)).toBe('北寒带');
    expect(zoneOf(-20)).toBe('热带');
    expect(zoneOf(-23.44)).toBe('南温带');
    expect(zoneOf(-40)).toBe('南温带');
    expect(zoneOf(-66.56)).toBe('南寒带');
    expect(zoneOf(-80)).toBe('南寒带');
  });
  it('昼长：赤道全年 12 小时；夏至北京昼长夜短、冬至昼短夜长', () => {
    expect(daylightHours(0, 23.44)).toBeCloseTo(12, 6);
    expect(daylightHours(0, -23.44)).toBeCloseTo(12, 6);
    expect(daylightHours(0, 0)).toBeCloseTo(12, 6);
    const bjSummer = daylightHours(39.9, 23.44);
    expect(bjSummer).toBeGreaterThan(14);
    expect(bjSummer).toBeLessThan(16);
    expect(daylightHours(39.9, -23.44)).toBeLessThan(10);
  });
  it('昼长：极圈与极点的极昼极夜边界', () => {
    expect(daylightHours(66.56, 23.44)).toBeCloseTo(24, 2);  // 北极圈夏至：极昼
    expect(daylightHours(66.56, -23.44)).toBeCloseTo(0, 2);  // 北极圈冬至：极夜
    expect(daylightHours(90, 10)).toBe(24);
    expect(daylightHours(90, -10)).toBe(0);
    expect(daylightHours(-66.56, -23.44)).toBeCloseTo(24, 2); // 南极圈南半球夏至
  });
  it('昼夜状态分类', () => {
    expect(daylightState(24)).toBe('极昼');
    expect(daylightState(0)).toBe('极夜');
    expect(daylightState(13.45)).toBe('昼长夜短');
    expect(daylightState(12)).toBe('昼夜平分');
    expect(daylightState(9.15)).toBe('昼短夜长');
    expect(daylightState(daylightHours(1.35, 23.44))).toBe('昼长夜短'); // 新加坡夏至
  });
  it('正午太阳高度 = 90° − |纬度 − 赤纬|；北回归线夏至正午直射', () => {
    expect(altitudeAtSolarHour(23.44, 23.44, 12)).toBeCloseTo(90, 3);
    expect(altitudeAtSolarHour(40, 23.44, 12)).toBeCloseTo(90 - 16.56, 2);
    expect(altitudeAtSolarHour(-33.9, 23.44, 12)).toBeCloseTo(90 - 57.34, 2);
    expect(altitudeAtSolarHour(0, 0, 0)).toBeCloseTo(-90, 5); // 赤道春分子夜太阳在地平线下
  });
  it('太阳高度角与昼夜判定一致（抽样）', () => {
    const cases: [number, number, number, number][] = [
      [39.9, 116.4, 12, 172], [0, 0, 18, 80], [68.97, 33, 4, 355],
      [-69.37, 76, 3, 172], [40, -74, 16, 80], [78.2, 15.6, 9, 190],
    ];
    for (const [lat, lon, utc, doy] of cases) expect(solarAltitude(lat, lon, utc, doy) > 0).toBe(isDaylight(lat, lon, utc, doy));
  });
  it('影长：北回归线夏至正午“立竿无影”，夜间无影', () => {
    expect(shadowRatio(23.44, 0, 12, 172)).toBeLessThan(0.01);
    expect(shadowRatio(0, 0, 12, 81)).toBeCloseTo(0, 3);   // 赤道春分正午直射
    expect(shadowRatio(40, 0, 0, 172)).toBeNull();          // 子夜太阳未升
    expect(shadowRatio(40, 116.4, 4.25, 172)).toBeGreaterThan(0.2); // 北京夏日午后有明显影子
    expect(shadowRatio(40, 116.4, 4.25, 172)).toBeLessThan(0.6);
  });
  it('日出日落：赤道 6/18 时，极昼全天，极夜无日', () => {
    expect(sunriseSunset(0, 0)).toEqual([6, 18]);
    expect(sunriseSunset(66.56, 23.44)).toEqual([0, 24]);
    expect(sunriseSunset(66.56, -23.44)).toBeNull();
    const [up, down] = sunriseSunset(40, 23.44)!;
    expect(up).toBeGreaterThan(4);
    expect(up).toBeLessThan(5.5);
    expect(down).toBeGreaterThan(18.5);
    expect(down).toBeLessThan(20);
  });
});
