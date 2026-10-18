// Pooled particles: smoke, dirt, sparks, splashes and confetti.

import * as THREE from 'three';
import { G } from '../core/physics.js';
import { scene } from './scene.js';

const parts = [], partGeo = new THREE.IcosahedronGeometry(1, 0);
export function spawn(o) {
  let p = null;
  for (const q of parts) if (!q.alive) { p = q; break; }
  if (!p) {
    if (parts.length > 260) return;
    const m = new THREE.Mesh(partGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false })); m.frustumCulled = false; scene.add(m);
    p = { mesh: m }; parts.push(p);
  }
  p.alive = true; p.age = 0;
  p.x = o.x; p.y = o.y; p.z = o.z; p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
  p.size = o.size || 0.3; p.grow = o.grow || 0; p.life = o.life || 0.6; p.o0 = o.opacity == null ? 1 : o.opacity; p.grav = o.grav || 0; p.drag = o.drag || 0;
  p.mesh.material.color.set(o.color); p.mesh.visible = true;
}
export function updateParts(dt) {
  for (const p of parts) {
    if (!p.alive) continue;
    p.age += dt;
    if (p.age >= p.life) { p.alive = false; p.mesh.visible = false; continue; }
    p.vy -= p.grav * G * dt; const k = 1 - p.drag * dt; p.vx *= k; p.vy *= k; p.vz *= k;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    const u = p.age / p.life;
    p.mesh.position.set(p.x, p.y, p.z); p.mesh.scale.setScalar(Math.max(0.01, p.size + p.grow * p.age));
    p.mesh.material.opacity = p.o0 * (1 - u * u);
  }
}
export function clearParts() { for (const p of parts) { p.alive = false; p.mesh.visible = false; } }
export function puff(x, y, z, color, n) {
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2; spawn({ x, y, z, vx: Math.cos(a) * 3, vy: 1 + Math.random() * 2, vz: Math.sin(a) * 3, size: 0.35, grow: 1.2, life: 0.55, color, opacity: 0.85, drag: 3 }); }
}
export function dirtPuff(x, y, z, v, surf) {
  const color = surf === 'sand' ? 0xe8d49a : surf === 'green' || surf === 'fairway' || surf === 'tee' ? 0x7cbf55 : surf === 'crate' ? 0x8a6a3a : 0x6b5a33;
  const n = Math.min(14, 3 + Math.floor(v / 2));
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * v * 0.15; spawn({ x, y: y + 0.1, z, vx: Math.cos(a) * s, vy: 2 + Math.random() * v * 0.3, vz: Math.sin(a) * s, size: 0.12 + Math.random() * 0.12, life: 0.7, color, grav: 1 }); }
}
