// Hole and turn flow on screen. The match decides whose turn it is and when a hole ends; this shows it.

import { HOLES } from '../core/courses.js';
import { makeMatch, strokeCap } from '../core/match.js';
import { WEAPONS, widx } from '../core/weapons.js';
import { holds, setZoom } from './aim.js';
import { cancelCharge } from './shot.js';
import { distToCup, game, later, playsSeat, state, STYLES, timers, world } from './state.js';
import { cam } from '../render/camera.js';
import { makeChar, setCharTarget, showWeapon } from '../render/characters.js';
import { clearParts } from '../render/particles.js';
import { removeShotVisuals } from '../render/projectiles.js';
import { disposeTree, scene } from '../render/scene.js';
import { vm } from '../render/viewmodel.js';
import { buildWorld } from '../render/world.js';
import { openPick } from '../ui/bag.js';
import { ui } from '../ui/elements.js';
import { fmt1, genitive } from '../ui/format.js';
import { callout, setControls, setFill, showBanner, turnAlert, updateHUD } from '../ui/hud.js';
import { buildMapStatic, sizeMap } from '../ui/minimap.js';
import { exitLock } from '../ui/pointerLock.js';
import { showBoard } from '../ui/scorecard.js';

// The screen catches up with what the match says about a player. out: they have left an online game.
export function showSeat(i) {
  const s = game.match.state.seats[i];
  Object.assign(state.players[i], { ball: { ...s.ball }, strokes: s.strokes, done: s.done, picked: s.picked, out: s.out, scores: s.scores.slice() });
}
// Characters go to where the match says each player stands
export function layoutChars(instant) {
  const seats = game.match.state.seats;
  state.players.forEach((p, i) => {
    const s = seats[i].stand;
    if (s) setCharTarget(p.char, s.x, s.y, s.z, instant);
    p.char.ring.visible = false;
  });
}
// The players on screen, one per seat. seats: [{ name, style }], style being an index into STYLES.
export function setPlayers(seats) {
  for (const p of state.players) { scene.remove(p.char.group); disposeTree(p.char.group); }
  state.players = seats.map(({ name, style }) => {
    const st = STYLES[style];
    return { name, color: st.color, style: st, ball: null, strokes: 0, done: false, picked: false, scores: [], char: makeChar(st, name) };
  });
  state.shotsFired = 0;
}
export function newGame(names) {
  setPlayers(names.map((name, i) => ({ name, style: i })));
  game.online = null;
  game.match = makeMatch(names, Math.random);
  showHole();
}
// Back to the start screen
export function leaveGame() {
  timers.length = 0; state.waitFn = null; turnAlert(false);
  cancelCharge(); exitLock(); holds.clear();
  state.players.forEach(p => { p.char.group.visible = false; });
  ui.board.hidden = true; ui.hud.hidden = true; ui.setup.hidden = false; state.phase = 'setup';
  game.online = null;
}
export function playAgain() {
  game.match = makeMatch(state.players.map(p => p.name), Math.random);
  showHole();
}
export function nextHole() {
  game.match.nextHole();
  showHole();
}
// Shows the hole the match is on: builds the course, puts everyone where they stand and shows the turn
export function showHole() {
  const ms = game.match.state, idx = ms.hole;
  timers.length = 0; state.waitFn = null;
  removeShotVisuals(); state.shot = null; state.choice = null; if (ui.choose) ui.choose.hidden = true; clearParts();
  state.holeIdx = idx; buildWorld(idx); buildMapStatic();
  state.players.forEach((p, i) => { showSeat(i); p.char.inner.rotation.set(0, 0, 0); });
  state.cur = ms.cur;
  layoutChars(true);
  ui.setup.hidden = true; ui.board.hidden = true; ui.hud.hidden = false;
  sizeMap(); buildMapStatic();
  cam.arrived = false;
  if (ms.cur >= 0) beginTurn();
  else { state.phase = 'watch'; setControls(false); world.M.wind = { ...ms.wind }; } // online, nobody's turn: watch until there is one
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
// Shows the turn the match has started, with this turn's wind
export function beginTurn() {
  const ms = game.match.state, i = ms.cur;
  state.cur = i; state.phase = 'pick'; cam.arrived = false;
  state.players.forEach((_, k) => showSeat(k));
  const p = state.players[i], M = world.M;
  state.yaw = Math.atan2(M.cup.x - p.ball.x, M.cup.z - p.ball.z);
  state.charging = false; state.power = 0; setFill(0);
  M.wind = { ...ms.wind };
  layoutChars(false);
  p.char.ring.visible = true;
  vm.handMat.color.set(p.color);
  setZoom(false); state.zoomF = 1.001;
  updateHUD();
  const mine = playsSeat(i) && ms.phase === 'turn';
  if (mine) openPick(true); else watchTurn();
  turnAlert(mine && !!game.online);
}
// Online: the shot clock ran out on seat's turn. It passes with a penalty stroke (result from match.timeout).
export function turnTimedOut(seat, result) {
  const p = state.players[seat];
  turnAlert(false); cancelCharge(); setZoom(false); exitLock(); holds.clear();
  ui.pick.hidden = true; ui.hud.classList.remove('picking'); setControls(false); setFill(0);
  state.phase = 'settle'; state.shot = null;
  showSeat(seat); updateHUD();
  callout('TIME’S UP!', `+1 stroke. ${genitive(p.name)} turn passes.`, p.color);
  let delay = 1.8;
  if (result.picked) { later(delay, () => callout('PICKED UP', `Max ${strokeCap(state.holeIdx)} strokes on this hole`, p.color)); delay += 1.6; }
  later(delay, nextTurn);
}
// Someone else's turn, online: no golf bag for you. The camera watches over the shooter's shoulder, and they hold the
// weapon the bag recommends.
function watchTurn() {
  const p = state.players[state.cur], w = autoWeapon(p);
  cancelCharge(); setZoom(false); exitLock(); holds.clear();
  state.phase = 'watch'; ui.pick.hidden = true; ui.hud.classList.remove('picking'); setControls(false);
  state.weapon = w; state.pitch = WEAPONS[w].pitchDef; showWeapon(p.char, WEAPONS[w].id);
  ui.hint.textContent = `${p.name} is lining up a shot.`;
}
// Everyone has watched the shot land: the match starts the next turn or ends the hole
export function nextTurn() {
  game.match.next();
  if (game.online) return; // the server starts the next turn once every screen has watched the shot (src/game/online.js)
  if (game.match.state.phase === 'turn') beginTurn();
  else endHole();
}
export function endHole() {
  state.players.forEach((_, i) => showSeat(i));
  state.phase = game.match.state.phase; // 'between' or 'end'
  setControls(false);
  later(1.2, () => showBoard(state.phase === 'end' ? 'final' : 'hole'));
}
