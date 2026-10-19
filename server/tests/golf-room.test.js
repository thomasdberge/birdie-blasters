// The golf room through the real browser SDK: private rooms by code, the lobby, starting, and turning requests down.
import { Client } from '@colyseus/sdk';
import { boot } from '@colyseus/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { CODE_ALPHABET, PROTOCOL_VERSION, REJECT, ROOM_NAME } from '../../src/core/protocol.js';
import { server } from '../src/app.js';
import { CREATE_LIMIT, resetCreateLimits } from '../src/GolfRoom.js';

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
    for (const version of [PROTOCOL_VERSION - 1, PROTOCOL_VERSION + 1, undefined, '1']) {
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
