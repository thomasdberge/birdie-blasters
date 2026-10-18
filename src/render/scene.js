// Three.js renderer, scene, camera and lights.

import * as THREE from 'three';
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
export let baseFov = 55;
export function resizeRenderer() {
  const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  baseFov = w / h < 0.8 ? 64 : 55;
  camera.aspect = w / h; camera.fov = baseFov / state.zoomF; camera.updateProjectionMatrix();
  vmCamera.aspect = w / h; vmCamera.fov = baseFov; vmCamera.updateProjectionMatrix();
}

export function phong(color, extra) { return new THREE.MeshPhongMaterial(Object.assign({ color, flatShading: true, shininess: 10 }, extra || {})); }
export function disposeTree(o) {
  o.traverse(n => {
    if (n.geometry) n.geometry.dispose();
    if (n.material) { const ms = Array.isArray(n.material) ? n.material : [n.material]; ms.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); }
  });
}
