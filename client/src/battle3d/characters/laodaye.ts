import * as THREE from 'three';
import {
  Surface, buildFrame, solidMaterial, glowMaterial, makePoses,
  standardPieces, bakeLegs, bakeArms, bakeTorso, bakeHead,
} from './kit.js';

/**
 * 老大爷 · laodaye-v1
 * 剪影信号：宽檐斗笠、长白须、佝偻背、宽袖短褂；领域系微光（腰间玉坠）。
 * 接口与 gojo-v1 相同的 CharacterRig 姿态集（领域展开走 cast）。
 */

const robe = 0x6b5540, robeDark = 0x54422f, trim = 0xd8cbb0;
const skin = 0xdfb19a, beard = 0xe9e4d8, straw = 0xc9b37e, strawDark = 0xa88f5f;
const pants = 0x463a2c, shoe = 0x332a20;

export function createLaodayeRig(scale: number) {
  const root = new THREE.Group(); root.name = 'laodaye';
  const solid = solidMaterial();
  const charged = glowMaterial(0x8a5ae0, 0.55); // 领域系：玉坠微光，cast/领域时刻更亮
  const mats = [solid, charged];

  const frame = buildFrame(root, { hipY: 0.635, headY: 0.55, shoulderY: 0.44 });
  frame.headTop.position.y = 0.13; // 斗笠扣在头顶，不悬空

  // 宽袖短褂（前摆略长、背部微隆），比标准体型宽松一档
  bakeTorso(frame, solid, [
    [0, -.15, .01, .175, .125], [0, .02, .008, .19, .13], [0, .22, .012, .198, .132], [0, .4, .004, .185, .122],
  ], robe, 12, (p, _a, row) => { if (row === 3) p[2] -= .01; });
  // 对襟滚边 + 下摆
  {
    const g = new Surface();
    g.stroke([-.058, .38, .122], [-.03, .1, .132], .011, .009, trim);
    g.stroke([.058, .38, .122], [.03, .1, .132], .011, .009, trim);
    g.loft([[0, -.175, .01, .178, .128], [0, -.13, .01, .183, .131]], 12, robeDark);
    g.mesh(frame.body, solid);
  }

  bakeLegs(frame, solid, {
    pieces: {
      ...standardPieces,
      thigh: [[0, .01, 0, .088, .094], [0, -.28, 0, .07, .076]],
      shin: [[0, 0, 0, .064, .07], [0, -.28, 0, .052, .056]],
    },
    limbTint: pants, footTint: shoe,
  });

  bakeArms(frame, solid, {
    pieces: {
      ...standardPieces,
      upperArm: [[0, -.02, 0, .062, .068], [0, -.19, 0, .056, .06]],
      forearm: [[0, 0, .01, .058, .062], [0, -.18, .02, .046, .05]],
    },
    sleeveTint: robe, handTint: skin, handR: .05,
  });

  // 头：圆脸 + 眉眼 + 长髯（网格随头动）
  bakeHead(frame, solid, standardPieces.head, skin, 12, (g) => {
    // 白眉（细）+ 闭目眼线
    for (const s of [-1, 1]) {
      g.stroke([s * .048, .082, .144], [s * .098, .074, .138], .008, .006, beard);
      g.stroke([s * .05, .038, .152], [s * .094, .034, .146], .007, .005, 0x6d5142);
    }
    // 鼻
    g.loft([[0, .012, .148, .02, .016], [0, .04, .152, .022, .02], [0, .062, .146, .014, .012]], 6, 0xcfa088);
    // 长髯：颏下三绺，微散开垂到胸前（提前收细避免正面读成板状）
    g.stroke([-.02, -.06, .136], [-.075, -.24, .1], .026, .008, beard);
    g.stroke([.02, -.06, .136], [.075, -.24, .1], .026, .008, beard);
    g.stroke([0, -.055, .142], [0, -.28, .118], .03, .011, beard);
    // 鬓角白发
    for (const s of [-1, 1]) g.stroke([s * .145, .05, -.01], [s * .152, -.06, -.02], .02, .012, beard);
  });

  // 斗笠（headTop 挂点：宽檐锥顶；锥底与檐口同径，不留可见缺口）
  {
    const g = new Surface();
    g.loft([[0, .13, 0, .012, .012], [0, .06, 0, .15, .15], [0, .005, 0, .26, .26]], 14, straw);
    g.loft([[0, -.012, 0, .258, .258], [0, -.024, 0, .252, .252]], 14, strawDark);
    g.stroke([-.24, -.016, .02], [.24, -.016, .02], .009, .009, strawDark, 8);
    g.mesh(frame.headTop, solid);
  }

  // 领域系玉坠（腰前，cast 时脉冲发亮——gojo mark 同款用法）
  const mark = new THREE.Group(); mark.name = 'jade'; mark.position.set(0, .04, .142);
  {
    const g = new Surface();
    g.loft([[0, -.05, 0, .002, .002], [0, -.03, .004, .026, .018], [0, 0, .006, .032, .022], [0, .03, .004, .026, .018], [0, .05, 0, .002, .002]], 7, 0xbfa8ff);
    g.mesh(mark, charged);
  }
  frame.body.add(mark);

  // rest：佝偻站姿（袖手，双臂微垂，双膝微松）
  function rest() {
    frame.pelvis.position.set(0, frame.hipY, 0); frame.pelvis.rotation.set(0, 0, 0);
    frame.body.rotation.set(.075, -.05, .01);
    frame.head.rotation.set(.09, .06, -.03);
    frame.armL.upper.rotation.set(.08, 0, .1); frame.armL.elbow.rotation.set(-.5, 0, .06);
    frame.armR.upper.rotation.set(.1, 0, -.1); frame.armR.elbow.rotation.set(-.5, 0, -.06);
    frame.legL.thigh.rotation.set(-.04, .03, -.03); frame.legL.knee.rotation.set(.08, 0, 0);
    frame.legR.thigh.rotation.set(.02, -.03, .04); frame.legR.knee.rotation.set(.05, 0, 0);
    frame.headTop.rotation.set(0, 0, 0);
    mark.rotation.set(0, 0, 0); mark.scale.setScalar(1);
  }
  rest();
  const standingHeight = new THREE.Box3().setFromObject(root, true).max.y;
  root.scale.setScalar(scale);

  const poses = makePoses(frame, rest, { hunch: .07 });
  function idle(t: number, phase = 0) {
    poses.idle(t, phase);
    mark.rotation.y = t * 1.1 + phase;
    mark.scale.setScalar(.94 + Math.sin(t * 1.8 + phase) * .08);
  }
  function cast(t: number) {
    poses.cast(t);
    mark.scale.setScalar(1.3 + Math.sin(t * 2.5) * .13);
    mark.rotation.y = t * 3;
  }
  function dead(t: number) {
    poses.dead(t);
    mark.scale.setScalar(1 - .995 * Math.min(1, Math.max(0, t)));
  }

  return {
    root, materials: () => mats, headHeight: () => standingHeight * root.scale.y,
    setOpacity(o: number) { for (const m of mats) { m.transparent = o < 1; m.opacity = o; } },
    ...poses, idle, cast, dead,
  };
}
