// Playing online: the nickname, creating a room or joining one by code or invite link, and the lobby.

import { MAX_SEATS } from '../core/match.js';
import { cleanName, readRoomCode, REJECT } from '../core/protocol.js';
import { $, COARSE, store } from '../platform.js';
import { sfx } from '../audio/sfx.js';
import { STYLES } from '../game/state.js';
import { createRoom, explain, joinRoom } from '../net/online.js';

const el = {
  setup: $('#setup'), lobby: $('#lobby'), name: $('#onlineName'), code: $('#joinCode'), create: $('#createBtn'), join: $('#joinBtn'),
  invited: $('#invited'), err: $('#onlineErr'), roomCode: $('#lobbyCode'), inviteBtn: $('#inviteBtn'), link: $('#inviteLink'),
  players: $('#lobbyPlayers'), status: $('#lobbyStatus'), start: $('#lobbyStart'), leave: $('#lobbyLeave')
};
let room = null, leaving = false, invite = null, flashTO = 0;

const inviteLink = code => `${location.origin}${location.pathname}?room=${code}`;
// Phones get the share sheet; computers copy the link
const inviteLabel = () => (COARSE && navigator.share ? 'Share invite link' : 'Copy invite link');
function showError(message) { el.err.textContent = message || ''; el.err.hidden = !message; }

// An invite link (?room=K7QXM) fills in the code and makes joining the main action
export function showInvite(code) {
  invite = code;
  el.code.value = code;
  el.invited.textContent = `You’re invited to room ${code}. Pick a nickname and join.`;
  el.invited.hidden = false;
  el.join.className = 'btn-primary'; el.create.className = 'btn-line';
  if (!el.name.value) el.name.focus({ preventScroll: true });
}

function nickname() {
  const name = cleanName(el.name.value);
  if (!name) { showError(REJECT.name.message); el.name.focus(); }
  return name;
}
function create() {
  sfx.unlock();
  const name = nickname();
  if (name) enter(createRoom(name), name);
}
function join() {
  sfx.unlock();
  const name = nickname();
  if (!name) return;
  const code = readRoomCode(el.code.value);
  if (!code) { showError('Room codes are 5 letters and digits, like K7QXM.'); el.code.focus(); return; }
  enter(joinRoom(code, name), name);
}
async function enter(request, name) {
  showError('');
  el.create.disabled = el.join.disabled = true;
  try { room = await request; } catch (e) { showError(explain(e)); return; } finally { el.create.disabled = el.join.disabled = false; }
  store.set('birdieblasters-online-name', name);
  leaving = false;
  history.replaceState(null, '', inviteLink(room.roomId)); // the address bar doubles as the invite link
  el.setup.hidden = true; el.lobby.hidden = false; el.link.hidden = true; el.inviteBtn.textContent = inviteLabel();
  room.onStateChange(render);
  room.onLeave(() => { const lost = !leaving; room = null; backToSetup(lost ? 'You lost the connection to the room.' : ''); });
  render(room.state);
}
function backToSetup(message) {
  history.replaceState(null, '', location.pathname);
  el.lobby.hidden = true; el.setup.hidden = false;
  showError(message);
}
async function leaveRoom() {
  leaving = true;
  try { if (room) await room.leave(); } catch (e) { backToSetup(''); }
}

function render(s) {
  if (!room || !s || !s.seats) return;
  const me = room.sessionId, seats = [...s.seats], playing = s.phase === 'playing', isHost = s.host === me;
  el.roomCode.textContent = s.code;
  const rows = seats.map(seat => playerRow(seat, seat.sessionId === s.host, seat.sessionId === me));
  for (let i = seats.length; i < MAX_SEATS; i++) { const li = document.createElement('li'); li.className = 'open'; li.textContent = 'Open seat'; rows.push(li); }
  el.players.replaceChildren(...rows);
  const needed = s.minPlayers - seats.length, host = seats.find(x => x.sessionId === s.host);
  el.status.textContent = playing ? 'Starting the game…'
    : !isHost ? `Waiting for ${host ? host.name : 'the host'} to start the game.`
    : needed > 0 ? `Waiting for ${needed === 1 ? 'one more player' : `${needed} more players`}. Send them the invite link.`
    : 'Everyone here? Start the game.';
  el.start.hidden = !isHost || playing;
  el.start.disabled = needed > 0;
  el.inviteBtn.hidden = playing;
}
function playerRow(seat, host, you) {
  const li = document.createElement('li'), st = STYLES[seat.style] || STYLES[0];
  const chip = document.createElement('i'), name = document.createElement('span'), hat = document.createElement('span');
  chip.className = 'chip'; chip.style.background = st.color;
  name.className = 'pname'; name.textContent = seat.name;
  hat.className = 'hat'; hat.textContent = st.hatName;
  li.append(chip, name, hat);
  if (host) li.append(tag('Host', 'tag'));
  if (you) li.append(tag('You', 'tag you'));
  return li;
}
function tag(text, cls) { const t = document.createElement('span'); t.className = cls; t.textContent = text; return t; }

async function shareInvite() {
  sfx.unlock();
  const link = inviteLink(room.roomId);
  if (COARSE && navigator.share) {
    try { await navigator.share({ title: 'Birdie Blasters', text: `Join my game of Birdie Blasters. Room code ${room.roomId}`, url: link }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  if (navigator.clipboard && window.isSecureContext) {
    try { await navigator.clipboard.writeText(link); flashInvite('Link copied'); return; } catch (e) { /* show the link instead */ }
  }
  // No share sheet or clipboard (e.g. a plain-http address on the local network): show the link, selected, to copy by hand
  el.link.value = link; el.link.hidden = false; el.link.focus(); el.link.select();
}
function flashInvite(text) {
  el.inviteBtn.textContent = text;
  clearTimeout(flashTO); flashTO = setTimeout(() => { el.inviteBtn.textContent = inviteLabel(); }, 2000);
}

export function initLobby() {
  // The name used last time in this browser; a friend on a new device types their own
  el.name.value = store.get('birdieblasters-online-name') || (store.get('birdieblasters-names') || [])[0] || '';
  el.create.addEventListener('click', create);
  el.join.addEventListener('click', join);
  el.name.addEventListener('keydown', e => { if (e.key === 'Enter') (invite ? join : create)(); });
  el.code.addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
  el.inviteBtn.addEventListener('click', shareInvite);
  el.start.addEventListener('click', () => { sfx.unlock(); if (room) room.send('start'); });
  el.leave.addEventListener('click', leaveRoom);
}
