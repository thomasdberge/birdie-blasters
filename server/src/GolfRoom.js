// A golf room: private, found by its short code. Players gather in the lobby until the host starts the game; then the
// room runs the match (src/core/match.js), and the room state shows every client where it stands.

import { randomInt } from 'node:crypto';
import { matchMaker, Room, ServerError } from '@colyseus/core';
import { makeMatch, MAX_SEATS } from '../../src/core/match.js';
import { STEP } from '../../src/core/physics.js';
import { cleanName, makeRoomCode, NAME_MAX, packShot, PROTOCOL_VERSION, REJECT } from '../../src/core/protocol.js';
import { GolfState, Seat, writeMatch } from './state.js';

// How long a player who dropped out of a game in progress keeps their seat
export const RECONNECT_SECONDS = 60;
// After a shot has landed, how long the next turn waits at most for a screen that is still showing it
export const REPLAY_MARGIN = 10;

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
  replayMargin = REPLAY_MARGIN; // seconds; tests make it shorter

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
    // In development the host may start alone, which makes testing with one browser easy
    this.state.minPlayers = process.env.NODE_ENV === 'production' ? 2 : 1;
    await this.setPrivate(true); // only found by its code
    this.onMessage('start', client => this.start(client));
    this.onMessage('shoot', (client, aim) => this.shoot(client, aim));
    this.onMessage('chooseBullet', (client, msg) => this.chooseBullet(client, msg));
    this.onMessage('replayDone', (client, msg) => { if (msg?.turn === this.replay?.turn) this.watched(client.sessionId); });
  }

  onJoin(client, options) {
    const seats = this.state.seats, styles = new Set(seats.map(s => s.style));
    let style = 0;
    while (styles.has(style)) style++;
    seats.push(new Seat({ sessionId: client.sessionId, name: uniqueName(cleanName(options.name), seats.map(s => s.name)), style }));
    if (!this.state.host) this.state.host = client.sessionId;
  }

  // A connection lost during a game (a reload, a network drop) keeps the seat for a while; the same browser tab can come
  // back with its reconnection token. In the lobby the seat is freed at once (onLeave).
  onDrop(client) {
    const seat = this.seatOf(client);
    if (this.state.phase !== 'playing' || !seat) return;
    seat.connected = false;
    this.allowReconnection(client, RECONNECT_SECONDS);
    this.watched(client.sessionId); // a shot is not waited for on a screen that is gone
  }

  onReconnect(client) {
    const seat = this.seatOf(client);
    if (seat) seat.connected = true;
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
    this.watched(client.sessionId);
  }

  // The client's seat; its index in the room is its seat in the match
  seatIndex(client) { return this.state.seats.findIndex(s => s.sessionId === client.sessionId); }
  seatOf(client) { return this.state.seats[this.seatIndex(client)]; }

  // The current player fires. The match checks the aim and changes nothing when the shot is not allowed (not your turn,
  // bad numbers, a second shot); the room only says which seat sent it.
  shoot(client, aim) {
    if (!this.match) return;
    const { weapon, yaw, pitch, power } = aim ?? {}, ms = this.match.state, seat = this.seatIndex(client);
    const r = this.match.shoot(seat, { weapon, yaw, pitch, power });
    if (r.error) return;
    writeMatch(this.state, ms);
    // Sent after the state patch, so a client's room state already has the shot when the result arrives
    this.broadcast('shotResult', { turn: ms.turn, shooter: seat, aim: { weapon, yaw, pitch, power }, shot: packShot(r.shot), result: r.result }, { afterNextPatch: true });
    this.replay = { turn: ms.turn, waiting: new Set(this.clients.map(c => c.sessionId)), timer: null };
    if (ms.phase === 'settle') this.settled(r.shot.steps * STEP);
  }

  // The assault rifle's shooter picks the bullet that counts
  chooseBullet(client, msg) {
    if (!this.match) return;
    const ms = this.match.state, k = msg?.k, r = this.match.chooseBullet(this.seatIndex(client), k);
    if (r.error) return;
    writeMatch(this.state, ms);
    this.broadcast('bulletChosen', { turn: ms.turn, k, result: r.result }, { afterNextPatch: true });
    this.settled(0);
  }

  // The shot has landed (after seconds of flight still to watch). The next turn waits for everyone who got the shot to
  // say they have watched it (replayDone), but no more than replayMargin seconds after it lands.
  settled(seconds) {
    if (!this.replay.waiting.size) { this.nextTurn(); return; }
    this.replay.timer = this.clock.setTimeout(() => this.nextTurn(), (seconds + this.replayMargin) * 1000);
  }
  // sessionId has watched the shot, or is gone
  watched(sessionId) {
    if (!this.replay) return;
    this.replay.waiting.delete(sessionId);
    if (!this.replay.waiting.size && this.match.state.phase === 'settle') this.nextTurn();
  }
  nextTurn() {
    if (this.match.state.phase !== 'settle') return;
    this.replay?.timer?.clear();
    this.replay = null;
    this.match.next();
    writeMatch(this.state, this.match.state);
  }

  async start(client) {
    if (this.state.phase !== 'lobby' || client.sessionId !== this.state.host || this.state.seats.length < this.state.minPlayers) return;
    // Seats keep their lobby order, so seat i in the room is seat i in the match
    this.match = makeMatch(this.state.seats.map(s => s.name), Math.random);
    writeMatch(this.state, this.match.state);
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
