// Projectile meshes with their shadows and trails, and the numbered markers for choosing a bullet.

import * as THREE from 'three';
import { clamp } from '../core/math.js';
import { BALL_R } from '../core/physics.js';
import { state, world } from '../game/state.js';
import { spawn } from './particles.js';
import { camera, disposeTree, phong, scene } from './scene.js';

export function makeProjectile(W) {
  const g = new THREE.Group();
  if (W.id === 'bazooka') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.9, 8), phong(0x5b7a2e)); body.rotation.x = Math.PI / 2; g.add(body);
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.4, 8), phong(0xe8322b)); nose.rotation.x = Math.PI / 2; nose.position.z = 0.65; g.add(nose);
    for (const r of [0, Math.PI / 2]) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.04, 0.25), phong(0x2d3a18)); fin.rotation.z = r; fin.position.z = -0.38; g.add(fin); }
    g.scale.setScalar(1.6);
  } else if (W.id === 'dart') {
    const foam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.36, 8), phong(0x3db8ff)); foam.rotation.x = Math.PI / 2; g.add(foam);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.06, 0.09, 10), phong(0xff6b17)); tip.rotation.x = Math.PI / 2; tip.position.z = 0.22; g.add(tip);
    g.scale.setScalar(2.2);
  } else if (W.id === 'grenade') {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), phong(0x556b2f)));
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.06, 10), phong(0xffd447)); band.rotation.x = Math.PI / 2; g.add(band);
    g.scale.setScalar(1.8);
  } else if (W.id === 'flare') {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff3b5c })));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff8a5c, transparent: true, opacity: 0.35, depthWrite: false })));
    g.scale.setScalar(1.8);
  } else if (W.id === 'shotgun') {
    const slug = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.16, 8), phong(0x9aa3a8, { shininess: 60 })); slug.rotation.x = Math.PI / 2; g.add(slug);
    g.scale.setScalar(2.4);
  } else {
    const brass = phong(0xd6a23a, { shininess: 60 }), long = W.id === 'sniper' ? 0.36 : W.id === 'auto' ? 0.26 : 0.2;
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, long, 8), brass); c.rotation.x = Math.PI / 2; g.add(c);
    const n = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.14, 8), phong(0xb87333)); n.rotation.x = Math.PI / 2; n.position.z = long / 2 + 0.07; g.add(n);
    g.scale.setScalar(2.4);
  }
  scene.add(g);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.5, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; scene.add(shadow);
  return { g, shadow };
}
function dropVis(q) { if (!q.vis) return; scene.remove(q.vis.g); scene.remove(q.vis.shadow); disposeTree(q.vis.g); disposeTree(q.vis.shadow); q.vis = null; }
export function removeShotVisuals() {
  const s = state.shot; if (!s) return;
  s.projs.forEach(q => { dropVis(q); if (q.marker) { scene.remove(q.marker); disposeTree(q.marker); q.marker = null; } });
}
export function numberSprite(n, color) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g = cv.getContext('2d');
  g.beginPath(); g.moveTo(64, 124); g.lineTo(40, 88); g.arc(64, 58, 36, Math.PI * 0.78, Math.PI * 0.22); g.closePath(); g.fillStyle = '#1b2214'; g.fill();
  g.beginPath(); g.arc(64, 58, 29, 0, Math.PI * 2); g.fillStyle = color; g.fill();
  g.fillStyle = '#1b2214'; g.font = '44px "Lilita One","Arial Rounded MT Bold",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(n), 64, 61);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true, fog: false }));
  sp.scale.set(0.06, 0.06, 1); sp.center.set(0.5, 0); sp.renderOrder = 11;
  return sp;
}
export function updateProjectileVisual(dt) {
  const s = state.shot; if (!s) return;
  const M = world.M;
  for (const q of s.projs) {
    if (!q.vis) continue;
    const b = q.b, g = q.vis.g;
    if (q.sinking != null) {
      q.sinking += dt; g.position.set(M.cup.x, M.cup.y + BALL_R - q.sinking * 1.2, M.cup.z);
      if (q.sinking > 0.5) g.visible = false;
      q.vis.shadow.visible = false; continue;
    }
    if (q.gone) { g.visible = false; q.vis.shadow.visible = false; continue; }
    g.position.set(b.x, b.y, b.z);
    const camDist = camera.position.distanceTo(g.position);
    g.visible = q.delay <= 0 && camDist > 2.2; // never pop a projectile right into the first-person lens
    q.vis.shadow.visible = q.delay <= 0;
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    if (sp > 2) g.lookAt(b.x + b.vx, b.y + b.vy, b.z + b.vz);
    const h = M.height(b.x, b.z), alt = b.y - h;
    q.vis.shadow.position.set(b.x, h + 0.06, b.z);
    q.vis.shadow.scale.setScalar(0.7 + Math.min(alt, 30) * 0.05);
    q.vis.shadow.material.opacity = clamp(0.35 - alt * 0.008, 0.08, 0.35);
    if (q.marker) q.marker.position.set(b.x, b.y + 1.4, b.z);
    if (q.active && q.delay <= 0) {
      q.trailT += dt;
      while (q.trailT > 0.02) {
        q.trailT -= 0.02;
        if (sp < 3 || camDist < 4) continue;
        q.trailN = (q.trailN || 0) + 1;
        spawn({ x: b.x, y: b.y, z: b.z, size: 0.17, grow: -0.15, life: 0.55, color: s.color, opacity: 0.95 });
        if (s.W.id === 'bazooka' && q.trailN % 2 === 0 && b.t < s.W.burn + 0.3) spawn({ x: b.x - b.vx * 0.03, y: b.y, z: b.z - b.vz * 0.03, vy: 0.5, size: 0.24, grow: 0.9, life: 0.75, color: 0xd9d6c8, opacity: 0.45, drag: 1 });
        if (s.W.id === 'flare') {
          spawn({ x: b.x, y: b.y, z: b.z, vy: 0.4, size: 0.3, grow: 1.1, life: 1.6, color: 0xffb3b3, opacity: 0.35, drag: 1 });
          if (q.trailN % 2) spawn({ x: b.x, y: b.y, z: b.z, vx: (Math.random() - 0.5) * 2, vy: -1, vz: (Math.random() - 0.5) * 2, size: 0.08, life: 0.5, color: 0xffd447, grav: 0.4 });
        }
      }
    }
  }
}
