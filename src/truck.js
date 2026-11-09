// Autonomous cab-less hauler, modelled entirely in code. +X forward, +Y up, metres.
// Parts are baked into one geometry per material, so a truck costs a handful of draw calls.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { surface, std, led } from './mats.js';
import { fbm2, rng } from './noise.js';
import { canvasTexture } from './tex.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
function norm(g) {
  const q = g.index ? g.toNonIndexed() : g.clone();
  if (!q.attributes.uv) q.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(q.attributes.position.count * 2), 2));
  for (const k of Object.keys(q.attributes)) if (!['position', 'normal', 'uv'].includes(k)) q.deleteAttribute(k);
  return q;
}
const rbox = (w, h, d, r = 0.03) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w * 0.49, h * 0.49, d * 0.49));
const cyl = (r, h, seg = 20, r2 = r) => new THREE.CylinderGeometry(r2, r, h, seg);
const hull = (pts) => new ConvexGeometry(pts.map((p) => V(p[0], p[1], p[2])));
const sym = (pts) => pts.flatMap((p) => [[p[0], p[1], p[2]], [p[0], p[1], -p[2]]]);

class Kit {
  constructor() { this.b = {}; }
  put(key, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    const m = new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(1, 1, 1));
    const q = norm(geo); q.applyMatrix4(m); (this.b[key] ??= []).push(q); return this;
  }
  pair(key, geo, x, y, z, rx = 0, ry = 0, rz = 0) { this.put(key, geo, x, y, z, rx, ry, rz); this.put(key, geo, x, y, -z, -rx, -ry, rz); return this; }
  geos() { const o = {}; for (const k in this.b) o[k] = mergeGeometries(this.b[k], false); return o; }
  build(mats, group) {
    for (const k in this.b) {
      const m = new THREE.Mesh(mergeGeometries(this.b[k], false), mats[k]);
      m.castShadow = m.receiveShadow = true; m.name = k; group.add(m);
    }
  }
}

/* ---------------------------------------------------------------- wheel */
let _wheel;
export function wheelGeos() {
  if (_wheel) return _wheel;
  const P = (a) => a.map((p) => new THREE.Vector2(p[0], p[1]));
  const tyreProf = P([[0.60, -0.36], [0.62, -0.40], [0.70, -0.412], [0.72, -0.428], [0.74, -0.412], [0.82, -0.405], [0.84, -0.42], [0.86, -0.402], [0.915, -0.36], [0.94, -0.30], [0.95, -0.2],
    [0.95, 0.2], [0.94, 0.30], [0.915, 0.36], [0.86, 0.402], [0.84, 0.42], [0.82, 0.405], [0.74, 0.412], [0.72, 0.428], [0.70, 0.412], [0.62, 0.40], [0.60, 0.36]]);
  const tyre = [norm(new THREE.LatheGeometry(tyreProf, 64)).rotateX(Math.PI / 2)];
  const lug = norm(new THREE.BoxGeometry(0.23, 0.08, 0.37)), sb = norm(new THREE.BoxGeometry(0.17, 0.11, 0.13)), n = 22, M = () => new THREE.Matrix4();
  for (let i = 0; i < n; i++) for (const s of [-1, 1]) {
    const a = (i + (s > 0 ? 0.5 : 0)) / n * Math.PI * 2;
    tyre.push(lug.clone().applyMatrix4(M().makeRotationZ(a).multiply(M().makeTranslation(0, 0.968, s * 0.2)).multiply(M().makeRotationY(s * 0.44))));
    tyre.push(sb.clone().applyMatrix4(M().makeRotationZ(a + Math.PI / n).multiply(M().makeTranslation(0, 0.915, s * 0.385)).multiply(M().makeRotationX(-s * 0.62))));
  }
  const rimProf = P([[0.60, -0.36], [0.615, 0.33], [0.618, 0.375], [0.59, 0.365], [0.55, 0.27], [0.47, 0.18], [0.35, 0.15], [0.29, 0.17], [0.29, 0.28], [0.265, 0.31], [0.11, 0.31], [0.1, 0.34], [0.0, 0.34]]);
  const rim = [norm(new THREE.LatheGeometry(rimProf, 48)).rotateX(Math.PI / 2)], nuts = [];
  for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; nuts.push(norm(cyl(0.03, 0.06, 6)).rotateX(Math.PI / 2).translate(Math.cos(a) * 0.41, Math.sin(a) * 0.41, 0.19)); }
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; nuts.push(norm(cyl(0.022, 0.04, 6)).rotateX(Math.PI / 2).translate(Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.325)); }
  for (let i = 0; i < 7; i++) {   // slotted vents in the dish
    const a = (i + 0.5) / 7 * Math.PI * 2;
    rim.push(norm(rbox(0.09, 0.05, 0.05, 0.02)).applyMatrix4(M().makeRotationZ(a).multiply(M().makeTranslation(0.52, 0, 0.245))));
  }
  _wheel = { tyre: mergeGeometries(tyre, false), rim: mergeGeometries(rim, false), nuts: mergeGeometries(nuts, false) };
  return _wheel;
}

/* --------------------------------------------------------------- decals */
function sideDecal(frontAtRight, id) {
  return canvasTexture(2048, 320, (g, W, H) => {
    const X = (t) => (frontAtRight ? t * W : (1 - t) * W), dir = frontAtRight ? 1 : -1;
    const font = (px, w = 700) => `${w} ${px}px Bahnschrift, "DIN Alternate", "Arial Narrow", Arial, sans-serif`;
    g.clearRect(0, 0, W, H);
    // panel seams + fasteners
    for (const t of [0.07, 0.21, 0.37, 0.53, 0.69, 0.85]) {
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(X(t) - 1.5, 0, 3, H);
      g.fillStyle = 'rgba(255,255,255,.10)'; g.fillRect(X(t) + 2 * dir, 0, 1.5, H);
      g.fillStyle = 'rgba(0,0,0,.5)';
      for (let y = 18; y < H; y += 26) { g.beginPath(); g.arc(X(t) + 9 * dir, y, 2.2, 0, 7); g.fill(); g.beginPath(); g.arc(X(t) - 9 * dir, y, 2.2, 0, 7); g.fill(); }
    }
    g.fillStyle = 'rgba(190,196,202,.55)'; g.fillRect(0, 22, W, 3);
    // wordmark
    g.fillStyle = 'rgba(214,219,224,.92)'; g.textBaseline = 'middle'; g.textAlign = 'center';
    g.font = font(46); if ('letterSpacing' in g) g.letterSpacing = '10px';
    g.fillText('TELLUR', X(0.14), 72);
    g.font = font(13, 500); if ('letterSpacing' in g) g.letterSpacing = '4px';
    g.fillStyle = 'rgba(214,219,224,.7)'; g.fillText('AUTONOMOUS HAULAGE', X(0.14), 104);
    // unit number
    g.font = font(170); if ('letterSpacing' in g) g.letterSpacing = '0px';
    g.fillStyle = 'rgba(205,210,216,.86)'; g.fillText(String(id).padStart(2, '0'), X(0.295), 205);
    // spec block
    g.font = font(13, 500); if ('letterSpacing' in g) g.letterSpacing = '2px'; g.textAlign = 'left';
    g.fillStyle = 'rgba(214,219,224,.72)';
    const bx = Math.min(X(0.405), X(0.50));
    ['UNIT TLR-' + String(id).padStart(2, '0'), 'PAYLOAD 64 T · GVW 118 T', 'NO OPERATOR ON BOARD', 'LIFT POINTS A1 · A4'].forEach((s, i) => g.fillText(s, bx, 150 + i * 20));
    g.strokeStyle = 'rgba(214,219,224,.5)'; g.lineWidth = 1.5; g.strokeRect(bx - 10, 132, 250, 86);
    // keep-clear warning
    const wx = X(0.74);
    g.fillStyle = 'rgba(236,178,38,.95)'; g.beginPath(); g.moveTo(wx - 22, 268); g.lineTo(wx + 22, 268); g.lineTo(wx, 230); g.closePath(); g.fill();
    g.fillStyle = 'rgba(20,20,20,.95)'; g.fillRect(wx - 2, 242, 4, 14); g.fillRect(wx - 2, 259, 4, 4);
    g.fillStyle = 'rgba(236,178,38,.9)'; g.font = font(15, 600); g.textAlign = frontAtRight ? 'right' : 'left';
    g.fillText('KEEP CLEAR 40 M', wx - 34 * dir, 252);
    // hazard chevrons, low rear
    const hx0 = Math.min(X(0.17), X(0.33)), hw = Math.abs(X(0.33) - X(0.17));
    g.save(); g.beginPath(); g.rect(hx0, 284, hw, 22); g.clip();
    g.fillStyle = 'rgba(236,178,38,.95)'; g.fillRect(hx0, 284, hw, 22); g.fillStyle = 'rgba(18,18,18,.95)';
    for (let x = hx0 - 40; x < hx0 + hw + 40; x += 30) { g.beginPath(); g.moveTo(x, 306); g.lineTo(x + 14, 306); g.lineTo(x + 36, 284); g.lineTo(x + 22, 284); g.closePath(); g.fill(); }
    g.restore();
    // wear: sand-blasted scuffs eat into the paint
    const R = rng(900 + id);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 520; i++) {
      const x = R() * W, y = R() * H, l = 6 + R() * 70; g.strokeStyle = `rgba(0,0,0,${0.15 + R() * 0.5})`; g.lineWidth = 0.6 + R() * 2.2;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + l, y + (R() - 0.5) * 6); g.stroke();
    }
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(0,0,0,${R() * 0.6})`; g.fillRect(R() * W, R() * H, 1 + R() * 3, 1 + R() * 2); }
    g.globalCompositeOperation = 'source-over';
  });
}
let _chev;
const chevrons = () => (_chev ??= canvasTexture(512, 48, (g, W, H) => {
  g.fillStyle = '#e0a51e'; g.fillRect(0, 0, W, H); g.fillStyle = '#141414';
  for (let x = -60; x < W + 60; x += 44) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + 22, H); g.lineTo(x + 22 + H, 0); g.lineTo(x + H, 0); g.closePath(); g.fill(); }
  const R = rng(5); g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(0,0,0,${R() * 0.7})`; g.fillRect(R() * W, R() * H, 1 + R() * 5, 1 + R() * 2); }
}));

/* ------------------------------------------------------------ materials */
function truckMats(T) {
  const body = { y0: 0.4, y1: 2.1, up: 0.34, low: 0.42, scale: 0.55, nrmStrength: 0.32, vary: 0.6, film: 0.015 };
  return {
    paint: surface(std({ color: 0x25282c, metalness: 0.38, roughness: 0.56 }), T, body),
    paint2: surface(std({ color: 0x43474d, metalness: 0.6, roughness: 0.42 }), T, body),
    paint3: surface(std({ color: 0xb8b0a8, metalness: 0.2, roughness: 0.5 }), T, { ...body, film: 0.03 }),
    black: surface(std({ color: 0x0f1012, metalness: 0.35, roughness: 0.62 }), T, { ...body, low: 0.5, film: 0.03 }),
    steel: surface(std({ color: 0xa2a5a8, metalness: 1, roughness: 0.3 }), T, { ...body, film: 0.06, scale: 1.4 }),
    rubber: surface(std({ color: 0x0b0b0c, metalness: 0, roughness: 0.9 }), T, { y0: 1e3, y1: 2e3, up: 0, low: 0.1, film: 0, scale: 1.5, nrmStrength: 0.5, vary: 0.4, noiseScale: 0.7, streak: 0 }),
    rim: surface(std({ color: 0x1b1d20, metalness: 0.75, roughness: 0.46 }), T, { y0: 1e3, y1: 2e3, up: 0, low: 0.07, film: 0, scale: 1.5, noiseScale: 0.7, streak: 0 }),
    nuts: surface(std({ color: 0x9a9da0, metalness: 1, roughness: 0.28 }), T, { y0: 1e3, y1: 2e3, up: 0, low: 0.08, film: 0, scale: 2, streak: 0 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x030405, metalness: 0, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03 }),
    orange: surface(std({ color: 0xd4541a, metalness: 0.1, roughness: 0.5 }), T, { ...body }),
    ore: surface(std({ color: 0x5c6470, metalness: 0.35, roughness: 0.62 }), T, { nrm: T.rockNrm, det: T.rockDet, y0: -10, y1: -9, up: 0.12, low: 0, film: 0.03, scale: 1.3, nrmStrength: 2.2, vary: 0.9 }),
    ledW: led(0xdfeaff, 7), ledR: led(0xff2410, 6), ledA: led(0xff8a12, 6),
  };
}

/* ---------------------------------------------------------------- truck */
let _proto = null;
export function buildTruck(T, { id = 7 } = {}) {
  const g = new THREE.Group(); let M = _proto?.M;
  const AX = [3.95, 1.0, -2.5, -4.55], WR = 0.95, TZ = 1.38, Y0 = 2.0, Y1 = 3.72;
  const hoodY = (x) => 3.5 - (x - 3.4) * 0.155;
  const A = [-5.5, Y0, 1.72], B = [2.5, Y0, 1.6], C = [3.8, Y1, 1.95], D = [-6.9, Y1, 1.82], E = [-6.9, 3.25, 1.8];
  if (!_proto) {
  const k = new Kit(); M = truckMats(T);

  // chassis
  k.pair('black', rbox(12.2, 0.42, 0.28, 0.03), -0.3, 1.32, 0.55);
  for (const x of [5.4, 2.5, -0.75, -3.5, -5.9]) k.put('black', rbox(0.22, 0.34, 1.3, 0.03), x, 1.32, 0);
  for (const x of AX) {
    k.put('black', cyl(0.17, 2.5, 16).rotateX(Math.PI / 2), x, WR, 0);
    k.put('black', new THREE.SphereGeometry(0.36, 16, 12).scale(1.2, 1, 1), x, WR, 0);
    k.pair('black', rbox(1.5, 0.1, 0.16, 0.02), x + 0.45, 1.12, 0.95, 0, 0, -0.12);
    k.pair('steel', cyl(0.055, 0.62, 10), x - 0.33, 1.27, 1.0, 0.2, 0, 0.25);
    k.pair('black', cyl(0.085, 0.3, 12), x - 0.36, 1.15, 0.98, 0.2, 0, 0.25);
  }
  // battery pack, tool locker, ladder
  k.pair('paint2', rbox(1.4, 0.95, 0.62, 0.05), -0.75, 1.22, 1.42);
  for (let i = 0; i < 5; i++) k.pair('black', rbox(1.2, 0.035, 0.03, 0.01), -0.75, 0.92 + i * 0.15, 1.74);
  k.pair('steel', rbox(0.08, 0.14, 0.04, 0.01), -0.2, 1.62, 1.745).pair('steel', rbox(0.08, 0.14, 0.04, 0.01), -1.3, 1.62, 1.745);
  k.pair('black', rbox(0.8, 0.72, 0.5, 0.04), 2.47, 1.3, 1.4);
  for (let i = 0; i < 3; i++) k.pair('steel', rbox(0.62, 0.035, 0.2, 0.01), 2.47, 0.72 + i * 0.32, 1.72);
  k.pair('steel', cyl(0.02, 1.0, 8), 2.15, 1.2, 1.82).pair('steel', cyl(0.02, 1.0, 8), 2.79, 1.2, 1.82);
  for (const s of [1, -1]) {   // high-voltage lead
    const c = new THREE.CatmullRomCurve3([V(-0.35, 1.66, 1.62 * s), V(-0.12, 1.84, 1.74 * s), V(0.24, 1.9, 1.68 * s), V(0.42, 1.97, 1.5 * s)]);
    k.put('orange', new THREE.TubeGeometry(c, 16, 0.035, 8));
  }
  // rear
  k.put('steel', cyl(0.2, 1.7, 20).rotateX(Math.PI / 2), -5.72, 1.42, 0);
  k.put('paint2', rbox(0.2, 0.24, 3.3, 0.04), -6.0, 1.0, 0);
  k.pair('black', rbox(0.5, 0.14, 0.14, 0.02), -5.8, 1.12, 0.55);
  k.pair('ledR', rbox(0.05, 0.09, 0.62, 0.012), -6.11, 1.0, 1.15);
  k.pair('rubber', rbox(0.035, 0.72, 0.78, 0.01), -5.62, 1.12, TZ);

  // tipper body: twisted side shells (the diagonal fold), floor, headboard, canopy, chute
  for (const s of [1, -1]) {
    const o = [A, B, C, D, E].map((p) => [p[0], p[1], p[2] * s]);
    k.put('paint', hull([...o, ...o.map((p) => [p[0], p[1], p[2] - 0.13 * s])]));
  }
  k.pair('paint2', rbox(10.75, 0.13, 0.2, 0.035), -1.55, Y1 + 0.02, 1.87, 0, -0.0122, 0);
  k.put('paint2', rbox(8.15, 0.09, 3.5, 0.03), -1.5, Y0 - 0.03, 0);
  k.pair('steel', rbox(8.0, 0.022, 0.02, 0.005), -1.5, Y0 - 0.03, 1.755);
  k.put('paint', rbox(8.0, 0.12, 3.2, 0.02), -1.5, Y0 + 0.08, 0);
  k.put('paint', rbox(2.2, 0.12, 3.5, 0.03), 3.15, (Y0 + Y1) / 2, 0, 0, 0, 0.9235);
  k.put('paint2', hull(sym([[3.55, Y1 + 0.09, 1.98], [4.75, Y1 - 0.03, 1.66], [4.75, Y1 - 0.13, 1.66], [3.55, Y1 - 0.05, 1.98]])));
  k.put('paint', rbox(1.95, 0.12, 3.4, 0.03), -6.2, 2.625, 0, 0, 0, -0.729);
  // two-tone rub plate that echoes the fold
  {
    const a = V(...A), n = V(...B).sub(a).cross(V(...C).sub(a));
    const zOn = (x, y) => A[2] - (n.x * (x - A[0]) + n.y * (y - A[1])) / n.z;
    const poly = [[-4.9, 2.08], [2.45, 2.08], [2.78, 2.5], [-2.3, 2.5]];
    for (const s of [1, -1]) k.put('paint2', hull(poly.flatMap(([x, y]) => [[x, y, (zOn(x, y) + 0.035) * s], [x, y, (zOn(x, y) - 0.02) * s]])));
  }
  for (const x of [-5, -2.6, -0.2, 2.2]) k.pair('ledA', rbox(0.14, 0.04, 0.02, 0.006), x, Y0 - 0.03, 1.762);

  // nose: front block ahead of the first axle + upper block over the wheel arch
  k.put('paint', hull(sym([[5.05, 0.95, 1.68], [6.55, 0.95, 1.68], [6.8, 1.3, 1.6], [6.82, 2.05, 1.66], [5.05, 2.0, 1.72], [6.8, 2.65, 1.45], [6.3, 3.05, 1.2], [5.05, 3.244, 1.26]])));
  k.put('paint', hull(sym([[2.3, 2.0, 1.74], [5.05, 2.0, 1.72], [5.05, 3.244, 1.26], [3.4, 3.5, 1.34], [2.3, 3.5, 1.34], [2.3, 2.45, 1.78], [5.05, 2.4, 1.75]])));
  k.put('paint3', hull(sym([[3.9, hoodY(3.9) + 0.055, 0.95], [6.1, hoodY(6.1) + 0.055, 0.95], [3.9, hoodY(3.9) - 0.05, 0.98], [6.1, hoodY(6.1) - 0.05, 0.98]])));
  k.put('paint2', hull(sym([[6.45, 0.68, 1.72], [7.05, 0.8, 1.5], [7.1, 1.22, 1.5], [6.7, 1.27, 1.74], [6.45, 1.27, 1.74]])));
  k.put('steel', hull(sym([[6.3, 0.52, 1.25], [7.0, 0.78, 1.25], [7.0, 0.83, 1.25], [6.3, 0.6, 1.25]])));
  k.pair('orange', new THREE.TorusGeometry(0.11, 0.032, 8, 18), 7.15, 1.0, 0.8);
  // front face: grille, lamps, sensors
  k.put('black', rbox(0.03, 0.66, 2.4, 0.01), 6.815, 1.72, 0);
  for (let i = 0; i < 9; i++) k.put('paint2', rbox(0.06, 0.03, 2.3, 0.01), 6.845, 1.44 + i * 0.07, 0);
  k.pair('glass', rbox(0.06, 0.2, 0.5, 0.02), 6.84, 1.42, 1.3).pair('ledW', rbox(0.05, 0.1, 0.34, 0.012), 6.86, 1.42, 1.3);
  k.pair('ledW', rbox(0.035, 0.44, 0.03, 0.008), 6.835, 2.3, 1.47);
  k.put('ledW', rbox(0.03, 0.02, 2.5, 0.005), 6.825, 2.58, 0);
  k.put('glass', rbox(0.03, 0.2, 0.56, 0.012), 6.83, 2.28, 0);
  k.pair('black', rbox(0.22, 0.14, 0.18, 0.03), 6.5, 2.96, 1.14).pair('glass', new THREE.SphereGeometry(0.055, 14, 10), 6.615, 2.96, 1.14);
  for (let i = 0; i < 7; i++) k.pair('paint2', rbox(0.04, 0.7, 0.05, 0.012), 5.5 + i * 0.13, 1.5, 1.715);
  k.pair('black', rbox(1.0, 0.8, 0.03, 0.01), 5.89, 1.5, 1.695);
  // sensor deck
  for (const [x, z] of [[5.75, 0.6], [5.75, -0.6]]) {
    k.put('black', cyl(0.17, 0.12, 24), x, hoodY(x) + 0.115, z).put('glass', cyl(0.15, 0.11, 24), x, hoodY(x) + 0.23, z).put('black', cyl(0.16, 0.025, 24), x, hoodY(x) + 0.295, z);
  }
  k.put('black', cyl(0.05, 0.42, 12), 4.35, hoodY(4.35) + 0.26, 0).put('glass', cyl(0.14, 0.11, 24), 4.35, hoodY(4.35) + 0.52, 0).put('black', cyl(0.15, 0.025, 24), 4.35, hoodY(4.35) + 0.585, 0);
  for (let i = 0; i < 4; i++) k.put('black', rbox(0.3, 0.05, 0.16, 0.015), 4.9, hoodY(4.9) + 0.075, -0.6 + i * 0.4);
  k.pair('steel', rbox(0.34, 0.025, 0.025, 0.01), 5.2, hoodY(5.2) + 0.1, 0.8);
  k.pair('black', cyl(0.012, 1.3, 6), 3.95, Y1 + 0.72, 1.55);
  k.put('black', cyl(0.09, 0.05, 14), 4.3, Y1 + 0.06, 1.45).put('ledA', cyl(0.07, 0.1, 14), 4.3, Y1 + 0.13, 1.45);

  // ore load
  {
    const og = new THREE.PlaneGeometry(8.0, 3.1, 140, 54); og.rotateX(-Math.PI / 2);
    const p = og.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i), nx = x / 4, nz = z / 1.55;
      const heap = Math.pow(Math.max(0, 1 - nx * nx), 0.55) * Math.pow(Math.max(0, 1 - nz * nz), 0.55);
      const lump = (fbm2(x * 1.6 + id * 3, z * 1.6, 3) - 0.5) * 0.5 + Math.abs(fbm2(x * 4.5, z * 4.5 + id, 2) - 0.5) * 0.5 + (fbm2(x * 11, z * 11, 2) - 0.5) * 0.16;
      p.setY(i, 2.16 + heap * (1.7 + 0.3 * fbm2(x * 0.5 + id, z * 0.5, 2)) + lump * Math.min(1, heap * 2.2));
    }
    og.computeVertexNormals(); k.put('ore', og, -1.6, 0, 0);
  }
  _proto = { geos: k.geos(), M };
  }
  for (const key in _proto.geos) { const m = new THREE.Mesh(_proto.geos[key], M[key]); m.castShadow = m.receiveShadow = true; m.name = key; g.add(m); }

  // decals
  const decalMat = (map) => {
    const m = surface(std({ map, transparent: true, depthWrite: false, roughness: 0.55, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), T, { y0: 0.4, y1: 2.1, up: 0.34, low: 0.42, film: 0.015, nrmStrength: 0 });
    return m;
  };
  for (const s of [1, -1]) {
    const P = [A, B, C, D].map((p) => [p[0], p[1], (p[2] + 0.012) * s]);
    const tri = s > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    const pos = [], uv = [];
    for (const i of tri) { const p = P[i]; pos.push(...p); const u = (p[0] + 6.9) / 10.7; uv.push(s > 0 ? u : 1 - u, (p[1] - Y0) / (Y1 - Y0)); }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); dg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); dg.computeVertexNormals();
    const dm = new THREE.Mesh(dg, decalMat(sideDecal(s > 0, id))); dm.receiveShadow = true; g.add(dm);
  }
  for (const [x, ry] of [[7.108, Math.PI / 2], [-6.105, -Math.PI / 2]]) {
    const cm = new THREE.Mesh(new THREE.PlaneGeometry(ry > 0 ? 2.9 : 1.5, ry > 0 ? 0.26 : 0.2), decalMat(chevrons()));
    cm.position.set(x, ry > 0 ? 1.02 : 1.0, 0); cm.rotation.y = ry; cm.receiveShadow = true; g.add(cm);
  }

  // wheels
  const W = wheelGeos(); g.userData.wheels = [];
  for (const x of AX) for (const s of [1, -1]) {
    const w = new THREE.Group(); w.position.set(x, WR, s * TZ); w.rotation.y = s > 0 ? 0 : Math.PI;
    const spin = new THREE.Group(); w.add(spin);
    for (const [geo, mat] of [[W.tyre, M.rubber], [W.rim, M.rim], [W.nuts, M.nuts]]) { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; spin.add(m); }
    spin.rotation.z = (x * 1.7 + s) % 6.28;
    g.add(w); g.userData.wheels.push({ spin, dir: s });
  }
  g.userData.length = 14; g.userData.id = id;
  return g;
}
