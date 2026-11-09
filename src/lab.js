// Asset lab: each hero asset under the target light, with fixed review cameras.
// URL: lab.html?a=truck|rock|worm&cam=0..n   (drag to orbit, wheel to zoom)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeTextures } from './tex.js';
import { makeEnv, makePost, setSun } from './env.js';
import { std, SAND } from './mats.js';
import { fbm2 } from './noise.js';
import { buildTruck } from './truck.js';

const q = new URLSearchParams(location.search);
const stage = document.getElementById('stage'), ui = document.getElementById('ui');
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 0.92;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(28, 16 / 9, 0.3, 40000);
setSun(-146, 24);
const T = makeTextures(renderer); T.renderer = renderer;
const env = makeEnv(renderer, scene);

// sand floor
const groundH = (x, z) => (fbm2(x * 0.012, z * 0.012, 3) - 0.5) * 3.0 * Math.min(1, Math.hypot(x, z) / 60);
{
  const g = new THREE.PlaneGeometry(1600, 1600, 320, 320); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) { p.setY(i, groundH(p.getX(i), p.getZ(i))); uv.setXY(i, p.getX(i) / 2.6, p.getZ(i) / 2.6); }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, std({ color: SAND, roughness: 0.94, metalness: 0, normalMap: T.sandNrm, normalScale: new THREE.Vector2(0.55, 0.55) }));
  m.receiveShadow = true; scene.add(m);
}

const ASSETS = {
  truck: {
    label: 'Hauler', ext: 13, build: async () => buildTruck(T, { id: 7 }),
    cams: [{ p: [0.6, 2.1, -24], t: [0.1, 1.85, 0], f: 24 }, { p: [16, 3.3, -11.5], t: [0.6, 1.7, 0], f: 24 }, { p: [9.6, 1.5, -5.4], t: [5.1, 1.5, -1.2], f: 34 },
      { p: [-13.5, 4.6, -9], t: [-2, 2, 0], f: 28 }, { p: [-1.5, 1.9, -6.2], t: [-1.2, 1.9, -1.6], f: 36 }],
  },
  rock: {
    label: 'Rock', ext: 95, build: async () => (await import('./rock.js')).buildRockSet(T),
    cams: [{ p: [70, 9, -150], t: [0, 36, 0], f: 30 }, { p: [34, 4, -52], t: [4, 22, 0], f: 36 }, { p: [-90, 40, -110], t: [0, 30, 0], f: 30 }],
  },
  worm: {
    label: 'Worm', ext: 95, build: async () => (await import('./worm.js')).buildWormLab(T),
    cams: [{ p: [116, 12, -78], t: [34, 19, 0], f: 30 }, { p: [88, 21, -24], t: [58, 21, 0], f: 34 }, { p: [70, 30, -44], t: [30, 22, 0], f: 30 }, { p: [-30, 30, -120], t: [6, 14, 0], f: 30 }, { p: [8, 41, -5], t: [44, 29, 0.5], f: 38 }, { p: [24, 33, -30], t: [20, 22, -8], f: 26 }],
  },
};

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.497;
const built = {}; let current = null, post = null, camIdx = 0;

async function show(name, cam = 0) {
  const A = ASSETS[name]; if (!A) return;
  if (!built[name]) { try { built[name] = await A.build(); scene.add(built[name]); } catch (e) { console.error('build failed: ' + name, e); return; } }
  for (const k in built) built[k].visible = k === name;
  current = name; camIdx = ((cam % A.cams.length) + A.cams.length) % A.cams.length;
  const c = A.cams[camIdx];
  camera.position.set(...c.p); controls.target.set(...c.t); camera.fov = c.f; camera.updateProjectionMatrix(); controls.update();
  env.focus(new THREE.Vector3(c.t[0] * 0, A.ext * 0.25, 0), A.ext);
  for (const b of ui.querySelectorAll('button[data-a]')) b.setAttribute('aria-pressed', String(b.dataset.a === name));
  history.replaceState(null, '', `?a=${name}&cam=${camIdx}`);
}

for (const k in ASSETS) { const b = document.createElement('button'); b.textContent = ASSETS[k].label; b.dataset.a = k; b.onclick = () => show(k, 0); ui.appendChild(b); }
{ const s = document.createElement('span'); s.className = 'sep'; ui.appendChild(s);
  const b = document.createElement('button'); b.textContent = 'Next view'; b.onclick = () => show(current, camIdx + 1); ui.appendChild(b); }
addEventListener('keydown', (e) => { const n = Object.keys(ASSETS)[+e.key - 1]; if (n) show(n, 0); if (e.key === ' ') show(current, camIdx + 1); });

function resize() {
  let w = innerWidth, h = innerHeight; if (w / h > 16 / 9) w = Math.round(h * 16 / 9); else h = Math.round(w * 9 / 16);
  if (w < 8 || h < 8) return;
  renderer.setSize(w, h); const pr = renderer.getPixelRatio(); post?.setSize(w * pr, h * pr);
}
addEventListener('resize', resize);

post = await makePost(renderer, scene, camera); resize();
await show(q.get('a') || 'truck', +(q.get('cam') || 0));

const clock = new THREE.Clock(); let frames = 0, acc = 0; window.__fps = 0;
function frame() {
  const dt = clock.getDelta(), t = clock.elapsedTime;
  controls.update(); env.update(camera);
  built[current]?.userData.tick?.(t, dt);
  post.grade.uniforms.uTime.value = t;
  post.composer.render(dt);
  frames++; acc += dt; if (acc > 1) { window.__fps = Math.round(frames / acc); frames = 0; acc = 0; }
  requestAnimationFrame(frame);
}
frame(); window.__ready = true; window.__lab = { scene, built, post, renderer, camera, env, show };
