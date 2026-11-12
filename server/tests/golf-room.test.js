// The golf room through the real browser SDK: private rooms by code, the lobby, starting, turning requests down, the
// match in the room state, taking a seat back after a reload, shots and the shot clock, between holes and the end, and
// the shooter's live aim.
import { isDeepStrictEqual } from 'node:util';
import { Client } from '@colyseus/sdk';
import { boot } from '@colyseus/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { rng } from '../../src/core/math.js';
import { courseModel, makeMatch } from '../../src/core/match.js';
import { STEP } from '../../src/core/physics.js';
import { CODE_ALPHABET, PROTOCOL_VERSION, REJECT, ROOM_NAME, unpackShot } from '../../src/core/protocol.js';
import { WEAPONS, widx } from '../../src/core/weapons.js';
import { readMatch } from '../../src/net/remoteMatch.js';
import { server } from '../src/app.js';
import { CREATE_LIMIT, MAX_MESSAGES_PER_SECOND, resetCreateLimits } from '../src/GolfRoom.js';
import { writeMatch } from '../src/state.js';

let colyseus;
beforeAll(async () => { colyseus = await boot(server); });
afterAll(() => colyseus.shutdown());
beforeEach(async () => { await colyseus.cleanup(); resetCreateLimits(); });

const opts = (name, extra) => ({ version: PROTOCOL_VERSION, name, ...extra });
const create = (name, sdk = colyseus.sdk, extra) => sdk.create(ROOM_NAME, opts(name, extra));
const join = (code, name, sdk = colyseus.sdk) => sdk.joinById(code, opts(name));
// A browser whose requests come with these headers, e.g. from another IP address.
// boot() picks the test server's port itself, and it listens on IPv4.
const browser = headers => new Client(`http://127.0.0.1:${colyseus.server.port}`, { headers });
async function turnedDown(promise) {
  try { await promise; } catch (e) { return e; }
  throw new Error('expected the request to be turned down');
}
// Waits until a client's copy of the room state has arrived and passes the check
async function until(room, check) {
  for (let i = 0; i < 200; i++) {
    if (room.state && room.state.seats && check(room.state)) return room.state;
    await new Promise(r => setTimeout(r, 10));
  }
  throw new Error('room state did not sync: ' + JSON.stringify(room.state && room.state.toJSON()));
}
const seats = state => state.seats.map(s => ({ name: s.name, style: s.style, connected: s.connected }));

// Starts a game with these players; the first creates the room and is host
async function startGame(...names) {
  const rooms = [await create(names[0])];
  for (const name of names.slice(1)) rooms.push(await join(rooms[0].roomId, name));
  await until(rooms[0], s => s.seats.length === names.length);
  rooms[0].send('start');
  for (const room of rooms) await until(room, s => s.phase === 'playing');
  return rooms;
}
// The match the server runs for a room
const serverRoom = room => colyseus.getRoomById(room.roomId);
// What the room state mirrors of a match. Not the match's own bookkeeping (turn order, the hole's base wind, a pending
// rifle choice) and not style (the room picks the looks).
const mirrored = ms => ({
  phase: ms.phase, hole: ms.hole, turn: ms.turn, cur: ms.cur, wind: ms.wind,
  seats: ms.seats.map(s => ({ name: s.name, ball: s.ball, stand: s.stand, strokes: s.strokes, done: s.done, picked: s.picked, out: s.out, connected: s.connected, scores: s.scores }))
});
const shown = room => mirrored(readMatch(room.state));
// Waits until a client's copy of the match is the server's
async function inStep(room, ms) {
  for (let i = 0; i < 200 && !isDeepStrictEqual(shown(room), mirrored(ms)); i++) await new Promise(r => setTimeout(r, 10));
  expect(shown(room)).toEqual(mirrored(ms));
}
// A simple bot: the shortest weapon that reaches, aimed at the cup at its default angle, power by distance, in this turn
function botAim(ms) {
  const s = ms.seats[ms.cur], M = courseModel(ms.hole), d = Math.hypot(M.cup.x - s.ball.x, M.cup.z - s.ball.z);
  const weapon = ['dart', 'pistol', 'shotgun', 'auto', 'sniper', 'grenade', 'bazooka'].map(widx).find(i => WEAPONS[i].range >= d) ?? widx('bazooka');
  const W = WEAPONS[weapon];
  return { weapon, yaw: Math.atan2(M.cup.x - s.ball.x, M.cup.z - s.ball.z), pitch: W.pitchDef, power: Math.min(1, Math.max(0.05, d / W.range)), turn: ms.turn };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
// Every message of this type a client gets from now on
function received(room, type) { const got = []; room.onMessage(type, m => got.push(m)); return got; }
async function untilTrue(check, what, ms = 4000) {
  for (const end = Date.now() + ms; Date.now() < end; await wait(10)) if (check()) return;
  throw new Error('timed out waiting until ' + what);
}
// A page that is closed or reloaded: the connection drops without a goodbye, and nothing reconnects by itself
async function dropConnection(room) {
  room.reconnection.enabled = false;
  await room.leave(false);
}
// Ends the current turn as if its clock had run out, and has these screens watch it; resolves once the next turn is on
async function passTurn(room, screens) {
  const turn = room.match.state.turn;
  room.timeUp();
  for (const s of screens) s.send('replayDone', { turn });
  await untilTrue(() => room.match.state.turn > turn, `turn ${turn} passes`);
}
// Plays the room's match with the bot through the clients' messages until done(match state) says so. clients: one per
// seat; whoever's turn it is fires, the rifle's shooter picks the first bullet, and every screen still connected says it
// has watched each turn. Between holes it waits for the room to start the next one.
async function playUntil(room, clients, done) {
  const ms = room.match.state;
  for (let n = 0; !done(ms); n++) {
    if (n > 600) throw new Error('the game did not finish');
    const { phase, turn, hole } = ms;
    if (phase === 'turn') clients[ms.cur].send('shoot', botAim(ms));
    else if (phase === 'choose') clients[ms.choice.seat].send('chooseBullet', { k: 0 });
    else if (phase === 'settle') for (const c of clients) if (c.connection.isOpen) c.send('replayDone', { turn });
    await untilTrue(() => ms.phase !== phase || ms.turn !== turn || ms.hole !== hole || done(ms), `${phase} in turn ${turn} ends`, 15000);
  }
}
const scorecard = room => readMatch(room.state).seats.map(s => [s.name, s.scores]);

describe('private rooms', () => {
  test('creating a room gives a 5-character code, and the creator is host in seat 1', async () => {
    const ann = await create('Ann');
    expect(ann.roomId).toMatch(new RegExp(`^[${CODE_ALPHABET}]{5}$`));
    const state = await until(ann, s => s.seats.length === 1);
    expect(state.code).toBe(ann.roomId);
    expect(state.phase).toBe('lobby');
    expect(state.host).toBe(ann.sessionId);
    expect(seats(state)).toEqual([{ name: 'Ann', style: 0, connected: true }]);
  });

  test('every room gets its own code', async () => {
    const codes = [];
    for (let i = 0; i < 8; i++) codes.push((await create('Ann')).roomId);
    expect(new Set(codes).size).toBe(codes.length);
  });

  test('friends join with the code, and everyone sees everyone', async () => {
    const ann = await create('Ann');
    const ben = await join(ann.roomId, 'Ben');
    for (const room of [ann, ben]) {
      await until(room, s => s.seats.length === 2);
      expect(seats(room.state)).toEqual([{ name: 'Ann', style: 0, connected: true }, { name: 'Ben', style: 1, connected: true }]);
    }
  });

  test('a wrong code is turned down', async () => {
    await create('Ann');
    expect(await turnedDown(join('BCDFG', 'Ben'))).toBeInstanceOf(Error);
  });

  test('private rooms are never matched to a player who did not bring the code', async () => {
    await create('Ann');
    expect(await turnedDown(colyseus.sdk.join(ROOM_NAME, opts('Ben')))).toBeInstanceOf(Error);
  });

  test('only private rooms can be created for now', async () => {
    const e = await turnedDown(create('Ann', colyseus.sdk, { mode: 'public' }));
    expect([e.code, e.message]).toEqual([REJECT.mode.code, REJECT.mode.message]);
  });

  test('a room holds four players; a fifth is turned away', async () => {
    const ann = await create('Ann');
    for (const name of ['Ben', 'Cy', 'Dee']) await join(ann.roomId, name);
    await until(ann, s => s.seats.length === 4);
    expect(ann.state.seats.map(s => s.style)).toEqual([0, 1, 2, 3]);
    expect(await turnedDown(join(ann.roomId, 'Eve'))).toBeInstanceOf(Error);
  });
});

describe('the lobby', () => {
  test('only the host can start, and nobody can join after the start', async () => {
    const ann = await create('Ann'), ben = await join(ann.roomId, 'Ben');
    await until(ann, s => s.seats.length === 2);
    ben.send('start');
    await new Promise(r => setTimeout(r, 150));
    expect(ann.state.phase).toBe('lobby');
    ann.send('start');
    await until(ben, s => s.phase === 'playing');
    expect(await turnedDown(join(ann.roomId, 'Cy'))).toBeInstanceOf(Error);
  });

  test('in development the host can start alone', async () => {
    const ann = await create('Ann');
    await until(ann, s => s.seats.length === 1);
    expect(ann.state.minPlayers).toBe(1);
    ann.send('start');
    await until(ann, s => s.phase === 'playing');
  });

  test('in production the host needs at least one other player to start', async () => {
    process.env.NODE_ENV = 'production';
    let ann;
    try { ann = await create('Ann'); } finally { process.env.NODE_ENV = 'test'; }
    await until(ann, s => s.seats.length === 1);
    expect(ann.state.minPlayers).toBe(2);
    ann.send('start');
    await new Promise(r => setTimeout(r, 150));
    expect(ann.state.phase).toBe('lobby');
    await join(ann.roomId, 'Ben');
    await until(ann, s => s.seats.length === 2);
    ann.send('start');
    await until(ann, s => s.phase === 'playing');
  });

  test('when the host leaves the lobby, the next player becomes host and the seat is freed', async () => {
    const ann = await create('Ann'), ben = await join(ann.roomId, 'Ben');
    await until(ben, s => s.seats.length === 2);
    await ann.leave();
    await until(ben, s => s.seats.length === 1 && s.host === ben.sessionId);
    const cy = await join(ben.roomId, 'Cy'); // gets Ann's freed look
    await until(cy, s => s.seats.length === 2);
    expect(seats(cy.state)).toEqual([{ name: 'Ben', style: 1, connected: true }, { name: 'Cy', style: 0, connected: true }]);
  });

  test('a nickname someone in the room already has gets a number', async () => {
    const first = await create('Ann');
    await join(first.roomId, 'ann');
    await join(first.roomId, 'Abcdefghijklmnop');
    await join(first.roomId, 'abcdefghijklmnop');
    await until(first, s => s.seats.length === 4);
    expect(first.state.seats.map(s => s.name)).toEqual(['Ann', 'ann 2', 'Abcdefghijklmnop', 'abcdefghijklmn 2']);
  });

  test('nicknames are trimmed before they are shown', async () => {
    const ann = await create('  Ann   Lee ');
    await until(ann, s => s.seats.length === 1);
    expect(ann.state.seats[0].name).toBe('Ann Lee');
  });
});

describe('turning requests down', () => {
  test('an outdated client is told to reload, when creating and when joining', async () => {
    const ann = await create('Ann');
    for (const version of [PROTOCOL_VERSION - 1, PROTOCOL_VERSION + 1, undefined, String(PROTOCOL_VERSION)]) {
      for (const request of [colyseus.sdk.create(ROOM_NAME, { version, name: 'Ben' }), colyseus.sdk.joinById(ann.roomId, { version, name: 'Ben' })]) {
        const e = await turnedDown(request);
        expect([e.code, e.message]).toEqual([REJECT.version.code, 'New version available, please reload']);
      }
    }
  });

  test('a nickname that breaks the rules is turned down', async () => {
    const ann = await create('Ann');
    for (const name of ['', 'x'.repeat(17), '<b>Ben</b>', 'Ben 🎯', undefined]) {
      const e = await turnedDown(join(ann.roomId, name));
      expect([e.code, e.message]).toEqual([REJECT.name.code, REJECT.name.message]);
    }
  });

  test(`one IP address can create ${CREATE_LIMIT} rooms in ten minutes; others are not affected`, async () => {
    const home = browser({ 'x-forwarded-for': '203.0.113.7' }), other = browser({ 'x-forwarded-for': '198.51.100.2' });
    for (let i = 0; i < CREATE_LIMIT; i++) await create('Ann', home);
    const e = await turnedDown(create('Ann', home));
    expect([e.code, e.message]).toEqual([REJECT.tooManyRooms.code, REJECT.tooManyRooms.message]);
    expect(await turnedDown(home.joinOrCreate(ROOM_NAME, opts('Ann')))).toMatchObject({ code: REJECT.tooManyRooms.code });
    await create('Ben', other);
    // joining someone else's room is not limited
    const room = await create('Cy');
    await join(room.roomId, 'Ann', home);
  });

  test('behind a trusted proxy, a forged X-Forwarded-For does not get around the limit', async () => {
    process.env.CLIENT_IP_HEADER = 'x-proxy-client-ip';
    try {
      for (let i = 0; i <= CREATE_LIMIT; i++) {
        const forged = browser({ 'x-proxy-client-ip': '203.0.113.7', 'x-forwarded-for': `10.0.0.${i}` });
        const request = create('Ann', forged);
        if (i < CREATE_LIMIT) await request;
        else expect((await turnedDown(request)).code).toBe(REJECT.tooManyRooms.code);
      }
    } finally { delete process.env.CLIENT_IP_HEADER; }
  });
});

describe('the server', () => {
  const url = path => `http://127.0.0.1:${colyseus.server.port}${path}`;
  const health = async () => (await fetch(url('/health'))).json();
  // The origin a browser is told may create a room, when it asks first (a CORS preflight)
  async function allowedFor(origin) {
    const res = await fetch(url(`/matchmake/create/${ROOM_NAME}`), { method: 'OPTIONS', headers: { origin } });
    return res.headers.get('access-control-allow-origin') ?? undefined;
  }

  test('the health check names the server process and counts its rooms and players', async () => {
    const before = await health();
    expect(before).toEqual({ ok: true, process: expect.any(String), rooms: expect.any(Number), players: expect.any(Number) });
    const ann = await create('Ann');
    await join(ann.roomId, 'Ben');
    expect(await health()).toEqual({ ...before, rooms: before.rooms + 1, players: before.players + 2 });
  });

  test('in production only the pages in CLIENT_ORIGINS and pages on this computer may use the server', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CLIENT_ORIGINS = 'https://birdie.example, https://preview.example/';
    try {
      for (const origin of ['https://birdie.example', 'https://preview.example', 'http://localhost:5173', 'http://127.0.0.1:4173'])
        expect(await allowedFor(origin)).toBe(origin);
      for (const origin of ['https://evil.example', 'http://birdie.example', 'https://birdie.example.evil.example', 'http://localhost.evil.example', 'null'])
        expect(await allowedFor(origin)).toBeUndefined();
    } finally { process.env.NODE_ENV = 'test'; delete process.env.CLIENT_ORIGINS; }
  });

  test('in development any page may, so a phone on the Wi-Fi reaches it', async () => {
    expect(await allowedFor('http://192.168.0.11:5173')).toBe('http://192.168.0.11:5173');
  });
});

describe('the match', () => {
  test('starting deals the first hole: every client sees the same hole, wind and positions as the server', async () => {
    const rooms = await startGame('Ann', 'Ben', 'Cy');
    const ms = serverRoom(rooms[0]).match.state;
    expect([ms.phase, ms.hole, ms.turn, ms.cur]).toEqual(['turn', 0, 1, 0]);
    expect(ms.seats.map(s => s.name)).toEqual(['Ann', 'Ben', 'Cy']); // lobby order
    const M = courseModel(0);
    expect(ms.seats.every(s => isDeepStrictEqual(s.ball, { x: M.tee.x, y: M.tee.y, z: M.tee.z }))).toBe(true);
    for (const room of rooms) await inStep(room, ms);
    // Characters keep the look they had in the lobby
    expect(readMatch(rooms[1].state).seats.map(s => [s.name, s.style])).toEqual([['Ann', 0], ['Ben', 1], ['Cy', 2]]);
  });

  test('as the match plays out, the room state keeps every client in step with the server', async () => {
    const rooms = await startGame('Ann', 'Ben', 'Cy');
    const room = serverRoom(rooms[0]), match = room.match, phases = new Set();
    // Shots are not sent by clients yet, so the test plays the server's match itself: a bot, a timed-out turn now and
    // then, and a player who leaves halfway
    for (let n = 0; match.state.phase !== 'end'; n++) {
      if (n > 400) throw new Error('the game did not finish');
      const ms = match.state;
      if (ms.phase === 'between') match.nextHole();
      else if (ms.phase === 'settle') match.next();
      else if (ms.phase === 'choose') match.chooseBullet(ms.choice.seat, 0);
      else if (n % 7 === 6) match.timeout();
      else match.shoot(ms.cur, botAim(ms));
      if (n === 30) match.leave(1);
      phases.add(ms.phase);
      writeMatch(room.state, ms); room.broadcastPatch();
      for (const r of rooms) await inStep(r, ms);
    }
    expect([...phases]).toEqual(expect.arrayContaining(['turn', 'settle', 'between', 'end']));
    const final = readMatch(rooms[2].state);
    expect(final.seats[1].out).toBe(true);
    expect(final.seats[1].stand).toBe(null);
    expect(final.seats.map(s => s.scores)).toEqual(match.state.seats.map(s => s.scores));
  }, 30000); // a whole three-hole game
});

describe('dropping out', () => {
  test('a reloaded page takes its seat back with its reconnection token and sees the same match', async () => {
    const [ann, ben] = await startGame('Ann', 'Ben');
    const token = ben.reconnectionToken;
    await dropConnection(ben);
    await until(ann, s => s.seats[1].connected === false);
    const back = await colyseus.sdk.reconnect(token);
    expect(back.sessionId).toBe(ben.sessionId);
    await until(ann, s => s.seats[1].connected === true);
    await inStep(back, serverRoom(ann).match.state);
    expect(readMatch(back.state)).toEqual(readMatch(ann.state));
  });

  test('in the lobby a dropped player loses the seat at once, and cannot take it back', async () => {
    const ann = await create('Ann'), ben = await join(ann.roomId, 'Ben');
    await until(ann, s => s.seats.length === 2);
    const token = ben.reconnectionToken;
    await dropConnection(ben);
    await until(ann, s => s.seats.length === 1);
    expect(await turnedDown(colyseus.sdk.reconnect(token))).toBeInstanceOf(Error);
  });

  test('dropping out on your own turn passes it at once, without a penalty; the others see how long you have to come back', async () => {
    const [ann, ben] = await startGame('Ann', 'Ben');
    await dropConnection(ann);
    const s = await until(ben, st => st.match.turn === 2);
    expect(readMatch(ben.state)).toMatchObject({ phase: 'turn', cur: 1 });
    expect([s.match.clock, s.seats[0].connected, s.seats[0].strokes, s.host]).toEqual(['turn', false, 0, ben.sessionId]);
    const first = s.seats[0].reconnectLeft;
    expect(first).toBeGreaterThan(58000);
    expect(first).toBeLessThanOrEqual(60000);
    await untilTrue(() => ben.state.seats[0].reconnectLeft < first, 'the time left is written again', 1500);
    expect(first - ben.state.seats[0].reconnectLeft).toBeGreaterThan(500);
    expect(first - ben.state.seats[0].reconnectLeft).toBeLessThan(1500);
    await inStep(ben, serverRoom(ben).match.state);
  });

  test('a player who drops out during someone else\'s turn is skipped until they come back, with their strokes intact', async () => {
    const [ann, ben, cy] = await startGame('Ann', 'Ben', 'Cy'), room = serverRoom(ann);
    room.reconnectSeconds = 2;
    await passTurn(room, [ann, ben, cy]); // Ann's
    await passTurn(room, [ann, ben, cy]); // Ben's: he has a penalty stroke now
    const token = ben.reconnectionToken;
    await dropConnection(ben); // during Cy's turn, which goes on
    await until(ann, s => !s.seats[1].connected && s.seats[1].reconnectLeft > 0);
    expect(room.match.state).toMatchObject({ turn: 3, cur: 2 });
    await passTurn(room, [ann, cy]); // Cy's
    await passTurn(room, [ann, cy]); // Ann's, and Ben is skipped
    expect(room.match.state).toMatchObject({ turn: 5, cur: 2 });
    await wait(1000); // half his time to come back
    const back = await colyseus.sdk.reconnect(token);
    const s = await until(ann, st => st.seats[1].connected);
    expect([s.seats[1].reconnectLeft, s.seats[1].strokes]).toEqual([0, 1]);
    await passTurn(room, [ann, back, cy]); // Cy's
    await passTurn(room, [ann, back, cy]); // Ann's, and Ben is next again
    expect(room.match.state).toMatchObject({ turn: 7, cur: 1 });
    await inStep(back, room.match.state);
  });

  test('a player who does not come back in time is out of the match: no seat, no more turns', async () => {
    const [ann, ben] = await startGame('Ann', 'Ben'), room = serverRoom(ann);
    room.reconnectSeconds = 1;
    const token = ben.reconnectionToken, t0 = Date.now();
    await dropConnection(ben);
    await until(ann, s => s.seats[1].out);
    expect((Date.now() - t0) / 1000).toBeGreaterThan(0.9);
    expect(readMatch(ann.state).seats[1]).toMatchObject({ out: true, connected: false, stand: null });
    expect(ann.state.seats[1].reconnectLeft).toBe(0);
    expect(await turnedDown(colyseus.sdk.reconnect(token))).toBeInstanceOf(Error);
    await passTurn(room, [ann]);
    expect(room.match.state.cur).toBe(0); // Ann's turns follow each other
    await inStep(ann, room.match.state);
  });

  test('leaving on purpose puts you out at once; your turn passes and the next player is host', async () => {
    const [ann, ben, cy] = await startGame('Ann', 'Ben', 'Cy');
    await ann.leave();
    const s = await until(ben, st => st.seats[0].out);
    expect(readMatch(ben.state)).toMatchObject({ phase: 'turn', cur: 1, turn: 2 });
    expect([s.host, s.seats[0].connected, s.seats[0].strokes, s.seats[0].reconnectLeft]).toEqual([ben.sessionId, false, 0, 0]);
    await inStep(cy, serverRoom(ben).match.state);
  });

  test('dropping out while picking the rifle bullet takes the one nearest the cup, and everyone learns which', async () => {
    const [ann, ben] = await startGame('Ann', 'Ben');
    const shots = received(ben, 'shotResult'), chosen = received(ben, 'bulletChosen'), M = courseModel(0);
    ann.send('shoot', { weapon: widx('auto'), yaw: Math.atan2(M.cup.x - M.tee.x, M.cup.z - M.tee.z), pitch: 10, power: 0.4, turn: 1 });
    await untilTrue(() => shots.length === 1, 'the shot arrives');
    const shot = unpackShot(shots[0].shot), candidates = shot.outcome.candidates;
    const toCup = k => { const r = shot.projs[candidates[k]].rest; return Math.hypot(r.x - M.cup.x, r.z - M.cup.z); };
    const nearest = candidates.map((_, k) => k).reduce((a, b) => (toCup(b) < toCup(a) ? b : a));
    await dropConnection(ann);
    await untilTrue(() => chosen.length === 1, 'the choice is made for Ann');
    expect(chosen[0]).toEqual({ turn: 1, k: nearest, result: { type: 'rest', strokes: 1, done: false, picked: false }, gone: true });
    expect(readMatch(ben.state).seats[0].ball).toEqual(shot.projs[candidates[nearest]].rest);
    ben.send('replayDone', { turn: 1 });
    await until(ben, s => s.match.turn === 2 && s.match.cur === 1 && s.match.clock === 'turn');
  });

  test('when everyone still playing the hole is away, the match waits; the first one back is host and plays on', async () => {
    const [ann, ben] = await startGame('Ann', 'Ben'), room = serverRoom(ann);
    room.reconnectSeconds = 30;
    const token = ann.reconnectionToken;
    await dropConnection(ann);
    await until(ben, s => s.match.cur === 1);
    await dropConnection(ben);
    await untilTrue(() => room.match.state.phase === 'waiting', 'the match waits');
    expect([room.state.match.clock, room.state.host]).toEqual(['', '']);
    const back = await colyseus.sdk.reconnect(token);
    const s = await until(back, st => st.match.phase === 'turn' && st.match.cur === 0);
    expect([s.match.clock, s.host]).toEqual(['turn', back.sessionId]);
    await inStep(back, room.match.state);
  });

  test('the room closes once nobody is left, not while a seat is still held for someone', async () => {
    const [ann, ben] = await startGame('Ann', 'Ben'), code = ann.roomId;
    serverRoom(ann).reconnectSeconds = 1;
    await dropConnection(ann);
    await until(ben, s => !s.seats[0].connected);
    await ben.leave();
    await wait(300);
    expect(colyseus.getRoomById(code)).toBeDefined(); // Ann may still come back
    await untilTrue(() => !colyseus.getRoomById(code), 'the room closes', 3000);
  });
});

describe('shots', () => {
  // A dart pointed steeply down lands at once, and darts have no random spread
  const dartDown = { weapon: widx('dart'), yaw: 0, pitch: -60, power: 0.1 };
  const towardCup = M => Math.atan2(M.cup.x - M.tee.x, M.cup.z - M.tee.z);

  test('bad shots are turned down with the reason, to the shooter alone, and change nothing; so is a second shot', async () => {
    const [ann, ben] = await startGame('Ann', 'Ben');
    const room = serverRoom(ann), before = JSON.stringify(room.match.state), got = [received(ann, 'shotResult'), received(ben, 'shotResult')];
    const refused = { ann: received(ann, 'shotRejected'), ben: received(ben, 'shotRejected') };
    const good = botAim(room.match.state);
    ben.send('shoot', good); // not his turn
    const bad = [[{ ...good, yaw: NaN }, 'bad aim'], [{ ...good, pitch: 'up' }, 'bad aim'], [{ ...good, power: 5 }, 'bad power'],
      [{ ...good, power: 0.01 }, 'bad power'], [{ ...good, weapon: 9 }, 'bad weapon'], [{ ...good, weapon: 1.5 }, 'bad weapon'],
      [{ ...good, weapon: -1 }, 'bad weapon'], [{ turn: good.turn }, 'bad weapon'], [{ ...good, turn: good.turn + 1 }, 'not your turn'],
      [{ ...good, turn: undefined }, 'not your turn'], [null, 'not your turn'], ['fire', 'not your turn'], [[1, 2, 3], 'not your turn']];
    for (const [aim] of bad) ann.send('shoot', aim);
    await untilTrue(() => refused.ann.length === bad.length && refused.ben.length === 1, 'every bad shot is answered');
    expect(refused.ann.map(m => m.reason)).toEqual(bad.map(([, reason]) => reason));
    expect(refused.ben).toEqual([{ reason: 'not your turn' }]);
    expect(JSON.stringify(room.match.state)).toBe(before);
    expect(got.flat()).toEqual([]);
    expect(ann.connection.isOpen && ben.connection.isOpen).toBe(true); // turned down, not thrown out
    ann.send('shoot', good); ann.send('shoot', good);
    await untilTrue(() => got.every(g => g.length === 1) && refused.ann.length === bad.length + 1, 'the shot reaches both and the second is refused');
    await wait(200);
    expect(got.map(g => g.length)).toEqual([1, 1]);
    expect(refused.ann.at(-1)).toEqual({ reason: 'not your turn' });
    expect(refused.ben.length).toBe(1);
    expect(room.match.state.seats[0].strokes).toBe(1);
  });

  test('a shot reaches every client as the server decided it, and the next turn waits until both have watched it', async () => {
    const [ann, ben] = await startGame('Ann', 'Ben');
    const room = serverRoom(ann), got = [received(ann, 'shotResult'), received(ben, 'shotResult')], strokesThen = [];
    ben.onMessage('shotResult', () => strokesThen.push(readMatch(ben.state).seats[0].strokes));
    // A little wide of the cup: aimed straight at it, the grenade goes in about one time in fifteen
    const bot = botAim(room.match.state), aim = { ...bot, yaw: bot.yaw + 0.1 };
    ann.send('shoot', aim);
    await untilTrue(() => got.every(g => g.length === 1), 'the shot reaches both');
    const [a, b] = got.map(g => g[0]), ms = room.match.state, shot = unpackShot(a.shot);
    expect(b).toEqual(a);
    expect([a.turn, a.shooter, a.aim]).toEqual([1, 0, { weapon: aim.weapon, yaw: aim.yaw, pitch: aim.pitch, power: aim.power }]);
    expect(a.result).toEqual({ type: 'rest', strokes: 1, done: false, picked: false });
    expect(shot.projs[shot.outcome.proj].rest).toEqual(ms.seats[0].ball);
    expect(strokesThen).toEqual([1]); // the room state had the shot before its result arrived
    const p = shot.projs[0];
    expect(p.path.length % 3).toBe(0);
    expect(Array.from(p.path.subarray(0, 3))).toEqual([p.launch.x, p.launch.y, p.launch.z].map(Math.fround));
    expect(shot.events.at(-1).type).toBe('end');
    // The next turn waits for both screens
    ann.send('replayDone', { turn: 1 });
    ben.send('replayDone', { turn: 7 }); // some other turn
    await wait(200);
    expect(ms.phase).toBe('settle');
    ben.send('replayDone', { turn: 1 });
    for (const r of [ann, ben]) await until(r, s => s.match.turn === 2);
    expect([readMatch(ben.state).phase, readMatch(ben.state).cur]).toEqual(['turn', 1]);
  });

  test('a screen that never finishes watching holds the next turn up only until the shot has landed plus the margin', async () => {
    const [ann] = await startGame('Ann', 'Ben');
    const room = serverRoom(ann), got = received(ann, 'shotResult');
    room.replayMargin = 0.5;
    ann.send('shoot', { ...dartDown, turn: 1 });
    await untilTrue(() => got.length === 1, 'the shot arrives');
    const t0 = Date.now(), flight = unpackShot(got[0].shot).steps * STEP;
    ann.send('replayDone', { turn: 1 }); // Ben never does
    await untilTrue(() => ann.state.match.turn === 2, 'the next turn starts');
    const waited = (Date.now() - t0) / 1000;
    expect(waited).toBeGreaterThan(flight + 0.5 - 0.15);
    expect(waited).toBeLessThan(flight + 0.5 + 1);
  });

  test('a player who drops out is not waited for', async () => {
    const [ann, ben] = await startGame('Ann', 'Ben');
    const room = serverRoom(ann), got = received(ann, 'shotResult');
    ann.send('shoot', { ...dartDown, turn: 1 });
    await untilTrue(() => got.length === 1, 'the shot arrives');
    ann.send('replayDone', { turn: 1 });
    await wait(150);
    expect(room.match.state.phase).toBe('settle');
    await dropConnection(ben);
    await untilTrue(() => ann.state.match.turn === 2, 'the next turn starts', 1500); // long before the 10-second margin
  });

  test('assault rifle: only the shooter picks the bullet that counts, and every client learns which', async () => {
    const [ann, ben] = await startGame('Ann', 'Ben');
    const room = serverRoom(ann), ms = room.match.state, shots = received(ben, 'shotResult');
    const chosen = [received(ann, 'bulletChosen'), received(ben, 'bulletChosen')];
    ann.send('shoot', { weapon: widx('auto'), yaw: towardCup(courseModel(0)), pitch: 10, power: 0.4, turn: 1 });
    await untilTrue(() => shots.length === 1, 'the shot arrives');
    const shot = unpackShot(shots[0].shot);
    expect([shot.outcome.type, shot.outcome.candidates.length, shots[0].result]).toEqual(['choose', 3, null]);
    // Screens that have watched the bullets land say so before the choice; that counts
    ann.send('replayDone', { turn: 1 }); ben.send('replayDone', { turn: 1 });
    const before = JSON.stringify(ms);
    ben.send('chooseBullet', { k: 1 }); // not his shot
    for (const k of [3, -1, 1.5, 'one', undefined]) ann.send('chooseBullet', { k });
    ann.send('chooseBullet', null);
    await wait(200);
    expect(JSON.stringify(ms)).toBe(before);
    expect(chosen.flat()).toEqual([]);
    ann.send('chooseBullet', { k: 2 });
    await untilTrue(() => chosen.every(c => c.length === 1), 'the choice reaches both');
    expect(chosen[1][0]).toEqual({ turn: 1, k: 2, result: { type: 'rest', strokes: 1, done: false, picked: false } });
    expect(readMatch(ben.state).seats[0].ball).toEqual(shot.projs[shot.outcome.candidates[2]].rest);
    for (const r of [ann, ben]) await until(r, s => s.match.turn === 2);
  });

  test('a hit moves the other player for every client', async () => {
    const [ann, ben] = await startGame('Ann', 'Ben');
    const room = serverRoom(ann), ms = room.match.state, M = courseModel(0), got = [received(ann, 'shotResult'), received(ben, 'shotResult')];
    // Ben stands 15 m ahead of Ann, who aims a flat sniper shot at his head
    const yaw = towardCup(M), x = M.tee.x + Math.sin(yaw) * 15, z = M.tee.z + Math.cos(yaw) * 15;
    ms.seats[1].ball = { x, y: M.height(x, z), z }; ms.seats[1].stand = { ...ms.seats[1].ball };
    writeMatch(room.state, ms);
    await until(ben, s => s.seats[1].ball.x === x);
    ann.send('shoot', { weapon: widx('sniper'), yaw, pitch: 0, power: 0.5, turn: 1 });
    await untilTrue(() => got.every(g => g.length === 1), 'the shot reaches both');
    const hit = unpackShot(got[1][0].shot).events.find(e => e.type === 'hit');
    expect([hit.player, hit.kind, hit.to]).toEqual([1, 'head', { x: M.tee.x, y: M.tee.y, z: M.tee.z }]);
    for (const r of [ann, ben]) expect(readMatch(r.state).seats[1].ball).toEqual(hit.to);
  });

  test('before the game starts, shot messages are ignored', async () => {
    const ann = await create('Ann');
    await until(ann, s => s.seats.length === 1);
    ann.send('shoot', { weapon: 0, yaw: 0, pitch: 10, power: 0.5 }); ann.send('chooseBullet', { k: 0 }); ann.send('replayDone', { turn: 1 });
    await wait(150);
    expect([ann.connection.isOpen, ann.state.phase]).toEqual([true, 'lobby']);
  });
});

describe('shot clock', () => {
  // A game whose room has its clocks shortened before the start
  async function timedGame(turnSeconds, chooseSeconds = 15) {
    const ann = await create('Ann'), ben = await join(ann.roomId, 'Ben'), room = serverRoom(ann);
    Object.assign(room, { turnSeconds, chooseSeconds });
    await until(ann, s => s.seats.length === 2);
    ann.send('start');
    for (const r of [ann, ben]) await until(r, s => s.phase === 'playing' && s.match.clock === 'turn');
    return { ann, ben, room };
  }
  const watchBoth = (ann, ben, turn) => { ann.send('replayDone', { turn }); ben.send('replayDone', { turn }); };

  test('the clock starts with every turn, counts down in the room state, and stops when the shot is fired', async () => {
    const { ann, ben, room } = await timedGame(3);
    expect(ann.state.match.timeLeft).toBeGreaterThan(2700);
    expect(ann.state.match.timeLeft).toBeLessThanOrEqual(3000);
    const first = ann.state.match.timeLeft;
    await untilTrue(() => ann.state.match.timeLeft < first, 'the time left is written again', 1500);
    expect(first - ann.state.match.timeLeft).toBeGreaterThan(800);
    expect(first - ann.state.match.timeLeft).toBeLessThan(1300);
    ann.send('shoot', botAim(room.match.state));
    await untilTrue(() => ann.state.match.phase === 'settle', 'the shot is in');
    expect([ann.state.match.clock, ann.state.match.timeLeft]).toEqual(['', 0]);
    watchBoth(ann, ben, 1);
    await until(ben, s => s.match.turn === 2 && s.match.clock === 'turn' && s.match.timeLeft > 2700); // Ben's turn has the full time again
  });

  test('when no shot comes in time, the turn passes with a penalty stroke and everyone is told', async () => {
    const { ann, ben, room } = await timedGame(0.6);
    const told = [received(ann, 'timeUp'), received(ben, 'timeUp')], { deadline, closes } = room.timer, timeUp = room.timeUp, at = [];
    room.timeUp = function () { at.push(Date.now()); return timeUp.call(this); };
    expect(closes - deadline).toBe(500); // the half second of grace after the deadline the screens count down to
    await untilTrue(() => told.every(t => t.length === 1), 'both hear the time is up');
    expect(at[0]).toBeGreaterThanOrEqual(closes); // never early, though the room clock's first tick may count too much
    expect(told[1][0]).toEqual({ turn: 1, seat: 0, result: { type: 'timeout', strokes: 1, done: false, picked: false } });
    expect([readMatch(ben.state).phase, readMatch(ben.state).seats[0].strokes, ben.state.match.clock]).toEqual(['settle', 1, '']);
    expect(room.match.state.seats[0].ball).toEqual(readMatch(ben.state).seats[0].ball); // still on the tee
    watchBoth(ann, ben, 1);
    await until(ann, s => s.match.turn === 2 && s.match.cur === 1);
  });

  test('a shot up to half a second after the deadline counts; one after that is turned down as too late, and the turn passes', async () => {
    const { ann, ben, room } = await timedGame(1.5);
    const shots = received(ben, 'shotResult'), refused = received(ben, 'shotRejected'), told = received(ann, 'timeUp');
    await wait(room.timer.deadline - Date.now() + 400);
    // A screen counts down to the deadline a network delay after the server does, and the shot takes as long again
    expect(ann.state.match.phase).toBe('turn');
    ann.send('shoot', botAim(room.match.state));
    await untilTrue(() => shots.length === 1, 'the shot counts');
    expect(told).toEqual([]);
    watchBoth(ann, ben, 1);
    await until(ben, s => s.match.turn === 2 && s.match.clock === 'turn');
    const aim = botAim(room.match.state);
    await wait(room.timer.closes - Date.now() + 100);
    ben.send('shoot', aim); // 0.1 s after the grace
    await untilTrue(() => refused.length === 1 && told.length === 1, 'the late shot is refused and the turn passes');
    expect(refused[0]).toEqual({ reason: 'time' });
    expect(told[0]).toMatchObject({ turn: 2, seat: 1, result: { type: 'timeout', strokes: 1 } });
    expect(shots.length).toBe(1);
  });

  test('assault rifle: when the choice is not made in time, the bullet nearest the cup counts', async () => {
    const { ann, ben, room } = await timedGame(30, 0.5);
    const shots = received(ben, 'shotResult'), chosen = received(ben, 'bulletChosen');
    const M = courseModel(0);
    ann.send('shoot', { weapon: widx('auto'), yaw: Math.atan2(M.cup.x - M.tee.x, M.cup.z - M.tee.z), pitch: 10, power: 0.4, turn: 1 });
    await untilTrue(() => shots.length === 1, 'the shot arrives');
    const shot = unpackShot(shots[0].shot), flight = shot.steps * STEP, candidates = shot.outcome.candidates;
    expect(ben.state.match.clock).toBe('choose');
    const toCup = k => { const r = shot.projs[candidates[k]].rest; return Math.hypot(r.x - M.cup.x, r.z - M.cup.z); };
    const nearest = candidates.map((_, k) => k).reduce((a, b) => (toCup(b) < toCup(a) ? b : a));
    const t0 = Date.now();
    await untilTrue(() => chosen.length === 1, 'the choice is made for Ann', (flight + 2) * 1000);
    expect((Date.now() - t0) / 1000).toBeGreaterThan(flight + 0.5 - 0.2); // the flight is watched first, then 0.5 s to pick
    expect(chosen[0]).toMatchObject({ turn: 1, k: nearest, timeUp: true, result: { type: 'rest', strokes: 1 } });
    ann.send('chooseBullet', { k: (nearest + 1) % 3 }); // too late now
    await wait(150);
    expect(readMatch(ben.state).seats[0].ball).toEqual(shot.projs[candidates[nearest]].rest);
    expect(room.match.state.seats[0].ball).toEqual(shot.projs[candidates[nearest]].rest);
  }, 10000); // the bullets fly for a few seconds first
});

describe('between holes and the end', () => {
  // A game whose room shows the scorecard for only a second between holes. The bot plays dozens of turns a second, so
  // each screen sends far more messages than a person could, and the room must not drop it for that.
  async function quickGame(...names) {
    const rooms = await startGame(...names), room = serverRoom(rooms[0]);
    room.betweenSeconds = 1;
    room.maxMessagesPerSecond = Infinity;
    return { rooms, room };
  }

  test.each([2, 3, 4])('a whole game with %i players: each hole starts when the scorecard countdown ends, and every screen ends with the same scorecard', async n => {
    const { rooms, room } = await quickGame(...['Ann', 'Ben', 'Cy', 'Dee'].slice(0, n));
    const ms = room.match.state;
    for (const hole of [0, 1]) {
      await playUntil(room, rooms, s => s.phase === 'between');
      const t0 = Date.now();
      expect(ms.hole).toBe(hole);
      for (const r of rooms) {
        const s = await until(r, st => st.match.phase === 'between');
        expect(s.match.clock).toBe('between');
        expect(s.match.timeLeft).toBeGreaterThan(800);
        expect(s.match.timeLeft).toBeLessThanOrEqual(1000);
        await inStep(r, ms);
      }
      await untilTrue(() => ms.hole === hole + 1, `hole ${hole + 2} starts`);
      const waited = (Date.now() - t0) / 1000;
      expect(waited).toBeGreaterThan(1 - 0.15); // no grace: the next hole starts when the countdown on screen ends
      expect(waited).toBeLessThan(1 + 0.5);
      expect([ms.phase, room.state.match.clock]).toEqual(['turn', 'turn']);
    }
    await playUntil(room, rooms, s => s.phase === 'end');
    expect(ms.seats.every(s => s.scores.every(v => v >= 1))).toBe(true);
    for (const r of rooms) {
      await inStep(r, ms);
      expect(r.state.match.clock).toBe('');
      expect(scorecard(r)).toEqual(ms.seats.map(s => [s.name, s.scores]));
    }
  }, 60000);

  test('only the host plays again, and only after the last hole: everyone goes back to the lobby with the same code', async () => {
    const { rooms: [ann, ben], room } = await quickGame('Ann', 'Ben'), code = ann.roomId;
    ann.send('playAgain'); // in the middle of the game
    await wait(150);
    expect(ann.state.phase).toBe('playing');
    await playUntil(room, [ann, ben], s => s.phase === 'end');
    ben.send('playAgain'); // not the host
    await wait(150);
    expect([ann.state.phase, ann.state.match.phase]).toEqual(['playing', 'end']);
    ann.send('playAgain');
    for (const r of [ann, ben]) {
      const s = await until(r, st => st.phase === 'lobby');
      expect([s.code, s.host, s.match.phase, s.match.clock]).toEqual([code, ann.sessionId, '', '']);
      expect(seats(s)).toEqual([{ name: 'Ann', style: 0, connected: true }, { name: 'Ben', style: 1, connected: true }]);
      expect(s.seats.map(x => [x.strokes, x.done, x.scores.length])).toEqual([[0, false, 0], [0, false, 0]]);
    }
    // The room is open again: a friend joins with the code, and the next start begins a new match
    const cy = await join(code, 'Cy');
    await until(ann, s => s.seats.length === 3);
    expect(seats(cy.state).map(s => s.style)).toEqual([0, 1, 2]);
    ann.send('start');
    for (const r of [ann, ben, cy]) await until(r, s => s.phase === 'playing');
    const ms = room.match.state;
    expect([ms.phase, ms.hole, ms.turn, ms.cur]).toEqual(['turn', 0, 1, 0]);
    expect(ms.seats.map(s => s.name)).toEqual(['Ann', 'Ben', 'Cy']);
    expect(ms.seats.every(s => s.strokes === 0 && s.scores.every(v => v === null))).toBe(true);
    for (const r of [ann, ben, cy]) await inStep(r, ms);
    const got = received(cy, 'shotResult');
    ann.send('shoot', botAim(ms));
    await untilTrue(() => got.length === 1, 'the first shot of the new game arrives');
    expect(await turnedDown(join(code, 'Dee'))).toBeInstanceOf(Error); // locked again
  }, 30000);

  test('playing again frees the seats of players who left or are away, and turns their tokens down', async () => {
    const { rooms: [ann, ben, cy], room } = await quickGame('Ann', 'Ben', 'Cy');
    room.reconnectSeconds = 30;
    await ben.leave();
    await until(ann, s => s.seats[1].out);
    await playUntil(room, [ann, ben, cy], s => s.phase === 'end'); // Ann and Cy play on
    const token = cy.reconnectionToken;
    await dropConnection(cy);
    await until(ann, s => !s.seats[2].connected && s.seats[2].reconnectLeft > 0); // Cy's seat is held
    ann.send('playAgain');
    const s = await until(ann, st => st.phase === 'lobby');
    expect(seats(s)).toEqual([{ name: 'Ann', style: 0, connected: true }]);
    expect(await turnedDown(colyseus.sdk.reconnect(token))).toBeInstanceOf(Error);
    const dee = await join(ann.roomId, 'Dee'); // gets the first free look
    await until(dee, st => st.seats.length === 2);
    expect(seats(dee.state)).toEqual([{ name: 'Ann', style: 0, connected: true }, { name: 'Dee', style: 1, connected: true }]);
  }, 30000);
});

describe('live aim', () => {
  // The i-th aim of a shooter swinging around in this turn
  const aimAt = (turn, i = 0) => ({ turn, weapon: i % WEAPONS.length, yaw: 0.25 * i, pitch: 5 + i });

  test('the shooter\'s aim reaches everyone else with the turn and seat, and nothing else of it', async () => {
    const [ann, ben, cy] = await startGame('Ann', 'Ben', 'Cy');
    const got = [received(ann, 'aim'), received(ben, 'aim'), received(cy, 'aim')];
    ann.send('aim', { turn: 1, weapon: 2, yaw: 0.5, pitch: 12, note: '<b>hi</b>' });
    await untilTrue(() => got[1].length === 1 && got[2].length === 1, 'the aim reaches Ben and Cy');
    expect(got[1][0]).toEqual({ turn: 1, seat: 0, weapon: 2, yaw: 0.5, pitch: 12 });
    expect(got[2][0]).toEqual(got[1][0]);
    await wait(150);
    expect(got[0]).toEqual([]); // not back to Ann
  });

  test('aims from anyone but the shooter, for another turn, with bad numbers or once the shot is in go nowhere', async () => {
    const [ann, ben] = await startGame('Ann', 'Ben'), room = serverRoom(ann), got = [received(ann, 'aim'), received(ben, 'aim')];
    ben.send('aim', aimAt(1)); // not his turn
    for (const bad of [aimAt(2), { ...aimAt(1), weapon: WEAPONS.length }, { ...aimAt(1), yaw: 'left' }, { ...aimAt(1), pitch: null }, { turn: 1 }, null, 'aim']) ann.send('aim', bad);
    ann.send('shoot', { weapon: widx('dart'), yaw: 0, pitch: -60, power: 0.1, turn: 1 }); // lands at once
    await untilTrue(() => room.match.state.phase === 'settle', 'the shot is in');
    ann.send('aim', aimAt(1));
    await wait(200);
    expect(got.flat()).toEqual([]);
    expect([ann.connection.isOpen, ben.connection.isOpen]).toEqual([true, true]); // ignored, not thrown out
  });

  test('aims never change a shot: the same seeded match plays the same shot with or without them', async () => {
    async function seeded() {
      const [ann, ben] = await startGame('Ann', 'Ben'), room = serverRoom(ann);
      room.match = makeMatch(['Ann', 'Ben'], rng(42));
      room.sync();
      await inStep(ben, room.match.state);
      return { ann, ben, room, shots: received(ben, 'shotResult') };
    }
    const swung = await seeded(), still = await seeded(), seen = received(swung.ben, 'aim');
    expect(JSON.stringify(swung.room.match.state)).toBe(JSON.stringify(still.room.match.state));
    // In the first room Ann swings her aim around for two seconds before she fires; in the second she fires at once
    for (let i = 0; i < 20; i++) { swung.ann.send('aim', aimAt(1, i)); await wait(100); }
    await untilTrue(() => seen.length === 20, 'every aim reaches Ben');
    const aim = botAim(swung.room.match.state);
    for (const g of [swung, still]) g.ann.send('shoot', aim);
    await untilTrue(() => swung.shots.length === 1 && still.shots.length === 1, 'both shots arrive');
    expect(swung.shots[0]).toEqual(still.shots[0]);
    expect(JSON.stringify(swung.room.match.state)).toBe(JSON.stringify(still.room.match.state));
  });

  test(`a client that sends ten aims a second stays; one that sends more than ${MAX_MESSAGES_PER_SECOND} messages in a second is dropped`, async () => {
    const [ann, ben] = await startGame('Ann', 'Ben'), seen = received(ben, 'aim');
    for (let i = 0; i < 15; i++) { ann.send('aim', aimAt(1, i)); await wait(100); }
    await untilTrue(() => seen.length === 15, 'every aim reaches Ben');
    expect(ann.connection.isOpen).toBe(true);
    ann.reconnection.enabled = false;
    for (let i = 0; i < MAX_MESSAGES_PER_SECOND + 10; i++) ann.send('aim', aimAt(1, i));
    await until(ben, s => !s.seats[0].connected);
    expect(ann.connection.isOpen).toBe(false);
  });
});
