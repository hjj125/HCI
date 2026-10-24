/** 地理内核：经纬度 ↔ 三维向量、射线-球求交、点在多边形内判定。
 *  纯函数、无渲染依赖，与贴图渲染共用同一映射约定，结果可复现、可单元测试。
 *  约定（与 three.js 球体 + 等距圆柱贴图对齐）：y 轴指向北极，经度 -180°~180°，纬度 -90°~90°。
 */
export type V3 = [number, number, number];

export function latLonToVector3(lat: number, lon: number, radius = 1): V3 {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return [
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  ];
}

export function vector3ToLatLon(v: V3): { lat: number; lon: number } {
  const r = Math.hypot(v[0], v[1], v[2]) || 1;
  const lat = 90 - (Math.acos(v[1] / r) * 180) / Math.PI;
  let lon = (Math.atan2(v[2], -v[0]) * 180) / Math.PI - 180;
  while (lon < -180) lon += 360;
  while (lon > 180) lon -= 360;
  return { lat, lon };
}

/** 射线与球求交：返回最近的正向交点，未命中返回 null。 */
export function raySphere(origin: V3, dir: V3, center: V3, radius: number): V3 | null {
  const oc: V3 = [origin[0] - center[0], origin[1] - center[1], origin[2] - center[2]];
  const d = (dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]) || 1;
  const b = 2 * (oc[0] * dir[0] + oc[1] * dir[1] + oc[2] * dir[2]) / d;
  const c = (oc[0] * oc[0] + oc[1] * oc[1] + oc[2] * oc[2]) - radius * radius;
  const disc = b * b - 4 * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / 2;
  if (t < 0) return null;
  return [origin[0] + dir[0] / Math.sqrt(d) * t, origin[1] + dir[1] / Math.sqrt(d) * t, origin[2] + dir[2] / Math.sqrt(d) * t];
}

/** 偶奇规则：点是否在经纬度环内（Natural Earth 数据已在日期变更线处拆分多边形）。 */
export function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export type RegionGeometry = { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] };
export type RegionFeature = {
  properties: { NAME: string; NAME_ZH?: string; CONTINENT?: string; SUBREGION?: string; POP_EST?: number };
  geometry: RegionGeometry;
};

/** 点是否落在该区域的多边形内（含洞：外环在内且不在任一内环中）。 */
export function pointInRegion(lon: number, lat: number, geom: RegionGeometry): boolean {
  const inPolygon = (polygon: number[][][]) =>
    polygon.length > 0 && pointInRing(lon, lat, polygon[0]) && !polygon.slice(1).some(hole => pointInRing(lon, lat, hole));
  return geom.type === 'Polygon'
    ? inPolygon(geom.coordinates as number[][][])
    : (geom.coordinates as number[][][][]).some(inPolygon);
}

/** 在区域集合中查找点所在区域；返回 null 表示命中海洋或边界外。 */
export function findRegion(features: RegionFeature[], lon: number, lat: number): RegionFeature | null {
  for (const f of features) if (pointInRegion(lon, lat, f.geometry)) return f;
  return null;
}
