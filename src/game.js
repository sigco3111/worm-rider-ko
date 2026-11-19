// Worm Rider: one scene, one loop. Ride the worm around the ring road and eat the haulers
// before they make it back through the gate.
import * as THREE from 'three';
import { makeTextures } from './tex.js';
import { makeEnv, makeGamePost, setSun, SUN } from './env.js';
import { buildWorld, ground, PATH, RR } from './world.js';
import { buildWormRig, WormSim } from './wormrig.js';
import { WR } from './worm.js';
import { Convoy } from './convoy.js';
import { Particles, Debris, Furrow } from './fx.js';
import { Sound } from './audio.js';

const $ = (id) => document.getElementById(id), V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x)), lerp = (a, b, t) => a + (b - a) * t, rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const angd = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const count = (rate, dt) => Math.floor(rate * dt + Math.random());            // frame-rate independent emission
const stage = async (msg) => { $('loadmsg').textContent = msg; await new Promise((r) => setTimeout(r, 30)); };
const Q = new URLSearchParams(location.search);

/* ------------------------------------------------------------ renderer */
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('stage').appendChild(renderer.domElement);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.6, 40000);
scene.fog = new THREE.FogExp2(new THREE.Color(0.84, 0.71, 0.52), 0.0005);
setSun(-125, 26);

await stage('텍스처 굽는 중');
const T = makeTextures(renderer); T.renderer = renderer;
let backdrop = null;
try { backdrop = await new THREE.TextureLoader().loadAsync('./assets/backdrop.webp'); backdrop.colorSpace = THREE.SRGBColorSpace; backdrop.wrapS = backdrop.wrapT = THREE.ClampToEdgeWrapping; backdrop.anisotropy = 8; } catch (e) { console.warn('backdrop missing', e); }
const env = makeEnv(renderer, scene, { backdrop, shadowSize: 3072 }); env.sun.shadow.normalBias = 0.16; env.sun.shadow.bias = -0.0004; env.sun.shadow.radius = 2;
await stage('협곡 쌓아 올리는 중');
const world = buildWorld(T); scene.add(world.group);
await stage('웜 깨우는 중');
const rig = buildWormRig(T, 150); scene.add(rig.group);
const a0 = -48 * Math.PI / 180, sim = new WormSim(Math.cos(a0) * (RR + 80), Math.sin(a0) * (RR + 80), Math.atan2(Math.sin(a0), -Math.cos(a0)), 150);
await stage('운반대 준비 중');
const convoy = new Convoy(T, 6); scene.add(convoy.group);
const dust = new Particles(7000, T, scene.fog), sparks = new Particles(1400, T, scene.fog, true), debris = new Debris(T), furrow = new Furrow(T);
scene.add(dust.points, sparks.points, debris.group, furrow.mesh);
const post = makeGamePost(renderer, scene, camera, { bloomStrength: 0.28 });
const sound = new Sound();

// Internal resolution: never more than about 1080p worth of pixels, and it backs off further if frames run long.
const MAXPX = +(Q.get('px') || 1920 * 1080); let cssW = 16, cssH = 9, dyn = 1, applied = 0;
function applyScale() {
  const pr = Math.min(devicePixelRatio, Math.sqrt(MAXPX / (cssW * cssH))) * dyn; if (Math.abs(pr - applied) < 0.01) return; applied = pr;
  renderer.setPixelRatio(pr); renderer.setSize(cssW, cssH); post.setSize(Math.round(cssW * pr), Math.round(cssH * pr));
}
function resize() {
  let w = innerWidth, h = innerHeight; if (w / h > 16 / 9) w = Math.round(h * 16 / 9); else h = Math.round(w * 9 / 16);
  if (w < 8 || h < 8) return; cssW = w; cssH = h; applied = 0; applyScale();
  $('frame').style.width = w + 'px'; $('frame').style.height = h + 'px';
}
addEventListener('resize', resize); resize();

/* --------------------------------------------------------------- input */
const keys = new Set(), orbit = { yaw: 0, pitch: 0, zoom: 1, drag: false, x: 0, y: 0 }; let auto = Q.get('auto') !== '0', idle = 0, started = false;
const manual = () => { if (auto) { auto = false; $('auto').classList.remove('on'); } idle = 0; };
const begin = () => { if (started) return; started = true; sound.start(); $('title').classList.add('gone'); };
addEventListener('keydown', (e) => {
  if (e.repeat) return; begin(); keys.add(e.code);
  if (['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) { manual(); e.preventDefault(); }
  if (e.code === 'KeyP') { auto = !auto; $('auto').classList.toggle('on', auto); }
  if (e.code === 'KeyM') $('mute').textContent = sound.toggle() ? 'M · 소리 꺼짐' : 'M · 소리 켜짐';
  if (e.code === 'KeyC') triggerWide(2.8, 110);
  if (e.code === 'KeyH') $('frame').classList.toggle('clean');
  if (e.code === 'KeyV') { orbit.yaw = orbit.pitch = 0; orbit.zoom = 1; }
});
addEventListener('keyup', (e) => keys.delete(e.code));
// drag to look around the worm, wheel to move in and out, double-click to reset the view
addEventListener('pointerdown', (e) => { if (!started) { begin(); return; } orbit.drag = true; orbit.x = e.clientX; orbit.y = e.clientY; });
addEventListener('pointermove', (e) => {
  if (!orbit.drag) return; orbit.yaw -= (e.clientX - orbit.x) * 0.0052; orbit.pitch = clamp(orbit.pitch + (e.clientY - orbit.y) * 0.004, -0.6, 1.0); orbit.x = e.clientX; orbit.y = e.clientY;
});
addEventListener('pointerup', () => { orbit.drag = false; }); addEventListener('pointercancel', () => { orbit.drag = false; });
addEventListener('wheel', (e) => { e.preventDefault(); orbit.zoom = clamp(orbit.zoom * Math.exp(e.deltaY * 0.0011), 0.28, 3.4); }, { passive: false });
addEventListener('dblclick', () => { orbit.yaw = orbit.pitch = 0; orbit.zoom = 1; });

/* ----------------------------------------------------------- autopilot */
const ai = { dive: false, cool: 2, t: 0, prev: 1e9, closing: 0 }, tv = V(), tv2 = V(), hf = V();
function avoidance(yaw) {
  const fx = Math.sin(yaw), fz = Math.cos(yaw); let add = 0;
  for (const o of world.obstacles) {
    const dx = o.x - sim.pos.x, dz = o.z - sim.pos.z, ahead = dx * fx + dz * fz; if (ahead < -30 || ahead > 210 + o.r) continue;
    const side = dx * fz - dz * fx, clear = o.r + WR + 30; if (Math.abs(side) > clear) continue;
    add += (side > 0 ? -1 : 1) * (1 - Math.abs(side) / clear) * (1 - Math.max(0, ahead - o.r) / 210) * 2.6;
  }
  const rad = Math.hypot(sim.pos.x, sim.pos.z); if (rad > 1050) add += clamp(angd(Math.atan2(-sim.pos.x, -sim.pos.z), yaw) * 1.5, -1.5, 1.5) * (rad - 1050) / 80;
  return add;
}
function nearestTruck() {
  let best = null, bd = 1e9;
  for (const k of convoy.trucks) { if (!k.alive || k.u < 90 || k.u > PATH.L - 150) continue; const d = k.pos.distanceTo(sim.pos); if (d < bd) { bd = d; best = k; } }
  return best ? { k: best, d: bd } : null;
}
// bearing error to where the truck will be when the worm gets there
function bearing(n) { const lead = clamp(n.d / 46, 0, 2.4); tv.copy(n.k.pos).addScaledVector(n.k.vel, lead); return angd(Math.atan2(tv.x - sim.pos.x, tv.z - sim.pos.z), sim.yaw); }
function autopilot(dt, n) {
  let want;
  if (n) {
    want = sim.yaw + bearing(n); const err = Math.abs(angd(want, sim.yaw)); ai.cool -= dt;
    if (!ai.dive && ai.cool <= 0 && n.d > 105 && n.d < 280 && err < 0.5 && sim.state === 'ride') { ai.dive = true; ai.t = 0; }
    // surface right under the hauler: let go when contact is well under a second away
    if (ai.dive) { ai.t += dt; if (n.d < Math.max(30, ai.closing * 0.72) || ai.t > 5) { ai.dive = false; ai.cool = rand(5, 9); } }
  } else {
    const a = Math.atan2(sim.pos.z, sim.pos.x) - 0.35, r = RR + 60; want = Math.atan2(Math.cos(a) * r - sim.pos.x, Math.sin(a) * r - sim.pos.z); ai.dive = false;
  }
  return { steer: clamp(angd(want, sim.yaw) * 2.4 + avoidance(sim.yaw), -1, 1), dive: ai.dive };
}

/* ---------------------------------------------------------------- game */
const SANDC = [0.74, 0.44, 0.27];
const puff = (x, y, z, vx, vy, vz, ttl, s0, s1, a, k = 1, grav = 2, drag = 0.9) => dust.spawn(x, y, z, vx, vy, vz, ttl, s0, s1, a, SANDC[0] * k, SANDC[1] * k, SANDC[2] * k, grav, drag);
function burst(x, z, n, power, big = 0) {
  const gy = ground(x, z);
  for (let i = 0; i < n; i++) { const a = rand(0, 6.283), sp = rand(6, 30) * power, r = rand(0, WR); puff(x + Math.cos(a) * r, gy + rand(0, 3), z + Math.sin(a) * r, Math.cos(a) * sp, rand(14, 52) * power, Math.sin(a) * sp, rand(1.6, 3.4), rand(4, 9), rand(14, 30), rand(0.25, 0.42), rand(0.8, 1.12), 24, 0.5); }
  for (let i = 0; i < big; i++) { const a = rand(0, 6.283), r = rand(0, WR * 1.5); puff(x + Math.cos(a) * r, gy + rand(1, 8), z + Math.sin(a) * r, Math.cos(a) * rand(2, 9), rand(3, 11), Math.sin(a) * rand(2, 9), rand(3.5, 6), rand(16, 26), rand(40, 64), rand(0.12, 0.2), rand(0.8, 1.05), 0.5, 0.5); }
}
let time = 0, timeScale = 1, stopT = 0, slowT = 0, jaw = 0.1, jawSnap = 0, toastT = 0, hornT = 6, cineFlip = false;
const B = V(), mouth = V(), cc = V();
function eat(k, crushed) {
  cc.copy(k.pos); cc.y += 2; const mode = k.cineMode; k.cineMode = null; convoy.kill(k);
  debris.burst(cc.x, cc.y, cc.z, k.vel.x, k.vel.z);
  for (let i = 0; i < 110; i++) { const a = rand(0, 6.283), sp = rand(4, 26); puff(cc.x + rand(-5, 5), cc.y + rand(-1, 4), cc.z + rand(-5, 5), Math.cos(a) * sp + k.vel.x * 0.4, rand(4, 26), Math.sin(a) * sp + k.vel.z * 0.4, rand(1.6, 3.6), rand(4, 8), rand(16, 30), rand(0.22, 0.36), rand(0.5, 1.05), 8, 0.7); }
  for (let i = 0; i < 130; i++) { const a = rand(0, 6.283), sp = rand(10, 60), h = rand(1.2, 3.6); sparks.spawn(cc.x, cc.y, cc.z, Math.cos(a) * sp, rand(6, 48), Math.sin(a) * sp, rand(0.35, 1.1), rand(1.2, 2.6), 0.3, 1, 2.2 * h, 0.9 * h, 0.25 * h, 34, 0.4); }
  sound.crunch(); stopT = 0.09; slowT = 1.1; cam.shake = Math.max(cam.shake, 1.2); jawSnap = 0.4;
  $('toast').textContent = `운반차 ${String(k.g.userData.id).padStart(2, '0')} · ${crushed ? '파괴' : '포식'}`; $('toast').classList.add('on'); toastT = 2.2;
  if (cam.mode === 'truck' && cam.truck === k) { cam.frozen = true; cam.cineT = 1.5; }
  else if (!cam.mode && cam.cool <= 0 && mode !== 'truck') triggerWide(2.4, 78);
}

/* -------------------------------------------------------------- camera */
const cam = { pos: V(), look: V(), cpos: V(), clook: V(), cinePos: V(), cineLook: V(), mode: null, truck: null, side: 1, frozen: false, cineT: 0, cineW: 0, fov: 33, shake: 0, cool: 0, init: false, focus: 40, ap: 0.3, flare: 0 };
const rp = V(), wantP = V(), wantL = V(), pivot = V();
// wide tracking shot from the sunlit side, with a clear line of sight over the dunes
function triggerWide(dur, dist) {
  const fx = Math.sin(sim.yaw), fz = Math.cos(sim.yaw); let best = null, bs = -1e9;
  for (const s of [1, -1]) {
    tv.set(sim.pos.x + fx * sim.speed * 1.35 + fz * s * dist, 0, sim.pos.z + fz * sim.speed * 1.35 - fx * s * dist);
    let score = (fz * s * SUN.x - fx * s * SUN.z) * 60;
    for (const o of world.obstacles) score = Math.min(score, Math.hypot(o.x - tv.x, o.z - tv.z) - o.r - 30 + score * 0.2);
    if (score > bs) { bs = score; best = tv.clone(); }
  }
  best.y = ground(best.x, best.z) + rand(9, 16);
  const ax = sim.pos.x + fx * sim.speed * 1.35, az = sim.pos.z + fz * sim.speed * 1.35, ay = ground(ax, az) + 5;
  for (let i = 1; i < 8; i++) { const t = i / 8, need = ground(lerp(best.x, ax, t), lerp(best.z, az, t)) + 3 - lerp(0, ay, t); best.y = Math.max(best.y, need / (1 - t)); }
  cam.cinePos.copy(best); cam.cineLook.copy(sim.pos); cam.mode = 'wide'; cam.cineT = dur; cam.fov = 33; cam.cool = dur + 4;
}
// ride along with the hauler that is about to be eaten
function triggerTruck(k) {
  cam.mode = 'truck'; cam.truck = k; cam.frozen = false; cam.fresh = true; cam.cineT = 5.5; cam.fov = 46; cam.cool = 9;
  cam.side = Math.random() < 0.5 ? 1 : -1; cam.cineLook.copy(k.pos);
}
function updateCamera(rdt) {
  hf.set(Math.sin(sim.yaw), 0, Math.cos(sim.yaw)); rig.riderPos(rp);
  // chase rig: an orbit around the rider that the mouse can swing and the wheel can pull in or out
  const under = sim.d < -WR * 0.75;
  if (under) pivot.set(sim.pos.x, sim.gy + 3, sim.pos.z); else pivot.copy(rp).lerp(tv.copy(sim.pos).setY(sim.pos.y + WR), 0.22);
  const dist = (under ? 58 : 46) * orbit.zoom, pitch = clamp(0.37 + orbit.pitch, -0.2, 1.4), a = sim.yaw + Math.PI + orbit.yaw;
  wantP.set(pivot.x + Math.sin(a) * Math.cos(pitch) * dist, pivot.y + Math.sin(pitch) * dist, pivot.z + Math.cos(a) * Math.cos(pitch) * dist);
  const ahead = (under ? 30 : 40) * Math.max(0, Math.cos(orbit.yaw)) * clamp(orbit.zoom * 1.3 - 0.3);
  wantL.copy(pivot).addScaledVector(hf, ahead); wantL.y -= under ? 0 : ahead * 0.14;
  wantP.y = Math.max(wantP.y, ground(wantP.x, wantP.z) + 3.5);
  if (!cam.init) { cam.cpos.copy(wantP); cam.clook.copy(wantL); cam.init = true; }
  cam.cpos.lerp(wantP, 1 - Math.exp(-rdt * (orbit.drag ? 7 : 3.8))); cam.clook.lerp(wantL, 1 - Math.exp(-rdt * 6.5));
  // cinematic rigs
  cam.cineT -= rdt; cam.cool -= rdt;
  if (cam.mode === 'truck') {
    const k = cam.truck;
    if (!cam.frozen && k.alive) {
      let ax = k.pos.x - sim.pos.x, az = k.pos.z - sim.pos.z; const al = Math.hypot(ax, az) || 1; ax /= al; az /= al;
      tv2.set(k.pos.x + ax * 13 + az * cam.side * 4.6, k.pos.y + 2.3, k.pos.z + az * 13 - ax * cam.side * 4.6);
      if (cam.fresh) { cam.cinePos.copy(tv2); cam.fresh = false; } else cam.cinePos.lerp(tv2, 1 - Math.exp(-rdt * 7));
      tv.copy(k.pos).setY(k.pos.y + 2.6).lerp(tv2.copy(sim.pos).setY(Math.max(sim.pos.y, sim.gy + 6)), 0.3);
      if (k.pos.distanceTo(sim.pos) > 190) cam.cineT = Math.min(cam.cineT, 0.01);
    } else { if (!cam.frozen) { cam.frozen = true; cam.cineT = Math.min(cam.cineT, 1.2); } tv.copy(sim.pos).setY(Math.max(sim.pos.y, sim.gy + 6)); }
    cam.cinePos.y = Math.max(cam.cinePos.y, ground(cam.cinePos.x, cam.cinePos.z) + 1.6);
  } else tv.copy(sim.pos).addScaledVector(hf, 10).setY(Math.max(sim.pos.y, sim.gy + 6));
  cam.cineLook.lerp(tv, 1 - Math.exp(-rdt * 9));
  if (cam.cineT <= 0 && cam.mode) cam.mode = null;
  cam.cineW += ((cam.mode ? 1 : 0) - cam.cineW) * Math.min(1, rdt * (cam.mode ? 6 : 2.6));
  const w = cam.cineW * cam.cineW * (3 - 2 * cam.cineW);
  cam.pos.copy(cam.cpos).lerp(cam.cinePos, w); cam.look.copy(cam.clook).lerp(cam.cineLook, w);
  // never sit inside the worm
  for (let i = 0; i < rig.n; i += 6) { const P = rig.P[i], d = cam.pos.distanceTo(P), min = WR * 1.32; if (d < min && d > 1e-3) cam.pos.addScaledVector(tv2.copy(cam.pos).sub(P).divideScalar(d), min - d); }
  cam.shake *= Math.exp(-rdt * 3.2);
  const sh = cam.shake + 0.05 * (sim.state === 'ride' ? 1 : 0.3) * (1 - w) * clamp(orbit.zoom), tt = performance.now() * 0.001;
  camera.position.set(cam.pos.x + Math.sin(tt * 37) * sh * 0.9, cam.pos.y + Math.sin(tt * 43 + 2) * sh * 0.8, cam.pos.z + Math.sin(tt * 31 + 4) * sh * 0.9);
  camera.lookAt(cam.look.x + Math.sin(tt * 29) * sh * 0.5, cam.look.y + Math.sin(tt * 41) * sh * 0.5, cam.look.z);
  const fov = lerp(57 + (sim.state === 'air' ? 6 : 0), cam.fov, w); if (Math.abs(fov - camera.fov) > 0.01) { camera.fov += (fov - camera.fov) * Math.min(1, rdt * 4); camera.updateProjectionMatrix(); }
  if (window.__freecam) { camera.position.fromArray(window.__freecam.p); camera.lookAt(...window.__freecam.t); }   // review helper
  camera.updateMatrixWorld();
  // lens: focus follows the subject; the cinematic rigs open the aperture
  const subject = cam.mode === 'truck' && !cam.frozen ? cam.truck.pos : cam.mode ? sim.pos : pivot;
  const f = camera.position.distanceTo(subject) * (cam.mode === 'truck' && !cam.frozen ? 1.3 : 1), ap = lerp(orbit.zoom < 0.6 ? 0.7 : 0, cam.mode === 'truck' ? 0.45 : 0.85, w);   // the plain chase view stays sharp and skips the blur cost
  cam.focus += (f - cam.focus) * Math.min(1, rdt * 5); cam.ap += (ap - cam.ap) * Math.min(1, rdt * 4);
  post.dof.u.uFocus.value = cam.focus; post.dof.u.uAperture.value = cam.ap;
  // sun on the lens: flare unless a rock or the worm itself is in the way
  tv.copy(camera.position).addScaledVector(SUN, 5000).project(camera);
  let vis = tv.z < 1 ? clamp((1.3 - Math.max(Math.abs(tv.x), Math.abs(tv.y))) / 0.35) : 0;
  if (vis > 0) {
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z, sl = Math.hypot(SUN.x, SUN.z), sx = SUN.x / sl, sz = SUN.z / sl, tanE = SUN.y / sl;
    for (const o of world.occ) { const vx = o.x - cx, vz = o.z - cz, pr = vx * sx + vz * sz; if (pr <= 0) continue; const perp2 = vx * vx + vz * vz - pr * pr; if (perp2 > o.r * o.r) continue; if (cy + (pr - Math.sqrt(o.r * o.r - perp2)) * tanE < o.top) { vis = 0; break; } }
    if (vis > 0) for (let i = 0; i < rig.n; i += 8) { const P = rig.P[i], vx = P.x - cx, vy = P.y - cy, vz = P.z - cz, t = vx * SUN.x + vy * SUN.y + vz * SUN.z; if (t > 0 && vx * vx + vy * vy + vz * vz - t * t < WR * WR * 0.85) { vis = 0; break; } }
  }
  cam.flare += (vis - cam.flare) * Math.min(1, rdt * 9);
  post.grade.uniforms.uSunVis.value = cam.flare; post.grade.uniforms.uSunUV.value.set(tv.x * 0.5 + 0.5, tv.y * 0.5 + 0.5);
  $('frame').style.setProperty('--bar', (w * 9).toFixed(2) + '%');
}

/* ------------------------------------------------------------ shadows */
const lr = V().crossVectors(V(0, 1, 0), SUN).normalize(), lu = V().crossVectors(SUN, lr).normalize(), SH = 140, texel = SH * 2 / 3072 * 4;
function updateShadow() {
  tv.copy(sim.pos).addScaledVector(hf, 30).lerp(cam.pos, 0.25);
  const a = Math.round(tv.dot(lr) / texel) * texel, b = Math.round(tv.dot(lu) / texel) * texel, c = tv.dot(SUN);
  tv2.set(0, 0, 0).addScaledVector(lr, a).addScaledVector(lu, b).addScaledVector(SUN, c); env.focus(tv2, SH); env.sun.shadow.camera.updateMatrixWorld(); world.update(env.sun, SH);
}

/* ---------------------------------------------------------------- loop */
function step(rdt) {
  if (stopT > 0) { stopT -= rdt; timeScale = 0.05; } else if (slowT > 0) { slowT -= rdt; timeScale += (0.42 - timeScale) * Math.min(1, rdt * 10); } else timeScale += (1 - timeScale) * Math.min(1, rdt * 3);
  const dt = rdt * timeScale; time += dt;
  // control
  idle += rdt; if (!auto && idle > 12) { auto = true; $('auto').classList.add('on'); }
  const n = nearestTruck(); let steer = 0, dive = false;
  if (n) { ai.closing += ((ai.prev - n.d) / Math.max(dt, 1e-3) - ai.closing) * Math.min(1, dt * 4); ai.prev = n.d; } else { ai.prev = 1e9; ai.closing = 0; }
  if (auto) ({ steer, dive } = autopilot(dt, n));
  else {
    // yaw grows toward screen-left in the chase view, so the right key steers negative
    const key = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0); dive = keys.has('Space'); if (key || dive) idle = 0;
    steer = clamp(-key + avoidance(sim.yaw) * 0.6, -1, 1);
  }
  // attack assist: close to a hauler the worm leans into it by itself, and the last metres are magnetic
  let err = 0;
  if (n && n.d < 150) {
    err = bearing(n);
    if (Math.abs(err) < 0.85) { const k = clamp(1.25 - n.d / 150) * (auto ? 1 : 0.8); steer = clamp(steer * (1 - 0.6 * k) + clamp(err * 3.4, -1.3, 1.3) * k, -1.3, 1.3); }
  }
  sim.update(dt, steer, dive);
  if (n && n.d < 44 && Math.abs(err) < 1.1) { hf.set(Math.sin(sim.yaw), 0, Math.cos(sim.yaw)); const dx = n.k.pos.x - sim.pos.x, dz = n.k.pos.z - sim.pos.z, lat = dx * hf.z - dz * hf.x, mv = clamp(lat, -1, 1) * 15 * dt; sim.pos.x += hf.z * mv; sim.pos.z -= hf.x * mv; }
  // solid things push the head out
  for (const o of world.obstacles) { const dx = sim.pos.x - o.x, dz = sim.pos.z - o.z, d = Math.hypot(dx, dz), min = o.r + WR * 0.9; if (d < min && d > 1e-3) { sim.pos.x = o.x + dx / d * min; sim.pos.z = o.z + dz / d * min; const tan = Math.atan2(dz, -dx), alt = tan + Math.PI; sim.yaw += angd(Math.abs(angd(tan, sim.yaw)) < Math.abs(angd(alt, sim.yaw)) ? tan : alt, sim.yaw) * Math.min(1, dt * 6); } }
  rig.update(sim, time);
  hf.set(Math.sin(sim.yaw), 0, Math.cos(sim.yaw));
  // events
  for (const e of sim.events) {
    if (e === 'breach') { burst(sim.pos.x, sim.pos.z, 220, 1, 46); sound.breach(); cam.shake = Math.max(cam.shake, 0.7); if (!cam.mode) triggerWide(3.3, 118); slowT = Math.max(slowT, 0.9); }
    if (e === 'land') { burst(sim.pos.x, sim.pos.z, 240, 1.1, 52); sound.land(); cam.shake = Math.max(cam.shake, 1); }
    if (e === 'dive') { burst(sim.pos.x, sim.pos.z, 100, 0.6, 20); sound.dive(); }
  }
  sim.events.length = 0;
  // jaws: ajar while cruising so the fangs show, wide open near prey and in the air
  const hungry = n && n.d < 130 && Math.abs(err) < 0.8;
  jawSnap -= dt; jaw += ((jawSnap > 0 ? -0.32 : hungry ? 0.46 : sim.state === 'air' ? 0.46 : 0.13 + 0.04 * Math.sin(time * 1.3)) - jaw) * Math.min(1, dt * (jawSnap > 0 ? 22 : sim.state === 'air' ? 11 : 5)); rig.head.userData.open(jaw);
  // convoy
  convoy.update(dt, time, sim);
  mouth.copy(sim.pos).addScaledVector(rig.T[0], WR * 0.8);
  for (const k of convoy.trucks) {
    if (!k.alive || k.u < 20) continue; cc.copy(k.pos); cc.y += 2;
    if (cc.distanceTo(mouth) < 17) { eat(k, false); continue; }
    for (let i = 24; i < rig.n - 60; i += 20) if (rig.P[i].distanceTo(cc) < WR + 1.2) { eat(k, true); break; }
  }
  // every other hauler is filmed from its own point of view as the worm closes in
  if (n && n.k.alive && !cam.mode && cam.cool <= 0 && n.d < 105 && Math.abs(err) < 0.7 && ai.closing > 2) {
    n.k.cineMode ??= (cineFlip = !cineFlip) ? 'truck' : 'wide';
    if (n.k.cineMode === 'truck') triggerTruck(n.k);
  }
  hornT -= dt; if (hornT < 0 && n && n.d < 200) { sound.horn(); hornT = rand(5, 11); }
  // dust
  const surf = Math.abs(sim.d) < WR * 0.98, spd = sim.speed / 38;
  if (surf) {
    const w = Math.sqrt(Math.max(1, WR * WR - sim.d * sim.d)); furrow.add(sim.pos.x, sim.pos.z, hf.x, hf.z, w * 0.96, clamp(1 - Math.abs(sim.d) / WR));
    for (let i = count(150, dt); i > 0; i--) { const s = rand(-1, 1); puff(sim.pos.x + hf.x * WR * 0.9 + hf.z * s * w, sim.gy + rand(0.5, 2.5), sim.pos.z + hf.z * WR * 0.9 - hf.x * s * w, hf.x * 16 + hf.z * s * 12, rand(7, 20), hf.z * 16 - hf.x * s * 12, rand(1.5, 2.8), rand(4, 8), rand(13, 22), rand(0.2, 0.32), rand(0.85, 1.1), 12, 0.8); }
  } else { furrow.cut(); if (sim.d < -WR) for (let i = count(90, dt); i > 0; i--) puff(sim.pos.x + rand(-6, 6), sim.gy + 0.5, sim.pos.z + rand(-6, 6), rand(-3, 3), rand(6, 14), rand(-3, 3), rand(1, 2), rand(3, 5), rand(9, 15), 0.3, rand(0.9, 1.1), 10, 1); }
  for (let i = 6; i < rig.n; i += 9) {
    const P = rig.P[i], gy = ground(P.x, P.z), dy = P.y - gy, s = i * 0.5, R = WR * (s > 100 ? 1 - (s - 100) / 60 : 1);
    if (Math.abs(dy) > R || Math.random() > 24 * dt * Math.exp(-s / 70)) continue;
    const half = Math.sqrt(Math.max(0, R * R - dy * dy)), sg = Math.random() < 0.5 ? 1 : -1; B.crossVectors(rig.N[i], rig.T[i]);
    puff(P.x + B.x * half * sg, gy + rand(0.3, 1.6), P.z + B.z * half * sg, B.x * sg * rand(3, 9) - rig.T[i].x * 4, rand(3, 10), B.z * sg * rand(3, 9) - rig.T[i].z * 4, rand(1.6, 3), rand(4, 7), rand(11, 18), rand(0.15, 0.25), rand(0.85, 1.1), 3, 0.9);
  }
  for (const k of convoy.trucks) if (k.alive && k.u > 0) for (let i = count(26, dt); i > 0; i--) {
    const m = k.g.matrix.elements, sgn = Math.random() < 0.5 ? 1 : -1;
    puff(k.pos.x - m[0] * 5.6 + m[8] * 1.4 * sgn, k.pos.y + 0.5, k.pos.z - m[2] * 5.6 + m[10] * 1.4 * sgn, -m[0] * 3 + rand(-1, 1), rand(1.5, 3.5), -m[2] * 3 + rand(-1, 1), rand(1.3, 2.4), rand(1.8, 2.8), rand(6, 10), rand(0.14, 0.24), rand(0.9, 1.1), 0.6, 1.1);
  }
  const pscale = renderer.domElement.height / (2 * Math.tan(camera.fov * Math.PI / 360));
  dust.update(dt, pscale); sparks.update(dt, pscale); debris.update(dt);
  // presentation
  updateCamera(rdt); updateShadow(); env.update(camera);
  sound.update(spd, surf ? 1 : sim.state === 'air' ? 0.15 : 0.3, clamp(-sim.d / (WR * 1.8)));
  toastT -= rdt; if (toastT < 0) $('toast').classList.remove('on');
  $('eaten').textContent = String(convoy.eaten).padStart(2, '0'); $('escaped').textContent = String(convoy.escaped).padStart(2, '0');
  $('state').textContent = sim.state === 'dive' ? '잠수 중' : sim.state === 'air' ? '돌출' : '지상';
  post.grade.uniforms.uTime.value = time; post.composer.render(rdt);
}
let last = performance.now(), lastFrame = 0, frames = 0, acc = 0, slowAcc = 0, slowN = 0; window.__fps = 0;
function frame(real) {
  const now = performance.now(), raw = (now - last) / 1000, rdt = Math.min(0.05, raw); last = now; lastFrame = now;
  if (window.__hold) return;                                                   // review helper: freeze for stills
  step(rdt); frames++; acc += raw;
  if (real && raw < 0.25) { slowAcc += raw; slowN++; }
  if (acc > 0.75) {
    window.__fps = Math.round(frames / acc); frames = 0; acc = 0;
    // dynamic resolution: back off when frames run long, creep back up when there is headroom
    if (slowN > 8 && Q.get('dyn') !== '0') { const avg = slowAcc / slowN; if (avg > 1 / 50) dyn = Math.max(0.5, dyn * 0.88); else if (avg < 1 / 70 && dyn < 1) dyn = Math.min(1, dyn * 1.06); applyScale(); }
    slowAcc = slowN = 0;
    $('perf').textContent = `${window.__fps} FPS · ${renderer.domElement.width}×${renderer.domElement.height}`;
  }
}
function raf() { frame(true); requestAnimationFrame(raf); }
// keep simulating if the tab is not being painted (capture tools, background panes)
setInterval(() => { if (performance.now() - lastFrame > 300) frame(false); }, 100);
$('loading').classList.add('gone'); $('auto').classList.toggle('on', auto);
if (Q.get('start') === '1') begin();
window.__game = { sim, rig, convoy, cam, orbit, world, renderer, post, scene, camera, sound, eat, triggerWide, triggerTruck, get auto() { return auto; }, set auto(v) { auto = v; }, step };
raf();
