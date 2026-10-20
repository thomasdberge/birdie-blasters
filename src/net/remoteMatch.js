// The match as an online client sees it. It has the same shape as makeMatch (src/core/match.js), so src/game/ plays it
// the same way, but the server runs the real one and its state is read from the room state.
// Plain JavaScript, no Three.js or DOM, so the server tests can use it too.

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

// room: a joined room from the browser SDK
export function remoteMatch(room) {
  return {
    get state() { return readMatch(room.state); },
    // The server does not take shots yet, and Colyseus would disconnect a client that sent one
    shoot() { return { error: 'Shots online are not decided by the server yet.' }; }
  };
}
