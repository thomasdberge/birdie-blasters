// Sound effects, synthesised with Web Audio.

import { store } from '../platform.js';

export const sfx = (() => {
  let ac = null, master = null, noiseBuf = null, muted = !!store.get('birdieblasters-muted');
  function ctx() {
    if (muted) return null;
    if (!ac) {
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        master = ac.createGain(); master.gain.value = 0.5; master.connect(ac.destination);
        noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
        const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      } catch (e) { ac = null; return null; }
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function noise(dur, type, freq, gain, q, freqEnd, delay) {
    const a = ctx(); if (!a) return;
    const t = a.currentTime + (delay || 0), s = a.createBufferSource(); s.buffer = noiseBuf;
    const f = a.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q || 1;
    const g = a.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.05);
  }
  function tone(f0, f1, dur, type, gain, delay) {
    const a = ctx(); if (!a) return;
    const t = a.currentTime + (delay || 0), o = a.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = a.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
  return {
    unlock() { ctx(); },
    get muted() { return muted; },
    setMuted(m) { muted = m; store.set('birdieblasters-muted', m); if (ac) { try { m ? ac.suspend() : ac.resume(); } catch (e) { /* ignore */ } } if (!m) ctx(); },
    shot(id) {
      if (id === 'bazooka') { noise(0.7, 'lowpass', 1000, 0.9, 1, 160); tone(150, 45, 0.45, 'sine', 0.6); }
      else if (id === 'grenade') { tone(190, 70, 0.28, 'sine', 0.55); noise(0.3, 'lowpass', 700, 0.6); }
      else if (id === 'sniper') { noise(0.45, 'highpass', 900, 0.95); tone(1200, 180, 0.22, 'square', 0.1); }
      else if (id === 'auto') { for (let k = 0; k < 3; k++) noise(0.12, 'bandpass', 1600, 0.75, 0.8, null, k * 0.09); }
      else if (id === 'shotgun') { noise(0.55, 'lowpass', 1500, 1.0, 0.7, 260); tone(110, 50, 0.3, 'sine', 0.5); }
      else if (id === 'pistol') { noise(0.16, 'bandpass', 1800, 0.75, 0.8); }
      else if (id === 'flare') { noise(0.7, 'bandpass', 700, 0.5, 0.8, 2600); tone(300, 900, 0.4, 'sine', 0.14); }
      else { noise(0.12, 'bandpass', 1300, 0.45, 1.5, 500); tone(220, 120, 0.08, 'sine', 0.25); } // dart blaster "pfft"
    },
    burst() { tone(260, 900, 0.35, 'sine', 0.35); noise(0.25, 'bandpass', 2000, 0.3); },
    boom() { noise(1.4, 'lowpass', 800, 1.0, 0.7, 80); tone(95, 28, 0.9, 'sine', 0.8); },
    bounce(v) { tone(240 + v * 8, 110, 0.07, 'sine', Math.min(0.25, 0.03 + v * 0.012)); },
    bonk() { tone(380, 900, 0.14, 'square', 0.16); tone(900, 480, 0.14, 'triangle', 0.22, 0.08); },
    ding() { tone(1400, 1400, 0.55, 'sine', 0.25); tone(2100, 2100, 0.45, 'sine', 0.12, 0.02); noise(0.1, 'highpass', 2500, 0.4); },
    splash() { noise(0.8, 'bandpass', 900, 0.75, 0.6, 260); },
    cup() { tone(1046, 1046, 0.16, 'sine', 0.3); tone(1318, 1318, 0.16, 'sine', 0.3, 0.12); tone(1568, 1568, 0.32, 'sine', 0.3, 0.24); },
    poof() { noise(0.2, 'bandpass', 2200, 0.16, 1.2); },
    miss() { tone(300, 150, 0.35, 'sawtooth', 0.08); }
  };
})();
