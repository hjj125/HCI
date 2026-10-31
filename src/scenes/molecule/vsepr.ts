import type { Atom, Bond, Element } from './molecule';

/**
 * VSEPR 价层电子对互斥模型（教学近似）：按"成键方向数"给中心原子选几何，
 * 孤对电子的挤压效果用固定经验键角编码（水 104.5°、氨 107°）。
 * 摆放 = 从每个连通分量中度数最大的原子出发 BFS 生成树，逐层按几何模板定向放置；
 * 环边不参与摆放（自然连接已放好的原子），环状结构不保证键长理想——课标案例均为链/小分子。
 * 全部为确定性纯函数，可单元测试。
 */

export type GeoType = 'terminal' | 'linear' | 'trigonal' | 'tetrahedral' | 'bent1045' | 'pyramidal107' | 'bent120';
export type GeoInfo = { type: GeoType; zh: string; angle: number | null };
export type Vec3 = { x: number; y: number; z: number };

const GEO_ZH: Record<GeoType, string> = {
  terminal: '端基',
  linear: '直线形',
  trigonal: '平面三角形',
  tetrahedral: '正四面体',
  bent1045: '折角形（V 形）',
  pyramidal107: '三角锥形',
  bent120: '平面折角形',
};

const GEO_ANGLE: Record<GeoType, number | null> = {
  terminal: null, linear: 180, trigonal: 120, tetrahedral: 109.5, bent1045: 104.5, pyramidal107: 107, bent120: 120,
};

/** 中心原子的几何类型：按元素 + 成键邻居数（教学近似：孤对效果并入经验键角）。 */
export function geometryOf(el: Element, neighbors: number): GeoType {
  if (neighbors <= 1) return 'terminal';
  if (el === 'C') return neighbors >= 4 ? 'tetrahedral' : neighbors === 3 ? 'trigonal' : 'linear';
  if (el === 'N') return neighbors >= 3 ? 'pyramidal107' : 'bent120';
  if (el === 'O') return 'bent1045';
  return neighbors >= 4 ? 'tetrahedral' : neighbors === 3 ? 'trigonal' : 'linear';
}

export function geometryInfo(type: GeoType): GeoInfo {
  return { type, zh: GEO_ZH[type], angle: GEO_ANGLE[type] };
}

/** 邻居数 ≥2 的中心原子几何标签（面板显示用）。 */
export function geometryLabels(atoms: Atom[], bonds: Bond[]): { id: number; el: Element; info: GeoInfo }[] {
  const ids = new Set(atoms.map(a => a.id));
  const adj = adjacency(atoms, bonds);
  return atoms
    .filter(a => (adj.get(a.id)?.length ?? 0) >= 2)
    .map(a => ({ id: a.id, el: a.el, info: geometryInfo(geometryOf(a.el, adj.get(a.id)!.length)) }));
}

const norm3 = (x: number, y: number, z: number): Vec3 => {
  const l = Math.hypot(x, y, z) || 1;
  return { x: x / l, y: y / l, z: z / l };
};
const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const dot3 = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Rodrigues 旋转：把 from 转到 to 的同一旋转作用于 v。 */
function rotateTo(v: Vec3, from: Vec3, to: Vec3): Vec3 {
  const d = Math.max(-1, Math.min(1, dot3(from, to)));
  if (d > 0.99999) return v;
  if (d < -0.99999) {
    const axis = Math.abs(from.x) < 0.9 ? cross({ x: 1, y: 0, z: 0 }, from) : cross({ x: 0, y: 1, z: 0 }, from);
    return rotateAxis(v, norm3(axis.x, axis.y, axis.z), Math.PI);
  }
  const c = cross(from, to);
  return rotateAxis(v, norm3(c.x, c.y, c.z), Math.acos(d));
}

function rotateAxis(v: Vec3, k: Vec3, theta: number): Vec3 {
  const c = Math.cos(theta), s = Math.sin(theta);
  const kv = cross(k, v);
  const kd = dot3(k, v);
  return { x: v.x * c + kv.x * s + k.x * kd * (1 - c), y: v.y * c + kv.y * s + k.y * kd * (1 - c), z: v.z * c + kv.z * s + k.z * kd * (1 - c) };
}

/** 几何方向模板（单位向量；两两夹角即教学键角）。 */
function template(type: GeoType): Vec3[] {
  const half = (deg: number) => (deg * Math.PI) / 180 / 2;
  switch (type) {
    case 'linear': return [norm3(1, 0, 0), norm3(-1, 0, 0)];
    case 'bent1045': { const h = half(104.5); return [norm3(Math.sin(h), Math.cos(h), 0), norm3(-Math.sin(h), Math.cos(h), 0)]; }
    case 'bent120': { const h = half(120); return [norm3(Math.sin(h), Math.cos(h), 0), norm3(-Math.sin(h), Math.cos(h), 0)]; }
    case 'trigonal': return [norm3(1, 0, 0), norm3(-0.5, Math.sqrt(3) / 2, 0), norm3(-0.5, -Math.sqrt(3) / 2, 0)];
    case 'tetrahedral': return [norm3(1, 1, 1), norm3(1, -1, -1), norm3(-1, 1, -1), norm3(-1, -1, 1)];
    case 'pyramidal107': {
      const cosPhi = Math.sqrt((Math.cos((107 * Math.PI) / 180) + 0.5) / 1.5);
      const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
      return [0, 120, 240].map(deg => {
        const az = (deg * Math.PI) / 180;
        return norm3(sinPhi * Math.cos(az), cosPhi, sinPhi * Math.sin(az));
      });
    }
    default: return [norm3(1, 0, 0)];
  }
}

function adjacency(atoms: Atom[], bonds: Bond[]): Map<number, number[]> {
  const ids = new Set(atoms.map(a => a.id));
  const adj = new Map<number, number[]>();
  for (const a of atoms) adj.set(a.id, []);
  for (const b of bonds) {
    if (!ids.has(b.a) || !ids.has(b.b) || b.a === b.b) continue;
    adj.get(b.a)!.push(b.b);
    adj.get(b.b)!.push(b.a);
  }
  return adj;
}

/** 生成模板方向并按父方向定向：返回前 kidsCount 个为子原子方向（父方向槽位移到末尾）。 */
function orientedDirs(type: GeoType, degree: number, parentDir: Vec3 | undefined): Vec3[] {
  let dirs = template(type).slice();
  while (dirs.length < degree) dirs.push(norm3(0, Math.sin(dirs.length), Math.cos(dirs.length))); // 超价中态兜底
  if (!parentDir) return dirs;
  let best = 0, bestDot = -2;
  dirs.forEach((d, i) => {
    const dt = dot3(d, parentDir);
    if (dt > bestDot) { bestDot = dt; best = i; }
  });
  const rotated = dirs.map(d => rotateTo(d, dirs[best], parentDir));
  const [taken] = rotated.splice(best, 1);
  rotated.push(taken);
  return rotated;
}

/**
 * VSEPR 理想坐标：每个连通分量从度数最大的原子出发 BFS，按几何模板逐层放置。
 * 返回原子 id → 位置（分量间在 x 方向铺开）。环边不参与生成树，仅连接已放置的原子。
 */
export function vseprLayout(atoms: Atom[], bonds: Bond[], bondLength = 0.95): Map<number, Vec3> {
  const pos = new Map<number, Vec3>();
  if (!atoms.length) return pos;
  const adj = adjacency(atoms, bonds);
  const elOf = new Map(atoms.map(a => [a.id, a.el]));
  const visited = new Set<number>();
  let compIndex = 0;
  for (const a of atoms) {
    if (visited.has(a.id)) continue;
    const comp: number[] = [];
    const q = [a.id];
    visited.add(a.id);
    while (q.length) {
      const cur = q.shift()!;
      comp.push(cur);
      for (const n of adj.get(cur) ?? []) if (!visited.has(n)) { visited.add(n); q.push(n); }
    }
    const root = comp.reduce((best, id) => (adj.get(id)!.length > adj.get(best)!.length ? id : best), comp[0]);
    pos.set(root, { x: compIndex * 2.8, y: 0, z: 0 });
    compIndex++;
    const parentDir = new Map<number, Vec3>();
    const queue = [root];
    const done = new Set<number>([root]);
    while (queue.length) {
      const u = queue.shift()!;
      const kids = (adj.get(u) ?? []).filter(v => !done.has(v));
      if (!kids.length) continue;
      const dirs = orientedDirs(geometryOf(elOf.get(u)!, (adj.get(u) ?? []).length), (adj.get(u) ?? []).length, parentDir.get(u));
      kids.forEach((v, i) => {
        const dir = dirs[i] ?? norm3(Math.cos(i * 2.4), Math.sin(i * 2.4), 0.3);
        const pu = pos.get(u)!;
        pos.set(v, { x: pu.x + bondLength * dir.x, y: pu.y + bondLength * dir.y, z: pu.z + bondLength * dir.z });
        parentDir.set(v, { x: -dir.x, y: -dir.y, z: -dir.z });
        done.add(v);
        queue.push(v);
      });
    }
  }
  return pos;
}
