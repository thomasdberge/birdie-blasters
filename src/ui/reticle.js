// First-person reticle: crosshair, angle ladder and rangefinder readout.

import * as THREE from 'three';
import { CHAR_S } from '../core/rules.js';
import { WEAPONS } from '../core/weapons.js';
import { distToCup, state } from '../game/state.js';
import { cam } from '../render/camera.js';
import { camera, canvas } from '../render/scene.js';
import { ui } from './elements.js';

const tmpV = new THREE.Vector3();
let retCache = '';
export function invalidateReticle() { retCache = ''; }
export function updateReticle() {
  const show = state.phase === 'aim' && cam.arrived;
  if (ui.reticle.hidden === show) ui.reticle.hidden = !show;
  if (!show) return;
  const W = WEAPONS[state.weapon], me = state.players[state.cur];
  // Put the crosshair where the barrel actually points
  const pr = state.pitch * Math.PI / 180;
  tmpV.set(camera.position.x + Math.sin(state.yaw) * Math.cos(pr) * 100, camera.position.y + Math.sin(pr) * 100, camera.position.z + Math.cos(state.yaw) * Math.cos(pr) * 100).project(camera);
  const cx = tmpV.x, cy = tmpV.y;
  const ty = (-cy * canvas.clientHeight / 2).toFixed(1), tx = (cx * canvas.clientWidth / 2).toFixed(1);
  const tf = `translate(${tx}px, ${ty}px)`;
  if (ui.retMove.style.transform !== tf) ui.retMove.style.transform = tf;
  // Rangefinder: name and distance of whoever sits under the crosshair, otherwise the flag
  let target = null, best = 0.07 * state.zoomF;
  state.players.forEach((p, i) => {
    if (i === state.cur || p.done) return;
    const c = p.char.group.position;
    tmpV.set(c.x, c.y + 2.0 * CHAR_S, c.z).project(camera);
    if (tmpV.z > 1) return;
    const d = Math.hypot((tmpV.x - cx) * camera.aspect, tmpV.y - cy);
    if (d < best) { best = d; target = p; }
  });
  const pitchTxt = (state.pitch > 0.05 ? '+' : '') + state.pitch.toFixed(1) + '°' + (state.charging ? ` · ${Math.round(state.power * 100)}%` : '');
  const tc = target && target.char.group.position;
  const tgt = target ? `${target.name} · ${Math.round(Math.hypot(tc.x - me.ball.x, tc.z - me.ball.z))} m` : `Flag · ${Math.round(distToCup(me))} m`;
  const key = pitchTxt + tgt + (target ? target.color : '') + state.weapon + state.zoom;
  if (key === retCache) return;
  retCache = key;
  ui.retPitch.textContent = pitchTxt;
  ui.retTarget.textContent = tgt;
  ui.retTarget.style.color = target ? target.color : '';
  ui.reticle.classList.toggle('locked', !!target);
  ui.rlMax.textContent = W.pitchMax + '°'; ui.rlMin.textContent = W.pitchMin + '°';
  ui.rlMark.style.bottom = ((state.pitch - W.pitchMin) / (W.pitchMax - W.pitchMin) * 100).toFixed(1) + '%';
  ui.zoom.textContent = state.zoom ? 'Zoom ' + (W.zoom || 3) + '×' : 'Zoom 1×'; ui.zoom.setAttribute('aria-pressed', state.zoom ? 'true' : 'false');
}
