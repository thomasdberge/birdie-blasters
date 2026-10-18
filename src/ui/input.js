// Mouse, touch and keyboard controls.

import { clamp } from '../core/math.js';
import { WEAPONS } from '../core/weapons.js';
import { $, COARSE } from '../platform.js';
import { sfx } from '../audio/sfx.js';
import { holdEnd, holds, holdStart, setPitch, setZoom } from '../game/aim.js';
import { cancelCharge, chooseBullet, releaseCharge, startCharge } from '../game/shot.js';
import { state } from '../game/state.js';
import { canvas } from '../render/scene.js';
import { confirmPick, openPick, selectWeapon, wbtns } from './bag.js';
import { ui } from './elements.js';
import { mouseMode, requestLock } from './pointerLock.js';
import { showBoard } from './scorecard.js';

let drag = null;
export function initInput() {
  canvas.addEventListener('pointerdown', e => {
    sfx.unlock();
    if (state.phase !== 'aim') return;
    if (mouseMode() && e.pointerType === 'mouse') {
      // FPS style: first click locks the mouse; then left button charges and right button zooms
      if (!state.locked) { requestLock(); return; }
      if (e.button === 0) startCharge();
      else if (e.button === 2) setZoom(true);
      return;
    }
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag || drag.id !== e.pointerId || state.phase !== 'aim') return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    // Look follows the finger: drag right to turn right, drag up to aim higher. Slower when zoomed.
    const sens = (COARSE ? 0.0042 : 0.0032) / state.zoomF;
    state.yaw -= dx * sens;
    setPitch(state.pitch - dy * sens * 57.3 * 0.8);
  });
  const endDrag = e => { if (drag && drag.id === e.pointerId) drag = null; };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
  let wheelT = 0;
  canvas.addEventListener('wheel', e => {
    if (state.phase !== 'aim') return;
    e.preventDefault();
    if (performance.now() - wheelT < 250 || Math.abs(e.deltaY) < 4) return;
    wheelT = performance.now(); setZoom(e.deltaY < 0);
  }, { passive: false });
  ['contextmenu'].forEach(ev => { canvas.addEventListener(ev, e => e.preventDefault()); ui.fire.addEventListener(ev, e => e.preventDefault()); });

  function bindAim(btn, k) {
    btn.addEventListener('pointerdown', e => {
      if (btn.disabled) return; e.preventDefault(); sfx.unlock();
      holdStart(k, 'btn');
      try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    const stop = () => holdEnd(k, 'btn');
    btn.addEventListener('pointerup', stop); btn.addEventListener('pointercancel', stop); btn.addEventListener('lostpointercapture', stop);
    btn.addEventListener('contextmenu', e => e.preventDefault());
  }
  bindAim(ui.left, 'L'); bindAim(ui.right, 'R'); bindAim(ui.up, 'U'); bindAim(ui.down, 'D');
  ui.zoom.addEventListener('click', () => { if (state.phase === 'aim') setZoom(!state.zoom); });
  ui.fire.addEventListener('pointerdown', e => { if (ui.fire.disabled) return; e.preventDefault(); startCharge(); });
  window.addEventListener('pointerup', e => {
    if (e.button === 2 && mouseMode()) { if (state.zoom) setZoom(false); return; }
    releaseCharge();
  });
  window.addEventListener('pointercancel', () => cancelCharge());
  ui.fire.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); startCharge(); } });
  ui.fire.addEventListener('keyup', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); releaseCharge(); } });
  const ARROWS = { ArrowLeft: 'L', ArrowRight: 'R', ArrowUp: 'U', ArrowDown: 'D' };
  window.addEventListener('keydown', e => {
    if (ui.hud.hidden || !ui.board.hidden) return;
    if (state.phase === 'choose' && /^[1-3]$/.test(e.key)) { chooseBullet(+e.key - 1); return; }
    if (state.phase === 'pick') {
      // Golf bag: number keys pick directly, arrows move the marker, Enter takes the marked weapon
      const n = WEAPONS.length, cols = window.innerWidth <= 620 ? 2 : 4;
      if (/^[1-9]$/.test(e.key) && +e.key <= n) { e.preventDefault(); confirmPick(+e.key - 1); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); confirmPick(state.weapon); }
      else if (ARROWS[e.key]) {
        e.preventDefault();
        const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
        const i = clamp(state.weapon + d, 0, n - 1); selectWeapon(i); wbtns[i].focus({ preventScroll: true });
      }
      return;
    }
    if ((e.key === 'q' || e.key === 'Q') && state.phase === 'aim') { e.preventDefault(); openPick(false); return; }
    if (document.activeElement === ui.fire && (e.key === ' ' || e.key === 'Enter')) return;
    if (e.key === ' ') { e.preventDefault(); if (!e.repeat) startCharge(); }
    else if (ARROWS[e.key]) { e.preventDefault(); holdStart(ARROWS[e.key], 'key'); }
    else if ((e.key === 'z' || e.key === 'Z') && !e.repeat && state.phase === 'aim') setZoom(!state.zoom);
    else if (/^[1-9]$/.test(e.key) && state.phase === 'aim' && +e.key <= WEAPONS.length) selectWeapon(+e.key - 1);
    else if (/^[1-3]$/.test(e.key) && state.phase === 'choose') chooseBullet(+e.key - 1);
  });
  window.addEventListener('keyup', e => {
    if (e.key === ' ') { e.preventDefault(); releaseCharge(); }
    if (ARROWS[e.key]) holdEnd(ARROWS[e.key], 'key');
  });
  window.addEventListener('blur', () => { holds.clear(); cancelCharge(); });
  ui.bagBtn.addEventListener('click', () => { if (state.phase === 'aim') openPick(false); });
  $('#holeCard').addEventListener('click', () => { if (['aim', 'pick', 'flight', 'settle'].includes(state.phase)) showBoard('peek'); });
  function setMuteLabel() { ui.mute.textContent = sfx.muted ? 'Sound off' : 'Sound on'; ui.mute.setAttribute('aria-pressed', sfx.muted ? 'true' : 'false'); }
  ui.mute.addEventListener('click', () => { sfx.setMuted(!sfx.muted); setMuteLabel(); });
  setMuteLabel();
}
