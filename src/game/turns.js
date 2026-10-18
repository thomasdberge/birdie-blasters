// Hole and turn flow: setting up a hole, choosing whose turn it is, and ending the hole.

import { HOLES } from '../core/courses.js';
import { WEAPONS, widx } from '../core/weapons.js';
import { setZoom } from './aim.js';
import { distToCup, later, state, STYLES, teeSpot, timers, world } from './state.js';
import { cam } from '../render/camera.js';
import { makeChar, setCharTarget } from '../render/characters.js';
import { clearParts } from '../render/particles.js';
import { removeShotVisuals } from '../render/projectiles.js';
import { disposeTree, scene } from '../render/scene.js';
import { vm } from '../render/viewmodel.js';
import { buildWorld } from '../render/world.js';
import { openPick } from '../ui/bag.js';
import { ui } from '../ui/elements.js';
import { fmt1 } from '../ui/format.js';
import { setControls, setFill, showBanner, updateHUD } from '../ui/hud.js';
import { buildMapStatic, sizeMap } from '../ui/minimap.js';
import { showBoard } from '../ui/scorecard.js';

export function layoutChars(instant) {
  const M = world.M, placed = [];
  const order = state.players.map((_, i) => i).sort((a, b) => (a === state.cur ? -1 : b === state.cur ? 1 : a - b));
  let doneN = 0;
  for (const i of order) {
    const p = state.players[i];
    let tx, ty, tz;
    if (p.done) {
      const a = 2.2 + doneN++ * 1.1; tx = M.cup.x + Math.cos(a) * 3.4; tz = M.cup.z + Math.sin(a) * 3.4; ty = M.height(tx, tz);
    } else {
      tx = p.ball.x; tz = p.ball.z; ty = p.ball.y;
      if (i !== state.cur) {
        const dx = M.cup.x - tx, dz = M.cup.z - tz, L = Math.hypot(dx, dz) || 1, px = -dz / L, pz = dx / L, base = { x: tx, z: tz };
        let k = 0;
        while (placed.some(q => Math.hypot(q.x - tx, q.z - tz) < 2.6) && k < 10) { k++; const off = 2.8 * Math.ceil(k / 2) * (k % 2 ? 1 : -1); tx = base.x + px * off; tz = base.z + pz * off; }
        if (k > 0) ty = M.height(tx, tz);
      }
      placed.push({ x: tx, z: tz });
    }
    setCharTarget(p.char, tx, ty, tz, instant);
    p.char.ring.visible = false;
  }
}
export function newGame(names) {
  for (const p of state.players) { scene.remove(p.char.group); disposeTree(p.char.group); }
  state.players = names.map((n, i) => {
    const st = STYLES[i];
    return { name: n, color: st.color, style: st, ball: { x: 0, y: 0, z: 0 }, strokes: 0, done: false, scores: [], char: makeChar(st, n) };
  });
  state.shotsFired = 0;
}
export function startHole(idx) {
  timers.length = 0; state.waitFn = null;
  removeShotVisuals(); state.shot = null; state.choice = null; if (ui.choose) ui.choose.hidden = true; clearParts();
  state.holeIdx = idx; buildWorld(idx); buildMapStatic();
  // Each hole gets its own base wind, a little stronger on every hole
  const [lo, hi] = [[1, 3], [2.5, 4.5], [3, 6]][idx] || [2, 4];
  world.wind = { baseDir: Math.random() * Math.PI * 2, baseSpeed: lo + Math.random() * (hi - lo) };
  const ord = state.players.map((_, i) => i);
  if (idx > 0) ord.sort((a, b) => (state.players[a].scores[idx - 1] - state.players[b].scores[idx - 1]) || a - b);
  state.order = ord; state.turnPos = 0;
  for (const p of state.players) { p.ball = teeSpot(); p.strokes = 0; p.done = false; p.char.inner.rotation.set(0, 0, 0); }
  state.cur = ord[0];
  layoutChars(true);
  ui.setup.hidden = true; ui.board.hidden = true; ui.hud.hidden = false;
  sizeMap(); buildMapStatic();
  cam.arrived = false;
  beginTurn(ord[0]);
  const def = HOLES[idx];
  later(0.1, () => showBanner(`Hole ${idx + 1}: ${def.name}`, `Par ${def.par} · ${Math.round(Math.hypot(world.M.cup.x - world.M.tee.x, world.M.cup.z - world.M.tee.z))} m · wind ${fmt1(world.M.wind.speed)} m/s`, '#f2eed6'));
}
export function autoWeapon(p) {
  const M = world.M, d = distToCup(p), surf = M.surface(p.ball.x, p.ball.z);
  if (surf === 'sand') return widx('flare');
  if (surf === 'green' || d < WEAPONS[widx('dart')].range * 0.9) return widx('dart');
  const lie = surf === 'rough' ? 0.85 : 1;
  for (const id of ['pistol', 'shotgun', 'auto', 'sniper', 'grenade', 'bazooka']) { const W = WEAPONS[widx(id)]; if (W.range * lie * 0.92 >= d) return widx(id); }
  return widx('bazooka');
}
// Wind changes a little every turn around the hole's base wind
function rollWind() {
  const w = world.wind; if (!w) return;
  const dir = w.baseDir + (Math.random() - 0.5) * 0.5, sp = Math.max(0, w.baseSpeed + (Math.random() - 0.5) * 1.6);
  world.M.wind = { x: Math.sin(dir) * sp, z: Math.cos(dir) * sp, dir, speed: sp };
}
function beginTurn(i) {
  state.cur = i; state.phase = 'pick'; cam.arrived = false;
  const p = state.players[i], M = world.M;
  state.yaw = Math.atan2(M.cup.x - p.ball.x, M.cup.z - p.ball.z);
  state.charging = false; state.power = 0; setFill(0);
  rollWind();
  layoutChars(false);
  p.char.ring.visible = true;
  vm.handMat.color.set(p.color);
  setZoom(false); state.zoomF = 1.001;
  updateHUD();
  openPick(true);
}
export function nextTurn() {
  if (state.players.every(p => p.done)) { endHole(); return; }
  const n = state.order.length;
  for (let k = 1; k <= n; k++) {
    const pos = (state.turnPos + k) % n, idx = state.order[pos];
    if (!state.players[idx].done) { state.turnPos = pos; beginTurn(idx); return; }
  }
}
function endHole() {
  state.players.forEach(p => { p.scores[state.holeIdx] = p.strokes; });
  state.phase = state.holeIdx >= HOLES.length - 1 ? 'end' : 'between';
  setControls(false);
  later(1.2, () => showBoard(state.phase === 'end' ? 'final' : 'hole'));
}
