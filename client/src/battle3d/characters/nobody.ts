import * as THREE from 'three';
import {
  Surface, buildFrame, solidMaterial, makePoses,
  standardPieces, bakeLegs, bakeArms, bakeTorso, bakeHead,
} from './kit.js';

/**
 * 无业游民 · nobody-v1（default）
 * 剪影信号：灰蓝便服、微驼背、插兜感——「没选上角色」的平凡人。
 * 无专属道具与技能动作；全套通用姿态。
 */

const wear = 0x5a6b7d, wearDark = 0x47566a;
const pants = 0x3a4250, shoe = 0x2b3038, skin = 0xe0b398, hair = 0x332c26;

export function createNobodyRig(scale: number) {
  const root = new THREE.Group(); root.name = 'nobody';
  const solid = solidMaterial();
  const mats = [solid];

  const frame = buildFrame(root, { hipY: 0.60 });

  // 平常的夹克
  bakeTorso(frame, solid, [
    [0, -.14, .006, .162, .116], [0, .02, .004, .17, .118], [0, .2, .004, .172, .118], [0, .37, 0, .16, .112],
  ], wear, 12);
  {
    const g = new Surface();
    g.stroke([-.048, .36, .118], [.032, .06, .126], .009, .007, wearDark); // 衣襟
    g.loft([[0, -.05, .008, .163, .117], [0, .01, .008, .165, .119]], 12, wearDark); // 腰带
    g.mesh(frame.body, solid);
  }

  bakeLegs(frame, solid, { pieces: standardPieces, limbTint: pants, footTint: shoe });
  bakeArms(frame, solid, { pieces: standardPieces, sleeveTint: wear, handTint: skin, handR: .052 });

  // 头：普通短发，没精打采
  bakeHead(frame, solid, standardPieces.head, skin, 12, (g) => {
    for (const s of [-1, 1]) {
      g.stroke([s * .05, .03, .149], [s * .09, .026, .142], .007, .005, 0x27221d); // 眼（半垂）
      g.stroke([s * .05, .08, .144], [s * .092, .076, .138], .007, .005, hair);
    }
    g.loft([[0, .004, .148, .018, .015], [0, .026, .152, .02, .019], [0, .048, .146, .013, .011]], 6, 0xcfa084);
    g.stroke([-.03, -.07, .133], [.03, -.07, .133], .006, .006, 0x8f6a54);
    g.loft([[0, .095, -.004, .156, .146], [0, .125, -.006, .148, .14]], 12, hair); // 平头
  });

  // rest：微驼背、双臂下垂
  function rest() {
    frame.pelvis.position.set(0, frame.hipY, 0); frame.pelvis.rotation.set(0, 0, 0);
    frame.body.rotation.set(.05, .04, .01);
    frame.head.rotation.set(.08, .05, -.02);
    frame.armL.upper.rotation.set(.1, 0, .12); frame.armL.elbow.rotation.set(-.55, 0, .04);
    frame.armR.upper.rotation.set(.12, 0, -.12); frame.armR.elbow.rotation.set(-.55, 0, -.04);
    frame.legL.thigh.rotation.set(-.02, .04, -.03); frame.legL.knee.rotation.set(.07, 0, 0);
    frame.legR.thigh.rotation.set(-.02, -.04, .04); frame.legR.knee.rotation.set(.08, 0, 0);
  }
  rest();
  const standingHeight = new THREE.Box3().setFromObject(root, true).max.y;
  root.scale.setScalar(scale);

  const poses = makePoses(frame, rest, { hunch: .05 });

  return {
    root, materials: () => mats, headHeight: () => standingHeight * root.scale.y,
    setOpacity(o: number) { for (const m of mats) { m.transparent = o < 1; m.opacity = o; } },
    ...poses,
  };
}
