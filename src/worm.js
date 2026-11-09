// The worm. Body parts are built straight ("canonical": head ring at z=0, body along -Z, +Y dorsal)
// and bent along a spine afterwards, so the same geometry can later be deformed on the GPU.
// Relief comes from wormskin.js: the mesh is displaced by the same height field the normal map is baked from.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { std, SAND } from './mats.js';
import { fbm2, hash2, sstep, lerp, clamp } from './noise.js';
import { buildRider } from './rider.js';
import { bakeWormSkin, SKIN } from './wormskin.js';

export const WR = 11;
const TAU = Math.PI * 2, PI = Math.PI, CIRC = TAU * WR;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const er = (ph) => V3(Math.sin(ph), Math.cos(ph), 0);
const rdg = (x) => 1 - Math.abs(2 * (x - Math.floor(x)) - 1);

/* ------------------------------------------------------------- mesher */
class Mesher {
  constructor(explicitNormals = false) { this.p = []; this.n = []; this.c = []; this.uv = []; this.ov = []; this.i = []; this.en = explicitNormals; }
  // f(u,v,o,iu,iv) fills o; the face normal follows du x dv unless flip
  patch(nu, nv, f, flip = false) {
    const base = this.p.length / 3, o = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, r: 1, g: 1, b: 1, u: 0, v: 0, ox: 0, oy: 0 };
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      o.ox = o.oy = 0; f(i / nu, j / nv, o, i, j);
      this.p.push(o.x, o.y, o.z); this.n.push(o.nx, o.ny, o.nz); this.c.push(o.r, o.g, o.b); this.uv.push(o.u, o.v); this.ov.push(o.ox, o.oy);
    }
    const st = nv + 1;
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const a = base + i * st + j, b = a + st, c = a + 1, d = b + 1;
      if (flip) this.i.push(a, c, b, b, c, d); else this.i.push(a, b, c, b, d, c);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2)); g.setAttribute('aOver', new THREE.Float32BufferAttribute(this.ov, 2));
    g.setIndex(this.i);
    if (this.en) g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3)); else g.computeVertexNormals();
    return g;
  }
}
const col = (h) => new THREE.Color(h);
const C = {
  ridge: col(0xc9b497), groove: col(0x6e3327), deep: col(0x070303), lip: col(0x0b0a0b),
  plate: col(0x1a1c21), worn: col(0x8a8c90), tooth: col(0xf3ecdc), root: col(0x7a5a36),
};
const mixC = (o, a, b, t, k = 1) => { o.r = lerp(a.r, b.r, t) * k; o.g = lerp(a.g, b.g, t) * k; o.b = lerp(a.b, b.b, t) * k; };

/* --------------------------------------------------------------- body */
export function bodyGeo(skin, L, R = WR) {
  const NA = 330, ds = 0.26, FR = 7, rows = Math.ceil(L / ds) + 1 + FR, cols = NA + 1, n = rows * cols;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), ov = new Float32Array(n * 2);
  const taper = (s) => 0.1 + 0.9 * Math.pow(sstep(L, L - 50, s), 0.7);
  for (let j = 0; j < rows; j++) {
    const s = (j - FR) * ds, vv = s / SKIN.LEN, sh = s < 0 ? 1 - 0.09 * Math.pow(-s / (FR * ds), 2) : 1, fade = s < 0 ? 1 + s / (FR * ds) * 0.7 : 1, girth = 1 + 0.03 * Math.sin(s * 0.09 + 1.3) + 0.018 * Math.sin(s * 0.23), tk = taper(s), collar = 1 + 0.4 * sstep(11, 0, s);
    for (let i = 0; i < cols; i++) {
      const a = i / NA, th = (a - 0.5) * TAU, sx = Math.sin(th), cy = Math.cos(th), r = (R * girth * sh + skin.h(a, vv) * collar * fade) * tk, k = j * cols + i;
      pos[k * 3] = sx * r; pos[k * 3 + 1] = cy * r * (cy < 0 ? 0.9 : 1); pos[k * 3 + 2] = -s;
      nor[k * 3] = sx; nor[k * 3 + 1] = cy; uv[k * 2] = a; uv[k * 2 + 1] = vv;
    }
  }
  const idx = new Uint32Array((rows - 1) * NA * 6); let q = 0;
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < NA; i++) { const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1; idx[q++] = a; idx[q++] = b; idx[q++] = c; idx[q++] = b; idx[q++] = d; idx[q++] = c; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('aOver', new THREE.BufferAttribute(ov, 2)); g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

/* ----------------------------------------------- claws, needles, seat */
function clawGeo(len, r, bend) {
  const g = new THREE.CylinderGeometry(0.02 * r, r, len, 16, 18, true); g.translate(0, len / 2, 0);
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const h = clamp(p.getY(i) / len), ang = Math.atan2(p.getZ(i), p.getX(i));
    const prof = Math.pow(1 - h, 0.72) / Math.max(1e-3, 1 - h * 0.98), fl = 1 + 0.09 * Math.cos(ang * 5) * (1 - h) + 0.05 * Math.sin(h * 30) * (1 - h);
    p.setXYZ(i, p.getX(i) * prof * fl, p.getY(i) * (1 - 0.3 * h * bend), p.getZ(i) * prof * fl * 0.82 - bend * len * Math.pow(h, 1.9));
    const wear = Math.pow(h, 3) * 0.5 + 0.12 * Math.max(0, Math.cos(ang * 5)) * (1 - h); mixC({ set r(v) { c[i * 3] = v; }, set g(v) { c[i * 3 + 1] = v; }, set b(v) { c[i * 3 + 2] = v; } }, C.plate, C.worn, wear, 0.8);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.computeVertexNormals();
  return g.toNonIndexed();
}
function needleGeo(len, r, bend) {
  const g = new THREE.CylinderGeometry(0.01, r, len, 7, 6, true); g.translate(0, len / 2, 0);
  const p = g.attributes.position, c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const h = clamp(p.getY(i) / len), k = Math.pow(1 - h, 0.55) / Math.max(1e-3, 1 - h * 0.995);
    p.setXYZ(i, p.getX(i) * k, p.getY(i), p.getZ(i) * k * 0.7 - bend * len * h * h);
    const t = sstep(0, 0.35, h); c[i * 3] = lerp(C.root.r, C.tooth.r, t); c[i * 3 + 1] = lerp(C.root.g, C.tooth.g, t); c[i * 3 + 2] = lerp(C.root.b, C.tooth.b, t);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.computeVertexNormals();
  return g.toNonIndexed();
}
function fangGeo(len, r, bend, seed = 0) {
  const g = new THREE.CylinderGeometry(0.012, r, len, 12, 16, true); g.translate(0, len / 2, 0);
  const p = g.attributes.position, c = new Float32Array(p.count * 3), tip = 1 - 0.012 / r;
  for (let i = 0; i < p.count; i++) {
    const h = clamp(p.getY(i) / len), ang = Math.atan2(p.getZ(i), p.getX(i));
    const k = Math.pow(1 - h, 0.78) / Math.max(1e-3, 1 - h * tip) * (1 + 0.16 * Math.exp(-h * 9)), keel = 1 + 0.1 * Math.cos(ang * 2) + 0.035 * Math.cos(ang * 7 + seed);
    p.setXYZ(i, p.getX(i) * k * keel * 0.8, p.getY(i) * (1 - 0.22 * h * bend), p.getZ(i) * k * keel - bend * len * Math.pow(h, 1.75));
    // stained, cracked root -> ivory -> bright worn tip, with darker grooves running up the tooth
    const stain = Math.pow(1 - sstep(0, 0.42, h), 1.5), groove = 0.82 + 0.18 * Math.cos(ang * 7 + seed), t = sstep(0.55, 1, h);
    c[i * 3] = lerp(lerp(C.tooth.r * 0.86, 0.2, stain), 1.0, t * 0.4) * groove; c[i * 3 + 1] = lerp(lerp(C.tooth.g * 0.8, 0.115, stain), 0.96, t * 0.4) * groove; c[i * 3 + 2] = lerp(lerp(C.tooth.b * 0.66, 0.055, stain), 0.88, t * 0.4) * groove;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.computeVertexNormals();
  return g.toNonIndexed();
}
// seat a +Y geometry at p, pointing along dir; its curl bends toward `toward`
function seat(geo, p, dir, toward) {
  const y = dir.clone().normalize(), z = toward.clone().multiplyScalar(-1); z.addScaledVector(y, -z.dot(y)).normalize();
  return geo.clone().applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(y, z), y, z).setPosition(p));
}

/* -------------------------------------------------------------- spine */
export class Spine {
  constructor(curve, step = 0.5) {
    const L = curve.getLength(), n = Math.ceil(L / step); this.L = L; this.n = n; this.step = L / n;
    this.P = []; this.T = []; this.N = []; this.B = [];
    let N = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i <= n; i++) {
      const u = 1 - i / n, P = curve.getPointAt(u), T = curve.getTangentAt(u).normalize();
      N = N.clone().addScaledVector(T, -N.dot(T)).normalize();
      this.P.push(P); this.T.push(T); this.N.push(N); this.B.push(new THREE.Vector3().crossVectors(N, T).normalize());
    }
  }
  frame(s, o = {}) {
    const f = clamp(s / this.step, 0, this.n - 1e-4), i = Math.floor(f), t = f - i;
    o.P = this.P[i].clone().lerp(this.P[i + 1], t); o.T = this.T[i].clone().lerp(this.T[i + 1], t).normalize();
    o.N = this.N[i].clone().lerp(this.N[i + 1], t).normalize(); o.B = this.B[i].clone().lerp(this.B[i + 1], t).normalize();
    return o;
  }
  matrix(s, lift = 0) { const f = this.frame(s); return new THREE.Matrix4().makeBasis(f.B, f.N, f.T).setPosition(f.P.addScaledVector(f.N, lift)); }
  bend(geo) {
    const p = geo.attributes.position, n = geo.attributes.normal, st = this.step, last = this.n - 1e-4, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      const zc = p.getZ(i), ahead = Math.max(zc, 0), f = clamp(-zc / st, 0, last), k = Math.floor(f), t = f - k, x = p.getX(i), y = p.getY(i), nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
      const P0 = this.P[k], P1 = this.P[k + 1], B0 = this.B[k], B1 = this.B[k + 1], N0 = this.N[k], N1 = this.N[k + 1], T0 = this.T[k], T1 = this.T[k + 1];
      const bx = B0.x + (B1.x - B0.x) * t, by = B0.y + (B1.y - B0.y) * t, bz = B0.z + (B1.z - B0.z) * t;
      const mx = N0.x + (N1.x - N0.x) * t, my = N0.y + (N1.y - N0.y) * t, mz = N0.z + (N1.z - N0.z) * t;
      const tx = T0.x + (T1.x - T0.x) * t, ty = T0.y + (T1.y - T0.y) * t, tz = T0.z + (T1.z - T0.z) * t;
      p.setXYZ(i, P0.x + (P1.x - P0.x) * t + bx * x + mx * y + tx * ahead, P0.y + (P1.y - P0.y) * t + by * x + my * y + ty * ahead, P0.z + (P1.z - P0.z) * t + bz * x + mz * y + tz * ahead);
      v.set(bx * nx + mx * ny + tx * nz, by * nx + my * ny + ty * nz, bz * nx + mz * ny + tz * nz).normalize(); n.setXYZ(i, v.x, v.y, v.z);
    }
    p.needsUpdate = n.needsUpdate = true; geo.computeBoundingSphere(); geo.computeBoundingBox(); return geo;
  }
}

/* ---------------------------------------------------------- materials */
const SAND_FRAG = /* glsl */`
  { vec3 wn=inverseTransformDirection(normal,viewMatrix);
    float n1=texture2D(uNz,vWP.xz*.05+vWP.y*.013).r, n2=texture2D(uNz,vWP.xz*.7).a;
    float sd=smoothstep(.74,1.02,wn.y+(n1-.5)*.75)*(.4+.6*n2);
    sd=max(sd,gCav*smoothstep(-.1,.45,wn.y)*(.3+.5*n2))*uSandAmt;
    diffuseColor.rgb=mix(diffuseColor.rgb,uSand*(.85+.3*n2),sd); roughnessFactor=mix(roughnessFactor,.96,sd); metalnessFactor*=1.-sd; }`;
function sandify(m, T, amt, key) {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uNz: { value: T.noise }, uSand: { value: SAND }, uSandAmt: { value: amt } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP=(modelMatrix*vec4(transformed,1.)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; uniform sampler2D uNz; uniform vec3 uSand; uniform float uSandAmt; float gCav=0.;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + SAND_FRAG);
  };
  m.customProgramCacheKey = () => 'sand' + key + amt;
  return m;
}
export function wormMats(T, skin) {
  const makeHide = (key = '') => {
  const hide = std({ normalMap: skin.normal, roughness: 1, metalness: 0, color: 0xffffff });
  hide.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tMask: { value: skin.mask }, tDetA: { value: T.skinNrm }, tDetB: { value: T.chitinNrm }, uNz: { value: T.noise }, uSand: { value: SAND }, uSandAmt: { value: 0.34 }, uDet: { value: new THREE.Vector2(skin.circ / 1.7, skin.LEN / 1.7) } });
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aOver; varying vec2 vOver; varying vec3 vWP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOver=aOver; vWP=(modelMatrix*vec4(transformed,1.)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', /* glsl */`#include <common>
        varying vec2 vOver; varying vec3 vWP; uniform sampler2D tMask,tDetA,tDetB,uNz; uniform vec3 uSand; uniform float uSandAmt; uniform vec2 uDet;
        vec4 gMk; float gR,gM,gCav;`)
      .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
        { vec2 uvw=vNormalMapUv; vec4 mk=texture2D(tMask,uvw); gMk=mk;
          float plate=mk.r,cav=mk.g,wear=mk.b,crust=mk.a;
          vec4 nz=texture2D(uNz,uvw*vec2(7.,13.)), nf=texture2D(uNz,uvw*uDet*.35);
          vec3 skinC=mix(vec3(.17,.115,.08),vec3(.38,.28,.195),nz.r*.7+nf.a*.3);
          skinC=mix(skinC,skinC*vec3(1.1,.84,.74),smoothstep(.4,.8,nz.g));
          skinC=mix(skinC,vec3(.50,.41,.31),wear*(1.-plate)*.6);
          vec3 plateC=mix(vec3(.02,.02,.024),vec3(.06,.054,.052),nz.b);
          plateC=mix(plateC,vec3(.21,.2,.19),smoothstep(.45,1.,wear)*plate*(.35+.65*nf.a));
          vec3 c=mix(skinC,plateC,plate);
          c=mix(c,vec3(.17,.14,.115)*(.7+.6*nf.r),crust*.85);
          c*=1.-cav*.55;
          c=mix(c,vec3(.022,.02,.022),vOver.x); c*=1.-vOver.y*.7;
          diffuseColor.rgb=c;
          gR=mix(mix(.7,.9,nz.r),mix(.3,.52,nf.a),plate); gR-=smoothstep(.45,1.,wear)*plate*.12; gR=mix(gR,.92,crust); gR=mix(gR,.95,cav*.6); gR=mix(gR,.24,vOver.x);
          gM=plate*.22*(1.-crust)*(1.-cav); gCav=cav*(1.-vOver.x)*(1.-plate); }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=gR;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor=gM;')
      .replace('#include <normal_fragment_maps>', /* glsl */`#include <normal_fragment_maps>
        { vec2 duv=vNormalMapUv*uDet; vec3 dA=texture2D(tDetA,duv).xyz*2.-1., dB=texture2D(tDetB,duv*.8).xyz*2.-1.;
          vec3 dn=mix(dA*.95,dB*.6,gMk.r); normal=normalize(normal+tbn*vec3(dn.xy,0.)); }` + SAND_FRAG);
  };
  hide.customProgramCacheKey = () => 'wormhide' + key;
  return hide; };
  const makePlate = (key = 'p') => sandify(std({ vertexColors: true, normalMap: T.chitinNrm, roughness: 0.4, metalness: 0.25 }), T, 0.4, key);
  return {
    hide: makeHide(), makeHide, makePlate,
    plate: makePlate(),
    claw: sandify(std({ vertexColors: true, roughness: 0.24, metalness: 0.45 }), T, 0.15, 'c'),
    flesh: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.4, metalness: 0, clearcoat: 0.75, clearcoatRoughness: 0.24, normalMap: T.fleshNrm, normalScale: new THREE.Vector2(1.3, 1.3), side: THREE.DoubleSide }),
    tooth: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.2, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, emissive: 0x2a2014, emissiveIntensity: 0.22 }),
  };
}

/* -------------------------------------------------------------- crest */
// layered armour hood over the head: slabs of plate sweeping back, with a keel
export function crestGeo(R = WR) {
  const S0 = 0.6, S1 = 19.5, TH = 1.08, m = new Mesher();
  const height = (ap, s, o) => {
    const sN = (s - S0) / (S1 - S0), env = Math.pow(Math.max(0, 1 - ap * ap), 0.7) * Math.pow(Math.max(0, Math.sin(PI * Math.pow(sN, 0.55))), 0.8);
    const warp = (fbm2(ap * 2.2 + 3, s * 0.12, 3) - 0.5) * 2;
    const p = s * 0.36 + 1.0 * ap * ap + warp * 1.05 + 0.5 * fbm2(ap * 6 + 11, s * 0.5, 2), saw = p - Math.floor(p), slab = Math.pow(saw, 0.7);
    const rg = rdg(fbm2(ap * 5 + 7, s * 0.33, 3));
    let h = env * (0.9 + 1.5 * slab * (0.6 + 0.4 * env) + 0.8 * rg);
    const hq = h / 0.24, fl = Math.floor(hq); h = lerp(h, (fl + sstep(0.72, 1, hq - fl)) * 0.24, 0.55);
    h += env * 0.95 * Math.exp(-Math.pow(ap * TH * R / 1.3, 2)) - env * 2.1 * Math.max(0, fbm2(ap * 9 + 1, s * 0.6, 2) - 0.62);
    o.h = R + 0.9 + h - 1.7 * (1 - sstep(0, 0.3, env)); o.saw = saw; o.env = env;
  };
  const t = {};
  m.patch(230, 170, (u, v, o) => {
    const s = lerp(S0, S1, u), ap = lerp(-1, 1, v), th = ap * TH; height(ap, s, t);
    o.x = Math.sin(th) * t.h; o.y = Math.cos(th) * t.h; o.z = -s; o.u = th * R / 1.8; o.v = s / 1.8;
    const wear = clamp(sstep(0.7, 1, t.saw) * 0.8 + 0.5 * Math.exp(-Math.pow(ap * TH * R / 0.8, 2)) + (fbm2(ap * 14, s * 1.1, 2) - 0.55) * 0.6);
    const ao = 1 - 0.7 * (1 - sstep(0, 0.16, t.saw)) * sstep(0.05, 0.3, t.env);
    mixC(o, C.plate, C.worn, wear * wear * 0.45, ao);
  }, true);
  return m.build();
}

/* --------------------------------------------------------------- head */
// one lobe of the four-way maw, sculpted in head space at its own angle so no two are alike
function buildLobe(skin, k, M) {
  const R = WR, phc = (k + 0.5) * TAU / 4, w0 = TAU / 8 + 0.02, rc = 0.7 * R, ax = 0.34 * R, axi = 0.27 * R, bz0 = 0.88 * R;
  const hinge = er(phc).multiplyScalar(rc + ax), P = {}, none = () => 0;
  // arch angle be: 0 = outer foot, PI/2 = rim, PI = inner foot. pn: -1..1 across. The section thins to an edge at |pn| = 1.
  const surf = (be, pn, o, extra) => {
    const sb = Math.sin(be), cb = Math.cos(be), ap = Math.abs(pn), fat = Math.pow(Math.max(0, 1 - Math.pow(ap, 2.7)), 0.5);
    const bz = bz0 * (0.34 + 0.66 * Math.pow(Math.max(0, 1 - Math.pow(ap, 2.3)), 0.6)), axx = (cb >= 0 ? ax : axi) * (0.06 + 0.94 * fat);
    let rho = rc + axx * cb, z = bz * Math.pow(Math.max(sb, 0), 0.85), nr = cb / axx, nz = sb / bz; const nl = Math.hypot(nr, nz) || 1; nr /= nl; nz /= nl;
    const ph = phc + pn * w0 * (1 - 0.08 * sb), h = 0.5 * fat * Math.exp(-Math.pow((be - PI / 2) / 0.24, 2)) + extra(be, pn, ph, z, sb) * (0.25 + 0.75 * fat);
    o.z0 = z; rho += h * nr; z += h * nz;
    o.x = Math.sin(ph) * rho - hinge.x; o.y = Math.cos(ph) * rho - hinge.y; o.z = z; o.ph = ph; o.nr = nr; o.nzz = nz;
  };
  const hideUV = (ph, z) => [ph / TAU + 0.5, -(z * 1.2) / SKIN.LEN];
  const outerX = (be, pn, ph, z, sb) => { const [a, v] = hideUV(ph, z); return skin.h(a - Math.floor(a), v) * 0.9 * (1 - sstep(0.3, 1, sb * sb)); };
  const pleat = (be, pn) => Math.pow(rdg(pn * 7.5 + (fbm2(pn * 3 + k * 5.3, be * 2.2, 2) - 0.5) * 0.9), 1.4);
  const innerX = (be, pn) => (0.5 * pleat(be, pn) + 0.16 * (fbm2(pn * 13 + k, be * 9, 2) - 0.5)) * sstep(PI / 2 + 0.06, PI / 2 + 0.6, be) * (0.6 + 0.4 * Math.sin((be - PI / 2) * 2));
  // armoured outside: continues the body's hide and shares its material
  const NU = 76, NV = 112, outer = (ex) => (u, v, o) => {
    const be = u * PI / 2, pn = lerp(-1, 1, v); surf(be, pn, P, ex);
    const [a, vv] = hideUV(P.ph, P.z0);
    o.x = P.x; o.y = P.y; o.z = P.z; o.u = a; o.v = vv; o.ox = sstep(0.62, 0.99, Math.sin(be)); o.oy = 0.5 * (1 - sstep(0, 0.12, u));
  };
  const smooth = new Mesher(), mo = new Mesher(); smooth.patch(NU, NV, outer(none)); mo.patch(NU, NV, outer(outerX));
  const og = mo.build(); og.setAttribute('normal', smooth.build().attributes.normal);
  // pleated inside
  const mi = new Mesher();
  mi.patch(68, NV, (u, v, o) => {
    const be = PI / 2 + u * PI / 2, pn = lerp(-1, 1, v); surf(be, pn, P, innerX); o.x = P.x; o.y = P.y; o.z = P.z; o.u = pn * 2.5; o.v = u * 2.5;
    const deep = sstep(PI * 0.62, PI, be), lipT = 1 - sstep(PI / 2 + 0.05, PI / 2 + 0.34, be);
    mixC(o, C.groove, C.ridge, Math.pow(pleat(be, pn), 0.8), 1 - 0.72 * deep);
    o.r = lerp(o.r, C.lip.r, lipT); o.g = lerp(o.g, C.lip.g, lipT); o.b = lerp(o.b, C.lip.b, lipT);
  });
  // needle teeth rooted just inside the rim
  const needles = [];
  // three ranks: sabre fangs along the rim that interlock across the mouth, shorter hooks behind them, then needles
  for (const [bf, n, len, rad, lean, bend] of [[0.535, 7, 0.6 * R, 0.5, 0.5, 0.36], [0.63, 10, 0.34 * R, 0.3, 0.38, 0.3], [0.74, 12, 0.2 * R, 0.17, 0.3, 0.16]]) for (let i = 0; i < n; i++) {
    const pn = lerp(-0.72, 0.72, (i + 0.5) / n) + (hash2(i, k * 7 + n) - 0.5) * 0.07, be = bf * PI + (hash2(i + 3, k * 5 + n) - 0.5) * 0.08;
    surf(be, pn, P, innerX); const e = er(P.ph), nrm = e.clone().multiplyScalar(P.nr).setZ(P.nzz), l = len * (0.72 + 0.5 * hash2(i * 3 + 1, k + n)) * (1 - 0.42 * pn * pn);
    needles.push(seat(fangGeo(l, rad * (0.8 + 0.4 * hash2(i, 77 + n)), bend, i * 1.7 + k), V3(P.x, P.y, P.z).addScaledVector(nrm, -0.45), nrm.clone().addScaledVector(e, -lean).add(V3(0, 0, 0.12)), e.clone().multiplyScalar(-1)));
  }
  const pivot = new THREE.Group(); pivot.position.copy(hinge);
  pivot.add(new THREE.Mesh(og, M.hide), new THREE.Mesh(mi.build(), M.flesh), new THREE.Mesh(mergeGeometries(needles, false), M.tooth));
  return { pivot, axis: V3(Math.cos(phc), -Math.sin(phc), 0) };
}
export function buildHead(T, M, skin) {
  const head = new THREE.Group(), R = WR;
  // gum and gullet
  const tp = [[1.0, -0.25], [0.93, 0.03], [0.74, 0.11], [0.54, 0.03], [0.45, -0.25], [0.37, -0.8], [0.29, -1.5], [0.2, -2.4], [0.03, -3.0]], fm = new Mesher();
  fm.patch((tp.length - 1) * 9, 150, (u, v, o) => {
    const f = u * (tp.length - 1), i = Math.min(tp.length - 2, Math.floor(f)), t = f - i, th = v * TAU;
    const z = lerp(tp[i][1], tp[i + 1][1], t) * R, pl = Math.pow(rdg(v * 34 + 0.35 * (fbm2(v * 30, z * 0.2, 2) - 0.5)), 1.3);
    const r = lerp(tp[i][0], tp[i + 1][0], t) * R * (1 + 0.035 * pl * sstep(0.08, 0.3, u) + 0.022 * Math.sin(z * 1.9));
    o.x = Math.sin(th) * r; o.y = Math.cos(th) * r; o.z = z; o.u = v * 12; o.v = z * 0.15;
    mixC(o, C.groove, C.ridge, pl * 0.8, 1 - 0.995 * sstep(0.6, -9, z));
  });
  head.add(new THREE.Mesh(fm.build(), M.flesh));
  // concentric needle rings down the throat
  const rings = [];
  for (const [zR, rhoR, n, lenR] of [[0.045, 0.5, 46, 0.33], [-0.2, 0.435, 38, 0.28], [-0.55, 0.385, 30, 0.23], [-0.95, 0.33, 22, 0.18]]) for (let i = 0; i < n; i++) {
    const th = (i + hash2(i, n) * 0.5) / n * TAU, e = er(th), l = lenR * R * (0.72 + 0.5 * hash2(i * 5 + 1, n + 3));
    rings.push(seat(fangGeo(l * 1.1, 0.2 + 0.08 * hash2(i, n + 9), 0.22, i), e.clone().multiplyScalar(rhoR * R * 1.01).setZ(zR * R), e.clone().multiplyScalar(-1).add(V3(0, 0, 0.36 + 0.2 * hash2(i, n + 5))), V3(0, 0, 1)));
  }
  head.add(new THREE.Mesh(mergeGeometries(rings, false), M.tooth));
  // hooked claws in the notches between lobes
  const claws = [];
  for (let k = 0; k < 4; k++) {
    const ph = k * TAU / 4, e = er(ph);
    for (const sg of [-1, 1]) { const e2 = er(ph + sg * 0.21); claws.push(seat(clawGeo(0.3 * R, 0.07 * R, 0.75), e2.clone().multiplyScalar(1.0 * R).setZ(-0.1 * R), V3(0, 0, 1).addScaledVector(e2, 0.22), e2.clone().multiplyScalar(-1))); }
  }
  head.add(new THREE.Mesh(mergeGeometries(claws, false), M.claw));
  const lobes = []; for (let k = 0; k < 4; k++) { const l = buildLobe(skin, k, M); head.add(l.pivot); lobes.push(l); }
  head.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  head.userData.open = (a) => { for (const l of lobes) l.pivot.quaternion.setFromAxisAngle(l.axis, -a); };
  head.userData.open(0.2);
  return head;
}

/* ---------------------------------------------------------------- lab */
export async function buildWormLab(T) {
  const g = new THREE.Group(), renderer = T.renderer, skin = bakeWormSkin(renderer, CIRC), M = wormMats(T, skin);
  const pts = [[-104, -30, 10], [-80, -15, 6], [-56, -1, 2], [-32, 10, -1], [-8, 17, -2], [16, 20.5, -1], [36, 21.5, 0], [50, 21, 0.5]].map((p) => V3(...p));
  const spine = new Spine(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.5));
  const body = new THREE.Mesh(spine.bend(bodyGeo(skin, spine.L + 40)), M.hide), crest = new THREE.Mesh(spine.bend(crestGeo()), M.plate);
  for (const m of [body, crest]) { m.castShadow = m.receiveShadow = true; g.add(m); }
  const head = buildHead(T, M, skin); head.applyMatrix4(spine.matrix(0)); g.add(head);
  // rider sits just behind the crest
  const RS = 22.5; let top = 0; for (let a = 0.47; a <= 0.53; a += 0.01) for (let s = RS - 1.7; s <= RS + 1.7; s += 0.3) top = Math.max(top, skin.h(a, s / SKIN.LEN));
  const rider = buildRider(); rider.applyMatrix4(spine.matrix(RS, WR * 1.03 + top - 0.25)); g.add(rider);
  // sand heaved up where the body leaves the ground
  {
    let ex = spine.P[0]; for (const P of spine.P) if (Math.abs(P.y - 4) < Math.abs(ex.y - 4)) ex = P;
    const mg = new THREE.CircleGeometry(48, 96); mg.rotateX(-Math.PI / 2);
    const p = mg.attributes.position, uv = mg.attributes.uv;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), d = Math.hypot(x, z) / 48; p.setY(i, 6 * Math.pow(Math.max(0, 1 - d), 1.4) * (0.5 + fbm2(x * 0.09, z * 0.09, 3)) - 0.3); uv.setXY(i, x / 2.6, z / 2.6); }
    mg.computeVertexNormals();
    const mound = new THREE.Mesh(mg, std({ color: SAND, roughness: 0.95, normalMap: T.sandNrm, normalScale: new THREE.Vector2(0.55, 0.55) })); mound.position.set(ex.x, 0, ex.z); mound.receiveShadow = mound.castShadow = true; g.add(mound);
  }
  g.userData.tick = (t) => { head.userData.open(0.02 + 0.36 * Math.sin(t * 0.6)); rider.userData.tick(t); };
  return g;
}
