/* BA-DIAN V5 · 低模发型增强层（独立原型专用）
 * 不改共享仓库 rig 源码；只在 head / headTop 挂点上追加顶点色低模几何。
 */
(function (global) {
  'use strict';
  var THREE = null;
  var TAU = Math.PI * 2;

  function install(three) { THREE = three; return api; }

  function builder(mat) {
    var vertices = [], colors = [], col = new THREE.Color();
    function tri(a, b, c, tint) {
      vertices.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      col.setHex(tint);
      for (var i = 0; i < 3; i++) colors.push(col.r, col.g, col.b);
    }
    function loft(sections, sides, tint, phase, shape) {
      if (phase === undefined) phase = Math.PI / sides;
      var rows = sections.map(function (s, row) {
        return Array.from({ length: sides }, function (_, i) {
          var a = i * TAU / sides + phase;
          var p = [s[0] + s[3] * Math.sin(a), s[1], s[2] + s[4] * Math.cos(a)];
          if (shape) shape(p, a, row);
          return p;
        });
      });
      for (var k = 1; k < rows.length; k++) for (var i = 0; i < sides; i++) {
        var j = (i + 1) % sides, lo = rows[k - 1], hi = rows[k];
        tri(lo[i], lo[j], hi[i], tint);
        tri(lo[j], hi[j], hi[i], tint);
      }
      [0, rows.length - 1].forEach(function (k) {
        var s = sections[k];
        for (var i = 0; i < sides; i++) {
          var a = rows[k][i], b = rows[k][(i + 1) % sides];
          tri([s[0], s[1], s[2]], k ? a : b, k ? b : a, tint);
        }
      });
    }
    function stroke(from, to, r0, r1, tint, n) {
      n = n || 6;
      var va = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]).normalize();
      var helper = Math.abs(va.y) > 0.85 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
      var u = new THREE.Vector3().crossVectors(va, helper).normalize();
      var v = new THREE.Vector3().crossVectors(va, u);
      function section(center, r) {
        return Array.from({ length: n }, function (_, i) {
          var a = i * TAU / n, x = r * Math.cos(a), y = r * Math.sin(a);
          return [
            center[0] + u.x * x + v.x * y,
            center[1] + u.y * x + v.y * y,
            center[2] + u.z * x + v.z * y,
          ];
        });
      }
      var lo = section(from, r0), hi = section(to, r1);
      for (var i = 0; i < n; i++) {
        var j = (i + 1) % n;
        tri(lo[i], lo[j], hi[i], tint); tri(lo[j], hi[j], hi[i], tint);
        tri(from, lo[j], lo[i], tint); tri(to, hi[i], hi[j], tint);
      }
    }
    function mesh(parent) {
      if (!vertices.length) return null;
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      var m = new THREE.Mesh(geo, mat);
      m.name = 'hairStyleV2Mesh';
      m.castShadow = true;
      parent.add(m);
      return m;
    }
    return { tri: tri, loft: loft, stroke: stroke, mesh: mesh };
  }

  // 统一风格规则：所有增强件沿用原 rig 的顶点色平面着色材质与发色。
  var STYLES = {
    chuixiao: { kind: 'topknot', color: 0x241f1c, tie: 0x9fd8c2, knot: 1.18 },
    bagun: { kind: 'short', color: 0x2c2620, knot: 0.92, hairline: true },
    'ivan-girl': { kind: 'twin', color: 0x5a3c26 },
    gojo: { kind: 'spiky', color: 0xf5f7ff },
    laodaye: { kind: 'elder', color: 0xe9e4d8 },
    mabaoguo: { kind: 'topknot', color: 0xdcd8ce, tie: 0x8f2f2a, knot: 0.82 },
    wuliuqi: { kind: 'short', color: 0x1f1c1a, knot: 0.8 },
    'hero-today': { kind: 'short', color: 0x2c241e, knot: 0.7 },
    dajianke: { kind: 'slick', color: 0x26201d },
    dapihuai: { kind: 'kid', color: 0x241f1b },
    default: { kind: 'short', color: 0x332c26, knot: 0.6 },
  };

  function backMass(g, color, cx, rx, top) {
    g.loft([
      [0, 0.015, cx, rx, 0.068],
      [0, 0.085, cx - 0.005, rx + 0.004, 0.072],
      [0, top, cx + 0.012, rx - 0.015, 0.058],
    ], 10, color);
  }

  function sideburns(g, color, x, z, r0, low) {
    [-1, 1].forEach(function (s) {
      g.stroke([s * x, 0.082, z], [s * (x + 0.006), low, z - 0.012], r0, r0 * 0.45, color, 6);
    });
  }

  function topKnot(g2, style) {
    var c = style.color, k = style.knot || 1;
    g2.loft([
      [0, -0.025, -0.03, 0.05 * k, 0.048 * k],
      [0, 0.032, -0.035, 0.063 * k, 0.058 * k],
      [0, 0.078, -0.04, 0.05 * k, 0.046 * k],
      [0, 0.1, -0.042, 0.016, 0.015],
    ], 10, c);
    if (style.tie) {
      g2.loft([[0, 0.002, -0.033, 0.052 * k, 0.05 * k], [0, 0.018, -0.034, 0.052 * k, 0.05 * k]], 10, style.tie);
    }
    g2.stroke([0, 0.005, -0.035], [0, 0.12, -0.062], 0.026 * k, 0.01, c, 7);
  }

  function buildTopknot(g, g2, s) {
    g.loft([
      [0, 0.105, -0.008, 0.163, 0.151],
      [0, 0.14, -0.012, 0.155, 0.143],
      [0, 0.158, -0.014, 0.132, 0.122],
    ], 12, s.color);
    backMass(g, s.color, -0.1, 0.146, 0.14);
    sideburns(g, s.color, 0.133, 0.092, 0.021, -0.018);
    topKnot(g2, s);
  }

  function buildShort(g, g2, s) {
    g.loft([
      [0, 0.1, -0.005, 0.164, 0.152],
      [0, 0.135, -0.008, 0.156, 0.145],
      [0, 0.148, -0.01, 0.14, 0.13],
    ], 12, s.color);
    backMass(g, s.color, -0.102, 0.15, 0.138);
    sideburns(g, s.color, 0.132, 0.08, 0.015, -0.012);
    if (s.hairline) {
      g.stroke([-0.132, 0.113, 0.108], [0.132, 0.113, 0.108], 0.017, 0.017, s.color, 8);
      g.stroke([0, 0.113, 0.116], [0, 0.094, 0.144], 0.014, 0.008, s.color, 6);
    }
    if (s.knot) {
      var k = s.knot;
      g2.loft([
        [0, -0.012, -0.015, 0.046 * k, 0.044 * k],
        [0, 0.035, -0.02, 0.05 * k, 0.047 * k],
        [0, 0.07, -0.022, 0.03 * k, 0.028 * k],
      ], 9, s.color);
    }
  }

  function buildTwin(g, g2, s) {
    g.loft([
      [0, 0.085, 0.005, 0.174, 0.16],
      [0, 0.13, 0, 0.169, 0.156],
      [0, 0.162, -0.005, 0.146, 0.136],
    ], 12, s.color);
    [-0.092, -0.031, 0.031, 0.092].forEach(function (x, i) {
      g.stroke([x, 0.128, 0.128], [x * 1.06, 0.07 - (i % 2) * 0.008, 0.153], 0.023, 0.012, s.color, 6);
    });
    [-1, 1].forEach(function (side) {
      g.loft([
        [side * 0.164, 0.07, -0.01, 0.046, 0.05],
        [side * 0.184, 0.02, 0, 0.052, 0.056],
        [side * 0.202, -0.08, 0.015, 0.04, 0.045],
      ], 8, s.color);
    });
    backMass(g, s.color, -0.095, 0.16, 0.145);
    g2.stroke([0, 0, 0.005], [0.012, 0.062, -0.012], 0.024, 0.01, s.color, 7);
  }

  function buildSpiky(g, g2, s) {
    // 五条悟原发量已足，只补后脑厚度与几束背向发片，避免遮挡眼罩。
    g.loft([
      [0, 0.08, -0.082, 0.19, 0.1],
      [0, 0.16, -0.1, 0.2, 0.095],
      [0, 0.23, -0.11, 0.14, 0.07],
    ], 12, s.color);
    [-1, 1].forEach(function (side) {
      g.stroke([side * 0.15, 0.16, -0.08], [side * 0.23, 0.26, -0.13], 0.045, 0.012, 0xe8eef8, 6);
    });
  }

  function buildElder(g, g2, s) {
    backMass(g, s.color, -0.095, 0.15, 0.125);
    sideburns(g, s.color, 0.146, 0.0, 0.023, -0.075);
    g.loft([[0, 0.1, -0.005, 0.16, 0.148], [0, 0.132, -0.008, 0.15, 0.14]], 12, s.color);
  }

  function buildSlick(g, g2, s) {
    g.loft([
      [0, 0.1, -0.005, 0.164, 0.152],
      [0, 0.138, -0.008, 0.156, 0.146],
      [0, 0.152, -0.01, 0.14, 0.132],
    ], 12, s.color);
    backMass(g, s.color, -0.1, 0.15, 0.14);
    sideburns(g, s.color, 0.132, 0.075, 0.014, -0.01);
    g.stroke([0.055, 0.145, 0.095], [0.12, 0.105, 0.055], 0.018, 0.01, s.color, 6);
  }

  function buildKid(g, g2, s) {
    g.loft([
      [0, 0.105, 0.002, 0.192, 0.172],
      [0, 0.145, 0, 0.182, 0.162],
      [0, 0.172, -0.005, 0.142, 0.13],
    ], 12, s.color);
    backMass(g, s.color, -0.105, 0.177, 0.155);
    [-1, 1].forEach(function (side) {
      g.stroke([side * 0.17, 0.11, 0.06], [side * 0.19, 0.02, 0.04], 0.028, 0.014, s.color, 6);
    });
    g2.stroke([0, 0.005, 0], [0.015, 0.075, -0.01], 0.016, 0.006, s.color, 6);
  }

  var BUILDERS = {
    topknot: buildTopknot,
    short: buildShort,
    twin: buildTwin,
    spiky: buildSpiky,
    elder: buildElder,
    slick: buildSlick,
    kid: buildKid,
  };

  function apply(rig, id) {
    if (!THREE || !rig) return null;
    if (rig.__hairV2Head) return { head: rig.__hairV2Head, top: rig.__hairV2Top };
    var style = STYLES[id] || STYLES.default;
    var head = rig.root.getObjectByName('head');
    var headTop = rig.root.getObjectByName('headTop');
    if (!head) return null;
    var mat = (rig.materials && rig.materials()[0]) || new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.04 });
    var g = builder(mat), g2 = builder(mat);
    (BUILDERS[style.kind] || buildShort)(g, g2, style);

    var headGrp = new THREE.Group(); headGrp.name = 'hairStyleV2_head';
    var topGrp = new THREE.Group(); topGrp.name = 'hairStyleV2_top';
    g.mesh(headGrp); g2.mesh(topGrp);
    head.add(headGrp);
    if (headTop) headTop.add(topGrp);
    rig.__hairV2Head = headGrp; rig.__hairV2Top = topGrp;
    rig.setHairStyleV2 = function (on) { headGrp.visible = !!on; topGrp.visible = !!on; };
    return { head: headGrp, top: topGrp };
  }

  var api = { install: install, apply: apply, styles: STYLES };
  global.BAHair = api;
})(typeof window !== 'undefined' ? window : globalThis);
