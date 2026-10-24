export type Vec3 = [number, number, number];
export type Section = { points: Vec3[]; flat: [number, number][]; faces: number[]; kind: 'polygon' | 'degenerate' | 'none'; coincident: boolean };
/** 六个面的中文名，顺序与 faceIndices 对应：x+ x- y+ y- z+ z-。 */
export const faceNames = ['右', '左', '上', '下', '前', '后'];
const FACE_NORMALS: Vec3[] = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
export const dot = (a: Vec3, b: Vec3) => a.reduce((s, v, i) => s + v * b[i], 0);
const sub = (a: Vec3, b: Vec3): Vec3 => a.map((v, i) => v - b[i]) as Vec3;
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const normalize = (a: Vec3): Vec3 => { const m = Math.hypot(...a); if (!m) throw new Error('法向量不能为零'); return a.map(v=>v/m) as Vec3; };
export function sectionCube(normal: Vec3, offset: number): Section {
  const n = normalize(normal), eps = 1e-7;
  const vertices: Vec3[] = [];
  for (const x of [-1,1]) for (const y of [-1,1]) for (const z of [-1,1]) vertices.push([x,y,z]);
  const points: Vec3[] = [];
  const add = (p: Vec3) => { if (!points.some(q => Math.hypot(...sub(p,q)) < eps)) points.push(p); };
  for (let i=0;i<8;i++) for (let j=i+1;j<8;j++) {
    const a=vertices[i], b=vertices[j];
    if (a.filter((v,k)=>v!==b[k]).length!==1) continue;
    const da=dot(n,a)-offset, db=dot(n,b)-offset;
    if (Math.abs(da)<eps) add(a);
    if (Math.abs(db)<eps) add(b);
    if (da*db < 0 && Math.abs(da)>eps && Math.abs(db)>eps) {
      const t=da/(da-db); add(a.map((v,k)=>v+t*(b[k]-v)) as Vec3);
    }
  }
  const u=normalize(cross(n,Math.abs(n[2])<0.9?[0,0,1]:[0,1,0])), v=cross(n,u);
  const center=points.length ? points.reduce((s,p)=>s.map((x,k)=>x+p[k]/points.length) as Vec3,[0,0,0] as Vec3):[0,0,0] as Vec3;
  points.sort((a,b)=> Math.atan2(dot(sub(a,center),v),dot(sub(a,center),u))-Math.atan2(dot(sub(b,center),v),dot(sub(b,center),u)));
  const flat=points.map(p=>[dot(sub(p,center),u),dot(sub(p,center),v)] as [number,number]);
  const coincident = n.some((x,i)=> Math.abs(Math.abs(x)-1)<eps && Math.abs(Math.abs(offset)-1)<eps && n.every((y,j)=>i===j || Math.abs(y)<eps));
  // 标记切面与哪些面相交：在该面所在平面上，交线方程的常数项落在可达范围内。
  const faces:number[]=[];
  FACE_NORMALS.forEach((f,i)=>{
    const axis=f.findIndex(v=>v!==0), side=f[axis];
    const reach=n.reduce((s,v,k)=>k===axis?s:s+Math.abs(v),0);
    if(reach<eps)return; // 切面与该面平行（重合状态已单独标记）
    if(Math.abs(offset-side*n[axis])<=reach+1e-9)faces.push(i);
  });
  return { points, flat, faces, kind: points.length>=3?'polygon':points.length?'degenerate':'none', coincident };
}
export function angleNormal(azimuth: number, elevation: number): Vec3 {
  const a=azimuth*Math.PI/180, e=elevation*Math.PI/180;
  return [Math.cos(e)*Math.cos(a),Math.cos(e)*Math.sin(a),Math.sin(e)];
}
