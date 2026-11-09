// Live worm: the canonical body is bent along a moving spine in the vertex shader, and a small
// simulation lays that spine down behind the head like a trail.
import * as THREE from 'three';
import { WR, bodyGeo, crestGeo, buildHead, wormMats } from './worm.js';
import { bakeWormSkin, SKIN } from './wormskin.js';
import { buildRider } from './rider.js';
import { ground } from './world.js';

export const STEP = 0.5, RIDER_S = 22.5;
const PARS = /* glsl */`
uniform sampler2D tSpine; uniform float uSpineStep,uSpineN,uWTime,uPulse;
vec3 gBP,gBT,gBN,gBB; float gAhead;
void spineFrame(float z){
  float f=clamp(-z/uSpineStep,0.,uSpineN-1.001), i=floor(f), t=f-i; int k=int(i);
  gBP=mix(texelFetch(tSpine,ivec2(k,0),0).xyz,texelFetch(tSpine,ivec2(k+1,0),0).xyz,t);
  gBT=normalize(mix(texelFetch(tSpine,ivec2(k,1),0).xyz,texelFetch(tSpine,ivec2(k+1,1),0).xyz,t));
  gBN=normalize(mix(texelFetch(tSpine,ivec2(k,2),0).xyz,texelFetch(tSpine,ivec2(k+1,2),0).xyz,t));
  gBB=normalize(cross(gBN,gBT)); gAhead=max(z,0.);
}`;
function bendable(mat, U) {
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey?.() ?? '';
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r); Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + PARS)
      .replace('#include <beginnormal_vertex>', 'spineFrame(position.z); vec3 objectNormal=normalize(gBB*normal.x+gBN*normal.y+gBT*normal.z);')
      .replace('#include <begin_vertex>', 'spineFrame(position.z); float gPu=1.+uPulse*sin(position.z*.21+uWTime*2.4); vec3 transformed=gBP+(gBB*position.x+gBN*position.y)*gPu+gBT*gAhead;');
  };
  mat.customProgramCacheKey = () => prevKey + 'bend';
  return mat;
}

export function buildWormRig(T, L = 150) {
  const skin = bakeWormSkin(T.renderer, Math.PI * 2 * WR), M = wormMats(T, skin), N = Math.round(L / STEP) + 1;
  const data = new Float32Array(N * 3 * 4), tex = new THREE.DataTexture(data, N, 3, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.needsUpdate = true;
  const U = { tSpine: { value: tex }, uSpineStep: { value: STEP }, uSpineN: { value: N }, uWTime: { value: 0 }, uPulse: { value: 0.013 } };
  const g = new THREE.Group(), depth = () => bendable(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), U);
  const body = new THREE.Mesh(bodyGeo(skin, L), bendable(M.makeHide('B'), U)), crest = new THREE.Mesh(crestGeo(), bendable(M.makePlate('pB'), U));
  for (const m of [body, crest]) { m.castShadow = m.receiveShadow = true; m.frustumCulled = false; m.customDepthMaterial = depth(); g.add(m); }
  const head = buildHead(T, M, skin), rider = buildRider(); head.matrixAutoUpdate = rider.matrixAutoUpdate = false; g.add(head, rider);
  let top = 0; for (let a = 0.47; a <= 0.53; a += 0.01) for (let s = RIDER_S - 1.7; s <= RIDER_S + 1.7; s += 0.3) top = Math.max(top, skin.h(a, s / SKIN.LEN));
  const lift = WR * 1.03 + top - 0.25;
  const P = Array.from({ length: N }, () => new THREE.Vector3()), Tn = Array.from({ length: N }, () => new THREE.Vector3()), Nn = Array.from({ length: N }, () => new THREE.Vector3());
  const B = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), m4 = new THREE.Matrix4();
  const frameM = (i, liftN) => { B.crossVectors(Nn[i], Tn[i]).normalize(); return m4.makeBasis(B, Nn[i], Tn[i]).setPosition(P[i].x + Nn[i].x * liftN, P[i].y + Nn[i].y * liftN, P[i].z + Nn[i].z * liftN); };
  return {
    group: g, head, rider, P, T: Tn, N: Nn, n: N, L, lift,
    update(sim, t) {
      for (let i = 0; i < N; i++) sim.pointAt(i * STEP, P[i]);
      for (let i = 0; i < N; i++) {
        if (i === 0) Tn[0].copy(P[0]).sub(P[1]); else if (i === N - 1) Tn[i].copy(P[i - 1]).sub(P[i]); else Tn[i].copy(P[i - 1]).sub(P[i + 1]);
        if (Tn[i].lengthSq() < 1e-8) Tn[i].copy(sim.fwd); Tn[i].normalize();
        Nn[i].copy(UP).addScaledVector(Tn[i], -UP.dot(Tn[i])); if (Nn[i].lengthSq() < 1e-4) Nn[i].copy(i ? Nn[i - 1] : UP); Nn[i].normalize();
        let k = i * 4; data[k] = P[i].x; data[k + 1] = P[i].y; data[k + 2] = P[i].z;
        k = (N + i) * 4; data[k] = Tn[i].x; data[k + 1] = Tn[i].y; data[k + 2] = Tn[i].z;
        k = (2 * N + i) * 4; data[k] = Nn[i].x; data[k + 1] = Nn[i].y; data[k + 2] = Nn[i].z;
      }
      tex.needsUpdate = true; U.uWTime.value = t;
      head.matrix.copy(frameM(0, 0)); head.matrixWorldNeedsUpdate = true;
      rider.matrix.copy(frameM(Math.round(RIDER_S / STEP), lift)); rider.matrixWorldNeedsUpdate = true;
      rider.userData.tick(t, 1.6);
    },
    riderPos(o) { const i = Math.round(RIDER_S / STEP); return o.copy(P[i]).addScaledVector(Nn[i], lift + 1.6); },
  };
}

// Head motion and the trail the body follows.
export class WormSim {
  constructor(x, z, yaw, L) {
    this.R = WR; this.yaw = yaw; this.speed = 38; this.d0 = WR * 0.34; this.d = this.d0; this.vy = 0; this.state = 'ride'; this.charge = 0;
    this.pos = new THREE.Vector3(x, ground(x, z) + this.d, z); this.fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)); this.gy = ground(x, z);
    this.cap = Math.round(L / STEP) + 8; this.trail = []; this.rem = 0; this.events = [];
    for (let i = 1; i <= this.cap; i++) { const px = x - this.fwd.x * i * STEP, pz = z - this.fwd.z * i * STEP; this.trail.push(new THREE.Vector3(px, ground(px, pz) + this.d, pz)); }
    this._prev = this.pos.clone();
  }
  update(dt, steer, dive) {
    this.yaw += steer * 0.62 * dt * (this.state === 'air' ? 0.45 : 1);
    const hx = Math.sin(this.yaw), hz = Math.cos(this.yaw), R = this.R;
    this.pos.x += hx * this.speed * dt; this.pos.z += hz * this.speed * dt;
    this.gy += (ground(this.pos.x, this.pos.z) - this.gy) * Math.min(1, dt * 5);
    if (this.state !== 'air') {
      if (dive) { if (this.state !== 'dive') { this.state = 'dive'; this.events.push('dive'); } this.charge = Math.min(1, this.charge + dt * 0.55); }
      else if (this.state === 'dive') {
        if (this.d < -R * 0.8) { this.state = 'air'; this.vy = 36 + 17 * this.charge; this.events.push('breach'); } else this.state = 'ride';
        this.charge = 0;
      }
    }
    if (this.state === 'air') {
      this.vy -= 27 * dt; this.d += this.vy * dt;
      if (this.vy < 0 && this.d <= this.d0 + 1) { this.state = 'ride'; this.events.push('land'); }
    } else {
      const target = this.state === 'dive' ? -R * 1.8 : this.d0, k = this.state === 'dive' ? 5.5 : 7, c = 2 * Math.sqrt(k) * (this.state === 'dive' ? 1 : 0.8);
      this.vy += (-k * (this.d - target) - c * this.vy) * dt; this.d += this.vy * dt;
    }
    this.pos.y = this.gy + this.d;
    this.fwd.copy(this.pos).sub(this._prev); if (this.fwd.lengthSq() > 1e-8) this.fwd.normalize(); else this.fwd.set(hx, 0, hz);
    this._prev.copy(this.pos);
    // lay the trail at fixed spacing
    let head = this.trail[0], gap = head.distanceTo(this.pos);
    while (gap >= STEP) {
      const p = this.trail.pop(); p.copy(head).lerp(this.pos, STEP / gap);
      this.trail.unshift(p); head = p; gap = head.distanceTo(this.pos);
    }
    this.rem = gap;
  }
  pointAt(s, o) {
    if (s <= this.rem) return this.rem < 1e-5 ? o.copy(this.pos) : o.copy(this.pos).lerp(this.trail[0], s / this.rem);
    const f = Math.min((s - this.rem) / STEP, this.trail.length - 1.001), i = Math.floor(f);
    return o.copy(this.trail[i]).lerp(this.trail[i + 1], f - i);
  }
}
