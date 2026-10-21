// The paper scorecard: between holes, at the end, and when the hole card is tapped.

import { HOLES } from '../core/courses.js';
import { $ } from '../platform.js';
import { cancelCharge } from '../game/shot.js';
import { game, state } from '../game/state.js';
import { leaveGame, nextHole, playAgain } from '../game/turns.js';
import { ui } from './elements.js';
import { leaveRoom } from './lobby.js';
import { exitLock } from './pointerLock.js';

function markCell(score, par) {
  if (score == null) return '<span class="mk" aria-label="not played">·</span>';
  const d = score - par, cls = d <= -2 ? 'u2' : d === -1 ? 'u1' : d === 1 ? 'o1' : d >= 2 ? 'o2' : '';
  return `<span class="mk ${cls}">${score}</span>`;
}
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
export function showBoard(kind) {
  exitLock(); cancelCharge();
  const parTot = HOLES.reduce((a, h) => a + h.par, 0);
  const totals = state.players.map(p => p.scores.reduce((a, v) => a + (v || 0), 0));
  const parPlayed = HOLES.reduce((a, h, i) => a + (state.players[0] && state.players[0].scores[i] != null ? h.par : 0), 0);
  const best = Math.min(...totals);
  let rows = '';
  state.players.forEach((p, i) => {
    const diff = totals[i] - parPlayed, lead = state.players.length > 1 && totals[i] === best && parPlayed > 0;
    rows += `<tr class="${lead ? 'lead' : ''}"><th scope="row"><i class="chip" style="background:${p.color}"></i>${esc(p.name)}</th>` +
      HOLES.map((h, k) => `<td>${markCell(p.scores[k], h.par)}</td>`).join('') +
      `<td>${parPlayed ? totals[i] : '·'}</td><td>${parPlayed ? (diff > 0 ? '+' + diff : diff === 0 ? 'E' : diff) : '·'}</td></tr>`;
  });
  $('#scTable').innerHTML = `<thead><tr><th scope="col">Player</th>${HOLES.map((h, k) => `<th scope="col">${k + 1}</th>`).join('')}<th scope="col">Tot</th><th scope="col">±</th></tr>` +
    `<tr class="par"><th scope="row">Par</th>${HOLES.map(h => `<td>${h.par}</td>`).join('')}<td>${parTot}</td><td></td></tr></thead><tbody>${rows}</tbody>`;
  const acts = $('#scActions'); acts.innerHTML = '';
  const btn = (txt, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = txt; b.addEventListener('click', fn); acts.appendChild(b); return b; };
  let focusBtn;
  if (kind === 'final') {
    const winners = state.players.filter((p, i) => totals[i] === best);
    $('#scTitle').textContent = state.players.length === 1 ? `${totals[0]} strokes in total` : winners.length > 1 ? 'It’s a tie!' : `${winners[0].name} wins!`;
    $('#scSub').textContent = state.players.length === 1 ? `The course is par ${parTot}. ${totals[0] - parTot <= 0 ? 'Nicely shot.' : 'Try to beat yourself next round.'}` : winners.length > 1 ? `${winners.map(w => w.name).join(' and ')} shared the win on ${best} strokes.` : `${best} strokes over three holes. The course is par ${parTot}.`;
    // Online the server starts the next hole, and a new game
    if (!game.online) { focusBtn = btn('Play again', 'btn-primary', playAgain); btn('New players', 'btn-ghost', leaveGame); }
  } else if (kind === 'hole') {
    const def = HOLES[state.holeIdx];
    $('#scTitle').textContent = `Hole ${state.holeIdx + 1} done`;
    $('#scSub').textContent = `${def.name}, par ${def.par}. The lowest score on this hole tees off first on the next.`;
    if (!game.online) focusBtn = btn(`To hole ${state.holeIdx + 2}`, 'btn-primary', nextHole);
  } else {
    $('#scTitle').textContent = 'Scorecard';
    $('#scSub').textContent = `Hole ${state.holeIdx + 1} in progress. Only finished holes are counted.`;
    focusBtn = btn('Back to the course', 'btn-primary', () => { ui.board.hidden = true; });
  }
  // Online, leaving gives the seat up for good, so while the game is on the button asks once more
  if (game.online) {
    const leave = btn('Leave game', 'btn-ghost', () => {
      if (kind === 'final' || leave.dataset.sure) { leaveRoom(); return; }
      leave.dataset.sure = '1'; leave.textContent = 'Leave for good?';
    });
  }
  ui.board.hidden = false;
  if (focusBtn) focusBtn.focus({ preventScroll: true });
}
