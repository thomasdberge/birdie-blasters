// Text helpers for the HUD.

export const fmt1 = v => v.toFixed(1);
export function genitive(n) { return /s$/i.test(n) ? n + '’' : n + '’s'; }
export const SURF_NAME = { green: 'green', fairway: 'fairway', tee: 'tee', rough: 'rough', sand: 'bunker', crate: 'ammo crate', oob: 'out of bounds' };
