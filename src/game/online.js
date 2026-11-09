// Plays an online match on screen. The server runs the match and the room state says where it stands; the screen shows
// it through the same display copies as the one-screen game, and plays each shot when its result arrives.

import { SHOT_REJECTED } from '../core/protocol.js';
import { labelFont } from '../platform.js';
import { remoteMatch } from '../net/remoteMatch.js';
import { aimAgain, cancelCharge, playShot, showChoice } from './shot.js';
import { game, state, timers } from './state.js';
import { beginTurn, endHole, leaveGame, setPlayers, showHole, turnTimedOut } from './turns.js';
import { removeShotVisuals } from '../render/projectiles.js';
import { ui } from '../ui/elements.js';
import { setControls, toast } from '../ui/hud.js';
import { refreshBoard } from '../ui/scorecard.js';

// seen: per seat, what this screen last knew of it ({ connected, out, left }) · away: per seat, when this screen's
// countdown for a player who lost the connection ends · offline: this player's own connection is lost · games: counts
// the games this screen has played, so nothing from an earlier one gets through · stops: stop listening to the room
let ready = false, shown = null, clock = null, seen = [], away = [], offline = false, games = 0, stops = [];
// joined: a room whose game has started. When the host plays again after the last hole, the room goes back to the
// lobby and its next game starts here again.
export async function playOnline(joined) {
  const g = ++games;
  ready = false; shown = { hole: -1, turn: -1, over: false }; clock = null; seen = []; away = []; offline = false;
  const live = () => ready && games === g;
  const match = remoteMatch(joined, {
    shot: m => { if (live()) shotArrived(m); }, chosen: m => { if (live()) choiceArrived(m); },
    timeUp: m => { if (live()) timeUp(m); }, rejected: m => { if (live()) shotRejected(m); }
  });
  game.match = match;
  game.online = { seat: [...joined.state.seats].findIndex(s => s.sessionId === joined.sessionId) };
  // After a network drop the SDK reconnects by itself, and the room state catches the screen up
  const dropped = () => { offline = true; }, back = () => { offline = false; }, changed = () => { if (live()) follow(); };
  joined.onDrop(dropped); joined.onReconnect(back);
  stops = [() => match.close(), () => joined.onDrop.remove(dropped), () => joined.onReconnect.remove(back), () => joined.onStateChange.remove(changed)];
  await labelFont();
  if (games !== g) return; // the game stopped while the font loaded
  setPlayers(match.state.seats);
  ready = true;
  joined.onStateChange(changed);
  follow();
}
export function stopOnline() {
  games++;
  for (const stop of stops) stop();
  stops = []; ready = false; clock = null; offline = false;
  leaveGame();
}

// Milliseconds left on the shot clock as this screen counts it down, or null when there is nothing to show: the turn
// clock while the golf bag is open, aiming or watching, the rifle clock once the bullets have landed here
export function shotClockLeft() {
  if (!clock || !clock.of) return null;
  const showing = clock.of === 'turn' ? ['pick', 'aim', 'watch'].includes(state.phase) : clock.of === 'choose' && state.phase === 'choose';
  return showing ? Math.max(0, clock.ends - performance.now()) : null;
}
// Milliseconds until the next hole starts as this screen counts them down, or null when it is not between holes
export function nextHoleLeft() { return clock?.of === 'between' ? Math.max(0, clock.ends - performance.now()) : null; }
// Whether this player can do nothing now: this screen's countdown has reached 0, or the connection is lost
export function cannotAct() { return offline || (!!clock?.of && performance.now() >= clock.ends); }
// Every frame online. This screen's countdown runs behind the server's by a network delay, and a shot takes another to
// arrive, so the server still takes a shot or a rifle choice half a second after its deadline. At 0 here, or while the
// connection is lost, Fire goes off, a charge is dropped and the bullet buttons go, so nothing is sent that could come
// too late; the turn passes when the server says so.
export function holdControls() {
  if (!cannotAct()) return;
  cancelCharge();
  if (!ui.fire.disabled) setControls(false);
  if (!ui.choose.hidden) ui.choose.hidden = true;
}
// Who has lost the connection, for the HUD: { name, color, ms } with the milliseconds they have left to come back, and
// ms null for this player while their own connection is lost
export function awayList() {
  const now = performance.now(), mine = game.online.seat, me = state.players[mine], rows = [];
  if (offline && me) rows.push({ name: me.name, color: me.color, ms: null });
  seen.forEach((s, i) => { if (i !== mine && !s.connected && !s.out) rows.push({ name: state.players[i].name, color: state.players[i].color, ms: Math.max(0, away[i] - now) }); });
  return rows;
}

// Browsers pause animation in a tab in the background, so such a tab cannot play a shot to the end. It says it has
// watched it at once, so the others do not wait for it; when it is opened again it skips to where the match is.
export function initOnline() {
  document.addEventListener('visibilitychange', () => { if (document.hidden && ready) game.match.next(); });
}

// The screen follows the room state: a new hole, a new turn, the end of a hole. The server only goes on once every
// screen has watched the last shot, or after waiting long enough; a screen still showing it then skips to its end.
// A screen that joins between holes or at the end shows the hole and then the scorecard.
function follow() {
  const ms = game.match.state, c = game.match.clock;
  // The server writes the time left about once a second; every new value sets when this screen's countdown ends
  if (!clock || c.of !== clock.of || c.left !== clock.left) clock = { ...c, ends: performance.now() + c.left };
  followSeats(ms);
  if (ms.hole !== shown.hole) { shown = { hole: ms.hole, turn: ms.turn, over: false }; showHole(); }
  else if (ms.turn !== shown.turn) { shown.turn = ms.turn; skipShot(); beginTurn(); }
  if (!shown.over && (ms.phase === 'between' || ms.phase === 'end')) { shown.over = true; skipShot(); endHole(); }
  if (ms.phase === 'waiting') showWaiting(ms);
  refreshBoard(); // someone left, or the host changed, while the scorecard is up
}
function skipShot() {
  timers.length = 0; state.waitFn = null; state.timeScale = 1; state.slowT = 0;
  removeShotVisuals(); state.shot = null; state.choice = null; ui.choose.hidden = true;
}
// Players who lose the connection, come back or leave. The others are told; someone who has left disappears from the
// course at once. Each countdown to come back starts again from every new value the server writes.
function followSeats(ms) {
  const left = game.match.reconnectLeft;
  ms.seats.forEach((s, i) => {
    const was = seen[i];
    if (was && i !== game.online.seat) {
      if (s.out && !was.out) { toast(`${s.name} left the game.`); state.players[i].out = true; }
      else if (!s.out && was.connected !== s.connected) toast(s.connected ? `${s.name} is back.` : `${s.name} lost the connection.`);
    }
    if (left[i] !== was?.left) away[i] = performance.now() + left[i];
    seen[i] = { connected: s.connected, out: s.out, left: left[i] };
  });
}
// Everyone who still has to finish the hole has lost the connection: the match waits until one of them is back
function showWaiting(ms) {
  if (state.phase !== 'watch' && state.phase !== 'settle') return;
  const text = `Waiting for ${ms.seats.filter(s => !s.out && !s.done && !s.connected).map(s => s.name).join(' or ')} to come back.`;
  if (ui.hint.textContent === text) return;
  ui.hint.textContent = text;
  for (const p of state.players) p.char.ring.visible = false;
}

// The room state already has the shot (it is sent after the state patch), so the match on screen is ahead of the display
// copies, just as on one screen
function shotArrived(m) {
  playShot(m.shooter, m.aim, m.shot, m.result);
  if (document.hidden) game.match.next();
}
function choiceArrived(m) {
  if (!state.shot || m.turn !== shown.turn) return;
  if (m.timeUp) toast('Time’s up: the bullet nearest the cup counts.');
  else if (m.gone) toast(`Without ${state.players[state.shot.shooter].name}, the bullet nearest the cup counts.`);
  showChoice(m.k, m.result);
}
function timeUp(m) {
  if (m.turn !== shown.turn) return;
  turnTimedOut(m.seat, m.result);
  if (document.hidden) game.match.next();
}

// The server turned this player's shot down. It answers after the state patch, so the room state says whether the turn
// is still theirs; if it is not, the screen moves on with the room state.
function shotRejected(m) {
  if (state.phase !== 'flight' || state.shot) return; // not waiting for a shot of its own
  toast(SHOT_REJECTED[m.reason] || SHOT_REJECTED.other);
  const ms = game.match.state;
  if (ms.phase === 'turn' && ms.cur === game.online.seat) aimAgain();
}
