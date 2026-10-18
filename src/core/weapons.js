// Weapon data, flat-ground ranges and the lie penalty.
// Plain JavaScript, no Three.js or DOM.

import { launchState, STEP, stepBall } from './physics.js';

// The golf bag. Each weapon stands in for a club.
// eye: camera height · pitch*: angle limits in degrees · precision: 1–10, lower = more random spread at high power
// grav: gravity multiplier (lift) · thrust/burn: rocket motor · windMul: how much the wind moves it
// burst: grenade energy kick after its first bounce · magnet: pull toward the cup · shots: projectiles per trigger pull
// zoom: scope magnification · sandProof: no power loss from sand or rough · cupR/cupV: how forgiving the cup is
export const WEAPONS = [
  { id: 'bazooka', name: 'Bazooka', club: 'Driver', cal: '84 mm rocket', speed: 34, thrust: 15, burn: 0.9, rest: 0.12, keep: 0.35, rollMul: 1.6, drag: 0.004, windMul: 1.8,
    eye: 2.6, pitchMin: -10, pitchMax: 55, pitchDef: 24, precision: 4, explode: true, zoom: 3,
    tip: 'The rocket motor adds speed, and a tailwind adds even more. Explodes on landing.' },
  { id: 'grenade', name: 'Grenade Launcher', club: '3-wood', cal: '40 mm', speed: 33, rest: 0.45, keep: 0.6, rollMul: 1.2, drag: 0.005, windMul: 1.1,
    eye: 2.6, pitchMin: -5, pitchMax: 65, pitchDef: 40, precision: 6, burst: { delay: 0.35, up: 6, push: 6 }, zoom: 3,
    tip: 'High arc over trees and crates. Bounces once, then an energy burst sends it onward.' },
  { id: 'sniper', name: 'Sniper Rifle', club: 'Long iron', cal: '.338', speed: 57, rest: 0.40, keep: 0.5, rollMul: 1.0, drag: 0.006, windMul: 0.45,
    eye: 2.6, pitchMin: -10, pitchMax: 12, pitchDef: 4, precision: 9, zoom: 5,
    tip: 'Flat and precise. Zoom in and the scope shows where the bullet lands, ignoring wind.' },
  { id: 'auto', name: 'Assault Rifle', club: 'Mid iron', cal: '5.56 mm', speed: 34, rest: 0.35, keep: 0.55, rollMul: 1.0, drag: 0.006, windMul: 0.8,
    eye: 2.6, pitchMin: -10, pitchMax: 20, pitchDef: 10, precision: 8, shots: 3, zoom: 3,
    tip: 'Fires three bullets on slightly different paths. You pick which one counts.' },
  { id: 'shotgun', name: 'Shotgun', club: 'Short iron', cal: '12-gauge slug', speed: 26, rest: 0.30, keep: 0.5, rollMul: 1.2, drag: 0.01, windMul: 0.7,
    eye: 2.6, pitchMin: -15, pitchMax: 40, pitchDef: 18, precision: 9, magnet: 2.5, zoom: 3,
    tip: 'The slug is pulled toward the hole over the last 12 metres.' },
  { id: 'pistol', name: 'Pistol', club: 'Wedge', cal: '9 mm', speed: 19, grav: 0.75, rest: 0.20, keep: 0.4, rollMul: 1.6, drag: 0.004, windMul: 0.8,
    eye: 2.6, pitchMin: -20, pitchMax: 50, pitchDef: 28, precision: 9, zoom: 3,
    tip: 'A little lift makes it float down softly and stop fast. A higher angle stops it quicker.' },
  { id: 'flare', name: 'Flare Gun', club: 'Sand wedge', cal: 'distress flare', speed: 19, grav: 0.6, rest: 0.10, keep: 0.3, rollMul: 2.0, drag: 0.3, windMul: 1.6,
    eye: 2.6, pitchMin: 20, pitchMax: 85, pitchDef: 65, precision: 8, sandProof: true, zoom: 3,
    tip: 'Goes almost straight up and floats down. Loses no power in sand or rough, but the wind catches it easily.' },
  // Foam dart: heavy air drag makes it drop steeply and barely bounce. The cup is more forgiving for darts.
  { id: 'dart', name: 'Dart Blaster', club: 'Putter', cal: 'foam dart', speed: 25, rest: 0.15, keep: 0.45, rollMul: 1.8, drag: 0.5, windMul: 1.2,
    eye: 2.6, pitchMin: -60, pitchMax: 55, pitchDef: 15, precision: 10, cupR: 0.95, cupV: 10, zoom: 3,
    tip: 'The foam dart drops steeply and barely bounces. Lob it straight in, or let a flatter shot roll in.' }
];
export const BURST_PATTERN = [[0, 0, 0], [-1.3, 0.7, -0.05], [1.3, -0.5, 0.05]]; // yaw°, pitch°, power for the three assault-rifle bullets
export function widx(id) { return WEAPONS.findIndex(w => w.id === id); }
// Power lost to a bad lie. The flare gun is built for bunkers and does not care.
export function lieFactor(W, surf) { if (W.sandProof) return 1; return surf === 'sand' ? 0.55 : surf === 'rough' ? 0.85 : 1; }

// Flat-ground reference: the longest full-power shot each weapon can make within its pitch limits
function flatShot(W, pitch) {
  const UP = { x: 0, y: 1, z: 0 };
  const FLAT = { height: () => 0, normal: () => UP, surface: () => 'fairway', boxes: [], trees: [] };
  const b = launchState(W, 1, 0, pitch, { x: 0, y: 0, z: 0 });
  let t = 0, still = 0;
  while (t < 30) {
    t += STEP; stepBall(b, STEP, W, FLAT, false);
    if (b.contact && Math.hypot(b.vx, b.vy, b.vz) < 0.3) { still += STEP; if (still > 0.25) break; } else still = 0;
  }
  return b.z;
}
for (const W of WEAPONS) {
  let best = 0;
  for (let p = Math.max(W.pitchMin, -5); p <= W.pitchMax; p += 2.5) best = Math.max(best, flatShot(W, p));
  W.range = Math.round(best / 5) * 5;
}
