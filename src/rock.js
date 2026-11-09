// Stratified sandstone. One global bed sequence (STRATA) is shared by every formation,
// so cliffs across the whole scene line up layer for layer, the way real geology does.
import * as THREE from 'three';
import { surface, std, SAND } from './mats.js';
import { fbm2, rng, sstep, hash2, clamp, lerp } from './noise.js';

const BASE = new THREE.Color(0xb45c39), PALE = new THREE.Color(0xd6a47e), DARK = new THREE.Color(0x84402a);
export const STRATA = (() => {
  const R = rng(21), L = []; let y = -16, i = 0;
  while (y < 320) {
    const hard = R() < 0.52;
    const th = hard ? (R() < 0.22 ? 6 + R() * 9 : 0.9 + R() * 3.2) : 0.5 + R() * 2.6;
    const c = BASE.clone(), pick = R();
    if (!hard && pick < 0.16) c.lerp(PALE, 0.55 + R() * 0.35); else if (hard && pick < 0.2) c.lerp(DARK, 0.4 + R() * 0.4);
    c.offsetHSL((R() - 0.5) * 0.016, (R() - 0.5) * 0.08, (R() - 0.5) * 0.07 + (hard ? -0.015 : 0.02));
    L.push({ i: i++, y0: y, y1: y + th, th, hard, soft: hard ? 0 : 0.35 + R() * 0.65, c, nj: 6 + ((R() * 9) | 0), seed: (R() * 1e6) | 0, set: (R() - 0.5) });
    y += th;
  }
  return L;
})();
export function layerAt(y) {
  let a = 0, b = STRATA.length - 1;
  while (a < b) { const m = (a + b + 1) >> 1; if (STRATA[m].y0 <= y) a = m; else b = m - 1; }
  return STRATA[a];
}

const TAU = Math.PI * 2, S = { r: 0, cr: 0, cg: 0, cb: 0 };
const angd = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
// radius of a formation at angle th and height y; also writes the vertex colour into S
function profile(th, y, o) {
  const cx = Math.cos(th), sz = Math.sin(th), u = clamp(y / o.H), k = o.R0 / 18 * o.feature;
  let base = o.R0 * (1 + o.elong * Math.cos(2 * (th - o.elAng))) * (1 + o.lobes * (fbm2(cx * 1.2 + o.seed, sz * 1.2 + y * 0.012, 3) - 0.5) + 0.22 * (fbm2(cx * 3.3 + o.seed * 1.7, sz * 3.3 + y * 0.03, 2) - 0.5));
  base *= lerp(o.taper0, o.taper1, Math.pow(u, 0.8)) * (1 + (o.cap - 1) * sstep(o.capFrom - 0.03, o.capFrom, u));
  // master joints: clefts that cut through the whole stack
  let cleft = 0;
  for (const m of o.masters) {
    const d = angd(th, m.a) * o.R0 + (fbm2(m.a * 10, y * 0.07, 2) - 0.5) * 2.4 * k;
    cleft = Math.max(cleft, m.depth * k * Math.exp(-Math.pow(d / (m.w * k), 2)) * sstep(m.y0, m.y0 + 8, y));
  }
  const yw = y + o.yOff + 1.5 * (fbm2(cx * 2 + 3.3, sz * 2 + 1.1, 2) - 0.5) + cx * o.R0 * o.dip;
  const L = layerAt(yw), t = (yw - L.y0) / L.th;
  let rec = L.set * (L.hard ? 1.7 : 0.9) * k, cav = 0, tone = 1;
  if (L.hard) {
    const af = ((th / TAU) % 1 + 1) % 1 * L.nj, j0 = Math.floor(af);
    let pl = -1e9, pr = 1e9, blk = 0;
    for (let j = j0 - 2; j <= j0 + 2; j++) {
      const pj = j + 0.7 * (hash2(L.seed, ((j % L.nj) + L.nj) % L.nj) - 0.5);
      if (pj <= af) { if (pj > pl) { pl = pj; blk = j; } } else if (pj < pr) pr = pj;
    }
    blk = ((blk % L.nj) + L.nj) % L.nj;
    const half = (pr - pl) / 2 / L.nj * TAU, ang = (af - (pl + pr) / 2) / L.nj * TAU;
    base *= lerp(1, Math.cos(half) / Math.cos(ang), 0.9);                      // flat block faces, corners at the joints
    const dMet = Math.min(af - pl, pr - af) * TAU * o.R0 / L.nj;
    const groove = Math.exp(-Math.pow(dMet / (0.2 * k), 2));
    const missing = hash2(L.seed + 9, blk) < 0.16 ? (1.2 + 2.6 * hash2(L.seed + 11, blk)) * k : 0;
    const nb = Math.max(1, Math.round(L.th / 0.95)), tb = t * nb, ib = Math.floor(tb), fb = tb - ib;
    const sub = (hash2(L.seed + 31, ib * 7 + blk * 17) - 0.5) * 0.55 * k;       // sub-beds step in and out
    const part = Math.exp(-Math.pow(Math.min(fb, 1 - fb) * L.th / nb / 0.06, 2));
    rec += -(hash2(L.seed + 5, blk) - 0.45) * 1.3 * k + missing + groove * 1.5 * k + sub + part * 0.22 * k;
    rec += 0.22 * k * Math.pow(sstep(0.88, 1, t), 2) + 0.15 * k * Math.pow(1 - sstep(0, 0.08, t), 2);
    cav = groove * 0.7 + part * 0.35 + (missing > 0 ? 0.25 : 0);
    // desert varnish: dark mineral streaks running down hard faces
    const st = fbm2(th * o.R0 * 0.5 + L.seed, y * 0.035, 3);
    tone = (1 - 0.5 * sstep(0.5, 0.7, st)) * (0.93 + 0.14 * hash2(L.seed + 3, blk * 5 + ib));
  } else {
    const depth = (1.2 + 2.6 * L.soft) * k, nb = Math.max(1, Math.round(L.th / 0.32)), fb = (t * nb) % 1;
    rec += depth * (0.15 + 0.85 * Math.pow(t, 0.7)) + 0.6 * k * (fbm2(th * o.R0 * 0.9, y * 0.1, 2) - 0.5) - fb * 0.16 * k;
    cav = 0.65 * sstep(0.35, 1, t);
    tone = 1 + 0.14 * (fbm2(th * o.R0 * 0.2, y * 1.6, 2) - 0.5);
  }
  cav = Math.max(cav, Math.min(0.8, cleft / (1.6 * k)));
  tone *= 0.9 + 0.2 * fbm2(cx * 2.4 + o.seed * 3, sz * 2.4 + y * 0.02, 3);
  let r = base - rec - cleft + 0.14 * k * (fbm2(th * o.R0 * 2.2 + 9, y * 2.2, 2) - 0.5);
  // talus: sand cone climbing the foot
  const rt = base * 0.86 + (o.skirt - y) * 1.5 + 1.5 * (fbm2(cx * 4 + o.seed, sz * 4, 2) - 0.5);
  const sand = y < o.skirt + 3 ? sstep(-0.8, 0.9, rt - r) : 0;
  r = Math.max(r, rt * sand + r * (1 - sand));
  const shade = (1 - 0.55 * cav) * tone;
  S.r = Math.max(r, o.R0 * 0.12);
  S.cr = lerp(L.c.r * shade, SAND.r, sand); S.cg = lerp(L.c.g * shade, SAND.g, sand); S.cb = lerp(L.c.b * shade, SAND.b, sand);
}

export function buildMesa(T, opt = {}) {
  const o = { R0: 18, H: 70, seed: 3, lobes: 0.5, elong: 0.16, elAng: 0.6, taper0: 1.22, taper1: 0.86, cap: 1.14, capFrom: 0.9, skirt: 5, yOff: 0, dip: 0.012, feature: 1, nt: 520, ny: 340, ...opt };
  if (!o.masters) { const R = rng(Math.round(o.seed * 1000)); o.masters = Array.from({ length: 4 + ((R() * 4) | 0) }, () => ({ a: R() * TAU, depth: 1.6 + R() * 3.4, w: 0.5 + R() * 0.9, y0: R() < 0.5 ? -5 : R() * o.H * 0.5 })); }
  const { nt, ny } = o, capRows = 14, rows = ny + 1 + capRows, cols = nt + 1;
  const pos = new Float32Array(rows * cols * 3), col = new Float32Array(rows * cols * 3), top = new Float32Array(cols);
  for (let j = 0; j <= ny; j++) {
    const y = lerp(-2, o.H, j / ny);
    for (let i = 0; i < cols; i++) {
      const th = (i % nt) / nt * TAU; profile(th, y, o);
      const k = (j * cols + i) * 3;
      pos[k] = Math.cos(th) * S.r; pos[k + 1] = y; pos[k + 2] = Math.sin(th) * S.r;
      col[k] = S.cr; col[k + 1] = S.cg; col[k + 2] = S.cb;
      if (j === ny) top[i] = S.r;
    }
  }
  for (let c = 1; c <= capRows; c++) {   // weathered top
    const f = c / capRows, j = ny + c;
    for (let i = 0; i < cols; i++) {
      const th = (i % nt) / nt * TAU, r = top[i] * (1 - f) * (1 - 0.06 * Math.sin(f * 3.1));
      const x = Math.cos(th) * r, z = Math.sin(th) * r, k = (j * cols + i) * 3;
      pos[k] = x; pos[k + 1] = o.H + Math.sin(f * 1.57) * 1.6 * (o.R0 / 18) + (fbm2(x * 0.3 + o.seed, z * 0.3, 3) - 0.5) * 1.4 * Math.min(1, f * 4);
      pos[k + 2] = z;
      const k0 = (ny * cols + i) * 3; col[k] = lerp(col[k0], SAND.r, 0.35); col[k + 1] = lerp(col[k0 + 1], SAND.g, 0.35); col[k + 2] = lerp(col[k0 + 2], SAND.b, 0.35);
    }
  }
  const idx = new Uint32Array((rows - 1) * nt * 6); let q = 0;
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < nt; i++) {
    const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
    idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals();
  const n = g.attributes.normal;   // weld the angular seam
  for (let j = 0; j < rows; j++) {
    const a = j * cols, b = a + nt, x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
  }
  const m = new THREE.Mesh(g, rockMat(T)); m.castShadow = m.receiveShadow = true;
  return m;
}

let _rockMat;
export function rockMat(T) {
  return (_rockMat ??= surface(std({ color: 0xffffff, vertexColors: true, roughness: 0.93, metalness: 0 }), T,
    { nrm: T.rockNrm, det: T.rockDet, scale: 0.16, nrmStrength: 1.0, vary: 0.7, up: 0.9, low: 0.0, y0: -5, y1: -4, film: 0.02, noiseScale: 0.05, dustColor: SAND }));
}

export function boulderGeo(seed) {
  const g = new THREE.IcosahedronGeometry(1, 3), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const r = 1 + 0.7 * (fbm2(v.x * 1.4 + seed, v.y * 1.4 + v.z * 1.1 + seed * 0.3, 3) - 0.5) + 0.22 * (fbm2(v.x * 5 + seed, v.z * 5 + v.y * 4, 2) - 0.5);
    // flat fracture planes
    const cut = Math.max(0, v.dot(new THREE.Vector3(0.6, 0.5, 0.62)) - 0.55) + Math.max(0, v.dot(new THREE.Vector3(-0.7, 0.3, -0.5)) - 0.6);
    p.setXYZ(i, v.x * (r - cut * 0.9), v.y * (r - cut * 0.9) * 0.72, v.z * (r - cut * 0.9));
  }
  g.computeVertexNormals(); return g;
}

export function scatterBoulders(T, R, count, place) {
  const grp = new THREE.Group(), mat = surface(std({ color: 0xb05a34, roughness: 0.93 }), T, { nrm: T.rockNrm, det: T.rockDet, scale: 0.35, nrmStrength: 1.2, vary: 0.85, up: 0.7, low: 0.9, y0: -0.6, y1: 0.3, film: 0.04, noiseScale: 0.3, dustColor: SAND });
  const dummy = new THREE.Object3D();
  for (let v = 0; v < 3; v++) {
    const im = new THREE.InstancedMesh(boulderGeo(7 + v * 13), mat, count); im.castShadow = im.receiveShadow = true;
    for (let i = 0; i < count; i++) {
      const s = 0.4 + Math.pow(R(), 2.4) * 4.2, [x, y, z] = place(R, s);
      dummy.position.set(x, y + s * 0.18, z); dummy.rotation.set(R() * 0.5, R() * 6.28, R() * 0.5); dummy.scale.set(s, s * (0.7 + R() * 0.5), s * (0.8 + R() * 0.4)); dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
    }
    grp.add(im);
  }
  return grp;
}

// 1.8 m figure, purely a scale reference
export function scaleFigure() {
  const g = new THREE.Group(), cloak = std({ color: 0xe8dcc6, roughness: 0.9 }), dark = std({ color: 0x1c1512, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.5, 14), cloak); body.position.y = 0.75;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), dark); head.position.y = 1.62;
  const hood = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10, 0, 6.28, 0, 1.9), cloak); hood.position.y = 1.64;
  for (const m of [body, head, hood]) { m.castShadow = true; g.add(m); }
  return g;
}

export async function buildRockSet(T) {
  const g = new THREE.Group(), R = rng(77);
  const hero = buildMesa(T, { R0: 17, H: 74, seed: 3.1 }); g.add(hero);
  const butte = buildMesa(T, { R0: 46, H: 40, seed: 8.6, lobes: 0.6, taper0: 1.12, taper1: 0.92, cap: 1.04, capFrom: 0.86, skirt: 7, elong: 0.3, nt: 760, ny: 240 });
  butte.position.set(-105, 0, 95); g.add(butte);
  const spire = buildMesa(T, { R0: 7, H: 33, seed: 14.2, taper0: 1.3, taper1: 0.7, cap: 1.25, capFrom: 0.86, skirt: 3, nt: 280, ny: 220 });
  spire.position.set(52, 0, 38); g.add(spire);
  g.add(scatterBoulders(T, R, 16, (Rr) => { const a = Rr() * 6.28, d = 30 + Rr() * 34; return [Math.cos(a) * d, 0, Math.sin(a) * d]; }));
  const fig = scaleFigure(); fig.position.set(24, 0, -31); g.add(fig);
  const { buildTruck } = await import('./truck.js');
  const tr = buildTruck(T, { id: 12 }); tr.position.set(34, 0, -27); tr.rotation.y = 2.5; g.add(tr);
  return g;
}
