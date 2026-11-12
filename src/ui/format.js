// Text helpers for the HUD.

export const fmt1 = v => v.toFixed(1);
export function genitive(n) { return /s$/i.test(n) ? n + '’' : n + '’s'; }
// Milliseconds as minutes and whole seconds, rounded up: 42000 → "0:42"
export function minSec(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
export const SURF_NAME = { green: 'green', fairway: 'fairway', tee: 'tee', rough: 'rough', sand: 'bunker', crate: 'ammo crate', oob: 'out of bounds' };
