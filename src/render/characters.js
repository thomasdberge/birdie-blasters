// The player characters: body, hat, googly eyes and name tag, plus walking, flying and poofing.

import * as THREE from 'three';
import { angLerp, clamp, lerp } from '../core/math.js';
import { CHAR_S } from '../core/rules.js';
import { sfx } from '../audio/sfx.js';
import { clock, playsSeat, state, world } from '../game/state.js';
import { puff } from './particles.js';
import { camera, phong, scene } from './scene.js';
import { makeWeaponModels } from './weaponModels.js';

function makeLabel(text, color) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128; const g = cv.getContext('2d');
  let fs = 64; g.font = fs + 'px "Lilita One","Arial Rounded MT Bold",sans-serif';
  while (g.measureText(text).width > 470 && fs > 28) { fs -= 4; g.font = fs + 'px "Lilita One","Arial Rounded MT Bold",sans-serif'; }
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round'; g.lineWidth = 14; g.strokeStyle = '#1b2214';
  g.strokeText(text, 256, 68); g.fillStyle = color; g.fillText(text, 256, 68);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true, fog: false }));
  sp.scale.set(0.15, 0.0375, 1); sp.center.set(0.5, 0); sp.renderOrder = 10;
  return sp;
}
function makeHat(kind, color) {
  const g = new THREE.Group();
  if (kind === 'cone') {
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.85, 10), phong(0xff7a1a)); c.position.y = 0.42; g.add(c);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.26, 0.15, 10), phong(0xffffff)); band.position.y = 0.38; g.add(band);
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.07, 0.78), phong(0xff7a1a)); base.position.y = 0.02; g.add(base);
    g.position.set(0.04, 2.47, 0); g.rotation.z = 0.28;
  } else if (kind === 'viking') {
    const helm = new THREE.Mesh(new THREE.SphereGeometry(0.56, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), phong(0x9aa3a8, { side: THREE.DoubleSide })); g.add(helm);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.09, 12), phong(0x707a80)); brim.position.y = 0.03; g.add(brim);
    for (const s of [-1, 1]) { const h = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.55, 7), phong(0xf1e7c8)); h.position.set(s * 0.56, 0.32, 0); h.rotation.z = -s * 0.95; g.add(h); }
    g.position.y = 2.0;
  } else if (kind === 'propeller') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), phong(0xe8322b, { side: THREE.DoubleSide })); g.add(cap);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 5), phong(0x333333)); stem.position.y = 0.66; g.add(stem);
    const prop = new THREE.Group(); prop.position.y = 0.8;
    const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.03, 0.14), phong(0x3db8ff)); prop.add(b1);
    const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.8), phong(0xffcf3d)); prop.add(b2);
    g.add(prop); g.userData.prop = prop; g.position.y = 2.03;
  } else {
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.27, 0.8, 10), phong(0x3ad08f)); c.position.y = 0.4; g.add(c);
    const pom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 0), phong(0xffffff)); pom.position.y = 0.82; g.add(pom);
    g.position.set(-0.08, 2.42, 0); g.rotation.z = -0.22;
  }
  return g;
}
export function makeChar(style, name) {
  const group = new THREE.Group(), inner = new THREE.Group(); group.add(inner); inner.scale.setScalar(CHAR_S);
  const col = new THREE.Color(style.color), bodyMat = phong(col);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.72, 9, 7), bodyMat); body.scale.set(1, 1.12, 0.95); body.position.y = 0.95; inner.add(body);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), phong(col.clone().lerp(new THREE.Color('#ffffff'), 0.5))); belly.scale.set(1, 1.1, 0.6); belly.position.set(0, 0.85, 0.43); inner.add(belly);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.52, 10, 8), bodyMat); head.position.y = 2.0; inner.add(head);
  const eyeMat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 80 }), pupMat = new THREE.MeshPhongMaterial({ color: 0x111111, shininess: 100 });
  const pupils = [];
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.21, 14, 12), eyeMat); eye.position.set(0.2 * sx, 2.12, 0.4); eye.scale.setScalar(sx < 0 ? 1 : 1.22); inner.add(eye);
    const pup = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), pupMat); pup.position.set(0, 0, 0.17); eye.add(pup);
    pupils.push({ mesh: pup, ox: 0, oy: 0, vx: 0, vy: 0 });
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), phong(0xffb199)); nose.scale.set(1, 0.85, 1.1); nose.position.set(0, 1.94, 0.5); inner.add(nose);
  const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.15, 0.05), phong(0xffffff)); tooth.position.set(0.05, 1.73, 0.47); inner.add(tooth);
  const footMat = phong(col.clone().multiplyScalar(0.55));
  for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), footMat); f.scale.set(1, 0.45, 1.5); f.position.set(s * 0.32, 0.09, 0.12); inner.add(f); }
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.6, 6), bodyMat);
    arm.position.set(s * 0.5, 1.2, 0.35); arm.rotation.x = 1.25; arm.rotation.z = -s * 0.5; inner.add(arm);
  }
  const hat = makeHat(style.hat, style.color); inner.add(hat);
  const hold = new THREE.Group(); hold.position.set(0, 1.2, 0.62); inner.add(hold);
  const weapons = makeWeaponModels(); Object.values(weapons).forEach(w => { w.visible = false; hold.add(w); });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.6, 30), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.08; ring.visible = false; group.add(ring);
  const label = makeLabel(name, style.color); label.position.y = 3.65 * CHAR_S; group.add(label);
  scene.add(group);
  return { group, inner, pupils, weapons, hold, ring, label, prop: hat.userData.prop || null, mode: 'idle', target: null, fly: null, poofT: 0, recoil: 0, phase: Math.random() * 6, weapon: null };
}
export function showWeapon(c, id) { if (c.weapon === id) return; Object.entries(c.weapons).forEach(([k, m]) => { m.visible = k === id; }); c.weapon = id; }

export function setCharTarget(c, x, y, z, instant) {
  c.target = { x, y, z };
  if (instant) { c.group.position.set(x, y, z); c.mode = 'idle'; c.inner.scale.setScalar(CHAR_S); return; }
  if (c.mode === 'fly' || c.mode === 'poof') return;
  const d = Math.hypot(c.group.position.x - x, c.group.position.z - z);
  if (d < 0.05 && Math.abs(c.group.position.y - y) < 0.05) return;
  if (d > 6) { c.mode = 'poof'; c.poofT = 0; c.poofed = false; sfx.poof(); puff(c.group.position.x, c.group.position.y + 1, c.group.position.z, 0xffffff, 10); }
  else c.mode = 'walk';
}
export function launchFly(c, to, dur, height) {
  const from = c.group.position.clone();
  c.target = { x: to.x, y: to.y, z: to.z };
  c.fly = { from, to: new THREE.Vector3(to.x, to.y, to.z), t: 0, dur, height, ax: Math.random() - 0.5, az: Math.random() - 0.5 };
  c.mode = 'fly';
}
export function updateChar(c, dt, p) {
  const g = c.group, inner = c.inner;
  if (c.mode === 'fly') {
    const f = c.fly; f.t += dt / f.dur; const u = Math.min(1, f.t);
    g.position.set(lerp(f.from.x, f.to.x, u), lerp(f.from.y, f.to.y, u) + 4 * f.height * u * (1 - u), lerp(f.from.z, f.to.z, u));
    inner.rotation.x += (8 + f.ax * 6) * dt; inner.rotation.z += (6 + f.az * 8) * dt;
    if (u >= 1) {
      c.mode = 'idle'; inner.rotation.set(0, 0, 0);
      puff(g.position.x, g.position.y + 0.3, g.position.z, 0xb8a06a, 12); sfx.bounce(8);
      const t = c.target; if (t) setCharTarget(c, t.x, t.y, t.z, false);
    }
  } else if (c.mode === 'poof') {
    c.poofT += dt;
    if (c.poofT < 0.18) inner.scale.setScalar(CHAR_S * (1 - c.poofT / 0.18));
    else {
      if (!c.poofed) { c.poofed = true; g.position.set(c.target.x, c.target.y, c.target.z); puff(c.target.x, c.target.y + 1, c.target.z, 0xffffff, 10); }
      const u = Math.min(1, (c.poofT - 0.18) / 0.3);
      inner.scale.setScalar(CHAR_S * (u < 1 ? (1 + Math.sin(u * Math.PI) * 0.25) * u : 1));
      if (u >= 1) { c.mode = 'idle'; inner.scale.setScalar(CHAR_S); }
    }
  } else if (c.mode === 'walk') {
    const t = c.target, dx = t.x - g.position.x, dz = t.z - g.position.z, d = Math.hypot(dx, dz), st = 7 * dt;
    if (d <= st) { g.position.set(t.x, t.y, t.z); c.mode = 'idle'; inner.rotation.z = 0; }
    else { g.position.x += dx / d * st; g.position.z += dz / d * st; g.position.y = world.M.height(g.position.x, g.position.z); inner.rotation.z = Math.sin(clock.t * 18) * 0.15; }
  }
  if (c.mode === 'idle' || c.mode === 'walk') {
    if (p && p.done) inner.position.y = Math.abs(Math.sin(clock.t * 6 + c.phase)) * 0.6;
    else inner.position.y = Math.sin(clock.t * 3 + c.phase) * 0.05;
  }
  c.recoil = Math.max(0, c.recoil - dt * 4); inner.position.z = -c.recoil * 0.35;
  // face direction: the current player faces where they aim
  const aiming = p && state.players[state.cur] === p && ['aim', 'pick', 'watch', 'flight'].includes(state.phase);
  let want = g.rotation.y;
  if (aiming) want = state.yaw;
  else if (p && p.done) want = Math.atan2(camera.position.x - g.position.x, camera.position.z - g.position.z);
  else if (state.cur >= 0 && state.players[state.cur]) { const q = state.players[state.cur].char.group.position; if (q !== g.position) want = Math.atan2(q.x - g.position.x, q.z - g.position.z); }
  if (c.mode !== 'fly') g.rotation.y = angLerp(g.rotation.y, want, 1 - Math.exp(-dt * 8));
  // Online, the others also watch the shooter's weapon tilt up and down with their aim
  const tilt = aiming && !playsSeat(state.cur) ? -clamp(state.pitch, -20, 50) * 0.6 * Math.PI / 180 : 0;
  c.hold.rotation.x = lerp(c.hold.rotation.x, tilt, 1 - Math.exp(-dt * 10));
  // googly pupils: a random glance now and then, constant rattling while moving
  const busy = c.mode !== 'idle';
  const glance = clock.t > (c.nextGlance || 0);
  if (glance) c.nextGlance = clock.t + 0.6 + Math.random() * 1.8;
  for (const pp of c.pupils) {
    if (glance || busy) { const kk = busy ? 0.25 : 0.9; pp.vx += (Math.random() - 0.5) * kk; pp.vy += (Math.random() - 0.5) * kk; }
    pp.vx += (-pp.ox * 90 - pp.vx * 4) * dt;
    pp.vy += (-pp.oy * 90 - pp.vy * 4) * dt;
    pp.ox = clamp(pp.ox + pp.vx * dt, -0.08, 0.08); pp.oy = clamp(pp.oy + pp.vy * dt, -0.08, 0.08);
    pp.mesh.position.x = pp.ox; pp.mesh.position.y = pp.oy;
  }
  if (c.prop) c.prop.rotation.y += dt * (c.mode === 'fly' ? 40 : 12);
  if (c.ring.visible) { const s = 1 + Math.sin(clock.t * 5) * 0.06; c.ring.scale.set(s, s, s); }
}
export function charsSettled() { return state.players.every(p => p.char.mode === 'idle'); }
// Hide any figure whose head is right at the lens (you, in first person), anyone who has left the game, and, on the
// screen of someone watching another player's turn online, anyone but the shooter within a few metres of the camera:
// they would fill the view. Distances are to the figure's body axis, from its feet to the top of its head.
// The few metres are WATCH_CLEAR on a 16:9 screen and grow as the view gets narrower, since a figure then fills more of
// its width: on a phone held upright the view is a third as wide, so the radius reaches WATCH_CLEAR_MAX. That still
// leaves the shooter, 10 m from the camera, and anyone next to them in sight.
const LENS_CLEAR = 2.6, WATCH_CLEAR = 4, WATCH_CLEAR_MAX = 8, BODY_H = 3;
const WIDE = Math.tan(27.5 * Math.PI / 180) * 16 / 9; // half the width of a 16:9 view at its 55° height, one unit away
export function hideNearCamera() {
  const c = camera.position, watching = !playsSeat(state.cur) && ['watch', 'flight', 'choose', 'settle'].includes(state.phase);
  const clear = clamp(WATCH_CLEAR * WIDE / (Math.tan(camera.fov * Math.PI / 360) * camera.aspect), WATCH_CLEAR, WATCH_CLEAR_MAX);
  for (const p of state.players) {
    const g = p.char.group, q = g.position;
    const head = Math.hypot(c.x - q.x, c.y - q.y - 2.2, c.z - q.z), body = Math.hypot(c.x - q.x, c.y - clamp(c.y, q.y, q.y + BODY_H), c.z - q.z);
    g.visible = !p.out && head > LENS_CLEAR && !(watching && p !== state.players[state.cur] && body < clear);
  }
}
