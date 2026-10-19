// Charging and firing a shot, then playing it back on screen: flight, hits, explosions, water, out of bounds and the cup.
// The match decides the whole shot the moment it is fired; playback shows it step by step, so slow motion still works.

import { HOLES } from '../core/courses.js';
import { strokeCap } from '../core/match.js';
import { BALL_R, STEP } from '../core/physics.js';
import { CHAR_S, golfTerm } from '../core/rules.js';
import { SAMPLE_HZ } from '../core/shot.js';
import { WEAPONS } from '../core/weapons.js';
import { sfx } from '../audio/sfx.js';
import { setZoom } from './aim.js';
import { clock, game, later, state, world } from './state.js';
import { layoutChars, nextTurn, showSeat } from './turns.js';
import { cam, shake } from '../render/camera.js';
import { launchFly } from '../render/characters.js';
import { dirtPuff, spawn } from '../render/particles.js';
import { makeProjectile, numberSprite, removeShotVisuals } from '../render/projectiles.js';
import { disposeTree, scene } from '../render/scene.js';
import { vm } from '../render/viewmodel.js';
import { ui } from '../ui/elements.js';
import { SURF_NAME } from '../ui/format.js';
import { callout, setControls, setFill, toast, updateHUD } from '../ui/hud.js';
import { exitLock, mouseMode } from '../ui/pointerLock.js';

const SAMPLE_EVERY = Math.round(1 / (STEP * SAMPLE_HZ)); // simulation steps between recorded path samples

export function cancelCharge() { if (!state.charging) return; state.charging = false; ui.fire.classList.remove('charging'); setFill(0); }
export function startCharge() {
  if (state.phase !== 'aim' || state.charging) return;
  sfx.unlock(); state.charging = true; state.chargeT = 0; state.power = 0; ui.fire.classList.add('charging');
}
export function releaseCharge() {
  if (!state.charging) return;
  state.charging = false; ui.fire.classList.remove('charging');
  if (state.power < 0.04) { setFill(0); toast(mouseMode() ? 'Not enough power. Hold the button a little longer.' : 'Not enough power. Hold Fire a little longer.'); return; }
  fire(state.power);
}
function fire(power) {
  const pi = state.cur, p = state.players[pi], W = WEAPONS[state.weapon];
  const { shot, result } = game.match.shoot(pi, { weapon: state.weapon, yaw: state.yaw, pitch: state.pitch, power });
  p.strokes++; state.shotsFired++;
  state.phase = 'flight'; setControls(false); setFill(power); updateHUD();
  ui.fireSub.textContent = Math.round(power * 100) + '%';
  const projs = shot.projs.map(data => ({ data, b: { ...data.launch }, vis: makeProjectile(W), delay: 0, active: true, result: null, trailT: 0, lastBounce: 0, sinking: null, gone: false }));
  // step: simulation steps played so far · next: the next event to show · hit: someone was hit
  state.shot = { W, shooter: pi, age: 0, acc: 0, step: 0, next: 0, events: shot.events, outcome: shot.outcome, result, hit: false, active: true, color: p.color, projs, primary: 0 };
  projs.forEach(q => { q.vis.g.visible = false; placeProjectile(q, 0); });
  cam.hdir.set(Math.sin(state.yaw), 0, Math.cos(state.yaw));
  p.char.recoil = W.id === 'bazooka' || W.id === 'shotgun' ? 1 : 0.6; p.char.ring.visible = false;
  vm.recoil = { dart: 0.5, auto: 0.45, pistol: 0.6, flare: 0.7 }[W.id] || 1; setZoom(false);
  sfx.shot(W.id);
  const b = projs[0].b, sp = Math.hypot(b.vx, b.vy, b.vz) || 1, ux = b.vx / sp, uy = b.vy / sp, uz = b.vz / sp;
  // Muzzle flash a little ahead of the eye so it does not fill the first-person view
  const flash = W.id === 'dart' ? 0xf2eed6 : W.id === 'flare' ? 0xff3b5c : 0xffc04d;
  for (let k = 0; k < 8; k++) spawn({ x: b.x + ux * 1.2, y: b.y + uy * 1.2, z: b.z + uz * 1.2, vx: ux * 3 + (Math.random() - 0.5) * 2, vy: uy * 3 + Math.random(), vz: uz * 3 + (Math.random() - 0.5) * 2, size: 0.12, grow: 0.8, life: 0.25, color: flash, opacity: 0.9, drag: 4 });
  if (W.id === 'bazooka') { shake(0.5); for (let k = 0; k < 10; k++) spawn({ x: b.x - ux * 3, y: b.y, z: b.z - uz * 3, vx: -ux * 4 + (Math.random() - 0.5) * 3, vy: Math.random() * 2, vz: -uz * 4 + (Math.random() - 0.5) * 3, size: 0.5, grow: 2, life: 1.0, color: 0xd9d6c8, opacity: 0.7, drag: 2 }); }
  if (W.id === 'shotgun') { shake(0.35); for (let k = 0; k < 14; k++) spawn({ x: b.x + ux * 1.5, y: b.y + uy * 1.5, z: b.z + uz * 1.5, vx: ux * 26 + (Math.random() - 0.5) * 7, vy: uy * 26 + (Math.random() - 0.5) * 5, vz: uz * 26 + (Math.random() - 0.5) * 7, size: 0.06, life: 0.7, color: 0x50574a, grav: 1 }); }
}
// Puts a projectile where its recorded path has it after n simulation steps, with the velocity it is moving at
function placeProjectile(q, n) {
  const d = q.data, p = d.path, b = q.b, last = p.length / 3 - 1, f = n / SAMPLE_EVERY;
  q.delay = n < d.startStep ? (d.startStep - n) * STEP : 0; // a rifle bullet waiting to leave the barrel
  b.t = Math.max(0, n - d.startStep) * STEP;
  if (n > d.endStep) { Object.assign(b, { x: d.final.x, y: d.final.y, z: d.final.z, vx: d.final.vx, vy: d.final.vy, vz: d.final.vz, surf: d.final.surf }); return; }
  let i, t, x1, y1, z1;
  if (f < last) { i = Math.floor(f); t = f - i; x1 = p[i * 3 + 3]; y1 = p[i * 3 + 4]; z1 = p[i * 3 + 5]; }
  else { i = last; t = (n - last * SAMPLE_EVERY) / (d.endStep + 1 - last * SAMPLE_EVERY); x1 = d.final.x; y1 = d.final.y; z1 = d.final.z; }
  const x = p[i * 3] + (x1 - p[i * 3]) * t, y = p[i * 3 + 1] + (y1 - p[i * 3 + 1]) * t, z = p[i * 3 + 2] + (z1 - p[i * 3 + 2]) * t;
  if (n > 0) { b.vx = (x - b.x) / STEP; b.vy = (y - b.y) / STEP; b.vz = (z - b.z) / STEP; }
  b.x = x; b.y = y; b.z = z;
}
// One simulation step of playback: whatever happened in this step happens on screen now
export function playShotStep() {
  const s = state.shot;
  while (s.next < s.events.length && s.events[s.next].step === s.step) showEvent(s.events[s.next++]);
  s.step++;
  for (const q of s.projs) placeProjectile(q, s.step);
  if (s.active && s.projs.every(q => !q.active)) { s.active = false; resolveShot(); }
}
function showEvent(e) {
  const q = state.shot.projs[e.proj], at = e.at;
  if (e.type === 'bounce') {
    if (clock.t - q.lastBounce > 0.08) { q.lastBounce = clock.t; sfx.bounce(e.imp); dirtPuff(at.x, at.y - BALL_R, at.z, e.imp, e.surf); }
  } else if (e.type === 'burst') energyBurst(at.x, at.y, at.z);
  else if (e.type === 'explode') explode(at.x, at.y, at.z);
  else if (e.type === 'hit') knock(e);
  else if (e.type === 'end') endProj(q, e.result, at);
}
function energyBurst(x, y, z) {
  sfx.burst(); shake(0.3);
  spawn({ x, y, z, size: 0.4, grow: 9, life: 0.35, color: 0x5ff5d2, opacity: 0.8 });
  for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; spawn({ x, y: y + 0.2, z, vx: Math.cos(a) * 7, vy: 1.5, vz: Math.sin(a) * 7, size: 0.14, life: 0.6, color: k % 2 ? 0x5ff5d2 : 0xffffff, drag: 2 }); }
}
function explode(x, y, z) {
  sfx.boom(); shake(1.4);
  spawn({ x, y, z, size: 0.6, grow: 22, life: 0.35, color: 0xffd447, opacity: 1 });
  spawn({ x, y, z, size: 0.4, grow: 16, life: 0.5, color: 0xff6b17, opacity: 0.9 });
  for (let k = 0; k < 12; k++) spawn({ x: x + (Math.random() - 0.5) * 3, y: y + Math.random() * 2, z: z + (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 3, size: 1, grow: 2.5, life: 1.8, color: 0x7d7a6e, opacity: 0.7, drag: 1.2 });
  for (let k = 0; k < 18; k++) { const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 8; spawn({ x, y: y + 0.3, z, vx: Math.cos(a) * sp, vy: 6 + Math.random() * 8, vz: Math.sin(a) * sp, size: 0.18 + Math.random() * 0.2, life: 1.4, color: 0x5a4628, grav: 1 }); }
}
// A hit: the player flies to where the match sent them
function knock(e) {
  const s = state.shot, p = state.players[e.player], old = { x: p.ball.x, z: p.ball.z }, target = e.to, cp = p.char.group.position;
  let big, small;
  s.hit = true;
  if (e.kind !== 'blast') for (let k = 0; k < 10; k++) { const a = Math.random() * Math.PI * 2; spawn({ x: cp.x, y: cp.y + 2.8 * CHAR_S, z: cp.z, vx: Math.cos(a) * 3, vy: 2 + Math.random() * 2, vz: Math.sin(a) * 3, size: 0.18, life: 0.9, color: 0xffd447, grav: 0.4 }); }
  if (e.kind === 'head') {
    const moved = Math.hypot(target.x - old.x, target.z - old.z);
    big = 'HEADSHOT!'; small = moved < 4 ? `${p.name} was already on the tee. Lucky.` : `${p.name} goes all the way back to the tee`;
    state.timeScale = 0.22; state.slowT = 1.0; sfx.ding(); sfx.bonk();
  } else if (e.kind === 'body') {
    const moved = Math.round(Math.hypot(target.x - old.x, target.z - old.z));
    big = 'HIT!'; small = moved < 4 ? `${p.name} was on the tee and got away with it` : `${p.name} flies ${moved} m back`;
    state.timeScale = 0.45; state.slowT = 0.6; sfx.bonk();
  } else {
    big = 'BOOM!'; small = `${p.name} got blown ${Math.round(Math.hypot(target.x - old.x, target.z - old.z))} m away`;
  }
  p.ball = { x: target.x, y: target.y, z: target.z };
  const dist = Math.hypot(target.x - cp.x, target.z - cp.z);
  launchFly(p.char, target, 0.9 + Math.min(dist, 220) / 90, 5 + Math.min(dist, 220) * 0.12);
  callout(big, small, p.color);
}
// One projectile has finished. Effects happen now; the result waits until every projectile is done.
function endProj(q, type, at) {
  q.active = false; q.result = type;
  if (type === 'water') {
    sfx.splash(); q.gone = true;
    for (let k = 0; k < 24; k++) { const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 3; spawn({ x: at.x, y: at.y, z: at.z, vx: Math.cos(a) * sp, vy: 4 + Math.random() * 6, vz: Math.sin(a) * sp, size: 0.2, life: 1, color: k % 2 ? 0xffffff : 0x9fdcff, grav: 1 }); }
  } else if (type === 'oob') { sfx.miss(); q.gone = true; }
  else if (type === 'cup') { q.sinking = 0; sfx.cup(); }
}
function resolveShot() {
  const s = state.shot; state.phase = 'settle';
  if (s.outcome.type !== 'choose') { finishShot(s.result, s.projs[s.outcome.proj]); return; }
  // Assault rifle: the player picks which bullet counts
  const rest = s.outcome.candidates.map(k => s.projs[k]);
  state.phase = 'choose'; state.choice = rest; exitLock();
  const M = world.M;
  rest.forEach((q, k) => { q.marker = numberSprite(k + 1, s.color); q.marker.position.set(q.b.x, q.b.y + 1.4, q.b.z); scene.add(q.marker); });
  ui.chooseRow.innerHTML = rest.map((q, k) => {
    const d = Math.round(Math.hypot(q.b.x - M.cup.x, q.b.z - M.cup.z)), surf = SURF_NAME[M.surface(q.b.x, q.b.z)] || '';
    return `<button type="button" class="cbtn" data-k="${k}"><b>${k + 1}</b><span>${d} m to go</span><small>${surf}</small></button>`;
  }).join('');
  ui.chooseRow.querySelectorAll('.cbtn').forEach(btn => btn.addEventListener('click', () => chooseBullet(+btn.dataset.k)));
  ui.choose.hidden = false;
  const best = ui.chooseRow.querySelector('.cbtn'); if (best) best.focus({ preventScroll: true });
}
export function chooseBullet(k) {
  if (state.phase !== 'choose' || !state.choice || !state.choice[k]) return;
  const q = state.choice[k], { result } = game.match.chooseBullet(state.shot.shooter, k);
  ui.choose.hidden = true;
  state.shot.projs.forEach(o => { if (o.marker) { scene.remove(o.marker); disposeTree(o.marker); o.marker = null; } if (o !== q) o.gone = true; });
  state.choice = null; state.phase = 'settle';
  finishShot(result, q);
}
// The shot is over: the screen catches up with the match's result for the shooter
function finishShot(result, q) {
  const s = state.shot, p = state.players[s.shooter], def = HOLES[state.holeIdx], M = world.M;
  s.projs.forEach(o => { if (o !== q) o.gone = true; });
  s.primary = s.projs.indexOf(q);
  showSeat(s.shooter);
  let delay = 1.0;
  if (result.type === 'rest') {
    if (q.b.surf === 'sand' && !s.hit) toast('Straight into the bunker. The flare gun loses no power there.');
  } else if (result.type === 'cup') {
    delay = 1.8;
    callout(golfTerm(p.strokes, def.par), `${p.name} holes out in ${p.strokes} ${p.strokes === 1 ? 'stroke' : 'strokes'}`, p.color);
    for (let k = 0; k < 40; k++) { const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 5; spawn({ x: M.cup.x, y: M.cup.y + 0.5, z: M.cup.z, vx: Math.cos(a) * sp, vy: 6 + Math.random() * 7, vz: Math.sin(a) * sp, size: 0.16, life: 1.8, color: [0xff5fa2, 0x3db8ff, 0xffcf3d, 0xb07cff, 0xff6b17][k % 5], grav: 0.5, drag: 0.8 }); }
  } else if (result.type === 'water') {
    callout('SPLASH!', `+1 stroke. ${p.name} shoots again from the same spot.`, '#3db8ff');
  } else {
    callout('OUT OF BOUNDS!', `+1 stroke. ${p.name} shoots again from the same spot.`, '#f2eed6');
  }
  if (result.picked) {
    later(delay, () => callout('PICKED UP', `Max ${strokeCap(state.holeIdx)} strokes on this hole`, p.color));
    delay += 1.6;
  }
  updateHUD();
  later(delay, () => {
    removeShotVisuals(); layoutChars(false);
    state.waitFn = () => later(0.5, nextTurn);
  });
}
