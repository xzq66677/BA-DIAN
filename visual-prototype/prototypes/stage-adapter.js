/* stage-adapter.js — BA-DIAN 入口视觉 · 地图适配层
 * 目的：把「地图相关的一切」收敛到适配器，原型主体只依赖稳定接口。
 * 地图换了（座位、台面、配色、机位、几何）只需 define 一个新适配器，
 * 入口原型 v5-entrance.html 一个字都不用改。
 *
 * 用法：
 *   <script src="stage-adapter.js"></script>
 *   const stage = BAStage.use('v6-floating-ruins');   // 或 URL ?stage=demo
 *   const FLOOR = stage.floorY;
 *   const stageHandle = stage.build(scene);           // 构建地图几何/灯光/散景
 *   stage.view('menu', {mobile});                     // 取机位 {pos,look,fov}
 *   stage.anchor('seat0');                            // 取落点 {x,y,z}
 *   stageHandle.setRelicVisible(on); setSelectShadow(i,x,z,w,h);
 */
(function () {
  'use strict';

  // ── 接口契约（写进注释，供后交换地图的人照此实现）────────────────
  // spec = {
  //   id, label,
  //   floorY:number,                  // 台面落地 y（角色 root.y = floorY + FOOT_LIFT）
  //   coreRadius, roomRadius,         // 主台 / 侧台半径
  //   anchors: { hero, seat0, seat1, seat2,
  //              selectFocus, selectOther, battlePlayer, battleRival }  // {x,z}
  //   views: { introHigh, lobby, battle,                 // {pos:[x,y,z],look,fov}
  //            menu(mobile,floorY), select(mobile,floorY,h,w) }  // 可函数为动态取景
  //   build(scene, THREE, spec) -> { setRelicVisible(on), setSelectShadow(i,x,z,w,h),
  //                                  setSelectShadowsVisible(on), group }
  // }
  const FOOT_LIFT = 0.03; // 通用视觉常量：脚底离台面的微小抬升，不随地图变化

  const registry = new Map();
  let activeId = null;
  let THREE = null;   // 由宿主 install(THREE) 注入，避免适配层写死全局依赖

  function define(spec) {
    if (!spec || !spec.id) throw new Error('[BAStage] spec.id required');
    registry.set(spec.id, spec);
    if (!activeId) activeId = spec.id;
    return spec;
  }

  function normalize(spec) {
    const floor = spec.floorY;
    function anchor(name, lift) {
      const a = (spec.anchors && spec.anchors[name]) || spec.anchors.hero;
      return { x: a.x, y: floor + (lift == null ? FOOT_LIFT : lift), z: a.z };
    }
    function view(name, ctx) {
      ctx = ctx || {};
      const v = spec.views[name];
      const out = typeof v === 'function'
        ? v(!!ctx.mobile, floor, ctx.h || 1, ctx.w || 1)
        : v;
      if (!out) throw new Error('[BAStage] unknown view: ' + name);
      return { pos: out.pos.slice(), look: out.look.slice(), fov: out.fov };
    }
    return {
      id: spec.id,
      label: spec.label || spec.id,
      floorY: floor,
      coreRadius: spec.coreRadius,
      roomRadius: spec.roomRadius,
      seatAnchors: [spec.anchors.seat0, spec.anchors.seat1, spec.anchors.seat2],
      anchor,
      view,
      build: scene => {
        if (!THREE) throw new Error('[BAStage] call BAStage.install(THREE) before use');
        return spec.build(scene, THREE, spec, floor);
      },
      spec,
    };
  }

  function use(id) {
    const spec = registry.get(id);
    if (!spec) throw new Error('[BAStage] unknown stage: ' + id);
    activeId = id;
    return normalize(spec);
  }
  function current() { return normalize(registry.get(activeId)); }
  function ids() { return Array.from(registry.keys()); }

  // ══════════════════════════════════════════════════════════════════
  // 默认适配器：V6 悬浮遗迹（数值/几何/机位全部来自旧版原型，迁移后视觉不变）
  // ══════════════════════════════════════════════════════════════════
  define({
    id: 'v6-floating-ruins',
    label: '悬浮遗迹 · V6',
    floorY: 1.22,
    coreRadius: 2.65,
    roomRadius: 2.7,
    anchors: {
      hero: { x: 0, z: 0 },
      seat0: { x: 4.9, z: 4.4 },
      seat1: { x: -4.9, z: 4.4 },
      seat2: { x: 0, z: -7.2 },
      selectFocus: { x: -0.95, z: 0.28 },
      selectOther: { x: 0.9, z: -0.55 },
      battlePlayer: { x: -1.35, z: 0.4 },
      battleRival: { x: 1.35, z: 0.4 },
    },
    views: {
      introHigh: { pos: [0, 24, 15], look: [0, 0, 0], fov: 52 },
      lobby: { pos: [0, 16.5, 18], look: [0, 0, 0], fov: 50 },
      battle: { pos: [0, 15, 10.5], look: [0, 0, 1.5], fov: 46 },
      menu: function (mobile, F) {
        return mobile
          ? { pos: [Math.sin(0.5) * 5.0, F + 1.1, Math.cos(0.5) * 5.0], look: [0, F + 0.5, 0], fov: 44 }
          : { pos: [Math.sin(0.5) * 4.2, F + 1.25, Math.cos(0.5) * 4.2], look: [0, F + 0.78, 0], fov: 40 };
      },
      select: function (mobile, F, h, w) {
        const dist = (mobile ? 6.4 : 5.3) * Math.max(1, h * 0.9, w * 0.86);
        const lookY = F + (mobile ? -0.12 : 0.95) * h;
        return mobile
          ? { pos: [0.15, F + 0.92 * h, dist], look: [0, lookY, 0], fov: 52 }
          : { pos: [0.2, F + 2.35 * h, dist * 0.82], look: [0, lookY, 0], fov: 42 };
      },
    },
    build: function buildRuins(scene, THREE, spec, F) {
      // 环境（雾 + 三点布光）：随地图走，主体只管渲染器能力
      scene.fog = new THREE.Fog(0x101b2b, 26, 68);
      const hemi = new THREE.HemisphereLight(0xb8d3ff, 0x485066, 0.85); scene.add(hemi);
      const sun = new THREE.DirectionalLight(0xffe1ac, 2.0); sun.position.set(7, 12, 5);
      sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.camera.near = 1; sun.shadow.camera.far = 44;
      sun.shadow.camera.left = -12; sun.shadow.camera.right = 12;
      sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
      sun.shadow.bias = -0.0008; scene.add(sun);
      const rim = new THREE.DirectionalLight(0x719ddd, 0.75); rim.position.set(-9, 5, -9); scene.add(rim);
      const COL = { bronze: 0xc5a66a, footings: 0x273044, ashlar: 0x626674 };
      const R_CORE = spec.coreRadius, R_ROOM = spec.roomRadius;
      const arena = new THREE.Group(); scene.add(arena);
      const stone = color => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.93, metalness: 0.02 });
      const tmp = new THREE.Object3D();
      function island(radius, seed, height) {
        const g = new THREE.Group();
        const layers = [
          { top: 1.04, bottom: 0.95, depth: 0.42, color: 0x555e6d },
          { top: 0.91, bottom: 0.74, depth: 0.57, color: COL.footings },
          { top: 0.75, bottom: 0.37, depth: height * 0.48, color: 0x384455 },
          { top: 0.4, bottom: 0.11, depth: height * 0.46, color: 0x30374b },
        ];
        let y = 0.05;
        layers.forEach((L, i) => {
          const m = new THREE.Mesh(new THREE.CylinderGeometry(radius * L.top, radius * L.bottom, L.depth, 6), stone(L.color));
          m.rotation.y = Math.PI / 6 + (i < 2 ? 0 : Math.sin(seed + i) * 0.14);
          m.position.set(i < 2 ? 0 : Math.cos(seed) * i * 0.14, y - L.depth / 2, 0);
          m.castShadow = true; m.receiveShadow = true; g.add(m); y -= L.depth;
        });
        return g;
      }
      const goldMat = new THREE.MeshBasicMaterial({ color: COL.bronze, transparent: true, opacity: 0.6 });
      function ring(radius, y, op) {
        const m = new THREE.MeshBasicMaterial({ color: COL.bronze, transparent: true, opacity: op });
        const t = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.024, 4, 6), m);
        t.rotation.x = -Math.PI / 2; t.rotation.z = Math.PI / 6; t.position.y = y; return t;
      }
      // 主台
      const core = new THREE.Group(); arena.add(core);
      core.add(island(R_CORE * 1.2, 7, 3.8));
      const coreDeck = new THREE.Mesh(new THREE.CylinderGeometry(2.88, 3.14, 0.43, 12), stone(0x5e6472));
      coreDeck.position.y = 0.12; coreDeck.receiveShadow = true; core.add(coreDeck);
      [2.58, 2.08, 0.93].forEach(r => core.add(ring(r, 0.345, 0.62)));
      const spokes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.018, 0.43), goldMat, 12);
      for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; tmp.position.set(Math.sin(a) * 1.74, 0.35, Math.cos(a) * 1.74); tmp.rotation.y = a; tmp.updateMatrix(); spokes.setMatrixAt(i, tmp.matrix); }
      core.add(spokes);
      // 选角接触阴影
      const shadows = [0, 1].map(() => {
        const m = new THREE.Mesh(new THREE.CircleGeometry(1, 32),
          new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
        m.rotation.x = -Math.PI / 2; m.position.y = F + 0.012; m.visible = false; m.renderOrder = 2; core.add(m); return m;
      });
      // 遗物
      const relic = new THREE.Mesh(new THREE.OctahedronGeometry(0.6),
        new THREE.MeshStandardMaterial({ color: 0x95cadc, emissive: 0x367f8f, emissiveIntensity: 0.65, roughness: 0.32, metalness: 0.38 }));
      relic.position.set(0, F + 0.5, -1.75); core.add(relic);
      // 侧台 + 栈桥
      function buildRoom(x, z, seed, glow) {
        const g = new THREE.Group(); g.position.set(x, 0, z); arena.add(g);
        g.add(island(R_ROOM, x + z, 2.55));
        const base = new THREE.Mesh(new THREE.CylinderGeometry(R_ROOM, R_ROOM * 1.02, 1.12, 6), stone(COL.ashlar));
        base.position.y = 0.56; base.rotation.y = Math.PI / 6; base.castShadow = true; base.receiveShadow = true; g.add(base);
        const top = new THREE.Mesh(new THREE.CylinderGeometry(R_ROOM * 0.94, R_ROOM * 0.94, 0.14, 6), stone(0x666a75));
        top.position.y = 1.14; top.rotation.y = Math.PI / 6; top.receiveShadow = true; g.add(top);
        g.add(ring(R_ROOM * 0.64, F + 0.006, 0.5));
        const em = new THREE.MeshBasicMaterial({ color: glow || COL.bronze, transparent: true, opacity: 0.5 });
        const edge = new THREE.Mesh(new THREE.TorusGeometry(R_ROOM * 0.97, 0.035, 6, 6), em);
        edge.rotation.x = Math.PI / 2; edge.rotation.z = Math.PI / 6; edge.position.y = F + 0.1; g.add(edge);
        const yaw = Math.atan2(-x, -z); g.rotation.y = yaw;
        const s1 = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.34, 0.62), stone(0x3a4149)); s1.position.set(0, 0.83, R_ROOM * 0.9);
        const s2 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.18, 0.62), stone(0x3a4149)); s2.position.set(0, 0.6, R_ROOM * 0.9 + 0.35);
        g.add(s1, s2);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.085, 0.73, 6), stone(0x596373)); pole.position.set(-2.16, 1.53, -1.49);
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), em); beacon.position.set(-2.16, 1.92, -1.49);
        g.add(pole, beacon);
      }
      function bridge(x, z) {
        const o = new THREE.Vector3(0, 0, 0), t = new THREE.Vector3(x, 0, z);
        const dir = t.clone().sub(o).normalize();
        const s = o.clone().addScaledVector(dir, R_CORE - 0.14), e = t.clone().addScaledVector(dir, -R_ROOM + 0.12);
        const span = s.distanceTo(e); const g = new THREE.Group();
        g.position.copy(s).lerp(e, 0.5); g.rotation.y = Math.atan2(dir.x, dir.z);
        const deck = new THREE.Mesh(new THREE.BoxGeometry(1.23, 0.31, span), stone(0x596475)); deck.position.y = 0.43; g.add(deck);
        const trim = new THREE.Mesh(new THREE.BoxGeometry(1.02, 0.1, span), stone(0x30394b)); trim.position.y = 0.23; g.add(trim);
        const n = Math.max(2, Math.ceil(span / 0.56));
        const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(1.06, 0.05, (span / n) * 0.89), stone(0x788291), n);
        for (let i = 0; i < n; i++) blocks.setMatrixAt(i, new THREE.Matrix4().makeTranslation(0, 0.61, span * ((i + 0.5) / n - 0.5)));
        g.add(blocks); arena.add(g);
      }
      [spec.anchors.seat0, spec.anchors.seat1, spec.anchors.seat2].forEach((s, i) => { buildRoom(s.x, s.z, i * 3 + 1, s === spec.anchors.seat2 ? 0x394856 : COL.bronze); bridge(s.x, s.z); });
      // 远景碎片 + 尘埃
      const frag = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1), stone(0x3d536a), 30);
      for (let i = 0; i < frag.count; i++) {
        const a = i * 2.39996, r = 11 + (i * 17 % 31) * 0.6, sz = 0.21 + (i * 7 % 19) * 0.065;
        tmp.position.set(Math.sin(a) * r, -3.5 - (i * 13 % 17) * 0.34, Math.cos(a) * r);
        tmp.rotation.set(a * 0.72, a, a * 0.38); tmp.scale.set(sz, sz * 1.25, sz * 0.72); tmp.updateMatrix(); frag.setMatrixAt(i, tmp.matrix);
      }
      arena.add(frag);
      const dust = new Float32Array(72 * 3);
      for (let i = 0; i < 72; i++) { const r = 4 + (i * 23 % 59) * 0.34, a = i * 2.39996; dust.set([Math.sin(a) * r, -2.5 + (i * 17 % 19) * 0.21, Math.cos(a) * r], 3 * i); }
      const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dust, 3));
      arena.add(new THREE.Points(dg, new THREE.PointsMaterial({ color: 0x9ed2de, size: 0.095, transparent: true, opacity: 0.5, depthWrite: false })));

      return {
        group: arena,
        setRelicVisible: on => { relic.visible = !!on; },
        setSelectShadow: (i, x, z, w, h) => {
          const m = shadows[i]; m.position.x = x; m.position.z = z;
          m.scale.set(0.34 * Math.max(0.8, w), 0.28 * Math.max(0.8, h), 1); m.visible = true;
        },
        setSelectShadowsVisible: on => shadows.forEach(s => { s.visible = !!on; }),
      };
    },
  });

  // ══════════════════════════════════════════════════════════════════
  // 验证适配器：晶格试炼场（用于证明「换地图不改原型」——
  // 台面更低、座位重排、机位/几何/配色全不同，但原型主体零改动即可运行）
  // ══════════════════════════════════════════════════════════════════
  define({
    id: 'demo-crystal-arena',
    label: '试炼场 · 换图验证 Demo',
    floorY: 0.8,
    coreRadius: 3.1,
    roomRadius: 2.2,
    anchors: {
      hero: { x: 0, z: 0 },
      seat0: { x: 5.6, z: 0.4 },
      seat1: { x: -5.6, z: 0.4 },
      seat2: { x: 0, z: -6.4 },
      selectFocus: { x: -1.1, z: 0.35 },
      selectOther: { x: 1.05, z: -0.6 },
      battlePlayer: { x: -1.6, z: 0.5 },
      battleRival: { x: 1.6, z: 0.5 },
    },
    views: {
      introHigh: { pos: [0, 18, 12], look: [0, 0, 0], fov: 50 },
      lobby: { pos: [0, 13, 15], look: [0, 0, 0], fov: 48 },
      battle: { pos: [0, 12, 9], look: [0, 0, 1.5], fov: 44 },
      menu: function (mobile, F) {
        return mobile
          ? { pos: [0, F + 1.05, 5.4], look: [0, F + 0.5, 0], fov: 44 }
          : { pos: [0, F + 1.2, 4.6], look: [0, F + 0.78, 0], fov: 40 };
      },
      select: function (mobile, F, h, w) {
        const dist = (mobile ? 6.4 : 5.3) * Math.max(1, h * 0.9, w * 0.86);
        const lookY = F + (mobile ? -0.12 : 0.95) * h;
        return mobile
          ? { pos: [0.15, F + 0.92 * h, dist], look: [0, lookY, 0], fov: 52 }
          : { pos: [0.2, F + 2.35 * h, dist * 0.82], look: [0, lookY, 0], fov: 42 };
      },
    },
    build: function buildCrystal(scene, THREE, spec, F) {
      // 换一张地图，环境色调也随之改变——证明灯光/雾同样由适配层决定
      scene.fog = new THREE.Fog(0x0d2a2b, 22, 60);
      const hemi = new THREE.HemisphereLight(0xa8fff0, 0x2a3a4d, 0.9); scene.add(hemi);
      const sun = new THREE.DirectionalLight(0xd8fff4, 1.9); sun.position.set(-6, 13, 6);
      sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.camera.near = 1; sun.shadow.camera.far = 40;
      sun.shadow.camera.left = -12; sun.shadow.camera.right = 12;
      sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
      sun.shadow.bias = -0.0008; scene.add(sun);
      const rim = new THREE.DirectionalLight(0x4ad9c0, 0.85); rim.position.set(9, 6, -8); scene.add(rim);
      const arena = new THREE.Group(); scene.add(arena);
      const stone = c => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.8, metalness: 0.15 });
      const glowMat = c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.55 });
      function deck(x, z, r, col) {
        const g = new THREE.Group(); g.position.set(x, 0, z); arena.add(g);
        const tip = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, 0.05, F, 4), stone(0x28324f));
        tip.position.y = F / 2; tip.rotation.y = Math.PI / 4; g.add(tip);
        const top = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.22, 4), stone(col));
        top.position.y = F - 0.11; top.rotation.y = Math.PI / 4; top.receiveShadow = true; g.add(top);
        const halo = new THREE.Mesh(new THREE.TorusGeometry(r * 0.78, 0.03, 4, 4), glowMat(0x71e0d0));
        halo.rotation.x = -Math.PI / 2; halo.rotation.z = Math.PI / 4; halo.position.y = F + 0.01; g.add(halo);
        return g;
      }
      deck(0, 0, spec.coreRadius, 0x3d4a6b);
      [spec.anchors.seat0, spec.anchors.seat1, spec.anchors.seat2].forEach((s, i) => deck(s.x, s.z, spec.roomRadius, i === 2 ? 0x2c3854 : 0x41537a));
      const shadows = [0, 1].map(() => {
        const m = new THREE.Mesh(new THREE.CircleGeometry(1, 32),
          new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26, depthWrite: false }));
        m.rotation.x = -Math.PI / 2; m.position.y = F + 0.012; m.visible = false; m.renderOrder = 2; arena.add(m); return m;
      });
      const relic = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55),
        new THREE.MeshStandardMaterial({ color: 0x71e0d0, emissive: 0x2a8d80, emissiveIntensity: 0.7, roughness: 0.3 }));
      relic.position.set(0, F + 0.5, -1.6); arena.add(relic);
      return {
        group: arena,
        setRelicVisible: on => { relic.visible = !!on; },
        setSelectShadow: (i, x, z, w, h) => {
          const m = shadows[i]; m.position.x = x; m.position.z = z;
          m.scale.set(0.34 * Math.max(0.8, w), 0.28 * Math.max(0.8, h), 1); m.visible = true;
        },
        setSelectShadowsVisible: on => shadows.forEach(s => { s.visible = !!on; }),
      };
    },
  });

  // ══════════════════════════════════════════════════════════════════
  // MAP-006 天气工厂：复刻线上 client/src/battle3d/ruins-weather.ts 的可视契约
  // 四态天气（云海初霁/穿岛阵风/斜风骤雨/雨后薄雾）+ 泥潭预警 + 雾色联动。
  // 独立原型自洽实现，不依赖共享仓库的 RNG/layout 模块；几何与配色对齐线上。
  // 对外：sync(w, mudState, fog) 切天气 / update(T,dt,reduced) 每帧动画 / info() 取状态
  // ══════════════════════════════════════════════════════════════════
  function makeRuinsWeather(THREE, F) {
    const WEATHER = {
      clear: { name: '云海初霁', cloud: 0x7697b0, op: 0.20, streak: 0xa5dbff, streakOp: 0.0, fog: 0x101b2b, near: 26, far: 68 },
      wind:  { name: '穿岛阵风', cloud: 0x789598, op: 0.20, streak: 0xc7e8db, streakOp: 0.38, fog: 0x16242c, near: 24, far: 64 },
      rain:  { name: '斜风骤雨', cloud: 0x455e7c, op: 0.36, streak: 0xb2d9ff, streakOp: 0.55, fog: 0x142033, near: 20, far: 58 },
      mist:  { name: '雨后薄雾', cloud: 0xa9c4d5, op: 0.45, streak: 0xb2d9ff, streakOp: 0.0, fog: 0x3a5369, near: 18, far: 49 },
    };
    const STREAKS = 180, CLOUDS = 40, span = 24;
    const root = new THREE.Group();
    // 轻量确定性随机（避免依赖共享 RNG，保证每次换图云层一致）
    let seed = 731; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const tf = new THREE.Object3D();

    // 岛底流云
    const cloudMat = new THREE.MeshBasicMaterial({ color: WEATHER.clear.cloud, transparent: true, opacity: 0.20, depthWrite: false });
    const clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), cloudMat, CLOUDS);
    clouds.frustumCulled = false;
    for (let i = 0; i < CLOUDS; i++) {
      const a = i * 2.39996, r = 8 + rnd() * 22;
      tf.position.set(Math.cos(a) * r, -4.6 - rnd() * 5.2, Math.sin(a) * r);
      tf.rotation.y = a;
      tf.scale.set(3.6 + rnd() * 4.8, 0.4 + rnd() * 0.7, 1.3 + rnd() * 2.4);
      tf.updateMatrix(); clouds.setMatrixAt(i, tf.matrix);
    }
    root.add(clouds);

    // 斜雨 / 阵风气流线
    const positions = new THREE.BufferAttribute(new Float32Array(STREAKS * 6), 3).setUsage(THREE.DynamicDrawUsage);
    const geo = new THREE.BufferGeometry().setAttribute('position', positions);
    const streakMat = new THREE.LineBasicMaterial({ color: WEATHER.rain.streak, transparent: true, opacity: 0.55, depthWrite: false });
    const streaks = new THREE.LineSegments(geo, streakMat);
    streaks.frustumCulled = false; streaks.visible = false; root.add(streaks);
    const offs = Array.from({ length: STREAKS }, () => [rnd(), rnd(), rnd()]);

    // 泥潭：落在 seat2 空台（不遮角色脚底）。warn=积水预警 / active=封路泥潭
    const mud = new THREE.Group(); mud.rotation.x = -Math.PI / 2; mud.visible = false;
    const surfMat = new THREE.MeshStandardMaterial({ color: 0x3e7889, metalness: 0.18, roughness: 0.34, transparent: true, opacity: 0.57, depthWrite: false });
    const surface = new THREE.Mesh(new THREE.CircleGeometry(1, 24), surfMat);
    const edgeMat = new THREE.MeshBasicMaterial({ color: 0x90e8e5, transparent: true, opacity: 0.8, depthWrite: false });
    const edge = new THREE.Mesh(new THREE.RingGeometry(0.86, 0.92, 24), edgeMat); edge.position.z = 0.012;
    const ripMat = new THREE.MeshBasicMaterial({ color: 0x94def0, transparent: true, opacity: 0.4, depthWrite: false });
    const ripple = new THREE.Mesh(new THREE.RingGeometry(0.24, 0.28, 20), ripMat); ripple.position.set(0.22, -0.16, 0.016);
    mud.add(surface, edge, ripple); root.add(mud);

    let weather = 'clear', mudState = null, fogRef = null;
    function sync(w, m, fog) {
      weather = WEATHER[w] ? w : 'clear'; mudState = m || null; fogRef = fog || fogRef;
      const c = WEATHER[weather];
      cloudMat.color.setHex(c.cloud); cloudMat.opacity = c.op;
      streakMat.color.setHex(c.streak); streakMat.opacity = c.streakOp;
      if (fogRef) { fogRef.color.setHex(c.fog); fogRef.near = c.near; fogRef.far = c.far; }
      mud.visible = !!mudState;
      if (mudState) {
        const active = mudState === 'active' || mudState.phase === 'active';
        surfMat.color.setHex(active ? 0x654734 : 0x3e7889);
        surfMat.opacity = active ? 0.89 : 0.57;
        edgeMat.color.setHex(active ? 0xe7a95d : 0x90e8e5);
      }
    }
    function placeMud(x, z, radius) { mud.position.set(x, F + 0.014, z); mud.scale.setScalar(radius * 0.92); }
    function update(T, dt, reduced) {
      const animate = !reduced;
      clouds.count = animate ? CLOUDS : 16;
      clouds.rotation.y = animate ? T * (weather === 'wind' ? 0.038 : 0.012) : 0;
      const raining = animate && (weather === 'rain' || weather === 'wind');
      streaks.visible = raining;
      if (mud.visible) ripple.scale.setScalar(animate ? 0.8 + (T % 1.5) * 0.75 : 1.2);
      if (!raining) return;
      const rain = weather === 'rain', count = rain ? STREAKS : 36;
      geo.setDrawRange(0, count * 2);
      for (let i = 0; i < count; i++) {
        const [u, v, w] = offs[i];
        const x = (u + T * (rain ? 0.14 : 0.29)) % 1 * span - span / 2;
        const y = rain ? (v + 1 - (T * 0.8) % 1) % 1 * 13 - 1 : 0.8 + v * 4.8;
        const z = (w - 0.5) * span, len = rain ? 0.37 + w * 0.5 : 0.8 + w * 2.4;
        positions.setXYZ(i * 2, x, y, z);
        positions.setXYZ(i * 2 + 1, x - len * (rain ? 0.5 : 1), y + (rain ? len : 0.05), z + len * 0.13);
      }
      positions.needsUpdate = true;
    }
    function info() { return { weather, name: WEATHER[weather].name, mud: mudState }; }
    return { root, sync, placeMud, update, info, WEATHER };
  }

  // ══════════════════════════════════════════════════════════════════
  // MAP-006 天气版：几何/布局/机位完全复用 V6（线上 TABLE 未变），
  // 仅叠加天气层。证明「地图新增了天气系统」时原型主体无需改动——
  // 只需 define 一个新 spec；额外能力通过可选钩子（update/setWeather）下发。
  // ══════════════════════════════════════════════════════════════════
  define(Object.assign({}, registry.get('v6-floating-ruins'), {
    id: 'map006-weather',
    label: '悬浮遗迹 · MAP-006 天气版',
    build: function buildWeather(scene, THREE, spec, F) {
      // 复用 V6 的整套几何/灯光/散景，视觉与已验收版本完全一致
      const base = registry.get('v6-floating-ruins').build(scene, THREE, spec, F);
      const wx = makeRuinsWeather(THREE, F);
      base.group.add(wx.root);                       // 天气层挂进地图组，随地图生命周期
      const fog = scene.fog;                          // V6 build 已创建雾，天气按状态改色/距
      wx.placeMud(spec.anchors.seat2.x, spec.anchors.seat2.z, spec.roomRadius);
      wx.sync('clear', null, fog);
      // 可选钩子：主体每帧只转发时间，不认识天气细节
      base.setWeather = (w, m) => wx.sync(w, m, fog);
      base.weatherInfo = () => wx.info();
      base.weatherNames = () => Object.keys(wx.WEATHER);
      base.update = (T, dt, reduced) => wx.update(T, dt, reduced);
      return base;
    },
  }));

  function install(three) { THREE = three; }
  window.BAStage = { define, use, current, ids, install, FOOT_LIFT };
})();
