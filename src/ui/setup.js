// The start screen: player count and names.

import { $, store } from '../platform.js';
import { sfx } from '../audio/sfx.js';
import { state, STYLES } from '../game/state.js';
import { newGame } from '../game/turns.js';

const savedNames = store.get('birdieblasters-names') || [];
function renderNames() {
  const box = $('#names'), prev = [...box.querySelectorAll('input')].map(i => i.value);
  box.innerHTML = '';
  for (let i = 0; i < state.count; i++) {
    const st = STYLES[i], row = document.createElement('div'); row.className = 'nrow';
    const val = prev[i] != null ? prev[i] : (savedNames[i] || st.name);
    row.innerHTML = `<i class="chip" style="background:${st.color}"></i><input id="name${i}" type="text" maxlength="16" autocomplete="off" aria-label="Name of player ${i + 1}"><span class="hat">${st.hatName}</span>`;
    row.querySelector('input').value = val;
    box.appendChild(row);
  }
}
export function initSetup() {
  document.querySelectorAll('#countSeg button').forEach(b => b.addEventListener('click', () => {
    state.count = +b.dataset.n;
    document.querySelectorAll('#countSeg button').forEach(x => x.setAttribute('aria-checked', x === b ? 'true' : 'false'));
    renderNames();
  }));
  const savedCount = store.get('birdieblasters-count');
  if (savedCount >= 1 && savedCount <= 4) { state.count = savedCount; document.querySelectorAll('#countSeg button').forEach(x => x.setAttribute('aria-checked', +x.dataset.n === savedCount ? 'true' : 'false')); }
  renderNames();
  $('#startBtn').addEventListener('click', async () => {
    sfx.unlock();
    const names = [...document.querySelectorAll('#names input')].map((inp, i) => (inp.value.trim() || STYLES[i].name).slice(0, 16));
    store.set('birdieblasters-names', names); store.set('birdieblasters-count', state.count);
    try { await Promise.race([document.fonts.load('64px "Lilita One"'), new Promise(r => setTimeout(r, 1200))]); } catch (e) { /* fallback font is fine */ }
    newGame(names);
  });
}
