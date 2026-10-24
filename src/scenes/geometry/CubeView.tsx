import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Section, Vec3 } from './geometry';

type World = {
  camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; controls: OrbitControls;
  plane: THREE.Mesh; sectionGroup: THREE.Group; faceMeshes: THREE.Mesh[]; observer: ResizeObserver;
};

/**
 * 场景只创建一次；切面参数变化时只更新平面姿态与截面网格。
 * 否则拖动滑块会以每帧一次的频率重建 WebGL 上下文，造成明显卡顿。
 * 六个立方体面各有一块半透明高亮板，切面经过哪些面就亮哪些面（faceIndices）。
 */
export function CubeView({normal,offset,section,hostRef}:{normal:Vec3;offset:number;section:Section;hostRef?:React.RefObject<HTMLDivElement|null>}) {
 const host=useRef<HTMLDivElement>(null);
 const world=useRef<World|null>(null);
 useEffect(()=>{
  const el=host.current!; const scene=new THREE.Scene(); scene.background=new THREE.Color('#101e33');
  const camera=new THREE.PerspectiveCamera(38,1,0.1,100); camera.position.set(4,3,5);
  let renderer:THREE.WebGLRenderer;
  try {renderer=new THREE.WebGLRenderer({antialias:true});} catch {el.textContent='WebGL 不可用，请启用浏览器硬件加速。二维截面和任务仍可使用。';return;}
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2)); el.appendChild(renderer.domElement);
  const controls=new OrbitControls(camera,renderer.domElement); controls.enableDamping=true; controls.enablePan=false;
  scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(2,2,2)),new THREE.LineBasicMaterial({color:0x9fb9d5})));
  const plane=new THREE.Mesh(new THREE.PlaneGeometry(4,4),new THREE.MeshBasicMaterial({color:0x2dd4bf,transparent:true,opacity:0.12,side:THREE.DoubleSide,depthWrite:false}));
  scene.add(plane);
  const sectionGroup=new THREE.Group(); scene.add(sectionGroup);
  scene.add(new THREE.AxesHelper(1.4));
  const faceMeshes=([[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]] as Vec3[]).map(d=>{
    const m=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicMaterial({color:0xf4c784,transparent:true,opacity:0.22,side:THREE.DoubleSide,depthWrite:false}));
    const v=new THREE.Vector3(...d);
    m.position.copy(v).multiplyScalar(1.004);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),v);
    m.visible=false; scene.add(m);
    return m;
  });
  const resize=()=>{const w=el.clientWidth,h=el.clientHeight;renderer.setSize(w,h);camera.aspect=h?w/h:1;camera.updateProjectionMatrix();};
  const observer=new ResizeObserver(resize);observer.observe(el); resize();
  let frame=0; const tick=()=>{frame=requestAnimationFrame(tick);controls.update();renderer.render(scene,camera);};tick();
  world.current={camera,renderer,controls,plane,sectionGroup,faceMeshes,observer};
  return ()=>{cancelAnimationFrame(frame);observer.disconnect();controls.dispose();scene.traverse(obj=>{const o=obj as THREE.Mesh;if(o.geometry)o.geometry.dispose();if(o.material){(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.dispose());}});renderer.dispose();renderer.domElement.remove();world.current=null;};
 },[]);
 useEffect(()=>{
  const w=world.current; if(!w)return;
  const n=new THREE.Vector3(...normal).normalize();
  w.plane.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),n);
  w.plane.position.copy(n).multiplyScalar(offset);
  // 高亮切面经过的面：与面重合等特殊状态不当作普通相交展示。
  const active=section.kind==='polygon'&&!section.coincident?section.faces:[];
  w.faceMeshes.forEach((m,i)=>{m.visible=active.includes(i);});
  const group=w.sectionGroup;
  group.children.slice().forEach(child=>{
   group.remove(child);
   const o=child as THREE.Mesh;
   o.geometry?.dispose();
   (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m?.dispose());
  });
  if(section.kind==='polygon'){
   const positions=section.points.flat(); const indices=[]; for(let i=1;i<section.points.length-1;i++) indices.push(0,i,i+1);
   const geo=new THREE.BufferGeometry(); geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3)); geo.setIndex(indices); geo.computeVertexNormals();
   group.add(new THREE.Mesh(geo,new THREE.MeshBasicMaterial({color:0x2dd4bf,side:THREE.DoubleSide,transparent:true,opacity:0.8})));
   group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(section.points.map(p=>new THREE.Vector3(...p))),new THREE.LineBasicMaterial({color:0xc6fff1})));
  }
 },[normal[0],normal[1],normal[2],offset,section]);
 return <div className="cube-view" ref={node=>{host.current=node;if(hostRef)hostRef.current=node;}}/>;
}
