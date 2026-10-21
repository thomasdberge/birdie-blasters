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

let room = null, ready = false, shown = null, clock = null;
// room: a joined room whose game has started
export async function playOnline(joined) {
  room = joined; ready = false; shown = { hole: -1, turn: -1, over: false }; clock = null;
  const live = () => ready && room === joined;
  game.match = remoteMatch(room, {
    shot: m => { if (live()) shotArrived(m); }, chosen: m => { if (live()) choiceArrived(m); },
    timeUp: m => { if (live()) timeUp(m); }, rejected: m => { if (live()) shotRejected(m); }
  });
  game.online = { seat: [...room.state.seats].findIndex(s => s.sessionId === room.sessionId) };
  await labelFont();
  if (room !== joined) return; // the room was left while the font loaded
  setPlayers(game.match.state.seats);
  ready = true;
  room.onStateChange(() => { if (live()) follow(); });
  follow();
}
export function stopOnline() { room = null; ready = false; clock = null; leaveGame(); }

// Milliseconds left on the shot clock as this screen counts it down, or null when there is nothing to show: the turn
// clock while the golf bag is open, aiming or watching, the rifle clock once the bullets have landed here
export function shotClockLeft() {
  if (!clock || !clock.of) return null;
  const showing = clock.of === 'turn' ? ['pick', 'aim', 'watch'].includes(state.phase) : state.phase === 'choose';
  return showing ? Math.max(0, clock.ends - performance.now()) : null;
}
// Whether this screen's countdown has reached 0
export function clockRanOut() { return !!clock?.of && performance.now() >= clock.ends; }
// Every frame online. This screen's countdown runs behind the server's by a network delay, and a shot takes another to
// arrive, so the server still takes a shot or a rifle choice half a second after its deadline. At 0 here, Fire goes off,
// a charge is dropped and the bullet buttons go, so nothing is sent that could come too late; the turn passes when the
// server says so.
export function stopAtZero() {
  if (!clockRanOut()) return;
  cancelCharge();
  if (!ui.fire.disabled) setControls(false);
  if (!ui.choose.hidden) ui.choose.hidden = true;
}

// Browsers pause animation in a tab in the background, so such a tab cannot play a shot to the end. It says it has
// watched it at once, so the others do not wait for it; when it is opened again it skips to where the match is.
export function initOnline() {
  document.addEventListener('visibilitychange', () => { if (document.hidden && ready) game.match.next(); });
}

// The screen follows the room state: a new hole, a new turn, the end of a hole. The server only goes on once every
// screen has watched the last shot, or after waiting long enough; a screen still showing it then skips to its end.
function follow() {
  const ms = game.match.state, c = game.match.clock;
  // The server writes the time left about once a second; every new value sets when this screen's countdown ends
  if (!clock || c.of !== clock.of || c.left !== clock.left) clock = { ...c, ends: performance.now() + c.left };
  if (ms.hole !== shown.hole) { shown = { hole: ms.hole, turn: ms.turn, over: false }; showHole(); }
  else if (ms.turn !== shown.turn) { shown.turn = ms.turn; skipShot(); beginTurn(); }
  else if (!shown.over && (ms.phase === 'between' || ms.phase === 'end')) { shown.over = true; skipShot(); endHole(); }
}
function skipShot() {
  timers.length = 0; state.waitFn = null; state.timeScale = 1; state.slowT = 0;
  removeShotVisuals(); state.shot = null; state.choice = null; ui.choose.hidden = true;
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
