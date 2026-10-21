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
// The shot clock: seconds for a turn, and for picking the rifle bullet that counts
export const TURN_SECONDS = 30, CHOOSE_SECONDS = 15;
// Screens count down to 0 at the deadline, but the room still takes a shot or a rifle choice this many seconds after it.
// A screen's countdown runs behind the server's by a network delay and a shot needs another to arrive, so one sent while
// the screen still showed time left is not lost to latency. Screens let nothing be sent once they reach 0.
export const GRACE_SECONDS = 0.5;

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
  // Seconds; tests make them shorter
  replayMargin = REPLAY_MARGIN;
  turnSeconds = TURN_SECONDS;
  chooseSeconds = CHOOSE_SECONDS;
  graceSeconds = GRACE_SECONDS;

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

  // The current player fires; aim.turn is the turn they fired in. The match checks the aim and changes nothing when the
  // shot is not allowed (bad numbers, not your turn, a second shot); the room only says which seat sent it, and turns
  // down a shot meant for another turn. A refused shot is answered after the next state patch, so the shooter's screen
  // knows where the match stands when it hears why.
  shoot(client, aim) {
    if (!this.match) return;
    this.checkClock();
    const ms = this.match.state, seat = this.seatIndex(client), { weapon, yaw, pitch, power, turn } = aim ?? {};
    const r = turn === ms.turn ? this.match.shoot(seat, { weapon, yaw, pitch, power }) : { error: 'not your turn' };
    const late = Number.isInteger(turn) && turn === this.timedOut;
    if (r.error) { client.send('shotRejected', { reason: late ? 'time' : r.error }, { afterNextPatch: true }); return; }
    this.sync(r.shot.steps * STEP); // a rifle choice is timed from when the bullets have landed
    // Sent after the state patch, so a client's room state already has the shot when the result arrives
    this.broadcast('shotResult', { turn: ms.turn, shooter: seat, aim: { weapon, yaw, pitch, power }, shot: packShot(r.shot), result: r.result }, { afterNextPatch: true });
    this.watchFrom(ms.turn);
    if (ms.phase === 'settle') this.settled(r.shot.steps * STEP);
  }

  // The assault rifle's shooter picks the bullet that counts
  chooseBullet(client, msg) {
    if (!this.match) return;
    this.checkClock();
    const ms = this.match.state, k = msg?.k, r = this.match.chooseBullet(this.seatIndex(client), k);
    if (r.error) return;
    this.sync();
    this.broadcast('bulletChosen', { turn: ms.turn, k, result: r.result }, { afterNextPatch: true });
    this.settled(0);
  }

  // Copies the match into the room state, and starts the shot clock when a turn or a rifle choice begins (wait seconds
  // later); anything else stops it. Time runs out at the deadline on screen, and graceSeconds later in the room.
  sync(wait = 0) {
    const ms = this.match.state, of = ms.phase === 'turn' || ms.phase === 'choose' ? ms.phase : '', key = of && `${of} ${ms.turn}`;
    writeMatch(this.state, ms);
    if (key === (this.timer?.key ?? '')) return;
    this.timer?.expire.clear(); this.timer?.tick.clear();
    this.timer = null;
    Object.assign(this.state.match, { clock: of, timeLeft: 0 });
    if (!of) return;
    const deadline = Date.now() + (wait + (of === 'turn' ? this.turnSeconds : this.chooseSeconds)) * 1000;
    this.timer = { key, deadline, closes: deadline + this.graceSeconds * 1000, tick: this.clock.setInterval(() => this.writeTimeLeft(), 1000) };
    this.expireAt(this.timer.closes);
    this.writeTimeLeft();
  }
  // Clients count down from this to the deadline; writing it every second keeps a reloaded or lagging screen close
  writeTimeLeft() { this.state.match.timeLeft = Math.max(0, Math.round(this.timer.deadline - Date.now())); }
  // Time is up at the moment at. The room clock only ticks with each state patch, and its first tick also counts the
  // time from before a timeout was set, so the timeout can come a little early; then it waits on.
  expireAt(at) { this.timer.expire = this.clock.setTimeout(() => (Date.now() < at ? this.expireAt(at) : this.timeUp()), at - Date.now()); }
  // The timeout can also come a little late. Anything a player sends after the time is up is late however soon the
  // timeout would have come.
  checkClock() { if (this.timer && Date.now() >= this.timer.closes) this.timeUp(); }
  // The shot clock ran out: the turn passes with a penalty stroke, or the rifle bullet nearest the cup counts
  timeUp() {
    const ms = this.match.state, turn = ms.turn;
    if (ms.phase === 'turn') {
      const seat = ms.cur, r = this.match.timeout();
      this.timedOut = turn;
      this.sync();
      this.broadcast('timeUp', { turn, seat, result: r.result }, { afterNextPatch: true });
      this.watchFrom(turn);
      this.settled(0);
    } else if (ms.phase === 'choose') {
      const candidates = ms.choice.candidates.map(c => c.proj), r = this.match.timeout();
      this.sync();
      this.broadcast('bulletChosen', { turn, k: candidates.indexOf(r.proj), result: r.result, timeUp: true }, { afterNextPatch: true });
      this.settled(0);
    }
  }

  // Everyone in the room now is to watch what happened in this turn before the next one starts
  watchFrom(turn) { this.replay = { turn, waiting: new Set(this.clients.map(c => c.sessionId)), timer: null }; }
  // The turn has ended on screen (after seconds of flight still to watch). The next turn waits for everyone who saw it
  // happen to say they have watched it (replayDone), but no more than replayMargin seconds after that.
  settled(seconds) {
    if (!this.replay.waiting.size) { this.nextTurn(); return; }
    this.replay.timer = this.clock.setTimeout(() => this.nextTurn(), (seconds + this.replayMargin) * 1000);
  }
  // sessionId has watched the end of the turn, or is gone
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
    this.sync();
  }

  async start(client) {
    if (this.state.phase !== 'lobby' || client.sessionId !== this.state.host || this.state.seats.length < this.state.minPlayers) return;
    // Seats keep their lobby order, so seat i in the room is seat i in the match
    this.match = makeMatch(this.state.seats.map(s => s.name), Math.random);
    this.sync();
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
