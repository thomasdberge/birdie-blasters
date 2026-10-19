// Builds the 3D course for a hole: terrain, scenery, water, trees, crates, stakes and the flag.

import * as THREE from 'three';
import { CUP_R, HOLES, PLATEAU } from '../core/courses.js';
import { courseModel } from '../core/match.js';
import { clamp, rng } from '../core/math.js';
import { clock, world } from '../game/state.js';
import { disposeTree, phong, scene } from './scene.js';

function crateTexture(label) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g = cv.getContext('2d');
  g.fillStyle = '#58652f'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#4b5627'; for (let i = 1; i < 4; i++) g.fillRect(0, i * 32 - 1, 128, 3);
  g.strokeStyle = '#3a4320'; g.lineWidth = 10; g.strokeRect(5, 5, 118, 118);
  g.fillStyle = '#e9e3c0'; g.font = '700 28px "Chakra Petch", monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, 64, 66);
  return new THREE.CanvasTexture(cv);
}
function flagMarkerTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128; const g = cv.getContext('2d');
  g.beginPath(); g.moveTo(64, 120); g.lineTo(40, 86); g.arc(64, 60, 34, Math.PI * 0.75, Math.PI * 0.25); g.closePath();
  g.fillStyle = '#1b2214'; g.fill();
  g.beginPath(); g.arc(64, 60, 28, 0, Math.PI * 2); g.fillStyle = '#f7f6ee'; g.fill();
  g.fillStyle = '#1b2214'; g.fillRect(55, 40, 4, 40);
  g.beginPath(); g.moveTo(59, 40); g.lineTo(84, 49); g.lineTo(59, 58); g.closePath(); g.fillStyle = '#e8322b'; g.fill();
  return new THREE.CanvasTexture(cv);
}

const TC = {
  fairA: new THREE.Color('#6cbf4b'), fairB: new THREE.Color('#60b043'),
  greenA: new THREE.Color('#93da6b'), greenB: new THREE.Color('#86cf5f'),
  rough: new THREE.Color('#4a9238'), oob: new THREE.Color('#7b9a45'), hill: new THREE.Color('#9daa5c'),
  sand: new THREE.Color('#edd9a0'), tee: new THREE.Color('#7fcb5c'), bed: new THREE.Color('#4f7f62')
};
function terrainColor(M, x, y, z, out, r) {
  let wet = false;
  for (const p of M.ponds) if (Math.hypot(x - p.x, z - p.z) < p.r + 6 && y < p.level + 0.05) wet = true;
  const surf = M.surface(x, z);
  if (wet) out.copy(TC.bed);
  else if (surf === 'fairway') out.copy(Math.floor(M.project(x, z).s / 9) % 2 ? TC.fairA : TC.fairB);
  else if (surf === 'green') out.copy(Math.floor((x - z) / 3.2) % 2 ? TC.greenA : TC.greenB);
  else if (surf === 'sand') out.copy(TC.sand);
  else if (surf === 'tee') out.copy(TC.tee);
  else if (surf === 'rough') out.copy(TC.rough);
  else { const e = M.project(x, z).d - M.E; out.copy(TC.oob).lerp(TC.hill, clamp(e / 45, 0, 1)); }
  out.multiplyScalar(0.94 + r * 0.1);
}
export function buildWorld(idx) {
  if (world.group) { scene.remove(world.group); disposeTree(world.group); }
  // The match's course model, wrapped so the turn's wind can be set on it without changing the shared model
  const def = HOLES[idx], M = Object.create(courseModel(idx)), g = new THREE.Group();
  world.M = M; world.group = g; world.waters = []; world.clouds = [];
  // terrain
  const ext = M.ext, W = ext.x1 - ext.x0, D = ext.z1 - ext.z0, cell = 2.5;
  let geo = new THREE.PlaneGeometry(W, D, Math.ceil(W / cell), Math.ceil(D / cell));
  geo.rotateX(-Math.PI / 2); geo.translate((ext.x0 + ext.x1) / 2, 0, (ext.z0 + ext.z1) / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, M.height(pos.getX(i), pos.getZ(i)));
  geo = geo.toNonIndexed(); geo.computeVertexNormals();
  const p2 = geo.attributes.position, cols = new Float32Array(p2.count * 3), col = new THREE.Color(), R = rng(def.seed * 7 + 3);
  for (let i = 0; i < p2.count; i += 3) {
    const cx = (p2.getX(i) + p2.getX(i + 1) + p2.getX(i + 2)) / 3, cy = (p2.getY(i) + p2.getY(i + 1) + p2.getY(i + 2)) / 3, cz = (p2.getZ(i) + p2.getZ(i + 1) + p2.getZ(i + 2)) / 3;
    terrainColor(M, cx, cy, cz, col, R());
    for (let k = 0; k < 3; k++) { cols[(i + k) * 3] = col.r; cols[(i + k) * 3 + 1] = col.g; cols[(i + k) * 3 + 2] = col.b; }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  g.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true })));
  // far ground + mountains
  const mid = { x: (M.tee.x + M.cup.x) / 2, z: (M.tee.z + M.cup.z) / 2 };
  // Far ground: a huge square with a hole where the terrain mesh is, at the plateau height
  const FS = 2400, shape = new THREE.Shape();
  shape.moveTo(mid.x - FS, -(mid.z + FS)); shape.lineTo(mid.x + FS, -(mid.z + FS)); shape.lineTo(mid.x + FS, -(mid.z - FS)); shape.lineTo(mid.x - FS, -(mid.z - FS)); shape.closePath();
  const hole = new THREE.Path(), hx0 = ext.x0 + 3, hx1 = ext.x1 - 3, hy0 = -(ext.z1 - 3), hy1 = -(ext.z0 + 3);
  hole.moveTo(hx0, hy0); hole.lineTo(hx0, hy1); hole.lineTo(hx1, hy1); hole.lineTo(hx1, hy0); hole.closePath();
  shape.holes.push(hole);
  const farGeo = new THREE.ShapeGeometry(shape); farGeo.rotateX(-Math.PI / 2);
  const far = new THREE.Mesh(farGeo, new THREE.MeshLambertMaterial({ color: TC.hill })); far.position.y = PLATEAU - 0.12; g.add(far);
  const mr = rng(def.seed + 99), mtnMat = phong(0x87ab9c);
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * Math.PI * 2 + mr() * 0.2, rad = 470 + mr() * 160, h = 50 + mr() * 90;
    const m = new THREE.Mesh(new THREE.ConeGeometry(55 + mr() * 50, h, 5 + Math.floor(mr() * 3)), mtnMat);
    m.position.set(mid.x + Math.cos(a) * rad, 14 + h / 2, mid.z + Math.sin(a) * rad); m.rotation.y = mr() * 3; g.add(m);
  }
  // clouds
  const cloudMat = phong(0xffffff, { shininess: 0 });
  for (let i = 0; i < 8; i++) {
    const c = new THREE.Group();
    for (let k = 0; k < 4; k++) { const s = new THREE.Mesh(new THREE.IcosahedronGeometry(6 + mr() * 6, 0), cloudMat); s.position.set(k * 7 - 10, mr() * 3, mr() * 6); s.scale.y = 0.6; c.add(s); }
    c.position.set(mid.x + (mr() - 0.5) * 600, 75 + mr() * 40, mid.z + (mr() - 0.5) * 600); c.userData.speed = 1.5 + mr() * 2; c.userData.x0 = mid.x;
    g.add(c); world.clouds.push(c);
  }
  // water
  for (const p of M.ponds) {
    const w = new THREE.Mesh(new THREE.CircleGeometry(p.r + 6, 30), new THREE.MeshPhongMaterial({ color: 0x3aa0d8, transparent: true, opacity: 0.86, shininess: 90, specular: 0x9fdcff, flatShading: true }));
    w.rotation.x = -Math.PI / 2; w.position.set(p.x, p.level, p.z); g.add(w); world.waters.push({ mesh: w, base: p.level });
  }
  // trees
  const trunkMat = phong(0x7a5232), pineMat = phong(0x2f7d3c), roundMat = phong(0x4f9a3a);
  const trunkGeo = new THREE.CylinderGeometry(0.75, 1, 1, 6), pineGeo = new THREE.ConeGeometry(1, 1, 7), roundGeo = new THREE.IcosahedronGeometry(1, 0);
  for (const t of M.trees) {
    const tr = new THREE.Mesh(trunkGeo, trunkMat); tr.scale.set(t.trunkR, t.trunkH + 0.6, t.trunkR); tr.position.set(t.x, t.y0 + (t.trunkH + 0.6) / 2 - 0.3, t.z); g.add(tr);
    if (t.kind === 'pine') { const c = new THREE.Mesh(pineGeo, pineMat); c.scale.set(t.canopyR, t.canopyH, t.canopyR); c.position.set(t.x, t.y0 + t.trunkH + t.canopyH / 2, t.z); c.rotation.y = t.x; g.add(c); }
    else { const c = new THREE.Mesh(roundGeo, roundMat); c.scale.set(t.canopyR * 0.95, t.canopyH * 0.5, t.canopyR * 0.95); c.position.set(t.x, t.y0 + t.trunkH + t.canopyH * 0.4, t.z); c.rotation.y = t.z; g.add(c); }
  }
  // crates
  const crateMats = { 'AMMO': new THREE.MeshLambertMaterial({ map: crateTexture('AMMO') }), '84 MM': new THREE.MeshLambertMaterial({ map: crateTexture('84 MM') }) };
  for (const b of M.boxes) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), crateMats[b.label]);
    m.position.set(b.cx, b.y0 + b.h / 2, b.cz); g.add(m);
  }
  // out-of-bounds stakes
  const stakeGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.5, 5), stakeMat = phong(0xffffff);
  for (let s = 6; s < M.total - 4; s += 14) {
    for (const side of [-1, 1]) {
      const p = M.pointAt(s, side * (M.E + 0.5));
      if (M.project(p.x, p.z).d < M.E - 1) continue;
      if (M.ponds.some(q => Math.hypot(p.x - q.x, p.z - q.z) < q.r + 7)) continue;
      const m = new THREE.Mesh(stakeGeo, stakeMat); m.position.set(p.x, M.height(p.x, p.z) + 0.7, p.z); g.add(m);
    }
  }
  // tee markers
  const teeMat = phong(0xff6b17);
  for (const side of [-1, 1]) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), teeMat); m.position.set(M.tee.x + side * 3.2, M.tee.y + 0.25, M.tee.z - 1); g.add(m); }
  // cup + flag
  const cupM = new THREE.Mesh(new THREE.CircleGeometry(CUP_R, 20), new THREE.MeshBasicMaterial({ color: 0x0d1208 }));
  cupM.rotation.x = -Math.PI / 2; cupM.position.set(M.cup.x, M.cup.y + 0.05, M.cup.z); g.add(cupM);
  const rim = new THREE.Mesh(new THREE.RingGeometry(CUP_R, CUP_R + 0.1, 20), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  rim.rotation.x = -Math.PI / 2; rim.position.set(M.cup.x, M.cup.y + 0.055, M.cup.z); g.add(rim);
  const flag = new THREE.Group(); flag.position.set(M.cup.x + 0.15, M.cup.y, M.cup.z);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 6.5, 6), phong(0xf7f6ee)); pole.position.y = 3.25; flag.add(pole);
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 6.4, 0, 0, 4.9, 0, 2.6, 5.65, 0]), 3)); fg.computeVertexNormals();
  const cloth = new THREE.Mesh(fg, phong(0xe8322b, { side: THREE.DoubleSide })); flag.add(cloth);
  const marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: flagMarkerTexture(), depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true, fog: false }));
  marker.scale.set(0.05, 0.05, 1); marker.center.set(0.5, 0); marker.position.y = 7.2; marker.renderOrder = 9; flag.add(marker);
  g.add(flag); world.flag = { group: flag, cloth, marker };
  scene.add(g);
}

// Per-frame scenery animation
export function animateWorld(dt) {
  if (world.flag) {
    // The flag points downwind and flutters harder in a strong wind
    const w = world.M.wind, sp = w ? w.speed : 0, base = w && sp > 0.3 ? Math.atan2(-w.z, w.x) : 0;
    world.flag.cloth.rotation.y = base + Math.sin(clock.t * (2 + sp * 0.8)) * (0.35 - Math.min(sp, 6) * 0.04);
    world.flag.cloth.scale.x = 1 + Math.sin(clock.t * (5 + sp)) * 0.06;
  }
  for (const w of world.waters) w.mesh.position.y = w.base + Math.sin(clock.t * 1.3) * 0.04;
  for (const c of world.clouds) { c.position.x += c.userData.speed * dt; if (c.position.x > c.userData.x0 + 320) c.position.x = c.userData.x0 - 320; }
}
