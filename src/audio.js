// On-the-fly engine sound synthesis with the Web Audio API.
// The engine voice is built from the car's real state each frame:
//   fundamental = rpm/60 * cylinders/2   (firing frequency)
// Upgrades change the voice: exhaust opens the lowpass filter and adds growl,
// induction adds a turbo/supercharger whine, bigger motors get more sub.

let ctx = null;

export function audioContext() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function noiseBuffer(c) {
  const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
let sharedNoise = null;

export class EngineVoice {
  // spec: { cyl, bright (0..1 exhaust), whine (0..1 induction), sub (0..1 displacement) }
  constructor(spec, volume = 0.5) {
    const c = audioContext();
    this.c = c;
    this.spec = spec;
    if (!sharedNoise) sharedNoise = noiseBuffer(c);

    this.master = c.createGain();
    this.master.gain.value = 0;
    this.targetVolume = volume;

    // tone chain: oscillators -> waveshaper (growl) -> lowpass -> master
    this.lp = c.createBiquadFilter();
    this.lp.type = "lowpass";
    this.lp.frequency.value = 400;
    this.lp.Q.value = 1.2;

    this.shaper = c.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2);
    }
    this.shaper.curve = curve;
    this.shaper.connect(this.lp);
    this.lp.connect(this.master);
    this.master.connect(c.destination);

    const mkOsc = (type, gain) => {
      const o = c.createOscillator();
      o.type = type;
      const g = c.createGain();
      g.gain.value = gain;
      o.connect(g); g.connect(this.shaper);
      o.start();
      return { o, g };
    };
    this.oscA = mkOsc("sawtooth", 0.30);           // firing fundamental
    this.oscB = mkOsc("sawtooth", 0.22);           // detuned pair — thickness
    this.oscB.o.detune.value = 12;
    this.oscSub = mkOsc("square", 0.16 + 0.14 * (spec.sub ?? 0.5)); // half-order rumble
    this.oscHi = mkOsc("sawtooth", 0.05);          // 2nd order edge

    // exhaust rasp: noise through bandpass, keyed to throttle
    this.noise = c.createBufferSource();
    this.noise.buffer = sharedNoise;
    this.noise.loop = true;
    this.bp = c.createBiquadFilter();
    this.bp.type = "bandpass";
    this.bp.frequency.value = 300;
    this.bp.Q.value = 0.8;
    this.noiseGain = c.createGain();
    this.noiseGain.gain.value = 0;
    this.noise.connect(this.bp); this.bp.connect(this.noiseGain); this.noiseGain.connect(this.lp);
    this.noise.start();

    // forced-induction whine
    this.whineOsc = c.createOscillator();
    this.whineOsc.type = "sine";
    this.whineGain = c.createGain();
    this.whineGain.gain.value = 0;
    this.whineOsc.connect(this.whineGain); this.whineGain.connect(this.master);
    this.whineOsc.start();

    this.running = false;
  }

  setSpec(spec) { this.spec = spec; }

  start() { this.running = true; }

  // rpm: engine speed; throttle 0..1; volume scale 0..1 (distance attenuation for AI)
  update(rpm, throttle, volScale = 1) {
    const c = this.c, t = c.currentTime, k = 0.045;
    if (!this.running) { this.master.gain.setTargetAtTime(0, t, 0.1); return; }
    const s = this.spec;
    const f = Math.max(20, (rpm / 60) * (s.cyl / 2));

    this.oscA.o.frequency.setTargetAtTime(f, t, k);
    this.oscB.o.frequency.setTargetAtTime(f, t, k);
    this.oscSub.o.frequency.setTargetAtTime(f / 2, t, k);
    this.oscHi.o.frequency.setTargetAtTime(f * 2, t, k);

    // filter opens with rpm + throttle + exhaust upgrade
    const bright = 0.35 + 0.65 * (s.bright ?? 0);
    const cutoff = 180 + rpm * (0.28 + 0.5 * bright) * (0.55 + 0.45 * throttle);
    this.lp.frequency.setTargetAtTime(Math.min(cutoff, 9000), t, k);

    // exhaust rasp follows throttle, brighter pipes = more rasp
    this.bp.frequency.setTargetAtTime(200 + rpm * 0.35, t, k);
    this.noiseGain.gain.setTargetAtTime(throttle * (0.04 + 0.11 * (s.bright ?? 0)), t, k);

    // whine: pitch tracks rpm way above the fundamental
    const wl = s.whine ?? 0;
    if (wl > 0) {
      this.whineOsc.frequency.setTargetAtTime(Math.min(rpm * 1.9, 9500), t, k);
      this.whineGain.gain.setTargetAtTime(wl * (0.008 + 0.03 * throttle), t, k);
    } else {
      this.whineGain.gain.setTargetAtTime(0, t, k);
    }

    // overall loudness: idle burble -> full song
    const load = 0.4 + 0.6 * throttle;
    this.master.gain.setTargetAtTime(this.targetVolume * load * volScale, t, 0.08);
  }

  stop() {
    this.running = false;
    this.master.gain.setTargetAtTime(0, this.c.currentTime, 0.15);
  }

  dispose() {
    this.stop();
    setTimeout(() => {
      for (const n of [this.oscA.o, this.oscB.o, this.oscSub.o, this.oscHi.o, this.noise, this.whineOsc]) {
        try { n.stop(); } catch {}
      }
      this.master.disconnect();
    }, 400);
  }
}

// ---------- one-shot / utility sounds ----------

export class SkidSound {
  constructor() {
    const c = audioContext();
    if (!sharedNoise) sharedNoise = noiseBuffer(c);
    this.src = c.createBufferSource();
    this.src.buffer = sharedNoise; this.src.loop = true;
    this.filter = c.createBiquadFilter();
    this.filter.type = "bandpass"; this.filter.frequency.value = 900; this.filter.Q.value = 2.5;
    this.gain = c.createGain(); this.gain.gain.value = 0;
    this.src.connect(this.filter); this.filter.connect(this.gain); this.gain.connect(c.destination);
    this.src.start();
    this.c = c;
  }
  update(intensity) { // 0..1
    const t = this.c.currentTime;
    this.filter.frequency.setTargetAtTime(700 + intensity * 500, t, 0.05);
    this.gain.gain.setTargetAtTime(intensity * 0.12, t, 0.04);
  }
}

export class RumbleSound {
  constructor() {
    const c = audioContext();
    if (!sharedNoise) sharedNoise = noiseBuffer(c);
    this.src = c.createBufferSource();
    this.src.buffer = sharedNoise; this.src.loop = true;
    this.filter = c.createBiquadFilter();
    this.filter.type = "lowpass"; this.filter.frequency.value = 120;
    this.gain = c.createGain(); this.gain.gain.value = 0;
    this.src.connect(this.filter); this.filter.connect(this.gain); this.gain.connect(c.destination);
    this.src.start();
    this.c = c;
  }
  update(intensity) {
    this.gain.gain.setTargetAtTime(intensity * 0.25, this.c.currentTime, 0.05);
  }
}

export function beep(freq, dur = 0.14, type = "square", vol = 0.18) {
  const c = audioContext();
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
  o.connect(g); g.connect(c.destination);
  o.start(); o.stop(c.currentTime + dur);
}

export function cashSound() {
  beep(880, 0.09, "square", 0.12);
  setTimeout(() => beep(1320, 0.12, "square", 0.12), 90);
  setTimeout(() => beep(1760, 0.18, "square", 0.12), 180);
}

export function loseSound() {
  beep(300, 0.2, "sawtooth", 0.12);
  setTimeout(() => beep(220, 0.25, "sawtooth", 0.12), 180);
  setTimeout(() => beep(150, 0.5, "sawtooth", 0.14), 380);
}

export function uiTick() { beep(660, 0.05, "square", 0.06); }
export function uiSelect() { beep(880, 0.08, "square", 0.09); }
