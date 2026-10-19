// A whole shot, from aim to outcome, without rendering: the game server runs this to decide every shot.
// Plain JavaScript, no Three.js or DOM.

import { CUP_R, validPos } from './courses.js';
import { clamp } from './math.js';
import { BALL_R, launchState, STEP, stepBall } from './physics.js';
import { BLAST_R, CHAR_S, KNOCK } from './rules.js';
import { BURST_PATTERN, lieFactor } from './weapons.js';

// Flight paths are recorded at this rate; the simulation itself runs at 1 / STEP = 240 per second
export const SAMPLE_HZ = 60;
const SAMPLE_EVERY = Math.round(1 / (STEP * SAMPLE_HZ));

// Triangular random number in [-1, 1], most often near 0
function tri(rand) { return (rand() + rand()) - 1; }

// Launch states for one trigger pull. The random spread grows with power and shrinks with precision, and a bad lie takes power.
// aim: { yaw (radians), pitch (degrees), power (0–1) } · from: the shooter's ball · rand: Math.random or a seeded generator
export function launchShot(M, W, aim, from, rand) {
  const lie = lieFactor(W, M.surface(from.x, from.z));
  const spread = (10 - W.precision) * 0.3 * aim.power; // degrees of random wobble at this power
  const n = W.shots || 1, launches = [];
  for (let k = 0; k < n; k++) {
    const pat = n > 1 ? BURST_PATTERN[k] : [0, 0, 0];
    const yaw = aim.yaw + (tri(rand) * spread + pat[0]) * Math.PI / 180;
    const pitch = aim.pitch + tri(rand) * spread * 0.5 + pat[1];
    const pw = clamp(aim.power * lie * (1 + tri(rand) * spread * 0.01 + pat[2]), 0.01, 1);
    launches.push(launchState(W, pw, yaw, pitch, from));
  }
  return launches;
}

// Which part of a player standing at s a projectile at b hits, if any
function hitKind(b, s) {
  if (Math.hypot(b.x - s.x, b.y - (s.y + 2.02 * CHAR_S), b.z - s.z) < 0.52 * CHAR_S + BALL_R + 0.08) return 'head';
  if (Math.hypot(b.x - s.x, b.z - s.z) < 0.74 * CHAR_S + BALL_R && b.y > s.y - 0.1 && b.y < s.y + 1.62 * CHAR_S) return 'body';
  return null;
}

// Where a hit sends a player: a headshot back to the tee, a body hit KNOCK metres back down the course, a blast away from the explosion
function knockTarget(M, kind, ball, blast) {
  if (kind === 'head') return at(M.tee);
  if (kind === 'body') {
    const pr = M.project(ball.x, ball.z), pt = M.pointAt(Math.max(M.sTee, pr.s - KNOCK), clamp(pr.lat, -(M.def.fairW - 2), M.def.fairW - 2));
    return at(validPos(M, pt.x, pt.z));
  }
  const dx = ball.x - blast.x, dz = ball.z - blast.z, d = Math.max(0.5, Math.hypot(dx, dz)), push = 8 + 10 * (1 - d / BLAST_R);
  return at(validPos(M, ball.x + dx / d * push, ball.z + dz / d * push));
}

function at(b) { return { x: b.x, y: b.y, z: b.z }; }

// Runs a shot until every projectile has stopped. Inputs are not changed.
//   M: course model · W: weapon · wind: { x, z } in m/s · launches: from launchShot
//   players: who can be hit (not the shooter, not finished), in seat order, as { id, stand, ball }.
//     Hits are checked where a player stands; a knock-back starts from their ball.
// Returns { steps, projs, events, outcome }. Steps are simulation steps of STEP seconds counted from the trigger pull.
//   projs[k]: { launch, startStep, endStep, result, path, final, rest }. path holds x, y, z at SAMPLE_HZ from time 0 while
//     the projectile is in play (a delayed rifle bullet waits at its launch point); rest is where the ball lies after 'rest'.
//   events, in order: bounce (imp > 2.5) · burst · explode · hit (kind 'head' | 'body' | 'blast', to) · end (result).
//   outcome: { type: 'cup' | 'rest' | 'water' | 'oob', proj } or { type: 'choose', candidates } when several rifle bullets stop.
export function simulateShot({ M, W, wind, launches, players }) {
  const C = Object.create(M); C.wind = wind; // the course with this turn's wind
  const projs = launches.map((b, k) => ({ b: { ...b }, delay: k * 0.09, active: true, still: 0, startStep: null, endStep: null, result: null, rest: null, path: [b.x, b.y, b.z] }));
  const events = [], hit = new Set();
  let exploded = false, step = 0;
  const knock = (k, p, kind, blast) => events.push({ type: 'hit', step, proj: k, player: p.id, kind, to: knockTarget(M, kind, p.ball, blast) });
  const explode = (k, directId) => {
    exploded = true;
    const b = projs[k].b;
    events.push({ type: 'explode', step, proj: k, at: at(b) });
    for (const p of players) {
      if (p.id === directId || hit.has(p.id)) continue;
      const s = p.stand;
      if (Math.hypot(s.x - b.x, s.z - b.z) < BLAST_R && Math.abs(s.y - b.y) < 6) { hit.add(p.id); knock(k, p, 'blast', { x: b.x, z: b.z }); }
    }
  };
  const end = (k, result) => {
    const q = projs[k], b = q.b;
    q.active = false; q.result = result; q.endStep = step;
    if (result === 'rest') q.rest = { x: b.x, y: Math.max(M.height(b.x, b.z), b.y - BALL_R), z: b.z };
    events.push({ type: 'end', step, proj: k, result, at: at(b) });
  };

  while (projs.some(q => q.active)) {
    for (let k = 0; k < projs.length; k++) {
      const q = projs[k];
      if (!q.active) continue;
      if (q.delay > 0) { q.delay -= STEP; continue; }
      if (q.startStep == null) q.startStep = step;
      const b = q.b;
      const imp = stepBall(b, STEP, W, C, true);
      if (imp > 0 || b.contact) {
        if (W.explode && !exploded) explode(k, -1);
        if (imp > 2.5) events.push({ type: 'bounce', step, proj: k, at: at(b), imp, surf: b.surf });
      }
      if (b.justBurst) { b.justBurst = false; events.push({ type: 'burst', step, proj: k, at: at(b) }); }
      for (const p of players) {
        if (hit.has(p.id)) continue;
        const kind = hitKind(b, p.stand);
        if (!kind) continue;
        hit.add(p.id);
        b.vx *= -0.12; b.vz *= -0.12; b.vy = Math.abs(b.vy) * 0.2 + 2.5;
        if (W.explode && !exploded) explode(k, p.id);
        knock(k, p, kind, null);
      }
      for (const pd of M.ponds) if (b.y - BALL_R * 0.5 < pd.level && Math.hypot(b.x - pd.x, b.z - pd.z) < pd.r + 6) { end(k, 'water'); break; }
      if (!q.active) continue;
      if (b.x < M.ext.x0 || b.x > M.ext.x1 || b.z < M.ext.z0 || b.z > M.ext.z1 || b.y < -60 || (b.contact && b.surf === 'oob')) { end(k, 'oob'); continue; }
      const dc = Math.hypot(b.x - M.cup.x, b.z - M.cup.z);
      if (dc < (W.cupR || CUP_R) && b.y - BALL_R < M.cup.y + 0.35 && Math.hypot(b.vx, b.vz) < (W.cupV || 7.5) && b.vy < 3) { end(k, 'cup'); continue; }
      const sp = Math.hypot(b.vx, b.vy, b.vz);
      if (b.contact && sp < 0.3) { q.still += STEP; if (q.still > 0.25) { end(k, 'rest'); continue; } } else q.still = 0;
      if (b.t > 24) end(k, 'rest');
    }
    step++;
    if (step % SAMPLE_EVERY === 0) for (const q of projs) if (q.active) q.path.push(q.b.x, q.b.y, q.b.z);
  }

  const cup = projs.findIndex(q => q.result === 'cup');
  const rest = projs.map((q, k) => k).filter(k => projs[k].result === 'rest');
  const outcome = cup >= 0 ? { type: 'cup', proj: cup }
    : !rest.length ? { type: projs[0].result, proj: 0 }
    : rest.length === 1 ? { type: 'rest', proj: rest[0] }
    : { type: 'choose', candidates: rest };
  return {
    steps: step, events, outcome,
    projs: projs.map((q, k) => ({ launch: { ...launches[k] }, startStep: q.startStep, endStep: q.endStep, result: q.result, path: q.path, final: q.b, rest: q.rest }))
  };
}
