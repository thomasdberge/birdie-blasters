// The camera: first person while aiming, a chase cam during flight, a slow orbit between holes.

import * as THREE from 'three';
import { clamp, lerp } from '../core/math.js';
import { WEAPONS } from '../core/weapons.js';
import { REDUCED } from '../platform.js';
import { clock, state, world } from '../game/state.js';
import { baseFov, camera } from './scene.js';

export const cam = { pos: new THREE.Vector3(60, 60, 60), look: new THREE.Vector3(), dPos: new THREE.Vector3(), dLook: new THREE.Vector3(), k: 3, shake: 0, hdir: new THREE.Vector3(0, 0, -1), arrived: false };
export function shake(a) { if (!REDUCED) cam.shake = Math.max(cam.shake, a); }
function keepAbove(v, m) { const M = world.M; if (!M) return; const h = M.height(v.x, v.z) + m; if (v.y < h) v.y = h; }
export function updateCamera(dt) {
  const M = world.M; if (!M) return;
  let k = 3;
  if (state.phase === 'setup' || state.phase === 'between' || state.phase === 'end') {
    const mid = { x: (M.tee.x + M.cup.x) / 2, z: (M.tee.z + M.cup.z) / 2 }, a = clock.t * 0.06;
    cam.dPos.set(mid.x + Math.cos(a) * 150, 85, mid.z + Math.sin(a) * 150); cam.dLook.set(mid.x, 0, mid.z); k = 1.5;
  } else if (state.phase === 'aim' || state.phase === 'pick' || (state.phase === 'flight' && state.shot && state.shot.age < 0.35)) {
    // First person: the eye of the current player, looking along the crosshair
    const p = state.players[state.cur], W = state.phase === 'flight' ? state.shot.W : WEAPONS[state.weapon];
    // The view rises only about half as much as the barrel, so the course stays in sight on high lobs
    const pr = (state.pitch - aimOffset()) * Math.PI / 180, dx = Math.sin(state.yaw) * Math.cos(pr), dy = Math.sin(pr), dz = Math.cos(state.yaw) * Math.cos(pr);
    cam.dPos.set(p.ball.x, p.ball.y + W.eye, p.ball.z);
    cam.dLook.set(cam.dPos.x + dx * 20, cam.dPos.y + dy * 20, cam.dPos.z + dz * 20);
    if (!cam.arrived && cam.pos.distanceTo(cam.dPos) < 0.3 && cam.look.distanceTo(cam.dLook) < 0.6) cam.arrived = true;
    if (cam.arrived) {
      cam.pos.lerp(cam.dPos, 1 - Math.exp(-12 * dt));
      cam.look.set(cam.pos.x + dx * 20, cam.pos.y + dy * 20, cam.pos.z + dz * 20);
      applyCamera(dt); return;
    }
    k = 3.2;
  } else if (state.phase === 'choose' && state.choice) {
    // Look down over the bullets to choose between
    let cx = 0, cz = 0, cy = 0; for (const q of state.choice) { cx += q.b.x; cy += q.b.y; cz += q.b.z; }
    const n = state.choice.length; cx /= n; cy /= n; cz /= n;
    cam.dPos.set(cx - cam.hdir.x * 20, cy + 16, cz - cam.hdir.z * 20); keepAbove(cam.dPos, 3);
    cam.dLook.set(cx, cy, cz); k = 2.5;
  } else if ((state.phase === 'flight' || state.phase === 'settle') && state.shot) {
    const b = state.shot.projs[state.shot.primary].b, hv = Math.hypot(b.vx, b.vz);
    if (state.phase === 'flight' && hv > 1.5) { const tx = b.vx / hv, tz = b.vz / hv; cam.hdir.x = lerp(cam.hdir.x, tx, 1 - Math.exp(-dt * 3)); cam.hdir.z = lerp(cam.hdir.z, tz, 1 - Math.exp(-dt * 3)); cam.hdir.y = 0; cam.hdir.normalize(); }
    cam.dPos.set(b.x - cam.hdir.x * 13, b.y + 5, b.z - cam.hdir.z * 13); keepAbove(cam.dPos, 2.5);
    cam.dLook.set(b.x + cam.hdir.x * 5, b.y + 0.5, b.z + cam.hdir.z * 5);
    k = state.phase === 'flight' ? 6 : 2;
  }
  const f = 1 - Math.exp(-k * dt);
  cam.pos.lerp(cam.dPos, f); cam.look.lerp(cam.dLook, f);
  applyCamera(dt);
}
function applyCamera(dt) {
  camera.position.copy(cam.pos);
  if (cam.shake > 0.01) { camera.position.x += (Math.random() - 0.5) * cam.shake; camera.position.y += (Math.random() - 0.5) * cam.shake; cam.shake *= Math.exp(-dt * 5); }
  camera.lookAt(cam.look);
  const zf = lerp(state.zoomF, state.zoom && state.phase === 'aim' ? (WEAPONS[state.weapon].zoom || 3) : 1, 1 - Math.exp(-dt * 10));
  if (Math.abs(zf - state.zoomF) > 0.001) { state.zoomF = zf; camera.fov = baseFov / zf; camera.updateProjectionMatrix(); }
}
export function fpView() { return ((state.phase === 'aim' || state.phase === 'pick') && cam.arrived) || (state.phase === 'flight' && state.shot && state.shot.age < 0.35); }
// Degrees the crosshair sits above the centre of the view. Zero when zoomed, for precise shots.
export function aimOffset() { return clamp(state.pitch * 0.45, 0, 22) * clamp((3 - state.zoomF) / 2, 0, 1); }
