import * as THREE from 'three';
import { REDUCED } from '../platform.js';
import { clock } from '../game/state.js';
import { aimOffset } from './camera.js';
import { phong, vmRoot } from './scene.js';
import { makeWeaponModels } from './weaponModels.js';

// Weapons as seen in first person: bottom right of the screen, with chunky fists in the player's colour
export const vm = { models: {}, handMat: phong(0xff5fa2), recoil: 0, switchT: 0, current: null };
(function buildViewmodel() {
  const src = makeWeaponModels();
  const fist = (x, y, z, s) => { const h = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1 * (s || 1), 1), vm.handMat); h.position.set(x, y, z); return h; };
  const place = { // [x, y, z, scale] in camera space, plus fist positions in the weapon's own space
    bazooka: [0.42, -0.34, -0.85, 0.66, [[0, -0.32, 0.12, 1.3], [-0.05, -0.2, 0.62, 1.2]]],
    grenade:  [0.3, -0.3, -0.78, 0.8, [[0, -0.26, -0.1, 1.2], [0, -0.12, 0.42, 1.1]]],
    sniper:  [0.24, -0.27, -0.62, 0.8, [[0.02, -0.16, -0.08, 1.2], [0, -0.1, 0.6, 1.1]]],
    auto:    [0.25, -0.28, -0.66, 0.82, [[0, -0.2, -0.04, 1.2], [0, -0.1, 0.5, 1.1]]],
    shotgun:   [0.25, -0.28, -0.68, 0.82, [[0, -0.18, -0.12, 1.2], [0, -0.13, 0.42, 1.1]]],
    pistol:  [0.2, -0.24, -0.55, 1.15, [[0, -0.24, -0.02, 1.2]]],
    flare:   [0.22, -0.26, -0.62, 1.0, [[0, -0.24, -0.06, 1.2]]],
    dart:    [0.27, -0.28, -0.8, 0.78, [[0, -0.24, -0.06, 1.3]]]
  };
  for (const [id, model] of Object.entries(src)) {
    const [x, y, z, s, fists] = place[id];
    const wrap = new THREE.Group();
    model.position.set(0, 0, 0); model.visible = true; wrap.add(model);
    for (const f of fists) model.add(fist(f[0], f[1], f[2], f[3]));
    wrap.rotation.y = Math.PI; wrap.position.set(x, y, z); wrap.scale.setScalar(s); wrap.visible = false;
    vmRoot.add(wrap); vm.models[id] = wrap;
  }
})();
export function vmShow(id) {
  if (vm.current === id) return;
  if (vm.current) vm.switchT = 1;
  Object.entries(vm.models).forEach(([k, w]) => { w.visible = k === id; });
  vm.current = id;
}
export function updateViewmodel(dt, visible) {
  vmRoot.visible = visible;
  if (!visible) return;
  vm.recoil = Math.max(0, vm.recoil - dt * 3.5); vm.switchT = Math.max(0, vm.switchT - dt * 4);
  const sw = REDUCED ? 0 : 1;
  vmRoot.position.set(Math.sin(clock.t * 1.7) * 0.006 * sw, Math.sin(clock.t * 3.4) * 0.005 * sw - vm.switchT * 0.35, vm.recoil * 0.18);
  vmRoot.rotation.set(vm.recoil * 0.35, 0, 0);
  const w = vm.models[vm.current]; if (w) w.rotation.x = aimOffset() * Math.PI / 180 * 0.9; // barrel tilts up toward the raised crosshair
}
