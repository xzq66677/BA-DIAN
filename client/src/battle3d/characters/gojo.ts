import * as THREE from 'three';

type Point = [number, number, number];
// Each elliptical section: center xyz, then x/z radii. Listed bottom to top.
type Ring = [number, number, number, number, number];
const TAU = Math.PI * 2;
const clamp = (t: number) => Math.max(0, Math.min(1, t));
const ease = (t: number) => { t = clamp(t); return t * t * (3 - 2 * t); };
const ink = 0x1b213c, indigo = 0x353766, lapel = 0x545484, fold = 0x282942;
const skin = 0xf2c4ac, silver = 0xf5f7ff, ice = 0xb2c9e0, teal = 0x66e5ef;

/** Bake the pieces on a single joint into one flat-shaded, vertex-colored mesh. */
class Surface {
  private vertices: number[] = [];
  private colors: number[] = [];
  private color = new THREE.Color();

  tri(a: Point, b: Point, c: Point, tint: number) {
    this.vertices.push(...a, ...b, ...c);
    const { r, g, b: blue } = this.color.setHex(tint);
    for (let i = 0; i < 3; i++) this.colors.push(r, g, blue);
  }

  loft(sections: Ring[], sides: number, tint: number, phase = Math.PI / sides,
    shape?: (p: Point, angle: number, row: number) => void) {
    const rows = sections.map(([x, y, z, rx, rz], row) => Array.from({ length: sides }, (_, i) => {
      const a = i * TAU / sides + phase;
      const p: Point = [x + rx * Math.sin(a), y, z + rz * Math.cos(a)];
      shape?.(p, a, row);
      return p;
    }));
    for (let k = 1; k < rows.length; k++) for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides, lo = rows[k - 1], hi = rows[k];
      this.tri(lo[i], lo[j], hi[i], tint);
      this.tri(lo[j], hi[j], hi[i], tint);
    }
    for (const k of [0, rows.length - 1]) {
      const [x, y, z] = sections[k];
      for (let i = 0; i < sides; i++) {
        const a = rows[k][i], b = rows[k][(i + 1) % sides];
        this.tri([x, y, z], k ? a : b, k ? b : a, tint);
      }
    }
  }

  // Closed tapered tube, including for diagonal seam piping and bent fingers.
  stroke(from: Point, to: Point, radius: number, endRadius: number, tint: number, n = 6) {
    const axis = new THREE.Vector3(...to).sub(new THREE.Vector3(...from)).normalize();
    const u = new THREE.Vector3().crossVectors(axis, Math.abs(axis.y) > .85 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0)).normalize();
    const v = new THREE.Vector3().crossVectors(axis, u);
    const section = (center: Point, r: number) => Array.from({ length: n }, (_, i): Point => {
      const a = i * TAU / n, x = r * Math.cos(a), y = r * Math.sin(a);
      return [center[0] + u.x * x + v.x * y, center[1] + u.y * x + v.y * y, center[2] + u.z * x + v.z * y];
    });
    const lo = section(from, radius), hi = section(to, endRadius);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.tri(lo[i], lo[j], hi[i], tint); this.tri(lo[j], hi[j], hi[i], tint);
      this.tri(from, lo[j], lo[i], tint); this.tri(to, hi[i], hi[j], tint);
    }
  }

  mesh(parent: THREE.Group, mat: THREE.MeshStandardMaterial) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.vertices, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geo.computeVertexNormals();
    parent.add(new THREE.Mesh(geo, mat));
  }
}

function joint(parent: THREE.Group, name: string, x = 0, y = 0, z = 0) {
  const node = new THREE.Group(); node.name = name; node.position.set(x, y, z); parent.add(node); return node;
}

function makeHead(head: THREE.Group, material: THREE.MeshStandardMaterial) {
  const g = new Surface();
  g.loft([[0,-.176,.035,.068,.07],[0,-.12,.025,.132,.13],[0,-.035,.008,.17,.15],[0,.095,0,.181,.157],[0,.16,-.008,.15,.13]], 14, skin);
  // Nose, mouth and ears sit outside the band silhouette, even in profile.
  g.loft([[0,-.051,.148,.027,.018],[0,-.029,.15,.026,.038],[0,.01,.15,.012,.014]], 6, 0xe2ac95);
  g.stroke([-.047,-.09,.153],[.032,-.087,.157],.006,.004,0x9c645e);
  for (const side of [-1,1]) g.loft([[side*.169,-.063,-.003,.021,.023],[side*.177,-.018,-.006,.027,.037],[side*.17,.022,0,.018,.026]], 8, skin);
  const bandShape = (p: Point, a: number) => { p[1] += .021 * Math.cos(a) - .012 * Math.cos(2*a) + .012 * Math.sin(a); };
  g.loft([[0,-.015,0,.183,.163],[0,.011,0,.192,.174],[0,.078,0,.19,.171],[0,.092,0,.184,.165]], 18, 0x151a2b, 0, bandShape);
  g.loft([[0,.064,0,.191,.172],[0,.077,0,.192,.173]],18,0x394356,0,bandShape);
  // A dark undercut and a silver cap connect the overlapping swept locks.
  g.loft([[0,.06,-.017,.154,.14],[-.008,.127,-.014,.204,.182],[-.015,.20,-.024,.18,.155],[-.026,.248,-.035,.12,.111]],14,ice);
  g.loft([[-.01,.112,-.025,.178,.158],[-.023,.177,-.023,.206,.172],[-.028,.224,-.022,.176,.146],[-.044,.274,-.025,.091,.092]],14,silver);
  function lock(base: Point, tip: Point, w: number, d: number, tint: number, twist: number) {
    const [x,y,z] = base, [ex,ey,ez] = tip;
    const bendX = x + (ex-x)*.34, bendZ = z + (ez-z)*.3;
    // Each lock is a sculpted blade with a ridge, not a radial cone.
    const blade: Ring[] = [[x,y,z,w,d],[bendX,y+(ey-y)*.54,bendZ,w*.75,d*.66],[ex,ey,ez,.0015,.0015]];
    if (ey < y) blade.reverse();
    g.loft(blade, 5, tint, twist);
  }
  for (let i = 0; i < 10; i++) {
    const a = i*TAU/10, s = Math.sin(a), c = Math.cos(a);
    // Back and temples feather outward; leave most of the blindfold visible in front.
    lock([.14*s,.153,-.017+.124*c],[.232*s-.038,.071-.071*Math.max(0,-c)+.024*Math.sin(3*a),-.024+.188*c],.062,.047,i%3 ? 0xdde8f6 : ice,a);
  }
  for (const [x,y,z,ex,ey,ez,w,d,tint] of [
    [-.135,.155,.048,-.282,.239,.075,.096,.064,0xeaf2ff],[-.125,.178,-.039,-.267,.302,-.095,.091,.071,0xcddceb],
    [-.071,.201,-.085,-.164,.367,-.173,.102,.076,0xeaf0fd],[.034,.192,-.103,.08,.302,-.228,.091,.07,0xd5e2f2],
    [.112,.168,-.066,.214,.282,-.145,.096,.061,0xe8f1ff],[.143,.174,.034,.229,.292,.044,.086,.064,0xdce9fa],
    [.084,.191,.077,.147,.343,.115,.096,.068,0xf6f8ff],[-.029,.194,.092,-.121,.316,.177,.106,.068,0xffffff],
    [-.034,.215,-.028,-.112,.412,-.06,.111,.086,0xf7faff],[.043,.207,-.018,.041,.369,-.089,.097,.07,0xe4edf8],
    [-.079,.161,.13,-.203,.044,.169,.068,.048,0xf3f6ff],[.096,.151,.124,.14,.078,.164,.057,.043,0xebf2fa],
  ]) lock([x,y,z],[ex,ey,ez],w,d,tint,.4);
  g.mesh(head,material);
}

function makeCoat(body: THREE.Group, material: THREE.MeshStandardMaterial) {
  const g = new Surface();
  // Flared coat, narrower waist and raglan shoulders; a high split stand collar.
  g.loft([[0,-.187,0,.235,.174],[0,.007,0,.194,.147],[0,.144,0,.17,.129],[0,.355,0,.23,.153],[0,.431,-.006,.242,.146],[0,.468,0,.13,.103]],14,indigo,
    Math.PI/14,(p,a,i) => { if (!i) p[1] += .093*Math.pow(Math.max(0,Math.cos(a)),4); });
  const notch = (p: Point,a: number,i: number) => { if(i) p[1] -= .082*Math.pow(Math.max(0,Math.cos(a)),6); };
  g.loft([[0,.417,-.004,.153,.119],[0,.59,-.014,.168,.147]],14,fold,0,notch);
  g.loft([[0,.417,-.004,.154,.12],[0,.582,-.014,.171,.15],[0,.595,-.014,.168,.147]],14,lapel,0,notch);
  g.stroke([.084,.468,.116],[-.04,.329,.151],.014,.01,0x8184ac);
  g.stroke([-.04,.329,.151],[-.07,.148,.12],.01,.008,lapel);
  for (let i=0;i<3;i++) g.stroke([.013-i*.022,.382-i*.062,.152],[.015-i*.022,.383-i*.062,.161],.012,.011,0xb7b7d6);
  // A broken infinity stitch on the back remains legible when facing away.
  for (const s of [-1,1]) {
    const pts: Point[] = [[0,.335,-.154],[s*.06,.382,-.151],[s*.115,.354,-.138],[s*.061,.302,-.15],[s*.01,.335,-.154]];
    for(let i=1;i<pts.length;i++) g.stroke(pts[i-1],pts[i],.009,.009,i===2 ? teal : 0x8d96c5);
  }
  g.mesh(body,material);
}

function makeTail(node: THREE.Group, s: number, material: THREE.MeshStandardMaterial) {
  const g = new Surface();
  g.loft([[s*.043,-.389,-.069,.091,.045],[s*.034,-.34,-.053,.127,.07],[s*.018,-.114,-.017,.112,.082],[0,.045,0,.089,.073]],8,indigo,.2,
    (p,_,i) => { if (!i) p[1] += s*p[0]*.52; });
  g.stroke([s*.09,-.09,-.07],[s*.142,-.32,-.095],.009,.006,lapel);
  g.mesh(node,material);
}

function makeArm(body: THREE.Group, s: number, mat: THREE.MeshStandardMaterial) {
  const upper = joint(body,'shoulder',s*.222,.401,0), elbow = joint(upper,'elbow',0,-.205,0);
  const g = new Surface();
  g.loft([[0,-.231,0,.066,.069],[s*.008,-.145,0,.082,.078],[0,-.032,0,.102,.107],[-s*.013,.045,0,.082,.086]],9,indigo);
  g.stroke([s*.059,.023,.064],[s*.078,-.081,.054],.011,.006,lapel);
  g.mesh(upper,mat);
  const sleeve = new Surface();
  sleeve.loft([[0,-.201,0,.063,.06],[0,-.167,0,.077,.072],[s*.008,-.063,0,.082,.076],[0,.023,0,.067,.066]],9,indigo);
  sleeve.loft([[0,-.207,0,.066,.061],[0,-.183,0,.071,.066]],9,ink);
  sleeve.loft([[0,-.273,.003,.042,.028],[0,-.245,.001,.054,.042],[0,-.194,0,.041,.037]],8,skin);
  sleeve.stroke([-s*.037,-.224,.017],[-s*.057,-.262,.031],.024,.014,skin);
  for (let i=0;i<4;i++) {
    const x = s*(i-1.5)*.021, extended = s===1 && i<2;
    const end: Point = [x+(extended ? (i===0 ? .017 : -.007) : 0),extended ? -.36+i*.008 : -.284,extended ? .021+i*.012 : .026];
    sleeve.stroke([x,-.257,.004],end,.016,.011,skin);
  }
  sleeve.mesh(elbow,mat);
  return { upper,elbow };
}

function makeLeg(pelvis: THREE.Group, s: number, mat: THREE.MeshStandardMaterial) {
  const thigh = joint(pelvis,'thigh',s*.104,0,0), knee = joint(thigh,'knee',0,-.32,0);
  const g = new Surface();
  g.loft([[0,-.344,.002,.075,.082],[s*.006,-.231,0,.099,.092],[0,-.075,0,.115,.104],[0,.02,0,.097,.092]],9,0x292d49);
  g.mesh(thigh,mat);
  const boot = new Surface();
  boot.loft([[0,-.264,-.011,.055,.069],[0,-.195,0,.085,.084],[0,-.099,0,.091,.082],[0,.023,0,.076,.084]],9,0x21263e);
  boot.loft([[0,-.364,.041,.082,.138],[0,-.34,.043,.085,.142],[0,-.302,.033,.079,.129],[0,-.267,-.012,.068,.082],[0,-.22,-.012,.065,.073]],10,0x191e30);
  boot.loft([[0,-.368,.044,.082,.14],[0,-.347,.044,.085,.143]],10,0x48516a);
  boot.mesh(knee,mat);
  return { thigh,knee };
}

/** Authored in +Z facing coordinates. Only root transforms belong to the entity. */
export function createGojoRig(scale: number) {
  const root = new THREE.Group(); root.name = 'gojo';
  const solid = new THREE.MeshStandardMaterial({ vertexColors:true, roughness:.78, metalness:.04 });
  const charged = new THREE.MeshStandardMaterial({ vertexColors:true, roughness:.32, emissive:0x14758b, emissiveIntensity:.65 });
  const mats = [solid,charged];
  const hipY = .688;
  const pelvis = joint(root,'pelvis',0,hipY,0), body = joint(pelvis,'coat'), head = joint(body,'head',0,.696,0);
  makeCoat(body,solid); makeHead(head,solid);
  const leftTail = joint(body,'coat vent L',-.102,-.06,-.062), rightTail = joint(body,'coat vent R',.102,-.06,-.062);
  makeTail(leftTail,-1,solid); makeTail(rightTail,1,solid);
  const l = makeArm(body,-1,solid), r = makeArm(body,1,solid);
  const a = makeLeg(pelvis,-1,solid), b = makeLeg(pelvis,1,solid);
  const mark = joint(r.elbow,'finger seal',-.01,-.345,.026);
  const glow = new Surface();
  // Two interrupted counter-arcs and a tiny suspended cut crystal, all one mesh.
  for (let arc=0;arc<2;arc++) for (let i=0;i<9;i++) {
    const p = (j: number): Point => { const v=arc*Math.PI+j*.273; return [.08*Math.cos(v),.019*Math.sin(v),.063*Math.sin(v)]; };
    glow.stroke(p(i),p(i+1),.009,.0075,arc ? teal : 0xaefbff,5);
  }
  glow.loft([[0,-.091,0,.002,.002],[0,-.064,0,.019,.017],[0,-.039,0,.002,.002]],5,0xc8ffff);
  glow.mesh(mark,charged);

  function resetPose() {
    pelvis.position.set(0,hipY,0); pelvis.rotation.set(0,0,0);
    body.rotation.set(.015,-.065,.018); head.rotation.set(-.045,.085,-.055);
    l.upper.rotation.set(.11,0,-.17); l.elbow.rotation.set(-.54,0,.11);
    r.upper.rotation.set(-.37,-.17,.29); r.elbow.rotation.set(-1.63,.06,-.19);
    a.thigh.rotation.set(-.045,.045,-.065); a.knee.rotation.set(.072,0,0);
    b.thigh.rotation.set(.038,-.04,.085); b.knee.rotation.set(.035,0,0);
    leftTail.rotation.set(.045,0,-.025); rightTail.rotation.set(.08,0,.045);
    mark.rotation.set(0,0,0); mark.scale.setScalar(1);
  }
  resetPose();
  const standingHeight = new THREE.Box3().setFromObject(root,true).max.y;
  root.scale.setScalar(scale);

  function idle(t: number, phase=0) {
    resetPose(); const breath=Math.sin(t*1.8+phase), sway=Math.sin(t*.87+phase);
    pelvis.position.y += .009*breath; body.rotation.z += sway*.022;
    head.rotation.y += sway*.15; head.rotation.x += breath*.025;
    r.elbow.rotation.x -= breath*.09; leftTail.rotation.x += sway*.045;
    mark.rotation.y = t*1.35+phase; mark.scale.setScalar(.93+breath*.09);
  }
  function walk(t: number, intensity=1) {
    resetPose(); const k=clamp(intensity), w=t*8.3, stride=Math.sin(w)*k;
    pelvis.position.y += (.022*Math.abs(stride)-.022*k); body.rotation.x += .085*k; body.rotation.y += stride*.15;
    a.thigh.rotation.x -= stride*.58; b.thigh.rotation.x += stride*.58;
    a.knee.rotation.x += .58*k*Math.max(0,Math.cos(w)); b.knee.rotation.x += .58*k*Math.max(0,-Math.cos(w));
    l.upper.rotation.x += stride*.44; r.upper.rotation.x -= stride*.21; r.elbow.rotation.x += .38*k;
    leftTail.rotation.x += .18*k+.12*stride; rightTail.rotation.x += .18*k-.12*stride;
    head.rotation.y -= stride*.08; mark.rotation.y=t*1.6;
  }
  function attackSwing(t: number) {
    resetPose(); t=clamp(t);
    const wind=ease(t/.33)*(1-ease((t-.33)/.16)), snap=ease((t-.31)/.16)*(1-ease((t-.62)/.38));
    body.rotation.y += -.57*wind+.66*snap; body.rotation.x += -.12*wind+.2*snap;
    r.upper.rotation.x += -.58*wind-1.12*snap; r.upper.rotation.z += .3*wind-.22*snap;
    r.elbow.rotation.x += -.48*wind+1.49*snap; l.upper.rotation.x += .32*snap;
    head.rotation.y += .30*wind-.50*snap; pelvis.position.z += .085*snap;
    leftTail.rotation.x += .37*snap; rightTail.rotation.z += .16*snap;
    mark.scale.setScalar(1+.26*wind+.72*snap); mark.rotation.y=TAU*ease(t);
  }
  function flinch(t: number) {
    resetPose(); const k=ease(t/.2)*(1-ease((t-.2)/.8));
    pelvis.position.y -= .05*k; body.rotation.set(-.34*k,.43*k,.16*k);
    head.rotation.x -= .23*k; l.upper.rotation.x -= .66*k; r.upper.rotation.z += .52*k;
    a.knee.rotation.x += .35*k; leftTail.rotation.x -= .18*k; mark.scale.setScalar(1-.45*k);
  }
  function cast(t: number) {
    resetPose(); const wave=Math.sin(t*2.5);
    body.rotation.y=-.38; head.rotation.y=.34; r.upper.rotation.set(-1.05,-.2,.42);
    r.elbow.rotation.set(-1.68+.07*wave,.02,-.27); l.upper.rotation.set(-.55,.1,-.58);
    l.elbow.rotation.x=-1.1; mark.rotation.y=t*3; mark.scale.setScalar(1.29+.13*wave);
    rightTail.rotation.x += .12+.06*wave;
  }
  function drink(t: number) {
    resetPose(); const k=ease(t*2.6); r.upper.rotation.x-=.63*k; r.upper.rotation.z-=.22*k;
    r.elbow.rotation.x-=.72*k; head.rotation.x-=.24*k; mark.scale.setScalar(1-.8*k);
  }
  function crouch(t: number) {
    resetPose(); const k=ease(t*2.7); pelvis.position.y-=.214*k;
    a.thigh.rotation.x-=.91*k; b.thigh.rotation.x-=.99*k;
    a.knee.rotation.x+=1.64*k; b.knee.rotation.x+=1.74*k;
    body.rotation.x+=.45*k; head.rotation.x-=.29*k; l.upper.rotation.x-=.71*k;
    leftTail.rotation.x+=.65*k; rightTail.rotation.x+=.7*k;
  }
  function cheer(t: number) {
    resetPose(); const lift=.5+.5*Math.sin(t*4.3); pelvis.position.y+=lift*.045;
    r.upper.rotation.set(-2.45-lift*.16,0,.53); r.elbow.rotation.x=-.38; head.rotation.x-=.18;
    l.upper.rotation.set(-.6,0,-.35); l.elbow.rotation.x=-1.7; mark.rotation.y=t*3.1;
  }
  /** Normalized death progress: 0 = standing, 1 = held floor pose; not elapsed seconds. */
  function dead(t: number) {
    resetPose(); const k=ease(t), buckle=Math.sin(Math.PI*k);
    pelvis.rotation.x=-1.53*k; pelvis.rotation.z=-.13*k; pelvis.position.y-=.488*k+.105*buckle;
    pelvis.position.z-=.16*k; body.rotation.x+=.19*buckle; head.rotation.y+=.49*k;
    a.thigh.rotation.x-=.52*buckle+.1*k; a.knee.rotation.x+=.99*buckle+.18*k;
    b.thigh.rotation.z+=.17*k; b.knee.rotation.x+=.39*buckle;
    l.upper.rotation.z-=.64*k; r.upper.rotation.z+=.69*k; r.elbow.rotation.x+=1.34*k;
    mark.scale.setScalar(1-.995*k);
  }
  function reviveRise(t: number) {
    t=clamp(t); dead(1-t);
    const sweep=Math.sin(Math.PI*t); r.elbow.rotation.x-=.54*sweep; body.rotation.y+=.31*sweep;
    leftTail.rotation.x+=.24*sweep; mark.rotation.y=TAU*ease(t);
  }
  return {
    root, materials: () => mats, headHeight: () => standingHeight*root.scale.y,
    setOpacity(o: number) { for(const m of mats) { m.transparent=o<1; m.opacity=o; } },
    resetPose,idle,walk,attackSwing,flinch,cast,drink,crouch,cheer,dead,reviveRise,
  };
}
