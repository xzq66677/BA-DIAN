import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { cloneAsset } from '../../client/src/battle3d/characters/collab-assets.js';
import { RoomDecorations } from '../../client/src/battle3d/collaboration-props.js';

vi.mock('../../client/src/battle3d/characters/collab-assets.js', () => ({
  cloneAsset: vi.fn(),
  motionTrack: vi.fn(),
}));

describe('RoomDecorations tower collapse', () => {
  let room: THREE.Group;
  let scene: THREE.Group;
  let sample: ReturnType<typeof vi.fn>;
  let dispose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    room = new THREE.Group();
    scene = new THREE.Group();
    sample = vi.fn();
    dispose = vi.fn(() => scene.removeFromParent());
    vi.mocked(cloneAsset).mockReturnValue({
      scene,
      clips: new Map([['build', { duration: 1 }]]),
      sample,
      stop: vi.fn(),
      dispose,
    } as unknown as NonNullable<ReturnType<typeof cloneAsset>>);
  });

  it('keeps a removed tower alive through its collapse animation instead of shrinking it away', () => {
    const decorations = new RoomDecorations();
    const wanted = new Map([['snake', { room: 'R1', asset: 'basalt-tower' as const, progress: 1 }]]);
    decorations.sync(wanted, () => room, 1.12, true);
    expect(scene.position.y).toBe(1.12);

    decorations.sync(new Map(), () => room, 1.12, false);
    decorations.update(0.15);
    expect(dispose).not.toHaveBeenCalled();
    expect(scene.rotation.z).not.toBe(0);

    decorations.update(0.15);
    expect(scene.position.y).toBeLessThan(1.12);
    expect(scene.scale.y).toBeLessThan(0.44);
    expect(dispose).not.toHaveBeenCalled();

    decorations.update(1);
    expect(dispose).toHaveBeenCalledOnce();
    expect(scene.parent).toBeNull();
  });
});
