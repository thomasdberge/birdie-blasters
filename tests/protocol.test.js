// Room codes and nicknames (src/core/protocol.js), shared by the browser and the game server.
import { expect, test } from 'vitest';
import { rng } from '../src/core/math.js';
import { CODE_ALPHABET, CODE_LENGTH, cleanName, makeRoomCode, NAME_MAX, readRoomCode } from '../src/core/protocol.js';

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
