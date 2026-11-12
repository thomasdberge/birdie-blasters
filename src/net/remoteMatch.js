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
// on.shot({ turn, shooter, aim, shot, result }) for every shot, on.chosen({ turn, k, result, timeUp, gone }) for a rifle
// choice, on.timeUp({ turn, seat, result }) when the shot clock runs out, on.rejected({ reason }) when it turns this
// player's shot down, on.aim({ turn, seat, weapon, yaw, pitch }) for the shooter's live aim while someone else shoots.
// close() stops listening, when the room goes back to the lobby or is left.
export function remoteMatch(room, on) {
  let shotTurn = -1, watchedTurn = -1;
  const offs = [
    room.onMessage('shotResult', m => { shotTurn = m.turn; on.shot({ ...m, shot: unpackShot(m.shot) }); }),
    room.onMessage('timeUp', m => { shotTurn = m.turn; on.timeUp(m); }),
    room.onMessage('bulletChosen', m => on.chosen(m)),
    room.onMessage('shotRejected', m => on.rejected(m)),
    room.onMessage('aim', m => on.aim(m))
  ];
  return {
    get state() { return readMatch(room.state); },
    // The room's clock: what it times ('turn', 'choose', 'between' or '' when stopped) and the milliseconds it had left
    // when the server last wrote it (about once a second)
    get clock() { return { of: room.state.match.clock, left: room.state.match.timeLeft }; },
    // The host's seat, or -1 while there is none (everyone has lost the connection)
    get host() { return [...room.state.seats].findIndex(s => s.sessionId === room.state.host); },
    // Per seat, the milliseconds a player who lost the connection has left to come back (0 for everyone else), as the
    // server last wrote them (about once a second)
    get reconnectLeft() { return [...room.state.seats].map(s => s.reconnectLeft); },
    // The server decides; the shot comes back through on.shot
    shoot(seat, aim) { room.send('shoot', { ...aim, turn: room.state.match.turn }); return {}; },
    chooseBullet(seat, k) { room.send('chooseBullet', { k }); return {}; },
    // The shooter's aim { weapon, yaw, pitch }, for the others to watch. Looks only, so none is kept to send later while
    // the connection is lost.
    aim(aim) { if (room.connection.isOpen) room.send('aim', { ...aim, turn: room.state.match.turn }); },
    // This screen has watched the last shot land (or the time run out). The server starts the next turn once every
    // screen has.
    next() {
      if (shotTurn >= 0 && watchedTurn !== shotTurn) { watchedTurn = shotTurn; room.send('replayDone', { turn: shotTurn }); }
      return {};
    },
    // The host, after the last hole: everyone goes back to the lobby, with the same code
    playAgain() { room.send('playAgain'); },
    close() { for (const off of offs) off(); }
  };
}
