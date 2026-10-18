// Game rules shared by hits and scoring. Plain JavaScript, no Three.js or DOM.
// KNOCK: metres a body hit sends a player back · BLAST_R: bazooka blast radius · CHAR_S: character scale, which also sets the hitbox

export const KNOCK = 40;
export const BLAST_R = 8;
export const CHAR_S = 1.35;
export function golfTerm(strokes, par) {
  if (strokes === 1) return 'HOLE IN ONE!';
  const d = strokes - par;
  const names = { '-3': 'ALBATROSS!', '-2': 'EAGLE!', '-1': 'BIRDIE!', '0': 'PAR', '1': 'BOGEY', '2': 'DOUBLE BOGEY', '3': 'TRIPLE BOGEY' };
  return names[d] || (d < 0 ? 'INCREDIBLE!' : '+' + d);
}
