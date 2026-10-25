import { forwardRef, useEffect, useImperativeHandle, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { SYNODIC_MONTH } from './moonMath';

export type MoonHandle = { zoom(delta: number): void };
type Props = { hostRef: RefObject<HTMLDivElement | null>; ageDays: number };

const ORBIT_R = 1.35;

/** 月相仪三维视图：地球居中、月球绕转（距角 = 月龄/朔望月 × 360°，0° 朝太阳方向即新月）。
 *  方向光模拟太阳：月球的昼夜半球随公转自然呈现；相机俯视轨道面。 */
export const MoonView = forwardRef<MoonHandle, Props>(function MoonView({ hostRef, ageDays }, ref) {
  const world = useRef<any>(null);

  useImperativeHandle(ref, () => ({
    zoom(delta: number) {
      const w = world.current; if (!w) return;
      w.camera.position.z = Math.max(2.3, Math.min(5.5, w.camera.position.z + delta));
    },
  }), []);

  useEffect(() => {
    const el = hostRef.current; if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch { el.textContent = 'WebGL 不可用，请启用硬件加速。任务面板仍可使用。'; return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#050914');
    const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 100);
    camera.position.set(0, 1.6, 3.4);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 0.32));
    const sunLight = new THREE.DirectionalLight(0xfff2d8, 1.35);
    sunLight.position.set(8, 1.4, 0);
    scene.add(sunLight);
    // 太阳标记（远处亮球，示意光来自 +X 方向）。
    const sun = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 24), new THREE.MeshBasicMaterial({ color: 0xffd76a }));
    sun.position.set(6, 1.1, 0);
    scene.add(sun);
    const loader = new THREE.TextureLoader();
    const earth = new THREE.Mesh(new THREE.SphereGeometry(0.4, 48, 48), new THREE.MeshPhongMaterial({
      map: loader.load('/assets/earth_atmos_2048.jpg'),
      shininess: 8, specular: new THREE.Color(0x223344),
    }));
    scene.add(earth);
    const moon = new THREE.Mesh(new THREE.SphereGeometry(0.14, 32, 32), new THREE.MeshPhongMaterial({ color: 0xcfd6de, shininess: 4 }));
    scene.add(moon);
    // 轨道参考线。
    const orbitPts: THREE.Vector3[] = [];
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      orbitPts.push(new THREE.Vector3(Math.cos(a) * ORBIT_R, 0, -Math.sin(a) * ORBIT_R));
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(orbitPts), new THREE.LineBasicMaterial({ color: 0x3d5a80, transparent: true, opacity: 0.4 })));
    const stars = new Float32Array(2400);
    for (let i = 0; i < 800; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(14 + Math.random() * 8);
      stars.set([v.x, v.y, v.z], i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(stars, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xbfd4ff, size: 0.05, sizeAttenuation: true })));
    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); camera.aspect = h ? w / h : 1; camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      earth.rotation.y += 0.0012;
      renderer.render(scene, camera);
    };
    tick();
    world.current = { camera, earth, moon, observer, renderer };
    return () => { cancelAnimationFrame(frame); observer.disconnect(); renderer.dispose(); renderer.domElement.remove(); world.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 月龄 → 月球公转位置（0° 距角 = 位于地球与太阳连线上 = 新月）。
  useEffect(() => {
    const w = world.current; if (!w) return;
    const th = (ageDays / SYNODIC_MONTH) * Math.PI * 2;
    w.moon.position.set(Math.cos(th) * ORBIT_R, 0, -Math.sin(th) * ORBIT_R);
  }, [ageDays]);

  return null;
});
