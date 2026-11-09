// Haulers leave the gate, run the ring road and try to make it back in.
import * as THREE from 'three';
import { buildTruck } from './truck.js';
import { PATH, pathAt, ground } from './world.js';

export class Convoy {
  constructor(T, count = 6) {
    this.group = new THREE.Group(); this.trucks = []; this.eaten = 0; this.escaped = 0; this.serial = 0;
    for (let i = 0; i < count; i++) {
      const g = buildTruck(T, { id: 3 + i * 4 }); g.matrixAutoUpdate = false; g.visible = false; this.group.add(g);
      this.trucks.push({ g, u: -30 - i * 46, speed: 23, alive: true, lat: 0, phase: i * 1.7, wait: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), panic: 0, id: i });
    }
    this._p = {}; this._m = new THREE.Matrix4(); this._f = new THREE.Vector3(); this._n = new THREE.Vector3(); this._r = new THREE.Vector3();
  }
  // returns the list of trucks that left through the gate this frame
  update(dt, t, worm) {
    for (const k of this.trucks) {
      if (!k.alive) { k.wait -= dt; if (k.wait <= 0) { k.alive = true; k.u = -20 - Math.random() * 40; k.lat = 0; k.panic = 0; } else continue; }
      const dx = worm.pos.x - k.pos.x, dz = worm.pos.z - k.pos.z, dist = Math.hypot(dx, dz);
      k.panic += ((dist < 170 ? 1 : 0) - k.panic) * Math.min(1, dt * 2);
      k.speed += ((23 + 4 * k.panic) - k.speed) * Math.min(1, dt * 1.5);
      k.u += k.speed * dt;
      if (k.u >= PATH.L - 6) { k.alive = false; k.wait = 5 + Math.random() * 6; k.g.visible = false; this.escaped++; continue; }
      const p = pathAt(Math.max(0, k.u), this._p), nx = p.tz, nz = -p.tx;
      // weave when hunted, and lean away from the worm
      const away = dist < 150 ? Math.sign(dx * nx + dz * nz) * -4 * k.panic : 0, inGate = Math.min(1, Math.max(0, (k.u - 120) / 80)) * Math.min(1, Math.max(0, (PATH.L - 120 - k.u) / 80));
      k.lat += ((Math.sin(t * 0.9 + k.phase) * 3.5 * k.panic + away) * inGate - k.lat) * Math.min(1, dt * 1.6);
      const x = p.x + nx * k.lat, z = p.z + nz * k.lat, y = ground(x, z);
      k.vel.set((x - k.pos.x) / Math.max(dt, 1e-3), 0, (z - k.pos.z) / Math.max(dt, 1e-3)); if (k.vel.lengthSq() > 3600) k.vel.setLength(k.speed);
      k.pos.set(x, y, z);
      // sit on the slope
      const f = this._f.set(p.tx, (ground(x + p.tx * 5, z + p.tz * 5) - ground(x - p.tx * 5, z - p.tz * 5)) / 10, p.tz).normalize();
      const n = this._n.set(-(ground(x + nx * 2, z + nz * 2) - ground(x - nx * 2, z - nz * 2)) / 4 * nx, 1, -(ground(x + nx * 2, z + nz * 2) - ground(x - nx * 2, z - nz * 2)) / 4 * nz).normalize();
      const r = this._r.crossVectors(f, n).normalize(); n.crossVectors(r, f);
      // truck model: +X forward, +Y up, +Z right
      k.g.matrix.makeBasis(f, n, r).setPosition(x, y + 0.02 + Math.sin(t * 9 + k.phase) * 0.03, z); k.g.matrixWorldNeedsUpdate = true; k.g.visible = k.u > 0;
      for (const w of k.g.userData.wheels) w.spin.rotation.z -= k.speed * dt / 0.95 * w.dir;
    }
  }
  kill(k) { k.cineMode = null; k.alive = false; k.wait = 7 + Math.random() * 6; k.g.visible = false; this.eaten++; }
}
