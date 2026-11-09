// The worm, the sand and the drone bed are synthesised in the browser.
// Three recorded samples sit on top: two layered explosions for the haulers and a desert wind ambience.
export class Sound {
  constructor() { this.ctx = null; this.muted = false; }
  // clock can be driven from outside so the same graph renders offline, frame-locked, for video capture
  now() { return this.clock ?? this.ctx.currentTime; }
  start(ctx) {
    if (this.ctx) { this.ctx.resume?.(); return; }
    const C = this.ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const comp = C.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 5; comp.attack.value = 0.005; comp.release.value = 0.25;
    this.master = C.createGain(); this.master.gain.value = 0.9; this.master.connect(comp); comp.connect(C.destination);
    const len = C.sampleRate * 3, buf = C.createBuffer(1, len, C.sampleRate), d = buf.getChannelData(0); let b = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = (b + 0.02 * w) / 1.02; d[i] = w * 0.35 + b * 2.2; }
    this.noise = buf;
    const loop = (type, freq, q, gain) => {
      const s = C.createBufferSource(); s.buffer = buf; s.loop = true; s.playbackRate.value = 0.8 + Math.random() * 0.4;
      const f = C.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; const g = C.createGain(); g.gain.value = gain;
      s.connect(f); f.connect(g); g.connect(this.master); s.start(); return { f, g };
    };
    this.rumble = loop('lowpass', 85, 0.7, 0); this.hiss = loop('bandpass', 2600, 0.5, 0); this.under = loop('lowpass', 140, 2, 0);
    // recorded layers (levels set from measured loudness: explosions peak at 0 / -1 dBFS, ambience sits at -17 LUFS)
    this.samples = {}; this.amb = C.createGain(); this.amb.gain.value = 0; this.amb.connect(this.master);
    const load = async (name) => { try { const r = await fetch(`./assets/${name}.wav`); this.samples[name] = await C.decodeAudioData(await r.arrayBuffer()); } catch (e) { console.warn('sample missing: ' + name, e); } };
    load('explosion-a'); load('explosion-b');
    load('ambience-desert').then(() => { const b = this.samples['ambience-desert']; if (!b) return; const s = C.createBufferSource(); s.buffer = b; s.loop = true; s.connect(this.amb); s.start(); this.set(this.amb.gain, 0.34, 1.5); });
    // sub tone that swells with the worm
    this.sub = C.createOscillator(); this.sub.type = 'sine'; this.sub.frequency.value = 37; this.subG = C.createGain(); this.subG.gain.value = 0;
    const lfo = C.createOscillator(); lfo.frequency.value = 5.2; const lg = C.createGain(); lg.gain.value = 0.35; lfo.connect(lg); lg.connect(this.subG.gain); lfo.start();
    this.sub.connect(this.subG); this.subG.connect(this.master); this.sub.start();
    // slow drone bed
    const pad = C.createGain(); pad.gain.value = 0.045; const pf = C.createBiquadFilter(); pf.type = 'lowpass'; pf.frequency.value = 260; pf.Q.value = 1.2; pf.connect(pad); pad.connect(this.master);
    for (const [f, det] of [[36.71, -4], [55, 3], [73.42, 6], [110.2, -7]]) { const o = C.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det; o.connect(pf); o.start(); }
    const pl = C.createOscillator(); pl.frequency.value = 0.07; const plg = C.createGain(); plg.gain.value = 110; pl.connect(plg); plg.connect(pf.frequency); pl.start();
  }
  set(k, v, tc = 0.12) { if (this.ctx) k.setTargetAtTime(v, this.now(), tc); }
  // speed 0..1, surface: how much of the body is cutting sand, depth: 0 at surface .. 1 fully under
  update(speed, surface, depth) {
    if (!this.ctx) return;
    this.set(this.rumble.g.gain, 0.3 + 0.5 * speed * (0.4 + 0.6 * surface)); this.set(this.hiss.g.gain, 0.085 * surface * speed);
    this.set(this.subG.gain, 0.12 + 0.3 * depth); this.set(this.under.g.gain, 0.5 * depth); this.set(this.sub.frequency, 37 + 9 * speed - 8 * depth);
    this.set(this.amb.gain, this.samples['ambience-desert'] ? 0.34 * (1 - 0.7 * depth) : 0, 0.4);
  }
  burst({ dur = 0.5, f0 = 800, f1 = 200, q = 1, gain = 0.6, type = 'bandpass' }) {
    const C = this.ctx, t = this.now(), s = C.createBufferSource(); s.buffer = this.noise; s.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = C.createBiquadFilter(); f.type = type; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = C.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random() * 2); s.stop(t + dur + 0.05);
  }
  tone(freq, dur, gain, type = 'sine', slide = 1) {
    const C = this.ctx, t = this.now(), o = C.createOscillator(), g = C.createGain(); o.type = type; o.frequency.setValueAtTime(freq, t); o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  play(name, gain, rate = 1, delay = 0) {
    const b = this.samples[name]; if (!b) return false; const C = this.ctx, s = C.createBufferSource(), g = C.createGain();
    s.buffer = b; s.playbackRate.value = rate; g.gain.value = gain; s.connect(g); g.connect(this.master); s.start(this.now() + delay); return true;
  }
  // hauler destroyed: the two recorded explosions layered, slightly detuned so repeats do not sound identical
  crunch() {
    if (!this.ctx) return;
    const a = this.play('explosion-a', 0.5, 0.94 + Math.random() * 0.12), b = this.play('explosion-b', 0.5, 0.9 + Math.random() * 0.14, 0.03);
    if (!a && !b) { this.burst({ dur: 0.55, f0: 2400, f1: 300, q: 0.8, gain: 0.9 }); this.tone(64, 0.7, 0.9, 'sine', 0.45); }
  }
  breach() { if (!this.ctx) return; this.burst({ dur: 1.5, f0: 260, f1: 1900, q: 0.7, gain: 0.7 }); this.tone(48, 1.1, 0.8, 'sine', 0.55); }
  land() { if (!this.ctx) return; this.burst({ dur: 1.2, f0: 900, f1: 90, q: 0.5, gain: 0.85, type: 'lowpass' }); this.tone(42, 0.9, 0.9, 'sine', 0.6); }
  dive() { if (!this.ctx) return; this.burst({ dur: 0.9, f0: 1500, f1: 160, q: 0.8, gain: 0.5 }); }
  horn() { if (!this.ctx) return; this.tone(185, 0.9, 0.07, 'sawtooth', 1); this.tone(233, 0.9, 0.06, 'sawtooth', 1); }
  toggle() { this.muted = !this.muted; if (this.ctx) this.set(this.master.gain, this.muted ? 0 : 0.9, 0.05); return this.muted; }
}
