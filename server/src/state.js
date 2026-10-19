// Room state, synced to every client in the room.

import { schema, t } from '@colyseus/schema';

// A seat at the table. style picks the character look (colour and hat).
export const Seat = schema({
  sessionId: t.string(),
  name: t.string(),
  style: t.uint8(),
  connected: t.boolean().default(true)
}, 'Seat');

// phase: 'lobby' while players gather, 'playing' once the host has started
export const GolfState = schema({
  phase: t.string().default('lobby'),
  code: t.string(),
  host: t.string(), // sessionId of the host
  minPlayers: t.uint8().default(2), // players needed before the host can start
  seats: t.array(Seat)
}, 'GolfState');
