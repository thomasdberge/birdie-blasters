// Low-poly weapon models, shared by the characters and the first-person view.

import * as THREE from 'three';
import { phong } from './scene.js';

export function makeWeaponModels() {
  const m = {}, dark = phong(0x2a2f24), metal = phong(0x50574a);
  const bz = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 1.9, 10), phong(0x5b7a2e)); tube.rotation.x = Math.PI / 2; bz.add(tube);
  for (const z of [-0.95, 0.95]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.18, 10), phong(0x2d3a18)); r.rotation.x = Math.PI / 2; r.position.z = z; bz.add(r); }
  const bg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.32, 0.12), dark); bg.position.set(0, -0.24, 0.15); bz.add(bg);
  const bs = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.22), dark); bs.position.set(-0.15, 0.18, 0.35); bz.add(bs);
  bz.position.set(0.42, 0.45, -0.45); m.bazooka = bz;
  const wood = phong(0x8a5a32), tan = phong(0xb79b6b);
  const box = (g, w, h, d, mat, x, y, z, rx) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); o.position.set(x, y, z); if (rx) o.rotation.x = rx; g.add(o); return o; };
  const pipe = (g, r, len, mat, x, y, z) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat); o.rotation.x = Math.PI / 2; o.position.set(x, y, z); g.add(o); return o; };
  // Grenade launcher: stubby fat barrel and a revolving drum
  const gl = new THREE.Group(), olive = phong(0x556b2f);
  box(gl, 0.18, 0.2, 0.5, olive, 0, 0, 0.05); pipe(gl, 0.11, 0.48, dark, 0, 0.02, 0.5);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.16, 10), metal); drum.rotation.z = Math.PI / 2; drum.rotation.y = Math.PI / 2; drum.position.set(0, -0.06, 0.08); gl.add(drum);
  box(gl, 0.1, 0.26, 0.12, dark, 0, -0.2, -0.08, -0.3); box(gl, 0.1, 0.16, 0.36, olive, 0, -0.02, -0.36);
  gl.position.set(0.18, 0.1, 0); m.grenade = gl;
  // Sniper rifle: long barrel, big scope
  const sn = new THREE.Group();
  box(sn, 0.12, 0.22, 0.62, wood, 0, -0.02, -0.28); box(sn, 0.13, 0.15, 0.55, dark, 0, 0, 0.25);
  pipe(sn, 0.042, 1.5, metal, 0, 0.02, 1.2); pipe(sn, 0.085, 0.6, dark, 0, 0.17, 0.25);
  pipe(sn, 0.1, 0.06, metal, 0, 0.17, 0.56); pipe(sn, 0.095, 0.06, metal, 0, 0.17, -0.04);
  sn.position.set(0.18, 0.1, 0); m.sniper = sn;
  // Assault rifle: dark body, tan furniture, curved magazine
  const ar = new THREE.Group();
  box(ar, 0.12, 0.18, 0.62, dark, 0, 0, 0.15); pipe(ar, 0.035, 0.55, metal, 0, 0.02, 0.72);
  box(ar, 0.13, 0.12, 0.32, tan, 0, -0.02, 0.5); box(ar, 0.11, 0.2, 0.42, tan, 0, -0.04, -0.33);
  box(ar, 0.09, 0.32, 0.13, metal, 0, -0.24, 0.24, 0.3); box(ar, 0.09, 0.24, 0.11, tan, 0, -0.17, -0.02, -0.3);
  ar.position.set(0.18, 0.1, 0); m.auto = ar;
  // Shotgun: two barrels side by side, wooden stock and forend
  const sg = new THREE.Group();
  pipe(sg, 0.05, 1.0, metal, -0.05, 0.03, 0.55); pipe(sg, 0.05, 1.0, metal, 0.05, 0.03, 0.55);
  box(sg, 0.16, 0.12, 0.34, wood, 0, -0.05, 0.42); box(sg, 0.14, 0.14, 0.2, dark, 0, 0, 0.0); box(sg, 0.12, 0.22, 0.55, wood, 0, -0.07, -0.33, 0.12);
  sg.position.set(0.18, 0.1, 0); m.shotgun = sg;
  // Flare gun: chunky orange plastic, very wide short barrel
  const fl = new THREE.Group(), orange = phong(0xff6b17);
  pipe(fl, 0.09, 0.34, orange, 0, 0.02, 0.22); box(fl, 0.14, 0.14, 0.22, orange, 0, 0, -0.02);
  box(fl, 0.11, 0.28, 0.14, orange, 0, -0.19, -0.06, -0.3); pipe(fl, 0.06, 0.02, dark, 0, 0.02, 0.4);
  fl.position.set(0.05, 0.05, 0.05); m.flare = fl;
  const ps = new THREE.Group();
  const pb = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.13, 0.45), metal); pb.position.z = 0.2; ps.add(pb);
  const pg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.26, 0.13), dark); pg.position.set(0, -0.15, 0.02); pg.rotation.x = -0.25; ps.add(pg);
  ps.position.set(0.05, 0.05, 0.05); m.pistol = ps;
  // Toy dart blaster: orange body, yellow barrel, blue grip, a foam dart poking out
  const dt = new THREE.Group();
  const db = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.2, 0.5), phong(0xff8a1f)); db.position.z = 0.1; dt.add(db);
  const dbar = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.34, 10), phong(0xffd447)); dbar.rotation.x = Math.PI / 2; dbar.position.z = 0.48; dt.add(dbar);
  const dg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.28, 0.14), phong(0x2f6fe0)); dg.position.set(0, -0.2, -0.04); dg.rotation.x = -0.3; dt.add(dg);
  const dh = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.26), phong(0xffd447)); dh.position.set(0, 0.14, -0.02); dt.add(dh);
  const foam = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.22, 8), phong(0x3db8ff)); foam.rotation.x = Math.PI / 2; foam.position.z = 0.7; dt.add(foam);
  const tipM = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), phong(0xff6b17)); tipM.position.z = 0.82; dt.add(tipM);
  dt.position.set(0.05, 0.05, 0.02); m.dart = dt;
  return m;
}
