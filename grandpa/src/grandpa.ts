// Grandpa: the napping judge in the recliner, and the game's comedy engine.
// Owns the Reaction repertoire — every roster item has its own full-body pose
// and 90s-cartoon callout — plus the recliner (its footrest slams down when
// he wakes), the snore/stir animation, and the gaze-sweep spotlight.
// main.ts drives the Nap → Stir → Wake-up cycle; this module acts it out.

import { ctx, INK, outline, blob, rr, poly, line, limb, speechBubble } from './gfx';
import { GAZE_START } from './room';

export type Pose =
  | 'nap' | 'stir' | 'scan' | 'grumble' | 'blow'
  | 'point' | 'hips' | 'forehead' | 'fistShake' | 'jawDrop'
  | 'chuckle' | 'thumbsUp' | 'heart';

export interface Reaction { pose: Pose; text: string; like: boolean }

// The roster: every Like and Dislike Grandpa can see, each with its own gag.
export const REACTIONS: Record<string, Reaction> = {
  toys:       { pose: 'point',     text: "CONSARN IT! A TOY MINEFIELD!", like: false },
  juice:      { pose: 'forehead',  text: 'GREAT HORNSWOGGLE! THE GOOD RUG!', like: false },
  pawprints:  { pose: 'fistShake', text: 'DAG-NABBIT! MUDDY VARMINTS!', like: false },
  cushion:    { pose: 'jawDrop',   text: 'MY... MY GOOD CUSHION?!', like: false },
  tv:         { pose: 'fistShake', text: 'WHO CRANKED THAT INFERNAL RACKET?!', like: false },
  roughhouse: { pose: 'point',     text: "SUFFERIN' CATS! KNOCK IT OFF!", like: false },
  squabble:   { pose: 'hips',      text: 'PIPE DOWN, YA HOOLIGANS!', like: false },
  craft:      { pose: 'heart',     text: "WELL, I'LL BE! THAT'S FRIDGE-WORTHY!", like: true },
  sweeping:   { pose: 'thumbsUp',  text: "NOW THAT'S A GOOD KID!", like: true },
  board:      { pose: 'chuckle',   text: "PLAYIN' NICE! WARMS MY OL' TICKER!", like: true },
  dogbed:     { pose: 'chuckle',   text: 'HEH HEH. GOOD OL POOCH.', like: true },
};

export type GrandpaMode = 'nap' | 'stir' | 'scan' | 'react' | 'grumble' | 'blow';

export const grandpa = {
  mode: 'nap' as GrandpaMode,
  reaction: 'toys',        // key into REACTIONS while mode === 'react'
  modeT: 0,                // seconds in current mode
  gazeX: GAZE_START,
  recline: 1,              // 1 = kicked back, 0 = bolt upright
};

export function setMode(m: GrandpaMode, reaction?: string): void {
  grandpa.mode = m;
  grandpa.modeT = 0;
  if (reaction) grandpa.reaction = reaction;
}

export function updateGrandpa(dt: number): void {
  grandpa.modeT += dt;
  const target = grandpa.mode === 'nap' || grandpa.mode === 'stir' ? 1 : 0;
  // the footrest slams down fast, reclines back slowly
  const rate = target === 0 ? 9 : 1.6;
  grandpa.recline += (target - grandpa.recline) * Math.min(1, rate * dt);
}

// Grandpa's eye point in world coords — the gaze sweep starts here.
export function eyePoint(): { x: number; y: number } {
  const r = grandpa.recline;
  return { x: 836 + r * 14, y: 296 + r * 18 };
}

// ---- palette -------------------------------------------------------------

const SKIN = '#eeb888';
const SKIN_DK = '#dba26c';
const CARDIGAN = '#7d8f4d';
const SHIRT = '#f2e6c8';
const PANTS = '#8a6242';
const SLIPPER = '#a03c2e';
const CHAIR = '#96382a';
const CHAIR_DK = '#7e2e22';
const HAIR = '#f2f2ee';

// ---- drawing -------------------------------------------------------------

export function drawGaze(t: number): void {
  if (grandpa.mode !== 'scan' && grandpa.mode !== 'react') return;
  const e = eyePoint();
  // the sweep itself starts behind the chair; the beam only draws sensibly
  // once the front is out in front of his nose
  const gx = Math.min(grandpa.gazeX, e.x - 24);
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = '#ffe14d';
  ctx.beginPath();
  ctx.moveTo(e.x, e.y);
  ctx.lineTo(gx - 26, 150);
  ctx.lineTo(gx - 26, 528);
  ctx.lineTo(Math.min(gx + 46, e.x), 528);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 0.5;
  ctx.setLineDash([8, 8]);
  ctx.lineDashOffset = -t * 60;
  line(e.x, e.y, gx - 20, 340, 2.5, '#e8a020');
  ctx.restore();
}

export function drawGrandpa(t: number): void {
  const g = grandpa;
  const r = g.recline;
  const react = g.mode === 'react' ? REACTIONS[g.reaction] : null;
  const pose: Pose = react ? react.pose : g.mode === 'nap' ? 'nap'
    : g.mode === 'stir' ? 'stir' : g.mode === 'scan' ? 'scan'
    : g.mode === 'grumble' ? 'grumble' : g.mode === 'blow' ? 'blow' : 'scan';

  ctx.save();
  // the whole scene shakes when he blows his top
  if (pose === 'blow') ctx.translate(Math.sin(t * 60) * 3, Math.cos(t * 47) * 2);
  ctx.translate(866, 428);

  // ---- recliner, back part
  rr(-6 - r * 10, -128 - r * -26, 62, 96, 16, CHAIR);            // backrest
  // ---- footrest + legs
  const snorePuff = pose === 'nap' || pose === 'stir' ? Math.sin(t * 3.6) : 0;
  if (r > 0.15) {
    // footrest out, legs up
    const fy = -46 - r * 10;
    rr(-104, fy + 18, 58, 14 * r + 6, 6, CHAIR_DK);              // footrest board
    line(-84, fy + 30, -66, -2, 5);                               // strut
    // legs stretched out
    limb([[-26, fy + 26], [-58, fy + 12], [-88, fy + 8]], 13, PANTS);
    poly([[-104, fy + 2], [-86, fy + 2], [-84, fy + 14], [-106, fy + 14]], SLIPPER); // slipper
  } else {
    // sitting upright, feet on the floor
    limb([[-22, -48], [-38, -26], [-40, -4]], 13, PANTS);
    poly([[-58, -8], [-36, -8], [-34, 0], [-60, 0]], SLIPPER);
    limb([[-10, -48], [-24, -26], [-26, -4]], 13, PANTS);
    poly([[-44, -8], [-22, -8], [-20, 0], [-46, 0]], SLIPPER);
  }
  // ---- seat
  rr(-44, -60 + r * 6, 74, 26, 10, CHAIR);
  rr(-52, -66 + r * 6, 20, 34, 8, CHAIR_DK);                      // front armrest

  // ---- torso (rotates back with the recline)
  ctx.save();
  ctx.translate(-8, -54 + r * 6);                                 // hip pivot
  ctx.rotate(r * 0.5);                                            // lean back
  const wob = pose === 'chuckle' ? Math.sin(t * 14) * 0.045 : 0;
  ctx.rotate(wob);
  const lean = pose === 'point' || pose === 'scan' ? -0.16 : pose === 'jawDrop' ? -0.1 : 0;
  ctx.rotate(lean);

  // belly + cardigan
  const belly = pose === 'chuckle' ? Math.sin(t * 14) * 2 : snorePuff * 1.5;
  ctx.beginPath();
  ctx.ellipse(-10, -38, 34 + belly * 0.5, 40 + belly, 0, 0, Math.PI * 2);
  ctx.fillStyle = CARDIGAN; ctx.fill(); outline(); ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(-16, -34, 18, 30 + belly * 0.7, 0, 0, Math.PI * 2);
  ctx.fillStyle = SHIRT; ctx.fill(); outline(2.5); ctx.stroke();
  // cardigan buttons
  blob(-16, -44, 2.5, 2.5, INK, false);
  blob(-16, -30, 2.5, 2.5, INK, false);

  drawArms(pose, t);
  drawHead(pose, t);
  ctx.restore();

  // ---- recliner arm nearest the viewer
  rr(18, -70 + r * 6, 26, 40, 10, CHAIR);
  ctx.restore();

  drawOverlays(pose, t);
}

function drawArms(pose: Pose, t: number): void {
  const W = 9;
  const sh: [number, number] = [-10, -64];                        // shoulder
  const arm = (pts: number[][]) => limb([sh, ...pts], W, CARDIGAN);
  const hand = (x: number, y: number, r = 7) => blob(x, y, r, r, SKIN);

  switch (pose) {
    case 'nap': case 'stir': {
      const dr = pose === 'stir' ? Math.sin(t * 30) * 2 : 0;
      arm([[-34, -44], [-28, -22 + dr]]);
      hand(-26, -18 + dr);
      break;
    }
    case 'scan': {                                                // hand shading the brow
      arm([[-28, -70], [-44, -96]]);
      poly([[-56, -100], [-38, -102], [-36, -92], [-52, -92]], SKIN);
      break;
    }
    case 'point': {                                               // THE finger
      const jab = Math.sin(t * 18) * 4;
      arm([[-38, -66], [-64 - jab, -70]]);
      hand(-66 - jab, -70, 8);
      line(-70 - jab, -72, -86 - jab, -74, 7, INK);
      line(-70 - jab, -72, -86 - jab, -74, 4, SKIN);
      break;
    }
    case 'hips': {                                                // fists on hips, elbows out
      arm([[-42, -52], [-24, -34]]);
      hand(-24, -34, 7.5);
      break;
    }
    case 'forehead': {                                            // the back of the hand, woe
      arm([[-34, -84], [-24, -104]]);
      poly([[-34, -110], [-16, -108], [-18, -98], [-34, -100]], SKIN);
      break;
    }
    case 'fistShake': {
      const sh2 = Math.sin(t * 26) * 5;
      arm([[-34, -84], [-46 + sh2, -108]]);
      hand(-48 + sh2, -112, 9);
      break;
    }
    case 'jawDrop': {                                             // hands on cheeks
      arm([[-30, -80], [-26, -102]]);
      hand(-27, -106, 7.5);
      break;
    }
    case 'chuckle': {                                             // hands on the shaking belly
      arm([[-34, -48], [-24, -34]]);
      hand(-23, -32, 7.5);
      break;
    }
    case 'thumbsUp': {
      arm([[-40, -60], [-58, -72]]);
      hand(-60, -73, 8.5);
      line(-62, -80, -63, -92, 8, INK);
      line(-62, -80, -63, -92, 5, SKIN);
      break;
    }
    case 'heart': {                                               // both hands clasped to chest
      arm([[-30, -58], [-26, -60]]);
      hand(-27, -58, 8);
      hand(-33, -56, 8);
      break;
    }
    case 'grumble': {                                             // arms crossed, harrumph
      arm([[-34, -50], [-16, -46]]);
      limb([[-30, -46], [-14, -52]], W, CARDIGAN);
      hand(-14, -52, 6.5);
      break;
    }
    case 'blow': {                                                // both arms flung skyward
      const fl = Math.sin(t * 40) * 4;
      arm([[-34, -90], [-40, -118 + fl]]);
      hand(-41, -122 + fl, 8);
      limb([[-4, -66], [8, -94], [4, -118 - fl]], W, CARDIGAN);
      hand(3, -122 - fl, 8);
      break;
    }
  }
}

function drawHead(pose: Pose, t: number): void {
  ctx.save();
  const headTilt =
    pose === 'nap' || pose === 'stir' ? 0.15
    : pose === 'forehead' ? 0.3
    : pose === 'jawDrop' ? 0.1
    : pose === 'chuckle' ? -0.12
    : pose === 'blow' ? -0.05 : 0;
  ctx.translate(-12, -86);
  ctx.rotate(headTilt);
  ctx.translate(0, -22);

  // ears + bald head with side tufts
  const face = pose === 'blow' ? '#e8543a' : SKIN;
  blob(14, 2, 7, 9, face);                                        // ear
  const tuftPop = pose === 'blow' ? 6 + Math.sin(t * 40) * 2 : 0;
  blob(16, -12 - tuftPop, 9, 8, HAIR);                            // tuft
  blob(-2, -18 - tuftPop * 1.4, 7, 5, HAIR);                      // wisp on top
  ctx.beginPath();
  ctx.ellipse(0, 0, 20, 22, 0, 0, Math.PI * 2);
  ctx.fillStyle = face; ctx.fill(); outline(); ctx.stroke();
  // liver spot + wrinkles
  blob(6, -14, 3, 2, SKIN_DK, false);
  line(-6, -16, 2, -17, 1.8, SKIN_DK);

  const asleep = pose === 'nap' || pose === 'stir';

  // the big nose
  blob(-18, 4, 8.5, 7, face);

  // glasses + eyes
  const gJump = pose === 'jawDrop' || pose === 'blow' ? -4 - Math.sin(t * 30) * 2 : 0;
  if (!asleep) {
    line(-24, -4 + gJump, 12, -4 + gJump, 2.5);
    ctx.save();
    ctx.fillStyle = '#ffffff';
    blob(-14, -2 + gJump, 7.5, 7.5, '#ffffff');
    blob(4, -2 + gJump, 7.5, 7.5, '#ffffff');
    ctx.restore();
    const squint = pose === 'scan';
    const mad = pose === 'point' || pose === 'hips' || pose === 'fistShake' || pose === 'grumble' || pose === 'blow';
    const happy = pose === 'chuckle' || pose === 'heart' || pose === 'thumbsUp';
    if (happy) {
      // closed happy arcs
      ctx.beginPath(); ctx.arc(-14, -2 + gJump, 4, Math.PI, 0); outline(2.2); ctx.stroke();
      ctx.beginPath(); ctx.arc(4, -2 + gJump, 4, Math.PI, 0); ctx.stroke();
    } else {
      blob(-14, -1 + gJump, squint ? 1.6 : 2.6, squint ? 1.2 : 2.6, INK, false);
      blob(4, -1 + gJump, squint ? 1.6 : 2.6, squint ? 1.2 : 2.6, INK, false);
    }
    // brows
    const ba = mad ? 0.5 : squint ? 0.25 : -0.1;
    line(-20, -11 + gJump + (mad ? 4 : 0), -8, -11 + gJump - ba * 8, 3.5, HAIR);
    line(-2, -11 + gJump - ba * 8, 10, -11 + gJump + (mad ? 4 : 0), 3.5, HAIR);
  } else {
    // asleep: glasses slid down the nose, eyes shut
    line(-22, 2, 10, 0, 2);
    ctx.beginPath(); ctx.arc(-14, -2, 4, 0.2, Math.PI - 0.4); outline(2.2); ctx.stroke();
    ctx.beginPath(); ctx.arc(4, -2, 4, 0.2, Math.PI - 0.4); ctx.stroke();
  }

  // the grand mustache + mouth
  const snore = asleep ? Math.sin(t * 3.6) : 0;
  const stache = (flare: number) => {
    blob(-14, 12, 12, 6 + flare, HAIR);
    blob(-2, 12, 12, 6 + flare, HAIR);
  };
  if (asleep) {
    // mouth open under the mustache, mustache puffing with each snore
    blob(-8, 18, 6, 4 + Math.max(0, snore) * 3, '#5a2c20');
    stache(Math.max(0, snore) * 2);
    if (pose === 'stir') {
      // sputtering — mustache flaps wildly
      stache(Math.abs(Math.sin(t * 24)) * 3);
    }
  } else if (pose === 'blow' || pose === 'jawDrop' || pose === 'point' || pose === 'hips' || pose === 'fistShake') {
    // hollering
    const w = pose === 'blow' ? 9 : 7;
    blob(-7, 19, w, pose === 'jawDrop' ? 10 : 7, '#5a2c20');
    blob(-7, 23, 4, 2.5, '#e07a6a', false);
    stache(1);
  } else if (pose === 'grumble') {
    line(-14, 19, 0, 20, 2.5);
    stache(Math.abs(Math.sin(t * 16)) * 1.5);
  } else {
    // warm smile
    ctx.beginPath(); ctx.arc(-7, 15, 7, 0.3, Math.PI - 0.5); outline(2.5); ctx.stroke();
    stache(0);
  }
  ctx.restore();
}

// Zzz, hearts, steam, grumble-symbols — drawn in world space near his head.
function drawOverlays(pose: Pose, t: number): void {
  const e = eyePoint();
  if (pose === 'nap') {
    ctx.save();
    ctx.font = 'bold 24px "Chalkboard SE", "Comic Sans MS", sans-serif';
    ctx.fillStyle = '#5a7fd0';
    for (let i = 0; i < 3; i++) {
      const p = (t * 0.45 + i * 0.33) % 1;
      ctx.globalAlpha = (1 - p) * 0.9;
      const s = 12 + p * 16;
      ctx.font = `bold ${s}px "Chalkboard SE", "Comic Sans MS", sans-serif`;
      ctx.fillText('Z', e.x - 6 + Math.sin(p * 7) * 12, e.y - 40 - p * 70);
    }
    ctx.restore();
  } else if (pose === 'stir') {
    ctx.save();
    ctx.font = 'bold 30px sans-serif';
    ctx.fillStyle = '#e0322a';
    ctx.globalAlpha = 0.6 + Math.sin(t * 14) * 0.4;
    ctx.fillText('!', e.x + 4, e.y - 52);
    ctx.restore();
  } else if (pose === 'heart') {
    ctx.save();
    ctx.font = 'bold 20px sans-serif';
    ctx.fillStyle = '#e0509a';
    for (let i = 0; i < 2; i++) {
      const p = (t * 0.8 + i * 0.5) % 1;
      ctx.globalAlpha = 1 - p;
      ctx.fillText('♥', e.x - 20 + i * 26, e.y - 46 - p * 40);
    }
    ctx.restore();
  } else if (pose === 'grumble') {
    ctx.save();
    ctx.font = 'bold 15px sans-serif';
    ctx.fillStyle = '#241a10';
    ctx.globalAlpha = 0.8;
    ctx.fillText('#$@%!', e.x - 26 + Math.sin(t * 9) * 3, e.y - 46);
    ctx.restore();
  } else if (pose === 'blow') {
    // steam jets from the ears + the popped lid vibe
    for (let i = 0; i < 2; i++) {
      const p = (t * 1.6 + i * 0.5) % 1;
      ctx.save();
      ctx.globalAlpha = (1 - p) * 0.8;
      blob(e.x + 18 + p * 26, e.y - 10 - p * 24, 7 + p * 8, 6 + p * 6, '#f2f2ee');
      blob(e.x - 34 - p * 30, e.y - 14 - p * 22, 7 + p * 8, 6 + p * 6, '#f2f2ee');
      ctx.restore();
    }
  }
}

// The callout bubble for the active Reaction (drawn above everything).
export function drawCallout(): void {
  if (grandpa.mode !== 'react') return;
  const r = REACTIONS[grandpa.reaction];
  const e = eyePoint();
  // anchored at his mouth, ballooning up and to the left over the room
  speechBubble(e.x - 24, e.y - 26, r.text, !r.like, grandpa.modeT);
}
