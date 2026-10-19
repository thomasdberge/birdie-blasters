// Charging, firing and resolving a shot: flight, hits, explosions, water, out of bounds and the cup.

import { CUP_R, HOLES, validPos } from '../core/courses.js';
import { clamp } from '../core/math.js';
import { BALL_R, STEP, stepBall } from '../core/physics.js';
import { BLAST_R, CHAR_S, golfTerm, KNOCK } from '../core/rules.js';
import { launchShot } from '../core/shot.js';
import { WEAPONS } from '../core/weapons.js';
import { sfx } from '../audio/sfx.js';
import { setZoom } from './aim.js';
import { cap, clock, later, state, teeSpot, world } from './state.js';
import { layoutChars, nextTurn } from './turns.js';
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
  const pi = state.cur, p = state.players[pi], W = WEAPONS[state.weapon], M = world.M;
  p.strokes++; state.shotsFired++;
  state.phase = 'flight'; setControls(false); setFill(power); updateHUD();
  ui.fireSub.textContent = Math.round(power * 100) + '%';
  const projs = launchShot(M, W, { yaw: state.yaw, pitch: state.pitch, power }, p.ball, Math.random)
    .map((b, k) => ({ b, vis: makeProjectile(W), delay: k * 0.09, active: true, result: null, still: 0, trailT: 0, lastBounce: 0, sinking: null, gone: false }));
  state.shot = { W, shooter: pi, age: 0, acc: 0, hits: new Set(), exploded: false, active: true, color: p.color, projs, primary: 0 };
  projs.forEach(q => { q.vis.g.visible = false; });
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
// Runs the same rules as simulateShot in core/shot.js, one step at a time with effects. Both are checked
// against tests/golden/shots.json; this copy goes once the game plays back simulated shots instead.
export function simShotStep() {
  const s = state.shot, W = s.W, M = world.M;
  for (const q of s.projs) {
    if (!q.active) continue;
    if (q.delay > 0) { q.delay -= STEP; continue; }
    const b = q.b;
    const imp = stepBall(b, STEP, W, M, true);
    if (imp > 0 || b.contact) {
      if (W.explode && !s.exploded) explode(b.x, b.y, b.z, -1);
      if (imp > 2.5 && clock.t - q.lastBounce > 0.08) { q.lastBounce = clock.t; sfx.bounce(imp); dirtPuff(b.x, b.y - BALL_R, b.z, imp, b.surf); }
    }
    if (b.justBurst) { b.justBurst = false; energyBurst(b.x, b.y, b.z); }
    hitPlayers(q);
    for (const pd of M.ponds) if (b.y - BALL_R * 0.5 < pd.level && Math.hypot(b.x - pd.x, b.z - pd.z) < pd.r + 6) { endProj(q, 'water'); break; }
    if (!q.active) continue;
    if (b.x < M.ext.x0 || b.x > M.ext.x1 || b.z < M.ext.z0 || b.z > M.ext.z1 || b.y < -60 || (b.contact && b.surf === 'oob')) { endProj(q, 'oob'); continue; }
    const dc = Math.hypot(b.x - M.cup.x, b.z - M.cup.z);
    if (dc < (W.cupR || CUP_R) && b.y - BALL_R < M.cup.y + 0.35 && Math.hypot(b.vx, b.vz) < (W.cupV || 7.5) && b.vy < 3) { endProj(q, 'cup'); continue; }
    const sp = Math.hypot(b.vx, b.vy, b.vz);
    if (b.contact && sp < 0.3) { q.still += STEP; if (q.still > 0.25) { endProj(q, 'rest'); continue; } } else q.still = 0;
    if (b.t > 24) endProj(q, 'rest');
  }
  if (s.active && s.projs.every(q => !q.active)) { s.active = false; resolveShot(); }
}
function energyBurst(x, y, z) {
  sfx.burst(); shake(0.3);
  spawn({ x, y, z, size: 0.4, grow: 9, life: 0.35, color: 0x5ff5d2, opacity: 0.8 });
  for (let k = 0; k < 16; k++) { const a = k / 16 * Math.PI * 2; spawn({ x, y: y + 0.2, z, vx: Math.cos(a) * 7, vy: 1.5, vz: Math.sin(a) * 7, size: 0.14, life: 0.6, color: k % 2 ? 0x5ff5d2 : 0xffffff, drag: 2 }); }
}
function hitPlayers(q) {
  const s = state.shot, b = q.b;
  state.players.forEach((p, i) => {
    if (!q.active || i === s.shooter || s.hits.has(i) || p.done) return;
    const c = p.char; if (c.mode === 'fly' || c.mode === 'poof') return;
    const cp = c.group.position;
    const head = Math.hypot(b.x - cp.x, b.y - (cp.y + 2.02 * CHAR_S), b.z - cp.z) < 0.52 * CHAR_S + BALL_R + 0.08;
    const body = !head && Math.hypot(b.x - cp.x, b.z - cp.z) < 0.74 * CHAR_S + BALL_R && b.y > cp.y - 0.1 && b.y < cp.y + 1.62 * CHAR_S;
    if (!head && !body) return;
    s.hits.add(i);
    for (let k = 0; k < 10; k++) { const a = Math.random() * Math.PI * 2; spawn({ x: cp.x, y: cp.y + 2.8 * CHAR_S, z: cp.z, vx: Math.cos(a) * 3, vy: 2 + Math.random() * 2, vz: Math.sin(a) * 3, size: 0.18, life: 0.9, color: 0xffd447, grav: 0.4 }); }
    b.vx *= -0.12; b.vz *= -0.12; b.vy = Math.abs(b.vy) * 0.2 + 2.5;
    if (s.W.explode && !s.exploded) explode(b.x, b.y, b.z, i);
    knock(i, head ? 'head' : 'body', null);
  });
}
function explode(x, y, z, directIdx) {
  const s = state.shot; s.exploded = true;
  sfx.boom(); shake(1.4);
  spawn({ x, y, z, size: 0.6, grow: 22, life: 0.35, color: 0xffd447, opacity: 1 });
  spawn({ x, y, z, size: 0.4, grow: 16, life: 0.5, color: 0xff6b17, opacity: 0.9 });
  for (let k = 0; k < 12; k++) spawn({ x: x + (Math.random() - 0.5) * 3, y: y + Math.random() * 2, z: z + (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 3, size: 1, grow: 2.5, life: 1.8, color: 0x7d7a6e, opacity: 0.7, drag: 1.2 });
  for (let k = 0; k < 18; k++) { const a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 8; spawn({ x, y: y + 0.3, z, vx: Math.cos(a) * sp, vy: 6 + Math.random() * 8, vz: Math.sin(a) * sp, size: 0.18 + Math.random() * 0.2, life: 1.4, color: 0x5a4628, grav: 1 }); }
  state.players.forEach((p, i) => {
    if (i === s.shooter || i === directIdx || s.hits.has(i) || p.done) return;
    const c = p.char; if (c.mode === 'fly' || c.mode === 'poof') return;
    const cp = c.group.position, d = Math.hypot(cp.x - x, cp.z - z);
    if (d < BLAST_R && Math.abs(cp.y - y) < 6) { s.hits.add(i); knock(i, 'blast', { x, z, d }); }
  });
}
function knock(i, mode, blast) {
  const p = state.players[i], M = world.M, old = { x: p.ball.x, z: p.ball.z };
  let target, big, small, color = p.color;
  if (mode === 'head') {
    target = teeSpot();
    const moved = Math.hypot(target.x - old.x, target.z - old.z);
    big = 'HEADSHOT!'; small = moved < 4 ? `${p.name} was already on the tee. Lucky.` : `${p.name} goes all the way back to the tee`;
    state.timeScale = 0.22; state.slowT = 1.0; sfx.ding(); sfx.bonk();
  } else if (mode === 'body') {
    const pr = M.project(old.x, old.z), pt = M.pointAt(Math.max(M.sTee, pr.s - KNOCK), clamp(pr.lat, -(M.def.fairW - 2), M.def.fairW - 2));
    target = validPos(M, pt.x, pt.z);
    const moved = Math.round(Math.hypot(target.x - old.x, target.z - old.z));
    big = 'HIT!'; small = moved < 4 ? `${p.name} was on the tee and got away with it` : `${p.name} flies ${moved} m back`;
    state.timeScale = 0.45; state.slowT = 0.6; sfx.bonk();
  } else {
    const dx = old.x - blast.x, dz = old.z - blast.z, d = Math.max(0.5, Math.hypot(dx, dz)), push = 8 + 10 * (1 - d / BLAST_R);
    target = validPos(M, old.x + dx / d * push, old.z + dz / d * push);
    big = 'BOOM!'; small = `${p.name} got blown ${Math.round(Math.hypot(target.x - old.x, target.z - old.z))} m away`;
  }
  p.ball = { x: target.x, y: target.y, z: target.z };
  const dist = Math.hypot(target.x - p.char.group.position.x, target.z - p.char.group.position.z);
  launchFly(p.char, target, 0.9 + Math.min(dist, 220) / 90, 5 + Math.min(dist, 220) * 0.12);
  callout(big, small, color);
}
// One projectile has finished. Effects happen now; scoring waits until every projectile is done.
function endProj(q, type) {
  q.active = false; q.result = type;
  const b = q.b;
  if (type === 'water') {
    sfx.splash(); q.gone = true;
    for (let k = 0; k < 24; k++) { const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 3; spawn({ x: b.x, y: b.y, z: b.z, vx: Math.cos(a) * sp, vy: 4 + Math.random() * 6, vz: Math.sin(a) * sp, size: 0.2, life: 1, color: k % 2 ? 0xffffff : 0x9fdcff, grav: 1 }); }
  } else if (type === 'oob') { sfx.miss(); q.gone = true; }
  else if (type === 'cup') { q.sinking = 0; sfx.cup(); }
}
function resolveShot() {
  const s = state.shot; state.phase = 'settle';
  const cupQ = s.projs.find(q => q.result === 'cup');
  if (cupQ) { finishShot('cup', cupQ); return; }
  const rest = s.projs.filter(q => q.result === 'rest');
  if (!rest.length) { finishShot(s.projs[0].result, s.projs[0]); return; }
  if (rest.length === 1) { finishShot('rest', rest[0]); return; }
  // Assault rifle: the player picks which bullet counts
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
  const q = state.choice[k];
  ui.choose.hidden = true;
  state.shot.projs.forEach(o => { if (o.marker) { scene.remove(o.marker); disposeTree(o.marker); o.marker = null; } if (o !== q) o.gone = true; });
  state.choice = null; state.phase = 'settle';
  finishShot('rest', q);
}
function finishShot(type, q) {
  const s = state.shot, p = state.players[s.shooter], b = q.b, M = world.M, def = HOLES[state.holeIdx];
  s.projs.forEach(o => { if (o !== q) o.gone = true; });
  s.primary = s.projs.indexOf(q);
  let delay = 1.0;
  if (type === 'rest') {
    p.ball = { x: b.x, y: Math.max(M.height(b.x, b.z), b.y - BALL_R), z: b.z };
    if (b.surf === 'sand' && !s.hits.size) toast('Straight into the bunker. The flare gun loses no power there.');
  } else if (type === 'cup') {
    p.done = true; delay = 1.8;
    callout(golfTerm(p.strokes, def.par), `${p.name} holes out in ${p.strokes} ${p.strokes === 1 ? 'stroke' : 'strokes'}`, p.color);
    for (let k = 0; k < 40; k++) { const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 5; spawn({ x: M.cup.x, y: M.cup.y + 0.5, z: M.cup.z, vx: Math.cos(a) * sp, vy: 6 + Math.random() * 7, vz: Math.sin(a) * sp, size: 0.16, life: 1.8, color: [0xff5fa2, 0x3db8ff, 0xffcf3d, 0xb07cff, 0xff6b17][k % 5], grav: 0.5, drag: 0.8 }); }
  } else if (type === 'water') {
    p.strokes += 1;
    callout('SPLASH!', `+1 stroke. ${p.name} shoots again from the same spot.`, '#3db8ff');
  } else {
    p.strokes += 1;
    callout('OUT OF BOUNDS!', `+1 stroke. ${p.name} shoots again from the same spot.`, '#f2eed6');
  }
  if (!p.done && p.strokes >= cap()) {
    p.done = true; p.strokes = cap(); p.picked = true;
    later(delay, () => callout('PICKED UP', `Max ${cap()} strokes on this hole`, p.color));
    delay += 1.6;
  }
  updateHUD();
  later(delay, () => {
    removeShotVisuals(); layoutChars(false);
    state.waitFn = () => later(0.5, nextTurn);
  });
}
