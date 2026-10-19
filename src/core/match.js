// The rules of a match as plain data: seats, turns, wind, strokes, penalties, holes and scores.
// The one-screen game and the game server both play through this; on the server it decides everything.
// Plain JavaScript, no Three.js or DOM.

import { HOLES, makeModel } from './courses.js';
import { clamp } from './math.js';
import { launchShot, simulateShot } from './shot.js';
import { WEAPONS } from './weapons.js';

export const MAX_SEATS = 4;
export const MIN_POWER = 0.04; // the Fire button refuses anything weaker
const HOLE_WIND = [[1, 3], [2.5, 4.5], [3, 6]]; // base wind range per hole in m/s, a little stronger on every hole

const models = [];
// The course model for a hole, shared by every match. Nothing may change it after it is built.
export function courseModel(hole) { return models[hole] || (models[hole] = makeModel(HOLES[hole])); }
// The most strokes a hole allows. Reaching it picks the ball up.
export function strokeCap(hole) { return HOLES[hole].par + 5; }

// Where everyone stands: the current player on their ball, the others on theirs but stepped sideways so no two
// overlap, finished players in a ring around the cup, and nobody for seats that have left
export function standPositions(seats, cur, M) {
  const stand = seats.map(() => null), placed = [];
  const order = seats.map((_, i) => i).sort((a, b) => (a === cur ? -1 : b === cur ? 1 : a - b));
  let doneN = 0;
  for (const i of order) {
    const s = seats[i];
    if (s.out) continue;
    let tx, ty, tz;
    if (s.done) {
      const a = 2.2 + doneN++ * 1.1; tx = M.cup.x + Math.cos(a) * 3.4; tz = M.cup.z + Math.sin(a) * 3.4; ty = M.height(tx, tz);
    } else {
      tx = s.ball.x; tz = s.ball.z; ty = s.ball.y;
      if (i !== cur) {
        const dx = M.cup.x - tx, dz = M.cup.z - tz, L = Math.hypot(dx, dz) || 1, px = -dz / L, pz = dx / L, base = { x: tx, z: tz };
        let k = 0;
        while (placed.some(q => Math.hypot(q.x - tx, q.z - tz) < 2.6) && k < 10) { k++; const off = 2.8 * Math.ceil(k / 2) * (k % 2 ? 1 : -1); tx = base.x + px * off; tz = base.z + pz * off; }
        if (k > 0) ty = M.height(tx, tz);
      }
      placed.push({ x: tx, z: tz });
    }
    stand[i] = { x: tx, y: ty, z: tz };
  }
  return stand;
}

// Starts a match on the first hole. names: one per seat · rand: Math.random, or a seeded generator for repeatable games.
// match.state is plain data that can be sent as JSON. Its phase is one of:
//   turn     seats[cur] is to shoot (online, the shot clock runs)
//   choose   choice.seat picks which assault-rifle bullet counts
//   settle   the shot is decided and everyone watches it land; then next()
//   waiting  everyone who still has to finish the hole is disconnected
//   between  the hole is finished and the scorecard is up; then nextHole()
//   end      the last hole is finished, or everyone has left
// Every action returns { error } and changes nothing when it is not allowed right now.
export function makeMatch(names, rand) {
  const state = {
    phase: 'turn', hole: 0, turn: 0, cur: -1, order: [], turnPos: 0, holeWind: null, wind: null, choice: null,
    seats: names.map((name, i) => ({
      name, style: i, ball: null, stand: null, strokes: 0, done: false, picked: false,
      scores: HOLES.map(() => null), connected: true, out: false
    }))
  };
  const model = () => courseModel(state.hole);
  const layout = () => { standPositions(state.seats, state.cur, model()).forEach((p, i) => { state.seats[i].stand = p; }); };

  function startHole(hole) {
    state.hole = hole;
    const [lo, hi] = HOLE_WIND[hole] || [2, 4];
    state.holeWind = { dir: rand() * Math.PI * 2, speed: lo + rand() * (hi - lo) };
    // The lowest score on the previous hole tees off first; seat order breaks ties
    const order = state.seats.map((_, i) => i).filter(i => !state.seats[i].out);
    if (hole > 0) order.sort((a, b) => (state.seats[a].scores[hole - 1] - state.seats[b].scores[hole - 1]) || a - b);
    state.order = order; state.turnPos = order.length - 1; // so the first turn goes to order[0]
    const M = model();
    for (const s of state.seats) Object.assign(s, { ball: { x: M.tee.x, y: M.tee.y, z: M.tee.z }, strokes: 0, done: false, picked: false });
    advance();
  }
  function beginTurn(i) {
    state.cur = i; state.phase = 'turn'; state.turn++;
    // The wind changes a little every turn around the hole's base wind
    const w = state.holeWind, dir = w.dir + (rand() - 0.5) * 0.5, sp = Math.max(0, w.speed + (rand() - 0.5) * 1.6);
    state.wind = { x: Math.sin(dir) * sp, z: Math.cos(dir) * sp, dir, speed: sp };
    layout();
  }
  // The next seat in order that still has to finish and is connected takes a turn; the same seat again if it is the only one
  function advance() {
    const live = state.seats.filter(s => !s.out);
    if (!live.length) { state.phase = 'end'; state.cur = -1; return; }
    if (live.every(s => s.done)) { endHole(); return; }
    const n = state.order.length;
    for (let k = 1; k <= n; k++) {
      const pos = (state.turnPos + k) % n, s = state.seats[state.order[pos]];
      if (!s.done && !s.out && s.connected) { state.turnPos = pos; beginTurn(state.order[pos]); return; }
    }
    state.phase = 'waiting'; state.cur = -1; layout();
  }
  function endHole() {
    for (const s of state.seats) if (!s.out) s.scores[state.hole] = s.strokes;
    state.phase = state.hole >= HOLES.length - 1 ? 'end' : 'between'; state.cur = -1;
  }
  // How the current player's turn ends. Water, out of bounds and running out of time cost a stroke.
  function finish(type, rest) {
    const s = state.seats[state.cur], cap = strokeCap(state.hole);
    if (type === 'rest') s.ball = rest;
    else if (type === 'cup') s.done = true;
    else s.strokes += 1;
    if (!s.done && s.strokes >= cap) Object.assign(s, { done: true, strokes: cap, picked: true });
    state.choice = null; state.phase = 'settle';
    layout();
    return { type, strokes: s.strokes, done: s.done, picked: s.picked };
  }
  function autoChoice() {
    const M = model(), c = state.choice.candidates, d = k => Math.hypot(c[k].rest.x - M.cup.x, c[k].rest.z - M.cup.z);
    let best = 0;
    for (let k = 1; k < c.length; k++) if (d(k) < d(best)) best = k;
    return chooseBullet(state.choice.seat, best);
  }

  // aim: { weapon (index into WEAPONS), yaw (radians), pitch (degrees, clamped to the weapon's limits), power (MIN_POWER–1) }.
  // Returns { shot } from simulateShot for playback, and { result } of finish() unless a rifle choice is pending.
  function shoot(seat, aim) {
    if (state.phase !== 'turn' || seat !== state.cur) return { error: 'not your turn' };
    const { weapon, yaw, pitch, power } = aim || {};
    if (!Number.isInteger(weapon) || weapon < 0 || weapon >= WEAPONS.length) return { error: 'bad weapon' };
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return { error: 'bad aim' };
    if (!Number.isFinite(power) || power < MIN_POWER || power > 1) return { error: 'bad power' };
    const W = WEAPONS[weapon], M = model(), s = state.seats[seat];
    s.strokes++;
    const launches = launchShot(M, W, { yaw, pitch: clamp(pitch, W.pitchMin, W.pitchMax), power }, s.ball, rand);
    const players = [];
    state.seats.forEach((p, id) => { if (id !== seat && !p.done && !p.out) players.push({ id, stand: p.stand, ball: p.ball }); });
    const shot = simulateShot({ M, W, wind: { x: state.wind.x, z: state.wind.z }, launches, players });
    for (const e of shot.events) if (e.type === 'hit') state.seats[e.player].ball = { ...e.to };
    if (shot.outcome.type === 'choose') {
      state.phase = 'choose';
      state.choice = { seat, candidates: shot.outcome.candidates.map(k => ({ proj: k, rest: shot.projs[k].rest })) };
      return { shot, result: null };
    }
    return { shot, result: finish(shot.outcome.type, shot.projs[shot.outcome.proj].rest) };
  }
  function chooseBullet(seat, k) {
    if (state.phase !== 'choose' || seat !== state.choice.seat) return { error: 'not your choice' };
    if (!Number.isInteger(k) || k < 0 || k >= state.choice.candidates.length) return { error: 'bad choice' };
    const proj = state.choice.candidates[k].proj;
    return { proj, result: finish('rest', state.choice.candidates[k].rest) };
  }
  // Time ran out: a turn passes with one penalty stroke; a rifle choice takes the bullet nearest the cup
  function timeout() {
    if (state.phase === 'turn') return { result: finish('timeout', null) };
    if (state.phase === 'choose') return autoChoice();
    return { error: 'nothing to time out' };
  }
  // Everyone has watched the shot land: the next turn starts, or the hole ends
  function next() {
    if (state.phase !== 'settle') return { error: 'no shot to finish' };
    advance(); return {};
  }
  function nextHole() {
    if (state.phase !== 'between') return { error: 'the hole is not finished' };
    startHole(state.hole + 1); return {};
  }
  // A disconnected seat keeps its place but is skipped. If it was their turn, it passes without a penalty.
  function setConnected(seat, connected) {
    const s = state.seats[seat];
    if (!s || s.out) return { error: 'no such seat' };
    s.connected = connected;
    if (!connected && state.phase === 'turn' && state.cur === seat) advance();
    else if (!connected && state.phase === 'choose' && state.choice.seat === seat) autoChoice();
    else if (connected && state.phase === 'waiting') advance();
    return {};
  }
  // A seat that leaves is out for the rest of the match: no more turns, no scores, not ranked
  function leave(seat) {
    const s = state.seats[seat];
    if (!s || s.out) return { error: 'no such seat' };
    Object.assign(s, { out: true, connected: false, stand: null });
    if (state.phase === 'choose' && state.choice.seat === seat) autoChoice();
    else if ((state.phase === 'turn' && state.cur === seat) || state.phase === 'waiting') advance();
    else if (state.phase === 'turn' || state.phase === 'settle') layout();
    return {};
  }

  startHole(0);
  return { state, shoot, chooseBullet, timeout, next, nextHole, setConnected, leave };
}
