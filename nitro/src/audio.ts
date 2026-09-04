// =============================================================================
// audio — everything synthesized with Web Audio, no sound files.
//
//   master ─┬─ music   (0.25)   per-track looping tune, step sequencer
//           ├─ ambience(0.15)   per-track background bed + random events
//           ├─ sfx     (0.50)   one-shots
//           └─ engine  (0.20)   continuous engine drone
//
// Nothing is created until initAudio() is called (must be from a user
// gesture). Every exported function is a safe no-op when audio is
// unavailable, so callers never need to guard.
// =============================================================================
import type { AbilityId, CoinKind } from './cars';
import type { TrackId } from './tracks';
import type { HitKind, PadKind, Sfx } from './types';
import { clamp, storeGet, storeSet } from './util';

// ---- state ------------------------------------------------------------------
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicBus: GainNode | null = null;
let ambBus: GainNode | null = null;
let sfxBus: GainNode | null = null;
let engineBus: GainNode | null = null;
let failed = false;

let muted = storeGet('nitro.muted', '0') === '1';

const MUSIC_LEVEL = 0.25;
const AMB_LEVEL = 0.15;
const SFX_LEVEL = 0.5;
const ENGINE_LEVEL = 0.2;

const LOOKAHEAD = 0.3;      // seconds of events scheduled ahead of the clock
const TICK_MS = 25;

let timer: number | null = null;
let curTrack: TrackId | null = null;
let step = 0;
let nextStepTime = 0;

/** things the current ambience owns; all stopped on stopMusic() */
let ambStops: Array<(t: number) => void> = [];
let ambEvent: ((t: number) => void) | null = null;
let ambEventGap: [number, number] = [2, 5];
let nextAmbEvent = 0;

// ---- tiny helpers -----------------------------------------------------------
const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);

let noiseBuf: AudioBuffer | null = null;
/** 2 s of white noise, reused by every looping noise source. */
function noiseBuffer(): AudioBuffer | null {
  if (!ctx) return null;
  if (!noiseBuf) {
    const len = Math.floor(ctx.sampleRate * 2);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

/** A plain enveloped oscillator. Returns nothing; fire and forget. */
function tone(
  freq: number, t: number, dur: number, type: OscillatorType, peak: number,
  dest?: AudioNode | null, endFreq?: number, attack = 0.008,
): void {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(20, freq), t);
  if (endFreq !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(dest ?? sfxBus!);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** Enveloped oscillator with a vibrato LFO on its pitch. */
function wobble(
  freq: number, t: number, dur: number, type: OscillatorType, peak: number,
  rate: number, depth: number, endFreq?: number, dest?: AudioNode | null,
): void {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const lfo = ctx.createOscillator();
  const lg = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(20, freq), t);
  if (endFreq !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
  lfo.type = 'sine';
  lfo.frequency.value = rate;
  lg.gain.value = depth;
  lfo.connect(lg);
  lg.connect(o.frequency);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(dest ?? sfxBus!);
  o.start(t); o.stop(t + dur + 0.05);
  lfo.start(t); lfo.stop(t + dur + 0.05);
}

/** A burst of filtered noise, f0 → f1 over its life. */
function noise(
  t: number, dur: number, f0: number, f1: number, peak: number,
  type: BiquadFilterType = 'bandpass', q = 1.1, dest?: AudioNode | null,
): void {
  if (!ctx) return;
  const buf = noiseBuffer();
  if (!buf) return;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.playbackRate.value = rnd(0.85, 1.15);
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(Math.max(40, f0), t);
  f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(dest ?? sfxBus!);
  src.start(t);
  src.stop(t + dur + 0.05);
}

// drum voices (music bus)
function kick(t: number, peak = 0.5): void {
  tone(150, t, 0.16, 'sine', peak, musicBus, 45, 0.004);
  noise(t, 0.03, 700, 120, peak * 0.25, 'lowpass', 0.9, musicBus);
}
function snare(t: number, peak = 0.28): void {
  noise(t, 0.14, 1900, 700, peak, 'bandpass', 0.8, musicBus);
  tone(190, t, 0.08, 'triangle', peak * 0.5, musicBus, 110, 0.004);
}
function hat(t: number, peak = 0.07, dur = 0.03): void {
  noise(t, dur, 8000, 5000, peak, 'highpass', 0.7, musicBus);
}
function tom(t: number, freq: number, peak = 0.3): void {
  tone(freq, t, 0.28, 'sine', peak, musicBus, freq * 0.5, 0.005);
}

// =============================================================================
// init / mute
// =============================================================================
export function initAudio(): void {
  if (failed) return;
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return;
  }
  try {
    const AC: typeof AudioContext | undefined =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) { failed = true; return; }
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);

    musicBus = ctx.createGain();  musicBus.gain.value = MUSIC_LEVEL;   musicBus.connect(master);
    ambBus = ctx.createGain();    ambBus.gain.value = AMB_LEVEL;       ambBus.connect(master);
    sfxBus = ctx.createGain();    sfxBus.gain.value = SFX_LEVEL;       sfxBus.connect(master);
    engineBus = ctx.createGain(); engineBus.gain.value = ENGINE_LEVEL; engineBus.connect(master);

    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  } catch {
    failed = true;
    ctx = null; master = null; musicBus = null; ambBus = null; sfxBus = null; engineBus = null;
  }
}

export function setMuted(m: boolean): void {
  muted = m;
  storeSet('nitro.muted', m ? '1' : '0');
  if (ctx && master) {
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setTargetAtTime(m ? 0 : 1, t, 0.03);
  }
}

export function isMuted(): boolean { return muted; }

// =============================================================================
// music — one step sequencer, a different pattern generator per track
// =============================================================================
interface TrackTune {
  /** seconds per sequencer step (a 16th note) */
  step: number;
  /** pattern length in steps */
  len: number;
  play(i: number, t: number): void;
}

// ---- Speedway: fast driving rock / chiptune, E minor -------------------------
const SPD_BASS = [40, 40, 52, 40, 40, 40, 52, 40, 38, 38, 50, 38, 43, 43, 55, 43];
const SPD_LEAD = [
  76, 0, 79, 83, 0, 82, 79, 0, 76, 0, 74, 0, 71, 0, 74, 76,
  78, 0, 81, 85, 0, 83, 81, 0, 78, 0, 76, 0, 79, 0, 83, 0,
];
// ---- Beach: laid-back tropical surf, A major ---------------------------------
const BCH_BASS = [45, 0, 0, 45, 0, 52, 0, 0, 40, 0, 0, 40, 0, 47, 0, 0];
const BCH_LEAD = [
  73, 0, 76, 0, 81, 0, 0, 78, 76, 0, 0, 0, 73, 0, 0, 0,
  71, 0, 76, 0, 80, 0, 0, 76, 73, 0, 0, 71, 69, 0, 0, 0,
];
// ---- Dirt Rally: bouncy banjo country, G major -------------------------------
const DRT_BASS = [43, 0, 50, 0, 43, 0, 50, 0, 41, 0, 48, 0, 45, 0, 52, 0];
const DRT_LEAD = [
  67, 71, 74, 79, 74, 71, 67, 71, 69, 72, 76, 81, 76, 72, 69, 72,
  65, 69, 72, 77, 72, 69, 65, 69, 67, 71, 74, 79, 78, 74, 71, 67,
];
// ---- Ice Lake: sparkly bell arpeggios, D♭-ish pentatonic ---------------------
const ICE_ARP = [
  73, 78, 80, 85, 88, 85, 80, 78, 76, 80, 83, 88, 90, 88, 83, 80,
  71, 76, 78, 83, 85, 83, 78, 76, 73, 78, 80, 85, 88, 92, 88, 85,
];
// ---- Volcano: heavy low menace, C minor / tritone ----------------------------
const VOL_BASS = [24, 0, 24, 24, 0, 24, 0, 25, 24, 0, 24, 0, 30, 0, 29, 0];
const VOL_LEAD = [
  48, 0, 0, 0, 51, 0, 0, 0, 47, 0, 0, 0, 0, 0, 54, 0,
  48, 0, 0, 0, 55, 0, 0, 0, 54, 0, 51, 0, 48, 0, 0, 0,
];
// ---- Space: pads + arpeggio, A minor 9 --------------------------------------
const SPC_CHORDS: number[][] = [
  [45, 52, 57, 64], [43, 50, 55, 62], [41, 48, 53, 60], [48, 55, 60, 67],
];
const SPC_ARP = [69, 72, 76, 79, 84, 79, 76, 72];

function pad(freqs: number[], t: number, dur: number, peak: number, cutoff: number): void {
  if (!ctx || !musicBus) return;
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = 3;
  f.frequency.setValueAtTime(cutoff * 0.5, t);
  f.frequency.linearRampToValueAtTime(cutoff, t + dur * 0.5);
  f.frequency.linearRampToValueAtTime(cutoff * 0.6, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.35);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  f.connect(g); g.connect(musicBus);
  for (const fr of freqs) {
    for (const det of [-4, 4]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = fr;
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.06);
    }
  }
}

const TUNES: Record<TrackId, TrackTune> = {
  // 140 bpm, square lead over a chugging bass, four-on-the-floor
  speedway: {
    step: 0.107, len: 32,
    play(i, t) {
      const b = SPD_BASS[i % 16];
      if (b) tone(mtof(b - 12), t, 0.1, 'sawtooth', 0.16, musicBus, undefined, 0.004);
      const l = SPD_LEAD[i];
      if (l) tone(mtof(l), t, 0.1, 'square', 0.1, musicBus);
      if (i % 4 === 0) kick(t, 0.5);
      if (i % 8 === 4) snare(t, 0.3);
      hat(t, i % 2 === 0 ? 0.06 : 0.03);
      if (i === 31) { snare(t + 0.05, 0.2); }
    },
  },
  // ~92 bpm, triangle bass, soft sine melody, brush-ish hats
  beach: {
    step: 0.163, len: 32,
    play(i, t) {
      const b = BCH_BASS[i % 16];
      if (b) tone(mtof(b - 12), t, 0.32, 'triangle', 0.2, musicBus, undefined, 0.02);
      const l = BCH_LEAD[i];
      if (l) {
        tone(mtof(l), t, 0.38, 'sine', 0.12, musicBus, undefined, 0.03);
        tone(mtof(l + 12), t, 0.3, 'sine', 0.03, musicBus, undefined, 0.05);
      }
      if (i % 8 === 0) kick(t, 0.28);
      if (i % 8 === 4) noise(t, 0.09, 2600, 1400, 0.13, 'bandpass', 0.7, musicBus); // shaker snare
      if (i % 2 === 1) hat(t, 0.03, 0.05);
      if (i % 16 === 12) tone(mtof(BCH_LEAD[i % 32] || 76), t, 0.5, 'triangle', 0.05, musicBus);
    },
  },
  // ~150 bpm, plucky banjo rolls, boom-chick
  dirt: {
    step: 0.1, len: 32,
    play(i, t) {
      const b = DRT_BASS[i % 16];
      if (b) tone(mtof(b - 12), t, 0.14, 'triangle', 0.22, musicBus, undefined, 0.004);
      const l = DRT_LEAD[i];
      if (l) {
        tone(mtof(l), t, 0.09, 'square', 0.075, musicBus, undefined, 0.002);
        tone(mtof(l + 7), t + 0.012, 0.07, 'square', 0.03, musicBus, undefined, 0.002);
      }
      if (i % 8 === 0) kick(t, 0.42);
      if (i % 8 === 4) snare(t, 0.26);
      if (i % 4 === 2) hat(t, 0.05, 0.04);
    },
  },
  // ~86 bpm, bell arpeggio + sparkle, almost no drums
  ice: {
    step: 0.174, len: 32,
    play(i, t) {
      const n = ICE_ARP[i];
      tone(mtof(n), t, 0.55, 'sine', 0.1, musicBus, undefined, 0.005);
      tone(mtof(n + 12), t, 0.28, 'sine', 0.028, musicBus, undefined, 0.004);
      if (i % 8 === 0) {
        tone(mtof(ICE_ARP[i] - 24), t, 1.4, 'triangle', 0.13, musicBus, undefined, 0.15);
      }
      if (i % 16 === 0) kick(t, 0.22);
      if (i % 8 === 6) noise(t, 0.35, 9000, 4000, 0.05, 'highpass', 0.6, musicBus);
    },
  },
  // ~76 bpm, sub bass, toms, dissonant brass stabs
  volcano: {
    step: 0.197, len: 32,
    play(i, t) {
      const b = VOL_BASS[i % 16];
      if (b) {
        tone(mtof(b), t, 0.3, 'sawtooth', 0.28, musicBus, undefined, 0.01);
        tone(mtof(b - 12), t, 0.34, 'sine', 0.22, musicBus, undefined, 0.01);
      }
      const l = VOL_LEAD[i];
      if (l) tone(mtof(l), t, 0.42, 'square', 0.07, musicBus, undefined, 0.03);
      if (i % 8 === 0 || i % 16 === 6) kick(t, 0.6);
      if (i % 16 === 8) { tom(t, 110, 0.34); tom(t + 0.1, 82, 0.26); }
      if (i % 16 === 12) snare(t, 0.22);
      if (i % 4 === 2) noise(t, 0.05, 300, 120, 0.08, 'lowpass', 1, musicBus);
    },
  },
  // ~70 bpm, slow chord pads with a fast triangle arpeggio on top
  space: {
    step: 0.214, len: 32,
    play(i, t) {
      if (i % 8 === 0) {
        const ch = SPC_CHORDS[(i / 8) % SPC_CHORDS.length].map((m) => mtof(m));
        pad(ch, t, 2.0, 0.13, 1400);
      }
      const n = SPC_ARP[i % SPC_ARP.length];
      if (i % 2 === 0) {
        tone(mtof(n), t, 0.3, 'triangle', 0.07, musicBus, undefined, 0.005);
        tone(mtof(n + 12), t + 0.1, 0.22, 'sine', 0.025, musicBus, undefined, 0.005);
      }
      if (i % 16 === 0) kick(t, 0.3);
      if (i % 8 === 4) hat(t, 0.035, 0.06);
    },
  },
};

// =============================================================================
// ambience — a continuous bed plus randomly scheduled one-shots
// =============================================================================
/** A looping filtered-noise bed whose gain is swept by an LFO. */
function noiseBed(
  type: BiquadFilterType, freq: number, q: number, level: number,
  lfoRate: number, lfoDepth: number, rate = 1,
): void {
  if (!ctx || !ambBus) return;
  const buf = noiseBuffer();
  if (!buf) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.playbackRate.value = rate;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(level, t + 1.2);
  src.connect(f); f.connect(g); g.connect(ambBus);
  src.start(t);
  if (lfoDepth > 0) {
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = lfoRate;
    lg.gain.value = lfoDepth;
    lfo.connect(lg);
    lg.connect(g.gain);
    lfo.start(t);
    ambStops.push((end) => { try { lfo.stop(end + 0.4); } catch { /* already stopped */ } });
  }
  ambStops.push((end) => {
    g.gain.cancelScheduledValues(end);
    g.gain.setTargetAtTime(0.0001, end, 0.15);
    try { src.stop(end + 0.6); } catch { /* already stopped */ }
  });
}

/** A continuous sustained oscillator bed (hums, rumbles). */
function droneBed(freq: number, type: OscillatorType, level: number, lfoRate: number, lfoCents: number): void {
  if (!ctx || !ambBus) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(level, t + 1.5);
  o.connect(g); g.connect(ambBus);
  o.start(t);
  if (lfoCents > 0) {
    const lfo = ctx.createOscillator();
    const lg = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = lfoRate;
    lg.gain.value = lfoCents;
    lfo.connect(lg);
    lg.connect(o.detune);
    lfo.start(t);
    ambStops.push((end) => { try { lfo.stop(end + 0.4); } catch { /* already stopped */ } });
  }
  ambStops.push((end) => {
    g.gain.cancelScheduledValues(end);
    g.gain.setTargetAtTime(0.0001, end, 0.2);
    try { o.stop(end + 0.8); } catch { /* already stopped */ }
  });
}

function startAmbience(track: TrackId): void {
  if (!ctx || !ambBus) return;
  switch (track) {
    case 'speedway': // crowd roar that swells, occasional air horn
      noiseBed('bandpass', 900, 0.7, 0.5, 0.09, 0.28);
      noiseBed('lowpass', 300, 0.5, 0.18, 0.05, 0.1, 0.6);
      ambEventGap = [5, 12];
      ambEvent = (t) => {
        const f = rnd(300, 420);
        tone(f, t, 0.55, 'sawtooth', 0.1, ambBus, undefined, 0.03);
        tone(f * 1.5, t, 0.55, 'sawtooth', 0.06, ambBus, undefined, 0.03);
      };
      break;
    case 'beach': // waves washing in and out, gulls
      noiseBed('lowpass', 700, 0.4, 0.55, 0.13, 0.4);
      noiseBed('highpass', 2500, 0.5, 0.1, 0.11, 0.07);
      ambEventGap = [4, 10];
      ambEvent = (t) => {
        const f = rnd(1500, 2300);
        for (let k = 0; k < 3; k++) {
          wobble(f, t + k * 0.16, 0.13, 'sine', 0.08, 22, 90, f * 0.72, ambBus);
        }
      };
      break;
    case 'dirt': // wind through trees + gravel hiss, birds tweeting
      noiseBed('bandpass', 480, 0.5, 0.35, 0.07, 0.18);
      noiseBed('highpass', 4200, 0.6, 0.08, 0.23, 0.05);
      ambEventGap = [2.5, 6];
      ambEvent = (t) => {
        const f = rnd(2600, 3900);
        const n = 2 + Math.floor(Math.random() * 3);
        for (let k = 0; k < n; k++) {
          tone(f * rnd(0.92, 1.1), t + k * 0.09, 0.07, 'sine', 0.09, ambBus, f * 1.35, 0.006);
        }
      };
      break;
    case 'ice': // whistling wind
      noiseBed('bandpass', 1600, 6, 0.5, 0.08, 0.3);
      noiseBed('bandpass', 2600, 9, 0.3, 0.05, 0.22);
      noiseBed('lowpass', 400, 0.5, 0.2, 0.04, 0.12, 0.7);
      ambEventGap = [6, 14];
      ambEvent = (t) => {
        wobble(rnd(900, 1500), t, 2.2, 'sine', 0.05, 0.4, 200, rnd(1400, 2200), ambBus);
      };
      break;
    case 'volcano': // deep rumble plus bubbling lava pops
      droneBed(38, 'sawtooth', 0.16, 0.09, 25);
      noiseBed('lowpass', 180, 0.6, 0.5, 0.06, 0.2, 0.5);
      ambEventGap = [0.35, 1.4];
      ambEvent = (t) => {
        const f = rnd(70, 190);
        tone(f, t, rnd(0.1, 0.22), 'sine', rnd(0.08, 0.2), ambBus, f * rnd(1.8, 3.2), 0.006);
        if (Math.random() < 0.3) noise(t + 0.05, 0.2, 1800, 500, 0.06, 'bandpass', 1.2, ambBus);
      };
      break;
    case 'space': // deep hum + sci-fi beeps
      droneBed(46, 'sine', 0.2, 0.05, 10);
      droneBed(69.3, 'triangle', 0.07, 0.07, 18);
      noiseBed('bandpass', 220, 2, 0.14, 0.03, 0.06, 0.35);
      ambEventGap = [3, 9];
      ambEvent = (t) => {
        const f = mtof(76 + Math.floor(Math.random() * 12));
        tone(f, t, 0.12, 'sine', 0.09, ambBus, undefined, 0.004);
        tone(f * 1.5, t + 0.16, 0.1, 'sine', 0.06, ambBus, undefined, 0.004);
        if (Math.random() < 0.4) tone(f * 2, t + 0.32, 0.2, 'sine', 0.04, ambBus, f * 3, 0.004);
      };
      break;
  }
  nextAmbEvent = ctx.currentTime + rnd(ambEventGap[0], ambEventGap[1]);
}

function stopAmbience(): void {
  const t = ctx ? ctx.currentTime : 0;
  for (const s of ambStops) { try { s(t); } catch { /* node already gone */ } }
  ambStops = [];
  ambEvent = null;
}

// ---- scheduler --------------------------------------------------------------
function pump(): void {
  if (!ctx || !curTrack) return;
  const now = ctx.currentTime;
  const tune = TUNES[curTrack];
  if (nextStepTime < now) nextStepTime = now + 0.03;
  let guard = 0;
  while (nextStepTime < now + LOOKAHEAD && guard++ < 128) {
    try { tune.play(step % tune.len, nextStepTime); } catch { /* ignore */ }
    nextStepTime += tune.step;
    step++;
  }
  if (ambEvent) {
    if (nextAmbEvent < now) nextAmbEvent = now + 0.05;
    let g2 = 0;
    while (nextAmbEvent < now + LOOKAHEAD && g2++ < 8) {
      try { ambEvent(nextAmbEvent); } catch { /* ignore */ }
      nextAmbEvent += rnd(ambEventGap[0], ambEventGap[1]);
    }
  }
}

export function startMusic(track: TrackId): void {
  initAudio();
  if (!ctx) return;
  if (curTrack === track && timer !== null) return;
  stopMusic();
  curTrack = track;
  step = 0;
  nextStepTime = ctx.currentTime + 0.1;
  startAmbience(track);
  timer = window.setInterval(pump, TICK_MS);
  pump();
}

export function stopMusic(): void {
  if (timer !== null) { window.clearInterval(timer); timer = null; }
  curTrack = null;
  stopAmbience();
}

// =============================================================================
// engine — continuous, driven from the frame loop
// =============================================================================
interface Engine {
  saw: OscillatorNode;
  sub: OscillatorNode;
  whine: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  whineGain: GainNode;
  rumble: AudioBufferSourceNode | null;
  rumbleGain: GainNode | null;
}
let engine: Engine | null = null;

function buildEngine(): void {
  if (!ctx || !engineBus || engine) return;
  const t = ctx.currentTime;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 4;
  filter.frequency.value = 400;
  const gain = ctx.createGain();
  gain.gain.value = 0.0001;
  filter.connect(gain);
  gain.connect(engineBus);

  const saw = ctx.createOscillator();
  saw.type = 'sawtooth';
  saw.frequency.value = 60;
  const sawG = ctx.createGain();
  sawG.gain.value = 0.5;
  saw.connect(sawG); sawG.connect(filter);

  const sub = ctx.createOscillator();
  sub.type = 'square';
  sub.frequency.value = 30;
  const subG = ctx.createGain();
  subG.gain.value = 0.32;
  sub.connect(subG); subG.connect(filter);

  const whine = ctx.createOscillator();
  whine.type = 'triangle';
  whine.frequency.value = 600;
  const whineGain = ctx.createGain();
  whineGain.gain.value = 0.0001;
  whine.connect(whineGain); whineGain.connect(gain);

  let rumble: AudioBufferSourceNode | null = null;
  let rumbleGain: GainNode | null = null;
  const buf = noiseBuffer();
  if (buf) {
    rumble = ctx.createBufferSource();
    rumble.buffer = buf;
    rumble.loop = true;
    const rf = ctx.createBiquadFilter();
    rf.type = 'bandpass';
    rf.frequency.value = 240;
    rf.Q.value = 0.8;
    rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0.0001;
    rumble.connect(rf); rf.connect(rumbleGain); rumbleGain.connect(gain);
    rumble.start(t);
  }

  saw.start(t); sub.start(t); whine.start(t);
  engine = { saw, sub, whine, filter, gain, whineGain, rumble, rumbleGain };
}

export function setEngine(speedNorm: number, throttle: number, boosting: boolean): void {
  if (failed) return;
  if (!ctx) return;
  if (!engine) buildEngine();
  if (!engine || !ctx) return;
  const s = clamp(speedNorm, 0, 1.4);
  const th = clamp(throttle, 0, 1);
  const t = ctx.currentTime;
  const k = 0.06;

  // pitch rises with speed; a little extra when the driver is on the gas
  const base = 46 + s * 118 + th * 14 + (boosting ? 26 : 0);
  engine.saw.frequency.setTargetAtTime(base, t, k);
  engine.sub.frequency.setTargetAtTime(base * 0.5, t, k);
  engine.filter.frequency.setTargetAtTime(
    clamp(320 + s * 2400 + th * 700 + (boosting ? 900 : 0), 200, 9000), t, k);
  // moderate overall level so the music stays audible
  engine.gain.gain.setTargetAtTime(0.28 * (0.35 + 0.5 * th + 0.35 * Math.min(1, s)), t, k);
  engine.whine.frequency.setTargetAtTime(base * 6 + 400, t, k);
  engine.whineGain.gain.setTargetAtTime(boosting ? 0.16 : 0.0001, t, boosting ? 0.05 : 0.12);
  if (engine.rumbleGain) engine.rumbleGain.gain.setTargetAtTime(0.05 + s * 0.12, t, k);
}

export function stopEngine(): void {
  if (!ctx || !engine) return;
  const e = engine;
  engine = null;
  const t = ctx.currentTime;
  e.gain.gain.cancelScheduledValues(t);
  e.gain.gain.setTargetAtTime(0.0001, t, 0.06);
  const end = t + 0.5;
  try { e.saw.stop(end); e.sub.stop(end); e.whine.stop(end); e.rumble?.stop(end); }
  catch { /* already stopped */ }
}

// =============================================================================
// one-shot sound effects
// =============================================================================
const now = (): number => (ctx ? ctx.currentTime : 0);

const COIN_NOTES: Record<CoinKind, [number, number]> = {
  bronze: [72, 79],   // C5 → G5
  silver: [79, 86],   // G5 → D6
  gold: [84, 91],     // C6 → G6
};

function whoosh(t: number, dur: number, f0: number, f1: number, peak: number): void {
  noise(t, dur, f0, f1, peak, 'bandpass', 0.9);
  noise(t, dur, f0 * 2, f1 * 2, peak * 0.4, 'highpass', 0.7);
}

export const sfx: Sfx = {
  coin(kind: CoinKind): void {
    if (!ctx) return;
    const t = now();
    const [a, b] = COIN_NOTES[kind];
    tone(mtof(a), t, 0.09, 'square', 0.16, null, undefined, 0.003);
    tone(mtof(b), t + 0.055, 0.16, 'square', 0.14, null, undefined, 0.003);
    if (kind !== 'bronze') tone(mtof(b + 12), t + 0.055, 0.14, 'sine', 0.06);
    if (kind === 'gold') {
      tone(mtof(b + 19), t + 0.12, 0.28, 'sine', 0.07);
      noise(t + 0.05, 0.3, 9000, 5000, 0.05, 'highpass', 0.6);
    }
  },

  hit(kind: HitKind): void {
    if (!ctx) return;
    const t = now();
    switch (kind) {
      case 'obstacle': // dull thud
        tone(130, t, 0.18, 'sine', 0.4, null, 45, 0.003);
        noise(t, 0.12, 420, 90, 0.3, 'lowpass', 1);
        break;
      case 'oil': // slippery descending wobble
        wobble(520, t, 0.7, 'sine', 0.22, 11, 130, 150);
        noise(t, 0.6, 2600, 500, 0.12, 'bandpass', 2);
        break;
      case 'lava': // hiss + sizzle
        noise(t, 0.75, 6000, 1600, 0.3, 'highpass', 0.6);
        tone(90, t, 0.35, 'sawtooth', 0.22, null, 40, 0.006);
        for (let i = 0; i < 5; i++) noise(t + 0.08 * i, 0.06, rnd(2000, 5000), 800, 0.08);
        break;
      case 'fall': // long falling whoosh
        wobble(1100, t, 1.0, 'sine', 0.22, 6, 40, 90);
        noise(t, 1.0, 2200, 220, 0.16, 'bandpass', 1.4);
        break;
      case 'wall': // sharp crack + thud
        noise(t, 0.09, 3200, 900, 0.4, 'bandpass', 0.9);
        tone(180, t, 0.2, 'triangle', 0.34, null, 60, 0.003);
        break;
    }
  },

  smash(): void {
    if (!ctx) return;
    const t = now();
    for (let i = 0; i < 6; i++) {
      noise(t + i * 0.022, 0.09, rnd(900, 3600), rnd(200, 700), 0.22, 'bandpass', rnd(0.6, 2));
    }
    tone(150, t, 0.3, 'sawtooth', 0.3, null, 42, 0.003);
    tone(75, t, 0.35, 'sine', 0.28, null, 35, 0.004);
  },

  pad(kind: PadKind): void {
    if (!ctx) return;
    const t = now();
    if (kind === 'boost') {
      whoosh(t, 0.5, 300, 3600, 0.3);
      tone(220, t, 0.5, 'sawtooth', 0.14, null, 1500, 0.02);
      tone(330, t + 0.06, 0.44, 'square', 0.08, null, 2000, 0.02);
    } else {
      tone(420, t, 0.6, 'sawtooth', 0.24, null, 80, 0.01);
      wobble(210, t, 0.6, 'square', 0.12, 9, 30, 55);
      noise(t, 0.5, 1200, 200, 0.14, 'lowpass', 1.5);
    }
  },

  ability(ability: AbilityId, on: boolean): void {
    if (!ctx) return;
    const t = now();
    switch (ability) {
      case 'boost':
        if (on) {
          whoosh(t, 0.6, 260, 4200, 0.34);
          tone(180, t, 0.6, 'sawtooth', 0.2, null, 1800, 0.015);
        } else {
          whoosh(t, 0.35, 2600, 400, 0.16);
        }
        break;
      case 'jump':
        if (on) {
          wobble(200, t, 0.32, 'sine', 0.3, 16, 55, 780);
          tone(400, t, 0.2, 'triangle', 0.1, null, 1400);
        } else {
          tone(620, t, 0.14, 'sine', 0.14, null, 220);
        }
        break;
      case 'phase': { // ghostly shimmer: detuned highs with tremolo
        const dur = on ? 0.9 : 0.5;
        const base = on ? 700 : 1400;
        const end = on ? 1500 : 500;
        for (const d of [1, 1.01, 1.5]) {
          wobble(base * d, t, dur, 'sine', 0.1, 7, 24, end * d);
        }
        noise(t, dur, on ? 3000 : 6000, on ? 7000 : 2000, 0.07, 'highpass', 0.6);
        break;
      }
      case 'magnet': { // pulsing hum
        const dur = on ? 0.7 : 0.4;
        wobble(on ? 150 : 220, t, dur, 'square', 0.16, 14, 20, on ? 240 : 110);
        tone(on ? 300 : 440, t, dur, 'sine', 0.08, null, on ? 480 : 220, 0.02);
        break;
      }
      case 'smash':
        if (on) {
          tone(70, t, 0.7, 'sawtooth', 0.3, null, 150, 0.02);
          wobble(140, t, 0.7, 'square', 0.16, 22, 30, 300);
          noise(t, 0.7, 300, 1400, 0.16, 'lowpass', 1.2);
        } else {
          tone(160, t, 0.45, 'sawtooth', 0.22, null, 55, 0.01);
          noise(t, 0.4, 900, 200, 0.1, 'lowpass', 1);
        }
        break;
    }
  },

  checkpoint(): void {
    if (!ctx) return;
    const t = now();
    tone(mtof(83), t, 0.14, 'square', 0.18);
    tone(mtof(90), t + 0.1, 0.28, 'square', 0.16);
    tone(mtof(78), t + 0.1, 0.28, 'sine', 0.06);
  },

  countdown(n: number): void {
    if (!ctx) return;
    const t = now();
    if (n > 0) {
      tone(660, t, 0.2, 'square', 0.24, null, undefined, 0.004);
      tone(330, t, 0.2, 'triangle', 0.1);
    } else {
      tone(1046, t, 0.6, 'square', 0.28, null, undefined, 0.005);
      tone(1568, t, 0.6, 'triangle', 0.12);
      tone(523, t, 0.6, 'sawtooth', 0.08);
      noise(t, 0.35, 6000, 2000, 0.08, 'highpass', 0.6);
    }
  },

  finish(newBest: boolean): void {
    if (!ctx) return;
    const t = now();
    const notes = newBest ? [72, 76, 79, 84, 79, 84, 88] : [72, 76, 79, 79];
    const stepT = newBest ? 0.11 : 0.13;
    for (let i = 0; i < notes.length; i++) {
      const s = t + i * stepT;
      tone(mtof(notes[i]), s, 0.34, 'square', 0.18);
      tone(mtof(notes[i] - 12), s, 0.34, 'triangle', 0.09);
      if (i % 2 === 0) noise(s, 0.06, 7000, 3000, 0.05, 'highpass', 0.6);
    }
    if (newBest) {
      const end = t + notes.length * stepT;
      tone(mtof(91), end, 0.8, 'square', 0.16);
      tone(mtof(84), end, 0.8, 'triangle', 0.1);
      noise(t, 0.6, 5000, 1200, 0.08, 'highpass', 0.5);
    }
  },

  respawn(): void {
    if (!ctx) return;
    const t = now();
    tone(180, t, 0.14, 'sine', 0.28, null, 560, 0.004);
    tone(540, t + 0.05, 0.12, 'triangle', 0.12, null, 900);
    noise(t, 0.08, 1200, 400, 0.1);
  },

  unlock(): void {
    if (!ctx) return;
    const t = now();
    // ka-ching: bell pair, then a quick rising fanfare
    tone(mtof(88), t, 0.5, 'square', 0.2);
    tone(mtof(93), t + 0.02, 0.5, 'sine', 0.12);
    noise(t, 0.12, 4000, 1500, 0.16, 'bandpass', 1.4);
    tone(mtof(83), t + 0.14, 0.45, 'square', 0.16);
    tone(mtof(95), t + 0.14, 0.45, 'sine', 0.1);
    for (let i = 0; i < 4; i++) {
      tone(mtof(72 + i * 4), t + 0.4 + i * 0.1, 0.3, 'triangle', 0.14);
    }
    noise(t + 0.4, 0.6, 8000, 3000, 0.06, 'highpass', 0.6);
  },

  click(): void {
    if (!ctx) return;
    const t = now();
    tone(1250, t, 0.035, 'square', 0.12, null, undefined, 0.002);
    noise(t, 0.02, 4000, 2000, 0.05, 'highpass', 0.7);
  },
};

/** Stops music, ambience and the engine (e.g. when leaving a race). */
export function stopAll(): void {
  stopMusic();
  stopEngine();
}
