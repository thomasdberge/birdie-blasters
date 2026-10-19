// A golf room: private, found by its short code. Players gather in the lobby until the host starts the game.

import { randomInt } from 'node:crypto';
import { matchMaker, Room, ServerError } from '@colyseus/core';
import { MAX_SEATS } from '../../src/core/match.js';
import { cleanName, makeRoomCode, NAME_MAX, PROTOCOL_VERSION, REJECT } from '../../src/core/protocol.js';
import { GolfState, Seat } from './state.js';

// At most CREATE_LIMIT new rooms per IP address in any CREATE_WINDOW_MS
export const CREATE_LIMIT = 10, CREATE_WINDOW_MS = 10 * 60 * 1000;
const created = new Map(); // IP address -> times of its recent room creations
export function resetCreateLimits() { created.clear(); }
function allowCreate(ip, now = Date.now()) {
  if (!ip) return true;
  const recent = (created.get(ip) || []).filter(t => now - t < CREATE_WINDOW_MS);
  const ok = recent.length < CREATE_LIMIT;
  if (ok) recent.push(now);
  created.set(ip, recent);
  return ok;
}
// Behind a proxy that sets a trustworthy client IP header, name it in CLIENT_IP_HEADER (Fly-Client-IP on Fly.io).
// Otherwise Colyseus uses the first X-Forwarded-For entry, which a client can set itself.
function clientIp(context) {
  const header = process.env.CLIENT_IP_HEADER;
  return (header && context.headers.get(header)) || context.ip;
}
// 'create' always makes a room; 'joinOrCreate' does too, since private rooms are never joined that way
function createsRoom(context) {
  if (!context.req) return false;
  const method = new URL(context.req.url, 'http://localhost').pathname.split('/')[2];
  return method === 'create' || method === 'joinOrCreate';
}
// The name, or the name with a number if someone in the room already has it: "Ann", "Ann 2"
function uniqueName(base, taken) {
  const used = new Set(taken.map(n => n.toLowerCase()));
  let name = base;
  for (let k = 2; used.has(name.toLowerCase()); k++) {
    const tag = ` ${k}`;
    name = [...base].slice(0, NAME_MAX - tag.length).join('').trimEnd() + tag;
  }
  return name;
}
const reject = r => new ServerError(r.code, r.message);

export class GolfRoom extends Room {
  maxClients = MAX_SEATS;
  state = new GolfState();

  // Runs for every matchmaking request (create, join by code), before a room is made or a seat reserved
  static async onAuth(token, options, context) {
    if (options?.version !== PROTOCOL_VERSION) throw reject(REJECT.version);
    if (!cleanName(options.name)) throw reject(REJECT.name);
    if (createsRoom(context)) {
      if ((options.mode ?? 'private') !== 'private') throw reject(REJECT.mode); // quick match comes later as mode 'public'
      if (!allowCreate(clientIp(context))) throw reject(REJECT.tooManyRooms);
    }
    return true;
  }

  async onCreate() {
    this.roomId = await freeCode();
    this.state.code = this.roomId;
    await this.setPrivate(true); // only found by its code
    this.onMessage('start', client => this.start(client));
  }

  onJoin(client, options) {
    const seats = this.state.seats, styles = new Set(seats.map(s => s.style));
    let style = 0;
    while (styles.has(style)) style++;
    seats.push(new Seat({ sessionId: client.sessionId, name: uniqueName(cleanName(options.name), seats.map(s => s.name)), style }));
    if (!this.state.host) this.state.host = client.sessionId;
  }

  onLeave(client) {
    const seats = this.state.seats, i = seats.findIndex(s => s.sessionId === client.sessionId);
    if (i < 0) return;
    if (this.state.phase === 'lobby') seats.splice(i, 1);
    else seats[i].connected = false;
    if (this.state.host === client.sessionId) {
      const next = seats.find(s => s.connected);
      this.state.host = next ? next.sessionId : '';
    }
  }

  async start(client) {
    if (this.state.phase !== 'lobby' || client.sessionId !== this.state.host) return;
    this.state.phase = 'playing';
    await this.lock(); // nobody joins a game in progress
  }
}

// A room code no live room has
async function freeCode() {
  for (;;) {
    const code = makeRoomCode(randomInt);
    if (!(await matchMaker.getRoomById(code))) return code;
  }
}
