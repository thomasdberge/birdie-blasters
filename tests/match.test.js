// The match rules (src/core/match.js): one test per rule, plus whole games played by a simple bot.
import { describe, expect, test } from 'vitest';
import { HOLES } from '../src/core/courses.js';
import { clamp, rng } from '../src/core/math.js';
import { courseModel, makeMatch, standPositions, strokeCap } from '../src/core/match.js';
import { WEAPONS } from '../src/core/weapons.js';

const wi = id => WEAPONS.findIndex(w => w.id === id);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const copy = v => JSON.parse(JSON.stringify(v));
const towardCup = (M, from) => Math.atan2(M.cup.x - from.x, M.cup.z - from.z);
// A spot d metres from `from` toward the cup and `side` metres to its left, with the yaw that faces the cup
function ahead(M, from, d, side = 0) {
  const yaw = towardCup(M, from), x = from.x + Math.sin(yaw) * d + Math.cos(yaw) * side, z = from.z + Math.cos(yaw) * d - Math.sin(yaw) * side;
  return { x, y: M.height(x, z), z, yaw };
}
// Tests set up situations by moving players directly; the match only reads ball and stand when it needs them
function put(seat, p) { seat.ball = { x: p.x, y: p.y, z: p.z }; seat.stand = { x: p.x, y: p.y, z: p.z }; }
// Holes out the current player: a dart pointed 60° down from 1.5 m away aims straight at the cup, and darts have no spread
function holeOut(match) {
  const st = match.state, M = courseModel(st.hole), back = Math.atan2(M.tee.x - M.cup.x, M.tee.z - M.cup.z), d = 2.6 / Math.tan(Math.PI / 3);
  const x = M.cup.x + Math.sin(back) * d, z = M.cup.z + Math.cos(back) * d;
  st.seats[st.cur].ball = { x, y: M.height(x, z), z };
  const r = match.shoot(st.cur, { weapon: wi('dart'), yaw: back + Math.PI, pitch: -60, power: 0.1 });
  expect(r.result.type).toBe('cup');
  return r;
}
// Plays out the current hole with timed-out turns only, so everyone ends on par + 5
function timeOutHole(match) { while (['turn', 'settle'].includes(match.state.phase)) { match.timeout(); match.next(); } }
// A simple bot: the shortest weapon that reaches, aimed at the cup at its default angle, power by distance
function botAim(st) {
  const s = st.seats[st.cur], M = courseModel(st.hole), d = flat(M.cup, s.ball);
  const weapon = ['dart', 'pistol', 'shotgun', 'auto', 'sniper', 'grenade', 'bazooka'].map(wi).find(i => WEAPONS[i].range >= d) ?? wi('bazooka');
  const W = WEAPONS[weapon];
  return { weapon, yaw: towardCup(M, s.ball), pitch: W.pitchDef, power: clamp(d / W.range, 0.05, 1) };
}
function playBot(match, onStep = () => {}) {
  const st = match.state, shots = [];
  for (let n = 0; st.phase !== 'end'; n++) {
    if (n > 500) throw new Error('the game did not finish');
    if (st.phase === 'between') match.nextHole();
    else {
      shots.push(match.shoot(st.cur, botAim(st)));
      if (st.phase === 'choose') match.chooseBullet(st.choice.seat, 0);
      onStep(st);
      match.next();
    }
    onStep(st);
  }
  return shots;
}
// Only null, booleans, finite numbers, strings, arrays and plain objects: safe to send as JSON
function isPlainData(v) {
  if (v === null || typeof v === 'boolean' || typeof v === 'string') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isPlainData);
  return typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype && Object.values(v).every(isPlainData);
}

describe('starting', () => {
  test('everyone starts on the tee with no strokes, and seat 0 shoots first', () => {
    const { state: st } = makeMatch(['Ann', 'Ben', 'Cy'], rng(1)), M = courseModel(0);
    expect(st).toMatchObject({ phase: 'turn', hole: 0, cur: 0, turn: 1, order: [0, 1, 2] });
    for (const [i, s] of st.seats.entries()) {
      expect(s).toMatchObject({ name: ['Ann', 'Ben', 'Cy'][i], style: i, strokes: 0, done: false, connected: true, out: false, scores: [null, null, null] });
      expect(s.ball).toEqual({ x: M.tee.x, y: M.tee.y, z: M.tee.z });
    }
  });

  test('each turn the wind changes a little around the hole\'s base wind, which gets stronger on later holes', () => {
    const match = makeMatch(['Ann', 'Ben'], rng(2)), st = match.state;
    for (const [lo, hi] of [[1, 3], [2.5, 4.5], [3, 6]]) {
      expect(st.holeWind.speed).toBeGreaterThanOrEqual(lo); expect(st.holeWind.speed).toBeLessThanOrEqual(hi);
      const winds = [];
      while (st.phase === 'turn') { winds.push(st.wind); match.timeout(); match.next(); }
      expect(new Set(winds.map(w => w.speed)).size).toBe(winds.length); // a new wind every turn
      for (const w of winds) {
        expect(Math.abs(w.speed - st.holeWind.speed)).toBeLessThanOrEqual(0.8);
        expect(Math.abs(w.dir - st.holeWind.dir)).toBeLessThanOrEqual(0.25);
        expect(w.x).toBeCloseTo(Math.sin(w.dir) * w.speed, 12); expect(w.z).toBeCloseTo(Math.cos(w.dir) * w.speed, 12);
      }
      match.nextHole();
    }
  });

  test('players stand on their ball, step aside so nobody overlaps, and stand around the cup once finished', () => {
    const match = makeMatch(['Ann', 'Ben', 'Cy', 'Dee'], rng(3)), st = match.state, M = courseModel(0);
    // all four on the tee: the current player on the ball, the others 2.8 m, 2.8 m and 5.6 m to either side
    expect(st.seats[0].stand).toEqual(st.seats[0].ball);
    expect(st.seats.slice(1).map(s => Math.round(flat(s.stand, M.tee) * 10) / 10)).toEqual([2.8, 2.8, 5.6]);
    expect(flat(st.seats[1].stand, st.seats[2].stand)).toBeCloseTo(5.6, 6);
    holeOut(match);
    expect(flat(st.seats[0].stand, M.cup)).toBeCloseTo(3.4, 6);
    // the same layout for anyone who asks, e.g. the renderer
    expect(standPositions(st.seats, st.cur, M)).toEqual(st.seats.map(s => s.stand));
  });
});

describe('shooting', () => {
  test('only the current player can shoot, and bad input changes nothing', () => {
    const match = makeMatch(['Ann', 'Ben'], rng(4)), before = copy(match.state);
    const good = { weapon: 0, yaw: 0, pitch: 10, power: 0.5 };
    expect(match.shoot(1, good).error).toBe('not your turn');
    for (const [aim, error] of [
      [{ ...good, weapon: 8 }, 'bad weapon'], [{ ...good, weapon: -1 }, 'bad weapon'], [{ ...good, weapon: 1.5 }, 'bad weapon'], [{ ...good, weapon: '0' }, 'bad weapon'],
      [{ ...good, yaw: NaN }, 'bad aim'], [{ ...good, pitch: Infinity }, 'bad aim'], [{ ...good, yaw: '1' }, 'bad aim'],
      [{ ...good, power: 0.03 }, 'bad power'], [{ ...good, power: 5 }, 'bad power'], [{ ...good, power: NaN }, 'bad power'], [{ weapon: 0, yaw: 0, pitch: 0 }, 'bad power']
    ]) expect(match.shoot(0, aim).error).toBe(error);
    expect(match.shoot(0, null).error).toBe('bad weapon');
    expect(match.state).toEqual(before);
  });

  test('pitch beyond the weapon\'s limits is clamped to them', () => {
    const shoot = pitch => { const m = makeMatch(['Ann', 'Ben'], rng(5)), M = courseModel(0); return m.shoot(0, { weapon: wi('sniper'), yaw: towardCup(M, M.tee), pitch, power: 0.8 }).shot.projs[0].final; };
    expect(shoot(80)).toEqual(shoot(WEAPONS[wi('sniper')].pitchMax));
    expect(shoot(-80)).toEqual(shoot(WEAPONS[wi('sniper')].pitchMin));
  });

  test('a shot that stops moves the ball there and costs a stroke; next() then passes the turn', () => {
    const match = makeMatch(['Ann', 'Ben'], rng(6)), st = match.state, M = courseModel(0), wind = st.wind;
    const r = match.shoot(0, { weapon: wi('pistol'), yaw: towardCup(M, M.tee), pitch: 28, power: 0.8 });
    expect(r.result).toEqual({ type: 'rest', strokes: 1, done: false, picked: false });
    expect(st.seats[0].ball).toEqual(r.shot.projs[0].rest);
    expect(flat(st.seats[0].ball, M.tee)).toBeGreaterThan(20);
    expect(st.phase).toBe('settle');
    expect(match.shoot(0, botAim(st)).error).toBe('not your turn');
    expect(match.timeout().error).toBeDefined();
    expect(match.next()).toEqual({});
    expect(st).toMatchObject({ phase: 'turn', cur: 1, turn: 2 });
    expect(st.wind).not.toEqual(wind);
  });

  test('water and out of bounds cost a penalty stroke, and the ball stays where it was', () => {
    const match = makeMatch(['Ann', 'Ben'], rng(7)), st = match.state, M0 = courseModel(0);
    const oob = match.shoot(0, { weapon: wi('sniper'), yaw: towardCup(M0, M0.tee) + Math.PI / 2, pitch: 8, power: 1 });
    expect(oob.result).toEqual({ type: 'oob', strokes: 2, done: false, picked: false });
    expect(st.seats[0].ball).toEqual({ x: M0.tee.x, y: M0.tee.y, z: M0.tee.z });
    match.next(); timeOutHole(match); match.nextHole();
    // Duck Pond: a dart lobbed into the pond from its edge
    const M = courseModel(1), pond = M.ponds[0], seat = st.seats[st.cur], edge = { x: pond.x, z: pond.z + pond.r + 7 };
    put(seat, { ...edge, y: M.height(edge.x, edge.z) });
    const before = copy(seat.ball);
    const water = match.shoot(st.cur, { weapon: wi('dart'), yaw: Math.atan2(pond.x - edge.x, pond.z - edge.z), pitch: -30, power: 0.3 });
    expect(water.result).toEqual({ type: 'water', strokes: 2, done: false, picked: false });
    expect(seat.ball).toEqual(before);
  });

  test('holing out finishes the hole for that player, and their turns are skipped', () => {
    const match = makeMatch(['Ann', 'Ben'], rng(8)), st = match.state;
    expect(holeOut(match).result).toEqual({ type: 'cup', strokes: 1, done: true, picked: false });
    match.next(); expect(st.cur).toBe(1);
    match.timeout(); match.next(); expect(st.cur).toBe(1); // Ann is done, so Ben goes again
  });

  test('a timed-out turn costs a stroke, and reaching par + 5 picks the ball up', () => {
    const match = makeMatch(['Ann', 'Ben'], rng(9)), st = match.state, cap = strokeCap(0);
    expect(match.timeout().result).toEqual({ type: 'timeout', strokes: 1, done: false, picked: false });
    expect(st.phase).toBe('settle');
    match.next();
    // Ben has par + 4 strokes, so any shot that does not go in is the last
    st.seats[1].strokes = cap - 1;
    expect(match.shoot(1, botAim(st)).result).toMatchObject({ strokes: cap, done: true, picked: true });
    match.next(); timeOutHole(match);
    expect(st.seats.map(s => s.scores[0])).toEqual([cap, cap]);
  });
});

describe('hits', () => {
  // Ben stands d metres ahead of Ann toward the cup; Ann fires
  function hit(weapon, pitch, power, d, side = 0, annAt = 0) {
    const match = makeMatch(['Ann', 'Ben'], rng(10)), st = match.state, M = courseModel(0);
    put(st.seats[0], ahead(M, M.tee, annAt));
    const v = ahead(M, st.seats[0].ball, d, side), ben = st.seats[1];
    put(ben, v);
    const before = copy(ben.ball);
    const r = match.shoot(0, { weapon: wi(weapon), yaw: v.yaw, pitch, power });
    return { r, before, ben, M, kinds: r.shot.events.filter(e => e.type === 'hit').map(e => e.kind) };
  }

  test('a headshot sends the player back to the tee', () => {
    const { kinds, ben, M } = hit('sniper', 0, 0.5, 15);
    expect(kinds).toEqual(['head']);
    expect(ben.ball).toEqual({ x: M.tee.x, y: M.tee.y, z: M.tee.z });
  });

  test('a body hit knocks the player 40 m back down the course', () => {
    const { kinds, ben, before, M } = hit('sniper', -4, 0.5, 15, 0, 100);
    expect(kinds).toEqual(['body']);
    expect(M.project(before.x, before.z).s - M.project(ben.ball.x, ben.ball.z).s).toBeCloseTo(40, 0);
  });

  test('a bazooka blast blows nearby players away', () => {
    const { r, kinds, ben, before } = hit('bazooka', -10, 0.3, 13, 4);
    expect(kinds).toEqual(['blast']);
    const boom = r.shot.events.find(e => e.type === 'explode').at;
    expect(flat(ben.ball, boom)).toBeGreaterThan(flat(before, boom) + 5);
  });

  test('players who have finished the hole cannot be hit', () => {
    const match = makeMatch(['Ann', 'Ben'], rng(11)), st = match.state;
    holeOut(match); match.next(); // Ann is done and stands by the cup
    const M = courseModel(0), ann = st.seats[0];
    put(st.seats[1], ahead(M, ann.stand, -15)); // Ben 15 m behind Ann, aiming at her
    const r = match.shoot(1, { weapon: wi('sniper'), yaw: Math.atan2(ann.stand.x - st.seats[1].ball.x, ann.stand.z - st.seats[1].ball.z), pitch: 0, power: 0.5 });
    expect(r.shot.events.some(e => e.type === 'hit')).toBe(false);
  });
});

describe('assault rifle', () => {
  function rifle(seed) {
    const match = makeMatch(['Ann', 'Ben'], rng(seed)), M = courseModel(0);
    const r = match.shoot(0, { weapon: wi('auto'), yaw: towardCup(M, M.tee), pitch: 5, power: 0.6 });
    return { match, st: match.state, r, M };
  }

  test('when several bullets stop, the shooter picks which one counts', () => {
    const { match, st, r } = rifle(12);
    expect(r.result).toBe(null);
    expect(st.phase).toBe('choose');
    expect(st.choice.candidates.map(c => c.proj)).toEqual([0, 1, 2]);
    expect(match.chooseBullet(1, 0).error).toBe('not your choice');
    expect(match.chooseBullet(0, 3).error).toBe('bad choice');
    expect(match.shoot(0, botAim(st)).error).toBe('not your turn');
    const rest = st.choice.candidates[1].rest;
    expect(match.chooseBullet(0, 1)).toEqual({ proj: 1, result: { type: 'rest', strokes: 1, done: false, picked: false } });
    expect(st.seats[0].ball).toEqual(rest);
    expect(st.phase).toBe('settle');
  });

  test('running out of time, disconnecting or leaving takes the bullet nearest the cup, and says which', () => {
    for (const end of [m => m.timeout(), m => m.setConnected(0, false), m => m.leave(0)]) {
      const { match, st, M } = rifle(13), c = st.choice.candidates;
      const nearest = c.reduce((best, x) => (flat(x.rest, M.cup) < flat(best.rest, M.cup) ? x : best));
      expect(end(match)).toEqual({ proj: nearest.proj, result: { type: 'rest', strokes: 1, done: false, picked: false } });
      expect(st.phase).toBe('settle');
      expect(st.seats[0].ball).toEqual(nearest.rest);
    }
  });
});

describe('holes and scores', () => {
  test('when everyone has finished, the scores are kept and the next hole waits for nextHole()', () => {
    const match = makeMatch(['Ann', 'Ben'], rng(14)), st = match.state;
    expect(match.nextHole().error).toBeDefined();
    timeOutHole(match);
    expect(st).toMatchObject({ phase: 'between', cur: -1 });
    expect(st.seats.map(s => s.scores)).toEqual([[8, null, null], [8, null, null]]);
    expect(match.next().error).toBeDefined();
    expect(match.timeout().error).toBeDefined();
    match.nextHole();
    const M = courseModel(1);
    expect(st).toMatchObject({ phase: 'turn', hole: 1 });
    for (const s of st.seats) expect(s).toMatchObject({ ball: { x: M.tee.x, y: M.tee.y, z: M.tee.z }, strokes: 0, done: false, picked: false });
  });

  test('the lowest score on the previous hole tees off first, and seat order breaks ties', () => {
    const match = makeMatch(['Ann', 'Ben', 'Cy', 'Dee'], rng(15)), st = match.state;
    // Ann is picked up on 8; Ben holes out in 2; Cy and Dee hole out in 1
    for (const seat of [0, 1, 2, 3]) {
      expect(st.cur).toBe(seat);
      if (seat === 0) { st.seats[0].strokes = 7; match.timeout(); } else if (seat === 1) match.timeout(); else holeOut(match);
      match.next();
    }
    holeOut(match); match.next(); // Ben
    timeOutHole(match);
    expect(st.seats.map(s => s.scores[0])).toEqual([8, 2, 1, 1]);
    match.nextHole();
    expect(st.order).toEqual([2, 3, 1, 0]);
    expect(st.cur).toBe(2);
  });

  test('after the last hole the match ends', () => {
    const match = makeMatch(['Ann'], rng(16)), st = match.state;
    for (let hole = 0; hole < HOLES.length; hole++) { timeOutHole(match); if (hole < HOLES.length - 1) match.nextHole(); }
    expect(st.phase).toBe('end');
    expect(st.seats[0].scores).toEqual(HOLES.map((h, i) => strokeCap(i)));
    expect(match.nextHole().error).toBeDefined();
  });
});

describe('disconnects and leaving', () => {
  test('a disconnected player keeps their seat but is skipped, without a penalty, until they reconnect', () => {
    const match = makeMatch(['Ann', 'Ben', 'Cy'], rng(17)), st = match.state;
    match.setConnected(1, false);
    expect(st.cur).toBe(0); // Ann's turn goes on
    match.timeout(); match.next();
    expect(st.cur).toBe(2); // Ben is skipped
    expect(st.seats[1]).toMatchObject({ strokes: 0, connected: false, out: false });
    match.setConnected(1, true);
    match.timeout(); match.next();
    expect(st.cur).toBe(0);
    match.timeout(); match.next();
    expect(st.cur).toBe(1);
  });

  test('if it was their turn, it passes at once', () => {
    const match = makeMatch(['Ann', 'Ben'], rng(18)), st = match.state;
    match.setConnected(0, false);
    expect(st).toMatchObject({ phase: 'turn', cur: 1, turn: 2 });
    expect(st.seats[0].strokes).toBe(0);
  });

  test('when only disconnected players still have to finish, the match waits for them', () => {
    const match = makeMatch(['Ann', 'Ben'], rng(19)), st = match.state;
    holeOut(match); match.next();
    match.setConnected(1, false);
    expect(st).toMatchObject({ phase: 'waiting', cur: -1 });
    expect(match.timeout().error).toBeDefined();
    match.setConnected(1, true);
    expect(st).toMatchObject({ phase: 'turn', cur: 1 });
  });

  test('a player who leaves is out: no more turns, no scores, and the hole finishes without them', () => {
    const match = makeMatch(['Ann', 'Ben', 'Cy'], rng(20)), st = match.state;
    expect(match.leave(0)).toEqual({});
    expect(st.cur).toBe(1); // it was Ann's turn
    expect(st.seats[0]).toMatchObject({ out: true, connected: false, stand: null });
    expect(match.leave(0).error).toBeDefined();
    expect(match.setConnected(0, true).error).toBeDefined();
    timeOutHole(match);
    expect(st.seats.map(s => s.scores[0])).toEqual([null, 8, 8]);
    match.nextHole();
    expect(st.order).toEqual([1, 2]);
  });

  test('when everyone has left, the match ends', () => {
    const match = makeMatch(['Ann', 'Ben'], rng(21)), st = match.state;
    match.leave(1); match.leave(0);
    expect(st).toMatchObject({ phase: 'end', cur: -1 });
  });
});

describe('the match as data', () => {
  test('the state is plain data at every step, so it can be sent as JSON', () => {
    playBot(makeMatch(['Ann', 'Ben', 'Cy'], rng(22)), st => expect(isPlainData(st)).toBe(true));
  });

  test('the same seed and the same actions give the same match', () => {
    const run = () => { const m = makeMatch(['Ann', 'Ben'], rng(23)); return copy({ shots: playBot(m), state: m.state }); };
    expect(run()).toEqual(run());
  });

  test('a scripted three-hole game ends with the expected scorecard', () => {
    const match = makeMatch(['Ann', 'Ben', 'Cy'], rng(2026)), st = match.state;
    playBot(match);
    expect(st.phase).toBe('end');
    for (const s of st.seats) s.scores.forEach((score, hole) => { expect(score).toBeGreaterThanOrEqual(1); expect(score).toBeLessThanOrEqual(strokeCap(hole)); });
    expect(st.seats.map(s => `${s.name}: ${s.scores.join(' ')}`)).toMatchInlineSnapshot(`
      [
        "Ann: 8 4 9",
        "Ben: 8 9 3",
        "Cy: 4 2 9",
      ]
    `);
  });
});
