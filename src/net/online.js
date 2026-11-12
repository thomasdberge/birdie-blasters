// Talking to the game server: creating and joining private rooms, and rejoining one after a reload.

import { PROTOCOL_VERSION, REJECT, ROOM_NAME } from '../core/protocol.js';

export const GAME_SERVER_PORT = 2567;
// VITE_SERVER_URL when it is set (production). Otherwise the game server on the computer that served this page, so a
// phone on the same Wi-Fi that opened http://192.168.x.y:5173 reaches the development server on that computer too.
export function serverUrl() {
  return import.meta.env.VITE_SERVER_URL || `${location.protocol}//${location.hostname}:${GAME_SERVER_PORT}`;
}

let client = null;
// The browser SDK only loads when someone plays online
async function sdk() {
  if (!client) { const { Client } = await import('@colyseus/sdk'); client = new Client(serverUrl()); }
  return client;
}
export async function createRoom(name) { return (await sdk()).create(ROOM_NAME, { version: PROTOCOL_VERSION, name, mode: 'private' }); }
export async function joinRoom(code, name) { return (await sdk()).joinById(code, { version: PROTOCOL_VERSION, name }); }
// token: room.reconnectionToken from the earlier connection
export async function rejoinRoom(token) { return (await sdk()).reconnect(token); }

// What to tell the player when a request was turned down or the server could not be reached
export function explain(e) {
  const known = Object.values(REJECT).find(r => r.code === e?.code);
  if (known) return known.message;
  const message = String(e?.message || '');
  if (/not found/i.test(message)) return 'No room with that code. Check it and try again.';
  if (/locked|full/i.test(message)) return 'That room is full, or its game has already started.';
  if (!e?.code || /fetch|network|load failed/i.test(message)) {
    return import.meta.env.DEV ? `Can’t reach the game server at ${serverUrl()}. Is npm run dev:server running?` : 'Can’t reach the game server. Try again in a moment.';
  }
  return `Something went wrong: ${message}`;
}
