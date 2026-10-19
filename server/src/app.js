// The game server's definition: one room type, private golf rooms found by their code.

import { defineRoom, defineServer } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_NAME } from '../../src/core/protocol.js';
import { GolfRoom } from './GolfRoom.js';

export const server = defineServer({
  transport: new WebSocketTransport(),
  rooms: { [ROOM_NAME]: defineRoom(GolfRoom) }
});
