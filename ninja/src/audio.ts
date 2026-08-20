// =============================================================================
// audio - chiptune via Web Audio, only started after a user gesture
// =============================================================================
import type { Medal } from "./constants";
import { storeGet, storeSet } from "./util";

export const audio = {
  ctx: null as AudioContext | null,
  master: null as GainNode | null,
  musicGain: null as GainNode | null,
  sfxGain: null as GainNode | null,
  muted: storeGet("ninja.muted", "0") === "1",
  playing: false, step: 0, nextTime: 0
};

const STEP_DUR = 0.125;
// two 16 step bars that alternate, giving a 32 step loop
const BASS = [
  40, 0, 40, 0, 47, 0, 40, 0, 45, 0, 45, 0, 43, 0, 43, 0,
  38, 0, 38, 0, 45, 0, 38, 0, 43, 0, 43, 0, 47, 0, 47, 0
];
const LEAD = [
  76, 0, 79, 0, 83, 0, 79, 0, 81, 0, 0, 79, 76, 0, 0, 0,
  74, 0, 78, 0, 81, 0, 78, 0, 83, 0, 0, 81, 79, 0, 76, 0
];

function mtof(m: number): number { return 440 * Math.pow(2, (m - 69) / 12); }

export function initAudio(): void {
  if (audio.ctx) {
    if (audio.ctx.state === "suspended") audio.ctx.resume();
    return;
  }
  const AC: typeof AudioContext | undefined =
    window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return;
  try { audio.ctx = new AC(); } catch (e) { audio.ctx = null; return; }

  audio.master = audio.ctx.createGain();
  audio.master.gain.value = audio.muted ? 0 : 1;
  audio.master.connect(audio.ctx.destination);

  audio.musicGain = audio.ctx.createGain();
  audio.musicGain.gain.value = 0.3;
  audio.musicGain.connect(audio.master);

  audio.sfxGain = audio.ctx.createGain();
  audio.sfxGain.gain.value = 0.6;
  audio.sfxGain.connect(audio.master);

  if (audio.ctx.state === "suspended") audio.ctx.resume();
}

// pushes the mute flag to the master gain and the store; the mute button's
// label is the UI's job (see ui.ts)
export function applyMute(): void {
  if (audio.master) audio.master.gain.value = audio.muted ? 0 : 1;
  storeSet("ninja.muted", audio.muted ? "1" : "0");
}

function tone(freq: number, start: number, dur: number, type: OscillatorType, peak: number,
              dest?: AudioNode | null, endFreq?: number): void {
  const ctx = audio.ctx;
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g);
  g.connect(dest || audio.sfxGain!);
  o.start(start);
  o.stop(start + dur + 0.04);
}

function noise(start: number, dur: number, f0: number, f1: number, peak: number): void {
  const ctx = audio.ctx;
  if (!ctx) return;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const k = 1 - i / len;
    d[i] = (Math.random() * 2 - 1) * k;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 1.1;
  f.frequency.setValueAtTime(f0, start);
  f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), start + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, start);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(f); f.connect(g); g.connect(audio.sfxGain!);
  src.start(start);
  src.stop(start + dur + 0.02);
}

export function startMusic(): void {
  if (!audio.ctx) return;
  audio.playing = true;
  audio.step = 0;
  audio.nextTime = audio.ctx.currentTime + 0.08;
}

export function pumpMusic(): void {
  if (!audio.ctx || !audio.playing) return;
  const now = audio.ctx.currentTime;
  if (audio.nextTime < now) audio.nextTime = now + 0.02;
  let guard = 0;
  while (audio.nextTime < now + 0.3 && guard++ < 96) {
    const i = audio.step % 32;
    const b = BASS[i];
    if (b) tone(mtof(b), audio.nextTime, 0.16, "square", 0.11, audio.musicGain);
    const l = LEAD[i];
    if (l) tone(mtof(l), audio.nextTime, 0.15, "triangle", 0.085, audio.musicGain);
    if (i % 4 === 0) noiseHat(audio.nextTime, 0.035, 0.02);
    else if (i % 2 === 0) noiseHat(audio.nextTime, 0.022, 0.009);
    audio.nextTime += STEP_DUR;
    audio.step++;
  }
}

function noiseHat(t: number, dur: number, peak: number): void {
  if (!audio.ctx) return;
  tone(7400, t, dur, "square", peak, audio.musicGain);
}

export function sfxJump(): void  { if (audio.ctx) tone(420, audio.ctx.currentTime, 0.15, "square", 0.15, null, 860); }
export function sfxLand(): void  { if (audio.ctx) tone(150, audio.ctx.currentTime, 0.09, "sine", 0.2, null, 70); }
export function sfxGrab(): void  { if (audio.ctx) { const t = audio.ctx.currentTime; tone(240, t, 0.07, "square", 0.18); tone(360, t + 0.03, 0.07, "square", 0.12); } }
export function sfxWhoosh(): void{ if (audio.ctx) noise(audio.ctx.currentTime, 0.3, 500, 2600, 0.2); }
export function sfxStep(): void  { if (audio.ctx) noise(audio.ctx.currentTime, 0.05, 900, 400, 0.05); }
export function sfxBounce(): void{ if (audio.ctx) { const t = audio.ctx.currentTime; tone(150, t, 0.18, "sine", 0.22, null, 540); tone(300, t + 0.03, 0.13, "triangle", 0.1, null, 980); } }

export function sfxFall(): void {
  const ctx = audio.ctx;
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const lfo = ctx.createOscillator();
  const lg = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(1250, t0);
  o.frequency.exponentialRampToValueAtTime(160, t0 + 1.05);
  lfo.type = "sine"; lfo.frequency.value = 7;
  lg.gain.value = 40;
  lfo.connect(lg); lg.connect(o.frequency);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.22, t0 + 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.15);
  o.connect(g); g.connect(audio.sfxGain!);
  o.start(t0); o.stop(t0 + 1.2);
  lfo.start(t0); lfo.stop(t0 + 1.2);
}

interface Fanfare { notes: number[]; step: number; dur: number; type: OscillatorType; peak: number }
const FANFARE: Record<Medal, Fanfare> = {
  gold:   { notes: [72, 76, 79, 84, 79, 84, 88], step: 0.11, dur: 0.34, type: "square", peak: 0.2 },
  silver: { notes: [69, 73, 76, 81, 81],         step: 0.12, dur: 0.3,  type: "square", peak: 0.17 },
  bronze: { notes: [65, 69, 72, 72],             step: 0.14, dur: 0.28, type: "triangle", peak: 0.17 }
};

export function sfxMedal(kind: Medal): void {
  if (!audio.ctx) return;
  const f = FANFARE[kind] || FANFARE.bronze;
  const t0 = audio.ctx.currentTime;
  for (let i = 0; i < f.notes.length; i++) {
    tone(mtof(f.notes[i]), t0 + i * f.step, f.dur, f.type, f.peak);
    tone(mtof(f.notes[i] - 12), t0 + i * f.step, f.dur, "triangle", f.peak * 0.5);
  }
  noise(t0, 0.5, 4000, 900, 0.09);
}
