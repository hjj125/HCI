import { describe, it, expect } from 'vitest';
import { angleNormal, sectionCube } from './geometry';
describe('正方体截面',()=>{
  it('中轴切面为四边形',()=>expect(sectionCube([1,0,0],0).points).toHaveLength(4));
  it('对角中心截面为六边形',()=>expect(sectionCube([1,1,1],0).points).toHaveLength(6));
  it('近顶点截面为三角形',()=>expect(sectionCube([1,1,1],1.4).points).toHaveLength(3));
  it('支持五边形',()=>expect(sectionCube([1,2,3],0.4).points).toHaveLength(5));
  it('无交集',()=>expect(sectionCube([1,0,0],2).kind).toBe('none'));
  it('经过顶点退化',()=>expect(sectionCube([1,1,1],Math.sqrt(3)).kind).toBe('degenerate'));
  it('与面重合有显式标记',()=>expect(sectionCube([1,0,0],1).coincident).toBe(true));
  it('标记切面经过的面',()=>{
    expect(sectionCube([1,0,0],0).faces).toHaveLength(4);          // 上下前后
    expect(sectionCube([1,1,1],0).faces).toHaveLength(6);          // 六个面都参与
    expect(sectionCube([1,0,0],2).faces).toHaveLength(0);          // 无交集
    // 与面重合时切面贴着另外四个面的棱；界面按“特殊状态”过滤，不当作普通参与面展示。
    expect(sectionCube([1,0,0],1).faces).toHaveLength(4);
  });
  it('所有交点满足平面和立方体约束',()=>{
    for(let i=0;i<50;i++) {const n:[number,number,number]=[1,i/17+0.1,0.8], d=i/40-0.5, m=Math.hypot(...n); const r=sectionCube(n,d); for(const p of r.points){ expect(p.reduce((s,v,k)=>s+v*n[k]/m,0)).toBeCloseTo(d,6); expect(p.every(v=>Math.abs(v)<=1.000001)).toBe(true);}}
  });
  // 界面上的四个预设必须真的给出 3/4/5/6 边形，否则任务 B 的目标无法达成。
  it('界面预设与任务目标边数一致',()=>{
    const presets:[number,number,number,number][]=[[45,35.264,1.4,3],[0,0,0,4],[63.435,53.301,0.4,5],[45,35.264,0,6]];
    for(const [az,el,offset,edges] of presets){
      const r=sectionCube(angleNormal(az,el),offset);
      expect(r.kind).toBe('polygon'); expect(r.coincident).toBe(false); expect(r.points).toHaveLength(edges);
    }
  });
  it('预设覆盖任务 B 的全部四个目标',()=>{
    const targets=new Set([3,4,5,6].map(n=>{const found=[[45,35.264,1.4],[0,0,0],[63.435,53.301,0.4],[45,35.264,0]].find(([az,el,offset])=>sectionCube(angleNormal(az,el),offset).points.length===n);return found?n:null;}));
    expect([...targets].sort()).toEqual([3,4,5,6]);
  });
});
