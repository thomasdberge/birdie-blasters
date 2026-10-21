// The match as an online client sees it. It has the same shape as makeMatch (src/core/match.js), so src/game/ plays it
// the same way, but the server runs the real one and its state is read from the room state.
// Plain JavaScript, no Three.js or DOM, so the server tests can use it too.

import { unpackShot } from '../core/protocol.js';

const point = p => ({ x: p.x, y: p.y, z: p.z });

// The room state (server/src/state.js) read back into the shape of match.state.
// style is the seat's character look, which the room picks; the server's match numbers seats in order instead.
export function readMatch(rs) {
  const m = rs.match, w = m.wind;
  return {
    phase: m.phase, hole: m.hole, turn: m.turn, cur: m.cur,
    wind: { x: w.x, z: w.z, dir: w.dir, speed: w.speed },
    seats: [...rs.seats].map(s => ({
      name: s.name, style: s.style, ball: point(s.ball), stand: s.out ? null : point(s.stand), strokes: s.strokes,
      done: s.done, picked: s.picked, scores: [...s.scores].map(v => v || null), connected: s.connected, out: s.out
    }))
  };
}

// room: a joined room from the browser SDK. The server answers actions with messages (see src/core/protocol.js):
// on.shot({ turn, shooter, aim, shot, result }) for every shot, on.chosen({ turn, k, result }) for a rifle choice.
export function remoteMatch(room, on) {
  let shotTurn = -1, watchedTurn = -1;
  room.onMessage('shotResult', m => { shotTurn = m.turn; on.shot({ ...m, shot: unpackShot(m.shot) }); });
  room.onMessage('bulletChosen', m => on.chosen(m));
  return {
    get state() { return readMatch(room.state); },
    // The server decides; the shot comes back through on.shot
    shoot(seat, aim) { room.send('shoot', aim); return {}; },
    chooseBullet(seat, k) { room.send('chooseBullet', { k }); return {}; },
    // This screen has watched the last shot land. The server starts the next turn once every screen has.
    next() {
      if (shotTurn >= 0 && watchedTurn !== shotTurn) { watchedTurn = shotTurn; room.send('replayDone', { turn: shotTurn }); }
      return {};
    }
  };
}
