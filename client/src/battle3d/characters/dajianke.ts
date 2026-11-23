import * as THREE from 'three';
import {
  Surface, buildFrame, solidMaterial, glowMaterial, makePoses, clamp, ease, TAU,
  standardPieces, bakeLegs, bakeArms, bakeTorso, bakeHead,
} from './kit.js';

/**
 * 大贱客 · dajianke-v2
 * 剪影信号：紫衫瘦高 + 深紫袖/浅紫袖口（手臂与躯干轮廓分离）+ 头顶马蹄铁磁环
 * （spin，场景自转——「吸引全场伤害」语义，缺口周期性朝向镜头）+ 挑眉贱笑。
 * attackSwing = 辱骂指点四拍（背手仰头→蓄势回收→前倾戳指→定格收势），cast = 磁环脉冲（伤害吸引）。
 */

const robe = 0x7a3f7d, robeDark = 0x5e2f61, trim = 0xe0b8e8;
const pants = 0x40333f, shoe = 0x2e2530, skin = 0xdcae94, hair = 0x26201d;
const ring = 0xc23a30;

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
    sleeveTint: robeDark, handTint: skin, handR: .046, // 深紫袖：与中紫躯干拉开轮廓
  });
  // 轮廓分离件：肩垫 + 浅紫袖口 + 右手指示指（程序化，不引外部资产）
  for (const s of [-1, 1]) {
    const arm = s < 0 ? frame.armL : frame.armR;
    const g = new Surface();
    g.loft([[0, -.02, .012, .06, .062], [0, -.06, .014, .058, .06]], 10, trim); // 袖口
    g.mesh(arm.elbow, solid);
    const pad = new Surface();
    pad.loft([[s * .215, .395, 0, .064, .054], [s * .215, .45, 0, .052, .046]], 10, robeDark); // 肩垫
    pad.mesh(frame.body, solid);
  }
  {
    const fg = new Surface();
    fg.stroke([0, -.185, .03], [0, -.265, .034], .015, .008, skin, 6); // 指示指：戳指时领先指尖
    fg.mesh(frame.armR.elbow, solid);
  }

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
    // 马蹄铁弧段拼出真实缺口（自转时缺口周期性朝向镜头），两端浅色极靴强化「缺口」读法
    const R = .15, gap = 1.0, segs = 7, a0 = gap / 2, a1 = TAU - gap / 2;
    let prev: [number, number, number] | null = null;
    for (let i = 0; i <= segs; i++) {
      const a = a0 + (a1 - a0) * (i / segs);
      const p: [number, number, number] = [.05 + R * Math.sin(a), 0, .02 + R * Math.cos(a)];
      if (prev) g.stroke(prev, p, .04, .036, ring, 8);
      prev = p;
    }
    for (const a of [a0, a1]) {
      const bx = .05 + R * Math.sin(a), bz = .02 + R * Math.cos(a);
      const tx = .05 + (R + .05) * Math.sin(a), tz = .02 + (R + .05) * Math.cos(a);
      g.stroke([bx, 0, bz], [tx, 0, tz], .045, .03, trim, 6); // 极靴
    }
    g.mesh(magnet, charged);
    magnet.rotation.x = 1.25; // 斜置悬浮
  }
  frame.headTop.add(magnet);

  // rest：双手背身后、仰头贱笑；肘部外撑让手臂与躯干剪影分离
  function rest() {
    frame.pelvis.position.set(0, frame.hipY, 0); frame.pelvis.rotation.set(0, 0, 0);
    frame.body.rotation.set(-.03, .08, 0);
    frame.head.rotation.set(-.12, .1, 0);
    frame.armL.upper.rotation.set(.24, 0, .1); frame.armL.elbow.rotation.set(-1.02, 0, -.5);
    frame.armR.upper.rotation.set(.24, 0, -.1); frame.armR.elbow.rotation.set(-1.02, 0, .5);
    frame.legL.thigh.rotation.set(-.02, .05, -.03); frame.legL.knee.rotation.set(.06, 0, 0);
    frame.legR.thigh.rotation.set(-.02, -.05, .04); frame.legR.knee.rotation.set(.07, 0, 0);
    magnet.rotation.set(1.25, 0, 0); magnet.scale.setScalar(1);
  }
  rest();
  const standingHeight = new THREE.Box3().setFromObject(root, true).max.y;
  root.scale.setScalar(scale);

  const poses = makePoses(frame, rest);
  // 出手（辱骂·精神）四拍：①背手仰头 ②蓄势回收 ③前倾戳指（指尖离体+定格）④收势。
  // 各节拍权重在 t=0/1 均归零：每帧自 rest 出发、收势必回 rest，连续触发不叠偏。
  function attackSwing(t: number) {
    rest();
    t = clamp(t);
    const open = ease(t / .12) * (1 - ease((t - .3) / .12));
    const coil = ease((t - .16) / .18) * (1 - ease((t - .42) / .1));
    const jab = ease((t - .38) / .16) * (1 - ease((t - .8) / .2));
    const hold = t > .56 && t < .8 ? Math.sin(((t - .56) / .24) * Math.PI) : 0;
    // ① 背手仰头：展胸抬颚，先立「点名者」架势
    frame.body.rotation.x -= .06 * open;
    frame.head.rotation.x -= .2 * open;
    // ② 蓄势：含胸收肩、出手臂折向肩侧、重心微沉
    frame.body.rotation.x += .1 * coil;
    frame.body.rotation.y += .16 * coil;
    frame.armR.upper.rotation.x += .3 * coil;
    frame.armR.elbow.rotation.x -= .55 * coil;
    frame.pelvis.position.y -= .018 * coil;
    frame.legR.thigh.rotation.x += .08 * coil;
    // ③ 戳指：前倾送肩、手臂沿目标线射出、指尖离开躯干轮廓
    frame.body.rotation.x += .3 * jab;
    frame.body.rotation.y -= .2 * jab;
    frame.pelvis.position.z += .13 * jab;
    frame.armR.upper.rotation.x += -1.75 * jab;
    frame.armR.upper.rotation.z += .1 * jab;
    frame.armR.elbow.rotation.x += 1.0 * jab;
    frame.armR.elbow.rotation.z -= .5 * jab;
    frame.armL.upper.rotation.x += .38 * jab;
    frame.armL.elbow.rotation.x += .18 * jab;
    frame.head.rotation.x += .17 * jab;
    frame.head.rotation.y -= .06 * jab;
    frame.legR.thigh.rotation.x -= .28 * jab;
    frame.legR.knee.rotation.x += .22 * jab;
    frame.legL.thigh.rotation.x += .14 * jab;
    magnet.scale.setScalar(1 + .26 * jab + .06 * hold);
    frame.head.rotation.z += .03 * hold; // 峰值定格微颤
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
