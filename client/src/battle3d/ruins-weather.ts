import * as THREE from 'three';
import { RNG } from '../../../shared/src/rng.js';
import type { RuinsConditions, RuinsWeather } from '../../../shared/src/floating-ruins.js';
import { TABLE, type RoomAnchor } from './layout.js';

const STREAKS = 180;
const CLOUDS = 40;
const CLOUD_COLORS: Record<RuinsWeather, number> = {
  clear: 0x7697b0, wind: 0x789598, rain: 0x455e7c, mist: 0xa9c4d5,
};

export function createRuinsWeather() {
  const root = new THREE.Group();
  const rng = new RNG(731);
  const transform = new THREE.Object3D();

  // A single instanced cloud bank sits below the playing surfaces.
  const cloudMaterial = new THREE.MeshBasicMaterial({ color: CLOUD_COLORS.clear, transparent: true, opacity: 0.2, depthWrite: false });
  const clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), cloudMaterial, CLOUDS);
  clouds.frustumCulled = false;
  for (let i = 0; i < CLOUDS; i++) {
    const angle = i * 2.39996;
    const radius = 8 + rng.next() * 22;
    transform.position.set(Math.cos(angle) * radius, -4.6 - rng.next() * 5.2, Math.sin(angle) * radius);
    transform.rotation.y = angle;
    transform.scale.set(3.6 + rng.next() * 4.8, 0.4 + rng.next() * 0.7, 1.3 + rng.next() * 2.4);
    transform.updateMatrix();
    clouds.setMatrixAt(i, transform.matrix);
  }

  const positions = new THREE.BufferAttribute(new Float32Array(STREAKS * 6), 3).setUsage(THREE.DynamicDrawUsage);
  const streakGeometry = new THREE.BufferGeometry().setAttribute('position', positions);
  const streakMaterial = new THREE.LineBasicMaterial({ color: 0xa5dbff, transparent: true, depthWrite: false });
  const streaks = new THREE.LineSegments(streakGeometry, streakMaterial);
  streaks.frustumCulled = false;
  streaks.visible = false;
  const offsets = Array.from({ length: STREAKS }, () => [rng.next(), rng.next(), rng.next()]);

  const channel = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.03, 1),
    new THREE.MeshBasicMaterial({ color: 0x8ce9df, transparent: true, opacity: 0.84 }));
  channel.visible = false;
  const bank = new THREE.Shape();
  for (let i = 0; i < 16; i++) {
    const angle = i * Math.PI / 8;
    const radius = 0.76 + rng.next() * 0.21;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (i === 0) bank.moveTo(x, y); else bank.lineTo(x, y);
  }
  bank.closePath();
  const mud = new THREE.Group();
  mud.rotation.x = -Math.PI / 2;
  mud.visible = false;
  const surface = new THREE.Mesh(new THREE.ShapeGeometry(bank),
    new THREE.MeshStandardMaterial({ color: 0x503b2e, metalness: 0.18, roughness: 0.34, transparent: true, depthWrite: false }));
  const edge = new THREE.Mesh(new THREE.RingGeometry(0.64, 0.659, 24),
    new THREE.MeshBasicMaterial({ color: 0x90e8e5, transparent: true, depthWrite: false, opacity: 0.8 }));
  edge.position.z = 0.012;
  const ripple = new THREE.Mesh(new THREE.RingGeometry(0.26, 0.28, 20),
    new THREE.MeshBasicMaterial({ color: 0x94def0, transparent: true, depthWrite: false, opacity: 0.35 }));
  ripple.position.set(0.24, -0.18, 0.014);
  mud.add(surface, edge, ripple);
  root.add(clouds, streaks, channel, mud);

  let weather: RuinsWeather = 'clear';
  let span = 24;

  function sync(conditions: RuinsConditions | undefined, anchor: RoomAnchor | undefined, radius: number) {
    weather = conditions?.weather ?? 'clear';
    span = radius * 2 + 8;
    cloudMaterial.color.setHex(CLOUD_COLORS[weather]);
    cloudMaterial.opacity = weather === 'mist' ? 0.45 : weather === 'rain' ? 0.36 : 0.2;
    const trap = conditions?.mud;
    mud.visible = channel.visible = !!trap && !!anchor;
    if (!trap || !anchor) return;
    const activeMud = trap.active;

    mud.position.set(anchor.center.x, anchor.floor + 0.012, anchor.center.z);
    mud.scale.setScalar(anchor.radius * 0.95);
    surface.material.color.setHex(activeMud ? 0x654734 : 0x3e7889);
    surface.material.opacity = activeMud ? 0.89 : 0.57;
    edge.material.color.setHex(activeMud ? 0xe7a95d : 0x90e8e5);
    const { x, z } = anchor.entrance;
    const length = Math.hypot(x, z);
    channel.rotation.y = Math.atan2(x, z);
    channel.scale.z = Math.max(0, length - TABLE.coreRadius);
    channel.position.set(x * (1 - channel.scale.z / (2 * length)), 0.654, z * (1 - channel.scale.z / (2 * length)));
    channel.material.color.setHex(activeMud ? 0xe7a95d : 0x8ce9df);
  }

  function update(time: number, animate: boolean) {
    clouds.count = animate ? CLOUDS : 16;
    clouds.rotation.y = animate ? time * (weather === 'wind' ? 0.038 : 0.012) : 0;
    ripple.scale.setScalar(animate ? 0.8 + (time % 1.5) * 0.75 : 1.2);
    streaks.visible = animate && (weather === 'rain' || weather === 'wind');
    if (!streaks.visible) return;

    const rain = weather === 'rain';
    const count = rain ? STREAKS : 36;
    streakGeometry.setDrawRange(0, count * 2);
    streakMaterial.color.setHex(rain ? 0xb2d9ff : 0xc7e8db);
    streakMaterial.opacity = rain ? 0.55 : 0.38;
    for (let i = 0; i < count; i++) {
      const [u, v, w] = offsets[i];
      const x = (u + time * (rain ? 0.14 : 0.29)) % 1 * span - span / 2;
      const y = rain ? (v + 1 - (time * 0.8) % 1) % 1 * 13 - 1 : 0.8 + v * 4.8;
      const z = (w - 0.5) * span;
      const length = rain ? 0.37 + w * 0.5 : 0.8 + w * 2.4;
      positions.setXYZ(i * 2, x, y, z);
      positions.setXYZ(i * 2 + 1, x - length * (rain ? 0.5 : 1), y + (rain ? length : 0.05), z + length * 0.13);
    }
    positions.needsUpdate = true;
  }

  return { root, sync, update };
}
