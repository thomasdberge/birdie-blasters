// Ball flight, bounces, roll and obstacle collisions.
// Plain JavaScript with no Three.js or DOM, so it can later run on a game server.

import { clamp } from './math.js';

export const G = 9.8;
export const BALL_R = 0.2;
export const STEP = 1 / 240;
const SURF = {
  tee:     { roll: 2.4, lin: 0.30, rest: 0.95, fric: 0.22 },
  fairway: { roll: 2.4, lin: 0.30, rest: 0.95, fric: 0.22 },
  green:   { roll: 1.4, lin: 0.32, rest: 0.80, fric: 0.15 },
  rough:   { roll: 6.0, lin: 0.70, rest: 0.55, fric: 0.50 },
  sand:    { roll: 16,  lin: 1.40, rest: 0.12, fric: 0.85 },
  oob:     { roll: 5.0, lin: 0.60, rest: 0.50, fric: 0.45 },
  water:   { roll: 8.0, lin: 1.00, rest: 0.10, fric: 0.80 },
  crate:   { roll: 4.0, lin: 0.50, rest: 0.55, fric: 0.35 }
};
// WIND_K: how strongly wind pushes a projectile · MAGNET_R: reach of the shotgun's pull toward the cup (m)
const WIND_K = 0.08, MAGNET_R = 12;
function collideSurface(b, n, S, W) {
  const vn = b.vx * n.x + b.vy * n.y + b.vz * n.z;
  if (vn >= 0) return 0;
  const tx = b.vx - vn * n.x, ty = b.vy - vn * n.y, tz = b.vz - vn * n.z;
  if (-vn > 2.2) {
    const keep = W.keep * (1 - S.fric), r = W.rest * S.rest;
    b.vx = tx * keep - vn * n.x * r; b.vy = ty * keep - vn * n.y * r; b.vz = tz * keep - vn * n.z * r;
    return -vn;
  }
  b.vx = tx; b.vy = ty; b.vz = tz;
  return 0;
}
function applyRoll(b, n, S, W, dt) {
  const sp = Math.hypot(b.vx, b.vy, b.vz);
  if (sp <= 0) return;
  const dec = (S.roll * W.rollMul * n.y + S.lin * sp) * dt;
  const f = Math.max(0, sp - dec) / sp;
  b.vx *= f; b.vy *= f; b.vz *= f;
}
function collideObstacles(b, W, M, dt) {
  let imp = 0;
  for (const k of M.boxes) {
    if (b.x < k.x0 - BALL_R || b.x > k.x1 + BALL_R || b.z < k.z0 - BALL_R || b.z > k.z1 + BALL_R || b.y < k.y0 - BALL_R || b.y > k.y1 + BALL_R) continue;
    const cx = clamp(b.x, k.x0, k.x1), cy = clamp(b.y, k.y0, k.y1), cz = clamp(b.z, k.z0, k.z1);
    let dx = b.x - cx, dy = b.y - cy, dz = b.z - cz;
    const d = Math.hypot(dx, dy, dz);
    if (d >= BALL_R) continue;
    if (d < 1e-6) {
      const opts = [[b.x - k.x0, -1, 0, 0], [k.x1 - b.x, 1, 0, 0], [b.y - k.y0, 0, -1, 0], [k.y1 - b.y, 0, 1, 0], [b.z - k.z0, 0, 0, -1], [k.z1 - b.z, 0, 0, 1]];
      opts.sort((a, c) => a[0] - c[0]);
      const o = opts[0]; dx = o[1]; dy = o[2]; dz = o[3];
      b.x += dx * (o[0] + BALL_R); b.y += dy * (o[0] + BALL_R); b.z += dz * (o[0] + BALL_R);
    } else {
      dx /= d; dy /= d; dz /= d;
      b.x = cx + dx * BALL_R; b.y = cy + dy * BALL_R; b.z = cz + dz * BALL_R;
    }
    const n = { x: dx, y: dy, z: dz };
    if (dy > 0.7) {
      imp = Math.max(imp, collideSurface(b, n, SURF.crate, W));
      applyRoll(b, n, SURF.crate, W, dt);
      b.contact = true; b.surf = 'crate';
    } else {
      const vn = b.vx * dx + b.vy * dy + b.vz * dz;
      if (vn < 0) {
        b.vx -= 1.45 * vn * dx; b.vy -= 1.45 * vn * dy; b.vz -= 1.45 * vn * dz;
        b.vx *= 0.85; b.vz *= 0.85;
        if (-vn > 1.5) imp = Math.max(imp, -vn);
      }
    }
  }
  for (const t of M.trees) {
    const dx = b.x - t.x, dz = b.z - t.z, dh = Math.hypot(dx, dz);
    if (dh > t.canopyR + 1) continue;
    if (b.y < t.y0 + t.trunkH + 0.4 && dh < t.trunkR + BALL_R && dh > 1e-6) {
      const nx = dx / dh, nz = dz / dh;
      b.x = t.x + nx * (t.trunkR + BALL_R); b.z = t.z + nz * (t.trunkR + BALL_R);
      const vn = b.vx * nx + b.vz * nz;
      if (vn < 0) { b.vx -= 1.4 * vn * nx; b.vz -= 1.4 * vn * nz; if (-vn > 1.5) imp = Math.max(imp, -vn); }
    }
    const base = t.y0 + t.trunkH;
    if (b.y > base && b.y < base + t.canopyH) {
      const r = t.canopyR * (1 - (b.y - base) / t.canopyH);
      if (dh < r) { const k = 1 - 2.4 * dt; b.vx *= k; b.vy *= k; b.vz *= k; }
    }
  }
  return imp;
}
export function stepBall(b, dt, W, M, full) {
  b.t = (b.t || 0) + dt;
  const air = !b.contact;
  b.vy -= G * (W.grav || 1) * dt;
  if (W.drag) { const k = 1 - W.drag * dt; b.vx *= k; b.vy *= k; b.vz *= k; }
  if (W.thrust && air && b.t < W.burn) { const s = Math.hypot(b.vx, b.vy, b.vz) || 1, a = W.thrust * dt / s; b.vx += b.vx * a; b.vy += b.vy * a; b.vz += b.vz * a; }
  if (air && M.wind) { const k = WIND_K * (W.windMul || 1) * dt; b.vx += M.wind.x * k; b.vz += M.wind.z * k; }
  if (W.magnet && M.cup) {
    const dx = M.cup.x - b.x, dz = M.cup.z - b.z, d = Math.hypot(dx, dz);
    if (d < MAGNET_R && d > 0.05) { const a = W.magnet * (1 - d / MAGNET_R) * dt / d; b.vx += dx * a; b.vz += dz * a; }
  }
  if (W.burst && b.impactT != null && !b.burstDone && b.t - b.impactT > W.burst.delay) {
    b.burstDone = true; b.justBurst = true;
    const hs = Math.hypot(b.vx, b.vz) + W.burst.push;
    b.vx = b.dirx * hs; b.vz = b.dirz * hs; b.vy = Math.max(b.vy, 0) + W.burst.up;
  }
  b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
  b.contact = false; b.surf = null;
  let imp = 0;
  const h = M.height(b.x, b.z);
  if (b.y - BALL_R <= h) {
    const n = M.normal(b.x, b.z);
    b.y = h + BALL_R;
    const surf = M.surface(b.x, b.z);
    const S = SURF[surf] || SURF.fairway;
    imp = collideSurface(b, n, S, W);
    applyRoll(b, n, S, W, dt);
    b.contact = true; b.surf = surf;
  }
  if (full) imp = Math.max(imp, collideObstacles(b, W, M, dt));
  if (imp > 0 && b.impactT == null) b.impactT = b.t;
  return imp;
}
// The shot leaves from the player's eye, straight along the crosshair (yaw in radians, pitch in degrees)
export function launchState(W, power, yaw, pitch, from) {
  const sp = W.speed * Math.sqrt(clamp(power, 0, 1));
  const pr = pitch * Math.PI / 180, cp = Math.cos(pr), spp = Math.sin(pr);
  const dx = Math.sin(yaw) * cp, dz = Math.cos(yaw) * cp;
  return {
    x: from.x + dx * 1.2, y: from.y + W.eye + spp * 1.2, z: from.z + dz * 1.2,
    vx: dx * sp, vy: spp * sp, vz: dz * sp, contact: false, surf: null,
    t: 0, dirx: Math.sin(yaw), dirz: Math.cos(yaw), impactT: null, burstDone: false, justBurst: false
  };
}
