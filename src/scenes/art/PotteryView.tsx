import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { lathePoints, type Profile } from './pottery';

export type PotteryHandle = {
  zoom(delta: number): void;
  /** 屏幕归一化坐标 → 陶坯表面命中；onClay=false 表示命中捏合代理柱（手在坯附近但没碰到泥）。 */
  pick(nx: number, ny: number): { u: number; v: number; py: number; dirSign: 1 | -1; onClay: boolean } | null;
  /** 渲染当前帧并返回 PNG dataURL（导出作品照）。 */
  snapshot(): string;
  /** 导出陶坯为 GLB 二进制（含彩绘贴图）。 */
  exportGLB(): Promise<Blob>;
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

const R_SCALE = 0.52, Y_SCALE = 0.8;   // 纵向比例拉高：默认圆柱高径比 ≈ 1.4，避免矮胖

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
      const clayHit = ray.intersectObject(w.clay, false)[0];
      if (clayHit && clayHit.uv) {
        return { u: clayHit.uv.x, v: clayHit.uv.y, py: clayHit.point.y / Y_SCALE, dirSign: (clayHit.point.x >= 0 ? 1 : -1) as 1 | -1, onClay: true };
      }
      // 手在坯附近但没碰到泥：用隐形代理柱取高度与内外侧，仍可捏塑。
      const proxyHit = ray.intersectObject(w.pinchProxy, false)[0];
      if (proxyHit) {
        return { u: 0, v: 0, py: proxyHit.point.y / Y_SCALE, dirSign: (proxyHit.point.x >= 0 ? 1 : -1) as 1 | -1, onClay: false };
      }
      return null;
    },
    snapshot() {
      const w = world.current; if (!w) return '';
      w.renderer.render(w.scene, w.camera);   // preserveDrawingBuffer 下 toDataURL 取当帧
      return w.renderer.domElement.toDataURL('image/png');
    },
    exportGLB() {
      const w = world.current;
      if (!w) return Promise.reject(new Error('视图未就绪'));
      return new Promise<Blob>((resolve, reject) => {
        new GLTFExporter().parse(w.clay, gltf => {
          const json = gltf as ArrayBuffer | object;
          resolve(new Blob([json as ArrayBuffer], { type: 'model/gltf-binary' }));
        }, err => reject(err instanceof Error ? err : new Error(String(err))), { binary: true });
      });
    },
  }), []);

  useEffect(() => {
    const el = hostRef.current; if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); }
    catch { el.textContent = 'WebGL 不可用，请启用硬件加速。任务面板仍可使用。'; return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    // 暖色摄影棚背景：竖直渐变（奶油→暖沙）。
    const bgCanvas = document.createElement('canvas');
    bgCanvas.width = 16; bgCanvas.height = 256;
    const bgCtx = bgCanvas.getContext('2d');
    if (bgCtx) {
      const g = bgCtx.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, '#f4ecdf'); g.addColorStop(0.6, '#ecdfc9'); g.addColorStop(1, '#dccbb0');
      bgCtx.fillStyle = g; bgCtx.fillRect(0, 0, 16, 256);
      const bgTex = new THREE.CanvasTexture(bgCanvas);
      bgTex.colorSpace = THREE.SRGBColorSpace;
      scene.background = bgTex;
    } else scene.background = new THREE.Color('#ecdfc9');
    const camera = new THREE.PerspectiveCamera(44, 1, 0.05, 100);
    camera.position.set(0, 0.72, 2.0);
    camera.lookAt(0, 0.26, 0);
    scene.add(new THREE.HemisphereLight(0xfff6e8, 0xd8c4a8, 1.05));
    const key = new THREE.DirectionalLight(0xfff2e0, 1.5); key.position.set(2.2, 3.4, 2.4); scene.add(key);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -1.6, right: 1.6, top: 1.6, bottom: -1.6, near: 0.5, far: 10 });
    const fill = new THREE.DirectionalLight(0xe8f0ff, 0.3); fill.position.set(-3, 1.5, -1.5); scene.add(fill);
    // 地台：暖色圆盘承接柔和阴影。
    const floor = new THREE.Mesh(new THREE.CircleGeometry(6, 48), new THREE.MeshStandardMaterial({ color: 0xe7dac2, roughness: 0.92 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.26;
    floor.receiveShadow = true;
    scene.add(floor);
    // 陶轮：暖瓷转盘 + 墩座（只转转盘与陶坯同组，墩座静止）。
    const wheelGroup = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.82, 0.05, 48), new THREE.MeshStandardMaterial({ color: 0xefe6d6, roughness: 0.5 }));
    disc.position.y = 0.02;
    disc.receiveShadow = true;
    wheelGroup.add(disc);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.02, 10, 48), new THREE.MeshStandardMaterial({ color: 0xb8a184, roughness: 0.6 }));
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.045;
    wheelGroup.add(rim);
    scene.add(wheelGroup);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.62, 0.3, 40), new THREE.MeshStandardMaterial({ color: 0xd9c7ab, roughness: 0.75 }));
    base.position.y = -0.12;
    scene.add(base);
    // 陶坯：物理材质瓷釉感（clearcoat + sheen），由 profile effect 首次重建。
    const clay = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshPhysicalMaterial({
      color: 0xf7f1e7, roughness: 0.42, metalness: 0,
      clearcoat: 0.18, clearcoatRoughness: 0.35, sheen: 0.45, side: THREE.DoubleSide,
    }));
    clay.castShadow = true;
    scene.add(clay);
    // 捏合代理柱：手指在坯附近但未碰到泥时仍可取高度与内外侧（渲染不可见）。
    const pinchProxy = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.72, 16), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    pinchProxy.position.y = 0.32;
    scene.add(pinchProxy);
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
    world.current = { camera, scene, clay, pinchProxy, observer, renderer };
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
      const pts = lathePoints(profile, 12).map(p => new THREE.Vector2(p.r * R_SCALE, p.y * Y_SCALE));
      const geo = new THREE.LatheGeometry(pts, 96);
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
