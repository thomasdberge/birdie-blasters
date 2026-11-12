// Shared game state: the match being played, and what the screen shows of it.

export const STYLES = [
  { color: '#ff5fa2', hat: 'cone',      hatName: 'Traffic cone', name: 'Kevin Kaboom' },
  { color: '#3db8ff', hat: 'viking',    hatName: 'Viking helmet', name: 'Barry Bazooka' },
  { color: '#ffcf3d', hat: 'propeller', hatName: 'Propeller cap', name: 'Bouncy Betty' },
  { color: '#b07cff', hat: 'party',     hatName: 'Party hat',    name: 'Doctor Dunk' }
];
// The match (src/core/match.js) decides every shot and turn the moment it happens. The players' ball, strokes, done,
// picked and scores below are what the screen shows; they catch up with the match as each shot plays out.
// online is null on one screen. Online, the match is a remote one (src/net/remoteMatch.js) and seat is this player's.
export const game = { match: null, online: null };
// Whether this screen plays seat i: every seat on one screen, only its own online
export function playsSeat(i) { return !game.online || game.online.seat === i; }
// phase: setup · pick (golf bag open) · aim · flight · choose · settle · between · end, and online also watch (someone
// else's turn)
export const state = {
  phase: 'setup', holeIdx: 0, players: [], cur: -1,
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
export function currentLie() { const p = state.players[state.cur]; return p ? world.M.surface(p.ball.x, p.ball.z) : 'fairway'; }
