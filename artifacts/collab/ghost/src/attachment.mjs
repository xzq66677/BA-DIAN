import { Quaternion, Vector3 } from 'three';

/**
 * @typedef {object} AttachmentHost
 * @property {import('three').Object3D} root Character root with local +Z forward.
 * @property {import('three').Object3D} [anchor] Optional descendant that follows the host's rig.
 * @property {readonly [number, number, number]} [offset] Anchor-local offset in meters. Negative Z is behind.
 */

/**
 * Updates a follower after movement and rig animation. Both objects stay in their scene branches.
 * @param {{root: import('three').Object3D, setOpacity: (multiplier: number) => void}} follower
 * @param {{duration?: number, opacity?: number}} [options]
 */
export function createAttachment(follower, { duration = 0.72, opacity = 0.36 } = {}) {
  const behind = [0.38, 0.12, -0.86];
  const offset = new Vector3();
  const position = new Vector3();
  const rotation = new Quaternion();
  const parentRotation = new Quaternion();
  const startPosition = new Vector3();
  const startRotation = new Quaternion();
  /** @param {number} n */
  const fraction = (n) => Math.max(0, Math.min(1, n));
  const seconds = Number.isFinite(duration) ? Math.max(0, duration) : 0.72;
  const attachedOpacity = Number.isFinite(opacity) ? fraction(opacity) : 0.36;
  /** @type {import('three').Object3D | undefined} */
  let anchor;
  /** @type {import('three').Object3D | undefined} */
  let hostRoot;
  let elapsed = 0;
  let progress = 0;
  let currentOpacity = 1;
  let startOpacity = 1;

  /** @param {import('three').Object3D} root @param {import('three').Object3D} object */
  function contains(root, object) {
    /** @type {import('three').Object3D | null} */
    let node = object;
    for (; node; node = node.parent) {
      if (node === root) return true;
    }
    return false;
  }

  /** @param {import('three').Object3D} object */
  function treeRoot(object) {
    let node = object;
    while (node.parent) node = node.parent;
    return node;
  }

  function detach() {
    if (anchor) follower.setOpacity(1);
    anchor = undefined;
    hostRoot = undefined;
    currentOpacity = 1;
    elapsed = 0;
    progress = 0;
  }

  return {
    /** @param {AttachmentHost | null | undefined} host */
    attach(host) {
      const target = host?.anchor ?? host?.root;
      const displacement = host?.offset ?? behind;
      if (!host || !target || !contains(host.root, target) || contains(follower.root, target)
        || displacement.length !== 3 || !displacement.every(Number.isFinite)
        || treeRoot(target) !== treeRoot(follower.root)) return false;
      if (anchor === target && offset.equals(position.fromArray(displacement))) return true;
      anchor = target;
      hostRoot = host.root;
      offset.fromArray(displacement);
      elapsed = 0;
      progress = 0;
      startOpacity = currentOpacity;
      follower.root.getWorldPosition(startPosition);
      follower.root.getWorldQuaternion(startRotation);
      return true;
    },
    detach,
    /** Delta is measured in seconds. Returns 0 when unmounted, otherwise 0–1 for the entry clip. */
    update(delta = 0) {
      if (!anchor || !hostRoot) return 0;
      if (!contains(hostRoot, anchor) || treeRoot(anchor) !== treeRoot(follower.root)
        || contains(follower.root, anchor)) {
        detach();
        return 0;
      }
      elapsed += Number.isFinite(delta) ? Math.max(0, delta) : 0;
      progress = seconds === 0 ? 1 : fraction(elapsed / seconds);
      const eased = progress * progress * (3 - 2 * progress);
      anchor.localToWorld(position.copy(offset));
      anchor.getWorldQuaternion(rotation);
      position.lerpVectors(startPosition, position, eased);
      rotation.slerpQuaternions(startRotation, rotation, eased);
      const parent = follower.root.parent;
      if (parent) {
        parent.worldToLocal(position);
        parent.getWorldQuaternion(parentRotation).invert();
        rotation.premultiply(parentRotation);
      }
      follower.root.position.copy(position);
      follower.root.quaternion.copy(rotation);
      currentOpacity = startOpacity + (attachedOpacity - startOpacity) * eased;
      follower.setOpacity(currentOpacity);
      return progress;
    },
    get active() { return Boolean(anchor); },
    get progress() { return progress; },
  };
}
