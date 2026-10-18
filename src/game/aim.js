// Aiming: angle limits, held aim buttons and keys, and zoom.

import { clamp } from '../core/math.js';
import { WEAPONS } from '../core/weapons.js';
import { sfx } from '../audio/sfx.js';
import { state } from './state.js';
import { invalidateReticle } from '../ui/reticle.js';

export function setPitch(v) { const W = WEAPONS[state.weapon]; state.pitch = clamp(v, W.pitchMin, W.pitchMax); }
export function setZoom(on) { state.zoom = on; invalidateReticle(); if (on) sfx.unlock(); }
// Held aim inputs: L/R turn, U/D change the angle. Each speeds up the longer it is held.
export const holds = new Map();
function nudge(k) { if (k === 'L') state.yaw += 0.003 / state.zoomF; else if (k === 'R') state.yaw -= 0.003 / state.zoomF; else setPitch(state.pitch + (k === 'U' ? 0.2 : -0.2) / state.zoomF); }
export function holdStart(k, src) { if (state.phase !== 'aim' || holds.has(k)) return; holds.set(k, { t: 0, src }); nudge(k); }
export function holdEnd(k, src) { const h = holds.get(k); if (h && (!src || h.src === src)) holds.delete(k); }
export function applyHolds(dt) {
  for (const [k, h] of holds) {
    h.t += dt; const a = Math.min(1, h.t * 0.8);
    if (k === 'L' || k === 'R') state.yaw += (k === 'L' ? 1 : -1) * (0.05 + a * 0.45) / state.zoomF * dt;
    else setPitch(state.pitch + (k === 'U' ? 1 : -1) * (2 + a * 16) / state.zoomF * dt);
  }
}
