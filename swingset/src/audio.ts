// audio.ts — pure WebAudio for Pirates of the Swingset. No assets.
// A looping 6/8 sea-shanty adventure tune (lead + bass + drone + tick) driven
// by a lookahead scheduler, plus event-driven sound effects.

import type { AudioApi, EventKey, GameCtx, HeldKind } from './types';

const MUTE_KEY = 'pirates-of-the-swingset-muted';

// --- musical material -------------------------------------------------------
// D dorian, 6/8, dotted-quarter ~100bpm. One "step" = one eighth note.

const EIGHTH = 0.2; // seconds
const STEPS_PER_BAR = 6;

type BarNotes = ReadonlyArray<readonly [number, number]>; // [midi (0 = rest), eighths]

/** 16-bar singable melody. */
const MELODY: ReadonlyArray<BarNotes> = [
  [[69, 1], [74, 2], [74, 1], [76, 1], [77, 1]],
  [[76, 3], [74, 3]],
  [[72, 1], [74, 2], [72, 1], [69, 1], [67, 1]],
  [[69, 5], [0, 1]],
  [[69, 1], [74, 2], [74, 1], [76, 1], [77, 1]],
  [[76, 3], [79, 3]],
  [[77, 1], [76, 2], [74, 1], [72, 1], [69, 1]],
  [[74, 5], [0, 1]],
  [[77, 2], [77, 1], [76, 2], [74, 1]],
  [[72, 3], [69, 3]],
  [[71, 2], [72, 1], [74, 2], [72, 1]],
  [[69, 5], [0, 1]],
  [[77, 2], [77, 1], [76, 2], [74, 1]],
  [[72, 3], [76, 3]],
  [[74, 1], [72, 1], [71, 1], [69, 1], [67, 1], [65, 1]],
  [[74, 4], [0, 1], [69, 1]],
];

/** Chord root (midi) + triad offsets, one per bar. */
const CHORDS: ReadonlyArray<readonly [number, readonly number[]]> = [
  [50, [0, 3, 7]], // Dm
  [50, [0, 3, 7]],
  [48, [0, 4, 7]], // C
  [45, [0, 3, 7]], // Am
  [50, [0, 3, 7]],
  [50, [0, 3, 7]],
  [48, [0, 4, 7]],
  [50, [0, 3, 7]],
  [41, [0, 4, 7]], // F
  [45, [0, 3, 7]], // Am
  [43, [0, 4, 7]], // G
  [45, [0, 3, 7]],
  [41, [0, 4, 7]],
  [48, [0, 4, 7]],
  [43, [0, 4, 7]],
  [50, [0, 3, 7]],
];

const BARS = MELODY.length;

function hz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ---------------------------------------------------------------------------

export function createAudio(ctx: GameCtx): AudioApi {
  let muted = localStorage.getItem(MUTE_KEY) === '1';

  let ac: AudioContext | null = null;
  let master: GainNode | null = null;
  let musicBus: GainNode | null = null;
  let sfxBus: GainNode | null = null;
  let noise: AudioBuffer | null = null;

  let timer: number | null = null;
  let nextStepTime = 0;
  let step = 0;
  let started = false;

  const LOOKAHEAD_MS = 100;
  const SCHEDULE_AHEAD = 0.3;

  // --- setup ---------------------------------------------------------------

  let audioUnavailable = false;

  function ensureContext(): AudioContext | null {
    if (ac) return ac;
    if (audioUnavailable) return null;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) {
      audioUnavailable = true;
      return null;
    }
    try {
      ac = new Ctor();
    } catch {
      // No audio on this device — every handler no-ops from here on.
      ac = null;
      audioUnavailable = true;
      return null;
    }
    master = ac.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ac.destination);
    musicBus = ac.createGain();
    musicBus.gain.value = 0.0;
    musicBus.connect(master);
    sfxBus = ac.createGain();
    sfxBus.gain.value = 0.9;
    sfxBus.connect(master);

    // A second of white noise, reused by every noisy sound.
    const len = Math.floor(ac.sampleRate);
    noise = ac.createBuffer(1, len, ac.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return ac;
  }

  // --- low-level voices ----------------------------------------------------

  interface ToneOpts {
    type?: OscillatorType;
    freq: number;
    freqTo?: number;
    at: number;
    dur: number;
    gain: number;
    attack?: number;
    detune?: number;
    filter?: number; // lowpass cutoff
    filterTo?: number;
    dest?: AudioNode;
  }

  function tone(o: ToneOpts): void {
    if (!ac || !sfxBus) return;
    const dest = o.dest ?? sfxBus;
    const osc = ac.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(Math.max(20, o.freq), o.at);
    if (o.freqTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqTo), o.at + o.dur);
    }
    if (o.detune) osc.detune.value = o.detune;

    const g = ac.createGain();
    const atk = o.attack ?? 0.006;
    g.gain.setValueAtTime(0.0001, o.at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), o.at + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, o.at + o.dur);

    let head: AudioNode = g;
    let lp: BiquadFilterNode | null = null;
    if (o.filter !== undefined) {
      lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(o.filter, o.at);
      if (o.filterTo !== undefined) {
        lp.frequency.linearRampToValueAtTime(o.filterTo, o.at + o.dur);
      }
      g.connect(lp);
      head = lp;
    }
    osc.connect(g);
    head.connect(dest);

    osc.start(o.at);
    osc.stop(o.at + o.dur + 0.02);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
      if (lp) lp.disconnect();
    };
  }

  interface NoiseOpts {
    at: number;
    dur: number;
    gain: number;
    type?: BiquadFilterType;
    freq: number;
    freqTo?: number;
    q?: number;
    attack?: number;
    dest?: AudioNode;
  }

  function noiseBurst(o: NoiseOpts): void {
    if (!ac || !sfxBus || !noise) return;
    const dest = o.dest ?? sfxBus;
    const src = ac.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;

    const f = ac.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    f.frequency.setValueAtTime(o.freq, o.at);
    if (o.freqTo !== undefined) {
      f.frequency.exponentialRampToValueAtTime(Math.max(30, o.freqTo), o.at + o.dur);
    }
    f.Q.value = o.q ?? 1;

    const g = ac.createGain();
    const atk = o.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, o.at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.gain), o.at + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, o.at + o.dur);

    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(o.at);
    src.stop(o.at + o.dur + 0.02);
    src.onended = () => {
      src.disconnect();
      f.disconnect();
      g.disconnect();
    };
  }

  function now(): number {
    return ac ? ac.currentTime + 0.02 : 0;
  }

  // --- music scheduler -----------------------------------------------------

  /** Melody note lookup: for each step of the loop, the note starting there. */
  const melodySteps: Array<{ midi: number; dur: number } | null> = [];
  for (const bar of MELODY) {
    const slots: Array<{ midi: number; dur: number } | null> = new Array(
      STEPS_PER_BAR,
    ).fill(null);
    let i = 0;
    for (const [midi, dur] of bar) {
      if (midi > 0 && i < STEPS_PER_BAR) slots[i] = { midi, dur };
      i += dur;
    }
    for (const s of slots) melodySteps.push(s);
  }
  const TOTAL_STEPS = BARS * STEPS_PER_BAR;

  function leadNote(midi: number, at: number, dur: number): void {
    if (!musicBus) return;
    const len = dur * EIGHTH * 0.92;
    const f = hz(midi);
    // Two slightly detuned voices through a lowpass — accordion/fiddle-ish.
    tone({
      type: 'sawtooth', freq: f, at, dur: len, gain: 0.075,
      attack: 0.03, detune: -7, filter: 1500, filterTo: 900, dest: musicBus,
    });
    tone({
      type: 'square', freq: f, at, dur: len, gain: 0.035,
      attack: 0.045, detune: 8, filter: 1100, dest: musicBus,
    });
  }

  function scheduleStep(s: number, at: number): void {
    const bar = Math.floor(s / STEPS_PER_BAR) % BARS;
    const beat = s % STEPS_PER_BAR;
    const [root, triad] = CHORDS[bar];

    const note = melodySteps[s % TOTAL_STEPS];
    if (note) leadNote(note.midi, at, note.dur);

    // Bass on the two dotted-quarter beats: root then fifth.
    if (beat === 0 || beat === 3) {
      const bm = beat === 0 ? root - 12 : root - 12 + 7;
      tone({
        type: 'triangle', freq: hz(bm), at, dur: EIGHTH * 2.4,
        gain: beat === 0 ? 0.14 : 0.1, attack: 0.012, filter: 480,
        dest: musicBus ?? undefined,
      });
    }

    // Soft drone/chord pad, once per bar.
    if (beat === 0) {
      for (const off of triad) {
        tone({
          type: 'sawtooth', freq: hz(root + off), at, dur: EIGHTH * STEPS_PER_BAR,
          gain: 0.022, attack: 0.25, filter: 620, dest: musicBus ?? undefined,
        });
      }
    }

    // Light percussive tick.
    if (beat === 0) {
      noiseBurst({ at, dur: 0.06, gain: 0.07, freq: 2600, q: 0.9, dest: musicBus ?? undefined });
    } else if (beat === 3) {
      noiseBurst({ at, dur: 0.05, gain: 0.045, freq: 3400, q: 1.2, dest: musicBus ?? undefined });
    } else if (beat === 2 || beat === 5) {
      noiseBurst({ at, dur: 0.03, gain: 0.02, freq: 5200, q: 1.4, dest: musicBus ?? undefined });
    }
  }

  function tick(): void {
    if (!ac) return;
    // A hidden tab throttles the interval; without this the loop below would
    // dump every missed step into the past and they'd all fire at once.
    if (nextStepTime < ac.currentTime) {
      const missed = Math.ceil((ac.currentTime - nextStepTime) / EIGHTH);
      step = (step + missed) % TOTAL_STEPS;
      nextStepTime += missed * EIGHTH;
    }
    while (nextStepTime < ac.currentTime + SCHEDULE_AHEAD) {
      scheduleStep(step, nextStepTime);
      step = (step + 1) % TOTAL_STEPS;
      nextStepTime += EIGHTH;
    }
  }

  function startMusic(): void {
    if (!ac || !musicBus) return;
    if (!started) {
      started = true;
      step = 0;
      nextStepTime = ac.currentTime + 0.15;
      musicBus.gain.setValueAtTime(0.0001, ac.currentTime);
      musicBus.gain.linearRampToValueAtTime(0.55, ac.currentTime + 2.0);
    }
    // Also restarts the scheduler after a pagehide stopped it.
    if (timer === null) {
      tick();
      timer = window.setInterval(tick, LOOKAHEAD_MS);
    }
  }

  // --- sound effects -------------------------------------------------------

  function boom(): void {
    const t = now();
    noiseBurst({ at: t, dur: 0.5, gain: 0.5, type: 'lowpass', freq: 900, freqTo: 120, q: 0.7 });
    tone({ type: 'sine', freq: 160, freqTo: 32, at: t, dur: 0.6, gain: 0.5 });
    tone({ type: 'triangle', freq: 90, freqTo: 40, at: t + 0.02, dur: 0.35, gain: 0.22 });
  }

  function splash(): void {
    const t = now();
    noiseBurst({ at: t, dur: 0.45, gain: 0.34, type: 'highpass', freq: 700, freqTo: 3000, q: 0.6 });
    noiseBurst({ at: t + 0.05, dur: 0.5, gain: 0.16, freq: 1600, freqTo: 500, q: 1.5 });
  }

  function thud(): void {
    const t = now();
    noiseBurst({ at: t, dur: 0.28, gain: 0.32, type: 'lowpass', freq: 600, freqTo: 90 });
    tone({ type: 'sine', freq: 110, freqTo: 38, at: t, dur: 0.45, gain: 0.38 });
    tone({ type: 'sine', freq: 55, at: t, dur: 0.7, gain: 0.16 });
  }

  function woodCrack(): void {
    const t = now();
    noiseBurst({ at: t, dur: 0.09, gain: 0.4, freq: 1900, freqTo: 700, q: 2.5 });
    tone({ type: 'square', freq: 420, freqTo: 150, at: t, dur: 0.14, gain: 0.16 });
  }

  function bodyThump(): void {
    const t = now();
    tone({ type: 'sine', freq: 190, freqTo: 60, at: t, dur: 0.2, gain: 0.4 });
    noiseBurst({ at: t, dur: 0.12, gain: 0.2, type: 'lowpass', freq: 800, freqTo: 200 });
  }

  function creak(at: number, gain: number): void {
    for (let i = 0; i < 5; i++) {
      const p = at + i * 0.07 + Math.random() * 0.03;
      noiseBurst({
        at: p, dur: 0.09, gain: gain * (0.6 + Math.random() * 0.5),
        freq: 700 + Math.random() * 900, freqTo: 300, q: 8,
      });
    }
  }

  function on(key: EventKey, fn: () => void): void {
    ctx.events.on(key, () => {
      if (!ac || muted) return;
      fn();
    });
  }

  ctx.events.on('cannonFire', () => {
    if (!ac || muted) return;
    boom();
  });

  ctx.events.on('cannonImpact', (e) => {
    if (!ac || muted) return;
    switch (e.kind) {
      case 'water': splash(); break;
      case 'ground': thud(); break;
      case 'swing': woodCrack(); thud(); break;
      case 'player': bodyThump(); break;
    }
  });

  on('swingBroken', () => {
    const t = now();
    noiseBurst({ at: t, dur: 0.06, gain: 0.45, freq: 2600, freqTo: 900, q: 3 });
    tone({ type: 'square', freq: 700, freqTo: 180, at: t, dur: 0.12, gain: 0.2 });
    creak(t + 0.08, 0.14);
  });

  on('heartLost', () => {
    const t = now();
    tone({ type: 'triangle', freq: hz(69), at: t, dur: 0.3, gain: 0.28, filter: 1800 });
    tone({ type: 'triangle', freq: hz(68), at: t + 0.1, dur: 0.35, gain: 0.26, filter: 1600 });
    tone({ type: 'sine', freq: hz(56), at: t + 0.16, dur: 0.6, gain: 0.22 });
  });

  on('shipDamaged', () => {
    const t = now();
    noiseBurst({ at: t, dur: 0.16, gain: 0.34, type: 'lowpass', freq: 1400, freqTo: 300, q: 1 });
    tone({ type: 'square', freq: 260, freqTo: 90, at: t, dur: 0.18, gain: 0.18 });
    creak(t + 0.05, 0.08);
  });

  on('shipSunk', () => {
    const t = now();
    // Little D-minor-to-major fanfare.
    const motif: Array<[number, number]> = [[62, 0], [69, 0.13], [74, 0.26], [78, 0.42]];
    for (const [m, off] of motif) {
      tone({
        type: 'sawtooth', freq: hz(m), at: t + off, dur: 0.45, gain: 0.16,
        attack: 0.01, filter: 2400,
      });
      tone({ type: 'square', freq: hz(m - 12), at: t + off, dur: 0.4, gain: 0.07, filter: 900 });
    }
    // Bubbles.
    for (let i = 0; i < 14; i++) {
      const p = t + 0.35 + i * 0.07 + Math.random() * 0.05;
      tone({
        type: 'sine', freq: 300 + Math.random() * 500, freqTo: 900 + Math.random() * 600,
        at: p, dur: 0.1, gain: 0.06,
      });
    }
    noiseBurst({ at: t + 0.3, dur: 1.1, gain: 0.12, type: 'lowpass', freq: 900, freqTo: 250 });
  });

  on('shipJammed', () => {
    const t = now();
    tone({ type: 'square', freq: 1300, freqTo: 900, at: t, dur: 0.12, gain: 0.22, filter: 4000 });
    noiseBurst({ at: t, dur: 0.1, gain: 0.32, freq: 3200, q: 4 });
    for (let i = 0; i < 6; i++) {
      noiseBurst({
        at: t + 0.14 + i * 0.05, dur: 0.06, gain: 0.12,
        freq: 500 + Math.random() * 400, freqTo: 200, q: 3,
      });
    }
  });

  on('toolPickedUp', () => {
    const t = now();
    tone({ type: 'triangle', freq: hz(74), at: t, dur: 0.12, gain: 0.24, filter: 3000 });
    tone({ type: 'triangle', freq: hz(81), at: t + 0.07, dur: 0.18, gain: 0.2, filter: 3000 });
  });

  ctx.events.on('itemThrown', (e) => {
    if (!ac || muted) return;
    const t = now();
    const heavy: HeldKind[] = ['log', 'cannonball'];
    const big = heavy.includes(e.kind);
    noiseBurst({
      at: t, dur: big ? 0.42 : 0.24, gain: big ? 0.3 : 0.2, type: 'bandpass',
      freq: big ? 500 : 1400, freqTo: big ? 160 : 500, q: 1.2,
    });
    if (big) tone({ type: 'sine', freq: 150, freqTo: 60, at: t, dur: 0.35, gain: 0.16 });
  });

  on('ballCaught', () => {
    const t = now();
    tone({ type: 'sawtooth', freq: 70, at: t, dur: 0.32, gain: 0.14, filter: 500 });
    tone({ type: 'square', freq: 240, freqTo: 1500, at: t, dur: 0.22, gain: 0.14, filter: 3500 });
    noiseBurst({ at: t + 0.05, dur: 0.16, gain: 0.16, freq: 2400, freqTo: 5200, q: 3 });
  });

  on('chainsawRevved', () => {
    const t = now();
    tone({
      type: 'sawtooth', freq: 120, freqTo: 260, at: t, dur: 0.16,
      gain: 0.14, filter: 1200, filterTo: 2600,
    });
    tone({
      type: 'square', freq: 61, freqTo: 130, at: t, dur: 0.34,
      gain: 0.12, filter: 900, filterTo: 2000,
    });
    noiseBurst({ at: t, dur: 0.34, gain: 0.14, type: 'bandpass', freq: 1800, q: 2 });
  });

  on('treeFelled', () => {
    const t = now();
    creak(t, 0.18);
    noiseBurst({ at: t + 0.4, dur: 0.4, gain: 0.34, type: 'lowpass', freq: 700, freqTo: 90 });
    tone({ type: 'sine', freq: 120, freqTo: 34, at: t + 0.4, dur: 0.5, gain: 0.34 });
    noiseBurst({ at: t + 0.45, dur: 0.5, gain: 0.12, freq: 3000, freqTo: 1200, q: 1 });
  });

  on('lookoutReached', () => {
    const t = now();
    const chime = [76, 81, 84, 88];
    chime.forEach((m, i) => {
      tone({
        type: 'sine', freq: hz(m), at: t + i * 0.09, dur: 0.7,
        gain: 0.13, attack: 0.05,
      });
    });
  });

  on('roundStarted', () => {
    const t = now();
    const call: Array<[number, number, number]> = [
      [62, 0, 0.16], [69, 0.16, 0.16], [74, 0.32, 0.2], [72, 0.52, 0.34],
    ];
    for (const [m, off, dur] of call) {
      tone({
        type: 'sawtooth', freq: hz(m), at: t + off, dur, gain: 0.15,
        attack: 0.012, filter: 2200,
      });
      tone({ type: 'triangle', freq: hz(m - 12), at: t + off, dur, gain: 0.1, filter: 700 });
    }
  });

  on('gameOver', () => {
    const t = now();
    const fall: Array<[number, number]> = [[57, 0], [55, 0.35], [53, 0.7], [50, 1.05]];
    for (const [m, off] of fall) {
      tone({
        type: 'sawtooth', freq: hz(m), at: t + off, dur: 0.6, gain: 0.15,
        attack: 0.07, filter: 900,
      });
      tone({ type: 'sine', freq: hz(m - 12), at: t + off, dur: 0.7, gain: 0.12 });
    }
  });

  // --- API -----------------------------------------------------------------

  const api: AudioApi = {
    get muted() {
      return muted;
    },
    toggleMute() {
      muted = !muted;
      localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
      if (ac && master) {
        const t = ac.currentTime;
        master.gain.cancelScheduledValues(t);
        master.gain.setValueAtTime(master.gain.value, t);
        master.gain.linearRampToValueAtTime(muted ? 0.0001 : 1, t + 0.12);
      }
    },
    userGesture() {
      const c = ensureContext();
      if (!c) return;
      if (c.state === 'suspended') void c.resume();
      startMusic();
    },
    update() {
      // The lookahead scheduler runs on its own interval; nothing per-frame.
    },
  };

  window.addEventListener('pagehide', () => {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
  });

  // Coming back (bfcache / tab restore) must not leave the tune dead.
  window.addEventListener('pageshow', () => {
    if (!ac) return;
    if (ac.state === 'suspended') void ac.resume();
    startMusic();
  });

  return api;
}
