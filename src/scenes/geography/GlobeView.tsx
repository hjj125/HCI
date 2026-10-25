import { forwardRef, useEffect, useImperativeHandle, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { latLonToVector3, vector3ToLatLon, type RegionFeature } from './geoMath';

/** 选中的位置（marker 与边界高亮）。 */
export type GlobeSelection = { name: string; lat: number; lon: number } | null;

export type GlobeHandle = {
  applyRotate(dx: number, dy: number): void;
  zoom(delta: number): void;
  pickAt(nx: number, ny: number): { lat: number; lon: number } | null;
  flyTo(lat: number, lon: number): void;
  addSpin(direction: 1 | -1): void;
  addPitch(direction: 1 | -1): void;
  brake(): void;
  freezeInertia(): void;
};

type Props = {
  hostRef: RefObject<HTMLDivElement | null>;
  features: RegionFeature[] | null;
  selected: GlobeSelection;
  graticule: boolean;
  /** 昼夜模式：昼面贴图与夜面城市灯光按太阳方向混合，晨昏线实时可见。 */
  night?: boolean;
  /** 世界坐标系太阳方向（单位向量）；night 模式下驱动昼夜分界。 */
  sunDirection?: [number, number, number] | null;
};

/**
 * 共享三维地球：昼面贴图 + 法线 + 云层 + 大气辉光 + 星空 + 经纬网 + 国界。
 * 通过 ref 暴露旋转/缩放/拾取/飞行命令式 API；夜面模式供晨昏线实验复用。
 * 地理学科的两个实验（找国家、晨昏线）共用本组件。
 */
export const GlobeView = forwardRef<GlobeHandle, Props>(function GlobeView(
  { hostRef, features, selected, graticule, night = false, sunDirection = null }, ref,
) {
  // 惯性旋转状态（组件内部）：挥手冲量、张掌刹车、捏合冻结都经由 handle 方法驱动。
  const spinVel = useRef(0);
  const pitchVel = useRef(0);
  const braking = useRef(false);
  const fly = useRef<null | { t0: number; fromY: number; toY: number; fromX: number; toX: number; fromZ: number; toZ: number }>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const world = useRef<any>(null);

  useImperativeHandle(ref, () => ({
    applyRotate(dx: number, dy: number) {
      const w = world.current; if (!w) return;
      w.earthGroup.rotation.y += dx * 4.2;
      w.earthGroup.rotation.x = Math.max(-1.2, Math.min(1.2, w.earthGroup.rotation.x + dy * 2.4));
      fly.current = null;
    },
    zoom(delta: number) {
      const w = world.current; if (!w) return;
      w.camera.position.z = Math.max(1.45, Math.min(6, w.camera.position.z + delta));
    },
    pickAt(nx: number, ny: number) {
      const w = world.current; if (!w) return null;
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(nx * 2 - 1, -(ny * 2 - 1)), w.camera);
      const hit = ray.intersectObject(w.earth)[0];
      if (!hit) return null;
      const local = w.earthGroup.worldToLocal(hit.point.clone());
      const { lat, lon } = vector3ToLatLon([local.x, local.y, local.z]);
      return { lat, lon };
    },
    flyTo(lat: number, lon: number) {
      const w = world.current; if (!w) return;
      spinVel.current = 0; pitchVel.current = 0;
      // 目标姿态：使 (lat, lon) 转到面向相机。
      const target = latLonToVector3(lat, lon, 1);
      let toY = Math.atan2(-target[0], target[2]);
      let dY = toY - w.earthGroup.rotation.y;
      while (dY > Math.PI) dY -= Math.PI * 2;
      while (dY < -Math.PI) dY += Math.PI * 2;
      fly.current = {
        t0: performance.now(),
        fromY: w.earthGroup.rotation.y, toY: w.earthGroup.rotation.y + dY,
        fromX: w.earthGroup.rotation.x, toX: Math.max(-1.2, Math.min(1.2, (lat * Math.PI) / 180)),
        fromZ: w.camera.position.z, toZ: Math.min(w.camera.position.z, 2.3),
      };
    },
    addSpin(direction: 1 | -1) { spinVel.current = Math.max(-1.6, Math.min(1.6, spinVel.current + direction * 0.85)); },
    addPitch(direction: 1 | -1) { pitchVel.current = Math.max(-1.2, Math.min(1.2, pitchVel.current + direction * 0.6)); },
    brake() { braking.current = true; },
    freezeInertia() { spinVel.current = 0; pitchVel.current = 0; fly.current = null; },
  }), []);

  // 三维场景初始化（一次）。
  useEffect(() => {
    const el = hostRef.current; if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch { el.textContent = 'WebGL 不可用，请启用硬件加速。任务面板仍可使用。'; return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#050914');
    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
    camera.position.set(0, 0, 3.1);
    scene.add(new THREE.AmbientLight(0xffffff, 0.38));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.15); sun.position.set(5, 2, 4); scene.add(sun);
    const loader = new THREE.TextureLoader();
    const earthGroup = new THREE.Group(); scene.add(earthGroup);
    // 昼夜 shader：世界空间法线与太阳方向点积决定昼/夜贴图混合，晨昏线自然呈现。
    const nightMaterial = new THREE.ShaderMaterial({
      uniforms: {
        dayMap: { value: loader.load('/assets/earth_atmos_2048.jpg') },
        nightMap: { value: loader.load('/assets/earth_lights_2048.png') },
        sunDir: { value: new THREE.Vector3(1, 0, 0) },
      },
      vertexShader: [
        'varying vec3 vWorldNormal; varying vec2 vUv;',
        'void main(){ vUv = uv; vWorldNormal = normalize(mat3(modelMatrix) * normal);',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D dayMap; uniform sampler2D nightMap; uniform vec3 sunDir;',
        'varying vec3 vWorldNormal; varying vec2 vUv;',
        'void main(){',
        '  float d = dot(normalize(vWorldNormal), normalize(sunDir));',
        '  float dayMix = smoothstep(-0.12, 0.12, d);',
        '  vec3 day = texture2D(dayMap, vUv).rgb;',
        '  vec3 nightLights = texture2D(nightMap, vUv).rgb * 1.5;',
        '  vec3 nightSide = nightLights + day * 0.05;',
        '  gl_FragColor = vec4(mix(nightSide, day, dayMix), 1.0);',
        '}',
      ].join('\n'),
    });
    const dayMaterial = new THREE.MeshPhongMaterial({
      map: loader.load('/assets/earth_atmos_2048.jpg'),
      normalMap: loader.load('/assets/earth_normal_2048.jpg'),
      normalScale: new THREE.Vector2(0.8, 0.8),
      shininess: 14, specular: new THREE.Color(0x445566),
    });
    const earth = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 64), night ? nightMaterial : dayMaterial);
    earthGroup.add(earth);
    const clouds = new THREE.Mesh(new THREE.SphereGeometry(1.012, 48, 48),
      new THREE.MeshPhongMaterial({ map: loader.load('/assets/earth_clouds_1024.png'), transparent: true, opacity: 0.55, depthWrite: false }));
    clouds.visible = !night;
    earthGroup.add(clouds);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(1.16, 48, 48), new THREE.ShaderMaterial({
      vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vN; void main(){ float i = pow(0.62 - dot(vN, vec3(0.0,0.0,1.0)), 3.0); gl_FragColor = vec4(0.30,0.62,1.0,1.0) * i; }',
      side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    }));
    scene.add(glow);
    const starPos = new Float32Array(2400);
    for (let i = 0; i < 800; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(18 + Math.random() * 10);
      starPos.set([v.x, v.y, v.z], i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xbfd4ff, size: 0.05, sizeAttenuation: true })));
    const grat = new THREE.Group(); grat.name = 'graticule'; earthGroup.add(grat);
    const gratMat = new THREE.LineBasicMaterial({ color: 0x7ae8d4, transparent: true, opacity: 0.18 });
    for (let lat = -60; lat <= 60; lat += 30) for (let lon = -180; lon < 180; lon += 5) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...latLonToVector3(lat, lon, 1.003)), new THREE.Vector3(...latLonToVector3(lat, lon + 5, 1.003))]);
      grat.add(new THREE.Line(g, gratMat));
    }
    for (let lon = -180; lon < 180; lon += 30) for (let lat = -88; lat < 88; lat += 4) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...latLonToVector3(lat, lon, 1.003)), new THREE.Vector3(...latLonToVector3(lat + 4, lon, 1.003))]);
      grat.add(new THREE.Line(g, gratMat));
    }
    const borders = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x9fe8d8, transparent: true, opacity: 0.55 }));
    earthGroup.add(borders);
    const highlight = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xf4c784 }));
    earthGroup.add(highlight);
    const marker = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 16), new THREE.MeshBasicMaterial({ color: 0xf4c784 }));
    marker.visible = false; earthGroup.add(marker);
    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); camera.aspect = h ? w / h : 1; camera.updateProjectionMatrix(); };
    const observer = new ResizeObserver(resize); observer.observe(el); resize();
    let frame = 0, prev = performance.now();
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const now = performance.now(), dt = Math.min((now - prev) / 1000, 0.05); prev = now;
      clouds.rotation.y += 0.0004;
      // 飞行定位动画（语音定位）优先于惯性。
      if (fly.current) {
        const f = fly.current, t = Math.min(1, (now - f.t0) / 1100), k = easeOutCubic(t);
        earthGroup.rotation.y = f.fromY + (f.toY - f.fromY) * k;
        earthGroup.rotation.x = f.fromX + (f.toX - f.fromX) * k;
        camera.position.z = f.fromZ + (f.toZ - f.fromZ) * k;
        if (t >= 1) fly.current = null;
      } else {
        earthGroup.rotation.y += spinVel.current * dt;
        earthGroup.rotation.x = Math.max(-1.25, Math.min(1.25, earthGroup.rotation.x + pitchVel.current * dt));
        if (Math.abs(earthGroup.rotation.x) >= 1.25) pitchVel.current = 0;
        spinVel.current *= braking.current ? 0.78 : 0.985;
        pitchVel.current *= braking.current ? 0.78 : 0.985;
        if (Math.abs(spinVel.current) < 0.0008) spinVel.current = 0;
        if (Math.abs(pitchVel.current) < 0.0008) pitchVel.current = 0;
      }
      braking.current = false;
      renderer.render(scene, camera);
    };
    tick();
    world.current = { scene, camera, renderer, earthGroup, earth, marker, highlight, borders, observer, nightMaterial };
    return () => { cancelAnimationFrame(frame); observer.disconnect(); renderer.dispose(); renderer.domElement.remove(); world.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 太阳方向 → shader uniform。
  useEffect(() => {
    const w = world.current; if (!w || !sunDirection) return;
    w.nightMaterial.uniforms.sunDir.value.set(sunDirection[0], sunDirection[1], sunDirection[2]);
  }, [sunDirection]);

  // 边界数据 → 线段。
  useEffect(() => {
    const w = world.current; if (!w || !features) return;
    const pts: number[] = [];
    for (const f of features) for (const poly of (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][])
      for (const ring of poly) for (let i = 0; i + 1 < ring.length; i++) {
        pts.push(...latLonToVector3(ring[i][1], ring[i][0], 1.004), ...latLonToVector3(ring[i + 1][1], ring[i + 1][0], 1.004));
      }
    w.borders.geometry.dispose();
    w.borders.geometry = new THREE.BufferGeometry();
    w.borders.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }, [features]);

  // 选中区域 → marker 与边界高亮；经纬网开关。
  useEffect(() => {
    const w = world.current; if (!w) return;
    const grat = w.earthGroup.getObjectByName('graticule');
    if (grat) grat.visible = graticule;
    if (!selected || !features) { w.marker.visible = false; w.highlight.geometry.dispose(); w.highlight.geometry = new THREE.BufferGeometry(); return; }
    w.marker.position.set(...latLonToVector3(selected.lat, selected.lon, 1.02));
    w.marker.visible = true;
    const f = features.find(x => x.properties.NAME === selected.name);
    const pts: number[] = [];
    if (f) for (const poly of (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][])
      for (const ring of poly) for (let i = 0; i + 1 < ring.length; i++)
        pts.push(...latLonToVector3(ring[i][1], ring[i][0], 1.006), ...latLonToVector3(ring[i + 1][1], ring[i + 1][0], 1.006));
    w.highlight.geometry.dispose();
    w.highlight.geometry = new THREE.BufferGeometry();
    w.highlight.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }, [selected, features, graticule]);

  return null;
});
