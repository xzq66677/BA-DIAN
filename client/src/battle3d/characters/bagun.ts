import * as THREE from 'three';
import {
  Surface, buildFrame, solidMaterial, makePoses,
  standardPieces, bakeLegs, bakeArms, bakeTorso, bakeHead,
} from './kit.js';

/**
 * 拔棍 · bagun-v1
 * 剪影信号：利落短打 + 腰带 + 发髻；右手棍（可由快照 char.stickDrawn 切换收/拔）。
 * stick 通过工厂属性暴露（createCharacterAsset 读取），场景按快照驱动 visible。
 */

const jacket = 0x7d5a3c, jacketDark = 0x5e4229, sash = 0xc9a06a;
const pants = 0x3e3528, shoe = 0x2b241c, skin = 0xe0b398;
const bun = 0x2c2620, wood = 0x7b5230, woodDark = 0x553a20;

export function createBagunRig(scale: number) {
  const root = new THREE.Group(); root.name = 'bagun';
  const solid = solidMaterial();
  const mats = [solid];

  const frame = buildFrame(root, { hipY: 0.62 });

  // 短打上衣（束身、下摆收口）
  bakeTorso(frame, solid, [
    [0, -.13, .008, .16, .115], [0, .04, .005, .168, .118], [0, .2, .008, .172, .118], [0, .36, 0, .158, .112],
  ], jacket, 12);
  {
    const g = new Surface();
    // 宽腰带
    g.loft([[0, .02, .006, .182, .128], [0, .1, .006, .178, .126]], 12, sash);
    // 衣襟斜线
    g.stroke([-.05, .34, .12], [.035, .08, .126], .01, .008, jacketDark);
    g.mesh(frame.body, solid);
  }

  bakeLegs(frame, solid, {
    pieces: {
      ...standardPieces,
      thigh: [[0, .01, 0, .084, .09], [0, -.28, 0, .068, .074]],
      shin: [[0, 0, 0, .062, .068], [0, -.27, 0, .05, .054]],
    },
    limbTint: pants, footTint: shoe,
  });
  bakeArms(frame, solid, {
    pieces: {
      ...standardPieces,
      upperArm: [[0, -.02, 0, .058, .064], [0, -.185, 0, .052, .058]],
      forearm: [[0, 0, .01, .054, .058], [0, -.17, .02, .044, .048]],
    },
    sleeveTint: jacket, handTint: skin, handR: .052,
  });

  // 头：束发髻 + 会在收棍时更醒目的平头轮廓
  bakeHead(frame, solid, standardPieces.head, skin, 12, (g) => {
    for (const s of [-1, 1]) {
      g.stroke([s * .048, .05, .15], [s * .096, .046, .142], .009, .007, bun); // 眉
      g.stroke([s * .05, .01, .152], [s * .09, .008, .146], .007, .005, 0x27221d); // 眼
    }
    g.loft([[0, -.03, .148, .02, .016], [0, -.006, .152, .022, .02], [0, .016, .146, .014, .012]], 6, 0xc9a184); // 鼻
    g.stroke([-.036, -.075, .132], [.036, -.075, .132], .007, .007, 0x8a6a52); // 嘴
    // 发髻（accent 深色，头顶轮廓信号）
    g.stroke([0, .13, -.01], [0, .21, -.015], .042, .03, bun, 8);
  });

  // 棍：挂在右前臂末端（拳头处），向前握持，可由场景切换可见；拔出时随手臂动作
  const stick = new THREE.Group(); stick.name = 'stick';
  stick.visible = false;
  {
    const g = new Surface();
    g.loft([[0, -.02, -.1, .034, .034], [0, -.02, .02, .042, .042], [0, -.02, .48, .05, .05], [0, -.02, .56, .034, .034]], 9, wood);
    g.stroke([0, -.02, .06], [0, -.02, .14], .045, .044, woodDark, 8); // 握纹
    g.mesh(stick, solid);
  }
  frame.armR.elbow.add(stick);

  // rest：利落站姿（双脚分开，双手垂，棍收在背后不可见）
  function rest() {
    frame.pelvis.position.set(0, frame.hipY, 0); frame.pelvis.rotation.set(0, 0, 0);
    frame.body.rotation.set(.02, .06, 0);
    frame.head.rotation.set(.02, .04, 0);
    frame.armL.upper.rotation.set(.06, 0, .14); frame.armL.elbow.rotation.set(-.42, 0, .05);
    frame.armR.upper.rotation.set(.02, 0, -.12); frame.armR.elbow.rotation.set(-.46, 0, -.05);
    frame.legL.thigh.rotation.set(-.02, .05, -.05); frame.legL.knee.rotation.set(.06, 0, 0);
    frame.legR.thigh.rotation.set(-.02, -.05, .06); frame.legR.knee.rotation.set(.07, 0, 0);
    stick.rotation.set(0, 0, 0); stick.scale.setScalar(1);
  }
  rest();
  const standingHeight = new THREE.Box3().setFromObject(root, true).max.y;
  root.scale.setScalar(scale);

  const poses = makePoses(frame, rest);

  return {
    root, materials: () => mats, headHeight: () => standingHeight * root.scale.y,
    setOpacity(o: number) { for (const m of mats) { m.transparent = o < 1; m.opacity = o; } },
    ...poses, stick,
  };
}
