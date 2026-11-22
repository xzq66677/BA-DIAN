import * as THREE from 'three';
import {
  Surface, buildFrame, solidMaterial, glowMaterial, makePoses, clamp, ease,
  standardPieces, bakeLegs, bakeArms, bakeTorso, bakeHead,
} from './kit.js';

/**
 * 大贱客 · dajianke-v1
 * 剪影信号：紫衫瘦高 + 头顶悬浮磁环（spin，场景自转——「吸引全场伤害」语义）+ 挑眉贱笑。
 * attackSwing = 辱骂指点（前倾戳指），cast = 磁环脉冲（伤害吸引）。
 */

const robe = 0x7a3f7d, robeDark = 0x5e2f61, trim = 0xe0b8e8;
const pants = 0x40333f, shoe = 0x2e2530, skin = 0xdcae94, hair = 0x26201d;
const ring = 0xc23a30, ringDark = 0x8f2a22;

export function createDajiankeRig(scale: number) {
  const root = new THREE.Group(); root.name = 'dajianke';
  const solid = solidMaterial();
  const charged = glowMaterial(0xd84a3a, 0.45); // 磁环淡红微光
  const mats = [solid, charged];

  // 瘦高体型
  const frame = buildFrame(root, { hipY: 0.64, shoulderX: 0.21, shoulderY: 0.42 });

  // 窄长衫
  bakeTorso(frame, solid, [
    [0, -.15, .005, .15, .108], [0, .03, .002, .15, .108], [0, .2, .005, .152, .108], [0, .37, 0, .142, .104],
  ], robe, 12);
  {
    const g = new Surface();
    g.loft([[0, -.18, .005, .155, .112], [0, -.14, .005, .157, .114]], 12, robeDark); // 长衫摆
    g.stroke([-.04, .36, .108], [.03, .06, .117], .009, .007, trim); // 衣襟
    g.loft([[0, -.05, .007, .15, .108], [0, .0, .007, .152, .11]], 12, robeDark); // 腰带
    g.mesh(frame.body, solid);
  }

  bakeLegs(frame, solid, {
    pieces: {
      thigh: [[0, .01, 0, .072, .078], [0, -.3, 0, .058, .063]],
      shin: [[0, 0, 0, .053, .058], [0, -.27, 0, .043, .047]],
    },
    limbTint: pants, footTint: shoe,
  });
  bakeArms(frame, solid, {
    pieces: {
      ...standardPieces,
      upperArm: [[0, -.02, 0, .05, .056], [0, -.19, 0, .046, .05]],
      forearm: [[0, 0, .01, .048, .052], [0, -.18, .02, .039, .043]],
    },
    sleeveTint: robe, handTint: skin, handR: .046,
  });

  // 头：油头分线 + 挑眉贱笑
  bakeHead(frame, solid, standardPieces.head, skin, 12, (g) => {
    for (const s of [-1, 1]) {
      g.stroke([s * .046, .03, .149], [s * .092, .022, .142], .009, .007, 0x27221d); // 眼（微眯）
      g.stroke([s * .044, .086, .144], [s * .096, .072, .136], .008, .006, hair); // 挑眉（斜）
    }
    g.loft([[0, 0, .148, .017, .014], [0, .022, .152, .019, .018], [0, .044, .146, .012, .01]], 6, 0xcba084);
    g.stroke([-.05, -.07, .132], [.05, -.07, .132], .008, .008, 0x8a5a48); // 大咧嘴
    g.stroke([-.05, -.062, .132], [.05, -.062, .132], .006, .006, 0x5f3d31); // 嘴缝
    g.loft([[0, .09, -.005, .155, .145], [0, .12, -.008, .148, .14]], 12, hair); // 油头
    g.stroke([.06, .14, -.06], [.12, .1, -.02], .02, .012, hair, 6); // 分线刘海
  });

  // 头顶悬浮磁环（spin：场景自转；红马蹄铁语义，贴头顶斜置）
  const magnet = new THREE.Group(); magnet.name = 'spin';
  magnet.position.set(0, .2, 0);
  {
    const g = new Surface();
    g.loft([[.06, -.02, .02, .13, .13], [.06, 0, .02, .135, .135], [.06, .02, .02, .13, .13]], 16, ring);
    g.stroke([.19, 0, .02], [.13, 0, .02], .04, .04, ringDark, 8); // 缺口极
    g.mesh(magnet, charged);
    magnet.rotation.x = 1.25; // 斜置悬浮
  }
  frame.headTop.add(magnet);

  // rest：双手背身后、仰头贱笑
  function rest() {
    frame.pelvis.position.set(0, frame.hipY, 0); frame.pelvis.rotation.set(0, 0, 0);
    frame.body.rotation.set(-.03, .08, 0);
    frame.head.rotation.set(-.12, .1, 0);
    frame.armL.upper.rotation.set(.2, 0, .18); frame.armL.elbow.rotation.set(-.9, 0, -.3);
    frame.armR.upper.rotation.set(.2, 0, -.18); frame.armR.elbow.rotation.set(-.9, 0, .3);
    frame.legL.thigh.rotation.set(-.02, .05, -.03); frame.legL.knee.rotation.set(.06, 0, 0);
    frame.legR.thigh.rotation.set(-.02, -.05, .04); frame.legR.knee.rotation.set(.07, 0, 0);
    magnet.rotation.set(1.25, 0, 0); magnet.scale.setScalar(1);
  }
  rest();
  const standingHeight = new THREE.Box3().setFromObject(root, true).max.y;
  root.scale.setScalar(scale);

  const poses = makePoses(frame, rest);
  // 出手（辱骂·精神）：前倾戳指
  function attackSwing(t: number) {
    rest();
    t = clamp(t);
    const wind = ease(t / .35) * (1 - ease((t - .35) / .12));
    const jab = ease((t - .33) / .18) * (1 - ease((t - .58) / .42));
    frame.body.rotation.x += .3 * jab - .12 * wind;
    frame.armR.upper.rotation.x += -.4 * wind - 1.2 * jab;
    frame.armR.elbow.rotation.x += -.7 * wind + 1.15 * jab;
    frame.armL.upper.rotation.x += .35 * jab;
    frame.head.rotation.x += .12 * jab;
    frame.head.rotation.y += .25 * wind - .35 * jab;
    frame.pelvis.position.z += .09 * jab;
    frame.legR.thigh.rotation.x += -.22 * jab;
    frame.legL.thigh.rotation.x += .18 * jab;
    magnet.scale.setScalar(1 + .3 * jab);
  }
  // 施法（被动吸引演出）：磁环脉冲
  function cast(t: number) {
    rest();
    const wave = Math.sin(t * 2.5);
    frame.head.rotation.x -= .2;
    magnet.scale.setScalar(1.2 + Math.max(0, wave) * .25);
    magnet.rotation.y = t * 3;
  }
  function idle(t: number, phase = 0) {
    poses.idle(t, phase);
    magnet.rotation.y = t * 1.4 + phase;
    magnet.scale.setScalar(.96 + Math.sin(t * 1.8 + phase) * .07);
  }

  return {
    root, materials: () => mats, headHeight: () => standingHeight * root.scale.y,
    setOpacity(o: number) { for (const m of mats) { m.transparent = o < 1; m.opacity = o; } },
    ...poses, attackSwing, cast, idle,
  };
}
