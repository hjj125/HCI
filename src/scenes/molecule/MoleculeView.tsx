import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { ELEMENT_ZH, VALENCE, type Atom, type Bond, type Element } from './molecule';

export type MoleculeHandle = {
  /** 统一指针入口（鼠标与手势都换算成画布归一化坐标后调用）。 */
  pointer(phase: 'start' | 'update' | 'end' | 'cancel', nx: number, ny: number): void;
  zoom(delta: number): void;
  /** 灵犀的手：移到某原子上方（每帧跟随投影）。 */
  handToAtom(id: number): void;
  /** 灵犀的手：移到画布空闲位（加原子前的"伸手取料"）。 */
  handToFree(): void;
  handPinch(pinch: boolean): void;
  handShow(show: boolean): void;
  /** 推原子：短时间内把它的位置拉向偏移点；之后理想几何缓动会把它拉回——"推氢回弹"。 */
  nudgeAtom(id: number): void;
};
type Props = {
  hostRef: React.RefObject<HTMLDivElement | null>;
  atoms: Atom[];
  bonds: Bond[];
  selectedId: number | null;
  onAtomClick: (id: number) => void;
  /** VSEPR 理想坐标（null = 自由摆放模式，走弹簧物理）。 */
  targets: Map<number, { x: number; y: number; z: number }> | null;
  /** 已达满价的原子 id（渲染为灰调——不能再连新键）。 */
  fullIds: Set<number>;
};

const COLORS: Record<Element, number> = { H: 0xeef2f7, C: 0x39434f, N: 0x3f74e8, O: 0xe0524a };
const RADII: Record<Element, number> = { H: 0.17, C: 0.28, N: 0.27, O: 0.26 };
const bondKeyOf = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** 球棍模型视图：拓扑（原子/键）由场景给入；位置默认缓动到 VSEPR 理想坐标（可拖动，松手回到理想位），
 *  切到自由摆放时退回弹簧物理。交互为点选式：点击原子 → 场景解释成键/升级双键/断键。 */
export const MoleculeView = forwardRef<MoleculeHandle, Props>(function MoleculeView({ hostRef, atoms, bonds, selectedId, onAtomClick, targets, fullIds }, ref) {
  const world = useRef<any>(null);
  const pos = useRef(new Map<number, { x: number; y: number; z: number }>());
  const usedRef = useRef(new Map<number, number>());
  // 灵犀的手（DOM 覆盖层，避免逐帧 React 渲染）。
  const hand = useRef({
    visible: false, pinch: false,
    target: null as null | { atomId: number } | { free: true },
    pos: { x: 0.86, y: 0.14 },
    nudge: null as null | { id: number; offset: { x: number; y: number; z: number }; until: number },
  });
  const ui = useRef({
    atoms, bonds, selectedId, onAtomClick, targets, fullIds,
    dragging: null as null | { id: number; planeZ: number }, down: null as null | { x: number; y: number }, moved: 0,
  });
  ui.current.atoms = atoms; ui.current.bonds = bonds; ui.current.selectedId = selectedId; ui.current.onAtomClick = onAtomClick;
  ui.current.targets = targets; ui.current.fullIds = fullIds;

  const pick = (nx: number, ny: number): number | null => {
    const w = world.current; if (!w) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(nx * 2 - 1, -(ny * 2 - 1)), w.camera);
    const hits = ray.intersectObjects(w.atomGroup.children, false);
    return hits.length ? (hits[0].object.userData.id as number) : null;
  };
  const dragTo = (nx: number, ny: number, id: number, planeZ: number) => {
    const w = world.current; if (!w) return;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(nx * 2 - 1, -(ny * 2 - 1)), w.camera);
    const t = (planeZ - ray.ray.origin.z) / (ray.ray.direction.z || 1e-9);
    if (t <= 0) return;
    const p = ray.ray.origin.clone().addScaledVector(ray.ray.direction, t);
    const cur = pos.current.get(id);
    if (cur) { cur.x = Math.max(-2, Math.min(2, p.x)); cur.y = Math.max(-1.4, Math.min(1.4, p.y)); }
  };

  useImperativeHandle(ref, () => ({
    pointer(phase, nx, ny) {
      const st = ui.current;
      if (phase === 'start') {
        const id = pick(nx, ny);
        st.moved = 0; st.down = { x: nx, y: ny };
        const p = id != null ? pos.current.get(id) : null;
        st.dragging = id != null && p ? { id, planeZ: p.z } : null;
        return;
      }
      if (phase === 'update') {
        if (st.down) st.moved += Math.hypot(nx - st.down.x, ny - st.down.y);
        st.down = { x: nx, y: ny };
        if (st.dragging) dragTo(nx, ny, st.dragging.id, st.dragging.planeZ);
        return;
      }
      if (phase === 'end' && st.moved < 0.03) {
        const id = pick(nx, ny);
        if (id != null) st.onAtomClick(id);
      }
      st.dragging = null; st.down = null;
    },
    zoom(delta) {
      const w = world.current; if (!w) return;
      w.camera.position.z = Math.max(2.2, Math.min(6, w.camera.position.z + delta));
    },
    handToAtom(id) { hand.current.target = { atomId: id }; hand.current.visible = true; },
    handToFree() { hand.current.target = { free: true }; hand.current.visible = true; },
    handPinch(pinch) { hand.current.pinch = pinch; },
    handShow(show) {
      hand.current.visible = show;
      if (!show) { hand.current.target = null; hand.current.pinch = false; }
    },
    nudgeAtom(id) {
      hand.current.target = { atomId: id };
      hand.current.visible = true;
      hand.current.nudge = { id, offset: { x: 0.55, y: -0.32, z: 0.18 }, until: performance.now() + 700 };
    },
  }), []);

  useEffect(() => {
    const el = hostRef.current; if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch { el.textContent = 'WebGL 不可用，请启用硬件加速。任务面板仍可使用。'; return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    // 选中原子的键数徽标（直接操作 DOM，避免逐帧 React 渲染）。
    const badge = document.createElement('div');
    badge.className = 'mol-badge';
    badge.style.display = 'none';
    el.appendChild(badge);
    // 灵犀的手。
    const handEl = document.createElement('div');
    handEl.className = 'mol-hand';
    handEl.style.display = 'none';
    handEl.innerHTML = '<svg viewBox="0 0 40 44" width="34" height="38" aria-hidden="true"><path d="M15 41c-4.5-3.5-8-9-8-13.5 0-2.2 3-2.4 4-.8l2.4 3.3V8.5c0-2.2 3.4-2.2 3.4 0v9.5-13c0-2.2 3.4-2.2 3.4 0v12.5-9c0-2.2 3.4-2.2 3.4 0v10-6.5c0-2.2 3.4-2.2 3.4 0v13.5c0 5.5-2.2 10-5.4 13.5z" fill="rgba(232,246,255,.94)" stroke="#2fbfae" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    el.appendChild(handEl);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#0c1526');
    const camera = new THREE.PerspectiveCamera(46, 1, 0.05, 100);
    camera.position.set(0, 0, 4.2);
    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.0); key.position.set(3, 4, 5); scene.add(key);
    const fill = new THREE.DirectionalLight(0xbfd4ff, 0.35); fill.position.set(-4, -2, 3); scene.add(fill);
    const atomGroup = new THREE.Group(); scene.add(atomGroup);
    const bondGroup = new THREE.Group(); scene.add(bondGroup);
    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); camera.aspect = h ? w / h : 1; camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const st = ui.current;
      const list = st.atoms;
      if (st.targets) {
        // 理想几何：向 VSEPR 目标缓动（被拖动的原子不拉，松手后自动回到理想位）。
        // nudge = 灵犀"推原子"：短时间内把目标点拉向偏移位，之后自然弹回。
        const nw = hand.current.nudge;
        const pushing = nw && performance.now() < nw.until ? nw : null;
        for (const [id, t] of st.targets) {
          const p = pos.current.get(id);
          if (!p || st.dragging?.id === id) continue;
          const dx = pushing && pushing.id === id ? pushing.offset.x : 0;
          const dy = pushing && pushing.id === id ? pushing.offset.y : 0;
          const dz = pushing && pushing.id === id ? pushing.offset.z : 0;
          p.x += (t.x + dx - p.x) * 0.14; p.y += (t.y + dy - p.y) * 0.14; p.z += (t.z + dz - p.z) * 0.14;
        }
      } else {
        // 自由摆放：斥力（未成键太近）+ 键弹簧 + 轻微压平 z。
        for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
          const pa = pos.current.get(list[i].id), pb = pos.current.get(list[j].id);
          if (!pa || !pb) continue;
          const dx = pb.x - pa.x, dy = pb.y - pa.y, dz = pb.z - pa.z;
          const dist = Math.hypot(dx, dy, dz) || 1e-6;
          const bonded = st.bonds.some(b => bondKeyOf(b.a, b.b) === bondKeyOf(list[i].id, list[j].id));
          const rest = 0.32 + RADII[list[i].el] + RADII[list[j].el];
          if (bonded) {
            const err = (dist - rest * 1.6) * 0.06;
            const k = err / dist;
            pa.x += dx * k; pa.y += dy * k; pa.z += dz * k;
            pb.x -= dx * k; pb.y -= dy * k; pb.z -= dz * k;
          } else if (dist < 0.85) {
            const push = ((0.85 - dist) / dist) * 0.12;
            pa.x -= dx * push; pa.y -= dy * push; pa.z -= dz * push * 0.3;
            pb.x += dx * push; pb.y += dy * push; pb.z += dz * push * 0.3;
          }
        }
        for (const [, p] of pos.current) { p.z *= st.dragging ? 1 : 0.9; }
      }
      // 摆放原子球。
      for (const m of atomGroup.children as THREE.Mesh[]) {
        const p = pos.current.get(m.userData.id as number);
        if (p) m.position.set(p.x, p.y, p.z);
      }
      // 摆放键圆柱（双键双圆柱，沿视线垂直方向偏移）。
      for (const m of bondGroup.children as THREE.Mesh[]) {
        const { a, b, slot, count } = m.userData as { a: number; b: number; slot: number; count: number };
        const pa = pos.current.get(a), pb = pos.current.get(b);
        if (!pa || !pb) continue;
        const va = new THREE.Vector3(pa.x, pa.y, pa.z), vb = new THREE.Vector3(pb.x, pb.y, pb.z);
        const dir = vb.clone().sub(va);
        const len = dir.length() || 1e-6;
        const mid = va.clone().add(vb).multiplyScalar(0.5);
        let perp = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 0, 1));
        if (perp.length() < 1e-4) perp = new THREE.Vector3(1, 0, 0);
        perp.normalize();
        const off = count === 2 ? (slot === 0 ? 0.07 : -0.07) : 0;
        m.position.copy(mid).addScaledVector(perp, off);
        m.scale.set(1, len, 1);
        m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      }
      // 选中原子的键数徽标（投影到屏幕坐标；转到背面时隐藏）。
      const sel = st.selectedId != null ? st.atoms.find(a => a.id === st.selectedId) : null;
      const sp = st.selectedId != null ? pos.current.get(st.selectedId) : null;
      if (sel && sp) {
        const v = new THREE.Vector3(sp.x, sp.y, sp.z).project(camera);
        if (v.z < 1) {
          const used = usedRef.current.get(sel.id) ?? 0;
          const cap = VALENCE[sel.el];
          badge.style.display = 'block';
          badge.style.left = `${(v.x * 0.5 + 0.5) * 100}%`;
          badge.style.top = `${(-v.y * 0.5 + 0.5) * 100}%`;
          badge.textContent = `${ELEMENT_ZH[sel.el]} #${sel.id} · 键 ${used}/${cap}${used > cap ? '（超价！）' : used >= cap ? '（已满价）' : ''}`;
        } else badge.style.display = 'none';
      } else badge.style.display = 'none';
      // 灵犀的手：向目标缓动（原子投影 / 画布空闲位），捏合态收拢。
      const h = hand.current;
      if (h.visible) {
        let tx = h.pos.x, ty = h.pos.y;
        if (h.target && 'atomId' in h.target) {
          const p = pos.current.get(h.target.atomId);
          if (p) {
            const v = new THREE.Vector3(p.x, p.y, p.z).project(camera);
            tx = v.x * 0.5 + 0.5; ty = -v.y * 0.5 + 0.5;
          }
        } else if (h.target && 'free' in h.target) { tx = 0.87; ty = 0.14; }
        h.pos.x += (tx - h.pos.x) * 0.22; h.pos.y += (ty - h.pos.y) * 0.22;
        handEl.style.display = 'block';
        handEl.style.left = `${h.pos.x * 100}%`;
        handEl.style.top = `${h.pos.y * 100}%`;
        handEl.classList.toggle('pinch', h.pinch);
      } else handEl.style.display = 'none';
      renderer.render(scene, camera);
    };
    world.current = { camera, atomGroup, bondGroup, renderer, observer };
    tick();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); renderer.dispose(); renderer.domElement.remove(); badge.remove(); handEl.remove(); world.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 新原子落位：理想几何模式下直接出生在 VSEPR 目标位附近；自由模式放在最后一个原子附近。
  useEffect(() => {
    for (const a of atoms) {
      if (!pos.current.has(a.id)) {
        const t = ui.current.targets?.get(a.id);
        if (t) {
          pos.current.set(a.id, { x: t.x + (Math.random() - 0.5) * 0.15, y: t.y + (Math.random() - 0.5) * 0.15, z: t.z });
        } else {
          const existing = [...pos.current.values()];
          const base = existing.length ? existing[existing.length - 1] : { x: 0, y: 0, z: 0 };
          pos.current.set(a.id, { x: base.x + (Math.random() - 0.5) * 0.7, y: base.y + (Math.random() - 0.5) * 0.7, z: 0 });
        }
      }
    }
    for (const id of [...pos.current.keys()]) if (!atoms.some(a => a.id === id)) pos.current.delete(id);
  }, [atoms]);

  // 拓扑/选中变化 → 重建网格（选中原子自发光高亮；满价原子灰调——不能再连新键）。
  useEffect(() => {
    const w = world.current; if (!w) return;
    const used = new Map<number, number>();
    for (const b of bonds) {
      used.set(b.a, (used.get(b.a) ?? 0) + b.order);
      used.set(b.b, (used.get(b.b) ?? 0) + b.order);
    }
    usedRef.current = used;
    w.atomGroup.clear(); w.bondGroup.clear();
    for (const a of atoms) {
      const base = new THREE.Color(COLORS[a.el]);
      const color = ui.current.fullIds.has(a.id) ? base.lerp(new THREE.Color(0x97a1ac), 0.5) : base;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(RADII[a.el], 24, 24),
        new THREE.MeshPhongMaterial({ color, shininess: 30, emissive: selectedId === a.id ? 0x1a8f80 : 0x000000 }),
      );
      mesh.userData.id = a.id;
      w.atomGroup.add(mesh);
    }
    for (const b of bonds) {
      for (let i = 0; i < b.order; i++) {
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 10), new THREE.MeshPhongMaterial({ color: 0x9fb2c8, shininess: 10 }));
        cyl.userData = { a: b.a, b: b.b, slot: i, count: b.order };
        w.bondGroup.add(cyl);
      }
    }
  }, [atoms, bonds, selectedId]);

  return null;
});
