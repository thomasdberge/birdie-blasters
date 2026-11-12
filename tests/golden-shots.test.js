// Golden shots: tests/golden/shots.json records how about 200 seeded set-ups played out in the original game code.
// The same set-ups now play through the match (src/core/match.js), which must reproduce the file byte for byte.
// After an intended change to how shots play, regenerate with: npx vitest run -u
import { expect, test } from 'vitest';
import { HOLES, validPos } from '../src/core/courses.js';
import { rng } from '../src/core/math.js';
import { courseModel, makeMatch } from '../src/core/match.js';
import { WEAPONS } from '../src/core/weapons.js';

const LAUNCH_KEYS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'dirx', 'dirz'];
const FINAL_KEYS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 't', 'contact', 'surf', 'impactT', 'burstDone'];
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k]]));

// Random set-ups across all holes and weapons. About half the opponents stand in the line of fire, which is how hits happen.
function scenarios(count) {
  const R = rng(20261019), list = [];
  const between = (a, b) => a + R() * (b - a);
  const onCourse = M => { const p = M.pointAt(between(M.sTee, M.total), between(-(M.E - 4), M.E - 4)); return validPos(M, p.x, p.z); };
  for (let id = 0; id < count; id++) {
    const hole = id % 3, M = courseModel(hole), def = HOLES[hole];
    const n = 2 + Math.floor(R() * 3), shooter = Math.floor(R() * n);
    const u = R();
    let from;
    if (u < 0.2) from = { ...M.tee };
    else if (u < 0.3) { const b = def.bunkers[Math.floor(R() * def.bunkers.length)]; from = { x: b[0], y: M.height(b[0], b[1]), z: b[1] }; }
    else from = onCourse(M);
    const v = R(), toCup = Math.atan2(M.cup.x - from.x, M.cup.z - from.z);
    const yaw = toCup + (v < 0.7 ? between(-0.2, 0.2) : v < 0.9 ? between(-0.6, 0.6) : between(-1.5, 1.5));
    const weapon = Math.floor(R() * WEAPONS.length), W = WEAPONS[weapon];
    const players = [];
    for (let k = 0; k < n; k++) {
      if (k === shooter) { players.push({ pos: from, done: false }); continue; }
      const d = between(6, 70);
      const pos = R() < 0.45 ? validPos(M, from.x + Math.sin(yaw) * d + between(-1.5, 1.5), from.z + Math.cos(yaw) * d + between(-1.5, 1.5)) : onCourse(M);
      players.push({ pos, done: R() < 0.08 });
    }
    list.push({
      id, hole, shooter, players, weapon, yaw, pitch: between(W.pitchMin, W.pitchMax), power: between(0.15, 1),
      wind: { dir: R() * Math.PI * 2, speed: R() * 6 },
      strokes: R() < 0.12 ? def.par + 4 : Math.floor(R() * (def.par + 2)), // par + 4 before the shot reaches the cap
      choose: Math.floor(R() * 3), seed: 1000 + id
    });
  }
  return list;
}

// Puts a match in the set-up's situation and plays the shot. Everyone stands on their ball, as in the recording.
function runShot(sc) {
  let random = rng(1);
  const match = makeMatch(sc.players.map((_, i) => 'P' + (i + 1)), () => random()), st = match.state;
  const wind = { x: Math.sin(sc.wind.dir) * sc.wind.speed, z: Math.cos(sc.wind.dir) * sc.wind.speed, dir: sc.wind.dir, speed: sc.wind.speed };
  Object.assign(st, { hole: sc.hole, wind, cur: sc.shooter, phase: 'turn' });
  sc.players.forEach((pl, i) => Object.assign(st.seats[i], { ball: { ...pl.pos }, stand: { ...pl.pos }, strokes: i === sc.shooter ? sc.strokes : 0, done: pl.done }));
  random = rng(sc.seed); // the spread draws from the shot's seed, as Math.random did in the recording
  const { shot } = match.shoot(sc.shooter, { weapon: sc.weapon, yaw: sc.yaw, pitch: sc.pitch, power: sc.power });
  let choice = null, primary = shot.outcome.proj;
  if (st.phase === 'choose') {
    const candidates = st.choice.candidates.map(c => c.proj);
    primary = match.chooseBullet(sc.shooter, sc.choose % candidates.length).proj;
    choice = { candidates, picked: primary };
  }
  const events = shot.events.filter(e => e.type === 'explode' || e.type === 'burst' || e.type === 'hit')
    .map(e => e.type === 'hit' ? { e: 'knock', step: e.step, player: e.player, to: e.to, kind: e.kind } : { e: e.type, step: e.step, at: e.at });
  return {
    id: sc.id, hole: sc.hole, weapon: WEAPONS[sc.weapon].id, shooter: sc.shooter, seed: sc.seed,
    aim: { yaw: sc.yaw, pitch: sc.pitch, power: sc.power }, wind: { x: wind.x, z: wind.z }, strokesBefore: sc.strokes,
    players: sc.players, launches: shot.projs.map(q => pick(q.launch, LAUNCH_KEYS)),
    projs: shot.projs.map(q => ({ result: q.result, endStep: q.endStep, final: pick(q.final, FINAL_KEYS) })),
    events, choice, primary,
    after: st.seats.map(s => ({ ball: s.ball, strokes: s.strokes, done: s.done, picked: s.picked }))
  };
}

// Holing out and bazooka blasts are rare in random set-ups, so a few are built on purpose on every hole
function targeted(firstId) {
  const list = [], calm = { dir: 0, speed: 0 }, dart = WEAPONS.findIndex(w => w.id === 'dart'), bazooka = WEAPONS.findIndex(w => w.id === 'bazooka');
  let id = firstId;
  HOLES.forEach((def, hole) => {
    const M = courseModel(hole);
    // Cup: a dart pointed 60° down from 1.5 m away aims straight at the hole (eye height 2.6 m), and darts have no spread
    const back = Math.atan2(M.tee.x - M.cup.x, M.tee.z - M.cup.z), d = 2.6 / Math.tan(Math.PI / 3);
    const near = { x: M.cup.x + Math.sin(back) * d, z: M.cup.z + Math.cos(back) * d };
    near.y = M.height(near.x, near.z);
    list.push({ id: id++, hole, shooter: 0, players: [{ pos: near, done: false }, { pos: { ...M.tee }, done: false }], weapon: dart,
      yaw: back + Math.PI, pitch: -60, power: 0.1, wind: calm, strokes: 1, choose: 0, seed: 5000 + hole });
    // Blast: fire once to see where the rocket explodes, then stand someone 4 m to the side of that spot
    const yaw = Math.atan2(M.cup.x - M.tee.x, M.cup.z - M.tee.z);
    const first = { id: id++, hole, shooter: 0, players: [{ pos: { ...M.tee }, done: false }, { pos: { ...M.tee }, done: true }], weapon: bazooka,
      yaw, pitch: 12, power: 0.55, wind: calm, strokes: 0, choose: 0, seed: 6000 + hole };
    const boom = runShot(first).events.find(e => e.e === 'explode').at;
    const side = validPos(M, boom.x + Math.sin(yaw + Math.PI / 2) * 4, boom.z + Math.cos(yaw + Math.PI / 2) * 4);
    list.push({ ...first, players: [first.players[0], { pos: side, done: false }] });
  });
  return list;
}

const setups = scenarios(200);
const shots = setups.concat(targeted(setups.length)).map(runShot);

test('the match plays every golden shot exactly as the original game did', async () => {
  // one shot per line keeps diffs readable
  await expect('[\n' + shots.map(s => JSON.stringify(s)).join(',\n') + '\n]\n').toMatchFileSnapshot('./golden/shots.json');
});

test('the golden shots cover every kind of outcome', () => {
  const seen = new Set();
  for (const s of shots) {
    for (const q of s.projs) seen.add(q.result);
    for (const e of s.events) seen.add(e.e === 'knock' ? e.kind : e.e);
    if (s.choice) seen.add('rifle choice');
    if (s.after[s.shooter].picked) seen.add('picked up');
  }
  expect([...seen].sort()).toEqual(['blast', 'body', 'burst', 'cup', 'explode', 'head', 'oob', 'picked up', 'rest', 'rifle choice', 'water']);
});
