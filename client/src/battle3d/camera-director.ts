/** Single active camera instruction. Lifetimes use the presentation clock. */
import { orbitPose, type CamPose, type Vec2 } from './layout.js';

const SHOTS = {
  overview: { weight: 0, zoom: 1, priority: 1, duration: 0.5 },
  room: { weight: 0.26, zoom: 0.96, priority: 1, duration: 0.7 },
  actor: { weight: 0.58, zoom: 0.81, priority: 1, duration: 0.65 },
  move: { weight: 0.4, zoom: 0.94, priority: 1, duration: 0.8 },
  target: { weight: 0.6, zoom: 0.78, priority: 2, duration: 0.8 },
  area: { weight: 0.44, zoom: 1.02, priority: 2, duration: 1.1 },
  major: { weight: 0.64, zoom: 0.92, priority: 3, duration: 1.5 },
  winner: { weight: 0.86, zoom: 0.69, priority: 4, duration: Infinity },
  draw: { weight: 0, zoom: 1.03, priority: 4, duration: Infinity },
} as const;

export type Shot = keyof typeof SHOTS;
type Focus = () => Vec2 | undefined;

export class CameraDirector {
  private active: { shot: Shot; key: string; focus?: Focus; until: number } | null = null;
  private orbit = { azimuth: 0, elevation: 0, zoom: 1 };
  private automatic = true;
  private manual = false;

  setAutomatic(on: boolean): void {
    if (this.automatic === on) return;
    this.automatic = on;
    this.reset();
  }

  request(shot: Shot, key: string, now: number, focus?: Focus): void {
    if (!this.automatic || this.manual) return;
    const active = this.active;
    if (active && active.until > now) {
      if (active.shot === shot && active.key === key) return;
      if (SHOTS[active.shot].priority > SHOTS[shot].priority) return;
    }
    this.active = { shot, key, focus, until: now + SHOTS[shot].duration };
  }

  cancel(): void { this.active = null; }

  reset(): void {
    this.cancel();
    this.manual = false;
    this.orbit = { azimuth: 0, elevation: 0, zoom: 1 };
  }

  drag(dx: number, dy: number): void {
    this.cancel();
    this.manual = true;
    this.orbit.azimuth = Math.max(-1.15, Math.min(1.15, this.orbit.azimuth - dx * 0.0055));
    this.orbit.elevation = Math.max(-0.56, Math.min(0.3, this.orbit.elevation - dy * 0.0038));
  }

  zoom(delta: number): void {
    this.cancel();
    this.manual = true;
    this.orbit.zoom = Math.min(1.7, Math.max(0.58, this.orbit.zoom * (delta > 0 ? 1.07 : 0.93)));
  }

  frame(base: CamPose, now: number, reduced: boolean) {
    if (this.active && this.active.until <= now) this.cancel();
    const shot = reduced ? 'overview' : this.active?.shot ?? 'overview';
    const preset = SHOTS[shot];
    const anchor = shot === 'overview' ? undefined : this.active?.focus?.();
    const look = anchor ? {
      x: lerp(base.look.x, anchor.x, preset.weight),
      z: lerp(base.look.z, anchor.z, preset.weight),
    } : base.look;
    const position = orbitPose({ ...base, look }, this.orbit.azimuth,
      Math.atan2(base.height, base.radius) + this.orbit.elevation, this.orbit.zoom * preset.zoom);
    return { shot, look, position };
  }
}

function lerp(start: number, end: number, weight: number): number {
  return start + (end - start) * weight;
}
