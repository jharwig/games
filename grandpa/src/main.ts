// Composition root and ALL game rules: the Nap → Stir → Wake-up cycle, the
// gaze sweep and its judgments, the Grump Meter, the chaos spawner, scoring,
// the hourly difficulty ramp, and the title / game-over flow.

import {
  NAP_MIN, NAP_MAX, STIR_LEN, SPAWN_EVERY, SWEEP_TIME, REACT_PAUSE, SETTLE_LEN,
  METER_MAX, LIKE_DRAIN, SEVERITY, PTS_LIKE_SEEN, PTS_SURVIVE, PTS_SURVIVE_HOUR,
  Judgeable, ramp, rand, clamp,
} from './constants';
import { ctx, resize, outline } from './gfx';
import {
  drawRoom, stashSpotAt, displaySlotAt, onTV, GAZE_START, GAZE_END, StashId,
} from './room';
import {
  items, clearItems, updateItems, removeItem, itemAt, slotTaken, drawItem,
  messStashPts, MessKind, Item,
} from './items';
import {
  initCast, updateAgents, drawAgents, startEvent, beingAt, tapDog, tapKid,
  agentJudgeables, AgentWorld, ChaosKind, DOG_ROSTER,
} from './agents';
import {
  grandpa, setMode, updateGrandpa, drawGrandpa, drawGaze, drawCallout, REACTIONS,
} from './grandpa';
import { initAudio, sfx, setSnore, setTVNoise } from './audio';
import { initInput } from './input';
import { initUI, setHUD, showHUD, showTitle, hideTitle, showGameOver } from './ui';

// ---- run state -----------------------------------------------------------

type GameState = 'title' | 'playing' | 'over';
type Phase = 'nap' | 'stir' | 'sweep' | 'react' | 'settle' | 'blow';

let state: GameState = 'title';
let phase: Phase = 'nap';
let phaseT = 0;
let napLen = 14;
let stirLen = 2.5;
let hour = 0;
let score = 0;
let meter = 0;
let spawnIn = 4;
let tvOn = false;
let chimeClock = 99;
const stash: Record<StashId, number> = { bin: 0, hamper: 0, couch: 0 };
let held: Item | null = null;
let judged = new Set<string>();
let admiredItem: Item | null = null;   // craft to whisk away after its Reaction
let time = 0;

interface Popup { x: number; y: number; text: string; color: string; t: number }
const popups: Popup[] = [];

const params = new URLSearchParams(location.search);
const startHour = Math.max(0, parseInt(params.get('hour') ?? '0') || 0);

// ---- persistence ---------------------------------------------------------

interface Best { hours: number; score: number }

function loadBest(): Best | null {
  try {
    const v = localStorage.getItem('grandpa.best');
    return v ? (JSON.parse(v) as Best) : null;
  } catch { return null; }
}
function saveBest(b: Best): void {
  try { localStorage.setItem('grandpa.best', JSON.stringify(b)); } catch { /* private mode */ }
}
function loadDogs(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem('grandpa.dogs') ?? '[]') as string[];
    const valid = v.filter(n => DOG_ROSTER.some(d => d.name === n));
    if (valid.length === 2) return valid;
  } catch { /* fall through */ }
  return ['Nova', 'Will-E'];
}
let pickedDogs = loadDogs();
function saveDogs(names: string[]): void {
  try { localStorage.setItem('grandpa.dogs', JSON.stringify(names)); } catch { /* private mode */ }
}

// ---- the world the agents act in ----------------------------------------

const world: AgentWorld = {
  setTV(on: boolean): void {
    tvOn = on;
    setTVNoise(on);
    sfx('squeakTV');
  },
  tvIsOn: () => tvOn,
  sweepables: () => items.filter(i =>
    !i.craft && !i.removing && !i.held && i.kind !== 'cushion'),
  sweptUp(it: Item): void {
    removeItem(it);
    const pts = Math.ceil(messStashPts(it.kind as MessKind) / 2);
    score += pts;
    popup(it.x, it.y - 20, `+${pts}`, '#57b843');
    sfx('stash');
  },
};

function popup(x: number, y: number, text: string, color: string): void {
  popups.push({ x, y, text, color, t: 0 });
}

// ---- run flow ------------------------------------------------------------

function startRun(): void {
  initCast(pickedDogs);
  clearItems();
  popups.length = 0;
  score = 0; meter = 0; hour = startHour;
  tvOn = false; setTVNoise(false);
  stash.bin = 0; stash.hamper = 0; stash.couch = 0;
  held = null;
  spawnIn = 4;
  chimeClock = 99;
  state = 'playing';
  beginNap(true);
  hideTitle();
  showHUD(true);
}

function beginNap(first = false): void {
  phase = 'nap';
  phaseT = 0;
  napLen = rand(ramp(NAP_MIN, hour), ramp(NAP_MAX, hour)) + (first ? 2 : 0);
  stirLen = ramp(STIR_LEN, hour);
  setMode('nap');
  setSnore('steady');
}

function endRun(): void {
  state = 'over';
  setSnore('off');
  setTVNoise(false);
  const prev = loadBest();
  const isNew = !prev || hour > prev.hours || (hour === prev.hours && score > prev.score);
  const best: Best = isNew ? { hours: hour, score } : prev!;
  if (isNew) saveBest(best);
  showGameOver(hour, score, best, isNew, () => {
    startRun();
  });
}

function toTitle(): void {
  state = 'title';
  initCast(pickedDogs);
  clearItems();
  setMode('nap');
  showHUD(false);
  showTitle(pickedDogs, loadBest(), (p) => {
    if (p.length === 2) { pickedDogs = p; saveDogs(p); }
  }, (p) => {
    pickedDogs = p;
    saveDogs(p);
    initAudio();
    startRun();
  });
}

// ---- the spawner ---------------------------------------------------------

function trySpawn(): void {
  const table: [ChaosKind, number][] = [
    ['toys', 3], ['juice', 2], ['mud', 2], ['chew', 1.6],
    ['rough', 1.6], ['squabble', 1.6], ['tv', tvOn ? 0 : 1.8],
  ];
  const pool = table.filter(([, w]) => w > 0);
  while (pool.length) {
    const total = pool.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    let idx = 0;
    for (let i = 0; i < pool.length; i++) { r -= pool[i][1]; if (r <= 0) { idx = i; break; } }
    if (startEvent(pool[idx][0], tvOn)) return;
    pool.splice(idx, 1);
  }
}

// ---- the gaze sweep and its judgments ------------------------------------

function currentJudgeables(): Judgeable[] {
  const out = agentJudgeables();
  for (const it of items) {
    if (it.removing || it.held) continue;
    if (it.craft) {
      if (it.slot && !it.admired) {
        out.push({
          key: `item${it.id}`, x: it.x, reaction: 'craft',
          meter: -LIKE_DRAIN, points: PTS_LIKE_SEEN,
          onSeen: () => { it.admired = true; admiredItem = it; },
        });
      }
    } else {
      out.push({
        key: `item${it.id}`, x: it.x, reaction: it.kind,
        meter: SEVERITY[it.kind].meter, points: 0,
      });
    }
  }
  if (tvOn) {
    out.push({ key: 'tv', x: 148, reaction: 'tv', meter: SEVERITY.tv.meter, points: 0 });
  }
  return out;
}

function judge(j: Judgeable): void {
  judged.add(j.key);
  grandpa.gazeX = j.x;
  j.onSeen?.();
  meter = clamp(meter + j.meter, 0, METER_MAX);
  if (j.points > 0) {
    score += j.points;
    popup(j.x, 380, `+${j.points}`, '#2f8f3c');
  }
  const like = REACTIONS[j.reaction]?.like ?? false;
  if (meter >= METER_MAX && !like) {
    blowTop();
    return;
  }
  phase = 'react';
  phaseT = 0;
  setMode('react', j.reaction);
  sfx(like ? 'likeSting' : 'grumbleSting');
}

function blowTop(): void {
  phase = 'blow';
  phaseT = 0;
  setMode('blow');
  sfx('kettle');
  setSnore('off');
}

// ---- update --------------------------------------------------------------

function update(dt: number): void {
  time += dt;
  chimeClock += dt;
  updateItems(dt);
  updateGrandpa(dt);
  for (let i = popups.length - 1; i >= 0; i--) {
    popups[i].t += dt;
    if (popups[i].t > 1.1) popups.splice(i, 1);
  }

  if (state === 'title') {
    updateAgents(dt, world);
    return;
  }
  if (state === 'over') return;    // guilty freeze-frame — only Grandpa fumes on

  phaseT += dt;
  if (phase !== 'blow') {
    updateAgents(dt, world);
    spawnIn -= dt;
    if (spawnIn <= 0) {
      trySpawn();
      spawnIn = ramp(SPAWN_EVERY, hour) * rand(0.8, 1.3);
    }
  }

  switch (phase) {
    case 'nap':
      if (phaseT >= napLen) {
        phase = 'stir';
        phaseT = 0;
        setMode('stir');
        setSnore('stir');
      }
      break;
    case 'stir':
      if (phaseT >= stirLen) {
        phase = 'sweep';
        phaseT = 0;
        judged = new Set();
        admiredItem = null;
        grandpa.gazeX = GAZE_START;
        setMode('scan');
        setSnore('off');
      }
      break;
    case 'sweep': {
      const prev = grandpa.gazeX;
      const speed = (GAZE_START - GAZE_END) / SWEEP_TIME;
      grandpa.gazeX = prev - speed * dt;
      // judge the right-most unseen thing the gaze front crossed this frame
      let hit: Judgeable | null = null;
      for (const j of currentJudgeables()) {
        if (judged.has(j.key)) continue;
        if (j.x >= grandpa.gazeX && j.x <= prev + 1) {
          if (!hit || j.x > hit.x) hit = j;
        }
      }
      if (hit) { judge(hit); break; }
      if (grandpa.gazeX <= GAZE_END) {
        // survived the Wake-up: chime the mantel clock, bank the bonus
        phase = 'settle';
        phaseT = 0;
        hour += 1;
        chimeClock = 0;
        const bonus = PTS_SURVIVE + PTS_SURVIVE_HOUR * hour;
        score += bonus;
        popup(790, 200, `+${bonus}`, '#3a7bd5');
        setMode('grumble');
        sfx('chime');
      }
      break;
    }
    case 'react':
      if (phaseT >= REACT_PAUSE) {
        if (admiredItem) {
          // the admired craft gets whisked away (a kid reclaims it) so the
          // display spot frees up for the next masterpiece
          removeItem(admiredItem);
          admiredItem = null;
        }
        phase = 'sweep';
        setMode('scan');
      }
      break;
    case 'settle':
      if (phaseT >= SETTLE_LEN) beginNap();
      break;
    case 'blow':
      if (phaseT >= 2.4) {
        sfx('boing');
        endRun();
      }
      break;
  }
}

// ---- draw ----------------------------------------------------------------

function draw(): void {
  drawRoom(time, {
    tvOn,
    hour: 2 + hour,
    chimeT: chimeClock,
    binCount: stash.bin,
    hamperCount: stash.hamper,
    couchCount: stash.couch,
  });
  drawGaze(time);
  const floor = items.filter(i => !i.held).sort((a, b) => a.y - b.y);
  for (const it of floor) drawItem(it, time);
  drawAgents(time);
  drawGrandpa(time);
  if (held) drawItem(held, time);
  for (const p of popups) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - p.t / 1.1);
    ctx.font = 'bold 22px "Chalkboard SE", "Comic Sans MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#241a10';
    outline(4);
    ctx.strokeText(p.text, p.x, p.y - p.t * 44);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x, p.y - p.t * 44);
    ctx.restore();
  }
  drawCallout();
  if (state === 'playing') setHUD(score, meter / METER_MAX, hour);
}

// ---- input ---------------------------------------------------------------

initInput({
  onPress(x: number, y: number): boolean {
    initAudio();
    if (state !== 'playing') return false;
    // fix the blaring TV (a drag or a tap on it both read as "turn that off")
    if (tvOn && onTV(x, y)) {
      world.setTV(false);
      return false;
    }
    const it = itemAt(x, y);
    if (it && (!it.slot || (it.craft && !it.admired))) {
      it.slot = null;
      it.held = true;
      held = it;
      sfx('pickup');
      return true;
    }
    const being = beingAt(x, y);
    if (being?.dog) { tapDog(being.dog); sfx('dog'); return false; }
    if (being?.kid) { tapKid(being.kid); sfx('kid'); return false; }
    return false;
  },
  onDragMove(x: number, y: number): void {
    if (!held) return;
    held.x = clamp(x, 28, 932);
    held.y = clamp(y, 70, 526);
  },
  onRelease(x: number, y: number): void {
    if (!held) return;
    const it = held;
    held = null;
    it.held = false;
    it.x = clamp(x, 28, 932);
    it.y = clamp(y, 70, 526);
    if (it.craft) {
      const slot = displaySlotAt(it.x, it.y, slotTaken);
      if (slot) {
        it.slot = slot.id;
        it.x = slot.x;
        it.y = slot.y;
        sfx('display');
        popup(it.x, it.y - 40, 'On display!', '#3a7bd5');
        return;
      }
    } else {
      const s = stashSpotAt(it.x, it.y);
      if (s) {
        stash[s] += 1;
        removeItem(it);
        const pts = messStashPts(it.kind as MessKind);
        score += pts;
        popup(it.x, it.y - 30, `+${pts}`, '#57b843');
        sfx('stash');
        return;
      }
    }
    // dropped in the open: it tumbles to the floor
    if (it.y < 440) it.y = rand(455, 515);
    sfx('reject');
  },
});

// ---- boot ----------------------------------------------------------------

resize();
window.addEventListener('resize', resize);
initUI();
toTitle();

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// test hook
declare global { interface Window { __grandpa?: unknown } }
if (params.has('test')) {
  window.__grandpa = { grandpa, items, get meter() { return meter; }, get phase() { return phase; }, get hour() { return hour; } };
}
