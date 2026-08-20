// =========================================================================
// audio (all synthesized, Web Audio)
// =========================================================================
import { storeGet, storeSet } from "./util";

interface AudioSys {
  ctx: AudioContext | null;
  master: GainNode | null;
  musicGain: GainNode | null;
  sfxGain: GainNode | null;
  muted: boolean;
  mode: string;
  playing: boolean;
  step: number;
  nextTime: number;
  buzzSrc: AudioBufferSourceNode | null;
  buzzGain: GainNode | null;
  buzzLfo: OscillatorNode | null;
  lastPlip: number;
}

export const audio: AudioSys = {
  ctx: null, master: null, musicGain: null, sfxGain: null,
  muted: storeGet("beedraw.muted", "0") === "1",
  mode: "", playing: false, step: 0, nextTime: 0,
  buzzSrc: null, buzzGain: null, buzzLfo: null, lastPlip: 0
};

const STEP_DUR = 0.13;
const T_BASS = [45, 0, 52, 0, 45, 0, 52, 0, 43, 0, 50, 0, 41, 0, 48, 0];
const T_MEL  = [69, 0, 72, 0, 76, 0, 74, 72, 69, 0, 71, 0, 72, 0, 0, 0];
const G_BASS = [45, 0, 0, 0, 48, 0, 0, 0, 43, 0, 0, 0, 41, 0, 0, 0];
const G_MEL  = [0, 0, 76, 0, 0, 0, 0, 0, 0, 0, 74, 0, 0, 0, 72, 0];

function mtof(m: number): number { return 440 * Math.pow(2, (m - 69) / 12); }

export function initAudio(): void {
  if (audio.ctx) { if (audio.ctx.state === "suspended") audio.ctx.resume(); return; }
  const AC = window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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

export function applyMute(): void {
  if (audio.master) audio.master.gain.value = audio.muted ? 0 : 1;
  storeSet("beedraw.muted", audio.muted ? "1" : "0");
}

function tone(freq: number, start: number, dur: number, type: OscillatorType,
              peak: number, dest?: AudioNode | null): void {
  if (!audio.ctx) return;
  const o = audio.ctx.createOscillator(), gn = audio.ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  gn.gain.setValueAtTime(0.0001, start);
  gn.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  gn.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(gn); gn.connect(dest || audio.sfxGain!);
  o.start(start); o.stop(start + dur + 0.03);
}

function slide(f1: number, f2: number, start: number, dur: number,
               type: OscillatorType, peak: number): void {
  if (!audio.ctx) return;
  const o = audio.ctx.createOscillator(), gn = audio.ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f1, start);
  o.frequency.exponentialRampToValueAtTime(f2, start + dur);
  gn.gain.setValueAtTime(0.0001, start);
  gn.gain.exponentialRampToValueAtTime(peak, start + 0.03);
  gn.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(gn); gn.connect(audio.sfxGain!);
  o.start(start); o.stop(start + dur + 0.05);
}

export function setMusic(mode: string): void {
  initAudio();
  audio.mode = mode;
  if (!audio.ctx) return;
  if (mode === "") { audio.playing = false; return; }
  if (!audio.playing) { audio.step = 0; audio.nextTime = audio.ctx.currentTime + 0.06; }
  audio.playing = true;
}

export function pumpMusic(): void {
  if (!audio.ctx || !audio.playing) return;
  const now = audio.ctx.currentTime;
  if (audio.nextTime < now) audio.nextTime = now + 0.02;
  let guard = 0;
  const bass = audio.mode === "title" ? T_BASS : G_BASS;
  const mel = audio.mode === "title" ? T_MEL : G_MEL;
  while (audio.nextTime < now + 0.25 && guard++ < 64) {
    const i = audio.step % 16;
    if (bass[i]) tone(mtof(bass[i]), audio.nextTime, 0.14, "square", 0.09, audio.musicGain);
    if (mel[i]) tone(mtof(mel[i]), audio.nextTime, 0.2, "triangle", 0.085, audio.musicGain);
    if (audio.mode === "title" && i % 4 === 2) tone(6200, audio.nextTime, 0.03, "square", 0.012, audio.musicGain);
    audio.nextTime += STEP_DUR;
    audio.step++;
  }
}

function makeNoise(): AudioBuffer {
  const ctx = audio.ctx!;
  const len = Math.floor(ctx.sampleRate * 1.2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export function startBuzz(): void {
  initAudio();
  if (!audio.ctx || audio.buzzSrc) return;
  const src = audio.ctx.createBufferSource();
  src.buffer = makeNoise();
  src.loop = true;
  const bp = audio.ctx.createBiquadFilter();
  bp.type = "bandpass"; bp.frequency.value = 320; bp.Q.value = 5;
  const lfo = audio.ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 24;
  const lfoG = audio.ctx.createGain(); lfoG.gain.value = 90;
  lfo.connect(lfoG); lfoG.connect(bp.frequency);
  const gn = audio.ctx.createGain();
  gn.gain.setValueAtTime(0.0001, audio.ctx.currentTime);
  gn.gain.linearRampToValueAtTime(0.16, audio.ctx.currentTime + 0.5);
  src.connect(bp); bp.connect(gn); gn.connect(audio.sfxGain!);
  src.start(); lfo.start();
  audio.buzzSrc = src; audio.buzzGain = gn; audio.buzzLfo = lfo;
}

export function stopBuzz(): void {
  if (!audio.ctx || !audio.buzzSrc) return;
  const t = audio.ctx.currentTime;
  try {
    audio.buzzGain!.gain.cancelScheduledValues(t);
    audio.buzzGain!.gain.setValueAtTime(audio.buzzGain!.gain.value || 0.0001, t);
    audio.buzzGain!.gain.linearRampToValueAtTime(0.0001, t + 0.25);
    audio.buzzSrc.stop(t + 0.3);
    audio.buzzLfo!.stop(t + 0.3);
  } catch (e) { /* already stopped */ }
  audio.buzzSrc = null; audio.buzzGain = null; audio.buzzLfo = null;
}

export function sfxPlip(): void {
  if (!audio.ctx) return;
  const now = audio.ctx.currentTime;
  if (now - audio.lastPlip < 0.055) return;
  audio.lastPlip = now;
  tone(560 + Math.random() * 260, now, 0.05, "sine", 0.06);
}
export function sfxTap(): void {
  initAudio();
  if (audio.ctx) tone(760, audio.ctx.currentTime, 0.07, "square", 0.08);
}
export function sfxWin(): void {
  initAudio(); if (!audio.ctx) return;
  const t = audio.ctx.currentTime, n = [72, 76, 79, 84];
  for (let i = 0; i < n.length; i++) tone(mtof(n[i]), t + i * 0.11, 0.24, "triangle", 0.16);
  tone(mtof(88), t + 0.46, 0.5, "sine", 0.12);
}
export function sfxLose(): void {
  initAudio(); if (!audio.ctx) return;
  const t = audio.ctx.currentTime;
  slide(330, 150, t, 0.75, "sawtooth", 0.11);
  tone(mtof(52), t + 0.1, 0.6, "triangle", 0.08);
}
