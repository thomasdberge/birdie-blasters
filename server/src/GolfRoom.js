// A golf room: private, found by its short code. Players gather in the lobby until the host starts the game; then the
// room runs the match (src/core/match.js), and the room state shows every client where it stands.

import { randomInt } from 'node:crypto';
import { matchMaker, Room, ServerError } from '@colyseus/core';
import { makeMatch, MAX_SEATS } from '../../src/core/match.js';
import { STEP } from '../../src/core/physics.js';
import { cleanAim, cleanName, makeRoomCode, NAME_MAX, packShot, PROTOCOL_VERSION, REJECT } from '../../src/core/protocol.js';
import { clearMatch, GolfState, Seat, writeMatch } from './state.js';

// How long a player who dropped out of a game in progress keeps their seat; after that they are out of the match
export const RECONNECT_SECONDS = 60;
// After a shot has landed, how long the next turn waits at most for a screen that is still showing it
export const REPLAY_MARGIN = 10;
// The shot clock: seconds for a turn, and for picking the rifle bullet that counts
export const TURN_SECONDS = 30, CHOOSE_SECONDS = 15;
// How long the scorecard stays up between holes before the next hole starts
export const BETWEEN_SECONDS = 10;
// Screens count down to 0 at the deadline, but the room still takes a shot or a rifle choice this many seconds after it.
// A screen's countdown runs behind the server's by a network delay and a shot needs another to arrive, so one sent while
// the screen still showed time left is not lost to latency. Screens let nothing be sent once they reach 0.
export const GRACE_SECONDS = 0.5;
// A client that sends more messages than this in a second is disconnected. A fair one sends at most 10 aims a second,
// a few other messages, and the up to 10 it kept while its connection was lost.
export const MAX_MESSAGES_PER_SECOND = 30;
// The clock for each match phase that has one: the room's setting with its length in seconds
const SECONDS = { turn: 'turnSeconds', choose: 'chooseSeconds', between: 'betweenSeconds' };

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
  maxMessagesPerSecond = MAX_MESSAGES_PER_SECOND;
  state = new GolfState();
  // Seconds; tests make them shorter
  replayMargin = REPLAY_MARGIN;
  turnSeconds = TURN_SECONDS;
  chooseSeconds = CHOOSE_SECONDS;
  betweenSeconds = BETWEEN_SECONDS;
  graceSeconds = GRACE_SECONDS;
  reconnectSeconds = RECONNECT_SECONDS;
  // sessionId -> { until, held } for a player who dropped out: when their seat is given up, and the seat Colyseus holds
  away = new Map();

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
    this.onMessage('playAgain', client => this.playAgain(client));
    this.onMessage('aim', (client, msg) => this.relayAim(client, msg));
    this.clock.setInterval(() => this.writeAway(), 1000);
  }

  onJoin(client, options) {
    const seats = this.state.seats, styles = new Set(seats.map(s => s.style));
    let style = 0;
    while (styles.has(style)) style++;
    seats.push(new Seat({ sessionId: client.sessionId, name: uniqueName(cleanName(options.name), seats.map(s => s.name)), style }));
    if (!this.state.host) this.state.host = client.sessionId;
  }

  // A connection lost during a game (a reload, a network drop) keeps the seat for reconnectSeconds; the same browser tab
  // can come back with its reconnection token. Meanwhile the match skips the player's turns, and one that was on passes
  // at once. When the time is up, onLeave makes them leave the match. In the lobby the seat is freed at once (onLeave).
  onDrop(client) {
    const i = this.seatIndex(client);
    if (this.state.phase !== 'playing' || i < 0) return;
    // Turned down when the room is closing, or when the host plays again; Colyseus then calls onLeave
    const held = this.allowReconnection(client, this.reconnectSeconds);
    held.catch(() => {});
    this.away.set(client.sessionId, { until: Date.now() + this.reconnectSeconds * 1000, held });
    this.writeAway();
    this.seatChange(() => this.match.setConnected(i, false));
    this.passHost(client.sessionId);
    this.watched(client.sessionId); // a shot is not waited for on a screen that is gone
  }

  onReconnect(client) {
    const i = this.seatIndex(client);
    if (i < 0) return;
    this.back(client.sessionId);
    this.seatChange(() => this.match.setConnected(i, true));
    if (!this.state.host) this.state.host = client.sessionId; // everyone else had dropped out too
  }

  // A player left on purpose (the Leave button), or did not come back in time after dropping out
  onLeave(client) {
    const seats = this.state.seats, i = this.seatIndex(client);
    if (i < 0) return;
    if (this.state.phase === 'lobby') seats.splice(i, 1);
    else { this.back(client.sessionId); this.seatChange(() => this.match.leave(i)); }
    this.passHost(client.sessionId);
    this.watched(client.sessionId);
  }

  // The client's seat; its index in the room is its seat in the match
  seatIndex(client) { return this.state.seats.findIndex(s => s.sessionId === client.sessionId); }
  // When the host drops out or leaves, the next player who is still connected becomes host
  passHost(sessionId) {
    if (this.state.host !== sessionId) return;
    const next = this.state.seats.find(s => s.connected && s.sessionId !== sessionId);
    this.state.host = next ? next.sessionId : '';
  }
  // Clients count down from reconnectLeft, as from the shot clock
  writeAway() {
    for (const s of this.state.seats) if (this.away.has(s.sessionId)) s.reconnectLeft = Math.max(0, Math.round(this.away.get(s.sessionId).until - Date.now()));
  }
  // A player who dropped out is back, or gone for good
  back(sessionId) {
    this.away.delete(sessionId);
    const seat = this.state.seats.find(s => s.sessionId === sessionId);
    if (seat) seat.reconnectLeft = 0;
  }
  // Tells the match that a seat dropped out, came back or left (act does). If that makes their rifle choice, everyone
  // learns which bullet counts, as when the time runs out.
  seatChange(act) {
    const ms = this.match.state, turn = ms.turn, candidates = ms.phase === 'choose' ? ms.choice.candidates.map(c => c.proj) : null;
    const r = act();
    this.sync();
    if (!candidates || !r.result) return;
    this.broadcast('bulletChosen', { turn, k: candidates.indexOf(r.proj), result: r.result, gone: true }, { afterNextPatch: true });
    this.settled();
  }

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
    const flight = r.shot.steps * STEP;
    this.sync(flight); // a rifle choice is timed from when the bullets have landed
    // Sent after the state patch, so a client's room state already has the shot when the result arrives
    this.broadcast('shotResult', { turn: ms.turn, shooter: seat, aim: { weapon, yaw, pitch, power }, shot: packShot(r.shot), result: r.result }, { afterNextPatch: true });
    this.watchFrom(ms.turn, flight);
    if (ms.phase === 'settle') this.settled();
  }

  // The shooter's live aim goes to everyone else, so they can watch the shooter turn. It only shows where they are aiming:
  // the match never sees it. Only from the player whose turn it is, during that turn, and only the clean numbers.
  relayAim(client, msg) {
    const ms = this.match?.state, aim = cleanAim(msg), seat = this.seatIndex(client);
    if (!ms || !aim || ms.phase !== 'turn' || seat !== ms.cur || msg.turn !== ms.turn) return;
    this.broadcast('aim', { turn: ms.turn, seat, ...aim }, { except: client });
  }

  // The assault rifle's shooter picks the bullet that counts
  chooseBullet(client, msg) {
    if (!this.match) return;
    this.checkClock();
    const ms = this.match.state, k = msg?.k, r = this.match.chooseBullet(this.seatIndex(client), k);
    if (r.error) return;
    this.sync();
    this.broadcast('bulletChosen', { turn: ms.turn, k, result: r.result }, { afterNextPatch: true });
    this.settled();
  }

  // Copies the match into the room state, and starts the clock when a turn, a rifle choice (wait seconds later) or the
  // scorecard between holes begins; anything else stops it. A turn or a choice runs out at the deadline on screen, and
  // graceSeconds later in the room; the next hole starts at the deadline.
  sync(wait = 0) {
    const ms = this.match.state, of = SECONDS[ms.phase] ? ms.phase : '', key = of && `${of} ${ms.turn}`;
    writeMatch(this.state, ms);
    if (key === (this.timer?.key ?? '')) return;
    this.timer?.expire.clear(); this.timer?.tick.clear();
    this.timer = null;
    Object.assign(this.state.match, { clock: of, timeLeft: 0 });
    if (!of) return;
    const deadline = Date.now() + (wait + this[SECONDS[of]]) * 1000, grace = of === 'between' ? 0 : this.graceSeconds;
    this.timer = { key, deadline, closes: deadline + grace * 1000, tick: this.clock.setInterval(() => this.writeTimeLeft(), 1000) };
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
  // The clock ran out: the turn passes with a penalty stroke, the rifle bullet nearest the cup counts, or the next hole
  // starts
  timeUp() {
    const ms = this.match.state, turn = ms.turn;
    if (ms.phase === 'between') {
      this.match.nextHole();
      this.sync();
    } else if (ms.phase === 'turn') {
      const seat = ms.cur, r = this.match.timeout();
      this.timedOut = turn;
      this.sync();
      this.broadcast('timeUp', { turn, seat, result: r.result }, { afterNextPatch: true });
      this.watchFrom(turn);
      this.settled();
    } else if (ms.phase === 'choose') {
      const candidates = ms.choice.candidates.map(c => c.proj), r = this.match.timeout();
      this.sync();
      this.broadcast('bulletChosen', { turn, k: candidates.indexOf(r.proj), result: r.result, timeUp: true }, { afterNextPatch: true });
      this.settled();
    }
  }

  // Everyone in the room now is to watch what happened in this turn (a shot with seconds of flight) before the next
  // one starts
  watchFrom(turn, flight = 0) { this.replay = { turn, lands: Date.now() + flight * 1000, waiting: new Set(this.clients.map(c => c.sessionId)), timer: null }; }
  // The turn has ended, though its shot may still be flying on screen. The next turn waits for everyone who saw it happen
  // to say they have watched it (replayDone), but no more than replayMargin seconds after it has landed.
  settled() {
    if (!this.replay.waiting.size) { this.nextTurn(); return; }
    this.replay.timer = this.clock.setTimeout(() => this.nextTurn(), Math.max(0, this.replay.lands - Date.now()) + this.replayMargin * 1000);
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

  // After the last hole the host takes everyone back to the lobby, with the same code. Only players who are still
  // connected keep their seat: one who is away loses it, as in the lobby, and a reconnection token of theirs is turned
  // down. The room opens again for new players, and the next start begins a new match.
  async playAgain(client) {
    if (this.match?.state.phase !== 'end' || client.sessionId !== this.state.host) return;
    for (const { held } of this.away.values()) held.reject(new ServerError(410, 'the game is over'));
    this.away.clear();
    this.match = null; this.replay = null; this.timedOut = undefined;
    clearMatch(this.state);
    this.state.phase = 'lobby';
    await this.unlock();
  }
}

// A room code no live room has
async function freeCode() {
  for (;;) {
    const code = makeRoomCode(randomInt);
    if (!(await matchMaker.getRoomById(code))) return code;
  }
}
