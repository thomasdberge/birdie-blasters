import { MOUSE } from '../platform.js';
import { sfx } from '../audio/sfx.js';
import { setPitch, setZoom } from '../game/aim.js';
import { cancelCharge } from '../game/shot.js';
import { state } from '../game/state.js';
import { canvas } from '../render/scene.js';
import { ui } from './elements.js';
import { setHint, toast } from './hud.js';

// Pointer lock: the crosshair follows the mouse with no button held. Falls back to drag-to-aim if the browser refuses.
let lockErrors = 0, lastUnlockT = 0;
export function mouseMode() { return MOUSE && !state.lockFailed; }
export function requestLock() {
  if (!canvas.requestPointerLock) { state.lockFailed = true; setHint(); return; }
  try { const r = canvas.requestPointerLock(); if (r && typeof r.catch === 'function') r.catch(onLockError); } catch (e) { onLockError(); }
}
export function exitLock() { if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock(); }
function onLockError() {
  if (state.locked) return;
  if (performance.now() - lastUnlockT < 1600) return; // the browser blocks relocking right after Esc; just wait for the next click
  if (++lockErrors >= 2) { state.lockFailed = true; setHint(); toast('Your browser will not let the game lock the mouse. Drag to aim instead.'); }
}
export function updateLockUI() {
  const mm = mouseMode();
  if (ui.hud.classList.contains('mousemode') !== mm) ui.hud.classList.toggle('mousemode', mm);
  const prompt = mm && state.phase === 'aim' && !state.locked;
  if (ui.lockPrompt.hidden === prompt) ui.lockPrompt.hidden = !prompt;
}
export function initPointerLock() {
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (state.locked) lockErrors = 0;
    else { lastUnlockT = performance.now(); cancelCharge(); if (state.zoom) setZoom(false); }
  });
  document.addEventListener('pointerlockerror', onLockError);
  document.addEventListener('mousemove', e => {
    if (!state.locked || state.phase !== 'aim') return;
    if (Math.abs(e.movementX) > 250 || Math.abs(e.movementY) > 250) return; // some browsers send one huge jump right after locking
    const sens = 0.0022 / state.zoomF;
    state.yaw -= e.movementX * sens;
    setPitch(state.pitch - e.movementY * sens * 57.3);
  });
  ui.lockPrompt.addEventListener('click', () => { sfx.unlock(); requestLock(); });
}
