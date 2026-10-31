import { potMetrics, scaleRadius, smoothProfile, stretchProfile, type PotMetrics, type Profile } from './pottery';

/**
 * 灵犀修坯的确定性策略（纯函数，可单测）：检测到造型不达标时，沿固定方向迭代修形。
 * - taller-thinner（修成瓶）：拉高 + 整体收瘦；
 * - flatter-wider（修成碗）：压矮 + "下宽上窄"梯度放宽——碗的判据包含最宽处偏下（maxRy≤0.45），
 *   均匀放大半径永远修不出碗形，必须让底部半径长得比顶部快。
 * 每步做一次平滑抑制锯齿；maxTicks 兜底防不收敛。判据 done 由场景传入（对齐 B_TARGETS）。
 */
export type FixKind = 'taller-thinner' | 'flatter-wider';

const R_MIN = 0.05, R_MAX = 1;

/** 半径垂直梯度：底部乘 bottom、顶部乘 top，中间线性过渡（碗形的"最宽处下沉"）。 */
function tiltRadius(profile: Profile, bottom: number, top: number): Profile {
  const h = potMetrics(profile).height;
  return profile.map(p => ({
    y: p.y,
    r: Math.max(R_MIN, Math.min(R_MAX, p.r * (bottom + (top - bottom) * (h > 0 ? p.y / h : 0)))),
  }));
}

/** 迭代修形直到 done 判定通过（或步数用尽——场景负责把"接近但未达标"讲成手感的留白）。 */
export function fixProfileToward(
  profile: Profile, kind: FixKind, done: (m: PotMetrics) => boolean, maxTicks = 120,
): Profile {
  let p = profile;
  for (let i = 0; i < maxTicks; i++) {
    if (done(potMetrics(p))) return p;
    p = kind === 'taller-thinner'
      ? smoothProfile(scaleRadius(stretchProfile(p, 1.03), 0.985), 1)
      : smoothProfile(tiltRadius(stretchProfile(p, 0.985), 1.05, 0.96), 1);
  }
  return p;
}
