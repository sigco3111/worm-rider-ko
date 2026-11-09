// The arena: a ring road around a central massif, outer buttes, a megastructure gate the convoys come from,
// a wrecked hull and a far tower. Everything static is generated here once.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { surface, std, SAND, led } from './mats.js';
import { canvasTexture } from './tex.js';
import { fbm2, rng, sstep, lerp, clamp } from './noise.js';
import { buildMesa, scatterBoulders } from './rock.js';
import { SUN } from './env.js';

export const RR = 430, GATE = { x: 735, z: 0 }, HALF = 1300;
const D2R = Math.PI / 180, pol = (deg, r) => [Math.cos(deg * D2R) * r, Math.sin(deg * D2R) * r];
const F = (x, z, R0, H, seed, o = {}) => ({ x, z, R0, H, seed, ...o });
export const FORMATIONS = [
  F(0, 0, 105, 118, 1.3, { lobes: 0.55, taper0: 1.15, taper1: 0.8, cap: 1.06, elong: 0.2, nt: 420, ny: 230 }),
  F(-150, 70, 70, 84, 2.7, { nt: 300, ny: 170 }), F(125, -105, 62, 96, 4.1, { nt: 300, ny: 190 }),
  F(60, 165, 55, 66, 5.9, { nt: 260, ny: 150 }),
  ...[[35, 760, 85, 120], [110, 820, 110, 140], [150, 720, 60, 80], [235, 740, 55, 50], [270, 830, 80, 70], [340, 900, 95, 130]]
    .map(([a, r, R0, H], i) => F(...pol(a, r), R0, H, 11.7 + i * 3.1, { nt: 240, ny: 130 })),
  ...[[60, 600, 15, 62], [140, 590, 13, 54], [290, 575, 16, 70], [215, 560, 14, 58]]
    .map(([a, r, R0, H], i) => F(...pol(a, r), R0, H, 41.3 + i * 2.3, { taper0: 1.3, taper1: 0.72, cap: 1.28, capFrom: 0.86, skirt: 3, nt: 140, ny: 120, spire: true })),
];
const HULL = { x: pol(215, 1040)[0], z: pol(215, 1040)[1] }, TOWER = { x: pol(128, 1270)[0], z: pol(128, 1270)[1] };

/* ------------------------------------------------------------------ road */
function buildPath() {
  const c = []; const P = (x, z) => c.push(new THREE.Vector3(x, 0, z));
  P(800, -16); P(650, -16); P(545, -24); P(470, -58); P(425, -104);
  for (let a = -20; a >= -340; a -= 6) P(...pol(a, RR));
  P(425, 104); P(470, 58); P(545, 24); P(650, 16); P(800, 16);
  const cv = new THREE.CatmullRomCurve3(c, false, 'centripetal'), L = cv.getLength(), n = Math.round(L / 4), sp = cv.getSpacedPoints(n);
  return { x: Float32Array.from(sp, (p) => p.x), z: Float32Array.from(sp, (p) => p.z), y: new Float32Array(n + 1), n: n + 1, L, step: L / n };
}
export const PATH = buildPath();
const CELL = 48, hashGrid = new Map(), key = (cx, cz) => cx * 8192 + cz;
for (let i = 0; i < PATH.n; i++) { const k = key(Math.floor(PATH.x[i] / CELL), Math.floor(PATH.z[i] / CELL)); (hashGrid.get(k) ?? hashGrid.set(k, []).get(k)).push(i); }
const _ri = { d: 1e9, i: -1 };
function roadInfo(x, z) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL); let best = 1e18, bi = -1;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const l = hashGrid.get(key(cx + a, cz + b)); if (!l) continue;
    for (const i of l) { const dx = PATH.x[i] - x, dz = PATH.z[i] - z, d = dx * dx + dz * dz; if (d < best) { best = d; bi = i; } }
  }
  _ri.d = bi < 0 ? 1e9 : Math.sqrt(best); _ri.i = bi; return _ri;
}
export function pathAt(u, o) {
  const f = clamp(u / PATH.step, 0, PATH.n - 1.001), i = Math.floor(f), t = f - i;
  o.x = lerp(PATH.x[i], PATH.x[i + 1], t); o.z = lerp(PATH.z[i], PATH.z[i + 1], t);
  const tx = PATH.x[i + 1] - PATH.x[i], tz = PATH.z[i + 1] - PATH.z[i], l = Math.hypot(tx, tz) || 1; o.tx = tx / l; o.tz = tz / l; return o;
}

/* --------------------------------------------------------------- terrain */
const WX = SUN, skirts = [];
function baseH(x, z) {
  let h = 8.4 * (fbm2(x * 0.0045 + 3.1, z * 0.0045 + 7.7, 3) - 0.5);
  const u = (x * 0.82 + z * 0.57) * 0.011 + 2.4 * (fbm2(x * 0.0021, z * 0.0021, 2) - 0.5), s = u - Math.floor(u);
  h += (s < 0.66 ? Math.pow(s / 0.66, 1.3) : Math.pow((1 - s) / 0.34, 0.9)) * 5.5 * sstep(0.35, 0.72, fbm2(x * 0.0016 + 9, z * 0.0016 + 4, 2));
  return h + 0.8 * (fbm2(x * 0.03, z * 0.03, 2) - 0.5);
}
function analyticH(x, z) {
  let h = baseH(x, z);
  for (const m of skirts) { const d = Math.hypot(x - m.x, z - m.z) - m.r; if (d < 70) h += m.k * sstep(70, -12, d); }
  const r = roadInfo(x, z); if (r.d < 30) h = lerp(PATH.y[r.i], h, sstep(9, 30, r.d));
  return lerp(h, -2, sstep(HALF - 260, HALF - 30, Math.max(Math.abs(x), Math.abs(z))));
}
const TN = 400, TD = (HALF * 2) / TN, TV = TN + 1, HG = new Float32Array(TV * TV);
export function ground(x, z) {
  const fx = clamp((x + HALF) / TD, 0, TN - 1e-3), fz = clamp((z + HALF) / TD, 0, TN - 1e-3), i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * TV + i;
  return HG[k] * (1 - u) * (1 - v) + HG[k + 1] * u * (1 - v) + HG[k + TV] * (1 - u) * v + HG[k + TV + 1] * u * v;
}

/* ------------------------------------------------------------- landmarks */
const bx = (list, w, h, d, x, y, z, rz = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (rz) g.rotateZ(rz); g.translate(x, y, z); list.push(g); };
function buildGate(T) {
  const g = new THREE.Group(), red = [], dark = [], lamp = [], glow = [];
  for (const s of [1, -1]) {
    const zc = s * 54;
    bx(red, 70, 160, 56, 10, 80, zc); bx(red, 76, 12, 62, 10, 150, zc); bx(red, 52, 20, 40, 12, 172, zc); if (s > 0) { bx(red, 38, 44, 30, 14, 204, zc); bx(red, 44, 5, 36, 14, 228, zc); } bx(red, 74, 4, 60, 10, 96, zc); bx(red, 73, 3, 59, 10, 44, zc);
    for (const dz of [-18, 0, 18]) bx(red, 4, 118, 5, -27, 84, zc + dz);
    for (const y of [58, 76, 112, 128, 141]) for (const dz of [-9, 9]) bx((y * 7 + dz + s * 3) % 5 < 1.4 ? glow : dark, 1.5, 9, 2.2, -25.4, y, zc + dz);
    bx(red, 34, 84, 256, 16, 42, s * 210); bx(red, 24, 18, 220, 18, 93, s * 205); bx(red, 35, 3, 258, 15.5, 60, s * 210); bx(red, 35, 2, 258, 15.5, 30, s * 210);
    bx(red, 3, 6, 220, 7.5, 105, s * 205); for (let i = 0; i < 3; i++) bx(red, 20, 12 + i * 5, 26, 19, 108 + i * 2.5, s * (120 + i * 78));
    for (let i = 0; i < 7; i++) { bx(red, 10, 72, 10, -4, 36, s * (100 + i * 36)); bx((i * 3 + (s > 0 ? 1 : 0)) % 4 === 0 ? glow : dark, 1.2, 7, 2, -1.4, 48, s * (118 + i * 36)); }
    bx(red, 16, 30, 256, -6, 10, s * 210, 0.35);
    { const c = new THREE.CylinderGeometry(1.4, 1.4, 240, 10); c.rotateX(Math.PI / 2); c.translate(-2.6, 70, s * 205); dark.push(c); }
    { const c = new THREE.CylinderGeometry(6, 6, 10, 18); c.translate(20, 107, s * 150); red.push(c); }
    const top = s > 0 ? 231 : 182;
    bx(dark, 1.2, 46, 1.2, 0, top + 23, zc); bx(dark, 0.8, 30, 0.8, 20, 197, s * 40);
    { const b = new THREE.SphereGeometry(1.3, 12, 8); b.translate(0, top + 47, zc); lamp.push(b); }
    for (let k = 0; k < 4; k++) bx(glow, 0.5, 56, 0.5, -10 + k * 10, 30, s * 23.4);
    for (let y = 30; y < 84; y += 13.5) bx(dark, 0.6, 0.55, 254, -1.2, y, s * 210);
    for (let i = 0; i < 14; i++) bx(dark, 0.6, 58, 0.55, -1.2, 55, s * (91 + i * 18.6));
    for (let y = 24; y < 150; y += 18) { bx(dark, 0.6, 0.55, 56.4, -25.2, y, zc); bx(dark, 70.4, 0.55, 0.6, 10, y, zc - s * 28.2); }
    for (let i = 0; i < 5; i++) bx(red, 5, 3, 5, -2 + i * 7, 104.5, s * 76);
  }
  bx(red, 56, 86, 48, 12, 107, 0); bx(dark, 1, 46, 34, -16.2, 110, 0); bx(red, 3, 30, 20, -17, 110, 0); bx(dark, 4, 64, 48, 32, 32, 0); bx(glow, 30, 0.6, 1.2, 5, 63.6, 0);
  const redM = surface(std({ color: 0xa7452e, roughness: 0.9 }), T, { nrm: T.rockNrm, det: T.rockDet, scale: 0.09, nrmStrength: 0.8, vary: 0.9, up: 0.85, low: 0.9, y0: 0, y1: 22, film: 0.05, noiseScale: 0.016, dustColor: SAND });
  for (const [list, mat] of [[red, redM], [dark, std({ color: 0x120d0b, roughness: 0.8 })], [lamp, led(0xff2a10, 9)], [glow, led(0xffa24a, 3.2)]]) {
    const m = new THREE.Mesh(mergeGeometries(list, false), mat); m.castShadow = m.receiveShadow = list === red || list === dark; g.add(m);
  }
  // sector markings painted across the wall
  const sign = (text, sub, flip) => canvasTexture(1024, 512, (c, W, H) => {
    c.clearRect(0, 0, W, H); c.fillStyle = 'rgba(236,224,205,.9)'; c.textBaseline = 'middle'; c.textAlign = 'center';
    c.font = '700 330px Bahnschrift, "Arial Narrow", Arial, sans-serif'; c.fillText(text, W / 2, H * 0.47);
    c.font = '600 44px Bahnschrift, "Arial Narrow", Arial, sans-serif'; if ('letterSpacing' in c) c.letterSpacing = '14px'; c.fillText(sub, W / 2, H * 0.9);
    c.fillRect(60, H * 0.79, W - 120, 6);
    const R = rng(flip ? 17 : 29); c.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 1500; i++) { c.fillStyle = `rgba(0,0,0,${R() * 0.8})`; c.fillRect(R() * W, R() * H, 2 + R() * 26, 1 + R() * 5); }
    for (let i = 0; i < 90; i++) { c.fillStyle = `rgba(0,0,0,${0.3 + R() * 0.5})`; c.fillRect(R() * W, 0, 2 + R() * 7, H); }
  });
  for (const [z, text, sub, flip] of [[-212, '04', 'RING ROAD · SECTOR', false], [212, 'TLR', 'TELLUR HAULAGE DEPOT', true]]) {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(132, 66), std({ map: sign(text, sub, flip), transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    d.position.set(-1.55, 55, z); d.rotation.y = -Math.PI / 2; g.add(d);
  }
  return g;
}
function buildHull(T) {
  const g = new THREE.Group(), sh = new THREE.Shape([[0, -40], [340, -40], [345, 10], [250, 105], [120, 215], [48, 262], [30, 258], [8, 140]].map((p) => new THREE.Vector2(p[0], p[1])));
  const eg = new THREE.ExtrudeGeometry(sh, { depth: 20, bevelEnabled: true, bevelThickness: 1.5, bevelSize: 1.5, bevelSegments: 1, steps: 1 }); eg.translate(-150, 0, -10);
  const mat = surface(std({ color: 0x262b33, metalness: 0.5, roughness: 0.58 }), T, { scale: 0.035, nrmStrength: 0.5, vary: 0.7, up: 0.5, low: 0.75, y0: -40, y1: 60, film: 0.14, noiseScale: 0.012, dustColor: new THREE.Color(0xa5512c) });
  const slab = new THREE.Mesh(eg, mat); slab.castShadow = slab.receiveShadow = true; g.add(slab);
  const R = rng(404), bits = [];
  for (let i = 0; i < 46; i++) { const y = R() * 240, w = 4 + R() * 12; bx(bits, w, 3 + R() * 12, 6 + R() * 16, -150 + 8 * y / 140 * (y < 140 ? 1 : 0.4) - w * 0.3 + R() * 4, y, (R() - 0.5) * 8); }
  const gm = new THREE.Mesh(mergeGeometries(bits, false), std({ color: 0x15171a, roughness: 0.7, metalness: 0.4 })); gm.castShadow = true; g.add(gm);
  g.rotation.set(0.3, 0, 0, 'YXZ');
  return g;
}
function buildTower(T) {
  const prof = [[22, -10], [16, 40], [11, 120], [10, 200], [14, 236], [40, 250], [96, 262], [100, 268], [92, 276], [30, 286], [8, 292], [0.1, 292]].map((p) => new THREE.Vector2(p[0], p[1]));
  const m = new THREE.Mesh(new THREE.LatheGeometry(prof, 64), surface(std({ color: 0xa55a3c, roughness: 0.82, metalness: 0.1 }), T, { nrm: T.rockNrm, det: T.rockDet, scale: 0.04, nrmStrength: 0.7, vary: 0.7, up: 0.7, low: 0.6, y0: 0, y1: 40, film: 0.04, noiseScale: 0.015, dustColor: SAND }));
  m.castShadow = true; return m;
}

/* ------------------------------------------------------------------ build */
export function buildWorld(T) {
  const g = new THREE.Group(), obstacles = [], occ = [];
  // road bed heights first (the terrain is flattened toward them)
  { const raw = new Float32Array(PATH.n); for (let i = 0; i < PATH.n; i++) raw[i] = baseH(PATH.x[i], PATH.z[i]);
    for (let i = 0; i < PATH.n; i++) { let s = 0, c = 0; for (let k = -14; k <= 14; k++) { const j = i + k; if (j >= 0 && j < PATH.n) { s += raw[j]; c++; } } PATH.y[i] = s / c + 0.25; } }
  for (const f of FORMATIONS) skirts.push({ x: f.x, z: f.z, r: f.R0 * (f.spire ? 1.1 : 1.02), k: f.spire ? 4 : 7 + f.H * 0.06 });
  for (let z = -330; z <= 330; z += 55) skirts.push({ x: GATE.x + 6, z, r: Math.abs(z) < 30 ? 0 : 40, k: Math.abs(z) < 30 ? 0 : 9 });
  skirts.push({ x: HULL.x, z: HULL.z, r: 120, k: 14 }, { x: TOWER.x, z: TOWER.z, r: 30, k: 8 });

  // heights
  for (let j = 0; j < TV; j++) for (let i = 0; i < TV; i++) HG[j * TV + i] = analyticH(-HALF + i * TD, -HALF + j * TD);

  // occluders for the baked far shadows + obstacle discs for the worm
  for (const f of FORMATIONS) { const gy = ground(f.x, f.z); occ.push({ x: f.x, z: f.z, r: f.R0 * (f.spire ? 1.0 : 0.94), top: gy + f.H * 0.96 }); obstacles.push({ x: f.x, z: f.z, r: f.R0 * (f.spire ? 1.25 : 1.12) }); }
  for (let z = -330; z <= 330; z += 28) { const tall = Math.abs(z) < 86; occ.push({ x: GATE.x + 12, z, r: 26, top: ground(GATE.x, z) + (tall ? 165 : 98) }); }
  for (let z = -330; z <= 330; z += 44) if (Math.abs(z) > 30) obstacles.push({ x: GATE.x + 12, z, r: 44 });
  obstacles.push({ x: GATE.x + 34, z: 0, r: 42 });
  const hullYaw = Math.atan2(-HULL.x, -HULL.z);
  for (let i = 0; i <= 10; i++) { const t = i / 10, lx = -150 + 340 * t, hx = HULL.x + Math.cos(hullYaw) * lx, hz = HULL.z - Math.sin(hullYaw) * lx; occ.push({ x: hx, z: hz, r: 22, top: ground(hx, hz) + lerp(230, 20, Math.pow(t, 0.8)) }); obstacles.push({ x: hx, z: hz, r: 34 }); }
  occ.push({ x: TOWER.x, z: TOWER.z, r: 14, top: 250 }); obstacles.push({ x: TOWER.x, z: TOWER.z, r: 34 });

  // terrain mesh with baked shade
  const pos = new Float32Array(TV * TV * 3), nor = new Float32Array(TV * TV * 3), uv = new Float32Array(TV * TV * 2), shade = new Float32Array(TV * TV), road = new Float32Array(TV * TV);
  const sl = Math.hypot(WX.x, WX.z), sx = WX.x / sl, sz = WX.z / sl, tanE = WX.y / sl;
  for (let j = 0; j < TV; j++) for (let i = 0; i < TV; i++) {
    const k = j * TV + i, x = -HALF + i * TD, z = -HALF + j * TD, h = HG[k];
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z; uv[k * 2] = x / 2.6; uv[k * 2 + 1] = z / 2.6;
    const hx = (HG[j * TV + Math.min(TN, i + 1)] - HG[j * TV + Math.max(0, i - 1)]) / (2 * TD), hz = (HG[Math.min(TN, j + 1) * TV + i] - HG[Math.max(0, j - 1) * TV + i]) / (2 * TD), il = 1 / Math.hypot(hx, 1, hz);
    nor[k * 3] = -hx * il; nor[k * 3 + 1] = il; nor[k * 3 + 2] = -hz * il;
    let lit = 1;
    for (const o of occ) {
      const vx = o.x - x, vz = o.z - z, pr = vx * sx + vz * sz; if (pr <= 0) continue;
      const perp = Math.sqrt(Math.max(0, vx * vx + vz * vz - pr * pr)), soft = 4 + pr * 0.035; if (perp > o.r + soft) continue;
      const te = Math.max(0, pr - Math.sqrt(Math.max(0, o.r * o.r - Math.min(perp, o.r) ** 2))), dy = o.top - (h + te * tanE); if (dy <= 0) continue;
      lit = Math.min(lit, 1 - sstep(0, 6 + te * 0.03, dy) * sstep(o.r + soft, o.r - soft * 0.4, perp));
    }
    shade[k] = lit; const r = roadInfo(x, z); road[k] = 1 - sstep(5, 15, r.d);
  }
  const idx = new Uint32Array(TN * TN * 6); let q = 0;
  for (let j = 0; j < TN; j++) for (let i = 0; i < TN; i++) { const a = j * TV + i, b = a + 1, c = a + TV, d = c + 1; idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d; }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); tg.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); tg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  tg.setAttribute('aShade', new THREE.BufferAttribute(shade, 1)); tg.setAttribute('aRoad', new THREE.BufferAttribute(road, 1)); tg.setIndex(new THREE.BufferAttribute(idx, 1));
  const tu = { uNz: { value: T.noise }, uShadowC: { value: new THREE.Vector3() }, uLx: { value: new THREE.Vector3(1, 0, 0) }, uLy: { value: new THREE.Vector3(0, 0, 1) }, uShadowR: { value: 150 } };
  const sand = std({ color: SAND, roughness: 0.93, metalness: 0, normalMap: T.sandNrm, normalScale: new THREE.Vector2(0.5, 0.5) });
  sand.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, tu);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aShade,aRoad; varying float vShade,vRoad; varying vec3 vWP2;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvShade=aShade; vRoad=aRoad; vWP2=position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vShade,vRoad; varying vec3 vWP2; uniform sampler2D uNz; uniform vec3 uShadowC,uLx,uLy; uniform float uShadowR;')
      .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
        { float nl=texture2D(uNz,vWP2.xz*.0031).r, nm=texture2D(uNz,vWP2.xz*.021).g;
          diffuseColor.rgb*=mix(.84,1.14,nl)*mix(.93,1.06,nm);
          diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.8,.79,.8),vRoad*.85);
          vec3 dl=vWP2-uShadowC; float inBox=1.-smoothstep(uShadowR*.8,uShadowR*.97,max(abs(dot(dl,uLx)),abs(dot(dl,uLy))));
          diffuseColor.rgb*=mix(vec3(.3,.33,.43),vec3(1.),mix(vShade,1.,inBox)); }`)
      .replace('#include <normal_fragment_maps>', /* glsl */`#include <normal_fragment_maps>
        { vec3 n2=texture2D(normalMap,vNormalMapUv*.11).xyz*2.-1.; normal=normalize(normal+tbn*vec3(n2.xy*.55*(1.-vRoad*.7),0.)); }`);
  };
  const terrain = new THREE.Mesh(tg, sand); terrain.receiveShadow = true; g.add(terrain);
  const far = new THREE.Mesh(new THREE.CircleGeometry(16000, 48).rotateX(-Math.PI / 2), std({ color: SAND, roughness: 0.95 })); far.position.y = -2.4; g.add(far);

  // formations
  for (const f of FORMATIONS) {
    const gy = ground(f.x, f.z), { x, z, spire, ...o } = f, m = buildMesa(T, { ...o, yOff: gy, skirt: o.skirt ?? 5 });
    m.position.set(x, gy - 1.5, z); m.rotation.y = f.seed * 1.7; g.add(m);
  }
  const R = rng(91);
  g.add(scatterBoulders(T, R, 44, (Rr, s) => {
    const f = FORMATIONS[(Rr() * FORMATIONS.length) | 0], a = Rr() * 6.283, d = f.R0 * (1.1 + Rr() * 0.9) + 6, x = f.x + Math.cos(a) * d, z = f.z + Math.sin(a) * d;
    return [x, ground(x, z) - s * 0.2, z];
  }));
  // landmarks
  const gate = buildGate(T); gate.position.set(GATE.x, ground(GATE.x - 40, 0) - 1, GATE.z); g.add(gate);
  const hull = buildHull(T); hull.position.set(HULL.x, ground(HULL.x, HULL.z) - 22, HULL.z); hull.rotation.y = hullYaw; g.add(hull);
  const tower = buildTower(T); tower.position.set(TOWER.x, ground(TOWER.x, TOWER.z), TOWER.z); g.add(tower);
  // road beacons
  {
    const n = Math.floor(PATH.L / 64), poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.14, 5.2, 6), std({ color: 0x1a1a1c, roughness: 0.6, metalness: 0.6 }), n);
    const lamps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 8, 6), led(0xff9a30, 7), n), d = new THREE.Object3D(), p = {};
    for (let i = 0; i < n; i++) {
      pathAt((i + 0.5) * 64, p); const x = p.x + p.tz * 11, z = p.z - p.tx * 11, y = ground(x, z);
      d.position.set(x, y + 2.6, z); d.updateMatrix(); poles.setMatrixAt(i, d.matrix); d.position.y = y + 5.4; d.updateMatrix(); lamps.setMatrixAt(i, d.matrix);
    }
    poles.castShadow = true; g.add(poles, lamps);
  }
  const lx = new THREE.Vector3(), ly = new THREE.Vector3(), lz = new THREE.Vector3();
  return {
    group: g, obstacles, terrain, occ,
    // keep the terrain's baked far shadows out of the area the live shadow map already covers
    update(sun, extent) { sun.shadow.camera.matrixWorld.extractBasis(lx, ly, lz); tu.uShadowC.value.copy(sun.target.position); tu.uLx.value.copy(lx); tu.uLy.value.copy(ly); tu.uShadowR.value = extent; },
  };
}
