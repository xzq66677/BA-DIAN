import * as THREE from 'three';
import {
  Surface, buildFrame, solidMaterial, makePoses,
  standardPieces, bakeLegs, bakeArms, bakeTorso, bakeHead,
} from './kit.js';

/**
 * 马保国 · mabaoguo-v1
 * 剪影信号：朱红对襟褂 + 背后太极盘（spin，场景自转）+ 白发圆髻。
 * attackSwing 通用劈砍；闪电五连鞭/太极判定走 cast/受击既有演出。
 */

const robe = 0x8f2f2a, robeDark = 0x6e2420, trim = 0xefe6d8;
const pants = 0x4a3a30, shoe = 0x332820, skin = 0xdfb19a, hair = 0xdcd8ce;
const taijiLight = 0xefe6d8, taijiDark = 0x2a2620;

export function createMabaoguoRig(scale: number) {
  const root = new THREE.Group(); root.name = 'mabaoguo';
  const solid = solidMaterial();
  const mats = [solid];

  const frame = buildFrame(root, { hipY: 0.615 });

  // 对襟褂（宽松、下摆盖臀）
  bakeTorso(frame, solid, [
    [0, -.17, .008, .18, .128], [0, .02, .005, .178, .124], [0, .2, .005, .175, .122], [0, .37, 0, .163, .115],
  ], robe, 12);
  {
    const g = new Surface();
    g.stroke([-.05, .36, .118], [-.028, .08, .126], .01, .008, trim); // 对襟滚边
    g.stroke([.05, .36, .118], [.028, .08, .126], .01, .008, trim);
    g.loft([[0, -.2, .008, .185, .133], [0, -.16, .008, .19, .136]], 12, robeDark); // 下摆
    g.loft([[0, -.06, .008, .168, .12], [0, .0, .008, .17, .122]], 12, trim); // 腰带
    g.mesh(frame.body, solid);
  }

  bakeLegs(frame, solid, {
    pieces: {
      ...standardPieces,
      thigh: [[0, .01, 0, .086, .092], [0, -.28, 0, .07, .076]],
      shin: [[0, 0, 0, .063, .069], [0, -.27, 0, .05, .055]],
    },
    limbTint: pants, footTint: shoe,
  });
  bakeArms(frame, solid, {
    pieces: {
      ...standardPieces,
      upperArm: [[0, -.02, 0, .06, .066], [0, -.19, 0, .054, .058]],
      forearm: [[0, 0, .01, .056, .06], [0, -.18, .02, .044, .049]],
    },
    sleeveTint: robe, handTint: skin, handR: .05,
  });

  // 头：白发圆髻 + 圆眼镜式眼圈
  bakeHead(frame, solid, standardPieces.head, skin, 12, (g) => {
    for (const s of [-1, 1]) {
      g.stroke([s * .05, .028, .148], [s * .094, .026, .141], .008, .006, 0x27221d); // 眼
      g.stroke([s * .046, .052, .15], [s * .096, .05, .143], .012, .01, 0x6b6259); // 圆眼镜框
      g.stroke([s * .05, .09, .142], [s * .094, .086, .136], .007, .005, hair); // 白眉
    }
    g.loft([[0, -.02, .148, .019, .016], [0, .002, .152, .021, .02], [0, .024, .146, .013, .011]], 6, 0xc9a184);
    g.stroke([-.038, -.08, .132], [.038, -.08, .132], .007, .007, 0x9c8c7a); // 嘴
    g.loft([[0, .1, -.005, .155, .145], [0, .125, -.008, .148, .14]], 12, hair); // 白发顶
    g.stroke([0, .135, -.02], [0, .2, -.03], .04, .026, hair, 8); // 圆髻
  });

  // 背后太极盘（spin：场景每帧自转；近水平斜置于肩后，默认俯视机位可读盘面）
  const disc = new THREE.Group(); disc.name = 'spin';
  disc.position.set(0, .72, -.28);
  {
    const g = new Surface();
    g.loft([[0, -.02, 0, .17, .17], [0, 0, 0, .175, .175], [0, .02, 0, .17, .17]], 20, taijiLight);
    // 阴阳纹画在上盖面（盘斜立后朝向镜头）：暗半边 + S 界线 + 双鱼眼
    g.stroke([0, .023, .095], [0, .023, .005], .078, .05, taijiDark, 12);
    g.stroke([0, .023, .09], [-.03, .023, .028], .014, .014, taijiDark, 7);
    g.stroke([-.03, .023, .028], [.03, .023, -.028], .014, .014, taijiDark, 7);
    g.stroke([.03, .023, -.028], [0, .023, -.09], .014, .014, taijiDark, 7);
    g.stroke([0, .026, .05], [0, .026, .055], .014, .014, taijiDark, 7);
    g.stroke([0, .026, -.05], [0, .026, -.055], .014, .014, taijiLight, 7);
    g.mesh(disc, solid);
  }
  frame.body.add(disc);

  // rest：浑圆桩（双臂微抱圆，太极起手式）
  function rest() {
    frame.pelvis.position.set(0, frame.hipY, 0); frame.pelvis.rotation.set(0, 0, 0);
    frame.body.rotation.set(.04, 0, 0);
    frame.head.rotation.set(.03, .04, 0);
    frame.armL.upper.rotation.set(.25, .12, -.2); frame.armL.elbow.rotation.set(-1.15, 0, -.1);
    frame.armR.upper.rotation.set(.25, -.12, .2); frame.armR.elbow.rotation.set(-1.15, 0, .1);
    frame.legL.thigh.rotation.set(-.02, .06, -.05); frame.legL.knee.rotation.set(.1, 0, 0);
    frame.legR.thigh.rotation.set(-.02, -.06, .06); frame.legR.knee.rotation.set(.1, 0, 0);
    disc.rotation.set(1.15, 0, 0); // 近竖立光环，盘面朝上前
  }
  rest();
  const standingHeight = new THREE.Box3().setFromObject(root, true).max.y;
  root.scale.setScalar(scale);

  const poses = makePoses(frame, rest);

  return {
    root, materials: () => mats, headHeight: () => standingHeight * root.scale.y,
    setOpacity(o: number) { for (const m of mats) { m.transparent = o < 1; m.opacity = o; } },
    ...poses,
  };
}
