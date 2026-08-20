// audio (all synthesized, Web Audio)

interface AudioState {
  ctx: AudioContext | null;
  master: GainNode | null;
  musicGain: GainNode | null;
  sfxGain: GainNode | null;
  muted: boolean;
  playing: boolean;
  step: number;
  nextTime: number;
}

export const audio: AudioState = {
  ctx: null,
  master: null,
  musicGain: null,
  sfxGain: null,
  muted: false,
  playing: false,
  step: 0,
  nextTime: 0,
};

try {
  audio.muted = localStorage.getItem('block.muted') === '1';
} catch {
  audio.muted = false;
}

const STEP_DUR = 0.135; // 16th-ish steps
// simple looping chiptune: bass line + sparse melody (MIDI notes, 0 = rest)
const BASS = [45, 0, 45, 0, 48, 0, 45, 0, 43, 0, 43, 0, 41, 0, 41, 0];
const MELODY = [69, 0, 0, 72, 0, 76, 0, 0, 0, 74, 0, 0, 72, 0, 69, 0];

function mtof(m: number): number {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function initAudio(): void {
  if (audio.ctx) {
    if (audio.ctx.state === 'suspended') audio.ctx.resume();
    return;
  }
  const AC = window.AudioContext || (window as any).webkitAudioContext;
  if (!AC) return;
  try {
    audio.ctx = new AC();
  } catch {
    audio.ctx = null;
    return;
  }
  audio.master = audio.ctx.createGain();
  audio.master.gain.value = audio.muted ? 0 : 1;
  audio.master.connect(audio.ctx.destination);

  audio.musicGain = audio.ctx.createGain();
  audio.musicGain.gain.value = 0.34;
  audio.musicGain.connect(audio.master);

  audio.sfxGain = audio.ctx.createGain();
  audio.sfxGain.gain.value = 0.6;
  audio.sfxGain.connect(audio.master);

  if (audio.ctx.state === 'suspended') audio.ctx.resume();
}

export function applyMute(): void {
  if (audio.master) audio.master.gain.value = audio.muted ? 0 : 1;
  try {
    localStorage.setItem('block.muted', audio.muted ? '1' : '0');
  } catch {
    /* private mode */
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType, peak: number, dest?: GainNode): void {
  if (!audio.ctx) return;
  const o = audio.ctx.createOscillator();
  const g = audio.ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, start);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g);
  g.connect(dest || audio.sfxGain!);
  o.start(start);
  o.stop(start + dur + 0.03);
}

export function startMusic(): void {
  if (!audio.ctx) return;
  audio.playing = true;
  audio.step = 0;
  audio.nextTime = audio.ctx.currentTime + 0.06;
}

export function stopMusic(): void {
  audio.playing = false;
}

export function pumpMusic(): void {
  if (!audio.ctx || !audio.playing) return;
  const now = audio.ctx.currentTime;
  // the loop is paused while the tab is hidden - resync instead of dumping
  // every missed step at once
  if (audio.nextTime < now) audio.nextTime = now + 0.02;
  let guard = 0;
  while (audio.nextTime < now + 0.25 && guard++ < 64) {
    const i = audio.step % 16;
    const b = BASS[i];
    if (b) tone(mtof(b), audio.nextTime, 0.13, 'square', 0.1, audio.musicGain!);
    const m = MELODY[i];
    if (m) tone(mtof(m), audio.nextTime, 0.19, 'triangle', 0.09, audio.musicGain!);
    // soft hat every 4th step
    if (i % 4 === 2) tone(6000, audio.nextTime, 0.03, 'square', 0.012, audio.musicGain!);
    audio.nextTime += STEP_DUR;
    audio.step++;
  }
}

// explosion: bright noise burst with a fast filter drop, a low sine thump
// and a descending buzz tail. Routed through sfxGain, so mute applies.
export function sfxExplosion(): void {
  if (!audio.ctx) return;
  const t0 = audio.ctx.currentTime;

  // noise burst - the body of the blast
  const len = Math.floor(audio.ctx.sampleRate * 0.55);
  const buf = audio.ctx.createBuffer(1, len, audio.ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const k = 1 - i / len;
    d[i] = (Math.random() * 2 - 1) * k * k;
  }
  const src = audio.ctx.createBufferSource();
  src.buffer = buf;
  const f = audio.ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(6000, t0);
  f.frequency.exponentialRampToValueAtTime(1200, t0 + 0.09);
  f.frequency.exponentialRampToValueAtTime(140, t0 + 0.5);
  const g = audio.ctx.createGain();
  g.gain.setValueAtTime(0.62, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
  src.connect(f);
  f.connect(g);
  g.connect(audio.sfxGain!);
  src.start(t0);

  // low sine thump
  const th = audio.ctx.createOscillator();
  const tg = audio.ctx.createGain();
  th.type = 'sine';
  th.frequency.setValueAtTime(140, t0);
  th.frequency.exponentialRampToValueAtTime(34, t0 + 0.4);
  tg.gain.setValueAtTime(0.5, t0);
  tg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
  th.connect(tg);
  tg.connect(audio.sfxGain!);
  th.start(t0);
  th.stop(t0 + 0.5);

  // descending buzz tail
  const o = audio.ctx.createOscillator();
  const og = audio.ctx.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(300, t0 + 0.03);
  o.frequency.exponentialRampToValueAtTime(48, t0 + 0.38);
  og.gain.setValueAtTime(0.12, t0 + 0.03);
  og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
  o.connect(og);
  og.connect(audio.sfxGain!);
  o.start(t0 + 0.03);
  o.stop(t0 + 0.44);
}

export function sfxMilestone(): void {
  if (!audio.ctx) return;
  const t0 = audio.ctx.currentTime;
  const notes = [72, 76, 79, 84];
  for (let i = 0; i < notes.length; i++) {
    tone(mtof(notes[i]), t0 + i * 0.07, 0.16, 'square', 0.16);
  }
}

// coin pickup: one blip for bronze, two for silver, a run of three for gold
export function sfxCoin(tier: number): void {
  if (!audio.ctx) return;
  const t0 = audio.ctx.currentTime;
  const notes = tier === 2 ? [84, 88, 93] : tier === 1 ? [84, 89] : [86];
  for (let i = 0; i < notes.length; i++) {
    tone(mtof(notes[i]), t0 + i * 0.055, 0.09, 'square', 0.11);
  }
}

export function sfxBuy(): void {
  if (!audio.ctx) return;
  const t0 = audio.ctx.currentTime;
  const notes = [72, 76, 79, 84];
  for (let i = 0; i < notes.length; i++) {
    tone(mtof(notes[i]), t0 + i * 0.06, 0.12, 'triangle', 0.14);
  }
}

export function sfxDeny(): void {
  if (!audio.ctx) return;
  const t0 = audio.ctx.currentTime;
  tone(120, t0, 0.12, 'square', 0.1);
  tone(98, t0 + 0.1, 0.14, 'square', 0.1);
}

export function sfxEquip(): void {
  if (!audio.ctx) return;
  tone(mtof(81), audio.ctx.currentTime, 0.08, 'triangle', 0.12);
}
