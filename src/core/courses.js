// The holes, and the course model built from them: height, surface, crates and trees.
// Plain JavaScript, no Three.js or DOM.

import { clamp, lerp, rng, smooth } from './math.js';

// center: fairway centerline, crates: [x, z, width, depth, height], bumps: [x, z, height, radius]
export const HOLES = [
  { name: 'Warm-Up', par: 3, seed: 11, center: [[0, 12], [0, -198]], tee: [0, 0], cup: [3, -172], fairW: 17, roughW: 13, greenR: 15,
    bumps: [[-7, -55, 2.6, 16], [9, -88, 2.2, 13], [-10, -128, 1.8, 12], [15, -150, -1.4, 10], [1, -25, 1.0, 9]],
    bunkers: [[-12, -160, 5.5], [13, -183, 5], [8, -118, 4.5]], ponds: [],
    crates: [[-3, -104, 5, 2.4, 2.2], [10, -138, 2.6, 2.6, 1.6], [12.4, -138, 2.2, 2.2, 3.0]], ring: null, trees: 34 },
  { name: 'Duck Pond', par: 4, seed: 23, center: [[0, 12], [8, -105], [-22, -252]], tee: [0, 0], cup: [-18, -232], fairW: 19, roughW: 13, greenR: 15,
    bumps: [[-10, -40, 2, 14], [18, -70, 2.4, 12], [-26, -180, 2.8, 16], [2, -200, 1.6, 10]],
    bunkers: [[-31, -221, 5.5], [-6, -243, 5], [-1, -168, 6]], ponds: [[7, -112, 19]],
    crates: [[-14, -150, 6, 2.2, 2]], ring: null, trees: 40 },
  { name: 'The Fortress', par: 4, seed: 37, center: [[0, 12], [-16, -95], [8, -232]], tee: [0, 0], cup: [6, -212], fairW: 18, roughW: 13, greenR: 13,
    bumps: [[6, -212, 4.5, 24], [-12, -50, 2.2, 14], [10, -80, 1.8, 12], [-22, -150, 2.4, 14]],
    bunkers: [[-5, -165, 5.5], [22, -186, 5]], ponds: [[-25, -118, 10]],
    crates: [[-6, -60, 4, 2.2, 2]], ring: { r: 18, gaps: [[76, 124], [300, 328]] }, trees: 36 }
];
export const CUP_R = 0.62;
export const PLATEAU = 45 * 0.12 + 45 * 45 * 0.005;

export function makeModel(def) {
  const segs = []; let total = 0;
  for (let i = 0; i < def.center.length - 1; i++) {
    const [ax, az] = def.center[i], [bx, bz] = def.center[i + 1];
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    segs.push({ ax, az, dx: dx / len, dz: dz / len, len, s0: total });
    total += len;
  }
  const E = def.fairW + def.roughW;
  function project(x, z) {
    let best = null, bd = Infinity;
    for (const g of segs) {
      const t = clamp((x - g.ax) * g.dx + (z - g.az) * g.dz, 0, g.len);
      const cx = g.ax + g.dx * t, cz = g.az + g.dz * t, d = Math.hypot(x - cx, z - cz);
      if (d < bd) { bd = d; best = { g, t, cx, cz }; }
    }
    const g = best.g;
    return { s: g.s0 + best.t, lat: (x - best.cx) * -g.dz + (z - best.cz) * g.dx, d: bd };
  }
  function pointAt(s, lat) {
    s = clamp(s, 0, total);
    let g = segs[segs.length - 1];
    for (const sg of segs) { if (s <= sg.s0 + sg.len) { g = sg; break; } }
    const t = s - g.s0;
    return { x: g.ax + g.dx * t - g.dz * lat, z: g.az + g.dz * t + g.dx * lat };
  }
  // Rolling course, then hills beyond the out-of-bounds line that level off into a flat plateau (PLATEAU)
  function baseH(x, z) {
    const d = project(x, z).d;
    let h = 0.7 * Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.037) + 0.35 * Math.sin(z * 0.09 + x * 0.02);
    if (d > E + 15) h *= 1 - smooth(E + 15, E + 40, d);
    for (const b of def.bumps) { const dx = x - b[0], dz = z - b[1]; h += b[2] * Math.exp(-(dx * dx + dz * dz) / (b[3] * b[3])); }
    if (d > E) { const e = Math.min(d - E, 45); h += e * 0.12 + e * e * 0.005; }
    return h;
  }
  const cup = { x: def.cup[0], z: def.cup[1] }, tee = { x: def.tee[0], z: def.tee[1] };
  const cupBase = baseH(cup.x, cup.z), teeBase = baseH(tee.x, tee.z);
  const ponds = def.ponds.map(p => {
    let m = Infinity;
    for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2; m = Math.min(m, baseH(p[0] + Math.cos(a) * (p[2] + 6), p[1] + Math.sin(a) * (p[2] + 6))); }
    return { x: p[0], z: p[1], r: p[2], level: m - 0.35 };
  });
  function height(x, z) {
    let h = baseH(x, z);
    const dc = Math.hypot(x - cup.x, z - cup.z);
    if (dc < def.greenR + 8) { const t = smooth(def.greenR + 8, def.greenR * 0.5, dc); h = lerp(h, cupBase + (h - cupBase) * 0.2, t); }
    const dt = Math.hypot(x - tee.x, z - tee.z);
    if (dt < 9) h = lerp(h, teeBase, smooth(9, 3, dt));
    for (const p of ponds) { const d = Math.hypot(x - p.x, z - p.z); if (d < p.r + 6) h = lerp(h, p.level - 1.8, smooth(p.r + 6, p.r * 0.65, d)); }
    for (const b of def.bunkers) { const d = Math.hypot(x - b[0], z - b[1]); if (d < b[2] + 1.5) h -= 0.55 * smooth(b[2] + 1.5, b[2] * 0.4, d); }
    return h;
  }
  function normal(x, z) {
    const e = 0.6;
    const nx = -(height(x + e, z) - height(x - e, z)) / (2 * e), nz = -(height(x, z + e) - height(x, z - e)) / (2 * e);
    const l = Math.hypot(nx, 1, nz);
    return { x: nx / l, y: 1 / l, z: nz / l };
  }
  function surface(x, z) {
    for (const p of ponds) if (Math.hypot(x - p.x, z - p.z) < p.r) return 'water';
    if (Math.hypot(x - cup.x, z - cup.z) < def.greenR) return 'green';
    for (const b of def.bunkers) if (Math.hypot(x - b[0], z - b[1]) < b[2]) return 'sand';
    if (Math.hypot(x - tee.x, z - tee.z) < 4.5) return 'tee';
    const d = project(x, z).d;
    if (d <= def.fairW) return 'fairway';
    if (d <= E) return 'rough';
    return 'oob';
  }
  const boxes = [];
  function addBox(cx, cz, w, d, hgt, label) {
    let y0 = Infinity;
    for (const [ox, oz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, 0]]) y0 = Math.min(y0, height(cx + ox, cz + oz));
    y0 -= 0.3;
    boxes.push({ x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2, y0, y1: y0 + hgt + 0.3, cx, cz, w, d, h: hgt + 0.3, label });
  }
  def.crates.forEach((c, i) => addBox(c[0], c[1], c[2], c[3], c[4], i % 2 ? '84 MM' : 'AMMO'));
  if (def.ring) {
    const R = def.ring.r, n = Math.round(2 * Math.PI * R / 2.6);
    for (let i = 0; i < n; i++) {
      const a = i / n * 360;
      if (def.ring.gaps.some(g => a >= g[0] && a <= g[1])) continue;
      const rad = a * Math.PI / 180;
      addBox(cup.x + Math.cos(rad) * R, cup.z + Math.sin(rad) * R, 2.3, 2.3, i % 3 === 0 ? 3.6 : 1.9, i % 2 ? '84 MM' : 'AMMO');
    }
  }
  const R = rng(def.seed), trees = [];
  let tries = 0;
  while (trees.length < def.trees && tries < 900) {
    tries++;
    const s = R() * total, side = R() < 0.5 ? -1 : 1;
    const p = pointAt(s, side * (def.fairW + 3 + R() * (def.roughW + 32)));
    if (Math.hypot(p.x - cup.x, p.z - cup.z) < def.greenR + 8) continue;
    if (Math.hypot(p.x - tee.x, p.z - tee.z) < 14) continue;
    if (ponds.some(q => Math.hypot(p.x - q.x, p.z - q.z) < q.r + 8)) continue;
    if (trees.some(t => Math.hypot(p.x - t.x, p.z - t.z) < 5)) continue;
    if (def.ring && Math.hypot(p.x - cup.x, p.z - cup.z) < def.ring.r + 6) continue;
    if (project(p.x, p.z).d < def.fairW + 2) continue;
    const sc = 0.8 + R() * 0.7;
    trees.push({ x: p.x, z: p.z, y0: height(p.x, p.z), trunkR: 0.4 * sc, trunkH: 2.2 * sc, canopyR: 2.4 * sc, canopyH: 5.5 * sc, sc, kind: R() < 0.7 ? 'pine' : 'round' });
  }
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of def.center) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const pad = E + 70;
  const M = {
    def, segs, total, E, project, pointAt, height, normal, surface, ponds, boxes, trees,
    cup: { x: cup.x, z: cup.z, y: height(cup.x, cup.z) }, tee: { x: tee.x, z: tee.z, y: height(tee.x, tee.z) },
    ext: { x0: x0 - pad, x1: x1 + pad, z0: z0 - pad, z1: z1 + pad }
  };
  M.sTee = project(tee.x, tee.z).s;
  return M;
}
export function validPos(M, x, z) {
  const pr = M.project(x, z);
  let s = clamp(pr.s, M.sTee, M.total), lat = clamp(pr.lat, -(M.E - 3), M.E - 3);
  let p = (pr.d > M.E - 3 || pr.s < M.sTee) ? M.pointAt(s, lat) : { x, z };
  for (let i = 0; i < 80; i++) {
    const bad = M.ponds.some(q => Math.hypot(p.x - q.x, p.z - q.z) < q.r + 4) ||
      M.boxes.some(b => p.x > b.x0 - 1.3 && p.x < b.x1 + 1.3 && p.z > b.z0 - 1.3 && p.z < b.z1 + 1.3) ||
      M.trees.some(t => Math.hypot(p.x - t.x, p.z - t.z) < t.trunkR + 1.1);
    if (!bad) break;
    s = Math.max(M.sTee, s - 3); lat *= 0.85; p = M.pointAt(s, lat);
  }
  return { x: p.x, z: p.z, y: M.height(p.x, p.z) };
}
