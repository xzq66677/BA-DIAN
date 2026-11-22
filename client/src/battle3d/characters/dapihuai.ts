import * as THREE from 'three';
import {
  Surface, buildFrame, solidMaterial, makePoses, clamp, ease,
  standardPieces, bakeLegs, bakeArms, bakeTorso, bakeHead,
} from './kit.js';

/**
 * 大屁孩 · dapihuai-v1
 * 剪影信号：矮个胖小孩（palette scale 0.74）+ 大圆头 + 背带裤 + 呆毛。
 * 暴走（精神攻击）走 attackSwing 前扑抓挠；自爆为场景层演出（淘汰）。
 */

const shirt = 0xb5483f, shirtDark = 0x8f3830;
const overall = 0x4a5568, overallDark = 0x39424f;
const shoes = 0x33302c, skin = 0xf0c0a0, hair = 0x241f1b;

export function createDapihuaiRig(scale: number) {
  const root = new THREE.Group(); root.name = 'dapihuai';
  const solid = solidMaterial();
  const mats = [solid];

  // 小孩比例：短腿短臂、大圆头、圆肚
  const frame = buildFrame(root, { hipY: 0.42, thighLen: 0.22, shinLen: 0.2, headY: 0.4, upperLen: 0.16, shoulderY: 0.32 });

  // 圆胖躯干（背带裤在腿上补）
  bakeTorso(frame, solid, [
    [0, -.12, 0, .17, .125], [0, .02, 0, .185, .13], [0, .18, 0, .175, .125], [0, .3, 0, .155, .112],
  ], shirt, 12);
  {
    const g = new Surface();
    g.loft([[0, -.16, 0, .178, .13], [0, -.12, 0, .182, .132]], 12, shirtDark); // 衣摆
    // 背带裤胸兜 + 两条背带
    g.loft([[0, .02, .012, .155, .114], [0, .16, .01, .152, .112]], 12, overall);
    g.stroke([-.09, .3, .09], [-.07, .14, .114], .016, .014, overall, 6);
    g.stroke([.09, .3, .09], [.07, .14, .114], .016, .014, overall, 6);
    g.stroke([0, .06, .118], [0, .12, .116], .02, .02, overallDark, 7); // 口袋线
    g.mesh(frame.body, solid);
  }

  bakeLegs(frame, solid, {
    pieces: {
      thigh: [[0, .01, 0, .078, .084], [0, -.2, 0, .066, .072]],
      shin: [[0, 0, 0, .058, .064], [0, -.18, 0, .047, .051]],
    },
    limbTint: overall, footTint: shoes,
  });
  bakeArms(frame, solid, {
    pieces: {
      upperArm: [[0, -.02, 0, .05, .056], [0, -.14, 0, .046, .05]],
      forearm: [[0, 0, .01, .046, .05], [0, -.13, .02, .038, .042]],
    },
    sleeveTint: shirt, handTint: skin, handR: .05,
  });

  // 头：超大圆头（相对身体）+ 呆毛 + 圆腮
  bakeHead(frame, solid, [
    [0, -.15, .005, .15, .135], [0, -.04, .008, .185, .165], [0, .08, .004, .185, .165], [0, .155, 0, .145, .13],
  ], skin, 12, (g) => {
    for (const s of [-1, 1]) {
      g.stroke([s * .048, .02, .162], [s * .094, .018, .152], .013, .009, 0x27221d); // 圆眼
      g.stroke([s * .05, .07, .156], [s * .092, .066, .148], .007, .005, hair);
    }
    g.loft([[0, -.014, .158, .017, .014], [0, .006, .162, .019, .018], [0, .026, .156, .012, .01]], 6, 0xdda27f);
    g.stroke([-.04, -.078, .142], [.04, -.078, .142], .007, .007, 0x9c6a52); // 嘟嘴
    // 圆腮红
    g.stroke([-.12, -.02, .08], [-.13, -.02, .08], .018, .014, 0xe89a80, 6);
    g.stroke([.12, -.02, .08], [.13, -.02, .08], .018, .014, 0xe89a80, 6);
    // 头发盖 + 呆毛
    g.loft([[0, .11, -.004, .172, .158], [0, .145, -.006, .16, .148]], 12, hair);
    g.stroke([0, .155, -.01], [.015, .24, -.02], .016, .006, hair, 6); // 呆毛
  });

  // rest：叉腰挺肚
  function rest() {
    frame.pelvis.position.set(0, frame.hipY, 0); frame.pelvis.rotation.set(0, 0, 0);
    frame.body.rotation.set(.01, 0, 0);
    frame.head.rotation.set(.04, .04, 0);
    frame.armL.upper.rotation.set(.35, .1, -.4); frame.armL.elbow.rotation.set(-1.1, 0, -.2);
    frame.armR.upper.rotation.set(.35, -.1, .4); frame.armR.elbow.rotation.set(-1.1, 0, .2);
    frame.legL.thigh.rotation.set(-.02, .06, -.04); frame.legL.knee.rotation.set(.08, 0, 0);
    frame.legR.thigh.rotation.set(-.02, -.06, .05); frame.legR.knee.rotation.set(.09, 0, 0);
  }
  rest();
  const standingHeight = new THREE.Box3().setFromObject(root, true).max.y;
  root.scale.setScalar(scale);

  const poses = makePoses(frame, rest);
  // 出手（暴走精神攻击）：双手前扑乱抓
  function attackSwing(t: number) {
    rest();
    t = clamp(t);
    const wind = ease(t / .3) * (1 - ease((t - .3) / .14));
    const lunge = ease((t - .28) / .18) * (1 - ease((t - .55) / .45));
    frame.body.rotation.x += -.25 * wind + .4 * lunge;
    frame.armL.upper.rotation.x += -.7 * wind - 1.35 * lunge;
    frame.armR.upper.rotation.x += -.9 * wind - 1.5 * lunge;
    frame.armL.elbow.rotation.x += -.3 * wind + .9 * lunge;
    frame.armR.elbow.rotation.x += -.3 * wind + 1.0 * lunge;
    frame.armR.elbow.rotation.z += .25 * lunge;
    frame.head.rotation.x -= .22 * wind - .1 * lunge;
    frame.pelvis.position.z += .1 * lunge;
    frame.pelvis.position.y += .04 * wind - .05 * lunge;
    frame.legR.thigh.rotation.x += .3 * lunge;
    frame.legL.thigh.rotation.x -= .2 * lunge;
  }
  // 胜利欢呼（小孩蹦跳）
  function cheer(t: number) {
    rest();
    const hop = Math.abs(Math.sin(t * 5));
    frame.pelvis.position.y += hop * .09;
    frame.armL.upper.rotation.set(-2.2 + Math.sin(t * 5) * .3, 0, -.4);
    frame.armR.upper.rotation.set(-2.2 - Math.sin(t * 5) * .3, 0, .4);
    frame.armL.elbow.rotation.x = -.4;
    frame.armR.elbow.rotation.x = -.4;
    frame.head.rotation.x -= .15;
    frame.legL.knee.rotation.x += .5 * hop;
    frame.legR.knee.rotation.x += .5 * (1 - hop);
  }

  return {
    root, materials: () => mats, headHeight: () => standingHeight * root.scale.y,
    setOpacity(o: number) { for (const m of mats) { m.transparent = o < 1; m.opacity = o; } },
    ...poses, attackSwing, cheer,
  };
}
