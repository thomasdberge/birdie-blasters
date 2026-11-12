// The pure shot simulator (src/core/shot.js) must reproduce every shot in tests/golden/shots.json exactly.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { HOLES, makeModel } from '../src/core/courses.js';
import { rng } from '../src/core/math.js';
import { STEP } from '../src/core/physics.js';
import { launchShot, SAMPLE_HZ, simulateShot } from '../src/core/shot.js';
import { WEAPONS } from '../src/core/weapons.js';

const golden = JSON.parse(readFileSync(new URL('./golden/shots.json', import.meta.url), 'utf8'));
const models = HOLES.map(makeModel);
const weapon = id => WEAPONS.find(w => w.id === id);
const FINAL_KEYS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 't', 'contact', 'surf', 'impactT', 'burstDone'];
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k]]));
const json = v => JSON.parse(JSON.stringify(v)); // compare the way the golden file stores numbers (no -0)
const freeze = o => { if (o && typeof o === 'object') { Object.values(o).forEach(freeze); Object.freeze(o); } return o; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// Simulator inputs for a golden shot. The golden recording had everyone standing on their ball.
function inputs(g) {
  return freeze({
    M: models[g.hole], W: weapon(g.weapon), wind: g.wind,
    // the golden file keeps only the launch fields that vary; the rest are launchState's starting values
    launches: g.launches.map(l => ({ contact: false, surf: null, t: 0, impactT: null, burstDone: false, justBurst: false, ...l })),
    players: g.players.map((pl, id) => ({ id, stand: pl.pos, ball: pl.pos, done: pl.done })).filter(p => p.id !== g.shooter && !p.done)
  });
}
// Frozen inputs also prove the simulator never changes them
const runs = golden.map(g => ({ g, r: simulateShot(inputs(g)) }));

test.each(golden.map(g => [g.id, g]))('shot %i: launchShot gives the recorded launch states', (id, g) => {
  const shooter = g.players[g.shooter].pos;
  const launches = launchShot(models[g.hole], weapon(g.weapon), g.aim, shooter, rng(g.seed));
  expect(json(launches.map(l => pick(l, Object.keys(g.launches[0]))))).toEqual(g.launches);
});

test.each(runs.map(({ g, r }) => [g.id, g, r]))('shot %i: simulateShot reproduces the recorded outcome', (id, g, r) => {
  // every projectile ends the same way, at the same step, in the same state
  expect(json(r.projs.map(q => ({ result: q.result, endStep: q.endStep, final: pick(q.final, FINAL_KEYS) })))).toEqual(g.projs);
  // explosions, grenade bursts and hits happen at the same steps, in the same order, with the same knock-back targets
  const events = r.events.filter(e => e.type === 'explode' || e.type === 'burst' || e.type === 'hit')
    .map(e => e.type === 'hit' ? { e: 'knock', step: e.step, player: e.player, to: e.to, kind: e.kind } : { e: e.type, step: e.step, at: e.at });
  expect(json(events)).toEqual(g.events);
  // the outcome picks the same projectile, and the ball lies exactly where the game put it
  const after = g.after[g.shooter].ball;
  if (g.choice) {
    expect(r.outcome).toEqual({ type: 'choose', candidates: g.choice.candidates });
    expect(json(r.projs[g.choice.picked].rest)).toEqual(after);
  } else {
    expect(r.outcome).toEqual({ type: g.projs[g.primary].result, proj: g.primary });
    if (r.outcome.type === 'rest') expect(json(r.projs[g.primary].rest)).toEqual(after);
  }
});

test('flight paths are sampled at SAMPLE_HZ from the trigger pull until each projectile stops', () => {
  const every = Math.round(1 / (STEP * SAMPLE_HZ));
  let bounces = 0;
  for (const { g, r } of runs) {
    r.projs.forEach((q, k) => {
      const launch = g.launches[k], p = q.path, n = p.length / 3, sample = i => ({ x: p[i * 3], y: p[i * 3 + 1], z: p[i * 3 + 2] });
      expect(n).toBe(Math.floor(q.endStep / every) + 1);
      for (let i = 0; i < n; i++) {
        // a delayed rifle bullet waits at its launch point; after that the path moves at most ~1 m per sample
        if (i * every <= q.startStep) expect(sample(i)).toEqual({ x: launch.x, y: launch.y, z: launch.z });
        else expect(dist(sample(i), sample(i - 1))).toBeLessThan(1.5);
      }
      expect(dist(sample(n - 1), q.final)).toBeLessThan(1.5);
    });
    let last = -1;
    for (const e of r.events) {
      expect(e.step).toBeGreaterThanOrEqual(last); last = e.step;
      if (e.type === 'bounce') { bounces++; expect(e.imp).toBeGreaterThan(2.5); expect(e.step).toBeLessThanOrEqual(r.projs[e.proj].endStep); }
    }
    expect(r.events.filter(e => e.type === 'end').map(e => e.proj).sort()).toEqual(r.projs.map((q, k) => k));
  }
  expect(bounces).toBeGreaterThan(100);
});

test('hits are checked where a player stands, and the knock-back starts from their ball', () => {
  const { g, r } = runs.find(({ g }) => g.weapon !== 'bazooka' && g.events.some(e => e.kind === 'body'));
  const victim = g.events.find(e => e.kind === 'body').player, M = models[g.hole], base = inputs(g);
  const tee = { x: M.tee.x, y: M.tee.y, z: M.tee.z };
  const withVictim = change => ({ ...base, players: base.players.map(p => (p.id === victim ? { ...p, ...change } : p)) });
  // ball moved to the tee, still standing in the line of fire: hit at the same step, knocked back from the tee
  const moved = simulateShot(withVictim({ ball: tee })).events.find(e => e.type === 'hit' && e.player === victim);
  expect(moved.step).toBe(r.events.find(e => e.type === 'hit' && e.player === victim).step);
  expect(dist(moved.to, tee)).toBeLessThan(10);
  // standing 30 m to the side, ball still in the line of fire: no hit
  const pos = g.players[victim].pos;
  const aside = simulateShot(withVictim({ stand: { ...pos, x: pos.x + 30 } }));
  expect(aside.events.some(e => e.type === 'hit' && e.player === victim)).toBe(false);
});
