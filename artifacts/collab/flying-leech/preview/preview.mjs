import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import spec from '../asset-spec.json';

const stage = document.querySelector('#stage');
const title = document.querySelector('#title');
const description = document.querySelector('#description');
const progress = document.querySelector('#progress');
const play = document.querySelector('#play');
const buttons = [...document.querySelectorAll('[data-shot]')];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const { lerp, smoothstep, clamp } = T.MathUtils;
const tau = Math.PI * 2;

const shots = {
  idle: { seconds: 2.3, title: '悬浮待机', description: '圆脑袋、蓝莓色圆眼、淡腮红和两对蝴蝶翅膀' },
  build: { seconds: 1.75, title: '八角玄武岩塔', description: '五层挑檐逐层收窄，檐角上翘，塔顶立有细长塔刹' },
  strike: { seconds: 2.95, title: '投塔卷入', description: '高塔砸向对方，落地漩涡将双方同时卷入' },
  inhale: { seconds: 1.65, title: '吸入对手', description: '漩涡向内收拢，将对手从远处拉到水蛭面前' },
  exhale: { seconds: 1.65, title: '吹出对手', description: '漩涡向外扩张，将近处的对手吹离地面并推远' },
  spectral: { seconds: 2.2, title: '半透明灵体', description: '淘汰后保持半透明，并缓慢悬浮' },
};
const order = Object.keys(shots);

function buildWorld() {
  const scene = new T.Scene();
  const renderer = new T.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.28;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  stage.append(renderer.domElement);
  const camera = new T.PerspectiveCamera(36, 1, 0.08, 90);
  scene.add(new T.HemisphereLight(0xe4f8ff, 0x7f6da4, 2.0));
  for (const [color, strength, point] of [
    [0xffedcb, 2.7, [-4, 7, 5]], [0x7beadf, 1.8, [1, 4, -4]], [0xa2b2ff, 1.15, [5, 4, 4]],
  ]) {
    const light = new T.DirectionalLight(color, strength);
    light.position.set(...point);
    scene.add(light);
  }

  function item(geometry, color, position, metalness = 0) {
    const mesh = new T.Mesh(geometry, new T.MeshStandardMaterial({ color, metalness, roughness: 0.68 }));
    mesh.position.set(...position);
    scene.add(mesh);
    return mesh;
  }

  item(new T.CylinderGeometry(4.44, 4.57, 0.48, 12), 0x2b3653, [0, -0.247, 0]);
  item(new T.CylinderGeometry(4.4, 4.44, 0.035, 12), 0x435671, [0, -0.022, 0]);
  for (const r of [2.6, 4.02, 4.095]) {
    const inlay = item(new T.TorusGeometry(r, 0.01, 5, 96), 0xa4b1be, [0, 0.006, 0], 0.36);
    inlay.rotation.x = Math.PI / 2;
  }
  for (let i = 0; i < 24; i++) {
    const angle = i * tau / 24;
    const chip = item(new T.BoxGeometry(i % 3 === 0 ? 0.09 : 0.036, 0.012, 0.115), 0x97939c,
      [4.17 * Math.sin(angle), 0.006, 4.17 * Math.cos(angle)], 0.25);
    chip.rotation.y = angle;
  }

  const guardian = new T.Group();
  guardian.name = 'PreviewOpponent';
  scene.add(guardian);
  function armor(geometry, material, position, scale = [1, 1, 1]) {
    const part = new T.Mesh(geometry, material);
    part.position.set(...position);
    part.scale.set(...scale);
    guardian.add(part);
    return part;
  }
  const ochre = new T.MeshStandardMaterial({ color: 0x8e673f, roughness: 0.67, metalness: 0.3 });
  const bone = new T.MeshStandardMaterial({ color: 0xc29560, roughness: 0.7 });
  const trim = new T.MeshStandardMaterial({ color: 0x533a36, roughness: 0.65 });
  const amber = new T.MeshBasicMaterial({ color: 0xffdb8c });
  const faceted = new T.IcosahedronGeometry(1);
  armor(faceted, ochre, [0, 0.85, 0], [0.35, 0.45, 0.245]);
  armor(faceted, bone, [0, 1.354, 0.03], [0.28, 0.32, 0.249]);
  armor(faceted, amber, [0, 0.952, 0.21], [0.112, 0.133, 0.031]);
  for (const side of [-1, 1]) {
    armor(faceted, ochre, [side * 0.43, 0.94, 0.015], [0.167, 0.248, 0.16]).rotation.z = -side * 0.27;
    armor(faceted, trim, [side * 0.48, 0.62, 0.03], [0.15, 0.181, 0.154]);
    armor(faceted, ochre, [side * 0.171, 0.31, 0.017], [0.133, 0.21, 0.137]);
    armor(faceted, bone, [side * 0.18, 0.122, 0.075], [0.16, 0.14, 0.206]);
    armor(faceted, trim, [side * 0.097, 1.37, 0.239], [0.072, 0.049, 0.022]);
    armor(faceted, amber, [side * 0.099, 1.377, 0.256], [0.039, 0.024, 0.01]);
  }

  const impact = new T.Group();
  const ripple = new T.Mesh(new T.TorusGeometry(1, 0.023, 6, 56),
    new T.MeshBasicMaterial({ color: 0x98ffee, transparent: true, depthWrite: false }));
  ripple.rotation.x = Math.PI / 2;
  impact.add(ripple);
  const grit = new T.MeshStandardMaterial({ color: 0x8daac1, flatShading: true });
  const fragments = Array.from({ length: 10 }, () => new T.Mesh(faceted, grit));
  impact.add(...fragments);
  scene.add(impact);

  function showImpact(origin, phase) {
    impact.visible = phase > 0 && phase < 1;
    if (!impact.visible) return;
    impact.position.copy(origin);
    ripple.scale.setScalar(0.48 + phase * 1.75);
    ripple.material.opacity = 1 - phase;
    for (const [i, chip] of fragments.entries()) {
      const a = i * 2.39996;
      const r = 0.64 + (0.85 + 0.4 * Math.sin(i * 1.57)) * phase;
      chip.position.set(r * Math.cos(a), 0.04 + Math.sin(Math.PI * phase) * (0.32 + 0.26 * Math.sin(i)), r * Math.sin(a));
      chip.rotation.set(phase * (i + 1), a, phase * 4);
      chip.scale.setScalar(0.09 * (1 - phase) + 0.001);
    }
  }
  return { scene, camera, renderer, guardian, showImpact };
}

function rig(gltf, scene) {
  const holder = new T.Group();
  holder.add(gltf.scene);
  scene.add(holder);
  const mixer = new T.AnimationMixer(gltf.scene);
  const clips = new Map(gltf.animations.map((clip) => [clip.name, mixer.clipAction(clip)]));
  function sample(...poses) {
    mixer.stopAllAction();
    for (const [name, t] of poses) {
      const action = clips.get(name);
      action.reset().setLoop(T.LoopOnce, 1).play();
      action.paused = true;
      action.time = action.getClip().duration * clamp(t, 0, 1);
    }
    mixer.update(0);
    holder.updateMatrixWorld(true);
  }
  return { holder, model: gltf.scene, sample };
}

function materialOpacity(root, opacity) {
  root.traverse((node) => {
    if (!node.isMesh) return;
    node.material.userData.fullOpacity ??= node.material.opacity;
    node.material.userData.fullTransparent ??= node.material.transparent;
    node.material.opacity = node.material.userData.fullOpacity * opacity;
    const transparent = opacity < 0.999 || node.material.userData.fullTransparent;
    if (node.material.transparent !== transparent) node.material.needsUpdate = true;
    node.material.transparent = transparent;
    node.material.depthWrite = !transparent;
  });
}

function swirlToTower(from, center, t) {
  const dx = from.x - center.x;
  const dz = from.z - center.z;
  const radius = Math.hypot(dx, dz) * (1 - t);
  const angle = Math.atan2(dz, dx) - 1.15 * t;
  return new T.Vector3(center.x + Math.cos(angle) * radius,
    lerp(from.y, center.y, t) + 0.92 * Math.sin(Math.PI * t),
    center.z + Math.sin(angle) * radius);
}

async function start() {
  const { scene, camera, renderer, guardian, showImpact } = buildWorld();
  const loader = new GLTFLoader();
  const [leech, specter, tower, vortex] = await Promise.all(
    ['flying-leech', 'flying-leech-spectral', 'basalt-tower', 'wind-vortex']
      .map(async (name) => rig(await loader.loadAsync(new URL(`../model/${name}.glb`, import.meta.url).href), scene)));

  const point = (object, name) => object.getObjectByName(name).getWorldPosition(new T.Vector3());
  const startTower = new T.Vector3(-1.55, 0, -0.52);
  const studioGround = new T.Vector3();
  const castSpot = new T.Vector3(-2.37, 0, 1.34);
  const opponentSpot = new T.Vector3(2.02, 0, -0.5);
  const impact = new T.Vector3(1.63, 0.14, -0.52);
  const targetRecoil = new T.Vector3(2.7, 0, 2.65);
  const windSpot = new T.Vector3(-2.24, 0, -0.18);
  const targetMotion = vortex.model.getObjectByName(spec.directionalWind.targetNode);
  const impactSeconds = spec.towerImpactSeconds;
  let shot = 'idle';
  let elapsed = 0;
  let time = 0;
  let manual = false;
  let sequence = false;
  let raf;

  function frame(which, t, phase = t) {
    const studio = which === 'idle' || which === 'spectral';
    const spectral = which === 'spectral';
    const directional = which === 'inhale' || which === 'exhale';
    const dissolve = spectral ? smoothstep(t, 0.23, 0.69) : 0;
    const sampleTail = clamp((t - 0.69) / 0.31, 0, 1);
    specter.holder.visible = spectral && dissolve > 0.001;
    materialOpacity(specter.model, dissolve);
    guardian.visible = !studio;
    tower.holder.visible = which === 'build' || which === 'strike';
    vortex.holder.visible = false;
    showImpact(studioGround, 0);
    let opponent = opponentSpot.clone();
    let hero = studio ? studioGround.clone() : castSpot.clone();
    let pose = [spectral ? 'dead' : 'idle', spectral ? Math.min(1, t / 0.69) : phase];
    let yaw = 0.035;
    let targetTilt = 0;
    let drawn = 0;
    let creatureScale = 1;
    let heroOpacity = 1 - dissolve;

    if (tower.holder.visible) {
      tower.holder.position.copy(startTower);
      tower.holder.rotation.y = Math.PI / 2;
      tower.sample(['build', which === 'build' ? t : 1], ['strike', which === 'strike' ? Math.min(1, t * shots.strike.seconds / 1.52) : 0]);
    }
    if (which === 'build') {
      pose = ['cast', t];
      yaw = 0.64;
    } else if (which === 'strike') {
      const seconds = t * shots.strike.seconds;
      const recoil = smoothstep(seconds, 0.57, 1.19);
      opponent.lerp(targetRecoil, recoil);
      opponent.y = 0.27 * Math.sin(Math.PI * recoil);
      const windTime = clamp((seconds - impactSeconds) / 1.82, 0, 1);
      drawn = smoothstep(seconds, 1.22, 2.64);
      hero = swirlToTower(hero, impact, drawn);
      opponent = swirlToTower(opponent, impact, drawn);
      yaw = lerp(0.96, 1.72, drawn);
      targetTilt = -0.32 * Math.sin(Math.PI * recoil) + 0.45 * Math.sin(Math.PI * drawn);
      creatureScale = lerp(1, 0.12, smoothstep(drawn, 0.42, 1));
      pose = seconds < 1.0 ? ['attack', clamp(seconds, 0, 1)] : ['walk', (windTime * 2) % 1];
      heroOpacity *= 1 - smoothstep(drawn, 0.63, 0.98);
      vortex.holder.visible = windTime > 0 && windTime < 1 && !reduceMotion.matches;
      vortex.holder.position.copy(impact);
      vortex.holder.position.y = 0.29;
      vortex.holder.rotation.set(spec.vortexCapture.rotationX, 0, 0);
      vortex.holder.scale.set(...spec.vortexCapture.scale);
      vortex.sample([spec.vortexCapture.clip, windTime]);
      if (!reduceMotion.matches) showImpact(impact, (seconds - impactSeconds) / 0.49);
    } else if (directional) {
      hero.copy(windSpot);
      yaw = 1.27;
      pose = [which, t];
    }

    leech.holder.visible = heroOpacity > 0.001;
    materialOpacity(leech.model, heroOpacity);
    leech.holder.position.copy(hero);
    leech.holder.rotation.y = yaw;
    leech.holder.scale.setScalar(creatureScale);
    leech.sample(pose);
    let targetPitch = 0;
    let targetYaw = -0.62 + drawn * 2.3;
    if (directional) {
      const origin = point(leech.model, 'WindOrigin');
      vortex.holder.position.copy(origin);
      vortex.holder.rotation.set(0, yaw, 0);
      vortex.holder.scale.setScalar(1);
      vortex.sample([which, t]);
      vortex.holder.visible = t > 0.06 && t < 0.97 && !reduceMotion.matches;
      opponent = targetMotion.getWorldPosition(new T.Vector3());
      opponent.y -= origin.y;
      targetPitch = targetMotion.rotation.x;
      targetYaw = yaw - Math.PI + targetMotion.rotation.y;
      targetTilt = targetMotion.rotation.z;
    }
    if (spectral) {
      specter.holder.position.copy(studioGround);
      specter.holder.rotation.y = yaw;
      specter.sample(t < 0.69 ? ['dead', t / 0.69] : ['dead_idle', (sampleTail * 0.3 + phase - t) % 1]);
    }
    guardian.visible &&= drawn < 0.98;
    guardian.position.copy(opponent);
    guardian.rotation.set(targetPitch, targetYaw, targetTilt);
    guardian.scale.setScalar(creatureScale);

    const narrow = camera.aspect < 1;
    const distance = narrow ? 1.25 / Math.max(camera.aspect, 0.67) : Math.max(1, 1.37 / camera.aspect);
    const focus = studio ? new T.Vector3(0, 0.95, 0) : new T.Vector3(0.12, 2.55, 0.18);
    const offset = studio ? new T.Vector3(1.66, 0.98, 4.16) : new T.Vector3(2.27, 2.2, 12.45);
    if (which === 'build') {
      focus.set(-0.52, 2.72, -0.12);
      offset.set(1.85, 1.1, 10.35);
    } else if (directional) {
      focus.set(-0.34, 1.17, 0.46);
      offset.set(0.88, 2.12, 8.50);
    }
    camera.position.copy(focus).addScaledVector(offset, distance);
    camera.lookAt(focus);
    renderer.render(scene, camera);
    progress.value = String(Math.floor(t * 1000));
  }

  function updateControls() {
    const current = shots[shot];
    title.textContent = current.title;
    description.textContent = current.description;
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.shot === shot));
    play.textContent = sequence ? '停止播放' : '播放完整演出';
  }

  function select(id, options = {}) {
    shot = id;
    sequence = options.sequence === true;
    manual = options.time !== undefined;
    elapsed = options.time === undefined ? 0 : options.time * shots[shot].seconds;
    updateControls();
    render();
  }

  function render() {
    const seconds = shots[shot].seconds;
    const t = reduceMotion.matches && !manual ? 1 : Math.min(elapsed / seconds, 1);
    let phase = t;
    if (!manual && !sequence && !reduceMotion.matches) {
      if (shot === 'idle') phase = (elapsed / seconds) % 1;
      if (shot === 'spectral' && t === 1) phase = 1 + ((elapsed - seconds) / 3.8) % 1;
    }
    if (shot === 'idle' && reduceMotion.matches && !manual) phase = 0;
    frame(shot, shot === 'idle' ? phase : t, phase);
  }

  function tick(now) {
    const delta = Math.min(0.1, Math.max(0, now - time) / 1000);
    time = now;
    if (!manual) {
      elapsed += delta;
      const index = order.indexOf(shot);
      if (sequence && elapsed > shots[shot].seconds + 0.24) {
        if (index < order.length - 1) select(order[index + 1], { sequence: true });
        else {
          sequence = false;
          manual = true;
          updateControls();
        }
      }
      render();
    }
    raf = requestAnimationFrame(tick);
  }

  const observer = new ResizeObserver(() => {
    const size = stage.getBoundingClientRect();
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();
    renderer.setSize(size.width, size.height, false);
    render();
  });
  const listeners = new AbortController();
  const opts = { signal: listeners.signal };
  observer.observe(stage);
  for (const button of buttons) button.addEventListener('click', () => select(button.dataset.shot), opts);
  play.addEventListener('click', () => {
    if (sequence) select(shot, { time: Math.min(elapsed / shots[shot].seconds, 1) });
    else select('build', { sequence: true });
  }, opts);
  progress.addEventListener('input', () => select(shot, { time: Number(progress.value) / 1000 }), opts);
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    listeners.abort();
    cancelAnimationFrame(raf);
    observer.disconnect();
    const disposable = new Set();
    scene.traverse((node) => {
      if (!node.isMesh) return;
      disposable.add(node.geometry);
      disposable.add(node.material);
    });
    for (const resource of disposable) resource.dispose();
    renderer.dispose();
  }, opts);
  for (const input of [...buttons, progress, play]) input.disabled = false;
  updateControls();
  raf = requestAnimationFrame(tick);
  window.flyingLeechPreview = {
    seek: (id, time) => select(id, { time }),
    read: () => ({
      shot, progress: +progress.value / 1000, sequence,
      hero: leech.holder.position.toArray(),
      opponent: guardian.position.toArray(),
      impact: impact.toArray(),
      opponentVisible: guardian.visible,
      targetTilt: guardian.rotation.z,
      towerVisible: tower.holder.visible,
      tower: point(tower.model, 'TowerFlight').toArray(),
      wind: vortex.holder.visible,
      tracer: vortex.model.getObjectByName('WindTracer1').position.toArray(),
      specter: specter.holder.visible, solid: leech.holder.visible,
      heroOpacity: leech.model.getObjectByName('RoundedHead').material.opacity,
      specterOpacity: specter.model.getObjectByName('RoundedHead').material.opacity,
      memory: { ...renderer.info.memory },
      render: { ...renderer.info.render },
      reducedMotion: reduceMotion.matches,
    }),
  };
}

start().catch((error) => {
  title.textContent = '预览加载失败';
  description.textContent = '请检查浏览器的 WebGL 支持与本地模型路径。';
  console.error(error);
});
