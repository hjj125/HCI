/** 晨昏线实验的天文内核：太阳直射点、昼夜判定、当地时间（确定性纯函数，可单元测试）。
 *  赤纬用简化的周年正弦近似（回归年 365 天，春分 doy≈81）；太阳直射经度由 UTC 时角推出。
 */
import { latLonToVector3 } from './geoMath';

export type Subsolar = { lat: number; lon: number };

/** 太阳直射点：utcHours∈[0,24)，dayOfYear∈[1,365]。 */
export function subsolarPoint(utcHours: number, dayOfYear = 80): Subsolar {
  const decl = 23.44 * Math.sin((2 * Math.PI * (dayOfYear - 81)) / 365);
  let lon = (12 - utcHours) * 15;
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  return { lat: decl, lon };
}

/** 世界坐标系太阳方向（单位向量），驱动 GlobeView 的昼夜 shader。 */
export function sunVector(utcHours: number, dayOfYear = 80): [number, number, number] {
  const s = subsolarPoint(utcHours, dayOfYear);
  return latLonToVector3(s.lat, s.lon, 1);
}

/** 某地此刻是否处于白昼：地平坐标太阳高度角 > 0（球面向量点积）。 */
export function isDaylight(lat: number, lon: number, utcHours: number, dayOfYear = 80): boolean {
  const s = subsolarPoint(utcHours, dayOfYear);
  const sun = latLonToVector3(s.lat, s.lon, 1);
  const p = latLonToVector3(lat, lon, 1);
  return p[0] * sun[0] + p[1] * sun[1] + p[2] * sun[2] > 0;
}

/** 当地太阳时（小时，[0,24)）：UTC + 经度/15。 */
export function localTime(lon: number, utcHours: number): number {
  let t = (utcHours + lon / 15) % 24;
  if (t < 0) t += 24;
  return t;
}
