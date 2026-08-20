// audio.ts — Circle the Wagons sound.
//
// Two paths, one API. If `load()` found a real OGG for a sound, `play`/`loop`
// use the decoded sample; otherwise the sound is synthesised from oscillators
// and noise buffers. The game never has to know which — and it sounds fine
// with no media files present at all.
//
// Every call gets its own little chain:
//     voice(s) -> [lowpass, when dist > 0] -> gain -> stereo pan -> master
// so simultaneous shots never steal each other's voices.

export type Sfx =
  | 'rifle'    // lever-action rifle shot: sharp crack + low boom
  | 'lever'    // lever cycle clack-clack
  | 'revolver' // revolver shot
  | 'cock'     // hammer cock click
  | 'reload'   // six-shooter spin-reload (cylinder spin + 6 clicks)
  | 'dry'      // trigger on empty: dry click
  | 'gallop'   // hoofbeat loop (looped)
  | 'whinny'
  | 'wind'     // prairie wind/grass ambience (looped)
  | 'thud'     // body hits the ground
  | 'hit'      // player takes a hit
  | 'aim'      // a Rider's Aim telegraph cue
  | 'shot'     // a Rider's gun firing at the player
  | 'sting'    // short raid-start sting
  | 'over';    // run-over sting

export interface PlayOpts {
  vol?: number;
  rate?: number;
  pan?: number;  // -1..1 stereo
  dist?: number; // 0 = at the listener, 1 = far away: attenuate + lowpass
}

export interface LoopHandle {
  setPan(p: number): void;
  setVol(v: number): void;
  setRate(r: number): void;
  stop(fade?: number): void;
}

const MUTE_KEY = 'wagons.muted';

const NAMES: readonly Sfx[] = [
  'rifle', 'lever', 'revolver', 'cock', 'reload', 'dry', 'gallop', 'whinny',
  'wind', 'thud', 'hit', 'aim', 'shot', 'sting', 'over',
];

// --- context -----------------------------------------------------------------

let ac: AudioContext | null = null;
let master: GainNode | null = null;
let unavailable = false;
let isMuted = readMuted();

/** Decoded samples, keyed by sound name. Missing key = use the synth. */
const samples = new Map<Sfx, AudioBuffer>();
/** Lazily-built synth buffers (white noise, and the two looping beds). */
let whiteBuf: AudioBuffer | null = null;
let gallopBuf: AudioBuffer | null = null;
let windBuf: AudioBuffer | null = null;

function readMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

function ensure(): AudioContext | null {
  if (ac || unavailable) return ac;
  const Ctor = window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) { unavailable = true; return null; }
  try { ac = new Ctor(); } catch { unavailable = true; return null; }
  master = ac.createGain();
  master.gain.value = isMuted ? 0 : 1;
  master.connect(ac.destination);
  // 2 s of white noise, reused by every noisy voice.
  const len = Math.floor(ac.sampleRate * 2);
  whiteBuf = ac.createBuffer(1, len, ac.sampleRate);
  const d = whiteBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return ac;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// --- per-call routing --------------------------------------------------------

interface Chain { input: AudioNode; gain: GainNode; pan: StereoPannerNode | null }

/** Builds the gain/pan/distance chain for one call and returns its input. */
function chain(c: AudioContext, o: PlayOpts): Chain {
  const g = c.createGain();
  const dist = clamp(o.dist ?? 0, 0, 1);
  g.gain.value = clamp(o.vol ?? 1, 0, 4) * (1 - 0.72 * dist);

  let pan: StereoPannerNode | null = null;
  let tail: AudioNode = g;
  if (typeof c.createStereoPanner === 'function') {
    pan = c.createStereoPanner();
    pan.pan.value = clamp(o.pan ?? 0, -1, 1);
    g.connect(pan);
    tail = pan;
  }
  tail.connect(master!);

  let input: AudioNode = g;
  if (dist > 0) {
    // Air swallows the top end long before it swallows the level.
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 18000 * Math.pow(0.045, dist);
    lp.connect(g);
    input = lp;
  }
  return { input, gain: g, pan };
}

// --- low-level voices --------------------------------------------------------

interface ToneOpts {
  type?: OscillatorType;
  freq: number; freqTo?: number;
  at: number; dur: number; gain: number;
  attack?: number;
  filter?: number; filterTo?: number; // lowpass
  dest: AudioNode;
}

function tone(o: ToneOpts): void {
  const c = ac; if (!c) return;
  const osc = c.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(Math.max(20, o.freq), o.at);
  if (o.freqTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqTo), o.at + o.dur);
  }
  const g = c.createGain();
  const atk = o.attack ?? 0.004;
  g.gain.setValueAtTime(0.0001, o.at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), o.at + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, o.at + o.dur);

  let head: AudioNode = g;
  let lp: BiquadFilterNode | null = null;
  if (o.filter !== undefined) {
    lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(o.filter, o.at);
    if (o.filterTo !== undefined) lp.frequency.linearRampToValueAtTime(Math.max(30, o.filterTo), o.at + o.dur);
    g.connect(lp);
    head = lp;
  }
  osc.connect(g);
  head.connect(o.dest);
  osc.start(o.at);
  osc.stop(o.at + o.dur + 0.03);
  osc.onended = () => { osc.disconnect(); g.disconnect(); lp?.disconnect(); };
}

interface NoiseOpts {
  at: number; dur: number; gain: number;
  type?: BiquadFilterType; freq: number; freqTo?: number; q?: number;
  attack?: number;
  dest: AudioNode;
}

function noise(o: NoiseOpts): void {
  const c = ac; if (!c || !whiteBuf) return;
  const src = c.createBufferSource();
  src.buffer = whiteBuf;
  src.loop = true;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  // Start somewhere random in the buffer so repeats never sound identical.
  const off = Math.random() * (whiteBuf.duration - o.dur - 0.05);

  const f = c.createBiquadFilter();
  f.type = o.type ?? 'bandpass';
  f.frequency.setValueAtTime(Math.max(30, o.freq), o.at);
  if (o.freqTo !== undefined) {
    f.frequency.exponentialRampToValueAtTime(Math.max(30, o.freqTo), o.at + o.dur);
  }
  f.Q.value = o.q ?? 1;

  const g = c.createGain();
  const atk = o.attack ?? 0.002;
  g.gain.setValueAtTime(0.0001, o.at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), o.at + atk);
  g.gain.exponentialRampToValueAtTime(0.0001, o.at + o.dur);

  src.connect(f); f.connect(g); g.connect(o.dest);
  src.start(o.at, Math.max(0, off));
  src.stop(o.at + o.dur + 0.02);
  src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); };
}

/** A single mechanical click — the building block of lever/cock/dry/reload. */
function click(at: number, dest: AudioNode, freq: number, gain: number, dur = 0.015): void {
  noise({ at, dur, gain, type: 'bandpass', freq, q: 6, attack: 0.0008, dest });
  tone({ type: 'square', freq: freq * 0.55, freqTo: freq * 0.3, at, dur: dur * 1.4, gain: gain * 0.25, attack: 0.001, dest });
}

// --- the synth voices --------------------------------------------------------

type Voice = (at: number, dest: AudioNode, rate: number) => void;

const SYNTH: Record<Sfx, Voice> = {
  // Sharp white-noise crack, then the low boom rolling off the prairie.
  rifle: (t, d, r) => {
    noise({ at: t, dur: 0.02, gain: 1.0, type: 'highpass', freq: 1600 * r, q: 0.7, attack: 0.0006, dest: d });
    noise({ at: t, dur: 0.09, gain: 0.55, type: 'bandpass', freq: 2600 * r, freqTo: 700, q: 0.8, dest: d });
    tone({ type: 'sine', freq: 120 * r, freqTo: 52, at: t, dur: 0.25, gain: 0.75, attack: 0.003, dest: d });
    noise({ at: t + 0.02, dur: 0.35, gain: 0.22, type: 'lowpass', freq: 700, freqTo: 160, dest: d });
  },
  // Shorter and brighter than the Rifle, with less body behind it.
  revolver: (t, d, r) => {
    noise({ at: t, dur: 0.014, gain: 0.9, type: 'highpass', freq: 2200 * r, q: 0.7, attack: 0.0005, dest: d });
    noise({ at: t, dur: 0.06, gain: 0.45, type: 'bandpass', freq: 3200 * r, freqTo: 900, q: 0.9, dest: d });
    tone({ type: 'sine', freq: 180 * r, freqTo: 70, at: t, dur: 0.14, gain: 0.5, attack: 0.002, dest: d });
    noise({ at: t + 0.015, dur: 0.2, gain: 0.14, type: 'lowpass', freq: 900, freqTo: 220, dest: d });
  },
  // Clack-clack: two clicks 90 ms apart, bandpassed around 2.5 kHz.
  lever: (t, d, r) => {
    click(t, d, 2500 * r, 0.5);
    click(t + 0.09, d, 2300 * r, 0.42);
  },
  cock: (t, d, r) => {
    click(t, d, 3000 * r, 0.4, 0.012);
    click(t + 0.035, d, 2100 * r, 0.22, 0.01);
  },
  // Cylinder spins up and rattles down, then six cartridges seat home.
  reload: (t, d, r) => {
    const spin = 0.55 / r;
    for (let i = 0; i < 18; i++) {
      // Ticks bunch up at the start of the spin and spread as it slows.
      const p = t + spin * Math.pow(i / 18, 0.65);
      click(p, d, (3600 - i * 90) * r, 0.1 + 0.03 * Math.random(), 0.008);
    }
    for (let i = 0; i < 6; i++) {
      click(t + spin + 0.05 + i * 0.075 / r, d, (2000 + i * 60) * r, 0.26, 0.012);
    }
  },
  // Nothing in the chamber: one dull, unsatisfying click.
  dry: (t, d, r) => {
    click(t, d, 1300 * r, 0.35, 0.012);
    tone({ type: 'triangle', freq: 300 * r, freqTo: 150, at: t, dur: 0.04, gain: 0.1, dest: d });
  },
  // Buffer-backed loops; play() feeds them the pre-rendered bed instead.
  gallop: (t, d, r) => hoof(t, d, 0.5, r),
  wind: (t, d, _r) => {
    noise({ at: t, dur: 1.6, gain: 0.25, type: 'lowpass', freq: 700, freqTo: 400, attack: 0.4, dest: d });
  },
  // A horse's complaint: wobbling descending cry with a breathy tail.
  whinny: (t, d, r) => {
    const f = 760 * r;
    for (let i = 0; i < 7; i++) {
      const p = t + i * 0.075;
      tone({
        type: 'sawtooth', freq: f * (1 - i * 0.055) * (i % 2 ? 1.09 : 0.94),
        freqTo: f * (1 - i * 0.075), at: p, dur: 0.11, gain: 0.2,
        attack: 0.012, filter: 2200, filterTo: 1100, dest: d,
      });
    }
    noise({ at: t + 0.5, dur: 0.4, gain: 0.16, type: 'bandpass', freq: 1200, freqTo: 500, q: 1.4, dest: d });
  },
  // A body landing in the dirt.
  thud: (t, d, r) => {
    tone({ type: 'sine', freq: 110 * r, freqTo: 38, at: t, dur: 0.3, gain: 0.6, attack: 0.004, dest: d });
    noise({ at: t, dur: 0.22, gain: 0.35, type: 'lowpass', freq: 600, freqTo: 90, dest: d });
    noise({ at: t + 0.03, dur: 0.3, gain: 0.1, type: 'bandpass', freq: 1800, freqTo: 600, q: 1, dest: d });
  },
  // The player takes one: a thump in the chest plus a short low pulse.
  hit: (t, d, r) => {
    tone({ type: 'sine', freq: 190 * r, freqTo: 50, at: t, dur: 0.2, gain: 0.7, attack: 0.003, dest: d });
    tone({ type: 'sine', freq: 70, at: t + 0.02, dur: 0.35, gain: 0.4, attack: 0.02, dest: d });
    noise({ at: t, dur: 0.12, gain: 0.3, type: 'lowpass', freq: 900, freqTo: 200, dest: d });
  },
  // The Aim telegraph: a rising two-tone ratchet, ~200 ms. Deliberately
  // piercing — the player has to hear it over everything else.
  aim: (t, d, r) => {
    for (let i = 0; i < 7; i++) {
      click(t + i * 0.026, d, (1400 + i * 320) * r, 0.16, 0.007);
    }
    tone({ type: 'square', freq: 900 * r, at: t + 0.02, dur: 0.09, gain: 0.16, attack: 0.006, filter: 3200, dest: d });
    tone({ type: 'square', freq: 1350 * r, at: t + 0.11, dur: 0.11, gain: 0.18, attack: 0.006, filter: 4000, dest: d });
  },
  // A Rider's pistol going off out there: crack, then a slapback off the coaches.
  shot: (t, d, r) => {
    noise({ at: t, dur: 0.016, gain: 0.6, type: 'bandpass', freq: 1800 * r, q: 0.9, attack: 0.0006, dest: d });
    noise({ at: t, dur: 0.1, gain: 0.3, type: 'lowpass', freq: 2200 * r, freqTo: 500, dest: d });
    tone({ type: 'sine', freq: 150 * r, freqTo: 60, at: t, dur: 0.12, gain: 0.25, dest: d });
    noise({ at: t + 0.11, dur: 0.22, gain: 0.1, type: 'lowpass', freq: 1100, freqTo: 300, dest: d });
  },
  // Raid start: three notes, brass-band-on-the-plains.
  sting: (t, d, _r) => {
    const notes: Array<[number, number, number]> = [[293.66, 0, 0.2], [440, 0.16, 0.2], [587.33, 0.32, 0.5]];
    for (const [f, off, dur] of notes) {
      tone({ type: 'sawtooth', freq: f, at: t + off, dur, gain: 0.22, attack: 0.014, filter: 2400, filterTo: 1400, dest: d });
      tone({ type: 'square', freq: f / 2, at: t + off, dur, gain: 0.1, attack: 0.02, filter: 900, dest: d });
    }
  },
  // Run over: the same horn, sagging, with hooves fading past.
  over: (t, d, _r) => {
    const fall: Array<[number, number]> = [[349.23, 0], [311.13, 0.34], [261.63, 0.68]];
    for (const [f, off] of fall) {
      tone({ type: 'sawtooth', freq: f, freqTo: f * 0.985, at: t + off, dur: 0.55, gain: 0.2, attack: 0.03, filter: 1600, filterTo: 700, dest: d });
      tone({ type: 'sine', freq: f / 2, at: t + off, dur: 0.6, gain: 0.14, attack: 0.03, dest: d });
    }
    for (let i = 0; i < 6; i++) hoof(t + 0.1 + i * 0.16, d, 0.28 * (1 - i / 7), 1);
  },
};

/** One soft hoofbeat. Used live by `over` and offline by the gallop bed. */
function hoof(at: number, dest: AudioNode, gain: number, rate: number): void {
  tone({ type: 'sine', freq: 95 * rate, freqTo: 45, at, dur: 0.11, gain: gain * 0.7, attack: 0.004, dest });
  noise({ at, dur: 0.06, gain: gain * 0.4, type: 'lowpass', freq: 500 * rate, freqTo: 140, dest });
}

// --- looping beds (rendered once into buffers) -------------------------------

/**
 * Four hoofbeats per cycle at ~2.8 beats/s, each nudged off the grid so the
 * loop reads as a canter rather than a metronome.
 */
function makeGallop(c: AudioContext): AudioBuffer {
  const beat = 1 / 2.8;
  const len = Math.floor(c.sampleRate * beat * 4);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  const jitter = [0, 0.012, -0.008, 0.02];
  const level = [1, 0.62, 0.8, 0.55];
  for (let b = 0; b < 4; b++) {
    const start = Math.floor((b * beat + jitter[b]) * c.sampleRate);
    const dur = Math.floor(0.13 * c.sampleRate);
    const f = 88 + b * 5;
    for (let i = 0; i < dur; i++) {
      const k = i / c.sampleRate;
      const env = Math.exp(-k * 34);
      const body = Math.sin(2 * Math.PI * f * k * (1 - k * 1.6));
      const grit = (Math.random() * 2 - 1) * Math.exp(-k * 130) * 0.5;
      const j = (start + i) % len;
      d[j] += (body * 0.75 + grit) * env * level[b] * 0.6;
    }
  }
  return buf;
}

/** Brown noise, wrapped with a crossfade so the loop point is inaudible. */
function makeWind(c: AudioContext): AudioBuffer {
  const secs = 4;
  const len = Math.floor(c.sampleRate * secs);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    last = (last + (Math.random() * 2 - 1) * 0.04) * 0.985;
    d[i] = last * 5;
  }
  const fade = Math.floor(c.sampleRate * 0.5);
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    d[i] = d[i] * k + d[len - fade + i] * (1 - k);
  }
  return buf;
}

function bedFor(c: AudioContext, name: Sfx): AudioBuffer | null {
  if (name === 'gallop') return (gallopBuf ??= makeGallop(c));
  if (name === 'wind') return (windBuf ??= makeWind(c));
  return null;
}

// --- playback ----------------------------------------------------------------

/** Shots get a touch of pitch variance so a burst never sounds copy-pasted. */
function variance(name: Sfx): number {
  return (name === 'rifle' || name === 'revolver' || name === 'shot')
    ? 0.97 + Math.random() * 0.06 : 1;
}

function playBuffer(c: AudioContext, buf: AudioBuffer, ch: Chain, at: number,
                    rate: number, looped: boolean): AudioBufferSourceNode {
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = looped;
  src.playbackRate.value = rate;
  src.connect(ch.input);
  src.start(at);
  if (!looped) src.onended = () => src.disconnect();
  return src;
}

function play(name: Sfx, opts: PlayOpts = {}): void {
  const c = ensure();
  if (!c || isMuted) return;
  if (c.state === 'suspended') void c.resume();
  const t = c.currentTime + 0.008;
  const rate = (opts.rate ?? 1) * variance(name);
  const ch = chain(c, opts);
  // 'wind' is an ambience, not a one-shot; 'gallop' can fire as a single cycle.
  const buf = samples.get(name) ?? (name === 'gallop' ? bedFor(c, name) : null);
  if (buf) playBuffer(c, buf, ch, t, rate, false);
  else SYNTH[name](t, ch.input, rate);
}

function loop(name: Sfx, opts: PlayOpts = {}): LoopHandle {
  const c = ensure();
  const dead: LoopHandle = {
    setPan() {}, setVol() {}, setRate() {}, stop() {},
  };
  if (!c) return dead;
  if (c.state === 'suspended') void c.resume();
  const buf = samples.get(name) ?? bedFor(c, name);
  if (!buf) return dead; // only 'gallop' and 'wind' have beds to loop
  const ch = chain(c, opts);

  // Wind breathes: a slow LFO opening and closing a lowpass in front of it.
  let lfo: OscillatorNode | null = null;
  let input: AudioNode = ch.input;
  if (name === 'wind' && !samples.has('wind')) {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 620;
    lp.Q.value = 0.6;
    const depth = c.createGain();
    depth.gain.value = 380;
    lfo = c.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.07;
    lfo.connect(depth); depth.connect(lp.frequency);
    lfo.start();
    lp.connect(ch.input);
    input = lp;
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.playbackRate.value = opts.rate ?? 1;
  src.connect(input);
  // Fade in, so starting a loop mid-scene never pops.
  const base = ch.gain.gain.value;
  ch.gain.gain.setValueAtTime(0.0001, c.currentTime);
  ch.gain.gain.linearRampToValueAtTime(base, c.currentTime + 0.3);
  src.start();

  let stopped = false;
  let level = base;
  const dist = clamp(opts.dist ?? 0, 0, 1);
  return {
    setPan(p) { if (ch.pan) ch.pan.pan.value = clamp(p, -1, 1); },
    setVol(v) {
      if (stopped) return;
      level = clamp(v, 0, 4) * (1 - 0.72 * dist);
      ch.gain.gain.setTargetAtTime(level, c.currentTime, 0.05);
    },
    setRate(r) { src.playbackRate.setTargetAtTime(Math.max(0.05, r), c.currentTime, 0.06); },
    stop(fade = 0.25) {
      if (stopped) return;
      stopped = true;
      const t = c.currentTime;
      // Cross-fade out rather than cutting, then tear the chain down.
      ch.gain.gain.cancelScheduledValues(t);
      ch.gain.gain.setValueAtTime(Math.max(0.0001, level), t);
      ch.gain.gain.linearRampToValueAtTime(0.0001, t + fade);
      src.stop(t + fade + 0.02);
      src.onended = () => {
        src.disconnect(); ch.gain.disconnect(); ch.pan?.disconnect();
        if (lfo) { lfo.stop(); lfo.disconnect(); }
      };
    },
  };
}

// --- sample loading ----------------------------------------------------------

/** "sfx/rifle.ogg" -> "rifle", if that is a name we know. */
function nameOf(path: string): Sfx | null {
  const file = path.split('/').pop() ?? '';
  const stem = file.replace(/\.[^.]+$/, '');
  return (NAMES as readonly string[]).includes(stem) ? (stem as Sfx) : null;
}

async function load(base: string, files: string[]): Promise<void> {
  const c = ensure();
  if (!c) return;
  const root = base.endsWith('/') ? base : base + '/';
  await Promise.all(files.map(async (f) => {
    const name = nameOf(f);
    if (!name) return;
    try {
      const res = await fetch(root + f);
      if (!res.ok) return;
      const bytes = await res.arrayBuffer();
      const buf = await c.decodeAudioData(bytes);
      samples.set(name, buf);
    } catch {
      // Missing or undecodable: that name simply keeps its synth voice.
    }
  }));
}

// --- public API --------------------------------------------------------------

export const audio = {
  /** Create/resume the context. Safe to call on every gesture. */
  init(): void {
    const c = ensure();
    if (!c) return;
    // iOS keeps the context suspended until a gesture touches it.
    if (c.state === 'suspended') void c.resume();
  },
  load,
  play,
  loop,
  get muted(): boolean { return isMuted; },
  setMuted(m: boolean): void {
    isMuted = m;
    try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* private mode */ }
    if (ac && master) {
      const t = ac.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(m ? 0 : 1, t + 0.12);
    }
  },
  /** True once the context exists, i.e. `play`/`loop` will make sound. */
  get ready(): boolean { return ac !== null; },
};
