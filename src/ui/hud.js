// HUD: hole card, wind readout, hint line, banners, callouts, toasts and the Fire button.

import { HOLES } from '../core/courses.js';
import { WEAPONS } from '../core/weapons.js';
import { $, COARSE } from '../platform.js';
import { currentLie, distToCup, state, world } from '../game/state.js';
import { ui } from './elements.js';
import { fmt1 } from './format.js';
import { mouseMode } from './pointerLock.js';

let windCache = '';
// Arrow relative to where you aim: pointing up means tailwind
export function updateWindHUD() {
  const M = world.M; if (!M || !M.wind) return;
  const w = M.wind;
  let rel = w.dir - state.yaw; while (rel > Math.PI) rel -= Math.PI * 2; while (rel < -Math.PI) rel += Math.PI * 2;
  const deg = Math.round(-rel * 180 / Math.PI), a = Math.abs(rel) * 180 / Math.PI;
  const txt = w.speed < 0.6 ? 'almost calm' : a < 35 ? 'tailwind' : a > 145 ? 'headwind' : (rel > 0 ? 'from the right' : 'from the left');
  const key = deg + '|' + fmt1(w.speed) + txt;
  if (key === windCache) return; windCache = key;
  ui.windArrow.style.transform = `rotate(${deg}deg)`;
  ui.hcWind.textContent = fmt1(w.speed); ui.hcWindRel.textContent = txt;
}
export function windText() {
  const w = world.M && world.M.wind; if (!w) return '';
  let rel = w.dir - state.yaw; while (rel > Math.PI) rel -= Math.PI * 2; while (rel < -Math.PI) rel += Math.PI * 2;
  const a = Math.abs(rel) * 180 / Math.PI;
  return w.speed < 0.6 ? 'almost calm' : a < 35 ? 'tailwind' : a > 145 ? 'headwind' : (rel > 0 ? 'from the right' : 'from the left');
}
export function setHint() {
  const W = WEAPONS[state.weapon], surf = world.M && state.players[state.cur] ? currentLie() : 'fairway';
  let lie = '';
  if (surf === 'sand') lie = W.sandProof ? 'Bunker, but the flare gun loses no power here. ' : 'You are in the bunker: −45% power. The flare gun loses nothing. ';
  else if (surf === 'rough' && !W.sandProof) lie = 'Rough: −15% power. ';
  const controls = mouseMode() ? 'The mouse aims. Hold the left button for power and release to fire. Right button zooms. Q switches weapon, 1–8 for a quick switch. Esc frees the mouse.'
    : COARSE ? 'Drag to look around and aim. ▲ ▼ change the angle. Hold Fire for power.'
    : 'Drag with the mouse or use the arrow keys to aim. Hold Space for power. Q switches weapon.';
  const base = state.shotsFired < 2 ? controls : `${W.name} (${W.club}, precision ${W.precision}/10). ${W.tip}`;
  ui.hint.textContent = lie + base;
}
export function setControls(on) {
  [ui.fire, ui.left, ui.right, ui.up, ui.down, ui.zoom, ui.bagBtn].forEach(b => { b.disabled = !on; });
}
export function updateHUD() {
  const def = HOLES[state.holeIdx], p = state.players[state.cur];
  $('#hcHole').textContent = state.holeIdx + 1; $('#hcPar').textContent = def.par; $('#hcName').textContent = def.name;
  if (p) {
    $('#hcChip').style.background = p.color; $('#hcPlayer').textContent = p.name;
    $('#hcStroke').textContent = p.done ? p.strokes : p.strokes + 1; $('#hcDist').textContent = Math.round(distToCup(p));
  }
}
let bannerTO = 0, calloutTO = 0, toastTO = 0;
export function showBanner(text, sub, color) {
  ui.banner.innerHTML = ''; const s = document.createElement('span'); s.textContent = text; s.style.color = color; ui.banner.appendChild(s);
  if (sub) { const sm = document.createElement('small'); sm.textContent = sub; ui.banner.appendChild(sm); }
  ui.banner.classList.add('show'); clearTimeout(bannerTO); bannerTO = setTimeout(() => ui.banner.classList.remove('show'), 1700);
}
export function callout(big, small, color) {
  ui.banner.classList.remove('show');
  ui.coBig.textContent = big; ui.coBig.style.color = color || ''; ui.coSmall.textContent = small || '';
  ui.callout.classList.remove('show'); void ui.callout.offsetWidth; ui.callout.classList.add('show');
  clearTimeout(calloutTO); calloutTO = setTimeout(() => ui.callout.classList.remove('show'), 2700);
}
export function toast(msg) { ui.toast.textContent = msg; ui.toast.classList.add('show'); clearTimeout(toastTO); toastTO = setTimeout(() => ui.toast.classList.remove('show'), 2400); }
export function setFill(p) {
  ui.fill.style.height = (p * 100).toFixed(1) + '%'; ui.fireSub.textContent = state.charging ? Math.round(p * 100) + '%' : 'hold';
  ui.retPower.setAttribute('stroke-dasharray', `${(p * 100).toFixed(1)} 100`);
  ui.reticle.classList.toggle('charging', state.charging);
}
