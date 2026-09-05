// =============================================================================
// audio — every sound is synthesized with Web Audio; there are no asset files.
//
//   master ─┬─ sfx    (0.55)  one-shots: swish, bounce, rim, trumpet, …
//           └─ crowd  (var)   looping murmur bed, gain follows setCrowd(level)
//
// The heavy sounds (crowd cheer, the "aww" groan, the buzzer, the murmur bed)
// are rendered once through an OfflineAudioContext into AudioBuffers and then
// played back like recordings — the same trick wagons/ uses for its gunshots.
// Everything short is built live from a handful of nodes, so a swish or a rim
// clank costs almost nothing. Buffers are cached; nothing exists until
// unlock() (or the first sound) creates the AudioContext, and every method is
// a safe no-op when audio is unavailable.
// =============================================================================
import type { Sfx, Who } from './types';

const MUTE_KEY = 'slamtrunk.muted';

const SFX_LEVEL = 0.55;
/** setCrowd(1) ends up at this gain — a murmur, never a wall of noise. */
const CROWD_LEVEL = 0.22;

// ---- tiny helpers (context-agnostic: they also run under OfflineAudioContext)
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
/** MIDI note → Hz */
const mtof = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** 2 s of white noise per context, reused by every noisy voice. */
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuffer(c: BaseAudioContext): AudioBuffer {
  let buf = noiseCache.get(c);
  if (!buf) {
    const len = Math.floor(c.sampleRate * 2);
    buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(c, buf);
  }
  return buf;
}

interface ToneOpts {
  type?: OscillatorType;
  /** frequency at the end of the sound (exponential glide) */
  endFreq?: number;
  attack?: number;
  /** vibrato rate in Hz (0 = none) */
  vibRate?: number;
  /** vibrato depth in cents */
  vibCents?: number;
  /** linear ramp down instead of exponential (softer tails) */
  hold?: number;
}

/** One enveloped oscillator, optionally glided and vibrato'd. Fire and forget. */
function tone(
  c: BaseAudioContext, dest: AudioNode, freq: number, t: number, dur: number, peak: number,
  o: ToneOpts = {},
): void {
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(Math.max(20, freq), t);
  if (o.endFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.endFreq), t + dur);
  }
  const atk = o.attack ?? 0.008;
  const hold = o.hold ?? 0;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + atk);
  if (hold > 0) g.gain.setValueAtTime(Math.max(0.0002, peak), t + Math.min(dur * 0.9, atk + hold));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.05);
  if (o.vibRate && o.vibCents) {
    const lfo = c.createOscillator();
    const lg = c.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = o.vibRate;
    lg.gain.value = o.vibCents;
    lfo.connect(lg);
    lg.connect(osc.detune);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }
}

/** A burst of filtered noise sweeping f0 → f1 over its life. */
function noise(
  c: BaseAudioContext, dest: AudioNode, t: number, dur: number, f0: number, f1: number,
  peak: number, type: BiquadFilterType = 'bandpass', q = 1.1, attack = 0.01,
): void {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.loop = true;
  src.playbackRate.value = rnd(0.85, 1.15);
  const f = c.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(Math.max(40, f0), t);
  f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(dest);
  src.start(t);
  src.stop(t + dur + 0.05);
}

/** Looping filtered noise with a slow gain LFO — the bed under a crowd. */
function noiseBed(
  c: BaseAudioContext, dest: AudioNode, t: number, dur: number, type: BiquadFilterType,
  freq: number, q: number, level: number, lfoRate: number, lfoDepth: number, rate = 1,
): void {
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.loop = true;
  src.playbackRate.value = rate;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.value = level;
  src.connect(f); f.connect(g); g.connect(dest);
  src.start(t);
  src.stop(t + dur);
  if (lfoDepth > 0) {
    const lfo = c.createOscillator();
    const lg = c.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = lfoRate;
    lg.gain.value = lfoDepth;
    lfo.connect(lg);
    lg.connect(g.gain);
    lfo.start(t);
    lfo.stop(t + dur);
  }
}

// =============================================================================
// the offline-rendered sounds
// =============================================================================
type Rendered = 'cheer' | 'groan' | 'buzzer' | 'murmur';

const RENDER_SECONDS: Record<Rendered, number> = {
  cheer: 1.9,
  groan: 1.3,
  buzzer: 1.3,
  murmur: 4,
};

/** Crowd roar: a swelling band of noise, voices on top, a few whoops. */
function buildCheer(c: BaseAudioContext, dest: AudioNode, dur: number): void {
  const t = 0;
  const swell = (type: BiquadFilterType, freq: number, q: number, peak: number, rise: number) => {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + rise);
    g.gain.linearRampToValueAtTime(peak * 0.75, t + dur * 0.62);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t); src.stop(t + dur);
  };
  swell('bandpass', 780, 0.55, 0.5, 0.34);   // the body of the roar
  swell('highpass', 2400, 0.7, 0.13, 0.28);  // hiss / whistles
  swell('lowpass', 260, 0.6, 0.2, 0.5);      // rumble of feet
  // individual voices poking out of the crowd
  for (let i = 0; i < 16; i++) {
    const at = t + rnd(0.02, dur * 0.7);
    const f0 = rnd(380, 1000);
    tone(c, dest, f0, at, rnd(0.16, 0.34), rnd(0.02, 0.055), {
      type: 'sawtooth', endFreq: f0 * rnd(1.1, 1.5), attack: 0.03, vibRate: rnd(4, 8), vibCents: 40,
    });
  }
}

/** Crowd "aww": everything sags — noise and voices fall together. */
function buildGroan(c: BaseAudioContext, dest: AudioNode, dur: number): void {
  const t = 0;
  noise(c, dest, t, dur, 950, 340, 0.34, 'bandpass', 0.7, 0.14);
  noise(c, dest, t, dur * 0.8, 2000, 700, 0.06, 'highpass', 0.7, 0.1);
  for (const [f, det] of [[300, 1], [300, 1.01], [225, 1], [188, 1.008], [150, 1]] as const) {
    tone(c, dest, f * det, t, dur * rnd(0.8, 0.95), 0.075, {
      type: 'sawtooth', endFreq: f * det * 0.62, attack: 0.13, vibRate: 4.5, vibCents: 22,
    });
  }
}

/** End-of-game buzzer: a harsh, gritty, unpleasant slab of sawtooth. */
function buildBuzzer(c: BaseAudioContext, dest: AudioNode, dur: number): void {
  const t = 0;
  const body = c.createGain();
  body.gain.setValueAtTime(0.0001, t);
  body.gain.exponentialRampToValueAtTime(0.5, t + 0.006);
  body.gain.setValueAtTime(0.5, t + dur - 0.05);
  body.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 2600; lp.Q.value = 4;
  lp.connect(body); body.connect(dest);
  for (const f of [104, 106.5, 156, 208]) {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const g = c.createGain();
    g.gain.value = f < 150 ? 0.5 : 0.24;
    o.connect(g); g.connect(lp);
    o.start(t); o.stop(t + dur);
  }
  // fast amplitude grit — what makes a buzzer buzz rather than hum
  const grit = c.createOscillator();
  const gg = c.createGain();
  grit.type = 'square';
  grit.frequency.value = 58;
  gg.gain.value = 0.22;
  grit.connect(gg); gg.connect(body.gain);
  grit.start(t); grit.stop(t + dur);
  noise(c, dest, t, dur, 1500, 1100, 0.07, 'bandpass', 1.6, 0.01);
}

/** Between-play murmur: a loopable bed of low chatter. */
function buildMurmur(c: BaseAudioContext, dest: AudioNode, dur: number): void {
  const t = 0;
  noiseBed(c, dest, t, dur, 'bandpass', 430, 0.6, 0.55, 0.11, 0.22, 0.75);
  noiseBed(c, dest, t, dur, 'lowpass', 220, 0.5, 0.3, 0.07, 0.12, 0.45);
  noiseBed(c, dest, t, dur, 'highpass', 1800, 0.7, 0.05, 0.17, 0.03);
}

const BUILDERS: Record<Rendered, (c: BaseAudioContext, dest: AudioNode, dur: number) => void> = {
  cheer: buildCheer,
  groan: buildGroan,
  buzzer: buildBuzzer,
  murmur: buildMurmur,
};

// =============================================================================
// createSfx
// =============================================================================
export function createSfx(): Sfx {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let sfxBus: GainNode | null = null;
  let crowdBus: GainNode | null = null;
  let failed = false;
  let isMuted = readMuted();

  const buffers = new Map<Rendered, AudioBuffer>();
  const pending = new Set<Rendered>();
  let murmurSrc: AudioBufferSourceNode | null = null;
  let crowdLevel = 0;

  function readMuted(): boolean {
    try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
  }
  function writeMuted(m: boolean): void {
    try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* private mode */ }
  }

  const AC = (): typeof AudioContext | undefined =>
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  /** Creates the graph on first use. Returns null when audio is unavailable. */
  function ensure(): AudioContext | null {
    if (ctx || failed) return ctx;
    const Ctor = AC();
    if (!Ctor) { failed = true; return null; }
    try {
      ctx = new Ctor();
    } catch { failed = true; return null; }
    master = ctx.createGain();
    master.gain.value = isMuted ? 0 : 1;
    master.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = SFX_LEVEL;
    sfxBus.connect(master);
    crowdBus = ctx.createGain();
    crowdBus.gain.value = 0.0001;
    crowdBus.connect(master);
    // Render the heavy sounds off the gesture that built the context — each is
    // a few ms of work and none of them is needed in the first second.
    setTimeout(() => { for (const k of Object.keys(BUILDERS) as Rendered[]) void render(k); }, 0);
    return ctx;
  }

  /** Renders `key` into a cached AudioBuffer (once). */
  function render(key: Rendered): Promise<AudioBuffer | null> {
    const have = buffers.get(key);
    if (have) return Promise.resolve(have);
    const c = ensure();
    if (!c) return Promise.resolve(null);
    if (pending.has(key)) return Promise.resolve(null);
    pending.add(key);
    const dur = RENDER_SECONDS[key];
    const OAC = window.OfflineAudioContext;
    if (!OAC) { pending.delete(key); return Promise.resolve(null); }
    let off: OfflineAudioContext;
    try {
      off = new OAC(1, Math.ceil(dur * c.sampleRate), c.sampleRate);
    } catch { pending.delete(key); return Promise.resolve(null); }
    const out = off.createGain();
    out.gain.value = 0.9;
    out.connect(off.destination);
    try {
      BUILDERS[key](off, out, dur);
    } catch { pending.delete(key); return Promise.resolve(null); }
    return off.startRendering().then((buf) => {
      pending.delete(key);
      buffers.set(key, buf);
      return buf;
    }).catch(() => { pending.delete(key); return null; });
  }

  /** Plays a rendered buffer, rendering it first if it is not cached yet. */
  function playRendered(key: Rendered, gain = 1): void {
    const c = ensure();
    if (!c || !sfxBus) return;
    const buf = buffers.get(key);
    if (buf) { playBuf(c, sfxBus, buf, gain); return; }
    void render(key).then((b) => {
      if (b && ctx && sfxBus) playBuf(ctx, sfxBus, b, gain);
    });
  }

  function playBuf(c: AudioContext, dest: AudioNode, buf: AudioBuffer, gain: number): void {
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(g); g.connect(dest);
    src.start(c.currentTime);
  }

  /** The murmur loop; started lazily the first time the crowd is turned up. */
  function startMurmur(): void {
    if (murmurSrc) return;
    const c = ensure();
    if (!c || !crowdBus) return;
    const buf = buffers.get('murmur');
    if (!buf) {
      void render('murmur').then((b) => { if (b && crowdLevel > 0) startMurmur(); });
      return;
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(crowdBus);
    src.start(c.currentTime);
    murmurSrc = src;
  }

  const now = (): number => (ctx ? ctx.currentTime : 0);

  return {
    unlock(): void {
      const c = ensure();
      if (!c) return;
      if (c.state === 'suspended') void c.resume().catch(() => { /* blocked */ });
    },

    // ---- ball / hoop ------------------------------------------------------
    /** Soft whoosh through the net — mostly air, a hint of flutter. */
    swish(): void {
      const c = ensure(); if (!c || !sfxBus) return;
      const t = now();
      noise(c, sfxBus, t, 0.26, 3200, 900, 0.28, 'bandpass', 0.9, 0.02);
      noise(c, sfxBus, t + 0.02, 0.2, 6500, 2600, 0.1, 'highpass', 0.7, 0.02);
      // two little net ticks as the peanut drops through
      noise(c, sfxBus, t + 0.1, 0.05, 2200, 1200, 0.07, 'bandpass', 2);
      noise(c, sfxBus, t + 0.16, 0.05, 1800, 900, 0.05, 'bandpass', 2);
    },

    /** A peanut hitting hardwood: short, low, woody thump. */
    bounce(): void {
      const c = ensure(); if (!c || !sfxBus) return;
      const t = now();
      tone(c, sfxBus, 165, t, 0.15, 0.36, { type: 'sine', endFreq: 52, attack: 0.003 });
      tone(c, sfxBus, 320, t, 0.07, 0.12, { type: 'triangle', endFreq: 180, attack: 0.002 });
      noise(c, sfxBus, t, 0.05, 900, 200, 0.16, 'lowpass', 1, 0.002);
    },

    /** The ceramic bowl on its steel pole: a bright inharmonic clank. */
    rim(): void {
      const c = ensure(); if (!c || !sfxBus) return;
      const t = now();
      const base = rnd(600, 700);
      const partials: Array<[number, number, number]> = [
        [1, 0.2, 0.16], [2.74, 0.26, 0.1], [5.41, 0.19, 0.07], [8.93, 0.13, 0.045],
      ];
      for (const [r, dur, peak] of partials) {
        tone(c, sfxBus, base * r, t, dur, peak, { type: 'sine', attack: 0.002 });
      }
      noise(c, sfxBus, t, 0.04, 4200, 1600, 0.14, 'bandpass', 1.4, 0.001);
      tone(c, sfxBus, 190, t, 0.12, 0.12, { type: 'triangle', endFreq: 90, attack: 0.003 });
    },

    // ---- elephants --------------------------------------------------------
    /** Elephant trumpet: pitch rises then falls, vibrato, formant-ish buzz. */
    trumpet(who: Who): void {
      const c = ensure(); if (!c || !sfxBus) return;
      const t = now();
      const peanut = who === 'peanut';
      const base = peanut ? 350 : 205;      // Peanut is higher and friendlier
      const dur = peanut ? 0.85 : 1.05;
      const peak = base * (peanut ? 1.55 : 1.4);

      // a shaped mouth: two formant bandpasses fed by a buzzy saw
      const outG = c.createGain();
      outG.gain.setValueAtTime(0.0001, t);
      outG.gain.exponentialRampToValueAtTime(0.34, t + 0.06);
      outG.gain.setValueAtTime(0.34, t + dur * 0.62);
      outG.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      outG.connect(sfxBus);
      for (const [ff, fq, lvl] of [[peanut ? 900 : 640, 3, 1], [peanut ? 2100 : 1500, 5, 0.45]] as const) {
        const f = c.createBiquadFilter();
        f.type = 'bandpass'; f.frequency.value = ff; f.Q.value = fq;
        const g = c.createGain();
        g.gain.value = lvl;
        f.connect(g); g.connect(outG);

        const osc = c.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(base * 0.72, t);
        osc.frequency.linearRampToValueAtTime(peak, t + dur * 0.34);
        osc.frequency.linearRampToValueAtTime(base * 1.05, t + dur * 0.7);
        osc.frequency.linearRampToValueAtTime(base * 0.62, t + dur);
        osc.connect(f);
        osc.start(t); osc.stop(t + dur + 0.05);

        const lfo = c.createOscillator();
        const lg = c.createGain();
        lfo.type = 'sine';
        lfo.frequency.value = peanut ? 8 : 6;
        lg.gain.value = peanut ? 55 : 42;   // cents
        lfo.connect(lg); lg.connect(osc.detune);
        lfo.start(t); lfo.stop(t + dur + 0.05);
      }
      // breath around the tone
      noise(c, sfxBus, t, dur * 0.9, base * 3, base * 1.6, 0.05, 'bandpass', 1.2, 0.08);
    },

    // ---- crowd ------------------------------------------------------------
    cheer(): void { playRendered('cheer', 1); },
    groan(): void { playRendered('groan', 0.9); },
    buzzer(): void { playRendered('buzzer', 1); },

    /** Referee whistle: a shrill warbling pair of tones plus air. */
    whistle(): void {
      const c = ensure(); if (!c || !sfxBus) return;
      const t = now();
      const dur = 0.42;
      tone(c, sfxBus, 2550, t, dur, 0.16, {
        type: 'sine', attack: 0.012, hold: dur * 0.6, vibRate: 24, vibCents: 90,
      });
      tone(c, sfxBus, 3820, t, dur, 0.07, {
        type: 'sine', attack: 0.015, hold: dur * 0.6, vibRate: 24, vibCents: 90,
      });
      noise(c, sfxBus, t, dur, 2600, 2400, 0.07, 'bandpass', 6, 0.015);
    },

    // ---- contact / rewards ------------------------------------------------
    /** A trunk slapping the peanut away: slap on top of a thud. */
    block(): void {
      const c = ensure(); if (!c || !sfxBus) return;
      const t = now();
      noise(c, sfxBus, t, 0.09, 2400, 500, 0.3, 'bandpass', 0.8, 0.002);
      tone(c, sfxBus, 130, t, 0.17, 0.3, { type: 'sine', endFreq: 48, attack: 0.003 });
      noise(c, sfxBus, t, 0.05, 600, 160, 0.14, 'lowpass', 1, 0.002);
    },

    /** Bright two-note ding. */
    coin(): void {
      const c = ensure(); if (!c || !sfxBus) return;
      const t = now();
      tone(c, sfxBus, mtof(88), t, 0.13, 0.2, { type: 'square', attack: 0.003 });
      tone(c, sfxBus, mtof(95), t + 0.08, 0.3, 0.18, { type: 'square', attack: 0.003 });
      tone(c, sfxBus, mtof(107), t + 0.08, 0.26, 0.07, { type: 'sine', attack: 0.004 });
      noise(c, sfxBus, t + 0.06, 0.24, 9000, 4500, 0.04, 'highpass', 0.6);
    },

    /** Countdown beep; `final` is the GO chirp. */
    tick(final: boolean): void {
      const c = ensure(); if (!c || !sfxBus) return;
      const t = now();
      if (!final) {
        tone(c, sfxBus, 620, t, 0.17, 0.22, { type: 'square', attack: 0.004 });
        tone(c, sfxBus, 310, t, 0.17, 0.09, { type: 'triangle' });
      } else {
        tone(c, sfxBus, 880, t, 0.5, 0.26, { type: 'square', endFreq: 1320, attack: 0.005 });
        tone(c, sfxBus, 1320, t, 0.5, 0.11, { type: 'triangle', endFreq: 1980 });
        tone(c, sfxBus, 440, t, 0.5, 0.08, { type: 'sawtooth', endFreq: 660 });
        noise(c, sfxBus, t, 0.3, 6000, 2200, 0.07, 'highpass', 0.6);
      }
    },

    // ---- beds / mute ------------------------------------------------------
    setCrowd(level: number): void {
      crowdLevel = clamp(level, 0, 1);
      const c = ensure();
      if (!c || !crowdBus) return;
      if (crowdLevel > 0) startMurmur();
      const t = c.currentTime;
      crowdBus.gain.cancelScheduledValues(t);
      crowdBus.gain.setTargetAtTime(Math.max(0.0001, crowdLevel * CROWD_LEVEL), t, 0.4);
    },

    setMuted(m: boolean): void {
      isMuted = m;
      writeMuted(m);
      if (ctx && master) {
        const t = ctx.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setTargetAtTime(m ? 0 : 1, t, 0.03);
      }
    },

    muted(): boolean { return isMuted; },
  };
}
