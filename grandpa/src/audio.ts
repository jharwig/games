// WebAudio synth — no assets. Grandpa's snore IS the soundtrack and the
// timing instrument: steady snore = safe, sputtering snorts = the Stir cue.
// Everything routes through `master` so the mute toggle is one gain.

let ac: AudioContext | null = null;
let master: GainNode | null = null;

export const audio = {
  muted: false,
};

try {
  audio.muted = localStorage.getItem('grandpa.muted') === '1';
} catch {
  audio.muted = false;
}

type SnoreMode = 'off' | 'steady' | 'stir';
let snoreMode: SnoreMode = 'off';
let nextSnoreAt = 0;
let tvOn = false;
let nextTvNoteAt = 0;

export function initAudio(): void {
  if (ac) { if (ac.state === 'suspended') void ac.resume(); return; }
  ac = new AudioContext();
  master = ac.createGain();
  master.gain.value = audio.muted ? 0 : 1;
  master.connect(ac.destination);
  setInterval(schedule, 60);
}

export function toggleMute(): boolean {
  audio.muted = !audio.muted;
  if (master) master.gain.value = audio.muted ? 0 : 1;
  try { localStorage.setItem('grandpa.muted', audio.muted ? '1' : '0'); } catch { /* private mode */ }
  return audio.muted;
}

export function setSnore(mode: SnoreMode): void {
  if (mode !== snoreMode && ac) nextSnoreAt = Math.max(nextSnoreAt, ac.currentTime + 0.05);
  snoreMode = mode;
}

export function setTVNoise(on: boolean): void { tvOn = on; }

function schedule(): void {
  if (!ac || !master) return;
  const now = ac.currentTime;
  // snore cycles, scheduled a beat ahead so rhythm stays steady
  while (snoreMode !== 'off' && nextSnoreAt < now + 0.25) {
    const t = Math.max(nextSnoreAt, now);
    if (snoreMode === 'steady') { snoreCycle(t); nextSnoreAt = t + 1.75; }
    else { sputter(t); nextSnoreAt = t + 0.62; }
  }
  if (nextSnoreAt < now) nextSnoreAt = now;
  // blaring TV: an endless, slightly-off cartoon jingle
  while (tvOn && nextTvNoteAt < now + 0.2) {
    const t = Math.max(nextTvNoteAt, now);
    const notes = [392, 523, 440, 587, 494, 659, 349];
    tone(t, notes[Math.floor(Math.random() * notes.length)], 0.16, 'square', 0.055);
    tone(t, 98, 0.16, 'sawtooth', 0.03);
    nextTvNoteAt = t + 0.18;
  }
  if (nextTvNoteAt < now) nextTvNoteAt = now;
}

// ---- synth building blocks ----------------------------------------------

function tone(t: number, freq: number, dur: number, type: OscillatorType, vol: number,
  slideTo?: number, vibrato?: number): void {
  if (!ac || !master) return;
  const o = ac.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.04, dur * 0.3));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  if (vibrato) {
    const lfo = ac.createOscillator();
    lfo.frequency.value = vibrato;
    const lg = ac.createGain();
    lg.gain.value = freq * 0.06;
    lfo.connect(lg); lg.connect(o.frequency);
    lfo.start(t); lfo.stop(t + dur);
  }
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(t: number, dur: number, vol: number, freq: number, q = 1): void {
  if (!ac || !master) return;
  const len = Math.ceil(ac.sampleRate * dur);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buf;
  const f = ac.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = ac.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t); src.stop(t + dur);
}

// ---- the snore -----------------------------------------------------------

function snoreCycle(t: number): void {
  // inhale: a low rattling growl that climbs
  tone(t, 62, 0.75, 'sawtooth', 0.11, 92, 22);
  noise(t, 0.7, 0.06, 300, 0.8);
  // exhale: a soft descending whistle — "hoooo"
  tone(t + 0.95, 780, 0.55, 'sine', 0.05, 520);
}

function sputter(t: number): void {
  // choked staccato snorts — THE wake-up-is-coming sound
  tone(t, 110, 0.12, 'sawtooth', 0.14, 180, 30);
  noise(t, 0.12, 0.12, 700, 1.2);
  tone(t + 0.2, 95, 0.09, 'sawtooth', 0.12, 160);
  noise(t + 0.2, 0.09, 0.1, 900, 1.2);
}

// ---- one-shot sfx --------------------------------------------------------

export function sfx(name: string): void {
  if (!ac || !master) return;
  const t = ac.currentTime;
  switch (name) {
    case 'pickup':
      tone(t, 300, 0.09, 'triangle', 0.12, 520);
      break;
    case 'stash':
      tone(t, 260, 0.12, 'triangle', 0.14, 130);
      noise(t + 0.02, 0.1, 0.08, 500);
      break;
    case 'display':
      tone(t, 660, 0.1, 'triangle', 0.12);
      tone(t + 0.09, 990, 0.16, 'triangle', 0.12);
      break;
    case 'reject':
      tone(t, 200, 0.14, 'square', 0.08, 160);
      break;
    case 'dog':
      tone(t, 460, 0.07, 'square', 0.12, 340);
      tone(t + 0.09, 430, 0.07, 'square', 0.1, 300);
      break;
    case 'kid':
      tone(t, 520, 0.08, 'triangle', 0.12, 700);
      tone(t + 0.09, 700, 0.1, 'triangle', 0.1, 900);
      break;
    case 'craftPop':
      tone(t, 400, 0.08, 'triangle', 0.12, 800);
      break;
    case 'crash':
      noise(t, 0.25, 0.16, 900, 0.7);
      tone(t, 180, 0.2, 'sawtooth', 0.1, 70);
      break;
    case 'squeakTV':
      tone(t, 900, 0.06, 'square', 0.1, 500);
      break;
    case 'chime': {
      for (let i = 0; i < 2; i++) {
        tone(t + i * 0.45, 784, 0.8, 'sine', 0.12);
        tone(t + i * 0.45, 1568, 0.5, 'sine', 0.05);
      }
      break;
    }
    case 'grumbleSting':
      // wah-wah-waaah, but grumpy and short
      tone(t, 220, 0.14, 'square', 0.09, 190);
      tone(t + 0.16, 190, 0.14, 'square', 0.09, 165);
      tone(t + 0.32, 160, 0.3, 'square', 0.1, 120, 8);
      break;
    case 'likeSting':
      tone(t, 523, 0.09, 'triangle', 0.1);
      tone(t + 0.09, 659, 0.09, 'triangle', 0.1);
      tone(t + 0.18, 784, 0.09, 'triangle', 0.1);
      tone(t + 0.27, 1047, 0.22, 'triangle', 0.12);
      break;
    case 'kettle':
      // the blow-his-top whistle: long rising shriek + steam
      tone(t, 500, 1.7, 'sine', 0.001);
      tone(t + 0.05, 620, 1.7, 'sawtooth', 0.09, 1900, 14);
      tone(t + 0.05, 1240, 1.7, 'sine', 0.07, 3800);
      noise(t + 0.9, 1.1, 0.1, 3000, 0.6);
      break;
    case 'boing':
      tone(t, 140, 0.4, 'sine', 0.14, 60, 18);
      break;
  }
}
