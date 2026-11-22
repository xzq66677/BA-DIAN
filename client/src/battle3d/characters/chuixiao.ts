import * as THREE from 'three';
import {
  Surface, buildFrame, solidMaterial, makePoses, clamp, ease,
  standardPieces, bakeLegs, bakeArms, bakeTorso, bakeHead,
} from './kit.js';

/**
 * 吹箫哥 · chuixiao-v1
 * 剪影信号：青竹宽袍 + 常驻唇边竹箫（头挂点，随头动）+ 束发。
 * 远程角色：attackSwing 为凝气吹奏（微后仰），不位移。
 */

const robe = 0x3f7d6b, robeDark = 0x2f5f52, sash = 0x9fd8c2;
const bamboo = 0x5fae8f, bambooDark = 0x467f68;
const pants = 0x2c4438, shoe = 0x22332a, skin = 0xe6bd9f, hair = 0x241f1c;

export function createChuixiaoRig(scale: number) {
  const root = new THREE.Group(); root.name = 'chuixiao';
  const solid = solidMaterial();
  const mats = [solid];

  const frame = buildFrame(root, { hipY: 0.60 });

  // 宽袍（下摆展开）
  bakeTorso(frame, solid, [
    [0, -.16, 0, .185, .13], [0, .02, .004, .172, .12], [0, .2, .004, .168, .118], [0, .36, 0, .152, .108],
  ], robe, 12);
  {
    const g = new Surface();
    g.loft([[0, -.19, 0, .19, .135], [0, -.15, 0, .193, .138]], 12, robeDark); // 袍摆
    g.stroke([-.05, .345, .11], [.03, .06, .119], .009, .007, sash); // 衣襟
    g.stroke([.05, .345, .11], [-.028, .06, .119], .009, .007, sash);
    g.loft([[0, .04, .01, .158, .114], [0, .1, .01, .162, .117]], 12, sash); // 腰绦
    g.mesh(frame.body, solid);
  }

  bakeLegs(frame, solid, { pieces: standardPieces, limbTint: pants, footTint: shoe });
  bakeArms(frame, solid, { pieces: standardPieces, sleeveTint: robe, handTint: skin, handR: .05 });

  // 头：束发 + 常驻竹箫（唇边，随头动）
  bakeHead(frame, solid, standardPieces.head, skin, 12, (g) => {
    for (const s of [-1, 1]) {
      g.stroke([s * .05, .038, .148], [s * .092, .034, .142], .007, .005, hair); // 闭目
      g.stroke([s * .05, .088, .142], [s * .094, .082, .136], .008, .006, hair); // 淡眉
    }
    g.loft([[0, .006, .148, .018, .015], [0, .028, .152, .02, .019], [0, .05, .146, .013, .011]], 6, 0xd0a68c); // 鼻
    // 束发髻
    g.stroke([0, .12, -.02], [0, .2, -.03], .04, .026, hair, 8);
    g.loft([[0, .1, -.01, .152, .14], [0, .13, -.01, .148, .137]], 12, hair); // 发顶
  });
  {
    // 竹箫：贴唇斜置（留在头上，任何姿态都在吹奏）
    const flute = new THREE.Group(); flute.name = 'flute';
    const g = new Surface();
    g.loft([[0, -.05, .13, .026, .026], [0, -.1, .2, .03, .03], [0, -.24, .42, .034, .034], [0, -.3, .5, .026, .026]], 9, bamboo);
    for (let i = 0; i < 3; i++) g.stroke([0, -.12 - i * .05, .245 + i * .05], [0, -.125 - i * .05, .265 + i * .05], .031, .031, bambooDark, 6); // 音孔
    g.mesh(flute, solid);
    frame.head.add(flute);
  }

  // rest：双手抬向箫身的吹奏姿态
  function rest() {
    frame.pelvis.position.set(0, frame.hipY, 0); frame.pelvis.rotation.set(0, 0, 0);
    frame.body.rotation.set(.03, .05, 0);
    frame.head.rotation.set(-.02, .03, 0);
    frame.armL.upper.rotation.set(-.55, .15, -.3); frame.armL.elbow.rotation.set(-1.5, 0, .1);
    frame.armR.upper.rotation.set(-.6, -.15, .3); frame.armR.elbow.rotation.set(-1.45, 0, -.1);
    frame.legL.thigh.rotation.set(-.01, .04, -.03); frame.legL.knee.rotation.set(.05, 0, 0);
    frame.legR.thigh.rotation.set(-.01, -.04, .04); frame.legR.knee.rotation.set(.06, 0, 0);
    frame.headTop.rotation.set(0, 0, 0);
  }
  rest();
  const standingHeight = new THREE.Box3().setFromObject(root, true).max.y;
  root.scale.setScalar(scale);

  const poses = makePoses(frame, rest);
  // 出手（远程）：凝气吹奏——后仰、箫尾微抬
  function attackSwing(t: number) {
    rest();
    t = clamp(t);
    const breath = ease(t / .3) * (1 - ease((t - .5) / .5));
    frame.body.rotation.x -= .16 * breath;
    frame.head.rotation.x -= .14 * breath;
    frame.armR.elbow.rotation.x += -.25 * breath;
    frame.armL.elbow.rotation.x += -.25 * breath;
    frame.armR.upper.rotation.z += .12 * breath;
    frame.armL.upper.rotation.z -= .12 * breath;
    frame.pelvis.position.y += .012 * breath;
  }
  // 领域/施法系姿态（吹箫哥无领域，cast 为演出举手）
  function cast(t: number) {
    rest();
    const wave = Math.sin(t * 2.5);
    frame.armL.upper.rotation.set(-.4, .1, -.62);
    frame.armL.elbow.rotation.x = -1.1 + .07 * wave;
    frame.armR.upper.rotation.set(-1.15, -.2, .3);
    frame.armR.elbow.rotation.x = -1.2;
    frame.head.rotation.x -= .1;
  }

  return {
    root, materials: () => mats, headHeight: () => standingHeight * root.scale.y,
    setOpacity(o: number) { for (const m of mats) { m.transparent = o < 1; m.opacity = o; } },
    ...poses, attackSwing, cast,
  };
}
