// Room codes, nicknames and shot messages (src/core/protocol.js), shared by the browser and the game server.
import { expect, test } from 'vitest';
import { rng } from '../src/core/math.js';
import { courseModel } from '../src/core/match.js';
import { CODE_ALPHABET, CODE_LENGTH, cleanName, makeRoomCode, NAME_MAX, packShot, readRoomCode, unpackShot } from '../src/core/protocol.js';
import { launchShot, simulateShot } from '../src/core/shot.js';
import { WEAPONS } from '../src/core/weapons.js';

test('room codes have no vowels, no digits that read as vowels and no look-alikes', () => {
  for (const c of 'AEIOUY0134L') expect(CODE_ALPHABET).not.toContain(c);
  expect(new Set(CODE_ALPHABET).size).toBe(CODE_ALPHABET.length);
  const r = rng(1), randomInt = n => Math.floor(r() * n), seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const code = makeRoomCode(randomInt);
    expect(code).toMatch(new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`));
    for (const c of code) seen.add(c);
  }
  expect(seen.size).toBe(CODE_ALPHABET.length); // every symbol gets used
});

test('a typed room code is read in any case, with spaces or dashes', () => {
  expect(readRoomCode('k7qxm')).toBe('K7QXM');
  expect(readRoomCode(' K7Q-XM ')).toBe('K7QXM');
  for (const bad of ['K7QX', 'K7QXMM', 'KAQXM', 'K1QXM', '', null, undefined, 12345]) expect(readRoomCode(bad)).toBe(null);
});

test('nicknames are trimmed and checked: 1–16 letters, digits, spaces or basic punctuation', () => {
  expect(cleanName('  Ann   Lee ')).toBe('Ann Lee');
  expect(cleanName('Åse Ørnebakk')).toBe('Åse Ørnebakk');
  expect(cleanName("O'Brien, Jr.")).toBe("O'Brien, Jr.");
  expect(cleanName('Zoë_2-go!?')).toBe('Zoë_2-go!?');
  expect(cleanName('x'.repeat(NAME_MAX))).toBe('x'.repeat(NAME_MAX));
  for (const bad of ['', '   ', 'x'.repeat(NAME_MAX + 1), '<script>', 'Ann 🎯', 'a\u0000b', 'Bob@home', 42, null, undefined]) expect(cleanName(bad)).toBe(null);
});

test('a packed shot unpacks with float32 flight paths and everything else unchanged', () => {
  const M = courseModel(1), W = WEAPONS.find(w => w.id === 'auto'), from = { x: M.tee.x, y: M.tee.y, z: M.tee.z };
  const shot = simulateShot({ M, W, wind: { x: 1, z: -2 }, launches: launchShot(M, W, { yaw: 3.1, pitch: 8, power: 0.7 }, from, rng(5)), players: [] });
  const packed = packShot(shot);
  expect(packed.projs.every((p, k) => p.path instanceof Uint8Array && p.path.length === shot.projs[k].path.length * 4)).toBe(true);
  // as it arrives: a byte view at an odd offset, the way msgpack hands it over
  const arrived = { ...packed, projs: packed.projs.map(p => ({ ...p, path: new Uint8Array([7, ...p.path]).subarray(1) })) };
  const back = unpackShot(arrived);
  back.projs.forEach((p, k) => {
    expect(p.path).toBeInstanceOf(Float32Array);
    expect(Array.from(p.path)).toEqual(shot.projs[k].path.map(Math.fround));
    expect({ ...p, path: null }).toEqual({ ...shot.projs[k], path: null });
  });
  expect({ ...back, projs: null }).toEqual({ ...shot, projs: null });
});
