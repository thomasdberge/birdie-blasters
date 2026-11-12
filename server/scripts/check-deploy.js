// Checks a deployed game server from this computer:
//   node server/scripts/check-deploy.js https://<server address> [--origin https://<game page>] [--room-limit]
// - the health check answers, and the same server process answers every time (rooms live in its memory)
// - pages elsewhere may not use it from a browser, but pages on localhost and each --origin may
// - two players can start a game and play a shot through it
// - with --room-limit: a forged X-Forwarded-For or X-Real-IP does not get around the limit on new rooms. This uses up
//   the limit, so for the next ten minutes nobody on this network can create a room on that server.

import { Client } from '@colyseus/sdk';
import { PROTOCOL_VERSION, REJECT, ROOM_NAME } from '../../src/core/protocol.js';
import { WEAPONS } from '../../src/core/weapons.js';
import { CREATE_LIMIT } from '../src/GolfRoom.js';

const args = process.argv.slice(2), base = args.find(a => /^https?:\/\//.test(a))?.replace(/\/$/, '');
const origins = args.flatMap((a, i) => (args[i - 1] === '--origin' ? [a] : []));
if (!base) { console.log('Usage: node server/scripts/check-deploy.js https://<server address> [--origin https://<game page>] [--room-limit]'); process.exit(2); }

let failed = false;
function report(ok, what, detail = '') { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${what}${detail ? ` (${detail})` : ''}`); if (!ok) failed = true; }
const wait = ms => new Promise(r => setTimeout(r, ms));
async function within(ms, what, promise) {
  return Promise.race([promise, wait(ms).then(() => { throw new Error(`no ${what} within ${ms / 1000} s`); })]);
}
const opts = name => ({ version: PROTOCOL_VERSION, name });

// 1. Health, and one server process
const answers = [];
for (let i = 0; i < 12; i++) answers.push(await (await fetch(`${base}/health`)).json());
const processes = new Set(answers.map(a => a.process));
report(answers.every(a => a.ok), 'the health check answers', `${answers.at(-1).rooms} rooms, ${answers.at(-1).players} players`);
report(processes.size === 1, 'one server process answers every time', [...processes].join(', '));

// 2. Which pages may use it from a browser
async function allowedFor(origin) {
  const res = await fetch(`${base}/matchmake/create/${ROOM_NAME}`, { method: 'OPTIONS', headers: { origin } });
  return res.headers.get('access-control-allow-origin') === origin;
}
report(!(await allowedFor('https://not-the-game.example')), 'a page elsewhere may not use it');
for (const origin of ['http://localhost:5173', ...origins]) report(await allowedFor(origin), `${origin} may use it`);

// 3. Two players start a game and play a shot
const sdk = new Client(base);
let ann, ben;
try {
  ann = await sdk.create(ROOM_NAME, opts('Check Ann'));
  ben = await sdk.joinById(ann.roomId, opts('Check Ben'));
  const shots = [ann, ben].map(room => new Promise(resolve => room.onMessage('shotResult', resolve)));
  await within(5000, 'second player in the lobby', (async () => { while (ann.state.seats?.length !== 2) await wait(20); })());
  ann.send('start');
  await within(5000, 'game start', (async () => { while (ann.state.match?.phase !== 'turn') await wait(20); })());
  const m = ann.state.match, shooter = [ann, ben].find(r => r.sessionId === ann.state.seats[m.cur].sessionId);
  shooter.send('shoot', { weapon: 0, yaw: 0, pitch: WEAPONS[0].pitchDef, power: 0.5, turn: m.turn });
  const [a, b] = await within(10000, 'shot result', Promise.all(shots));
  report(a.turn === b.turn && a.shooter === m.cur, `room ${ann.roomId}: both players got the shot the server decided`);
} catch (e) {
  report(false, 'two players play a shot', e.message);
} finally {
  await Promise.allSettled([ann?.leave(), ben?.leave()]);
}

// 4. Forged client IP headers and the room limit
if (args.includes('--room-limit')) {
  let refusedAt = 0;
  for (let i = 1; i <= CREATE_LIMIT + 1 && !refusedAt; i++) {
    const forged = new Client(base, { headers: { 'x-forwarded-for': `203.0.113.${i}`, 'x-real-ip': `198.51.100.${i}` } });
    try { await (await forged.create(ROOM_NAME, opts('Check'))).leave(); } catch (e) {
      if (e.code !== REJECT.tooManyRooms.code) throw e;
      refusedAt = i;
    }
  }
  report(refusedAt > 0, 'forged X-Forwarded-For and X-Real-IP do not get around the room limit',
    refusedAt ? `refused at room ${refusedAt}` : `${CREATE_LIMIT + 1} rooms created`);
}

process.exit(failed ? 1 : 0);
