import * as THREE from 'three';
import {
  Surface, buildFrame, solidMaterial, makePoses, clamp, ease,
  standardPieces, bakeLegs, bakeArms, bakeTorso, bakeHead,
} from './kit.js';

/**
 * 卖大伊万的小女孩 · ivan-girl-v1
 * 剪影信号：橙棕矮个少女（palette scale 0.92）+ 双马尾 + 抱着的圆炸弹（道具可随投掷演出隐藏暂不做，
 * 炸弹本体与爆炸是场景层 FX，不由角色 rig 负责）。attackSwing = 过顶投掷。
 */

const dress = 0xa86428, dressDark = 0x85501f, apron = 0xf0d8b0;
const hair = 0x5a3c26, shoes = 0x3a2c1e, skin = 0xf0c8a8;
const bombShell = 0x2a2620, bombGlint = 0x4a4438, fuse = 0xd8b04a;

export function createIvanGirlRig(scale: number) {
  const root = new THREE.Group(); root.name = 'ivan-girl';
  const solid = solidMaterial();
  const mats = [solid];

  // 矮个少女比例：腿短、头大
  const frame = buildFrame(root, { hipY: 0.52, thighLen: 0.26, shinLen: 0.24, headY: 0.48, upperLen: 0.19 });

  // 连衣裙（上收下展）
  bakeTorso(frame, solid, [
    [0, -.14, 0, .19, .135], [0, 0, 0, .175, .125], [0, .18, 0, .155, .112], [0, .32, 0, .135, .1],
  ], dress, 12);
  {
    const g = new Surface();
    g.loft([[0, -.17, 0, .2, .14], [0, -.13, 0, .196, .138]], 12, dressDark); // 裙摆边
    g.loft([[0, .1, .008, .148, .107], [0, .16, .008, .143, .105]], 12, apron); // 围裙上沿
    g.stroke([-.05, .3, .105], [.04, .1, .116], .008, .006, apron); // 衣襟
    g.mesh(frame.body, solid);
  }

  bakeLegs(frame, solid, {
    pieces: {
      thigh: [[0, .01, 0, .07, .076], [0, -.24, 0, .056, .062]],
      shin: [[0, 0, 0, .052, .058], [0, -.22, 0, .042, .046]],
    },
    limbTint: skin, footTint: shoes, // 裙下露腿（肤色），白袜短靴
  });
  bakeArms(frame, solid, {
    pieces: {
      ...standardPieces,
      upperArm: [[0, -.02, 0, .05, .056], [0, -.16, 0, .046, .05]],
      forearm: [[0, 0, .01, .048, .052], [0, -.15, .02, .04, .044]],
    },
    sleeveTint: dress, handTint: skin, handR: .048,
  });

  // 头：大眼 + 双马尾（左右各一绺）+ 刘海
  bakeHead(frame, solid, standardPieces.head, skin, 12, (g) => {
    for (const s of [-1, 1]) {
      g.stroke([s * .05, .02, .148], [s * .09, .018, .142], .014, .01, 0x27221d); // 大眼
      g.stroke([s * .056, .052, .148], [s * .088, .05, .142], .007, .005, hair); // 眉
    }
    g.loft([[0, -.02, .148, .016, .013], [0, -.004, .152, .018, .017], [0, .012, .146, .012, .01]], 6, 0xe0a988);
    g.stroke([-.03, -.062, .134], [.03, -.062, .134], .006, .006, 0xb06a5a); // 嘴
    g.loft([[0, .09, 0, .158, .148], [0, .125, -.004, .152, .143]], 12, hair); // 刘海盖
    // 双马尾：垂到肩（发根自然贴合头侧）
    g.stroke([-.16, .06, -.01], [-.2, -.16, .01], .038, .024, hair);
    g.stroke([.16, .06, -.01], [.2, -.16, .01], .038, .024, hair);
  });

  // 怀里的圆炸弹（胸前，双手环抱的姿态语义；投掷时 attackSwing 抬过头顶）
  const bomb = new THREE.Group(); bomb.name = 'bomb';
  bomb.position.set(0, .12, .16);
  {
    const g = new Surface();
    g.loft([[0, -.09, 0, .095, .095], [0, -.02, .004, .112, .112], [0, .06, .004, .104, .104], [0, .1, 0, .06, .06]], 12, bombShell);
    g.stroke([.02, .05, .1], [.06, .02, .11], .012, .01, bombGlint, 6); // 高光棱线
    g.stroke([0, .1, 0], [0, .16, .01], .012, .008, fuse, 6); // 引信
    g.mesh(bomb, solid);
  }
  frame.body.add(bomb);

  // rest：抱弹小步站姿
  function rest() {
    frame.pelvis.position.set(0, frame.hipY, 0); frame.pelvis.rotation.set(0, 0, 0);
    frame.body.rotation.set(.02, 0, 0);
    frame.head.rotation.set(.02, .03, 0);
    frame.armL.upper.rotation.set(.3, .12, -.24); frame.armL.elbow.rotation.set(-1.5, 0, -.15);
    frame.armR.upper.rotation.set(.3, -.12, .24); frame.armR.elbow.rotation.set(-1.5, 0, .15);
    frame.legL.thigh.rotation.set(-.01, .05, -.03); frame.legL.knee.rotation.set(.06, 0, 0);
    frame.legR.thigh.rotation.set(-.01, -.05, .04); frame.legR.knee.rotation.set(.07, 0, 0);
    bomb.rotation.set(0, 0, 0); bomb.position.set(0, .12, .16); bomb.scale.setScalar(1);
  }
  rest();
  const standingHeight = new THREE.Box3().setFromObject(root, true).max.y;
  root.scale.setScalar(scale);

  const poses = makePoses(frame, rest);
  // 出手：过顶投掷——抱弹上举后向前掷出
  function attackSwing(t: number) {
    rest();
    t = clamp(t);
    const lift = ease(t / .3);
    const throwP = ease((t - .32) / .2);
    const settle = ease((t - .55) / .45);
    frame.armL.upper.rotation.x += -1.9 * lift - .9 * throwP;
    frame.armR.upper.rotation.x += -1.9 * lift - .9 * throwP;
    frame.armL.elbow.rotation.x += -.6 * lift + .5 * throwP;
    frame.armR.elbow.rotation.x += -.6 * lift + .5 * throwP;
    frame.body.rotation.x += -.14 * lift + .28 * throwP - .1 * settle;
    frame.head.rotation.x -= .18 * lift - .12 * throwP;
    frame.pelvis.position.y += .05 * lift - .07 * throwP + .02 * settle;
    frame.legR.thigh.rotation.x += .3 * throwP; // 后腿蹬
    frame.legR.knee.rotation.x += -.3 * throwP;
    bomb.position.set(0, .12 + .34 * lift - .3 * throwP, .16 + .1 * lift + .5 * throwP);
    bomb.rotation.x = -1.2 * throwP;
  }

  return {
    root, materials: () => mats, headHeight: () => standingHeight * root.scale.y,
    setOpacity(o: number) { for (const m of mats) { m.transparent = o < 1; m.opacity = o; } },
    ...poses, attackSwing,
  };
}
