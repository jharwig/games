// Chaos agents: the two dogs and two Grandkids who roam the Room and cause
// Dislikes. Owns their roster art, autonomous behaviour, tap responses
// (settle / redirect), the Like/Dislike states they present to a gaze sweep,
// and all their drawing. main.ts drives *when* chaos happens (the spawner)
// via startEvent(); this module plays it out.

import { LIKE_DRAIN, PTS_LIKE_SEEN, SEVERITY, Judgeable, rand, pick, clamp } from './constants';
import { ctx, outline, blob, rr, poly, line, limb, withCtx } from './gfx';
import { WALK_MIN_Y, WALK_MAX_Y, DOG_BED, COUCH, TV } from './room';
import { Item, addMess, addCraft } from './items';

// ---- roster --------------------------------------------------------------

export interface DogLook { name: string; breed: 'cur' | 'cockapoo'; coat: string; dark: string }
export const DOG_ROSTER: DogLook[] = [
  { name: 'Nova', breed: 'cur', coat: '#9a6a3e', dark: '#7a5230' },
  { name: 'Will-E', breed: 'cur', coat: '#f2ede4', dark: '#d8cfc0' },
  { name: 'Gnocchi', breed: 'cockapoo', coat: '#a5744a', dark: '#845a36' },
  { name: 'Lulu', breed: 'cockapoo', coat: '#f4efe6', dark: '#dcd2c2' },
];

// The Grandkids' looks come from Ninja Adventure's character designs.
interface KidLook { name: string; skin: string; hair: string; hairStyle: 'pony' | 'short' | 'braids' | 'long'; shirt: string; shorts: string }
const KID_ROSTER: KidLook[] = [
  { name: 'Gemma', skin: '#d18f5f', hair: '#8e3b28', hairStyle: 'pony', shirt: '#23262b', shorts: '#2f63e8' },
  { name: 'Arthur', skin: '#f3ac6a', hair: '#77492a', hairStyle: 'short', shirt: '#4d9e45', shorts: '#2e7fd6' },
  { name: 'Anya', skin: '#e9b27c', hair: '#6b3f22', hairStyle: 'braids', shirt: '#2447c6', shorts: '#3fb2ea' },
  { name: 'Priella', skin: '#e9b27c', hair: '#6b3f22', hairStyle: 'braids', shirt: '#2f8f3c', shorts: '#2aa7c9' },
  { name: 'Genevieve', skin: '#e9b27c', hair: '#5a3219', hairStyle: 'long', shirt: '#5b55d8', shorts: '#5a1d90' },
  { name: 'Alex', skin: '#f0b57e', hair: '#6e4326', hairStyle: 'short', shirt: '#2a63d9', shorts: '#35a9d9' },
];

// ---- state ---------------------------------------------------------------

type DogState = 'idle' | 'walk' | 'rough' | 'sleep' | 'mud' | 'chew';
type KidState = 'idle' | 'walk' | 'dump' | 'squabble' | 'board' | 'sweep' | 'craft';

export interface Dog {
  look: DogLook;
  x: number; y: number; dir: number;
  state: DogState; t: number; dur: number;
  tx: number; ty: number;
  job: 'chew' | 'mud' | 'rough' | 'bed' | null;
  mudDropped: boolean;
  moving: boolean;
}

export interface Kid {
  look: KidLook;
  x: number; y: number; dir: number;
  state: KidState; t: number; dur: number;
  tx: number; ty: number;
  job: 'toys' | 'juice' | 'tv' | 'squabble' | null;
  pending: KidState | null;   // state to enter on arrival (walking to the rug to play)
  crafted: boolean;
  sweepTarget: Item | null;
  sweepT: number;
  moving: boolean;
}

export const dogs: Dog[] = [];
export const kids: Kid[] = [];

interface Puff { x: number; y: number; t: number; glyph: string }
const puffs: Puff[] = [];

export interface AgentWorld {
  setTV(on: boolean): void;
  tvIsOn(): boolean;
  sweepables(): Item[];               // floor messes a sweeping kid may clean
  sweptUp(it: Item): void;            // kid finished cleaning one
}

export function initCast(dogNames: string[]): void {
  dogs.length = 0;
  kids.length = 0;
  puffs.length = 0;
  for (const n of dogNames) {
    const look = DOG_ROSTER.find(d => d.name === n) ?? DOG_ROSTER[0];
    dogs.push({
      look, x: rand(250, 600), y: rand(WALK_MIN_Y + 15, WALK_MAX_Y), dir: 1,
      state: 'idle', t: 0, dur: rand(1, 3), tx: 0, ty: 0, job: null,
      mudDropped: false, moving: false,
    });
  }
  // two random Grandkids each run — they start off playing a board game nicely
  const roster = [...KID_ROSTER].sort(() => Math.random() - 0.5);
  for (let i = 0; i < 2; i++) {
    kids.push({
      look: roster[i], x: 440 + i * 62, y: 492, dir: i === 0 ? 1 : -1,
      state: 'board', t: 0, dur: rand(9, 13), tx: 0, ty: 0, job: null,
      pending: null, crafted: false, sweepTarget: null, sweepT: 0, moving: false,
    });
  }
}

// ---- spawner entry points ------------------------------------------------

export type ChaosKind = 'toys' | 'juice' | 'tv' | 'squabble' | 'chew' | 'mud' | 'rough';

export function startEvent(kind: ChaosKind, tvOn: boolean): boolean {
  const freeKids = kids.filter(k => k.state === 'idle');
  const freeDogs = dogs.filter(d => d.state === 'idle');
  switch (kind) {
    case 'toys': case 'juice': {
      const k = pick0(freeKids);
      if (!k) return false;
      sendKid(k, rand(130, 630), rand(WALK_MIN_Y + 15, WALK_MAX_Y), kind);
      return true;
    }
    case 'tv': {
      if (tvOn) return false;
      const k = pick0(freeKids);
      if (!k) return false;
      sendKid(k, TV.x + TV.w / 2 + 30, 470, 'tv');
      return true;
    }
    case 'squabble': {
      if (freeKids.length < 2) return false;
      const mx = (kids[0].x + kids[1].x) / 2;
      for (const k of kids) sendKid(k, clamp(mx, 150, 620) + (k === kids[0] ? -20 : 20), 485, 'squabble');
      return true;
    }
    case 'chew': {
      const d = pick0(freeDogs);
      if (!d) return false;
      sendDog(d, COUCH.x + rand(30, COUCH.w - 40), 460, 'chew');
      return true;
    }
    case 'mud': {
      const d = pick0(freeDogs);
      if (!d) return false;
      const goRight = d.x < 400;
      sendDog(d, goRight ? rand(560, 640) : rand(80, 160), rand(WALK_MIN_Y + 15, WALK_MAX_Y), 'mud');
      d.state = 'mud';
      d.mudDropped = false;
      return true;
    }
    case 'rough': {
      if (freeDogs.length < 2) return false;
      const mx = clamp((dogs[0].x + dogs[1].x) / 2, 150, 620);
      for (const d of dogs) sendDog(d, mx + (d === dogs[0] ? -24 : 24), 490, 'rough');
      return true;
    }
  }
}

function pick0<T>(arr: T[]): T | null { return arr.length ? pick(arr) : null; }

function sendKid(k: Kid, x: number, y: number, job: Kid['job']): void {
  k.state = 'walk'; k.tx = x; k.ty = y; k.job = job; k.t = 0;
}
function sendDog(d: Dog, x: number, y: number, job: Dog['job']): void {
  d.state = 'walk'; d.tx = x; d.ty = y; d.job = job; d.t = 0;
}

// ---- taps ----------------------------------------------------------------

export function beingAt(x: number, y: number): { dog?: Dog; kid?: Kid } | null {
  for (const k of kids) {
    if (Math.abs(x - k.x) < 34 && y > k.y - 85 && y < k.y + 14) return { kid: k };
  }
  for (const d of dogs) {
    if (Math.abs(x - d.x) < 44 && y > d.y - 60 && y < d.y + 14) return { dog: d };
  }
  return null;
}

let redirectFlip = false;

// Settle a dog: it trots to its bed and (eventually) naps — a Like.
export function tapDog(d: Dog): void {
  if (d.state === 'rough') {
    for (const o of dogs) if (o.state === 'rough') { o.state = 'idle'; o.t = 0; o.dur = rand(2, 4); o.job = null; }
  }
  if (d.state === 'sleep') { puff(d.x, d.y - 50, '♥'); return; }
  sendDog(d, DOG_BED.x, DOG_BED.y - 4, 'bed');
  puff(d.x, d.y - 55, '♥');
}

// Redirect a Grandkid to a nice activity. A squabble redirect sends both to a
// board game; a lone kid alternates crafting / sweeping. All temporary.
export function tapKid(k: Kid): void {
  if (k.state === 'squabble') {
    const spots = [[438, 492], [502, 492]];
    kids.forEach((kk, i) => {
      kk.state = 'walk'; kk.job = null; kk.t = 0;
      kk.tx = spots[i][0]; kk.ty = spots[i][1];
      kk.dir = i === 0 ? 1 : -1;
      // walking to the rug then sitting down to play
      kk.crafted = false;
      kk.sweepTarget = null;
      kk.pending = 'board';
    });
    puff((kids[0].x + kids[1].x) / 2, 420, '♥');
    return;
  }
  if (k.state === 'board' || k.state === 'sweep' || k.state === 'craft') {
    k.dur += 4;                                   // encouragement: stay nice longer
    puff(k.x, k.y - 90, '♥');
    return;
  }
  redirectFlip = !redirectFlip;
  k.state = redirectFlip ? 'sweep' : 'craft';
  k.t = 0; k.dur = rand(9, 13); k.job = null;
  k.crafted = false; k.sweepTarget = null; k.sweepT = 0;
  puff(k.x, k.y - 90, '♥');
}

function puff(x: number, y: number, glyph: string): void {
  puffs.push({ x, y, t: 0, glyph });
}

// ---- update --------------------------------------------------------------

const KID_SPEED = 95;
const DOG_SPEED = 75;
const MUD_SPEED = 190;

export function updateAgents(dt: number, world: AgentWorld): void {
  for (const d of dogs) updateDog(d, dt);
  for (const k of kids) updateKid(k, dt, world);
  for (let i = puffs.length - 1; i >= 0; i--) {
    puffs[i].t += dt;
    if (puffs[i].t > 0.9) puffs.splice(i, 1);
  }
}

function walkToward(a: { x: number; y: number; dir: number; moving: boolean }, tx: number, ty: number, speed: number, dt: number): boolean {
  const dx = tx - a.x, dy = ty - a.y;
  const dist = Math.hypot(dx, dy);
  a.moving = dist > 4;
  if (dist < 4) return true;
  if (Math.abs(dx) > 2) a.dir = dx > 0 ? 1 : -1;
  const step = Math.min(dist, speed * dt);
  a.x += (dx / dist) * step;
  a.y += (dy / dist) * step;
  return false;
}

function updateDog(d: Dog, dt: number): void {
  d.t += dt;
  switch (d.state) {
    case 'idle':
      d.moving = false;
      if (d.t > d.dur) {
        d.t = 0; d.dur = rand(1.5, 4);
        d.tx = rand(120, 640); d.ty = rand(WALK_MIN_Y + 15, WALK_MAX_Y);
        d.state = 'walk'; d.job = null;
      }
      break;
    case 'walk':
      if (walkToward(d, d.tx, d.ty, DOG_SPEED, dt)) {
        d.t = 0;
        if (d.job === 'chew') { d.state = 'chew'; d.dur = 1.3; }
        else if (d.job === 'rough') { d.state = 'rough'; }
        else if (d.job === 'bed') { d.state = 'sleep'; d.dur = rand(10, 16); }
        else { d.state = 'idle'; d.dur = rand(1.5, 4); }
      }
      break;
    case 'chew':
      d.moving = false;
      if (d.t > d.dur) {
        addMess('cushion', clamp(d.x + d.dir * 30, 60, 900), d.y + 6);
        d.state = 'idle'; d.t = 0; d.dur = rand(1, 3); d.job = null;
      }
      break;
    case 'mud':
      // drop the muddy trail partway through the dash
      if (!d.mudDropped && Math.abs(d.x - d.tx) < 120) {
        addMess('pawprints', d.x, d.y + 4);
        d.mudDropped = true;
      }
      if (walkToward(d, d.tx, d.ty, MUD_SPEED, dt)) {
        d.state = 'idle'; d.t = 0; d.dur = rand(1, 3); d.job = null;
      }
      break;
    case 'rough': {
      d.moving = false;
      // a brawl needs a partner — if the other dog got settled mid-approach, drop it
      const partner = dogs.find(o => o !== d);
      const partnerIn = partner && (partner.state === 'rough' || (partner.state === 'walk' && partner.job === 'rough'));
      if (!partnerIn) { d.state = 'idle'; d.t = 0; d.dur = rand(1, 3); d.job = null; }
      break;                                   // otherwise: until tapped
    }
    case 'sleep':
      d.moving = false;
      if (d.t > d.dur) { d.state = 'idle'; d.t = 0; d.dur = rand(1, 3); d.job = null; }
      break;
  }
}

function updateKid(k: Kid, dt: number, world: AgentWorld): void {
  k.t += dt;
  switch (k.state) {
    case 'idle':
      k.moving = false;
      if (k.t > k.dur) {
        k.t = 0; k.dur = rand(2, 4);
        k.tx = rand(130, 630); k.ty = rand(WALK_MIN_Y + 15, WALK_MAX_Y);
        k.state = 'walk'; k.job = null;
      }
      break;
    case 'walk':
      if (walkToward(k, k.tx, k.ty, KID_SPEED, dt)) {
        k.t = 0;
        if (k.pending) {
          k.state = k.pending;
          k.pending = null;
          k.dur = rand(10, 14);
        } else if (k.job === 'toys' || k.job === 'juice' || k.job === 'tv') {
          k.state = 'dump'; k.dur = 0.8;
        } else if (k.job === 'squabble') {
          k.state = 'squabble';
        } else {
          k.state = 'idle'; k.dur = rand(2, 4);
        }
      }
      break;
    case 'dump':
      k.moving = false;
      if (k.t > k.dur) {
        if (k.job === 'toys') addMess('toys', k.x + k.dir * 26, k.y + 4);
        else if (k.job === 'juice') addMess('juice', k.x + k.dir * 26, k.y + 6);
        else if (k.job === 'tv') world.setTV(true);
        k.state = 'idle'; k.t = 0; k.dur = rand(1.5, 3.5); k.job = null;
      }
      break;
    case 'squabble': {
      k.moving = false;
      // same partner rule as the dogs: no one squabbles alone
      const other = kids.find(o => o !== k);
      const otherIn = other && (other.state === 'squabble' || (other.state === 'walk' && other.job === 'squabble'));
      if (!otherIn) { k.state = 'idle'; k.t = 0; k.dur = rand(1, 3); k.job = null; }
      break;                                   // otherwise: until tapped
    }
    case 'board':
      k.moving = false;
      if (k.t > k.dur) endNice(k);
      break;
    case 'craft':
      k.moving = false;
      if (!k.crafted && k.t > 4.5) {
        k.crafted = true;
        addCraft(clamp(k.x + k.dir * 38, 50, 910), k.y + 4);
      }
      if (k.t > k.dur) endNice(k);
      break;
    case 'sweep': {
      if (!k.sweepTarget || k.sweepTarget.removing) {
        const cands = world.sweepables();
        k.sweepTarget = null;
        let best = 1e9;
        for (const it of cands) {
          const d2 = Math.abs(it.x - k.x);
          if (d2 < best) { best = d2; k.sweepTarget = it; }
        }
        k.sweepT = 0;
      }
      if (k.sweepTarget) {
        const it = k.sweepTarget;
        if (Math.abs(k.x - it.x) > 26 || Math.abs(k.y - it.y) > 18) {
          walkToward(k, it.x + 24, clamp(it.y, WALK_MIN_Y, WALK_MAX_Y), KID_SPEED * 0.8, dt);
        } else {
          k.moving = false;
          k.sweepT += dt;
          if (k.sweepT > 1.3) { world.sweptUp(it); k.sweepTarget = null; }
        }
      } else {
        k.moving = false;
      }
      if (k.t > k.dur) endNice(k);
      break;
    }
  }
}

// Nice activities wind back up: the kid drifts back to wandering (and from
// there the spawner will find them).
function endNice(k: Kid): void {
  if (k.state === 'board') {
    for (const kk of kids) if (kk.state === 'board') { kk.state = 'idle'; kk.t = 0; kk.dur = rand(1, 2.5); }
  } else {
    k.state = 'idle'; k.t = 0; k.dur = rand(1, 2.5);
  }
}

// ---- what a gaze sweep sees ---------------------------------------------

export function agentJudgeables(): Judgeable[] {
  const out: Judgeable[] = [];
  if (dogs.length === 2 && dogs[0].state === 'rough' && dogs[1].state === 'rough') {
    out.push({ key: 'rough', x: (dogs[0].x + dogs[1].x) / 2, reaction: 'roughhouse', meter: SEVERITY.roughhouse.meter, points: 0 });
  }
  dogs.forEach((d, i) => {
    if (d.state === 'sleep') out.push({ key: `dogbed${i}`, x: d.x, reaction: 'dogbed', meter: -LIKE_DRAIN, points: PTS_LIKE_SEEN });
  });
  if (kids.length === 2 && kids[0].state === 'squabble' && kids[1].state === 'squabble') {
    out.push({ key: 'squabble', x: (kids[0].x + kids[1].x) / 2, reaction: 'squabble', meter: SEVERITY.squabble.meter, points: 0 });
  }
  if (kids.length === 2 && kids[0].state === 'board' && kids[1].state === 'board') {
    out.push({ key: 'board', x: (kids[0].x + kids[1].x) / 2, reaction: 'board', meter: -LIKE_DRAIN, points: PTS_LIKE_SEEN });
  }
  kids.forEach((k, i) => {
    if (k.state === 'sweep') out.push({ key: `sweep${i}`, x: k.x, reaction: 'sweeping', meter: -LIKE_DRAIN, points: PTS_LIKE_SEEN });
  });
  return out;
}

// ---- drawing -------------------------------------------------------------

export function drawAgents(t: number): void {
  // squabble / roughhouse pairs render as one classic dust-cloud brawl
  const kidBrawl = kids.length === 2 && kids[0].state === 'squabble' && kids[1].state === 'squabble';
  const dogBrawl = dogs.length === 2 && dogs[0].state === 'rough' && dogs[1].state === 'rough';

  const drawables: { y: number; fn: () => void }[] = [];
  if (dogBrawl) {
    const x = (dogs[0].x + dogs[1].x) / 2, y = Math.max(dogs[0].y, dogs[1].y);
    drawables.push({ y, fn: () => drawBrawl(x, y, t, [dogs[0].look.coat, dogs[1].look.coat], true) });
  } else {
    for (const d of dogs) drawables.push({ y: d.y, fn: () => drawDog(d, t) });
  }
  if (kidBrawl) {
    const x = (kids[0].x + kids[1].x) / 2, y = Math.max(kids[0].y, kids[1].y);
    drawables.push({ y, fn: () => drawBrawl(x, y, t, [kids[0].look.shirt, kids[1].look.shirt], false) });
  } else {
    const boardPair = kids.length === 2 && kids[0].state === 'board' && kids[1].state === 'board';
    if (boardPair) {
      const bx = (kids[0].x + kids[1].x) / 2;
      drawables.push({ y: kids[0].y - 1, fn: () => drawBoardGame(bx, kids[0].y, t) });
    }
    for (const k of kids) drawables.push({ y: k.y, fn: () => drawKid(k, t) });
  }
  drawables.sort((a, b) => a.y - b.y);
  for (const d of drawables) d.fn();

  for (const p of puffs) {
    ctx.save();
    ctx.globalAlpha = 1 - p.t / 0.9;
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = '#e0509a';
    ctx.textAlign = 'center';
    ctx.fillText(p.glyph, p.x, p.y - p.t * 40);
    ctx.restore();
  }
}

function shadow(x: number, y: number, r: number): void {
  ctx.save();
  ctx.globalAlpha = 0.15;
  blob(x, y + 4, r, r * 0.26, '#241a10', false);
  ctx.restore();
}

// ---- dogs ----------------------------------------------------------------

function drawDog(d: Dog, t: number): void {
  const bob = d.moving ? Math.sin(t * 16) * 2 : Math.sin(t * 2 + d.x) * 1;
  shadow(d.x, d.y, 40);
  ctx.save();
  ctx.translate(d.x, d.y + bob);
  ctx.scale(d.dir, 1);
  const c = d.look.coat, dark = d.look.dark;
  const poo = d.look.breed === 'cockapoo';

  if (d.state === 'sleep') {
    // curled up in (or near) the bed
    blob(0, -12, 30, 16, c);
    blob(20, -18, 13, 11, c);                       // head tucked
    if (poo) blob(26, -24, 8, 7, dark);
    line(24, -18, 29, -17, 3);                      // shut eye
    ctx.restore();
    // Zzz
    ctx.save();
    ctx.font = 'bold 15px sans-serif';
    ctx.fillStyle = '#5a7fd0';
    const zp = (t * 0.8) % 1;
    ctx.globalAlpha = 1 - zp;
    ctx.fillText('z', d.x + 24 + zp * 12, d.y - 40 - zp * 18);
    ctx.restore();
    return;
  }

  const legSwing = d.moving ? Math.sin(t * (d.state === 'mud' ? 26 : 16)) * 8 : 0;
  // legs
  line(-20 + legSwing * 0.6, -18, -22 + legSwing, 0, 6, '#241a10');
  line(-20 + legSwing * 0.6, -18, -22 + legSwing, 0, 3.2, c);
  line(16 - legSwing * 0.6, -18, 18 - legSwing, 0, 6, '#241a10');
  line(16 - legSwing * 0.6, -18, 18 - legSwing, 0, 3.2, c);
  // body
  if (poo) {
    blob(0, -26, 27, 17, c);
    for (let i = 0; i < 6; i++) {
      const a = Math.PI * (0.15 + i * 0.14);
      blob(Math.cos(a) * 25, -26 - Math.sin(a) * 15, 7, 7, c);
    }
    blob(-26, -32, 6, 6, c);                        // pom tail
  } else {
    blob(0, -25, 30, 15, c);
    // thin wagging tail
    const wag = Math.sin(t * 10) * 6;
    line(-28, -30, -40, -40 + wag, 4);
    line(-28, -30, -40, -40 + wag, 2.2, c);
  }
  // chest patch
  blob(10, -20, 10, 8, dark, false);
  // head
  const chewNod = d.state === 'chew' ? Math.sin(t * 22) * 3 : 0;
  ctx.save();
  ctx.translate(26, -38 + chewNod);
  if (poo) {
    blob(0, 0, 14, 13, c);
    blob(-2, -10, 9, 7, c);                          // topknot poof
    blob(-10, 4, 7, 9, c);                           // fluffy ear
    blob(8, 3, 6, 5, c);                             // muzzle poof
  } else {
    blob(0, 0, 14, 11, c);
    blob(11, 2, 8, 5.5, c);                          // longer muzzle
    poly([[-8, -9], [2, -13], [0, 4]], dark);        // floppy ear
  }
  blob(15, 1, 3.2, 2.8, '#241a10', false);           // nose
  blob(4, -3, 2.4, 2.8, '#241a10', false);           // eye
  if (d.state === 'chew') {
    blob(10, 7, 7, 5, '#37b0a8');                    // cushion corner in mouth
  } else {
    line(8, 5, 13, 5, 2);                            // mouth
  }
  ctx.restore();
  ctx.restore();

  if (d.state === 'mud') {
    // flying mud flecks
    for (let i = 0; i < 3; i++) {
      blob(d.x - d.dir * (20 + i * 14), d.y - rand(0, 8), 3, 3, '#7a5230');
    }
  }
}

// ---- kids ----------------------------------------------------------------

function drawKid(k: Kid, t: number): void {
  const sitting = k.state === 'board' || k.state === 'craft';
  shadow(k.x, k.y, 30);
  ctx.save();
  ctx.translate(k.x, k.y);
  ctx.scale(k.dir, 1);
  const L = k.look;
  const bob = k.moving ? Math.abs(Math.sin(t * 12)) * 3 : 0;
  const legSwing = k.moving ? Math.sin(t * 12) * 10 : 0;

  if (sitting) {
    // cross-legged on the floor
    blob(0, -4, 17, 8, L.shorts);
    body(k, t, -26, 0);
  } else {
    // legs
    line(-4 + legSwing * 0.5, -22, -6 + legSwing, 0, 7.5, '#241a10');
    line(-4 + legSwing * 0.5, -22, -6 + legSwing, 0, 4.4, L.skin);
    line(4 - legSwing * 0.5, -22, 6 - legSwing, 0, 7.5, '#241a10');
    line(4 - legSwing * 0.5, -22, 6 - legSwing, 0, 4.4, L.skin);
    blob(-7 + legSwing, 0, 7, 4, '#e0322a');
    blob(7 - legSwing, 0, 7, 4, '#e0322a');
    // shorts
    rr(-11, -34, 22, 14, 5, L.shorts);
    body(k, t, -34 - bob, bob);
  }
  ctx.restore();

  // state props drawn un-mirrored
  if (k.state === 'sweep') {
    // dust flicks at the broom head
    const bx = k.x + k.dir * 26;
    for (let i = 0; i < 2; i++) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      blob(bx + Math.sin(t * 14 + i * 3) * 8, k.y - 2, 3, 2, '#b57c3e', false);
      ctx.restore();
    }
  }
}

// torso + head + arms, at torsoBottomY (local coords, kid facing +x)
function body(k: Kid, t: number, torsoBottom: number, bob: number): void {
  const L = k.look;
  const ty = torsoBottom;                            // bottom of shirt
  rr(-12, ty - 24, 24, 26, 8, L.shirt);

  // arms by state
  const armW = 4.2;
  if (k.state === 'sweep') {
    // both hands on a broom in front
    limb([[6, ty - 18], [18, ty - 8], [22, ty - 2]], armW, L.skin);
    const sw = Math.sin(t * 10) * 5;
    line(14 + sw, ty - 26, 30 + sw, ty + 32, 4, '#8a5a33');
    poly([[24 + sw, ty + 28], [40 + sw, ty + 28], [44 + sw, ty + 38], [20 + sw, ty + 38]], '#f2c114');
  } else if (k.state === 'craft') {
    // scribbling on a paper on the floor
    rr(16, ty + 20, 26, 18, 2, '#fffdf4');
    const wig = Math.sin(t * 18) * 3;
    limb([[8, ty - 14], [20 + wig, ty + 8], [26 + wig, ty + 20]], armW, L.skin);
    line(26 + wig, ty + 20, 29 + wig, ty + 26, 3, '#e0322a');
    limb([[-8, ty - 14], [-14, ty - 4]], armW, L.skin);
  } else if (k.state === 'dump') {
    // arms flung out — the deed is being done
    limb([[8, ty - 20], [20, ty - 26], [28, ty - 22]], armW, L.skin);
    limb([[-8, ty - 20], [-18, ty - 28]], armW, L.skin);
  } else if (k.state === 'board') {
    limb([[8, ty - 14], [16, ty - 2], [22, ty + 4]], armW, L.skin);
    limb([[-8, ty - 14], [-12, ty - 2]], armW, L.skin);
  } else {
    const sw = k.moving ? Math.sin(t * 12) * 8 : 0;
    limb([[8, ty - 18], [10 + sw * 0.4, ty - 6], [12 + sw, ty + 2]], armW, L.skin);
    limb([[-8, ty - 18], [-10 - sw * 0.4, ty - 6], [-12 - sw, ty + 2]], armW, L.skin);
  }

  // head
  const hy = ty - 38 + bob * 0.3;
  blob(0, hy, 15, 14, L.skin);
  // hair by style
  if (L.hairStyle === 'short') {
    ctx.beginPath(); ctx.ellipse(0, hy - 6, 15, 9, 0, Math.PI, 0); ctx.closePath();
    ctx.fillStyle = L.hair; ctx.fill(); outline(); ctx.stroke();
  } else if (L.hairStyle === 'pony') {
    ctx.beginPath(); ctx.ellipse(0, hy - 6, 15, 9, 0, Math.PI, 0); ctx.closePath();
    ctx.fillStyle = L.hair; ctx.fill(); outline(); ctx.stroke();
    blob(-15, hy - 4, 5, 5, L.hair);
    const sway = Math.sin(t * 6) * 3;
    poly([[-16, hy - 2], [-24 + sway, hy + 14], [-14, hy + 8]], L.hair);
  } else if (L.hairStyle === 'braids') {
    ctx.beginPath(); ctx.ellipse(0, hy - 6, 15, 9, 0, Math.PI, 0); ctx.closePath();
    ctx.fillStyle = L.hair; ctx.fill(); outline(); ctx.stroke();
    blob(-14, hy + 6, 4, 9, L.hair);
    blob(13, hy + 7, 4, 8, L.hair);
    blob(-14, hy + 15, 3, 3, '#e0322a');
    blob(13, hy + 15, 3, 3, '#e0322a');
  } else {
    ctx.beginPath(); ctx.ellipse(0, hy - 5, 16, 10, 0, Math.PI, 0); ctx.closePath();
    ctx.fillStyle = L.hair; ctx.fill(); outline(); ctx.stroke();
    poly([[-16, hy - 4], [-17, hy + 16], [-9, hy + 12], [-13, hy - 2]], L.hair);
    poly([[16, hy - 4], [17, hy + 16], [9, hy + 12], [13, hy - 2]], L.hair);
  }
  // face
  blob(6, hy - 1, 2.2, 2.6, '#241a10', false);
  blob(12, hy - 1, 1.6, 2.2, '#241a10', false);      // far eye, foreshortened
  ctx.beginPath();
  ctx.arc(8, hy + 6, 4, 0.15, Math.PI - 0.6);
  outline(2);
  ctx.stroke();
}

// ---- shared set-pieces ---------------------------------------------------

function drawBoardGame(x: number, y: number, t: number): void {
  rr(x - 24, y - 10, 48, 12, 3, '#8a5a33');
  ctx.fillStyle = '#fffdf4';
  for (let i = 0; i < 4; i++) ctx.fillRect(x - 18 + i * 10, y - 8, 5, 5);
  const hop = Math.abs(Math.sin(t * 4)) * 4;
  blob(x - 6, y - 14 - hop, 3.5, 3.5, '#e0322a');
  blob(x + 8, y - 12, 3.5, 3.5, '#3a7bd5');
}

// The classic cartoon fight cloud — limbs and stars poking out, everything spinning.
function drawBrawl(x: number, y: number, t: number, colors: string[], isDogs: boolean): void {
  shadow(x, y, 55);
  ctx.save();
  ctx.translate(x, y - 34);
  // poking-out limbs rotate around the cloud
  for (let i = 0; i < 5; i++) {
    const a = t * 3 + (i * Math.PI * 2) / 5;
    const lx = Math.cos(a) * 44, ly = Math.sin(a) * 26;
    if (isDogs && i % 2 === 0) {
      line(lx * 0.5, ly * 0.5, lx, ly, 8, '#241a10');
      line(lx * 0.5, ly * 0.5, lx, ly, 5, colors[i % 2]);
      blob(lx, ly, 5, 4, colors[i % 2]);             // paw
    } else {
      line(lx * 0.5, ly * 0.5, lx, ly, 7, '#241a10');
      line(lx * 0.5, ly * 0.5, lx, ly, 4, colors[i % 2]);
      blob(lx, ly, 5.5, 5.5, '#eeb888');             // fist
    }
  }
  // the cloud itself
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + t * 0.6;
    blob(Math.cos(a) * 30, Math.sin(a) * 16, 17, 15, '#e8e2d4');
  }
  blob(0, 0, 34, 22, '#f2eee2');
  // stars
  ctx.font = 'bold 18px sans-serif';
  ctx.fillStyle = '#f2c114';
  ctx.textAlign = 'center';
  for (let i = 0; i < 3; i++) {
    const a = -t * 4 + i * 2.1;
    ctx.fillText('★', Math.cos(a) * 52, Math.sin(a) * 30 - 8);
  }
  ctx.restore();
}

// A little standing portrait for the title-screen dog picker.
export function drawDogPortrait(cv: HTMLCanvasElement, look: DogLook): void {
  cv.width = 128; cv.height = 96;
  const c = cv.getContext('2d')!;
  const fake: Dog = {
    look, x: 60, y: 84, dir: 1, state: 'idle', t: 0, dur: 0, tx: 0, ty: 0,
    job: null, mudDropped: false, moving: false,
  };
  withCtx(c, () => drawDog(fake, 0.35));
}
