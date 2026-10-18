import * as THREE from 'three';
import { BALL_R, launchState, stepBall } from '../core/physics.js';
import { lieFactor, WEAPONS } from '../core/weapons.js';
import { clock, state, world } from '../game/state.js';
import { cam } from './camera.js';
import { scene } from './scene.js';

const landMark = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.4, 28), new THREE.MeshBasicMaterial({ color: 0xff3b5c, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false }));
landMark.rotation.x = -Math.PI / 2; landMark.renderOrder = 12; landMark.visible = false; scene.add(landMark);
// The sniper scope shows where the bullet would land at the current power, ignoring wind
export function updateLandMark() {
  const W = WEAPONS[state.weapon], p = state.players[state.cur];
  const on = state.phase === 'aim' && W.id === 'sniper' && state.zoom && cam.arrived && !!p;
  landMark.visible = on; if (!on) return;
  const M = world.M, calm = Object.create(M); calm.wind = null;
  const power = (state.charging ? Math.max(0.04, state.power) : 1) * lieFactor(W, M.surface(p.ball.x, p.ball.z));
  const b = launchState(W, power, state.yaw, state.pitch, p.ball);
  for (let t = 0; t < 4; t += 1 / 120) { stepBall(b, 1 / 120, W, calm, true); if (b.contact) break; }
  landMark.position.set(b.x, (b.contact ? b.y - BALL_R : M.height(b.x, b.z)) + 0.08, b.z);
  const pulse = 1 + Math.sin(clock.t * 8) * 0.08; landMark.scale.set(pulse, pulse, pulse);
}
