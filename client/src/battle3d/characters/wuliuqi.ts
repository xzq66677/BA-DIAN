import * as THREE from 'three';
import {
  Surface, buildFrame, solidMaterial, makePoses, clamp, ease,
  standardPieces, bakeLegs, bakeArms, bakeTorso, bakeHead,
} from './kit.js';

/**
 * 伍六七 · wuliuqi-v1
 * 剪影信号：暗银紧身衣 + 右手大剪刀（三段 AOE 是同一次挥剪的连续演出）+ 头巾。
 * attackSwing 沿用通用劈砍；场景按 3 段分别触发。
 */

const suit = 0x4a4a58, suitDark = 0x3a3a46, trim = 0xc0c8d8;
const pants = 0x33333e, shoe = 0x26262e, skin = 0xe0b398, hair = 0x1f1c1a;
const steel = 0xb8c2d4, steelDark = 0x8a93a8, grip = 0x8a2f28;

export function createWuliuqiRig(scale: number) {
  const root = new THREE.Group(); root.name = 'wuliuqi';
  const solid = solidMaterial();
  const mats = [solid];

  const frame = buildFrame(root, { hipY: 0.61 });

  // 紧身短褂
  bakeTorso(frame, solid, [
    [0, -.12, .005, .15, .108], [0, .03, .002, .16, .112], [0, .2, .005, .163, .113], [0, .36, 0, .152, .108],
  ], suit, 12);
  {
    const g = new Surface();
    // 胸前银色斜杠 + 腰带
    g.stroke([-.07, .3, .112], [.075, .12, .12], .016, .012, trim);
    g.loft([[0, -.02, .006, .163, .116], [0, .05, .006, .165, .118]], 12, suitDark);
    g.mesh(frame.body, solid);
  }

  bakeLegs(frame, solid, {
    pieces: {
      ...standardPieces,
      thigh: [[0, .01, 0, .082, .088], [0, -.28, 0, .066, .072]],
      shin: [[0, 0, 0, .06, .066], [0, -.27, 0, .049, .053]],
    },
    limbTint: pants, footTint: shoe,
  });
  bakeArms(frame, solid, {
    pieces: {
      ...standardPieces,
      upperArm: [[0, -.02, 0, .056, .062], [0, -.185, 0, .05, .056]],
      forearm: [[0, 0, .01, .052, .056], [0, -.17, .02, .042, .047]],
    },
    sleeveTint: suit, handTint: skin, handR: .05,
  });

  // 头：碎发 + 头巾垂角
  bakeHead(frame, solid, standardPieces.head, skin, 12, (g) => {
    for (const s of [-1, 1]) {
      g.stroke([s * .048, .024, .15], [s * .092, .022, .143], .008, .006, hair); // 眼
      g.stroke([s * .048, .078, .144], [s * .09, .074, .138], .007, .005, hair); // 眉
    }
    g.loft([[0, -.026, .148, .019, .016], [0, -.004, .152, .021, .02], [0, .018, .146, .013, .011]], 6, 0xcaa088);
    g.loft([[0, .095, -.005, .156, .145], [0, .125, -.008, .15, .14]], 12, hair); // 发顶
    g.stroke([-.15, .11, .02], [-.19, -.02, .05], .03, .02, suitDark, 7); // 头巾左垂角
    g.stroke([.15, .11, .02], [.19, -.02, .05], .03, .02, suitDark, 7);
    g.stroke([0, .135, -.06], [0, .21, -.09], .038, .024, hair, 8); // 顶髻
  });

  // 大剪刀：右手持，双刃开合（刃长收短、前倾，避免贴脸）
  const scissors = new THREE.Group(); scissors.name = 'scissors';
  {
    const g = new Surface();
    const blade = (side: number) => {
      // 刃：从握把向前张开
      g.stroke([side * .02, .02, .14], [side * .07, .18, .32], .04, .011, steel, 7);
      g.stroke([side * .07, .18, .32], [side * .075, .26, .38], .012, .004, steelDark, 6);
      // 指环
      g.stroke([side * .02, .02, .14], [side * .045, -.08, .1], .013, .013, grip, 6);
    };
    blade(1); blade(-1);
    g.stroke([-.02, .02, .14], [.02, .02, .14], .026, .026, steelDark, 7); // 铆轴
    g.mesh(scissors, solid);
    scissors.rotation.x = .55;
  }
  frame.armR.elbow.add(scissors);

  // rest：持剪低姿（微侧身）
  function rest() {
    frame.pelvis.position.set(0, frame.hipY, 0); frame.pelvis.rotation.set(0, 0, 0);
    frame.body.rotation.set(.04, .12, 0);
    frame.head.rotation.set(.02, -.1, 0);
    frame.armL.upper.rotation.set(.05, 0, .16); frame.armL.elbow.rotation.set(-.4, 0, .04);
    frame.armR.upper.rotation.set(-.15, 0, -.2); frame.armR.elbow.rotation.set(-.55, 0, -.06);
    frame.legL.thigh.rotation.set(-.03, .08, -.04); frame.legL.knee.rotation.set(.07, 0, 0);
    frame.legR.thigh.rotation.set(.01, -.06, .05); frame.legR.knee.rotation.set(.06, 0, 0);
    scissors.rotation.set(.55, 0, 0);
  }
  rest();
  const standingHeight = new THREE.Box3().setFromObject(root, true).max.y;
  root.scale.setScalar(scale);

  const poses = makePoses(frame, rest);
  // 出手：挥剪（剪刀随右手，双刃在挥出瞬间合拢再张开）
  function attackSwing(t: number) {
    poses.attackSwing(t);
    t = clamp(t);
    const snap = ease((t - .31) / .16);
    scissors.rotation.x = .55 + .5 * ease(t / .33) - .55 * snap;
    scissors.rotation.z = -.25 * snap;
  }

  return {
    root, materials: () => mats, headHeight: () => standingHeight * root.scale.y,
    setOpacity(o: number) { for (const m of mats) { m.transparent = o < 1; m.opacity = o; } },
    ...poses, attackSwing,
  };
}
