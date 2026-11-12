// The game server's definition: one room type, private golf rooms found by their code, a health check, and which web
// pages may use it.

import { createEndpoint, createRouter, defineRoom, defineServer, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_NAME } from '../../src/core/protocol.js';
import { GolfRoom } from './GolfRoom.js';

// Which pages may use the server from a browser. In production: those in CLIENT_ORIGINS (comma-separated, e.g.
// https://birdieblasters.vercel.app) and any page on this computer. In development any page may, so a phone on the
// Wi-Fi reaches it. Requests without an Origin (not from a web page) need no permission.
export function originAllowed(origin) {
  if (process.env.NODE_ENV !== 'production') return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return (process.env.CLIENT_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean).includes(origin);
}
// Colyseus allows every origin by default: its defaults say "*", and its own getCorsHeaders echoes any Origin back
delete matchMaker.controller.DEFAULT_CORS_HEADERS['Access-Control-Allow-Origin'];
matchMaker.controller.getCorsHeaders = headers => {
  const origin = headers.get('origin');
  return origin && originAllowed(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };
};

// GET /health: the deployment's health check. It names this server process, so asking a few times shows whether more
// than one is answering, and counts the rooms and players, so you can see whether a deploy would end games.
const health = createEndpoint('/health', { method: 'GET' }, async () => Response.json({
  ok: true, process: matchMaker.processId, rooms: matchMaker.stats.local.roomCount, players: matchMaker.stats.local.ccu
}));

export const server = defineServer({
  transport: new WebSocketTransport(),
  rooms: { [ROOM_NAME]: defineRoom(GolfRoom) },
  routes: createRouter({ health })
});
