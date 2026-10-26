import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { lathePoints, type Profile } from './pottery';

export type PotteryHandle = {
  zoom(delta: number): void;
  /** 屏幕归一化坐标 → 陶坯表面命中（uv），未命中返回 null（彩绘用）。 */
  pick(nx: number, ny: number): { u: number; v: number } | null;
};
type Props = {
  hostRef: React.RefObject<HTMLDivElement | null>;
  profile: Profile;
  /** 彩绘纹理画布（场景创建并持有，本视图仅作 CanvasTexture 消费）。 */
  textureCanvas: HTMLCanvasElement | null;
  /** 笔画版本号：每次落笔后 +1，驱动纹理 needsUpdate。 */
  paintVersion: number;
  /** 转轮速度（rad/s），由场景按模式给定。 */
  speed: number;
};

const R_SCALE = 0.52, Y_SCALE = 0.55;

/** 陶艺轮盘视图：转盘持续旋转，陶坯为 LatheGeometry 旋转体，表面贴彩绘 CanvasTexture。
 *  生命周期遵循 CubeView 模式：场景一次创建、profile 变化节流重建几何、tick 不引用 world.current。 */
export const PotteryView = forwardRef<PotteryHandle, Props>(function PotteryView({ hostRef, profile, textureCanvas, paintVersion, speed }, ref) {
  const world = useRef<any>(null);
  const ui = useRef({ profile, textureCanvas, paintVersion, speed });
  ui.current = { profile, textureCanvas, paintVersion, speed };

  useImperativeHandle(ref, () => ({
    zoom(delta: number) {
      const w = world.current; if (!w) return;
      w.camera.position.z = Math.max(1.6, Math.min(4.5, w.camera.position.z + delta));
    },
    pick(nx: number, ny: number) {
      const w = world.current; if (!w) return null;
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(nx * 2 - 1, -(ny * 2 - 1)), w.camera);
      const hit = ray.intersectObject(w.clay, false)[0];
      return hit && hit.uv ? { u: hit.uv.x, v: hit.uv.y } : null;
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
    scene.background = new THREE.Color('#0c1727');
    const camera = new THREE.PerspectiveCamera(44, 1, 0.05, 100);
    camera.position.set(0, 1.0, 2.7);
    camera.lookAt(0, 0.34, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xfff4e0, 0.95); key.position.set(2.4, 3.2, 2.6); scene.add(key);
    const fill = new THREE.DirectionalLight(0xbfd4ff, 0.35); fill.position.set(-3, 1.5, -1.5); scene.add(fill);
    // 陶轮：转盘 + 底座（只转转盘与陶坯同组，底座静止）。
    const wheelGroup = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.82, 0.05, 48), new THREE.MeshPhongMaterial({ color: 0x33415e, shininess: 18 }));
    disc.position.y = 0.02;
    wheelGroup.add(disc);
    scene.add(wheelGroup);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.5, 0.26, 32), new THREE.MeshPhongMaterial({ color: 0x1a2436 }));
    base.position.y = -0.12;
    scene.add(base);
    // 陶坯：初始空几何，由 profile effect 首次重建。
    const clay = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 10 }));
    scene.add(clay);
    const grid = new THREE.GridHelper(6, 24, 0x1c2c44, 0x141f33); grid.position.y = -0.25; scene.add(grid);
    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); camera.aspect = h ? w / h : 1; camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    let frame = 0, prev = performance.now();
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min((now - prev) / 1000, 0.05); prev = now;
      wheelGroup.rotation.y += ui.current.speed * dt;   // 陶轮与陶坯同转
      renderer.render(scene, camera);
    };
    tick();
    world.current = { camera, clay, observer, renderer };
    return () => {
      cancelAnimationFrame(frame); observer.disconnect();
      scene.traverse(obj => {
        const m = obj as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) Array.isArray(m.material) ? m.material.forEach(x => x.dispose()) : m.material.dispose();
      });
      renderer.dispose(); renderer.domElement.remove(); world.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // profile 变化 → 节流重建陶坯几何（50ms）；材质贴图保持。
  useEffect(() => {
    const w = world.current;
    if (!w) return;
    const rebuild = () => {
      const pts = lathePoints(profile, 10).map(p => new THREE.Vector2(p.r * R_SCALE, p.y * Y_SCALE));
      const geo = new THREE.LatheGeometry(pts, 64);
      w.clay.geometry.dispose();
      w.clay.geometry = geo;
    };
    const now = performance.now();
    const last = (world.current as any).lastRebuild ?? 0;
    if (now - last >= 50) { rebuild(); (world.current as any).lastRebuild = now; }
    else {
      const timer = setTimeout(() => { if (world.current) { rebuild(); (world.current as any).lastRebuild = performance.now(); } }, 55);
      return () => clearTimeout(timer);
    }
  }, [profile]);

  // 彩绘画布 → CanvasTexture（画布只建一次，笔画后 needsUpdate）。
  useEffect(() => {
    const w = world.current; if (!w) return;
    if (textureCanvas && !w.texture) {
      w.texture = new THREE.CanvasTexture(textureCanvas);
      w.texture.wrapS = THREE.RepeatWrapping;
      w.clay.material.map = w.texture;
      w.clay.material.color.set(0xffffff);
      w.clay.material.needsUpdate = true;
    }
    if (w.texture) w.texture.needsUpdate = true;
  }, [textureCanvas, paintVersion]);

  return null;
});
