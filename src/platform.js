// Browser helpers shared by the rendering and UI code.

export const $ = s => document.querySelector(s);
export const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const COARSE = window.matchMedia && matchMedia('(pointer: coarse)').matches;
export const store = {
  get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
};
// A mouse with pointer lock gives FPS-style aiming. Touch devices keep drag-to-aim and the Fire button.
export const MOUSE = !COARSE && !!window.matchMedia && matchMedia('(pointer: fine)').matches;
