// gunshot.ts — Circle the Wagons gunshots, rendered offline.
//
// The shot is the one sound the player hears hundreds of times a Run, and a
// live oscillator-and-noise patch never stops sounding like one. So the Rifle,
// the Six-shooter and the Riders' distant pistols are rendered once, sample by
// sample, into short mono buffers that audio.ts plays exactly like recordings
// — only the noise seed and the playback rate vary between shots.
//
// Plain numbers in, Float32Array out, no WebAudio: the same function runs
// under Node to write a WAV and audition the sound outside the game.
//
// Heard from the muzzle, a gunshot is, in order:
//   1. the N-wave — the muzzle-blast pressure spike, under a millisecond wide
//   2. the crack — a few ms of full-band noise, highpassed: the "snap"
//   3. the body — 20–40 ms of blast whose spectrum darkens as it goes
//   4. the thump — the low push, a pitch dropping into the chest
//   5. (Rifle) a faint metallic ring of barrel and action
//   6. slapback — early reflections off the Stagecoaches 7.5 m away
//   7. the tail — the echo rolling out across the prairie, highs dying first
// all driven through a soft clipper, because every gunshot anyone has heard
// through a speaker was a recording of an overloaded microphone, and that
// squash is part of the sound.

export type ShotKind = 'rifle' | 'revolver' | 'far';

interface ShotParams {
  dur: number;             // seconds rendered
  nwaveT: number;          // N-wave width, s
  nwave: number;           // N-wave level (pre-clip)
  crackHp: number; crack: number; crackTau: number;
  bodyHi: number; bodyLo: number; bodySweep: number; bodyTau: number; body: number;
  thumpF0: number; thumpF1: number; thumpFTau: number; thumpTau: number; thump: number;
  rumbleTau: number; rumble: number;
  ring: number;            // barrel/action ring level
  er: number; erLp: number; // early-reflection level and cutoff scale
  tail: number; tailTau: number; tailLp: number;
  drive: number;           // soft-clip drive
}

const PARAMS: Record<ShotKind, ShotParams> = {
  // Lever-action rifle: the sharpest crack, the deepest thump, a long tail.
  rifle: {
    dur: 1.8, nwaveT: 0.00055, nwave: 2.2,
    crackHp: 1600, crack: 1.6, crackTau: 0.0025,
    bodyHi: 7000, bodyLo: 380, bodySweep: 0.022, bodyTau: 0.032, body: 1.1,
    thumpF0: 125, thumpF1: 42, thumpFTau: 0.045, thumpTau: 0.10, thump: 0.9,
    rumbleTau: 0.09, rumble: 1.0,
    ring: 0.10,
    er: 1.0, erLp: 1.0,
    tail: 1.0, tailTau: 1.0, tailLp: 1.0,
    drive: 1.0,
  },
  // Six-shooter: brighter, snappier, less sub, a shorter tail.
  revolver: {
    dur: 1.4, nwaveT: 0.0004, nwave: 2.0,
    crackHp: 2400, crack: 1.7, crackTau: 0.002,
    bodyHi: 8000, bodyLo: 520, bodySweep: 0.016, bodyTau: 0.022, body: 1.0,
    thumpF0: 170, thumpF1: 58, thumpFTau: 0.03, thumpTau: 0.065, thump: 0.65,
    rumbleTau: 0.07, rumble: 0.6,
    ring: 0,
    er: 0.9, erLp: 1.1,
    tail: 0.8, tailTau: 0.75, tailLp: 1.1,
    drive: 1.0,
  },
  // A Rider's pistol out on the prairie: the air has rounded the transient
  // off, the tail is most of what reaches us. audio.ts adds the distance
  // lowpass on top.
  far: {
    dur: 1.5, nwaveT: 0.0007, nwave: 0.6,
    crackHp: 900, crack: 0.7, crackTau: 0.004,
    bodyHi: 3500, bodyLo: 300, bodySweep: 0.03, bodyTau: 0.035, body: 0.9,
    thumpF0: 110, thumpF1: 45, thumpFTau: 0.05, thumpTau: 0.09, thump: 0.5,
    rumbleTau: 0.12, rumble: 0.8,
    ring: 0,
    er: 0.6, erLp: 0.7,
    tail: 1.6, tailTau: 1.2, tailLp: 0.8,
    drive: 1.0,
  },
};

// --- little DSP --------------------------------------------------------------

/** mulberry32 — small, seedable, good enough for noise. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type FilterType = 'lowpass' | 'highpass' | 'bandpass';

/** RBJ biquad, transposed direct form II. */
class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private z1 = 0; private z2 = 0;
  private readonly type: FilterType; private readonly sr: number; private readonly q: number;
  constructor(type: FilterType, sr: number, f: number, q: number) {
    this.type = type; this.sr = sr; this.q = q;
    this.set(f);
  }
  set(f: number): void {
    const w = 2 * Math.PI * Math.min(Math.max(f, 10), this.sr * 0.45) / this.sr;
    const cs = Math.cos(w), sn = Math.sin(w);
    const al = sn / (2 * this.q);
    let b0: number, b1: number, b2: number;
    if (this.type === 'lowpass') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
    else if (this.type === 'highpass') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
    else { b0 = al; b1 = 0; b2 = -al; }
    const a0 = 1 + al;
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
    this.a1 = -2 * cs / a0; this.a2 = (1 - al) / a0;
  }
  run(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/** Attack-then-exponential-decay envelope, starting at t0. */
function env(t: number, t0: number, atk: number, tau: number): number {
  const u = t - t0;
  if (u <= 0) return 0;
  return (1 - Math.exp(-u / atk)) * Math.exp(-u / tau);
}

// --- the render --------------------------------------------------------------

/**
 * Renders one shot of `kind` at `sampleRate`. `seed` picks the noise, and
 * nudges a few timings, so several renders of the same gun differ the way
 * real shots do. Output peaks at 0.95.
 */
export function renderShot(kind: ShotKind, sampleRate: number, seed = 1): Float32Array<ArrayBuffer> {
  const p = PARAMS[kind];
  const sr = sampleRate;
  const rand = rng(seed * 7919 + 17);
  const white = () => rand() * 2 - 1;
  const jit = (s: number) => 1 + (rand() * 2 - 1) * s;

  const n = Math.floor(p.dur * sr);
  const out = new Float32Array(n);
  const dry = new Float32Array(n);
  // The dry part is silent well before this; it bounds the reflection loops.
  const dryEnd = Math.min(n, Math.floor(0.4 * sr));

  // 1–5: the dry shot -------------------------------------------------------
  const crackHp = new Biquad('highpass', sr, p.crackHp * jit(0.08), 0.7);
  const bodyLp = new Biquad('lowpass', sr, p.bodyHi, 0.9);
  const rumbleLp = new Biquad('lowpass', sr, 150, 1.0);
  const bodyTau = p.bodyTau * jit(0.1);
  const thumpF0 = p.thumpF0 * jit(0.06);
  let phase = 0;
  for (let i = 0; i < dryEnd; i++) {
    const t = i / sr;
    let v = 0;
    // N-wave: +1 at the muzzle, sliding to -1, then nothing.
    if (t < p.nwaveT) v += p.nwave * (1 - 2 * t / p.nwaveT);
    // Crack.
    v += p.crack * crackHp.run(white()) * Math.exp(-t / p.crackTau);
    // Body: noise through a lowpass that starts wide open and slams shut.
    if ((i & 7) === 0) bodyLp.set(p.bodyLo + (p.bodyHi - p.bodyLo) * Math.exp(-t / p.bodySweep));
    v += p.body * bodyLp.run(white()) * Math.exp(-t / bodyTau);
    // Thump: a sine dropping in pitch, plus a lowpassed rumble under it.
    const f = p.thumpF1 + (thumpF0 - p.thumpF1) * Math.exp(-t / p.thumpFTau);
    phase += 2 * Math.PI * f / sr;
    v += p.thump * Math.sin(phase) * env(t, 0, 0.0012, p.thumpTau);
    v += p.rumble * 5 * rumbleLp.run(white()) * env(t, 0, 0.003, p.rumbleTau);
    // Ring: two inharmonic partials, a metallic tink from the action.
    if (p.ring > 0) {
      v += p.ring * (Math.sin(2 * Math.PI * 3150 * t) * Math.exp(-t / 0.028)
        + 0.5 * Math.sin(2 * Math.PI * 4720 * t) * Math.exp(-t / 0.016)) * env(t, 0.0015, 0.0008, 1);
    }
    dry[i] = v;
  }

  // 6: slapback off the Stagecoaches, 7.5 m out: round trip ~44 ms, then the
  // coaches beyond and the multiple bounces, each later, quieter and darker.
  const taps: Array<[number, number, number]> = [
    [0.044, 0.22, 3000], [0.058, 0.16, 2600], [0.079, 0.12, 2200],
    [0.105, 0.09, 1900], [0.138, 0.06, 1500], [0.190, 0.04, 1200],
  ];
  for (const [d, g, lpF] of taps) {
    const off = Math.floor(d * jit(0.06) * sr);
    const lp = new Biquad('lowpass', sr, lpF * p.erLp, 0.8);
    const gain = g * p.er;
    for (let i = 0; i < dryEnd && i + off < n; i++) out[i + off] += gain * lp.run(dry[i]);
  }

  // 7: the tail. Four noise bands, each with its own decay — the highs are
  // gone in a tenth of a second, the sub rolls on past a second — under a
  // slow random "rolling" modulation so it reads as thunder, not hiss.
  const tailTau = p.tailTau * jit(0.1);
  const bands: Array<{ f: Biquad; tau: number; g: number }> = [
    { f: new Biquad('bandpass', sr, 2800 * p.tailLp, 0.6), tau: 0.11 * tailTau, g: 0.30 },
    { f: new Biquad('bandpass', sr, 1000 * p.tailLp, 0.7), tau: 0.32 * tailTau, g: 0.22 },
    { f: new Biquad('lowpass', sr, 380 * p.tailLp, 0.7), tau: 0.75 * tailTau, g: 0.7 },
    { f: new Biquad('lowpass', sr, 130, 0.8), tau: 0.9 * tailTau, g: 1.2 },
  ];
  const rollA = Math.exp(-2 * Math.PI * 9 / sr);
  let roll = 0;
  const t0 = 0.008;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    roll = roll * rollA + white() * (1 - rollA);
    const mod = 1 + 22 * roll; // one-pole LP of white at 9 Hz, scaled to ±~0.3
    let v = 0;
    for (const b of bands) v += b.g * b.f.run(white()) * env(t, t0, 0.014, b.tau);
    out[i] += p.tail * 0.5 * mod * v;
  }

  // Mix, soft-clip, normalise.
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const y = Math.tanh((out[i] + dry[i]) * p.drive);
    out[i] = y;
    if (Math.abs(y) > peak) peak = Math.abs(y);
  }
  if (peak > 0) { const k = 0.95 / peak; for (let i = 0; i < n; i++) out[i] *= k; }
  return out;
}
