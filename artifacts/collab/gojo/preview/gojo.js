import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (value) => Math.max(0, Math.min(1, value));
const ease = (value) => { const t = clamp(value); return t * t * (3 - 2 * t); };
const easeOutBack = (value) => { const t = clamp(value), c1 = 1.35, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; };
const ink = 0x111827, indigo = 0x30375f, lapel = 0x4d5484, fold = 0x222840;
const skin = 0xf0c3aa, skinShade = 0xd79d88, silver = 0xf5f8ff, ice = 0xb8cee6, teal = 0x67e9f1;
const hairLight = 0xffffff, hairMid = 0xe6eefb, hairShade = 0xb7cbe4;

function weaveTextures() {
  const size = 64;
  const color = new Uint8Array(size * size * 4);
  const rough = new Uint8Array(size * size * 4);
  const normal = new Uint8Array(size * size * 4);
  const height = (x, y) => {
    const warp = Math.sin(x * Math.PI / 2) * .5 + .5;
    const weft = Math.sin(y * Math.PI / 2) * .5 + .5;
    return (x % 4 < 2 ? warp : weft) * .5 + .25;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const h = height(x, y);
    const shade = Math.round(231 + h * 24);
    color.set([shade, shade, shade, 255], i);
    const roughness = Math.round(218 + h * 37);
    rough.set([roughness, roughness, roughness, 255], i);
    const dx = height(x + 1, y) - height(x - 1, y);
    const dy = height(x, y + 1) - height(x, y - 1);
    normal.set([128 - dx * 95, 128 - dy * 95, 250, 255], i);
  }
  const texture = (data, srgb = false) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const context = canvas.getContext('2d');
    const image = context.createImageData(size, size);
    image.data.set(data);
    context.putImageData(image, 0, 0);
    const result = new THREE.CanvasTexture(canvas);
    result.wrapS = result.wrapT = THREE.RepeatWrapping;
    result.repeat.set(5, 7);
    result.magFilter = THREE.LinearFilter;
    result.minFilter = THREE.LinearMipmapLinearFilter;
    result.generateMipmaps = true;
    result.anisotropy = 4;
    if (srgb) result.colorSpace = THREE.SRGBColorSpace;
    result.needsUpdate = true;
    return result;
  };
  return { color: texture(color, true), roughness: texture(rough), normal: texture(normal) };
}

class Surface {
  constructor() {
    this.vertices = [];
    this.colors = [];
    this.uvs = [];
    this.color = new THREE.Color();
  }

  tri(a, b, c, tint, uv) {
    this.vertices.push(...a, ...b, ...c);
    const { r, g, b: blue } = this.color.setHex(tint);
    for (let i = 0; i < 3; i++) this.colors.push(r, g, blue);
    this.uvs.push(...(uv ?? [[0, 0], [1, 0], [1, 1]]));
  }

  loft(sections, sides, tint, phase = Math.PI / sides, shape) {
    const rows = sections.map(([x, y, z, rx, rz], row) => Array.from({ length: sides }, (_, i) => {
      const a = i * TAU / sides + phase;
      const p = [x + rx * Math.sin(a), y, z + rz * Math.cos(a)];
      shape?.(p, a, row);
      return p;
    }));
    for (let k = 1; k < rows.length; k++) for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides, lo = rows[k - 1], hi = rows[k];
      this.tri(lo[i], lo[j], hi[i], tint, [[i / sides, (k - 1) / (rows.length - 1)], [(i + 1) / sides, (k - 1) / (rows.length - 1)], [i / sides, k / (rows.length - 1)]]);
      this.tri(lo[j], hi[j], hi[i], tint, [[(i + 1) / sides, (k - 1) / (rows.length - 1)], [(i + 1) / sides, k / (rows.length - 1)], [i / sides, k / (rows.length - 1)]]);
    }
    for (const k of [0, rows.length - 1]) {
      const [x, y, z] = sections[k];
      for (let i = 0; i < sides; i++) {
        const a = rows[k][i], b = rows[k][(i + 1) % sides];
        this.tri([x, y, z], k ? a : b, k ? b : a, tint, [[.5, .5], [i / sides, k], [(i + 1) / sides, k]]);
      }
    }
  }

  stroke(from, to, radius, endRadius, tint, n = 6) {
    const axis = V(...to).sub(V(...from)).normalize();
    const u = V().crossVectors(axis, Math.abs(axis.y) > .85 ? V(0, 0, 1) : V(0, 1, 0)).normalize();
    const v = V().crossVectors(axis, u);
    const section = (center, r) => Array.from({ length: n }, (_, i) => {
      const a = i * TAU / n, x = r * Math.cos(a), y = r * Math.sin(a);
      return [center[0] + u.x * x + v.x * y, center[1] + u.y * x + v.y * y, center[2] + u.z * x + v.z * y];
    });
    const lo = section(from, radius), hi = section(to, endRadius);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.tri(lo[i], lo[j], hi[i], tint, [[i / n, 0], [(i + 1) / n, 0], [i / n, 1]]);
      this.tri(lo[j], hi[j], hi[i], tint, [[(i + 1) / n, 0], [(i + 1) / n, 1], [i / n, 1]]);
      this.tri(from, lo[j], lo[i], tint); this.tri(to, hi[i], hi[j], tint);
    }
  }

  curveLock(base, control, tip, width, depth, tint, sides = 7, steps = 6) {
    const a = V(...base), b = V(...control), c = V(...tip);
    const rows = [];
    for (let k = 0; k <= steps; k++) {
      const t = k / steps, inv = 1 - t;
      const center = a.clone().multiplyScalar(inv * inv).addScaledVector(b, 2 * inv * t).addScaledVector(c, t * t);
      const tangent = b.clone().sub(a).multiplyScalar(2 * inv).addScaledVector(c.clone().sub(b), 2 * t).normalize();
      const reference = Math.abs(tangent.y) > .88 ? V(0, 0, 1) : V(0, 1, 0);
      const u = V().crossVectors(tangent, reference).normalize();
      const v = V().crossVectors(tangent, u).normalize();
      const taper = Math.pow(1 - t, .72);
      rows.push(Array.from({ length: sides }, (_, i) => {
        const angle = i * TAU / sides;
        const point = center.clone().addScaledVector(u, Math.cos(angle) * width * taper).addScaledVector(v, Math.sin(angle) * depth * taper * (1 + .13 * Math.cos(angle * 2)));
        if (k === steps) point.copy(c);
        return point.toArray();
      }));
    }
    for (let k = 1; k < rows.length; k++) for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides, lo = rows[k - 1], hi = rows[k];
      const shade = new THREE.Color(tint).multiplyScalar(.9 + .13 * Math.cos(i * TAU / sides + .7));
      this.tri(lo[i], lo[j], hi[i], shade.getHex(), [[i / sides, (k - 1) / steps], [(i + 1) / sides, (k - 1) / steps], [i / sides, k / steps]]);
      this.tri(lo[j], hi[j], hi[i], shade.getHex(), [[(i + 1) / sides, (k - 1) / steps], [(i + 1) / sides, k / steps], [i / sides, k / steps]]);
    }
  }

  geometry() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.vertices, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geometry.computeVertexNormals();
    return geometry;
  }
}

function coloredGeometry(geometry, color) {
  const result = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const tint = new THREE.Color(color);
  const colors = new Float32Array(result.attributes.position.count * 3);
  for (let i = 0; i < result.attributes.position.count; i++) {
    colors[i * 3] = tint.r; colors[i * 3 + 1] = tint.g; colors[i * 3 + 2] = tint.b;
  }
  result.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  for (const name of Object.keys(result.attributes)) if (!['position', 'normal', 'color', 'uv'].includes(name)) result.deleteAttribute(name);
  if (!result.attributes.normal) result.computeVertexNormals();
  if (!result.attributes.uv) {
    const positions = result.attributes.position;
    const uv = new Float32Array(positions.count * 2);
    for (let i = 0; i < positions.count; i++) {
      uv[i * 2] = .5 + Math.atan2(positions.getZ(i), positions.getX(i)) / TAU;
      uv[i * 2 + 1] = positions.getY(i);
    }
    result.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  return result;
}

function ellipsoid(center, scale, color, segments = 16) {
  const geometry = new THREE.SphereGeometry(1, segments, Math.max(8, segments / 2));
  geometry.scale(...scale);
  geometry.translate(...center);
  return coloredGeometry(geometry, color);
}

function almondEye(x, y, z, width, height, color) {
  const shape = new THREE.Shape();
  shape.moveTo(x - width, y);
  shape.quadraticCurveTo(x, y + height * 1.35, x + width, y);
  shape.quadraticCurveTo(x, y - height, x - width, y);
  const geometry = new THREE.ShapeGeometry(shape, 12);
  geometry.translate(0, 0, z);
  return coloredGeometry(geometry, color);
}

function radialDisc(x, y, z, radius, colors, segments = 28, inner = 0, aspect = 1) {
  const surface = new Surface();
  for (let i = 0; i < segments; i++) {
    const a = i * TAU / segments, b = (i + 1) * TAU / segments;
    const point = (angle, r) => [x + Math.cos(angle) * r, y + Math.sin(angle) * r * aspect, z];
    surface.tri(point(a, inner), point(a, radius), point(b, radius), colors[i % colors.length]);
    if (inner) surface.tri(point(a, inner), point(b, radius), point(b, inner), colors[i % colors.length]);
  }
  return surface.geometry();
}

export function createGojoAsset() {
  const root = new THREE.Group();
  root.name = 'Gojo';
  root.userData = { charId: 'gojo', visualId: 'gojo-v2', units: 'meters', forward: '+Z' };
  const bones = [];
  const parts = [];
  const bone = (name, parent, x = 0, y = 0, z = 0) => {
    const node = new THREE.Bone();
    node.name = name;
    node.position.set(x, y, z);
    node.userData.boneIndex = bones.length;
    parent.add(node);
    bones.push(node);
    return node;
  };
  const weave = weaveTextures();
  const materials = {
    body: new THREE.MeshPhysicalMaterial({ name: 'Gojo_Uniform_Fabric', vertexColors: true, map: weave.color, roughnessMap: weave.roughness, normalMap: weave.normal, normalScale: new THREE.Vector2(.16, .16), roughness: .86, metalness: 0, sheen: .7, sheenColor: new THREE.Color(0x7786bb), sheenRoughness: .72, envMapIntensity: .45 }),
    panel: new THREE.MeshPhysicalMaterial({ name: 'Gojo_Coat_Panels', vertexColors: true, map: weave.color, roughnessMap: weave.roughness, roughness: .68, metalness: .02, sheen: .45, sheenColor: new THREE.Color(0x9ba9d4), sheenRoughness: .58, clearcoat: .08, clearcoatRoughness: .6 }),
    skin: new THREE.MeshPhysicalMaterial({ name: 'Gojo_Skin', vertexColors: true, roughness: .56, metalness: 0, clearcoat: .1, clearcoatRoughness: .7, envMapIntensity: .45 }),
    hair: new THREE.MeshStandardMaterial({ name: 'Gojo_Sculpted_Hair', vertexColors: true, roughness: .43, metalness: .035, envMapIntensity: .7 }),
    blindfold: new THREE.MeshPhysicalMaterial({ name: 'Gojo_Blindfold_Cloth', vertexColors: true, map: weave.color, roughnessMap: weave.roughness, normalMap: weave.normal, normalScale: new THREE.Vector2(.38, .38), roughness: .97, metalness: 0, sheen: .35, sheenColor: new THREE.Color(0x59647e), sheenRoughness: .9 }),
    eyeWhite: new THREE.MeshPhysicalMaterial({ name: 'Gojo_Eye_White', vertexColors: true, roughness: .16, metalness: 0, clearcoat: .72, clearcoatRoughness: .08, envMapIntensity: .8 }),
    iris: new THREE.MeshStandardMaterial({ name: 'Gojo_Six_Eyes_Iris', vertexColors: true, roughness: .2, emissive: 0x20e5ff, emissiveIntensity: 3.2, envMapIntensity: .8 }),
    pupil: new THREE.MeshStandardMaterial({ name: 'Gojo_Eye_Pupil', vertexColors: true, roughness: .24 }),
    highlight: new THREE.MeshStandardMaterial({ name: 'Gojo_Eye_Highlight', vertexColors: true, roughness: .08, emissive: 0x9cefff, emissiveIntensity: .85 }),
    seal: new THREE.MeshStandardMaterial({ name: 'Gojo_Cursed_Energy', vertexColors: true, roughness: .22, emissive: 0x27d9e6, emissiveIntensity: 1.45 }),
    stitch: new THREE.MeshStandardMaterial({ name: 'Gojo_Embroidered_Trim', vertexColors: true, roughness: .55, metalness: .18 }),
    boot: new THREE.MeshPhysicalMaterial({ name: 'Gojo_Boot_Leather', vertexColors: true, roughness: .48, metalness: .04, clearcoat: .24, clearcoatRoughness: .42 }),
    metal: new THREE.MeshStandardMaterial({ name: 'Gojo_Hardware', vertexColors: true, roughness: .3, metalness: .78, envMapIntensity: 1.1 }),
    liner: new THREE.MeshStandardMaterial({ name: 'Gojo_Face_Details', vertexColors: true, roughness: .72 }),
  };
  const addPart = (geometry, owner, material, name) => {
    parts.push({ geometry, owner, material, name });
    return geometry;
  };
  const addSurface = (surface, owner, material = materials.body, name = 'Surface') => addPart(surface.geometry(), owner, material, name);

  const Root = bone('Root', root, 0, .012, 0);
  const Pelvis = bone('Pelvis', Root, 0, .688, 0);
  const Chest = bone('Chest', Pelvis);
  const Head = bone('Head', Chest, 0, .696, 0);
  const Blindfold = bone('Blindfold', Head, 0, .034, .002);
  const upperL = bone('UpperArm.L', Chest, -.222, .401, 0);
  const forearmL = bone('Forearm.L', upperL, 0, -.205, 0);
  const handL = bone('Hand.L', forearmL, 0, -.27, 0);
  const indexL = bone('Index.L', handL, -.012, .013, .012);
  const indexTipL = bone('IndexTip.L', indexL, 0, -.046, 0);
  const middleL = bone('Middle.L', handL, .0315, .013, .012);
  const middleTipL = bone('MiddleTip.L', middleL, 0, -.05, 0);
  const ringL = bone('Ring.L', handL, -.0525, .013, .012);
  const ringTipL = bone('RingTip.L', ringL, 0, -.033, .009);
  const pinkyL = bone('Pinky.L', handL, -.0935, .013, .012);
  const pinkyTipL = bone('PinkyTip.L', pinkyL, 0, -.029, .011);
  const thumbL = bone('Thumb.L', handL, -.034, .02, .014);
  const thumbTipL = bone('ThumbTip.L', thumbL, -.022, -.035, .009);
  const upperR = bone('UpperArm.R', Chest, .222, .401, 0);
  const forearmR = bone('Forearm.R', upperR, 0, -.205, 0);
  const handR = bone('Hand.R', forearmR, 0, -.27, 0);
  const thighL = bone('Thigh.L', Pelvis, -.104, 0, 0);
  const shinL = bone('Shin.L', thighL, 0, -.32, 0);
  const footL = bone('Foot.L', shinL, 0, -.364, .044);
  const thighR = bone('Thigh.R', Pelvis, .104, 0, 0);
  const shinR = bone('Shin.R', thighR, 0, -.32, 0);
  const footR = bone('Foot.R', shinR, 0, -.364, .044);
  const seal = bone('FingerSeal.R', handR, -.01, -.075, .026);
  const ventL = bone('CoatVent.L', Chest, -.102, -.06, -.062);
  const ventR = bone('CoatVent.R', Chest, .102, -.06, -.062);
  const eyesSocket = new THREE.Object3D();
  eyesSocket.name = 'SixEyesSocket';
  eyesSocket.position.set(0, .03, .225);
  Head.add(eyesSocket);
  const gripSocket = new THREE.Object3D();
  gripSocket.name = 'BlindfoldGripSocket';
  gripSocket.position.set(0, -.045, .04);
  handL.add(gripSocket);
  const domainSocket = new THREE.Object3D();
  domainSocket.name = 'DomainSocket';
  domainSocket.position.set(0, .9, 0);
  Root.add(domainSocket);
  root.userData.sockets = { eyes: eyesSocket.name, blindfoldGrip: gripSocket.name, domain: domainSocket.name };

  function makeHead() {
    const face = new Surface();
    face.loft([
      [0,-.185,.024,.058,.062],[0,-.148,.018,.102,.105],[0,-.092,.01,.145,.133],
      [0,-.025,.006,.168,.15],[0,.065,0,.177,.157],[0,.128,-.008,.171,.148],[0,.171,-.018,.137,.124],
    ],20,skin,0,(p,a,row) => {
      if (row <= 3 && Math.cos(a) > 0) p[2] += .007 * Math.cos(a) * (1 - row / 5);
      if (row === 0) p[0] *= .88;
    });
    face.loft([[0,-.248,-.006,.064,.061],[0,-.208,.002,.071,.067],[0,-.157,.008,.077,.071]],12,skin);
    face.loft([[0,-.058,.151,.018,.012],[0,-.039,.161,.021,.022],[0,.003,.157,.014,.013]],10,skinShade);
    face.loft([[0,-.063,.163,.012,.008],[0,-.055,.169,.016,.009]],8,skin);
    face.stroke([-.041,-.097,.149],[-.012,-.101,.158],.0038,.003,0xa96f68,6);
    face.stroke([-.012,-.101,.158],[.034,-.096,.153],.003,.0035,0xa96f68,6);
    face.stroke([-.021,-.111,.151],[.021,-.109,.152],.0025,.002,skinShade,5);
    for (const side of [-1,1]) {
      face.loft([[side*.164,-.07,-.006,.019,.023],[side*.177,-.026,-.004,.029,.038],[side*.169,.035,0,.02,.028]],12,skin);
      face.stroke([side*.174,-.047,.019],[side*.181,-.018,.026],.004,.003,skinShade,5);
      face.stroke([side*.174,-.018,.026],[side*.171,.011,.02],.003,.0025,skinShade,5);
    }
    addSurface(face, Head, materials.skin, 'Face');

    const details = new Surface();
    const eyeParts = [];
    for (const side of [-1,1]) {
      const x = side * .069;
      eyeParts.push(addPart(almondEye(x,.027,.155,.078,.033,skinShade),Head,materials.skin,`EyeSocket.${side}`));
      eyeParts.push(addPart(almondEye(x,.027,.159,.073,.028,0xf5fbff),Head,materials.eyeWhite,`EyeWhite.${side}`));
      eyeParts.push(addPart(radialDisc(x,.027,.162,.035,[0x8ff7ff,0x25c9f5,0xb9ffff,0x46dcff],32,.005,.82),Head,materials.iris,`Iris.${side}`));
      eyeParts.push(addPart(radialDisc(x,.027,.1635,.0105,[0x07192c,0x0a2743],24),Head,materials.pupil,`Pupil.${side}`));
      const glint = new THREE.CircleGeometry(.0058,18);
      glint.translate(x-.008,.038,.165);
      eyeParts.push(addPart(coloredGeometry(glint,0xeaffff),Head,materials.highlight,`Highlight.${side}`));
      const glintSmall = new THREE.CircleGeometry(.0026,14);
      glintSmall.translate(x+.01,.017,.165);
      eyeParts.push(addPart(coloredGeometry(glintSmall,0x9defff),Head,materials.highlight,`HighlightSmall.${side}`));
      details.stroke([x-.067,.031,.163],[x-.027,.055,.165],.0035,.0026,0x52475a,6);
      details.stroke([x-.027,.055,.165],[x+.024,.056,.165],.003,.0026,0x52475a,6);
      details.stroke([x+.024,.056,.165],[x+.067,.033,.163],.0026,.0035,0x52475a,6);
      details.stroke([x-.062,.022,.162],[x,.009,.163],.002,.0018,0xb78278,5);
      details.stroke([x,.009,.163],[x+.062,.023,.162],.0018,.002,0xb78278,5);
      details.stroke([x-.052,.077,.151],[x-.009,.084,.158],.0046,.0036,hairShade,6);
      details.stroke([x-.009,.084,.158],[x+.048,.073,.153],.0036,.0028,hairShade,6);
    }
    details.stroke([0,-.046,.171],[0,-.025,.176],.0018,.0012,skinShade,5);
    addSurface(details,Head,materials.liner,'Eyes_Lips_Detail');

    const hair = new Surface();
    hair.loft([[0,.067,-.025,.15,.135],[0,.12,-.018,.198,.174],[0,.18,-.027,.202,.176],[0,.225,-.037,.167,.146],[0,.246,-.041,.072,.064]],20,hairShade);
    const lock = (base,control,tip,width,depth,tint) => {
      const rising = tip[1] > base[1];
      const lift = rising ? .74 : .84;
      const gather = rising ? .56 : .72;
      const sweptControl = [base[0]+(control[0]-base[0])*gather,base[1]+(control[1]-base[1])*lift,base[2]+(control[2]-base[2])*.8];
      const sweptTip = [base[0]+(tip[0]-base[0])*gather,base[1]+(tip[1]-base[1])*lift,base[2]+(tip[2]-base[2])*.76];
      hair.curveLock(base,sweptControl,sweptTip,width*.66,depth*.7,tint,7,6);
    };
    for (let i=0;i<14;i++) {
      const a=i*TAU/14, s=Math.sin(a), c=Math.cos(a);
      const front=Math.max(0,c);
      lock([.142*s,.145,-.02+.126*c],[.205*s,.235+.045*front,-.025+.175*c],[.245*s-.025,.135+.11*front+.025*Math.sin(i*2.1),-.02+.202*c],.052,.04,i%3===0?hairLight:hairMid);
    }
    for (const [base,control,tip,w,d,tint] of [
      [[-.13,.174,.055],[-.245,.28,.095],[-.31,.205,.075],.073,.052,hairLight],
      [[-.08,.21,.105],[-.18,.345,.145],[-.235,.31,.13],.078,.057,hairMid],
      [[-.015,.224,.118],[-.035,.37,.18],[-.11,.355,.205],.08,.058,hairLight],
      [[.055,.219,.108],[.12,.355,.15],[.055,.382,.12],.076,.055,hairMid],
      [[.118,.196,.063],[.23,.315,.075],[.205,.328,.025],.071,.052,hairLight],
      [[.135,.164,-.035],[.265,.255,-.07],[.282,.224,-.12],.068,.05,hairMid],
      [[-.125,.185,-.07],[-.25,.28,-.12],[-.27,.305,-.19],.071,.053,hairLight],
      [[-.035,.222,-.09],[-.09,.35,-.17],[-.145,.355,-.25],.074,.055,hairMid],
      [[.055,.211,-.103],[.15,.32,-.19],[.19,.29,-.255],.07,.052,hairLight],
      [[-.105,.161,.139],[-.18,.215,.192],[-.225,.092,.183],.059,.041,hairMid],
      [[-.045,.175,.158],[-.072,.22,.207],[-.082,.074,.209],.061,.043,hairLight],
      [[.025,.18,.16],[.055,.245,.216],[.052,.115,.223],.06,.041,hairMid],
      [[.092,.163,.145],[.17,.22,.194],[.205,.079,.186],.057,.04,hairLight],
      [[-.154,.139,.073],[-.213,.17,.12],[-.238,.058,.112],.045,.032,hairMid],
      [[.151,.139,.068],[.218,.174,.105],[.233,.067,.092],.043,.031,hairLight],
    ]) lock(base,control,tip,w,d,tint);
    for (let i=0;i<9;i++) {
      const x=-.13+i*.032;
      lock([x,.205,.128],[x-.035,.31,.175],[x-.06+(i%3)*.018,.112+(i%2)*.026,.216],.03,.022,i%2?hairLight:hairMid);
    }
    addSurface(hair,Head,materials.hair,'Sculpted_Hair');
    return eyeParts;
  }

  function makeBlindfold() {
    const g = new Surface();
    const shape = (p, a) => { p[1] += .014 * Math.cos(a) - .008 * Math.cos(2*a) + .004 * Math.sin(a); };
    g.loft([[0,-.054,.006,.181,.191],[0,-.038,.01,.196,.202],[0,.024,.012,.2,.207],[0,.052,.008,.192,.199]],28,ink,0,shape);
    g.loft([[0,.037,.01,.198,.205],[0,.052,.008,.195,.202]],28,0x343e54,0,shape);
    g.loft([[0,-.052,.006,.183,.193],[0,-.043,.009,.19,.197]],28,0x262f43,0,shape);
    for (let i=0;i<15;i++) {
      const x=-.132+i*.0189;
      g.stroke([x,.043,.207],[x+.009,.043,.207],.0016,.0016,i%3===0?0x71809c:0x4c5972,4);
    }
    for (const side of [-1,1]) {
      g.stroke([side*.181,-.036,.105],[side*.191,.005,.105],.0022,.0022,0x4a566e,5);
      g.stroke([side*.191,.005,.105],[side*.177,.043,.104],.0022,.0022,0x4a566e,5);
    }
    g.loft([[0,.014,-.176,.042,.029],[0,.036,-.184,.056,.038],[0,.058,-.176,.038,.027]],12,0x242d43);
    g.loft([[-.025,.035,-.182,.033,.021],[-.073,-.072,-.178,.032,.018],[-.104,-.184,-.163,.014,.009]],7,0x202940);
    g.loft([[.025,.032,-.182,.034,.022],[.065,-.068,-.18,.031,.017],[.091,-.165,-.166,.013,.008]],7,0x1a2237);
    g.stroke([-.085,-.153,-.166],[-.103,-.181,-.164],.002,.0015,0x59647c,4);
    g.stroke([.075,-.137,-.17],[.09,-.163,-.167],.002,.0015,0x505b73,4);
    addSurface(g, Blindfold, materials.blindfold, 'BlindfoldCloth');
  }

  function makeCoat() {
    const g = new Surface();
    g.loft([[0,-.187,0,.235,.174],[0,.007,0,.194,.147],[0,.144,0,.17,.129],[0,.355,0,.23,.153],[0,.431,-.006,.242,.146],[0,.468,0,.13,.103]],18,indigo,Math.PI/18,(p,a,i) => {
      if (!i) p[1] += .093*Math.pow(Math.max(0,Math.cos(a)),4);
      if (i < 3 || i > 15) p[2] *= .94;
    });
    g.loft([[0,.414,-.004,.153,.119],[0,.592,-.014,.169,.148]],18,fold,0,(p,a,i) => { if(i) p[1]-=.082*Math.pow(Math.max(0,Math.cos(a)),6); });
    g.stroke([-.177,.389,.064],[-.116,.463,.104],.006,.004,0x737ba5,6);
    g.stroke([.177,.389,.064],[.116,.463,.104],.006,.004,0x737ba5,6);
    g.stroke([-.151,.31,.089],[-.128,.061,.111],.003,.003,0x222947,5);
    g.stroke([.151,.31,.089],[.128,.061,.111],.003,.003,0x222947,5);
    for (let i=0;i<18;i++) {
      const a=i*TAU/18, x=.218*Math.sin(a), z=.161*Math.cos(a);
      if (Math.cos(a)>.25) g.stroke([x,-.166,z],[x+.008,-.158,z+.002],.0018,.0018,i%3?0x6f78a1:0x8992b7,4);
    }
    for (const s of [-1,1]) {
      const pts = [[0,.335,-.154],[s*.06,.382,-.151],[s*.115,.354,-.138],[s*.061,.302,-.15],[s*.01,.335,-.154]];
      for(let i=1;i<pts.length;i++) g.stroke(pts[i-1],pts[i],.008,.007,i===2 ? teal : 0x8d96c5,6);
    }
    addSurface(g,Chest,materials.body,'Tailored_Uniform');

    const panels = new Surface();
    panels.loft([[0,.417,-.004,.156,.122],[0,.51,-.011,.169,.143],[0,.582,-.014,.172,.151],[0,.595,-.014,.168,.147]],18,lapel,0,(p,a,i) => { if(i) p[1]-=.082*Math.pow(Math.max(0,Math.cos(a)),6); });
    panels.loft([[0,.585,-.014,.169,.148],[0,.604,-.014,.163,.142]],18,0x656b98,0,(p,a,i) => { if(i) p[1]-=.07*Math.pow(Math.max(0,Math.cos(a)),6); });
    panels.stroke([.086,.468,.117],[-.04,.329,.152],.012,.008,0x9297bd,7);
    panels.stroke([-.04,.329,.152],[-.07,.148,.122],.007,.006,lapel);
    panels.stroke([-.086,.468,.117],[-.137,.365,.112],.004,.003,0x2b3154,5);
    panels.stroke([.086,.468,.117],[.137,.365,.112],.004,.003,0x2b3154,5);
    for (let i=0;i<3;i++) {
      panels.stroke([.012-i*.022,.382-i*.062,.153],[.014-i*.022,.383-i*.062,.161],.010,.009,0xb7b7d6,6);
      panels.stroke([-.012-i*.022,.386-i*.062,.153],[-.010-i*.022,.387-i*.062,.159],.0018,.0018,0x777fa7,4);
    }
    addSurface(panels,Chest,materials.panel,'High_Collar_Lapels');

    const hardware = new Surface();
    for (let i=0;i<4;i++) {
      const y=.286-i*.091, z=.151-Math.abs(y-.14)*.045;
      hardware.loft([[.006,y,z,.008,.004],[.006,y+.004,z+.002,.008,.004]],10,i%2?0xb7bacb:0xd5d7e2);
      hardware.stroke([-.004,y,z+.004],[.016,y,z+.004],.0015,.0015,0x333a57,4);
    }
    addSurface(hardware,Chest,materials.metal,'Uniform_Buttons');
  }

  function makeTail(node, s) {
    const g = new Surface();
    g.loft([[s*.043,-.389,-.069,.091,.045],[s*.034,-.34,-.053,.127,.07],[s*.018,-.114,-.017,.112,.082],[0,.045,0,.089,.073]],12,indigo,.2,(p,_,i) => { if (!i) p[1] += s*p[0]*.52; });
    g.loft([[s*.043,-.389,-.069,.089,.043],[s*.035,-.35,-.056,.12,.066],[s*.02,-.19,-.032,.105,.075]],10,0x3d436f,.25,(p,_,i) => { if (!i) p[1] += s*p[0]*.52; });
    g.stroke([s*.09,-.09,-.07],[s*.142,-.32,-.095],.007,.005,lapel,6);
    g.stroke([s*.13,-.32,-.082],[s*.095,-.373,-.075],.004,.003,0x9298ba,5);
    for (let i=0;i<6;i++) {
      const y=-.351+i*.047, x=s*(.105+i*.004);
      g.stroke([x,y,-.079],[x+s*.012,y+.002,-.08],.0016,.0016,0x7781aa,4);
    }
    addSurface(g, node, materials.panel, `CoatVent.${s}`);
  }

  function makeArm(upper, forearm, hand, s, index = null, indexTip = null, middle = null, middleTip = null, ring = null, ringTip = null, pinky = null, pinkyTip = null, thumb = null, thumbTip = null) {
    const g = new Surface();
    g.loft([[0,-.231,0,.066,.069],[s*.008,-.145,0,.082,.078],[0,-.032,0,.102,.107],[-s*.013,.045,0,.082,.086]],12,indigo);
    g.stroke([s*.059,.023,.064],[s*.078,-.081,.054],.008,.005,lapel,6);
    g.stroke([s*.075,-.112,.056],[s*.063,-.18,.047],.003,.003,0x242a48,5);
    addSurface(g, upper, materials.body, `UpperArm.${s}`);
    const sleeve = new Surface();
    sleeve.loft([[0,-.201,0,.063,.06],[0,-.167,0,.077,.072],[s*.008,-.063,0,.082,.076],[0,.023,0,.067,.066]],12,indigo);
    sleeve.loft([[0,-.207,0,.066,.061],[0,-.183,0,.071,.066]],12,ink);
    sleeve.loft([[0,-.273,.003,.042,.028],[0,-.245,.001,.054,.042],[0,-.194,0,.041,.037]],10,skin);
    sleeve.stroke([-s*.037,-.224,.017],[-s*.057,-.262,.031],.021,.013,skin);
    sleeve.stroke([s*.051,-.171,.039],[s*.06,-.207,.032],.003,.003,0x9ba4c7,5);
    addSurface(sleeve, forearm, materials.body, `Sleeve.${s}`);

    const cuff = new Surface();
    cuff.loft([[0,-.207,0,.068,.063],[0,-.195,0,.071,.066],[0,-.183,0,.071,.066]],12,0x454d77);
    cuff.stroke([s*.045,-.194,.048],[s*.052,-.194,.048],.005,.005,0xc1c5d8,6);
    addSurface(cuff,forearm,materials.panel,`Cuff.${s}`);

    const fingers = new Surface();
    if (s === 1) for (let i=0;i<4;i++) {
      const x=s*(i-1.5)*.021, extended=i<2;
      const end=[x+(extended ? (i===0 ? .017 : -.007) : 0),extended ? -.36+i*.008 : -.284,extended ? .021+i*.012 : .026];
      fingers.stroke([x,-.257,.004],end,.015,.0105,skin,7);
      fingers.stroke([end[0],end[1]+.016,end[2]+.008],[end[0],end[1]+.003,end[2]+.009],.006,.0045,0xe7b7a5,5);
      fingers.stroke([x-.009,-.276,.019],[x+.009,-.276,.019],.0014,.0014,skinShade,4);
    }
    if (s === 1) {
      fingers.stroke([-.034,-.252,.009],[-.062,-.292,.021],.019,.013,skin,7);
      fingers.stroke([-.062,-.292,.021],[-.052,-.318,.03],.013,.009,skin,7);
      fingers.stroke([-.058,-.303,.039],[-.053,-.314,.038],.007,.004,0xe7b7a5,5);
    }
    addSurface(fingers,forearm,materials.skin,`Hand.${s}`);
    if (index && indexTip && middle && middleTip && ring && ringTip && pinky && pinkyTip && thumb && thumbTip) {
      const fingerGeometry = (owner, tipOwner, name, length, bend = 0) => {
        const joint = length * .48;
        const proximal = new Surface();
        proximal.stroke([0,0,0],[0,-joint,bend*.35],.014,.012,skin,7);
        proximal.stroke([-.009,-joint*.46,bend*.36],[.009,-joint*.46,bend*.36],.0014,.0014,skinShade,4);
        addSurface(proximal,owner,materials.skin,name);
        const distal = new Surface();
        distal.stroke([0,0,0],[0,-(length-joint),bend*.65],.012,.009,skin,7);
        distal.stroke([-.006,-(length-joint)*.84,bend*.86],[.008,-(length-joint)*.84,bend*.86],.005,.0035,0xe7b7a5,5);
        addSurface(distal,tipOwner,materials.skin,`${name}Tip`);
      };
      fingerGeometry(index,indexTip,'Index.L',.096,0);
      fingerGeometry(middle,middleTip,'Middle.L',.104,0);
      fingerGeometry(ring,ringTip,'Ring.L',.068,.027);
      fingerGeometry(pinky,pinkyTip,'Pinky.L',.06,.032);
      const thumbGeometry = new Surface();
      thumbGeometry.stroke([0,0,0],[-.022,-.035,.009],.017,.014,skin,7);
      addSurface(thumbGeometry,thumb,materials.skin,'Thumb.L');
      const thumbTipGeometry = new Surface();
      thumbTipGeometry.stroke([0,0,0],[.01,-.034,.015],.014,.010,skin,7);
      thumbTipGeometry.stroke([-.003,-.022,.024],[.013,-.022,.024],.006,.004,0xe7b7a5,5);
      addSurface(thumbTipGeometry,thumbTip,materials.skin,'ThumbTip.L');
    }
    hand.userData.side = s;
  }

  function makeLeg(thigh, shin, foot, s) {
    const g = new Surface();
    g.loft([[0,-.344,.002,.075,.082],[s*.006,-.231,0,.099,.092],[0,-.075,0,.115,.104],[0,.02,0,.097,.092]],12,0x292d49);
    g.stroke([0,-.326,.081],[s*.004,-.055,.103],.003,.0025,0x50567e,5);
    g.stroke([s*.088,-.29,.025],[s*.104,-.062,.03],.003,.003,0x202640,5);
    g.stroke([s*.072,-.318,.055],[s*.088,-.302,.061],.002,.002,0x747a9d,4);
    addSurface(g, thigh, materials.body, `Trousers.${s}`);
    const boot = new Surface();
    boot.loft([[0,-.264,-.011,.055,.069],[0,-.195,0,.085,.084],[0,-.099,0,.091,.082],[0,.023,0,.076,.084]],12,0x21263e);
    boot.loft([[0,-.364,.041,.082,.138],[0,-.34,.043,.085,.142],[0,-.302,.033,.079,.129],[0,-.267,-.012,.068,.082],[0,-.22,-.012,.065,.073]],14,0x191e30);
    boot.loft([[0,-.368,.044,.082,.14],[0,-.347,.044,.085,.143]],14,0x48516a);
    boot.stroke([-.055,-.291,.118],[.055,-.291,.118],.004,.004,0x596178,6);
    boot.stroke([-.059,-.322,.127],[.059,-.322,.127],.003,.003,0x3c455e,6);
    for (let i=0;i<5;i++) {
      const y=-.238-i*.021, z=.083+i*.007;
      boot.stroke([-.036,y,z],[.036,y+.006,z+.002],.003,.003,0x727b94,5);
      boot.stroke([-.036,y-.006,z],[.036,y,z+.002],.003,.003,0x545e7b,5);
    }
    boot.stroke([s*.077,-.224,.024],[s*.083,-.306,.055],.003,.003,0x7c849e,5);
    addSurface(boot, shin, materials.boot, `Shin_Boot.${s}`);
    const hardware = new Surface();
    hardware.stroke([s*.084,-.222,.025],[s*.088,-.239,.03],.004,.004,0xbac0d2,5);
    hardware.loft([[s*.088,-.24,.031,.006,.003],[s*.088,-.255,.034,.006,.003]],6,0xc5cad9);
    addSurface(hardware,shin,materials.metal,`Boot_Zip.${s}`);
    foot.userData.side = s;
  }

  function makeSeal() {
    const base = new Surface();
    const glow = new Surface();
    for (let arc=0;arc<2;arc++) for (let i=0;i<11;i++) {
      if (i===4 || i===5) continue;
      const p = (j) => { const v=arc*Math.PI+j*.255; return [.072*Math.cos(v),.026*Math.sin(v),.067*Math.sin(v)]; };
      base.stroke(p(i),p(i+1),.008,.0065,0x17233c,5);
      glow.stroke(p(i),p(i+1),.0055,.0045,arc ? teal : 0xc8fbff,5);
    }
    for (let i=0;i<6;i++) {
      const a=i*TAU/6, b=a+.22;
      glow.stroke([Math.cos(a)*.018,Math.sin(a)*.018,.074],[Math.cos(b)*.044,Math.sin(b)*.044,.074],.004,.0015,i%2?0x78eaff:0xd8ffff,4);
    }
    glow.loft([[0,-.092,0,.002,.002],[0,-.069,0,.013,.009],[0,-.048,0,.002,.002]],6,0xc8ffff);
    base.loft([[0,-.094,-.002,.003,.003],[0,-.069,-.002,.016,.012],[0,-.047,-.002,.003,.003]],6,0x101a2c);
    addSurface(base,seal,materials.liner,'FingerSealBase');
    addSurface(glow, seal, materials.seal, 'FingerSealGlow');
  }

  const eyeParts = makeHead();
  makeBlindfold();
  makeCoat();
  makeTail(ventL,-1); makeTail(ventR,1);
  makeArm(upperL,forearmL,handL,-1,indexL,indexTipL,middleL,middleTipL,ringL,ringTipL,pinkyL,pinkyTipL,thumbL,thumbTipL); makeArm(upperR,forearmR,handR,1);
  makeLeg(thighL,shinL,footL,-1); makeLeg(thighR,shinR,footR,1);
  makeSeal();

  const rest = bones.map((node) => ({ position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone() }));
  const restPose = () => {
    bones.forEach((node, index) => {
      node.position.copy(rest[index].position);
      node.quaternion.copy(rest[index].quaternion);
      node.scale.copy(rest[index].scale);
    });
    root.updateMatrixWorld(true);
  };
  restPose();
  const groundSamples = parts.map((part) => {
    const positions = part.geometry.attributes.position;
    const points = Array.from({ length: positions.count }, (_, index) => new THREE.Vector3().fromBufferAttribute(positions, index));
    return { owner: part.owner, points };
  });

  const materialGroups = new Map();
  for (const part of parts) {
    part.geometry.applyMatrix4(part.owner.matrixWorld);
    const index = part.owner.userData.boneIndex;
    const count = part.geometry.attributes.position.count;
    const skinIndices = new Uint16Array(count * 4);
    const skinWeights = new Float32Array(count * 4);
    for (let i=0;i<count;i++) { skinIndices[i*4] = index; skinWeights[i*4] = 1; }
    part.geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndices, 4));
    part.geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeights, 4));
    const key = part.material.uuid;
    if (!materialGroups.has(key)) materialGroups.set(key, { material: part.material, geometries: [], names: [] });
    const group = materialGroups.get(key);
    group.geometries.push(part.geometry);
    group.names.push(part.name);
  }
  const skeleton = new THREE.Skeleton(bones);
  const meshes = [];
  const meshNames = new Map([
    [materials.body,'Gojo_Body'],[materials.panel,'Gojo_Coat_Panels'],[materials.skin,'Gojo_Skin'],
    [materials.hair,'Gojo_Sculpted_Hair'],[materials.blindfold,'BlindfoldCloth'],[materials.eyeWhite,'EyeWhite'],
    [materials.iris,'Iris'],[materials.pupil,'Pupil'],[materials.highlight,'Highlight'],[materials.seal,'FingerSealGlow'],
    [materials.boot,'Gojo_Boot_Leather'],[materials.metal,'Gojo_Hardware'],[materials.liner,'Gojo_Face_Details'],
  ]);
  for (const group of materialGroups.values()) {
    const geometry = mergeGeometries(group.geometries, false);
    if (!geometry) throw new Error(`Failed to merge ${group.names.join(', ')}`);
    geometry.computeBoundingSphere();
    const mesh = new THREE.SkinnedMesh(geometry, group.material);
    mesh.name = meshNames.get(group.material) ?? group.material.name;
    mesh.userData.partNames = group.names;
    root.add(mesh);
    mesh.bind(skeleton);
    meshes.push(mesh);
    group.geometries.forEach((item) => item.dispose());
  }
  root.scale.setScalar(1.055);

  function groundPose() {
    root.updateMatrixWorld(true);
    let lowest = Infinity;
    const point = new THREE.Vector3();
    for (const sample of groundSamples) for (const local of sample.points) {
      point.copy(local).applyMatrix4(sample.owner.matrixWorld);
      lowest = Math.min(lowest, point.y);
    }
    Root.position.y += (.0002-lowest)/root.scale.y;
    root.updateMatrixWorld(true);
  }

  function resetPose() {
    restPose();
    Pelvis.rotation.set(0,0,0);
    Chest.rotation.set(.015,-.065,.018);
    Head.rotation.set(-.045,.085,-.055);
    upperL.rotation.set(.11,0,-.17); forearmL.rotation.set(-.54,0,.11);
    upperR.rotation.set(-.37,-.17,.29); forearmR.rotation.set(-1.63,.06,-.19);
    thighL.rotation.set(-.045,.045,-.065); shinL.rotation.set(.072,0,0);
    thighR.rotation.set(.038,-.04,.085); shinR.rotation.set(.035,0,0);
    ventL.rotation.set(.045,0,-.025); ventR.rotation.set(.08,0,.045);
    seal.rotation.set(0,0,0); seal.scale.setScalar(1);
    root.updateMatrixWorld(true);
    groundPose();
  }

  function idle(t, phase=0) {
    resetPose();
    const breath=Math.sin(t*1.8+phase), sway=Math.sin(t*.87+phase);
    Pelvis.position.y += .009*breath; Chest.rotation.z += sway*.022;
    Head.rotation.y += sway*.15; Head.rotation.x += breath*.025;
    forearmR.rotation.x -= breath*.09; ventL.rotation.x += sway*.045;
    seal.rotation.y = t*1.35+phase; seal.scale.setScalar(.93+breath*.09);
  }

  function walk(t, intensity=1) {
    resetPose();
    const k=clamp(intensity), w=t*8.3, stride=Math.sin(w)*k;
    Pelvis.position.y += (.022*Math.abs(stride)-.022*k); Chest.rotation.x += .085*k; Chest.rotation.y += stride*.15;
    thighL.rotation.x -= stride*.58; thighR.rotation.x += stride*.58;
    shinL.rotation.x += .58*k*Math.max(0,Math.cos(w)); shinR.rotation.x += .58*k*Math.max(0,-Math.cos(w));
    upperL.rotation.x += stride*.44; upperR.rotation.x -= stride*.21; forearmR.rotation.x += .38*k;
    ventL.rotation.x += .18*k+.12*stride; ventR.rotation.x += .18*k-.12*stride;
    Head.rotation.y -= stride*.08; seal.rotation.y=t*1.6;
  }

  function attackSwing(t) {
    resetPose(); t=clamp(t);
    const wind=ease(t/.33)*(1-ease((t-.33)/.16)), snap=ease((t-.31)/.16)*(1-ease((t-.62)/.38));
    Chest.rotation.y += -.57*wind+.66*snap; Chest.rotation.x += -.12*wind+.2*snap;
    upperR.rotation.x += -.58*wind-1.12*snap; upperR.rotation.z += .3*wind-.22*snap;
    forearmR.rotation.x += -.48*wind+1.49*snap; upperL.rotation.x += .32*snap;
    Head.rotation.y += .30*wind-.50*snap; Pelvis.position.z += .085*snap;
    ventL.rotation.x += .37*snap; ventR.rotation.z += .16*snap;
    seal.scale.setScalar(1+.26*wind+.72*snap); seal.rotation.y=TAU*ease(t);
  }

  function flinch(t) {
    resetPose(); const k=ease(t/.2)*(1-ease((t-.2)/.8));
    Pelvis.position.y -= .05*k; Chest.rotation.set(-.34*k,.43*k,.16*k);
    Head.rotation.x -= .23*k; upperL.rotation.x -= .66*k; upperR.rotation.z += .52*k;
    shinL.rotation.x += .35*k; ventL.rotation.x -= .18*k; seal.scale.setScalar(1-.45*k);
  }

  function cast(t) {
    resetPose(); const wave=Math.sin(t*2.5);
    Chest.rotation.y=-.38; Head.rotation.y=.34; upperR.rotation.set(-1.05,-.2,.42);
    forearmR.rotation.set(-1.68+.07*wave,.02,-.27); upperL.rotation.set(-.55,.1,-.58);
    forearmL.rotation.x=-1.1; seal.rotation.y=t*3; seal.scale.setScalar(1.29+.13*wave);
    ventR.rotation.x += .12+.06*wave;
  }

  function drink(t) {
    resetPose(); const k=ease(t*2.6); upperR.rotation.x-=.63*k; upperR.rotation.z-=.22*k;
    forearmR.rotation.x-=.72*k; Head.rotation.x-=.24*k; seal.scale.setScalar(1-.8*k);
  }

  function crouch(t) {
    resetPose(); const k=ease(t*2.7); Pelvis.position.y-=.214*k;
    thighL.rotation.x-=.91*k; thighR.rotation.x-=.99*k;
    shinL.rotation.x+=1.64*k; shinR.rotation.x+=1.74*k;
    Chest.rotation.x+=.45*k; Head.rotation.x-=.29*k; upperL.rotation.x-=.71*k;
    ventL.rotation.x+=.65*k; ventR.rotation.x+=.7*k;
  }

  function cheer(t) {
    resetPose(); const lift=.5+.5*Math.sin(t*4.3); Pelvis.position.y+=lift*.045;
    upperR.rotation.set(-2.45-lift*.16,0,.53); forearmR.rotation.x=-.38; Head.rotation.x-=.18;
    upperL.rotation.set(-.6,0,-.35); forearmL.rotation.x=-1.7; seal.rotation.y=t*3.1;
  }

  function dead(t) {
    resetPose(); const k=ease(clamp(t)), buckle=Math.sin(Math.PI*k);
    Pelvis.rotation.x=-1.53*k; Pelvis.rotation.z=-.13*k; Pelvis.position.y-=.488*k+.105*buckle;
    Pelvis.position.z-=.16*k; Chest.rotation.x+=.19*buckle; Head.rotation.y+=.49*k;
    thighL.rotation.x-=.52*buckle+.1*k; shinL.rotation.x+=.99*buckle+.18*k;
    thighR.rotation.z+=.17*k; shinR.rotation.x+=.39*buckle;
    upperL.rotation.z-=.64*k; upperR.rotation.z+=.69*k; forearmR.rotation.x+=1.34*k;
    seal.scale.setScalar(1-.995*k);
  }

  function reviveRise(t) {
    t=clamp(t); dead(1-t);
    const sweep=Math.sin(Math.PI*t); forearmR.rotation.x-=.54*sweep; Chest.rotation.y+=.31*sweep;
    ventL.rotation.x+=.24*sweep; seal.rotation.y=TAU*ease(t);
  }

  function solveLeftArm(target) {
    const shoulder = upperL.position.clone();
    const direction = target.clone().sub(shoulder);
    const distance = Math.min(.4749, Math.max(.001, direction.length()));
    direction.normalize();
    const pole = V(-.42,.12,.34);
    const bend = pole.sub(direction.clone().multiplyScalar(pole.dot(direction))).normalize();
    const along = (.205*.205-.27*.27+distance*distance)/(2*distance);
    const height = Math.sqrt(Math.max(0,.205*.205-along*along));
    const elbow = shoulder.clone().addScaledVector(direction,along).addScaledVector(bend,height);
    const end = shoulder.clone().addScaledVector(direction,distance);
    const down = V(0,-1,0);
    upperL.quaternion.setFromUnitVectors(down,elbow.clone().sub(shoulder).normalize());
    const lowerDirection = end.clone().sub(elbow).normalize();
    const upperWorld = upperL.quaternion.clone();
    forearmL.quaternion.copy(upperWorld.invert().multiply(new THREE.Quaternion().setFromUnitVectors(down,lowerDirection)));
    const armWorld = upperL.quaternion.clone().multiply(forearmL.quaternion);
    handL.quaternion.copy(armWorld.invert()).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-.2,.1,-.3)));
  }

  function domainPose(t, held=false) {
    resetPose();
    const wave = Math.sin(t*1.7);
    Chest.rotation.x += .035+.006*wave; Head.rotation.x += .075; Head.rotation.y -= .06;
    upperR.rotation.set(-.82,-.28,.44); forearmR.rotation.set(-1.82+.035*wave,.08,-.28);
    handR.rotation.set(-.12,.08,-.12); seal.scale.setScalar(1.12+.05*wave); seal.rotation.y=t*.65;
    const heldTarget = V(-.235,.385,.325);
    const target = held ? heldTarget : V(-.30,.19,.08).lerp(heldTarget,ease(t/.9));
    solveLeftArm(target);
    const sealPose = held ? 1 : ease((t-.12)/.88);
    const ringCurl = held ? 1 : easeOutBack((t-.28)/.55);
    const pinkyCurl = held ? 1 : easeOutBack((t-.38)/.52);
    const thumbCurl = held ? 1 : easeOutBack((t-.5)/.5);
    const gestureTime = held ? t : Math.max(0,t-1.4);
    const living = Math.sin(gestureTime*2.3);
    const settle = Math.sin(gestureTime*5.1)*Math.exp(-gestureTime*.9);
    indexL.rotation.set(0,0,-.035*sealPose+.012*living);
    indexTipL.rotation.set(-.035*sealPose+.015*living,0,0);
    middleL.rotation.set(0,0,-.025*sealPose-.008*living);
    middleTipL.rotation.set(-.03*sealPose+.012*living,0,0);
    ringL.rotation.set(-1.02*ringCurl,.08*ringCurl,-.13*ringCurl);
    ringTipL.rotation.set(-.72*ringCurl,0,0);
    pinkyL.rotation.set(-1.08*pinkyCurl,.1*pinkyCurl,-.16*pinkyCurl);
    pinkyTipL.rotation.set(-.78*pinkyCurl,0,0);
    thumbL.rotation.set(.1*thumbCurl,.42*thumbCurl,-.26*thumbCurl);
    thumbTipL.rotation.set(-.42*thumbCurl,0,-.08*thumbCurl);
    const relaxedWorld = handL.getWorldQuaternion(new THREE.Quaternion());
    const sealWorld = Chest.getWorldQuaternion(new THREE.Quaternion()).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(.06+.02*living,-.1+.025*living,Math.PI-.18+.05*settle)));
    const parentWorld = forearmL.getWorldQuaternion(new THREE.Quaternion());
    handL.quaternion.copy(parentWorld.invert().multiply(relaxedWorld.slerp(sealWorld,sealPose)));
    root.updateMatrixWorld(true);
  }

  resetPose();
  const track = (node, property, times, values) => {
    const Track = property === 'quaternion' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
    return new Track(`${node.name}.${property}`, times, values);
  };
  const capture = (name, duration, fps, pose) => {
    const count = Math.ceil(duration*fps);
    const times = Array.from({length:count+1},(_,index)=>index===count ? duration : index/fps);
    const samples = times.map((time) => {
      pose(time);
      groundPose();
      return bones.map((node) => ({
        position: node.position.toArray(),
        quaternion: node.quaternion.toArray(),
        scale: node.scale.toArray(),
      }));
    });
    const tracks = [];
    for (const [nodeIndex, node] of bones.entries()) {
      const positions = samples.flatMap((sample) => sample[nodeIndex].position);
      const quaternions = samples.flatMap((sample) => sample[nodeIndex].quaternion);
      const scales = samples.flatMap((sample) => sample[nodeIndex].scale);
      const varies = (values,size) => values.some((value,index) => Math.abs(value-values[index%size]) > 1e-6);
      const differsFromRest = (values,size,property) => values.some((value,index) => Math.abs(value-rest[nodeIndex][property].toArray()[index%size]) > 1e-6);
      if (varies(positions,3) || differsFromRest(positions,3,'position')) tracks.push(track(node,'position',times,positions));
      if (varies(quaternions,4) || differsFromRest(quaternions,4,'quaternion')) tracks.push(track(node,'quaternion',times,quaternions));
      if (varies(scales,3) || differsFromRest(scales,3,'scale')) tracks.push(track(node,'scale',times,scales));
    }
    return new THREE.AnimationClip(name,duration,tracks);
  };
  const clips = [
    capture('idle',4,24,(t)=>idle(t,0)),
    capture('walk',1,24,(t)=>walk(t,1)),
    capture('attack',1.15,30,(t)=>attackSwing(t/1.15)),
    capture('flinch',.85,30,(t)=>flinch(t/.85)),
    capture('cast',4,24,(t)=>cast(t)),
    capture('drink',2.6,24,(t)=>drink(t/2.6)),
    capture('crouch',2.7,24,(t)=>crouch(t/2.7)),
    capture('cheer',2.8,24,(t)=>cheer(t)),
    capture('dead',1.2,30,(t)=>dead(t/1.2)),
    capture('reviveRise',1.2,30,(t)=>reviveRise(t/1.2)),
    capture('domain_expand',2.4,30,(t)=>domainPose(t,false)),
    capture('domain_idle',4,24,(t)=>domainPose(t,true)),
  ];
  resetPose();

  const stats = (() => {
    let triangles=0, vertices=0;
    for (const mesh of meshes) {
      const count = mesh.geometry.attributes.position.count;
      vertices += count; triangles += mesh.geometry.index ? mesh.geometry.index.count/3 : count/3;
    }
    const bounds = new THREE.Box3().setFromObject(root,true);
    return { triangles, vertices, bones:bones.length, meshes:meshes.length, materials:meshes.length, textures:3, height:bounds.max.y, width:bounds.max.x-bounds.min.x, depth:bounds.max.z-bounds.min.z };
  })();

  return {
    root, bones, meshes, materials, clips, stats, eyeParts, Blindfold, Head, Chest, handL, indexL, indexTipL, middleL, middleTipL, ringL, ringTipL, pinkyL, pinkyTipL, thumbL, thumbTipL, eyesSocket, gripSocket, domainSocket,
    resetPose, idle, walk, attackSwing, flinch, cast, drink, crouch, cheer, dead, reviveRise, domainPose,
    setOpacity(value) { for (const material of Object.values(materials)) { material.transparent=value<1; material.opacity=value; } },
  };
}
