// Rider and howdah. Origin sits on the carapace, +Y up, +Z forward, metres.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { std, led } from './mats.js';
import { canvasTexture } from './tex.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z), UP = V(0, 1, 0);
const rbox = (w, h, d, r = 0.03) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w * 0.49, h * 0.49, d * 0.49));

export function buildRider() {
  const g = new THREE.Group();
  const M = {
    timber: std({ color: 0x2c2019, roughness: 0.82 }), iron: std({ color: 0x3b3a3a, roughness: 0.42, metalness: 0.9 }),
    leather: std({ color: 0x3a2618, roughness: 0.7 }), cloth: std({ color: 0xe6d9c0, roughness: 0.92, side: THREE.DoubleSide }),
    wrap: std({ color: 0x8c3b22, roughness: 0.9 }), skin: std({ color: 0x1a1412, roughness: 0.8 }),
    rope: std({ color: 0x7c6748, roughness: 0.95 }), brass: std({ color: 0xb58a3c, roughness: 0.3, metalness: 1 }),
    lens: new THREE.MeshPhysicalMaterial({ color: 0x0a0d10, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.02 }),
    lamp: led(0xffa040, 9),
  };
  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  const limb = (a, b, r, mat) => { const d = b.clone().sub(a), l = d.length(); const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, l - 2 * r), 4, 10), mat); m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(UP, d.normalize()); m.castShadow = true; g.add(m); return m; };
  const tube = (pts, r, mat, seg = 24) => { const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, r, 6), mat); m.castShadow = true; g.add(m); return m; };

  // howdah: deck on iron legs, clawed to the plate
  add(rbox(2.4, 0.12, 3.5, 0.03), M.timber, 0, 0.58, 0);
  for (let i = 0; i < 7; i++) add(rbox(2.44, 0.03, 0.04, 0.01), M.iron, 0, 0.645, -1.5 + i * 0.5);
  for (const [x, z] of [[1.05, 1.55], [-1.05, 1.55], [1.05, -1.55], [-1.05, -1.55]]) {
    add(new THREE.CylinderGeometry(0.05, 0.07, 0.62, 8), M.iron, x, 0.29, z);
    add(new THREE.TorusGeometry(0.34, 0.06, 8, 16, Math.PI * 1.2), M.iron, x * 1.75, 0.05, z * 1.25, 0, Math.PI / 2 * Math.sign(x), -0.6);
    tube([V(x, 0.55, z), V(x * 1.35, 0.4, z * 1.12), V(x * 1.72, 0.3, z * 1.25)], 0.028, M.rope, 8);
  }
  for (const x of [1.17, -1.17]) { add(rbox(0.05, 0.05, 3.3, 0.02), M.iron, x, 1.05, 0); for (const z of [-1.6, -0.55, 0.55, 1.6]) add(rbox(0.04, 0.42, 0.04, 0.015), M.iron, x, 0.84, z); }
  // saddle + pommel
  add(rbox(0.66, 0.24, 1.1, 0.1), M.leather, 0, 0.82, 0.15);
  add(rbox(0.8, 0.05, 1.25, 0.02), M.wrap, 0, 0.69, 0.15);
  add(new THREE.CylinderGeometry(0.045, 0.06, 0.62, 10), M.iron, 0, 1.12, 0.82);
  add(new THREE.CylinderGeometry(0.035, 0.035, 0.62, 10), M.brass, 0, 1.43, 0.82, 0, 0, Math.PI / 2);
  // rider
  const hipL = V(0.15, 1.02, 0.12), hipR = V(-0.15, 1.02, 0.12), shL = V(0.23, 1.6, 0.4), shR = V(-0.23, 1.6, 0.4), hL = V(0.31, 1.43, 0.82), hR = V(-0.31, 1.43, 0.82);
  limb(V(0, 1.0, 0.1), V(0, 1.6, 0.38), 0.19, M.leather);
  limb(hipL, V(0.42, 0.9, 0.62), 0.1, M.leather); limb(V(0.42, 0.9, 0.62), V(0.5, 0.5, 0.4), 0.085, M.leather); add(rbox(0.14, 0.1, 0.3, 0.04), M.skin, 0.5, 0.46, 0.48);
  limb(hipR, V(-0.42, 0.9, 0.62), 0.1, M.leather); limb(V(-0.42, 0.9, 0.62), V(-0.5, 0.5, 0.4), 0.085, M.leather); add(rbox(0.14, 0.1, 0.3, 0.04), M.skin, -0.5, 0.46, 0.48);
  limb(shL, V(0.36, 1.38, 0.56), 0.075, M.wrap); limb(V(0.36, 1.38, 0.56), hL, 0.065, M.wrap);
  limb(shR, V(-0.36, 1.38, 0.56), 0.075, M.wrap); limb(V(-0.36, 1.38, 0.56), hR, 0.065, M.wrap);
  add(new THREE.SphereGeometry(0.13, 16, 12), M.skin, 0, 1.84, 0.46);
  add(new THREE.SphereGeometry(0.17, 16, 12, 0, Math.PI * 2, 0, 2.1), M.cloth, 0, 1.86, 0.43, -0.5, 0, 0);
  add(rbox(0.27, 0.07, 0.06, 0.03), M.leather, 0, 1.86, 0.57);
  add(new THREE.SphereGeometry(0.045, 12, 10), M.lens, 0.065, 1.86, 0.585); add(new THREE.SphereGeometry(0.045, 12, 10), M.lens, -0.065, 1.86, 0.585);
  add(new THREE.TorusGeometry(0.2, 0.07, 8, 16), M.wrap, 0, 1.66, 0.4, Math.PI / 2 - 0.4, 0, 0);
  // reins run forward to the collar horns
  const reinL = [hL, V(0.9, 1.3, 3.2), V(2.3, 1.0, 6.5), V(3.4, 1.6, 9.2)], reinR = reinL.map((p) => V(-p.x, p.y, p.z));
  tube(reinL, 0.03, M.rope, 40); tube(reinR, 0.03, M.rope, 40);
  // cargo
  add(rbox(0.9, 0.5, 0.6, 0.08), M.cloth, 0.55, 0.9, -1.15, 0, 0.2, 0); add(rbox(0.7, 0.42, 0.7, 0.1), M.wrap, -0.5, 0.86, -1.2, 0, -0.3, 0);
  add(new THREE.CylinderGeometry(0.22, 0.22, 0.7, 16), M.iron, 0.1, 0.87, -0.55, 0, 0, Math.PI / 2);
  add(rbox(0.94, 0.04, 0.08, 0.01), M.leather, 0.55, 1.16, -1.15, 0, 0.2, 0);
  // lanterns
  for (const x of [1.12, -1.12]) { add(new THREE.CylinderGeometry(0.018, 0.018, 0.9, 6), M.iron, x, 1.1, -1.62); add(new THREE.SphereGeometry(0.085, 12, 10), M.lamp, x, 1.52, -1.62); add(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 12), M.brass, x, 1.62, -1.62); }

  // cloak: pinned at the shoulders, streaming back
  const NU = 10, NV = 16, cg = new THREE.PlaneGeometry(1, 1, NU, NV), cloak = new THREE.Mesh(cg, M.cloth); cloak.castShadow = true; cloak.frustumCulled = false; g.add(cloak);
  // banner
  add(new THREE.CylinderGeometry(0.035, 0.05, 5.6, 8), M.iron, -1.05, 3.35, -1.55);
  add(new THREE.SphereGeometry(0.09, 10, 8), M.brass, -1.05, 6.2, -1.55);
  const flagTex = canvasTexture(256, 160, (c, W, H) => {
    c.fillStyle = '#1f2f5a'; c.fillRect(0, 0, W, H); c.strokeStyle = '#efe6d2'; c.lineWidth = 9; c.beginPath(); c.arc(W * 0.42, H / 2, 38, 0, 7); c.stroke();
    c.beginPath(); c.moveTo(W * 0.42 - 60, H / 2); c.lineTo(W * 0.42 + 60, H / 2); c.stroke(); c.fillStyle = '#b5482a'; c.fillRect(0, H - 18, W, 18);
  });
  const FU = 14, FV = 8, fg = new THREE.PlaneGeometry(1, 1, FU, FV), flag = new THREE.Mesh(fg, std({ map: flagTex, roughness: 0.9, side: THREE.DoubleSide })); flag.castShadow = true; flag.frustumCulled = false; g.add(flag);

  g.userData.tick = (t, speed = 1) => {
    const p = cg.attributes.position; let k = 0;
    for (let j = 0; j <= NV; j++) for (let i = 0; i <= NU; i++, k++) {
      const u = i / NU - 0.5, v = j / NV, w = v * v;
      const wave = Math.sin(t * 7 * speed - v * 6 + u * 2.5) * 0.11 * w + Math.sin(t * 11.3 * speed - v * 9.5 - u * 3) * 0.05 * w;
      p.setXYZ(k, u * (0.52 + 0.75 * v) + wave * 0.5, 1.66 - v * 0.55 - w * 0.25 + wave, 0.3 - v * 1.75 - 0.12 * Math.cos(u * 3.1) * (1 - v));
    }
    p.needsUpdate = true; cg.computeVertexNormals();
    const q = fg.attributes.position; k = 0;
    for (let j = 0; j <= FV; j++) for (let i = 0; i <= FU; i++, k++) {
      const u = i / FU, v = j / FV;
      const wave = Math.sin(t * 9 * speed - u * 7 + v * 1.5) * 0.16 * u + Math.sin(t * 14 * speed - u * 12) * 0.05 * u;
      q.setXYZ(k, -1.05 + wave, 6.05 - v * 1.15 - u * u * 0.12 + wave * 0.3, -1.55 - u * 1.95);
    }
    q.needsUpdate = true; fg.computeVertexNormals();
  };
  g.userData.tick(0);
  return g;
}
