// Entry point: wires up the UI, runs the main loop and boots the game.

import * as THREE from 'three';
import { STEP } from './core/physics.js';
import { $ } from './platform.js';
import { applyHolds, holds } from './game/aim.js';
import { awayList, holdControls, initOnline, shotClockLeft } from './game/online.js';
import { playShotStep } from './game/shot.js';
import { clock, distToCup, game, state, timers, world } from './game/state.js';
import { cam, fpView, updateCamera } from './render/camera.js';
import { charsSettled, updateChar } from './render/characters.js';
import { updateParts } from './render/particles.js';
import { updateProjectileVisual } from './render/projectiles.js';
import { camera, renderer, resizeRenderer, scene, vmCamera, vmScene } from './render/scene.js';
import { updateLandMark } from './render/scopeMarker.js';
import { updateViewmodel } from './render/viewmodel.js';
import { animateWorld, buildWorld } from './render/world.js';
import { initBag } from './ui/bag.js';
import { ui } from './ui/elements.js';
import { setAway, setClock, setFill, updateWindHUD } from './ui/hud.js';
import { initInput } from './ui/input.js';
import { initLobby } from './ui/lobby.js';
import { buildMapStatic, drawMap, sizeMap } from './ui/minimap.js';
import { initPointerLock, updateLockUI } from './ui/pointerLock.js';
import { updateReticle } from './ui/reticle.js';
import { initSetup } from './ui/setup.js';

const tmpV = new THREE.Vector3();
function resize() { resizeRenderer(); sizeMap(); }

let last = performance.now(), mapTick = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now; clock.t += dt;
  if (state.slowT > 0) { state.slowT -= dt; if (state.slowT <= 0) state.timeScale = 1; }
  const sdt = dt * state.timeScale;
  for (let i = timers.length - 1; i >= 0; i--) { const tm = timers[i]; tm.t -= dt; if (tm.t <= 0) { timers.splice(i, 1); tm.fn(); } }
  if (game.online) holdControls();
  if (state.phase === 'aim') {
    applyHolds(dt);
    if (state.charging) { state.chargeT += dt; const x = (state.chargeT * 0.72) % 2; state.power = x < 1 ? x : 2 - x; setFill(state.power); }
  } else if (holds.size) holds.clear();
  const s = state.shot;
  if (s) s.age += dt;
  if (s && s.active) { s.acc += sdt; let n = 0; while (s.acc >= STEP && s.active && n < 240) { s.acc -= STEP; playShotStep(); n++; } }
  updateProjectileVisual(sdt);
  state.players.forEach(p => updateChar(p.char, sdt, p));
  updateParts(sdt);
  animateWorld(dt);
  if (state.waitFn && charsSettled()) { const f = state.waitFn; state.waitFn = null; f(); }
  updateCamera(dt);
  const inGame = !ui.hud.hidden;
  if (inGame) {
    // Hide any figure whose head is right at the lens (you, in first person), and anyone who has left the game
    for (const p of state.players) { const g = p.char.group; tmpV.set(g.position.x, g.position.y + 2.2, g.position.z); g.visible = !p.out && camera.position.distanceTo(tmpV) > 2.6; }
  }
  // Name tags and the flag marker keep their screen size when zoomed
  const inv = 1 / state.zoomF;
  for (const p of state.players) p.char.label.scale.set(0.15 * inv, 0.0375 * inv, 1);
  if (world.flag) world.flag.marker.scale.set(0.05 * inv, 0.05 * inv, 1);
  updateReticle();
  if (inGame) { updateWindHUD(); updateLandMark(); updateLockUI(); setClock(game.online ? shotClockLeft() : null); setAway(game.online ? awayList() : []); }
  if (inGame && (mapTick++ % 2 === 0)) drawMap();
  if (state.phase === 'aim' && (mapTick % 6 === 0)) { const p = state.players[state.cur]; if (p) $('#hcDist').textContent = Math.round(distToCup(p)); }
  renderer.clear();
  renderer.render(scene, camera);
  const vmOn = inGame && fpView() && state.zoomF < 1.6; // looking through the scope hides the weapon
  updateViewmodel(dt, vmOn);
  if (vmOn) { renderer.clearDepth(); renderer.render(vmScene, vmCamera); }
}

function boot() {
  buildWorld(0); buildMapStatic(); resize();
  cam.pos.set(120, 90, 60);
  requestAnimationFrame(t => { last = t; frame(t); });
}

if (!renderer) {
  $('#glErr').hidden = false;
  for (const id of ['#startBtn', '#createBtn', '#joinBtn']) $(id).disabled = true;
} else {
  window.addEventListener('resize', resize);
  initBag();
  initPointerLock();
  initInput();
  initLobby();
  initOnline();
  initSetup();
  boot();
}
