// The golf room through the real browser SDK: private rooms by code, the lobby, starting, turning requests down, the
// match in the room state, and taking a seat back after a reload.
import { isDeepStrictEqual } from 'node:util';
import { Client } from '@colyseus/sdk';
import { boot } from '@colyseus/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { courseModel } from '../../src/core/match.js';
import { CODE_ALPHABET, PROTOCOL_VERSION, REJECT, ROOM_NAME } from '../../src/core/protocol.js';
import { WEAPONS, widx } from '../../src/core/weapons.js';
import { readMatch } from '../../src/net/remoteMatch.js';
import { server } from '../src/app.js';
import { CREATE_LIMIT, resetCreateLimits } from '../src/GolfRoom.js';
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
// rifle choice), not style (the room picks the looks) and not connected (the room tracks that itself for now).
const mirrored = ms => ({
  phase: ms.phase, hole: ms.hole, turn: ms.turn, cur: ms.cur, wind: ms.wind,
  seats: ms.seats.map(s => ({ name: s.name, ball: s.ball, stand: s.stand, strokes: s.strokes, done: s.done, picked: s.picked, out: s.out, scores: s.scores }))
});
const shown = room => mirrored(readMatch(room.state));
// Waits until a client's copy of the match is the server's
async function inStep(room, ms) {
  for (let i = 0; i < 200 && !isDeepStrictEqual(shown(room), mirrored(ms)); i++) await new Promise(r => setTimeout(r, 10));
  expect(shown(room)).toEqual(mirrored(ms));
}
// A simple bot: the shortest weapon that reaches, aimed at the cup at its default angle, power by distance
function botAim(ms) {
  const s = ms.seats[ms.cur], M = courseModel(ms.hole), d = Math.hypot(M.cup.x - s.ball.x, M.cup.z - s.ball.z);
  const weapon = ['dart', 'pistol', 'shotgun', 'auto', 'sniper', 'grenade', 'bazooka'].map(widx).find(i => WEAPONS[i].range >= d) ?? widx('bazooka');
  const W = WEAPONS[weapon];
  return { weapon, yaw: Math.atan2(M.cup.x - s.ball.x, M.cup.z - s.ball.z), pitch: W.pitchDef, power: Math.min(1, Math.max(0.05, d / W.range)) };
}
// A page that is closed or reloaded: the connection drops without a goodbye, and nothing reconnects by itself
async function dropConnection(room) {
  room.reconnection.enabled = false;
  await room.leave(false);
}

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
  });
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
});
