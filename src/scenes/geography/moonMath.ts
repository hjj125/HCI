/** 月相仪天文内核：均匀朔望月近似下的月相计算（确定性纯函数，可单元测试）。
 *  教学近似：朔望月 29.53 天线性映射到距角 0–360°，不做真实星历/农历历法表
 *  （与真实月相误差 ≤1 天级，界面与本文档均已明示）。锚点取 2000-01-06 18:14 UTC 朔。
 */

export const SYNODIC_MONTH = 29.53;

export type MoonPhaseName = '新月' | '蛾眉月' | '上弦月' | '盈凸月' | '满月' | '亏凸月' | '下弦月' | '残月';

/** 月龄（天）→ 距角（月球-地球-太阳连线夹角，度，[0,360)）。 */
export function moonAgeToElongation(ageDays: number): number {
  const e = ((ageDays % SYNODIC_MONTH) / SYNODIC_MONTH) * 360;
  return e < 0 ? e + 360 : e;
}

/** 距角 → 月相名与照亮比例（(1−cos)/2：0 新月 → 1 满月）。 */
export function phaseFromElongation(elongDeg: number): { name: MoonPhaseName; illumination: number } {
  const e = ((elongDeg % 360) + 360) % 360;
  const illumination = (1 - Math.cos((e * Math.PI) / 180)) / 2;
  let name: MoonPhaseName;
  if (e < 22.5 || e >= 337.5) name = '新月';
  else if (e < 67.5) name = '蛾眉月';
  else if (e < 112.5) name = '上弦月';
  else if (e < 157.5) name = '盈凸月';
  else if (e < 202.5) name = '满月';
  else if (e < 247.5) name = '亏凸月';
  else if (e < 292.5) name = '下弦月';
  else name = '残月';
  return { name, illumination };
}

/** 朔日锚点：2000-01-06 18:14 UTC（JPL 已知朔时刻）。 */
const NEW_MOON_ANCHOR = Date.UTC(2000, 0, 6, 18, 14);

/** 某日期的月龄（天，[0, 29.53)）。 */
export function moonAgeOn(date: Date): number {
  const days = (date.getTime() - NEW_MOON_ANCHOR) / 86400000;
  let age = days % SYNODIC_MONTH;
  if (age < 0) age += SYNODIC_MONTH;
  return age;
}

/** 某日期的月相（教学近似）。 */
export function moonPhaseOnDate(date: Date): { name: MoonPhaseName; illumination: number; ageDays: number } {
  const ageDays = moonAgeOn(date);
  const { name, illumination } = phaseFromElongation(moonAgeToElongation(ageDays));
  return { name, illumination, ageDays };
}

/** 农历日（1–30）→ 月龄近似：初一为朔。 */
export function lunarDayToAge(lunarDay: number): number {
  return ((lunarDay - 1) / 30) * SYNODIC_MONTH;
}

/** 夜间可见时长（小时，教学模型）：满月整夜 12h、上下弦 6h、新月 0h——恰为 12×照亮比例。 */
export function visibleHours(elongDeg: number): number {
  return 12 * phaseFromElongation(elongDeg).illumination;
}

/** 可见规律说明（教学口诀）。 */
export function visibilityNote(name: MoonPhaseName): string {
  switch (name) {
    case '新月': return '与太阳同升同落，夜间不可见';
    case '蛾眉月': return '黄昏时出现在西方天空，不久后落下';
    case '上弦月': return '正午月出、半夜月落，前半夜可见';
    case '盈凸月': return '下午月出、后半夜落，大半夜可见';
    case '满月': return '日落月出、日出月落，整夜可见';
    case '亏凸月': return '夜里月出、上午落，后半夜可见';
    case '下弦月': return '半夜月出、正午月落，后半夜可见';
    case '残月': return '黎明前出现在东方天空';
  }
}

/** 地面视角亮面形状参数：月相的本义是"从地球看到的形状"。
 *  明暗界线为椭圆弧，半宽因子 = |cos(距角)|；亮侧：盈（距角 <180°）在右、亏在左（北半球视角）。 */
export function phaseShape(elongDeg: number): { litSide: 'none' | 'right' | 'left' | 'full'; terminator: number } {
  const e = ((elongDeg % 360) + 360) % 360;
  const c = Math.cos((e * Math.PI) / 180);
  if (e < 1 || e > 359) return { litSide: 'none', terminator: 1 };
  if (e > 179 && e < 181) return { litSide: 'full', terminator: 1 };
  return { litSide: e < 180 ? 'right' : 'left', terminator: Math.abs(c) < 1e-12 ? 0 : Math.abs(c) };
}
