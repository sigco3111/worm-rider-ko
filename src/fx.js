// Particles (dust, sparks), flying wreckage and the furrow the worm ploughs into the sand.
import * as THREE from 'three';
import { ground } from './world.js';
import { std, SAND } from './mats.js';
import { boulderGeo } from './rock.js';
import { wheelGeos } from './truck.js';

export class Particles {
  constructor(max, T, fog, additive = false) {
    this.max = max; this.cur = 0;
    this.p = new Float32Array(max * 3); this.v = new Float32Array(max * 3); this.sa = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.life = new Float32Array(max).fill(1e9); this.ttl = new Float32Array(max).fill(1); this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max); this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSA', new THREE.BufferAttribute(this.sa, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.u = { uScale: { value: 1 }, uNz: { value: T.noise }, uFogC: { value: fog.color }, uFogD: { value: fog.density } };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */`attribute vec3 aSA,aCol; uniform float uScale; varying vec3 vC; varying float vA,vSeed,vD;
        void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); vC=aCol; vA=aSA.y; vSeed=aSA.z; vD=-mv.z;
          gl_PointSize=min(aSA.x*uScale/max(-mv.z,1.),460.); gl_Position=aSA.y<=.002?vec4(2.,2.,2.,1.):projectionMatrix*mv; }`,
      fragmentShader: /* glsl */`uniform sampler2D uNz; uniform vec3 uFogC; uniform float uFogD; varying vec3 vC; varying float vA,vSeed,vD;
        void main(){ vec2 c=gl_PointCoord-.5; float r=length(c)*2.; if(r>1.) discard;
          float a=cos(vSeed*6.283),s=sin(vSeed*6.283); vec2 q=mat2(a,-s,s,a)*c;
          float n=texture2D(uNz,q*.5+vSeed*7.).r;
          ${additive ? 'float al=pow(1.-r,2.2)*vA; vec3 col=vC;' : 'float al=pow(1.-r,1.3)*smoothstep(.12,.72,n+(1.-r)*.5)*vA; vec3 col=vC*(.78+.5*n);'}
          col=mix(col,uFogC,${additive ? '0.' : '1.-exp(-uFogD*uFogD*vD*vD)'}); gl_FragColor=vec4(col,al); }`,
    }));
    this.points.frustumCulled = false; this.points.renderOrder = additive ? 6 : 5;
  }
  spawn(x, y, z, vx, vy, vz, ttl, s0, s1, alpha, r, g, b, grav = 0, drag = 0) {
    const i = this.cur; this.cur = (i + 1) % this.max; const k = i * 3;
    this.p[k] = x; this.p[k + 1] = y; this.p[k + 2] = z; this.v[k] = vx; this.v[k + 1] = vy; this.v[k + 2] = vz;
    this.life[i] = 0; this.ttl[i] = ttl; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = alpha; this.grav[i] = grav; this.drag[i] = drag;
    this.col[k] = r; this.col[k + 1] = g; this.col[k + 2] = b; this.sa[k + 2] = Math.random();
  }
  update(dt, scale) {
    const { p, v, sa, life, ttl, max } = this; this.u.uScale.value = scale;
    for (let i = 0; i < max; i++) {
      const k = i * 3; if (life[i] >= ttl[i]) { sa[k + 1] = 0; continue; }
      life[i] += dt; const t = Math.min(1, life[i] / ttl[i]), dr = Math.max(0, 1 - this.drag[i] * dt);
      v[k] *= dr; v[k + 1] = v[k + 1] * dr - this.grav[i] * dt; v[k + 2] *= dr;
      p[k] += v[k] * dt; p[k + 1] += v[k + 1] * dt; p[k + 2] += v[k + 2] * dt;
      sa[k] = this.s0[i] + (this.s1[i] - this.s0[i]) * Math.sqrt(t); sa[k + 1] = this.a0[i] * Math.min(1, t * 12) * Math.pow(1 - t, 1.4);
    }
    const a = this.points.geometry.attributes; a.position.needsUpdate = a.aSA.needsUpdate = a.aCol.needsUpdate = true;
  }
}

// rigid chunks thrown out of a destroyed hauler
export class Debris {
  constructor(T) {
    const W = wheelGeos(), mk = (geo, mat, n) => { const m = new THREE.InstancedMesh(geo, mat, n); m.castShadow = true; m.frustumCulled = false; m.count = n; return m; };
    this.sets = [
      { mesh: mk(new THREE.BoxGeometry(1, 1, 1), std({ color: 0x24272b, metalness: 0.45, roughness: 0.5 }), 90), scale: () => [0.6 + Math.random() * 3.2, 0.15 + Math.random() * 1.1, 0.5 + Math.random() * 2.2] },
      { mesh: mk(W.tyre, std({ color: 0x0c0c0d, roughness: 0.9 }), 24), scale: () => [1, 1, 1] },
      { mesh: mk(boulderGeo(31), std({ color: 0x545c68, metalness: 0.3, roughness: 0.6 }), 70), scale: () => { const s = 0.25 + Math.random() * 0.8; return [s, s, s]; } },
    ];
    this.group = new THREE.Group(); this.items = [];
    const hide = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const s of this.sets) { s.cur = 0; s.n = s.mesh.count; for (let i = 0; i < s.n; i++) s.mesh.setMatrixAt(i, hide); this.group.add(s.mesh); }
    this.q = new THREE.Quaternion(); this.m = new THREE.Matrix4(); this.ax = new THREE.Vector3(); this.sv = new THREE.Vector3();
  }
  burst(x, y, z, vx, vz, counts = [16, 5, 14]) {
    this.sets.forEach((s, si) => {
      for (let k = 0; k < counts[si]; k++) {
        const i = s.cur; s.cur = (i + 1) % s.n; const a = Math.random() * 6.283, sp = 6 + Math.random() * 22;
        this.items.push({ s, i, p: new THREE.Vector3(x + (Math.random() - 0.5) * 8, y + Math.random() * 3, z + (Math.random() - 0.5) * 8), v: new THREE.Vector3(vx * 0.5 + Math.cos(a) * sp, 12 + Math.random() * 30, vz * 0.5 + Math.sin(a) * sp),
          q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize(), Math.random() * 6), w: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14), sc: s.scale(), t: 0 });
      }
    });
  }
  update(dt) {
    for (let n = this.items.length - 1; n >= 0; n--) {
      const it = this.items[n]; it.t += dt; it.v.y -= 30 * dt; it.p.addScaledVector(it.v, dt);
      const gy = ground(it.p.x, it.p.z) + 0.4 * it.sc[1];
      if (it.p.y < gy) { it.p.y = gy; if (it.v.y < 0) it.v.y *= -0.32; it.v.x *= 0.7; it.v.z *= 0.7; it.w.multiplyScalar(0.6); }
      const wl = it.w.length(); if (wl > 1e-3) { this.q.setFromAxisAngle(this.ax.copy(it.w).divideScalar(wl), wl * dt); it.q.premultiply(this.q); }
      const k = it.t > 5 ? Math.max(0, 1 - (it.t - 5) / 1.2) : 1;
      it.s.mesh.setMatrixAt(it.i, this.m.compose(it.p, it.q, this.sv.set(it.sc[0] * k, it.sc[1] * k, it.sc[2] * k))); it.s.mesh.instanceMatrix.needsUpdate = true;
      if (k <= 0) this.items.splice(n, 1);
    }
  }
}

// a ribbon of heaved sand laid where the worm runs at the surface
export class Furrow {
  constructor(T, S = 260) {
    this.S = S; this.prof = [[-1.6, 0.04, 1], [-1.18, 1, 1.06], [-0.84, 0.3, 0.78], [0, 0.07, 0.66], [0.84, 0.3, 0.78], [1.18, 1, 1.06], [1.6, 0.04, 1]]; const W = this.prof.length;
    this.pos = new Float32Array(S * W * 3); this.col = new Float32Array(S * W * 3).fill(1); this.uv = new Float32Array(S * W * 2); this.n = 0;
    const idx = []; for (let i = 0; i < S - 1; i++) for (let j = 0; j < W - 1; j++) { const a = i * W + j, b = a + W; idx.push(a, a + 1, b, a + 1, b + 1, b); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage)); g.setIndex(idx); g.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(g, std({ color: SAND, vertexColors: true, roughness: 0.96, normalMap: T.sandNrm, normalScale: new THREE.Vector2(0.7, 0.7), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.mesh.receiveShadow = true; this.mesh.frustumCulled = false; this.last = null;
  }
  _row(fill) {
    const W = this.prof.length, row = W * 3;
    this.pos.copyWithin(row, 0, (this.S - 1) * row); this.col.copyWithin(row, 0, (this.S - 1) * row); this.uv.copyWithin(W * 2, 0, (this.S - 1) * W * 2);
    for (let j = 0; j < W; j++) fill(j);
    this.n = Math.min(this.S, this.n + 1);
  }
  // w: half width of the cut, k: 0..1 how hard the body is ploughing
  add(x, z, dx, dz, w, k) {
    if (this.last && Math.hypot(x - this.last[0], z - this.last[1]) < 2.4) return;
    const W = this.prof.length, pt = (j, px, py, pz, c) => { this.pos[j * 3] = px; this.pos[j * 3 + 1] = py; this.pos[j * 3 + 2] = pz; this.col[j * 3] = this.col[j * 3 + 1] = this.col[j * 3 + 2] = c; this.uv[j * 2] = px / 2.6; this.uv[j * 2 + 1] = pz / 2.6; };
    // a stroke starts and ends in a collapsed row, so separate strokes are joined only by zero-area triangles
    if (!this.last) { const gy = ground(x, z) - 0.6; this._row((j) => pt(j, x, gy, z, 1)); }
    this.last = [x, z];
    this._row((j) => { const [o, h, c] = this.prof[j], px = x + dz * o * w, pz = z - dx * o * w; pt(j, px, ground(px, pz) + h * (0.5 + 1.5 * k) * Math.min(1, w / 6), pz, c); });
    const g = this.mesh.geometry; g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = g.attributes.uv.needsUpdate = true;
    g.setDrawRange(0, Math.max(0, this.n - 1) * (W - 1) * 6); g.computeVertexNormals();
  }
  cut() {
    if (!this.last) return; const [x, z] = this.last, gy = ground(x, z) - 0.6, W = this.prof.length; this.last = null;
    this._row((j) => { this.pos[j * 3] = x; this.pos[j * 3 + 1] = gy; this.pos[j * 3 + 2] = z; });
    const g = this.mesh.geometry; g.attributes.position.needsUpdate = true; g.setDrawRange(0, Math.max(0, this.n - 1) * (W - 1) * 6);
  }
}
