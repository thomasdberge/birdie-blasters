// What the browser and the game server agree on: protocol version, room codes, nicknames and why a request is turned down.
// Plain JavaScript, no Three.js or DOM.

// Raise this whenever messages or room state change in a way an older client cannot handle
export const PROTOCOL_VERSION = 5;
export const ROOM_NAME = 'golf';

// Messages. Client → server: start · shoot { turn, weapon, yaw, pitch, power } (turn: the turn it was fired in) ·
// chooseBullet { k } · replayDone { turn }.
// Server → clients: shotResult { turn, shooter, aim, shot (packShot), result } · bulletChosen { turn, k, result, timeUp,
// gone } (the bullet nearest the cup was picked because the shot clock ran out, or because the shooter dropped out or
// left) · timeUp { turn, seat, result } (the shot clock ran out) · shotRejected { reason } to the shooter alone. The room
// state (server/src/state.js) has everything else.

// What the shooter is told when the server turns a shot down. reason is match.shoot's error, or 'time' when the shot
// came after the shot clock ran out.
export const SHOT_REJECTED = {
  time: 'Too late: your time ran out.',
  'not your turn': 'Too late: it is not your turn any more.',
  other: 'The server could not take that shot. Aim and fire again.'
};

// A shot from simulateShot (src/core/shot.js) as shotResult carries it. Flight paths only animate the shot, so float32
// is plenty and halves their size. msgpack garbles a Float32Array but carries its bytes intact as a Uint8Array.
export function packShot(shot) {
  return { ...shot, projs: shot.projs.map(p => ({ ...p, path: new Uint8Array(new Float32Array(p.path).buffer) })) };
}
// Copying the bytes first gives the floats an aligned buffer of their own
export function unpackShot(shot) {
  return { ...shot, projs: shot.projs.map(p => ({ ...p, path: new Float32Array(new Uint8Array(p.path).buffer) })) };
}

// Room codes use consonants and digits only. No vowels, and no digits that read as vowels (0, 1, 3, 4), so a code
// never spells a word; no look-alikes either (O/0, I/1/L).
export const CODE_ALPHABET = 'BCDFGHJKMNPQRSTVWXZ256789';
export const CODE_LENGTH = 5;
// randomInt(n) returns a whole number from 0 to n - 1
export function makeRoomCode(randomInt) {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}
// A room code as typed (any case, with spaces or dashes), or null if it cannot be one
export function readRoomCode(input) {
  const code = String(input ?? '').toUpperCase().replace(/[\s-]/g, '');
  return code.length === CODE_LENGTH && [...code].every(c => CODE_ALPHABET.includes(c)) ? code : null;
}

export const NAME_MAX = 16;
// Letters in any language, digits, spaces and basic punctuation
const NAME_CHARS = /^[\p{L}\p{N} .,'’!?_-]+$/u;
// A nickname as it will be shown (trimmed, runs of spaces made single), or null if it is not allowed
export function cleanName(input) {
  if (typeof input !== 'string') return null;
  const name = input.normalize('NFC').trim().replace(/\s+/g, ' ');
  return name && [...name].length <= NAME_MAX && NAME_CHARS.test(name) ? name : null;
}

// Why the server turned a request down; the client shows the message.
// The code is also the HTTP status of the matchmaking response, so it must be a valid one.
export const REJECT = {
  version: { code: 426, message: 'New version available, please reload' },
  name: { code: 422, message: `Nicknames are 1–${NAME_MAX} letters, digits, spaces or basic punctuation` },
  tooManyRooms: { code: 429, message: 'Too many new rooms from your network. Try again in a few minutes.' },
  mode: { code: 400, message: 'Only private rooms are available' }
};
