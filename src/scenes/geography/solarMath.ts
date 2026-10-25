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

/* ===== 五带与四季实验扩展：五带划分、昼长、太阳高度角、影长 =====
 * 同为确定性纯函数；正午太阳高度 = 90° − |纬度 − 赤纬|，昼长由日出日落时角公式导出。 */

export const TROPIC = 23.44;       // 南北回归线（黄赤交角）
export const POLAR_CIRCLE = 66.56; // 南北极圈（90° − 23.44°）

export type Zone = '北寒带' | '北温带' | '热带' | '南温带' | '南寒带';
export type DaylightState = '极昼' | '昼长夜短' | '昼夜平分' | '昼短夜长' | '极夜';
/** 渲染与语音共用的五带固定顺序（索引即 GlobeView 着色带编号）。 */
export const ZONE_ORDER: readonly Zone[] = ['北寒带', '北温带', '热带', '南温带', '南寒带'];

/** 纬度所属五带（分界值归入高纬侧：回归线属温带起点、极圈属寒带起点）。 */
export function zoneOf(lat: number): Zone {
  if (lat >= POLAR_CIRCLE) return '北寒带';
  if (lat >= TROPIC) return '北温带';
  if (lat > -TROPIC) return '热带';
  if (lat > -POLAR_CIRCLE) return '南温带';
  return '南寒带';
}

/** 昼长（小时/天）：cos H₀ = −tanφ·tanδ（H₀ 为日出日落时角）；≥24 极昼、≤0 极夜。 */
export function daylightHours(lat: number, decl: number): number {
  const phi = (lat * Math.PI) / 180;
  const d = (decl * Math.PI) / 180;
  const x = -Math.tan(phi) * Math.tan(d);
  if (x <= -1) return 24;
  if (x >= 1) return 0;
  return (2 * ((Math.acos(x) * 180) / Math.PI)) / 15;
}

/** 昼夜长短状态：与 12 小时比较（±3 分钟内视为昼夜平分）。 */
export function daylightState(hours: number): DaylightState {
  if (hours >= 24) return '极昼';
  if (hours <= 0) return '极夜';
  if (hours > 12.05) return '昼长夜短';
  if (hours < 11.95) return '昼短夜长';
  return '昼夜平分';
}

/** 某地当天给定当地太阳时的高度角（度）：sin h = sinφ·sinδ + cosφ·cosδ·cosH。 */
export function altitudeAtSolarHour(lat: number, decl: number, solarHour: number): number {
  const phi = (lat * Math.PI) / 180;
  const d = (decl * Math.PI) / 180;
  const H = ((solarHour - 12) * 15 * Math.PI) / 180;
  const sinH = Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H);
  return (Math.asin(Math.max(-1, Math.min(1, sinH))) * 180) / Math.PI;
}

/** 某地此刻太阳高度角（度）：由日期取赤纬、由 UTC+经度取时角；>0 ⟺ isDaylight。 */
export function solarAltitude(lat: number, lon: number, utcHours: number, dayOfYear = 80): number {
  return altitudeAtSolarHour(lat, subsolarPoint(utcHours, dayOfYear).lat, localTime(lon, utcHours));
}

/** 影长与标杆高度之比 = 1/tan(h)；h≤0（太阳未升/已落）返回 null。直射时趋于 0（“立竿无影”）。 */
export function shadowRatio(lat: number, lon: number, utcHours: number, dayOfYear = 80): number | null {
  const h = solarAltitude(lat, lon, utcHours, dayOfYear);
  if (h <= 0) return null;
  return 1 / Math.tan((h * Math.PI) / 180);
}

/** 日出/日落当地太阳时 [日出, 日落]；极昼 [0,24]，极夜 null。 */
export function sunriseSunset(lat: number, decl: number): [number, number] | null {
  const hours = daylightHours(lat, decl);
  if (hours <= 0) return null;
  if (hours >= 24) return [0, 24];
  return [12 - hours / 2, 12 + hours / 2];
}
