import * as THREE from 'three';
import {
  Surface, buildFrame, solidMaterial, makePoses, clamp, ease,
  standardPieces, bakeLegs, bakeArms, bakeTorso, bakeHead,
} from './kit.js';

/**
 * 今日勇者 · hero-today-v1
 * 剪影信号：绿披风轻甲勇者 + 头顶大骰子（spin，场景自转，呼应「抽取今日运势」）。
 * attackSwing 通用劈砍；运势抽取走 cast（抬头望骰）。
 */

const tunic = 0x2f8f4f, tunicDark = 0x246f3c, trim = 0xbdf0cf;
const pants = 0x3d4436, boots = 0x2e3327, skin = 0xe6bd9f, hair = 0x2c241e;
const dice = 0xf0ead8, dicePip = 0x2a2620;

export function createHeroTodayRig(scale: number) {
  const root = new THREE.Group(); root.name = 'hero-today';
  const solid = solidMaterial();
  const mats = [solid];

  const frame = buildFrame(root, { hipY: 0.60 });

  // 短上衣 + 胸甲条
  bakeTorso(frame, solid, [
    [0, -.13, .005, .16, .115], [0, .03, .002, .168, .118], [0, .2, .005, .17, .118], [0, .36, 0, .158, .112],
  ], tunic, 12);
  {
    const g = new Surface();
    g.loft([[0, .16, .012, .156, .112], [0, .26, .01, .16, .114]], 12, tunicDark); // 胸甲带
    g.loft([[0, -.03, .008, .166, .118], [0, .04, .008, .168, .12]], 12, trim); // 腰绦
    g.stroke([-.04, .35, .115], [.03, .08, .124], .01, .008, trim); // 衣襟
    // 披风：背后整片，随身体动
    g.loft([
      [-.12, .34, -.12, .05, .02], [.12, .34, -.12, .05, .02], [.1, -.28, -.16, .07, .02], [-.1, -.28, -.16, .07, .02],
    ], 6, tunicDark);
    g.mesh(frame.body, solid);
  }

  bakeLegs(frame, solid, {
    pieces: {
      ...standardPieces,
      thigh: [[0, .01, 0, .084, .09], [0, -.28, 0, .067, .073]],
      shin: [[0, 0, 0, .062, .068], [0, -.26, 0, .05, .054]],
    },
    limbTint: pants, footTint: boots,
  });
  bakeArms(frame, solid, {
    pieces: {
      ...standardPieces,
      upperArm: [[0, -.02, 0, .058, .064], [0, -.185, 0, .052, .057]],
      forearm: [[0, 0, .01, .054, .058], [0, -.17, .02, .043, .048]],
    },
    sleeveTint: tunic, handTint: skin, handR: .05,
  });

  // 头：短发 + 发带
  bakeHead(frame, solid, standardPieces.head, skin, 12, (g) => {
    for (const s of [-1, 1]) {
      g.stroke([s * .05, .026, .149], [s * .092, .024, .142], .008, .006, 0x27221d);
      g.stroke([s * .05, .078, .144], [s * .092, .074, .138], .007, .005, hair);
    }
    g.loft([[0, 0, .148, .018, .015], [0, .024, .152, .02, .019], [0, .046, .146, .013, .011]], 6, 0xd0a68c);
    g.stroke([-.034, -.078, .133], [.034, -.078, .133], .006, .006, 0x9c7a62);
    g.loft([[0, .09, 0, .157, .147], [0, .12, -.004, .15, .142]], 12, hair);
    g.stroke([-.152, .095, .02], [.152, .095, .02], .022, .022, trim, 8); // 发带
    g.stroke([0, .125, -.05], [0, .17, -.07], .03, .018, hair, 7); // 小揪揪
  });

  // 头顶大骰子（spin：场景自转；运势抽取 cast 时放大脉冲）
  const die = new THREE.Group(); die.name = 'spin';
  die.position.set(0, .1, 0);
  {
    const g = new Surface();
    g.loft([[0, -.09, -.09, .1, .1], [0, .11, -.09, .1, .1]], 4, dice, 0); // 方块（4 边 = 方柱，棱角骰）
    g.stroke([0, .112, -.04], [0, .112, -.04], .014, .014, dicePip, 6); // 顶面 1 点
    g.stroke([.06, .05, .04], [.06, .05, .04], .012, .012, dicePip, 6); // 侧点
    g.mesh(die, solid);
  }
  frame.headTop.add(die);

  // rest：昂首挺胸勇者站姿
  function rest() {
    frame.pelvis.position.set(0, frame.hipY, 0); frame.pelvis.rotation.set(0, 0, 0);
    frame.body.rotation.set(-.02, .05, 0);
    frame.head.rotation.set(-.06, .04, 0);
    frame.armL.upper.rotation.set(.08, 0, .14); frame.armL.elbow.rotation.set(-.45, 0, .05);
    frame.armR.upper.rotation.set(.05, 0, -.13); frame.armR.elbow.rotation.set(-.5, 0, -.05);
    frame.legL.thigh.rotation.set(-.02, .04, -.04); frame.legL.knee.rotation.set(.06, 0, 0);
    frame.legR.thigh.rotation.set(-.02, -.04, .05); frame.legR.knee.rotation.set(.07, 0, 0);
    die.rotation.set(0, 0, 0); die.scale.setScalar(1);
  }
  rest();
  const standingHeight = new THREE.Box3().setFromObject(root, true).max.y;
  root.scale.setScalar(scale);

  const poses = makePoses(frame, rest);
  // 施法（抽取今日运势）：抬头望骰，骰子放大脉冲
  function cast(t: number) {
    rest();
    const wave = Math.sin(t * 2.5);
    frame.head.rotation.x -= .3;
    frame.armR.upper.rotation.set(-.8, -.1, .3);
    frame.armR.elbow.rotation.x = -1.3 + .08 * wave;
    frame.armL.upper.rotation.z -= .1;
    die.scale.setScalar(1.15 + Math.max(0, wave) * .18);
    die.rotation.y = t * 3;
  }
  function idle(t: number, phase = 0) {
    poses.idle(t, phase);
    die.rotation.y = t * 1.2 + phase;
    die.scale.setScalar(.96 + Math.sin(t * 1.8 + phase) * .06);
  }

  return {
    root, materials: () => mats, headHeight: () => standingHeight * root.scale.y,
    setOpacity(o: number) { for (const m of mats) { m.transparent = o < 1; m.opacity = o; } },
    ...poses, cast, idle,
  };
}
