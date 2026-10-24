import { describe, it, expect } from 'vitest';
import { latLonToVector3, vector3ToLatLon, raySphere, pointInRing, pointInRegion, findRegion, type RegionFeature } from './geoMath';

describe('经纬度与三维向量换算', () => {
  it('往返一致（含极点、日期变更线、悉尼）', () => {
    const cases: [number, number][] = [[0, 0], [90, 0], [-90, 0], [0, 180], [0, -180], [51.5, -0.12], [-33.87, 151.21], [39.9, 116.4]];
    for (const [lat, lon] of cases) {
      const v = latLonToVector3(lat, lon);
      const back = vector3ToLatLon(v);
      expect(Math.abs(back.lat - lat)).toBeLessThan(1e-9);
      const lonDiff = Math.abs(back.lon - lon);
      expect(Math.min(lonDiff, 360 - lonDiff)).toBeLessThan(1e-9);
    }
  });
  it('北京在单位球上模长为 1', () => {
    const v = latLonToVector3(39.9, 116.4);
    expect(Math.hypot(...v)).toBeCloseTo(1, 12);
  });
});

describe('射线与球求交', () => {
  it('从球外正面命中', () => {
    const hit = raySphere([0, 0, 3], [0, 0, -1], [0, 0, 0], 1);
    expect(hit).not.toBeNull();
    expect(hit![2]).toBeCloseTo(1, 12);
  });
  it('偏离球心时未命中返回 null', () => {
    expect(raySphere([0, 5, 5], [0, 0, -1], [0, 0, 0], 1)).toBeNull();
  });
  it('球在射线背后返回 null', () => {
    expect(raySphere([0, 0, 3], [0, 0, 1], [0, 0, 0], 1)).toBeNull();
  });
});

describe('点在多边形内判定', () => {
  const square = [[[100, 20], [110, 20], [110, 30], [100, 30], [100, 20]]];
  it('方形区域内外判定', () => {
    expect(pointInRing(105, 25, square[0])).toBe(true);
    expect(pointInRing(115, 25, square[0])).toBe(false);
    expect(pointInRing(105, 35, square[0])).toBe(false);
  });
  it('Polygon 类型含外环与洞', () => {
    const withHole = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]];
    expect(pointInRegion(2, 2, { type: 'Polygon', coordinates: withHole })).toBe(true);
    expect(pointInRegion(5, 5, { type: 'Polygon', coordinates: withHole })).toBe(false); // 在洞里
  });
  it('MultiPolygon 任一部分命中即命中', () => {
    const mp = { type: 'MultiPolygon' as const, coordinates: [[square[0]], [[[120, 0], [130, 0], [130, 10], [120, 10], [120, 0]]]] };
    expect(pointInRegion(105, 25, mp)).toBe(true);
    expect(pointInRegion(125, 5, mp)).toBe(true);
    expect(pointInRegion(105, 5, mp)).toBe(false);
  });
});

describe('区域查找', () => {
  const fixture: RegionFeature[] = [{
    properties: { NAME: 'Testland', NAME_ZH: '测试国', CONTINENT: 'Asia' },
    geometry: { type: 'MultiPolygon', coordinates: [[[[100, 20], [110, 20], [110, 30], [100, 30], [100, 20]]]] },
  }];
  it('命中返回区域，海洋返回 null', () => {
    expect(findRegion(fixture, 105, 25)?.properties.NAME).toBe('Testland');
    expect(findRegion(fixture, 0, 0)).toBeNull();
  });
});
