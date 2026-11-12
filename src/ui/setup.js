// The start screen: one screen (player count and names) or online.

import { readRoomCode } from '../core/protocol.js';
import { $, labelFont, store } from '../platform.js';
import { sfx } from '../audio/sfx.js';
import { state, STYLES } from '../game/state.js';
import { newGame } from '../game/turns.js';
import { rejoin, showInvite } from './lobby.js';

function setMode(mode) {
  document.querySelectorAll('#modeSeg button').forEach(b => b.setAttribute('aria-checked', b.dataset.mode === mode ? 'true' : 'false'));
  $('#localSetup').hidden = $('#startBtn').hidden = mode !== 'local';
  $('#onlineSetup').hidden = mode !== 'online';
  store.set('birdieblasters-mode', mode);
}

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
  document.querySelectorAll('#modeSeg button').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  // An invite link (?room=CODE) opens the online tab with the code filled in. After a reload it is still in the address
  // bar, and a tab that was playing in that room takes its seat back.
  const invite = readRoomCode(new URLSearchParams(location.search).get('room'));
  setMode(invite || store.get('birdieblasters-mode') === 'online' ? 'online' : 'local');
  if (invite) { showInvite(invite); rejoin(invite); }
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
    await labelFont();
    newGame(names);
  });
}
