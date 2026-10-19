// Golden shots: records what today's shot code (src/game/shot.js) does for about 200 seeded set-ups, so the
// pure shot simulator that replaces it can be checked against tests/golden/shots.json.
// After an intended change to how shots play, regenerate with: npx vitest run -u
import { expect, test, vi } from 'vitest';
import { HOLES, makeModel, validPos } from '../src/core/courses.js';
import { rng } from '../src/core/math.js';
import { WEAPONS } from '../src/core/weapons.js';
import { chooseBullet, releaseCharge, simShotStep, startCharge } from '../src/game/shot.js';
import { state, timers, world } from '../src/game/state.js';

// Everything the shot code uses outside core/ and game/state.js is stubbed. Some stubs log what happened,
// tagged with the simulation step it happened in.
const rec = vi.hoisted(() => ({ step: -1, events: [], shot: null }));
vi.mock('../src/audio/sfx.js', () => {
  // Only the bazooka explodes and only the grenade bursts; both fire a single projectile
  const at = () => { const b = rec.shot.projs[0].b; return { x: b.x, y: b.y, z: b.z }; };
  return {
    sfx: new Proxy({}, {
      get: (_, name) => () => {
        if (name === 'boom') rec.events.push({ e: 'explode', step: rec.step, at: at() });
        else if (name === 'burst') rec.events.push({ e: 'burst', step: rec.step, at: at() });
      }
    })
  };
});
vi.mock('../src/render/characters.js', () => ({
  launchFly: (c, to) => { c.mode = 'fly'; rec.events.push({ e: 'knock', step: rec.step, player: c.idx, to: { x: to.x, y: to.y, z: to.z } }); }
}));
vi.mock('../src/ui/hud.js', () => {
  // knock() announces the kind of hit right after launching the player
  const KIND = { 'HEADSHOT!': 'head', 'HIT!': 'body', 'BOOM!': 'blast' };
  return {
    callout: big => { if (KIND[big]) rec.events[rec.events.length - 1].kind = KIND[big]; },
    setControls() {}, setFill() {}, toast() {}, updateHUD() {}
  };
});
vi.mock('../src/ui/elements.js', () => {
  const el = () => ({ textContent: '', hidden: false, innerHTML: '', style: {}, classList: { add() {}, remove() {}, toggle() {} }, querySelector: () => null, querySelectorAll: () => [], setAttribute() {} });
  return { ui: new Proxy({}, { get: (t, k) => (t[k] ??= el()) }) };
});
vi.mock('../src/render/camera.js', () => ({ cam: { hdir: { set() {} } }, shake() {} }));
vi.mock('../src/render/particles.js', () => ({ dirtPuff() {}, spawn() {} }));
vi.mock('../src/render/projectiles.js', () => ({ makeProjectile: () => ({ g: {}, shadow: {} }), numberSprite: () => ({ position: { set() {} } }), removeShotVisuals() {} }));
vi.mock('../src/render/scene.js', () => ({ disposeTree() {}, scene: { add() {}, remove() {} } }));
vi.mock('../src/render/viewmodel.js', () => ({ vm: {} }));
vi.mock('../src/ui/pointerLock.js', () => ({ exitLock() {}, mouseMode: () => false }));
vi.mock('../src/game/aim.js', () => ({ setZoom() {} }));
vi.mock('../src/game/turns.js', () => ({ layoutChars() {}, nextTurn() {} }));

const models = HOLES.map(makeModel);
const LAUNCH_KEYS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'dirx', 'dirz'];
const FINAL_KEYS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 't', 'contact', 'surf', 'impactT', 'burstDone'];
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k]]));

// Random set-ups across all holes and weapons. About half the opponents stand in the line of fire, which is how hits happen.
function scenarios(count) {
  const R = rng(20261019), list = [];
  const between = (a, b) => a + R() * (b - a);
  const onCourse = M => { const p = M.pointAt(between(M.sTee, M.total), between(-(M.E - 4), M.E - 4)); return validPos(M, p.x, p.z); };
  for (let id = 0; id < count; id++) {
    const hole = id % 3, M = models[hole], def = HOLES[hole];
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

// Plays one set-up through the real shot code, the same way the Fire button does, and records the outcome
function runShot(sc) {
  const M = models[sc.hole];
  world.M = M;
  M.wind = { x: Math.sin(sc.wind.dir) * sc.wind.speed, z: Math.cos(sc.wind.dir) * sc.wind.speed, dir: sc.wind.dir, speed: sc.wind.speed };
  state.holeIdx = sc.hole;
  state.players = sc.players.map((pl, i) => ({
    name: 'P' + (i + 1), color: '#ffffff', ball: { ...pl.pos }, strokes: i === sc.shooter ? sc.strokes : 0, done: pl.done, scores: [],
    char: { idx: i, group: { position: { ...pl.pos } }, mode: 'idle', ring: {}, recoil: 0 }
  }));
  Object.assign(state, { cur: sc.shooter, weapon: sc.weapon, yaw: sc.yaw, pitch: sc.pitch, phase: 'aim', charging: false, shot: null, choice: null });
  rec.events = []; rec.step = -1;
  const random = vi.spyOn(Math, 'random').mockImplementation(rng(sc.seed));
  startCharge(); state.power = sc.power; releaseCharge();
  const s = state.shot;
  rec.shot = s;
  const launches = s.projs.map(q => pick(q.b, LAUNCH_KEYS));
  const ends = [];
  for (let step = 0; s.active; step++) {
    if (step > 20000) throw new Error(`shot ${sc.id} did not finish`);
    rec.step = step; simShotStep();
    s.projs.forEach((q, k) => { if (!q.active && ends[k] == null) ends[k] = step; });
  }
  let choice = null;
  if (state.phase === 'choose') {
    const candidates = state.choice.map(q => s.projs.indexOf(q)), k = sc.choose % candidates.length;
    chooseBullet(k);
    choice = { candidates, picked: candidates[k] };
  }
  random.mockRestore();
  timers.length = 0;
  return {
    id: sc.id, hole: sc.hole, weapon: WEAPONS[sc.weapon].id, shooter: sc.shooter, seed: sc.seed,
    aim: { yaw: sc.yaw, pitch: sc.pitch, power: sc.power }, wind: { x: M.wind.x, z: M.wind.z }, strokesBefore: sc.strokes,
    players: sc.players, launches,
    projs: s.projs.map((q, k) => ({ result: q.result, endStep: ends[k], final: pick(q.b, FINAL_KEYS) })),
    events: rec.events, choice, primary: s.primary,
    after: state.players.map(p => ({ ball: p.ball, strokes: p.strokes, done: p.done, picked: !!p.picked }))
  };
}

// Holing out and bazooka blasts are rare in random set-ups, so a few are built on purpose on every hole
function targeted(firstId) {
  const list = [], calm = { dir: 0, speed: 0 }, dart = WEAPONS.findIndex(w => w.id === 'dart'), bazooka = WEAPONS.findIndex(w => w.id === 'bazooka');
  let id = firstId;
  models.forEach((M, hole) => {
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

test('shot outcomes match the golden file', async () => {
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
