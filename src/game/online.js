// Plays an online match on screen. The server runs the match and the room state says where it stands; the screen shows
// it through the same display copies as the one-screen game.

import { labelFont } from '../platform.js';
import { remoteMatch } from '../net/remoteMatch.js';
import { game } from './state.js';
import { leaveGame, setPlayers, showHole } from './turns.js';

let room = null, shownHole = -1;
// room: a joined room whose game has started
export async function playOnline(joined) {
  room = joined; shownHole = -1;
  game.match = remoteMatch(room);
  game.online = { seat: [...room.state.seats].findIndex(s => s.sessionId === room.sessionId) };
  await labelFont();
  if (room !== joined) return; // the room was left while the font loaded
  setPlayers(game.match.state.seats);
  room.onStateChange(() => { if (room === joined) follow(); });
  follow();
}
export function stopOnline() { room = null; leaveGame(); }

// The screen follows the room state: a new hole is built and shown with its turn
function follow() {
  const ms = game.match.state;
  if (ms.hole !== shownHole) { shownHole = ms.hole; showHole(); }
}
