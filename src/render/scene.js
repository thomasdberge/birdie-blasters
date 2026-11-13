// Three.js renderer, scene, camera and lights.

import * as THREE from 'three';
import { clamp } from '../core/math.js';
import { $ } from '../platform.js';
import { state } from '../game/state.js';

export const canvas = $('#c');
// Stays null when the browser cannot start WebGL; main.js then shows an error instead of the game
export let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (e) { renderer = null; }
if (renderer) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false;
}
export const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xcfeaf2, 170, 760);
export const camera = new THREE.PerspectiveCamera(55, 1, 0.3, 2500);
scene.add(new THREE.HemisphereLight(0xe2f4ff, 0x56763a, 0.58));
const sun = new THREE.DirectionalLight(0xfff1d2, 0.62); sun.position.set(60, 120, 40); scene.add(sun);

// First-person weapon ("viewmodel"): its own little scene and camera, drawn on top of the world
export const vmScene = new THREE.Scene(), vmCamera = new THREE.PerspectiveCamera(55, 1, 0.05, 20), vmRoot = new THREE.Group();
vmScene.add(new THREE.HemisphereLight(0xe2f4ff, 0x56763a, 0.7));
const vmSun = new THREE.DirectionalLight(0xfff1d2, 0.6); vmSun.position.set(1, 2, 1.5); vmScene.add(vmSun);
vmScene.add(vmRoot);
// The cameras' field of view is vertical. It follows from a sideways view of FOV_WIDE°, kept between FOV_MIN° and
// FOV_MAX° tall. Screens wider than 1.35:1 (desktops, phones held sideways) get exactly 55° and see 85–95° sideways. A
// phone held upright gets 95° and sees 55–65° sideways, where 55° would leave it 30–40°; beyond 95° the edges stretch
// too much.
const FOV_WIDE = 70, FOV_MIN = 55, FOV_MAX = 95;
// Zooming narrows the view from at most ZOOM_FROM° tall, what a phone held upright had before its view widened, so the
// scope magnifies distant players there as much as it did. Screens with 55° divide that by the weapon's zoom.
const ZOOM_FROM = 64;
export let baseFov = FOV_MIN;
// The world camera's field of view at zoom factor zf: 1 unzoomed, up to the weapon's zoom (3 or more)
export function viewFov(zf) {
  return (baseFov + (Math.min(baseFov, ZOOM_FROM) - baseFov) * clamp((zf - 1) / 2, 0, 1)) / zf;
}
export function resizeRenderer() {
  const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  baseFov = clamp(2 * Math.atan(Math.tan(FOV_WIDE * Math.PI / 360) * h / w) * 180 / Math.PI, FOV_MIN, FOV_MAX);
  camera.aspect = w / h; camera.fov = viewFov(state.zoomF); camera.updateProjectionMatrix();
  vmCamera.aspect = w / h; vmCamera.fov = baseFov; vmCamera.updateProjectionMatrix();
}

export function phong(color, extra) { return new THREE.MeshPhongMaterial(Object.assign({ color, flatShading: true, shininess: 10 }, extra || {})); }
export function disposeTree(o) {
  o.traverse(n => {
    if (n.geometry) n.geometry.dispose();
    if (n.material) { const ms = Array.isArray(n.material) ? n.material : [n.material]; ms.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); }
  });
}
