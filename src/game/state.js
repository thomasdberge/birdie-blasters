// Shared game state.

import { HOLES } from '../core/courses.js';

export const STYLES = [
  { color: '#ff5fa2', hat: 'cone',      hatName: 'Traffic cone', name: 'Kevin Kaboom' },
  { color: '#3db8ff', hat: 'viking',    hatName: 'Viking helmet', name: 'Barry Bazooka' },
  { color: '#ffcf3d', hat: 'propeller', hatName: 'Propeller cap', name: 'Bouncy Betty' },
  { color: '#b07cff', hat: 'party',     hatName: 'Party hat',    name: 'Doctor Dunk' }
];
export const state = {
  phase: 'setup', holeIdx: 0, players: [], order: [], turnPos: 0, cur: -1,
  weapon: 0, yaw: 0, pitch: 30, zoom: false, zoomF: 1, charging: false, chargeT: 0, power: 0,
  shot: null, timeScale: 1, slowT: 0, shotsFired: 0, waitFn: null, count: 2
};
export const timers = [];
export function later(sec, fn) { timers.push({ t: sec, fn }); }
// Game time in seconds, advanced every frame; drives animation
export const clock = { t: 0 };
// The current hole: its course model (M) and the Three.js objects built from it
export const world = { group: null, M: null, flag: null, waters: [], clouds: [], mapStatic: null };
export function distToCup(p) { const M = world.M; return Math.hypot(p.ball.x - M.cup.x, p.ball.z - M.cup.z); }
export function teeSpot() { const M = world.M; return { x: M.tee.x, y: M.tee.y, z: M.tee.z }; }
export function cap() { return HOLES[state.holeIdx].par + 5; }
export function currentLie() { const p = state.players[state.cur]; return p ? world.M.surface(p.ball.x, p.ball.z) : 'fairway'; }
