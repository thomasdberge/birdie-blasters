// Browser helpers shared by the rendering and UI code.

export const $ = s => document.querySelector(s);
export const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
export const COARSE = window.matchMedia && matchMedia('(pointer: coarse)').matches;
// Values kept as JSON. The storage can be unavailable (private mode, blocked site data); then nothing is kept.
function jsonStorage(area) {
  return {
    get(k) { try { const v = area().getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set(k, v) { try { area().setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
    remove(k) { try { area().removeItem(k); } catch (e) { /* storage unavailable */ } }
  };
}
export const store = jsonStorage(() => localStorage);
// Kept for this browser tab only, across reloads
export const session = jsonStorage(() => sessionStorage);
// A mouse with pointer lock gives FPS-style aiming. Touch devices keep drag-to-aim and the Fire button.
export const MOUSE = !COARSE && !!window.matchMedia && matchMedia('(pointer: fine)').matches;
// Name tags are drawn in Lilita One, so give the font a moment to load first. The fallback font is fine if it is slow.
export async function labelFont() {
  try { await Promise.race([document.fonts.load('64px "Lilita One"'), new Promise(r => setTimeout(r, 1200))]); } catch (e) { /* fallback font is fine */ }
}
