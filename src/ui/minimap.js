// The minimap in the top-right corner.

import { state, world } from '../game/state.js';
import { ui } from './elements.js';

const mapCtx = ui.map.getContext('2d');
export function sizeMap() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), w = ui.map.clientWidth || 104, h = ui.map.clientHeight || 148;
  if (ui.map.width !== Math.round(w * dpr) || ui.map.height !== Math.round(h * dpr)) { ui.map.width = Math.round(w * dpr); ui.map.height = Math.round(h * dpr); buildMapStatic(); }
}
export function buildMapStatic() {
  const M = world.M; if (!M) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2), cw = ui.map.width / dpr, ch = ui.map.height / dpr;
  if (!cw || !ch) return;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of M.def.center) { x0 = Math.min(x0, x - M.E); x1 = Math.max(x1, x + M.E); z0 = Math.min(z0, z - 4); z1 = Math.max(z1, z + 4); }
  const sc = Math.min((cw - 10) / (x1 - x0), (ch - 10) / (z1 - z0));
  const ox = (cw - (x1 - x0) * sc) / 2, oy = (ch - (z1 - z0) * sc) / 2;
  const cv = document.createElement('canvas'); cv.width = ui.map.width; cv.height = ui.map.height;
  const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const P = (x, z) => [(x - x0) * sc + ox, (z - z0) * sc + oy];
  g.fillStyle = '#3a4a2b'; g.fillRect(0, 0, cw, ch);
  const path = () => { g.beginPath(); M.def.center.forEach(([x, z], i) => { const [a, b] = P(x, z); i ? g.lineTo(a, b) : g.moveTo(a, b); }); };
  g.lineCap = 'round'; g.lineJoin = 'round';
  path(); g.strokeStyle = '#4a9238'; g.lineWidth = 2 * M.E * sc; g.stroke();
  path(); g.strokeStyle = '#6cbf4b'; g.lineWidth = 2 * M.def.fairW * sc; g.stroke();
  const circ = (x, z, r, c) => { const [a, b] = P(x, z); g.beginPath(); g.arc(a, b, Math.max(1, r * sc), 0, Math.PI * 2); g.fillStyle = c; g.fill(); };
  circ(M.cup.x, M.cup.z, M.def.greenR, '#93da6b');
  for (const b of M.def.bunkers) circ(b[0], b[1], b[2], '#edd9a0');
  for (const p of M.ponds) circ(p.x, p.z, p.r + 2, '#3aa0d8');
  for (const t of M.trees) circ(t.x, t.z, 1.6, '#24572b');
  g.fillStyle = '#8a6a3a';
  for (const b of M.boxes) { const [a, c] = P(b.x0, b.z0); g.fillRect(a, c, Math.max(1.5, b.w * sc), Math.max(1.5, b.d * sc)); }
  const [tx, tz] = P(M.tee.x, M.tee.z); g.fillStyle = '#ff6b17'; g.fillRect(tx - 3, tz - 1.5, 6, 3);
  world.mapStatic = { cv, P, dpr, sc };
}
export function drawMap() {
  const st = world.mapStatic, M = world.M; if (!st || !M) return;
  const g = mapCtx; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, ui.map.width, ui.map.height); g.drawImage(st.cv, 0, 0);
  g.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
  const [fx, fz] = st.P(M.cup.x, M.cup.z);
  g.strokeStyle = '#1b2214'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(fx, fz); g.lineTo(fx, fz - 11); g.stroke();
  g.fillStyle = '#e8322b'; g.beginPath(); g.moveTo(fx, fz - 11); g.lineTo(fx + 8, fz - 8); g.lineTo(fx, fz - 5); g.closePath(); g.fill();
  const cur = state.players[state.cur];
  if ((state.phase === 'aim' || state.phase === 'pick') && cur) {
    // Direction only: how far it goes is for the player to judge
    const len = 400, [a, b] = st.P(cur.ball.x, cur.ball.z), [c, d] = st.P(cur.ball.x + Math.sin(state.yaw) * len, cur.ball.z + Math.cos(state.yaw) * len);
    g.setLineDash([3, 3]); g.strokeStyle = '#f7f6ee'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke(); g.setLineDash([]);
  }
  state.players.forEach((p, i) => {
    if (p.done || p.out) return;
    const pos = p.char.group.position, [a, b] = st.P(pos.x, pos.z);
    g.beginPath(); g.arc(a, b, i === state.cur ? 4.5 : 3.5, 0, Math.PI * 2); g.fillStyle = p.color; g.fill(); g.strokeStyle = '#1b2214'; g.lineWidth = 1.5; g.stroke();
  });
  if (state.shot) {
    state.shot.projs.forEach((q, k) => {
      if (q.gone || q.delay > 0 || (!q.active && state.phase !== 'choose')) return;
      const [a, b] = st.P(q.b.x, q.b.z); g.beginPath(); g.arc(a, b, 2.5, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill();
    });
  }
}
