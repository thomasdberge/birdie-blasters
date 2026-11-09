// The paper scorecard: between holes, at the end, and when the hole card is tapped.

import { HOLES } from '../core/courses.js';
import { $ } from '../platform.js';
import { cancelCharge } from '../game/shot.js';
import { game, state } from '../game/state.js';
import { leaveGame, nextHole, playAgain } from '../game/turns.js';
import { ui } from './elements.js';
import { leaveRoom } from './lobby.js';
import { exitLock } from './pointerLock.js';

// out: the player has left an online game, so a hole without a score is one they will not play
function markCell(score, par, out) {
  if (score == null) return out ? '<span class="mk" aria-label="left the game">—</span>' : '<span class="mk" aria-label="not played">·</span>';
  const d = score - par, cls = d <= -2 ? 'u2' : d === -1 ? 'u1' : d === 1 ? 'o1' : d >= 2 ? 'o2' : '';
  return `<span class="mk ${cls}">${score}</span>`;
}
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
// Everyone is ranked, except an online player who left before finishing the last hole
const ranked = p => !p.out || HOLES.every((h, k) => p.scores[k] != null);

// kind: 'hole' (between holes), 'final' or 'peek' (the hole card was tapped) · shownKey: what the board showed
// (boardKey) · nextEl: the countdown to the next hole online
let kind = null, shownKey = '', nextEl = null;
const boardKey = () => JSON.stringify([state.players.map(p => [p.out, p.scores]), game.online && game.match.host]);

export function showBoard(k) {
  exitLock(); cancelCharge();
  kind = k;
  fillCard();
  const focusBtn = fillActions();
  ui.board.hidden = false;
  if (focusBtn) focusBtn.focus({ preventScroll: true });
}
// Online, the scorecard follows the room while it is up: someone leaves, or the host changes (only the host can play
// again)
export function refreshBoard() {
  if (ui.board.hidden || boardKey() === shownKey) return;
  fillCard();
  if (kind === 'final') fillActions()?.focus({ preventScroll: true });
}
// Online between holes: the countdown to the next hole, ms left or null
export function setNextHoleClock(ms) {
  if (!nextEl || ms == null) return;
  const s = Math.ceil(ms / 1000), next = state.holeIdx + 2;
  const text = s > 0 ? `Hole ${next} starts in ${s} s.` : `Hole ${next} is starting…`;
  if (nextEl.textContent !== text) nextEl.textContent = text;
}

function fillCard() {
  shownKey = boardKey();
  const players = state.players, parTot = HOLES.reduce((a, h) => a + h.par, 0);
  const totals = players.map(p => p.scores.reduce((a, v) => a + (v || 0), 0));
  const parPlayed = players.map(p => HOLES.reduce((a, h, k) => a + (p.scores[k] != null ? h.par : 0), 0));
  const best = Math.min(...players.map((p, i) => (ranked(p) ? totals[i] : Infinity)));
  let rows = '';
  players.forEach((p, i) => {
    const counted = ranked(p) && parPlayed[i] > 0, diff = totals[i] - parPlayed[i], lead = players.length > 1 && counted && totals[i] === best;
    rows += `<tr class="${lead ? 'lead' : ranked(p) ? '' : 'out'}"><th scope="row"><i class="chip" style="background:${p.color}"></i>${esc(p.name)}</th>` +
      HOLES.map((h, k) => `<td>${markCell(p.scores[k], h.par, p.out)}</td>`).join('') +
      (counted ? `<td>${totals[i]}</td><td>${diff > 0 ? '+' + diff : diff === 0 ? 'E' : diff}</td>` : ranked(p) ? '<td>·</td><td>·</td>' : '<td>—</td><td>—</td>') + '</tr>';
  });
  $('#scTable').innerHTML = `<thead><tr><th scope="col">Player</th>${HOLES.map((h, k) => `<th scope="col">${k + 1}</th>`).join('')}<th scope="col">Tot</th><th scope="col">±</th></tr>` +
    `<tr class="par"><th scope="row">Par</th>${HOLES.map(h => `<td>${h.par}</td>`).join('')}<td>${parTot}</td><td></td></tr></thead><tbody>${rows}</tbody>`;
  if (kind === 'final') {
    const winners = players.filter((p, i) => ranked(p) && totals[i] === best);
    $('#scTitle').textContent = players.length === 1 ? `${totals[0]} strokes in total` : !winners.length ? 'Game over' : winners.length > 1 ? 'It’s a tie!' : `${winners[0].name} wins!`;
    $('#scSub').textContent = players.length === 1 ? `The course is par ${parTot}. ${totals[0] - parTot <= 0 ? 'Nicely shot.' : 'Try to beat yourself next round.'}`
      : !winners.length ? 'Everyone left before the last hole.'
      : winners.length > 1 ? `${winners.map(w => w.name).join(' and ')} shared the win on ${best} strokes.` : `${best} strokes over three holes. The course is par ${parTot}.`;
  } else if (kind === 'hole') {
    const def = HOLES[state.holeIdx];
    $('#scTitle').textContent = `Hole ${state.holeIdx + 1} done`;
    $('#scSub').textContent = `${def.name}, par ${def.par}. The lowest score on this hole tees off first on the next.`;
  } else {
    $('#scTitle').textContent = 'Scorecard';
    $('#scSub').textContent = `Hole ${state.holeIdx + 1} in progress. Only finished holes are counted.`;
  }
}
// The buttons under the card; returns the one to focus. Online the server starts the next hole after a countdown, and
// the host's Play again takes everyone back to the lobby.
function fillActions() {
  const acts = $('#scActions'); acts.innerHTML = ''; nextEl = null;
  const btn = (txt, cls, fn) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = txt; b.addEventListener('click', fn); acts.appendChild(b); return b; };
  const note = txt => { const p = document.createElement('p'); p.className = 'sc-note'; p.textContent = txt; acts.appendChild(p); return p; };
  let focusBtn;
  if (kind === 'final') {
    const host = game.online && game.match.host;
    if (!game.online) { focusBtn = btn('Play again', 'btn-primary', playAgain); btn('New players', 'btn-ghost', leaveGame); }
    else if (host === game.online.seat) focusBtn = btn('Play again', 'btn-primary', e => { e.currentTarget.disabled = true; game.match.playAgain(); });
    else note(`Waiting for ${host >= 0 ? state.players[host].name : 'the host'} to play again.`);
  } else if (kind === 'hole') {
    if (!game.online) focusBtn = btn(`To hole ${state.holeIdx + 2}`, 'btn-primary', nextHole);
    else nextEl = note('');
  } else {
    focusBtn = btn('Back to the course', 'btn-primary', () => { ui.board.hidden = true; });
  }
  // Online, leaving gives the seat up for good, so while the game is on the button asks once more
  if (game.online) {
    const leave = btn('Leave game', 'btn-ghost', () => {
      if (kind === 'final' || leave.dataset.sure) { leaveRoom(); return; }
      leave.dataset.sure = '1'; leave.textContent = 'Leave for good?';
    });
  }
  return focusBtn;
}
