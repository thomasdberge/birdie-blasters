// The golf bag: the weapon picker.

import { lieFactor, WEAPONS } from '../core/weapons.js';
import { MOUSE } from '../platform.js';
import { sfx } from '../audio/sfx.js';
import { holds, setZoom } from '../game/aim.js';
import { cancelCharge } from '../game/shot.js';
import { distToCup, game, state, world } from '../game/state.js';
import { autoWeapon } from '../game/turns.js';
import { showWeapon } from '../render/characters.js';
import { vmShow } from '../render/viewmodel.js';
import { ui } from './elements.js';
import { fmt1, genitive, SURF_NAME } from './format.js';
import { setControls, setHint, windText } from './hud.js';
import { exitLock, mouseMode, requestLock } from './pointerLock.js';
import { invalidateReticle } from './reticle.js';

const FX = { bazooka: 'Rocket motor. Tailwind adds speed.', grenade: 'Energy burst after the first bounce.', sniper: '5× scope shows the landing spot.', auto: 'Three bullets. You pick which one counts.',
  shotgun: 'Pulled toward the hole in the last 12 m.', pistol: 'Floats down and stops fast.', flare: 'No power loss in sand or rough.', dart: 'Drops steeply. Easy to putt with.' };
export const wbtns = [];
export function initBag() {
  ui.bag.innerHTML = WEAPONS.map((w, i) => `<button type="button" class="bagitem" role="radio" data-i="${i}" aria-checked="false" aria-label="${w.name}, ${w.club}, up to ${w.range} metres, precision ${w.precision} of 10. ${FX[w.id]}">
  <span class="bi-top"><span>${w.club}</span><span class="bi-key">${i + 1}</span></span>
  <span class="bi-name">${w.name}</span>
  <span class="bi-row"><span class="bi-range" data-range>≤ ${w.range} m</span><span class="bi-pips">${Array.from({ length: 10 }, (_, k) => `<i class="${k < w.precision ? 'on' : ''}"></i>`).join('')}</span></span>
  <span class="bi-fx">${FX[w.id]}</span></button>`).join('');
  wbtns.push(...ui.bag.querySelectorAll('.bagitem'));
  wbtns.forEach((b, i) => b.addEventListener('click', () => confirmPick(i)));
}
export function selectWeapon(i) {
  state.weapon = i; state.pitch = WEAPONS[i].pitchDef; invalidateReticle();
  wbtns.forEach((b, k) => b.setAttribute('aria-checked', k === i ? 'true' : 'false'));
  const p = state.players[state.cur]; if (p) showWeapon(p.char, WEAPONS[i].id);
  vmShow(WEAPONS[i].id);
  setHint();
}
// The golf bag opens at the start of every turn (recommended weapon marked) and again on Q / "Switch weapon"
export function openPick(fresh) {
  const p = state.players[state.cur], M = world.M; if (!p) return;
  cancelCharge(); setZoom(false); exitLock(); holds.clear();
  state.phase = 'pick';
  const surf = M.surface(p.ball.x, p.ball.z), rec = autoWeapon(p);
  if (fresh) selectWeapon(rec);
  ui.pickTitle.textContent = game.online ? `Your turn · stroke ${p.strokes + 1}`
    : state.players.length > 1 ? `${genitive(p.name)} turn · stroke ${p.strokes + 1}` : `Stroke ${p.strokes + 1}`;
  ui.pickInfo.textContent = `${Math.round(distToCup(p))} m to the flag · ${SURF_NAME[surf] || surf} · wind ${fmt1(M.wind.speed)} m/s ${windText()}`;
  wbtns.forEach((b, k) => {
    b.classList.toggle('rec', k === rec);
    const old = b.querySelector('.bi-rec'); if (old) old.remove();
    if (k === rec) { const r = document.createElement('span'); r.className = 'bi-rec'; r.textContent = 'Recommended'; b.prepend(r); }
    const W = WEAPONS[k], lf = lieFactor(W, surf), rg = b.querySelector('[data-range]');
    rg.innerHTML = lf < 1 ? `≤ ${Math.round(W.range * lf / 5) * 5} m<small>${surf === 'sand' ? 'sand' : 'rough'}</small>` : `≤ ${W.range} m`;
  });
  ui.pickFoot.textContent = MOUSE ? 'Click a weapon or press 1–8. Enter takes the highlighted one.' : 'Tap the weapon you want to use.';
  ui.pick.hidden = false; ui.hud.classList.add('picking');
  setControls(false);
  const sel = wbtns[state.weapon]; if (sel && MOUSE) sel.focus({ preventScroll: true });
}
export function confirmPick(i) {
  if (state.phase !== 'pick') return;
  sfx.unlock();
  selectWeapon(i);
  ui.pick.hidden = true; ui.hud.classList.remove('picking');
  state.phase = 'aim'; setControls(true); invalidateReticle();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  if (mouseMode()) requestLock(); // the click or key press that picked the weapon also locks the mouse
  setHint();
}
