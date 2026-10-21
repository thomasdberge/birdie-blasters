// Plays an online match on screen. The server runs the match and the room state says where it stands; the screen shows
// it through the same display copies as the one-screen game, and plays each shot when its result arrives.

import { labelFont } from '../platform.js';
import { remoteMatch } from '../net/remoteMatch.js';
import { playShot, showChoice } from './shot.js';
import { game, state, timers } from './state.js';
import { beginTurn, endHole, leaveGame, setPlayers, showHole } from './turns.js';
import { removeShotVisuals } from '../render/projectiles.js';
import { ui } from '../ui/elements.js';

let room = null, ready = false, shown = null;
// room: a joined room whose game has started
export async function playOnline(joined) {
  room = joined; ready = false; shown = { hole: -1, turn: -1, over: false };
  const live = () => ready && room === joined;
  game.match = remoteMatch(room, { shot: m => { if (live()) shotArrived(m); }, chosen: m => { if (live()) choiceArrived(m); } });
  game.online = { seat: [...room.state.seats].findIndex(s => s.sessionId === room.sessionId) };
  await labelFont();
  if (room !== joined) return; // the room was left while the font loaded
  setPlayers(game.match.state.seats);
  ready = true;
  room.onStateChange(() => { if (live()) follow(); });
  follow();
}
export function stopOnline() { room = null; ready = false; leaveGame(); }

// Browsers pause animation in a tab in the background, so such a tab cannot play a shot to the end. It says it has
// watched it at once, so the others do not wait for it; when it is opened again it skips to where the match is.
export function initOnline() {
  document.addEventListener('visibilitychange', () => { if (document.hidden && ready) game.match.next(); });
}

// The screen follows the room state: a new hole, a new turn, the end of a hole. The server only goes on once every
// screen has watched the last shot, or after waiting long enough; a screen still showing it then skips to its end.
function follow() {
  const ms = game.match.state;
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
function choiceArrived(m) { if (state.shot && m.turn === shown.turn) showChoice(m.k, m.result); }
