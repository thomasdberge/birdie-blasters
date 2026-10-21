// Room state, synced to every client in the room.

import { schema, t } from '@colyseus/schema';

// float64, so clients see exactly the numbers the server's match has (t.number() arrives as float32)
export const Point = schema({ x: t.float64().default(0), y: t.float64().default(0), z: t.float64().default(0) }, 'Point');
export const Wind = schema({ x: t.float64().default(0), z: t.float64().default(0), dir: t.float64().default(0), speed: t.float64().default(0) }, 'Wind');

// A seat at the table. style picks the character look (colour and hat). reconnectLeft: the milliseconds a player who lost
// the connection has left to come back, written when they drop and about once a second; 0 otherwise.
// The rest is the match's seat once the game has started: see writeMatch.
export const Seat = schema({
  sessionId: t.string(),
  name: t.string(),
  style: t.uint8(),
  reconnectLeft: t.uint32().default(0),
  connected: t.boolean().default(true),
  ball: t.ref(Point),
  stand: t.ref(Point),
  strokes: t.uint8().default(0),
  done: t.boolean().default(false),
  picked: t.boolean().default(false),
  out: t.boolean().default(false),
  scores: t.array('uint8') // one per hole, 0 while not played (a real score is at least 1)
}, 'Seat');

// Where the match stands (src/core/match.js): its phase, the hole, the turn count, whose turn it is (-1: nobody's), the
// wind. The shot clock is the room's: clock is what it times ('turn', 'choose' for a rifle choice, '' when it is
// stopped) and timeLeft the milliseconds left when it was last written, about once a second.
export const Match = schema({
  phase: t.string().default(''),
  hole: t.uint8().default(0),
  turn: t.uint32().default(0),
  cur: t.int8().default(-1),
  wind: t.ref(Wind),
  clock: t.string().default(''),
  timeLeft: t.uint32().default(0)
}, 'Match');

// phase: 'lobby' while players gather, 'playing' once the host has started
export const GolfState = schema({
  phase: t.string().default('lobby'),
  code: t.string(),
  host: t.string(), // sessionId of the host
  minPlayers: t.uint8().default(2), // players needed before the host can start
  seats: t.array(Seat),
  match: t.ref(Match)
}, 'GolfState');

// Copies a match's state into the room state; Colyseus then sends what changed to every client.
// Seats are in the same order in both. A seat that is out keeps its last stand; clients read it as nobody standing there.
export function writeMatch(room, ms) {
  const m = room.match;
  m.phase = ms.phase; m.hole = ms.hole; m.turn = ms.turn; m.cur = ms.cur;
  if (ms.wind) setFields(m.wind, ms.wind);
  ms.seats.forEach((s, i) => {
    const seat = room.seats[i];
    setFields(seat.ball, s.ball);
    if (s.stand) setFields(seat.stand, s.stand);
    seat.strokes = s.strokes; seat.done = s.done; seat.picked = s.picked; seat.out = s.out; seat.connected = s.connected;
    s.scores.forEach((v, k) => { seat.scores[k] = v ?? 0; });
  });
}
function setFields(target, from) { for (const k of Object.keys(from)) target[k] = from[k]; }
