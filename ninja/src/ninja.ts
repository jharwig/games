// =============================================================================
// the ninja: the blocky character model, her outfits, the pose system (run,
// air tricks, hangs, climbs, celebration), the ponytail and the blob shadow
// =============================================================================
import * as THREE from "three";
import { sfxStep } from "./audio";
import { FLIP_SPEED, RUN_SPEED } from "./constants";
import type { Platform } from "./course";
import { box, mat, scene } from "./gfx";
import { input } from "./input";
import { puff } from "./particles";
import { pathPos, placeOnPath } from "./path";
import { PREP, player } from "./player";
import { clamp, damp, lerp, roundTo2Pi, smoothstep, storeGet, storeSet } from "./util";

const SKIN = 0xffcf9e;
const SHIRT = 0xff7a00;
const PANTS = 0x2b4bd8;
const BAND = 0xff2e88;

function limb(parent: THREE.Object3D, x: number, y: number, w: number, h: number, d: number, hex: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, 0);
  const m = box(g, 0, -h / 2, 0, w, h, d, hex, true);
  m.castShadow = true;
  parent.add(g);
  return g;
}

const ninja = new THREE.Group();
const ninjaFlip = new THREE.Group();      // rotates for the somersault and the spin
ninjaFlip.rotation.order = "YXZ";         // yaw first, so a flip + spin combo reads right
ninjaFlip.position.y = 1.0;
ninja.add(ninjaFlip);
const ninjaBody = new THREE.Group();      // feet back at y = 0
ninjaBody.position.y = -1.0;
ninjaFlip.add(ninjaBody);
scene.add(ninja);

// every recolorable piece is kept in `wear` so an outfit can restyle it
const wear = {
  skin: [] as THREE.Mesh[], hair: [] as THREE.Mesh[], eyes: [] as THREE.Mesh[], shirt: [] as THREE.Mesh[],
  skirt: [] as THREE.Mesh[], shorts: [] as THREE.Mesh[], socks: [] as THREE.Mesh[], shoes: [] as THREE.Mesh[],
  belt: null as unknown as THREE.Mesh, band: null as unknown as THREE.Mesh, tie: null as unknown as THREE.Mesh,
  pony: [] as THREE.Object3D[]
};

const legL = limb(ninjaBody, -0.17, 0.74, 0.26, 0.74, 0.26, SKIN);
const legR = limb(ninjaBody,  0.17, 0.74, 0.26, 0.74, 0.26, SKIN);
wear.skin.push(legL.children[0] as THREE.Mesh, legR.children[0] as THREE.Mesh);
wear.shorts.push(box(legL, 0, -0.1, 0, 0.3, 0.34, 0.3, PANTS, true));   // skort shorts
wear.shorts.push(box(legR, 0, -0.1, 0, 0.3, 0.34, 0.3, PANTS, true));
wear.socks.push(box(legL, 0, -0.56, 0, 0.3, 0.14, 0.32, 0x6d2fd6, true));
wear.socks.push(box(legR, 0, -0.56, 0, 0.3, 0.14, 0.32, 0x6d2fd6, true));
wear.shoes.push(box(legL, 0, -0.72, 0.06, 0.3, 0.16, 0.42, 0x18202e, true));
wear.shoes.push(box(legR, 0, -0.72, 0.06, 0.3, 0.16, 0.42, 0x18202e, true));

wear.shirt.push(box(ninjaBody, 0, 1.1, 0, 0.62, 0.76, 0.4, SHIRT, true));
wear.belt = box(ninjaBody, 0, 0.78, 0, 0.66, 0.16, 0.44, 0x00e0ff, true);        // belt
wear.skirt.push(box(ninjaBody, 0, 0.66, 0, 0.74, 0.14, 0.5, PANTS, true));       // skort skirt, upper flare
wear.skirt.push(box(ninjaBody, 0, 0.54, 0, 0.84, 0.12, 0.56, PANTS, true));      // skort skirt, lower flare

const armL = limb(ninjaBody, -0.42, 1.38, 0.2, 0.64, 0.2, SKIN);
const armR = limb(ninjaBody,  0.42, 1.38, 0.2, 0.64, 0.2, SKIN);
wear.skin.push(armL.children[0] as THREE.Mesh, armR.children[0] as THREE.Mesh);
wear.shirt.push(box(armL, 0, -0.14, 0, 0.24, 0.3, 0.24, SHIRT, true));           // sleeve
wear.shirt.push(box(armR, 0, -0.14, 0, 0.24, 0.3, 0.24, SHIRT, true));

const head = new THREE.Group();
head.position.y = 1.76;
ninjaBody.add(head);
wear.skin.push(box(head, 0, 0, 0, 0.52, 0.52, 0.5, SKIN, true));
wear.band = box(head, 0, 0.14, 0, 0.56, 0.16, 0.54, BAND, true);                 // headband
wear.eyes.push(box(head, -0.13, 0.0, 0.26, 0.09, 0.11, 0.04, 0x18202e, false));  // eyes
wear.eyes.push(box(head,  0.13, 0.0, 0.26, 0.09, 0.11, 0.04, 0x18202e, false));
wear.hair.push(box(head, 0, 0.3, 0.02, 0.5, 0.14, 0.46, 0x25313f, true));        // hair top
const ponyBase = box(head, 0, 0.28, -0.28, 0.2, 0.2, 0.16, 0x25313f, true);      // ponytail base
wear.hair.push(ponyBase);
// the ponytail hangs from two hinged segments so it can swing and whip
const pony = new THREE.Group();
pony.position.set(0, 0.28, -0.28);
head.add(pony);
wear.tie = box(pony, 0, 0.02, -0.05, 0.22, 0.1, 0.1, BAND, true);                // hair tie
wear.hair.push(box(pony, 0, -0.22, -0.12, 0.16, 0.34, 0.14, 0x25313f, true));    // ponytail, upper
const ponyTip = new THREE.Group();
ponyTip.position.set(0, -0.38, -0.14);
pony.add(ponyTip);
wear.hair.push(box(ponyTip, 0, -0.14, -0.02, 0.13, 0.3, 0.11, 0x25313f, true));  // ponytail, tip
wear.pony.push(ponyBase, pony);

ninja.traverse(function (o) { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = false; } });

// -------- outfits (drawn on paper, colored in here) --------
// skirt: null means shorts only; socks/shoes: null means bare feet; band: null hides the headband
interface Outfit {
  name: string;
  skin: number; hair: number; tie: number; band: number | null; eyes: number;
  shirt: number; belt: number; skirt: number | null; shorts: number;
  socks: number | null; shoes: number | null; pony: boolean;
}
const OUTFITS: Outfit[] = [
  { name: "Gemma",
    skin: 0xd18f5f, hair: 0x8e3b28, tie: 0xb04430, band: 0x8e3b28, eyes: 0x2e62c8,
    shirt: 0x23262b, belt: 0x16181d, skirt: 0x2f63e8, shorts: 0x2f63e8,
    socks: 0x6d2fd6, shoes: 0x101216, pony: true },
  { name: "Scout",
    skin: 0xf3ac6a, hair: 0x77492a, tie: 0x77492a, band: null, eyes: 0x10161e,
    shirt: 0x4d9e45, belt: 0x4d9e45, skirt: null, shorts: 0x2e7fd6,
    socks: null, shoes: null, pony: false }
];

let outfitIdx = parseInt(storeGet("ninja.outfit", "0"), 10);
if (!(outfitIdx >= 0 && outfitIdx < OUTFITS.length)) outfitIdx = 0;

export function applyOutfit(i: number): void {
  outfitIdx = i;
  const o = OUTFITS[i];
  function paint(list: THREE.Mesh[], hex: number): void { for (let j = 0; j < list.length; j++) list[j].material = mat(hex); }
  paint(wear.skin, o.skin);
  paint(wear.hair, o.hair);
  paint(wear.eyes, o.eyes);
  paint(wear.shirt, o.shirt);
  paint(wear.shorts, o.shorts);
  wear.belt.material = mat(o.belt);
  wear.tie.material = mat(o.tie);
  for (let j = 0; j < wear.skirt.length; j++) {
    wear.skirt[j].visible = o.skirt !== null;
    if (o.skirt !== null) wear.skirt[j].material = mat(o.skirt);
  }
  for (let j = 0; j < wear.socks.length; j++) {
    wear.socks[j].visible = o.socks !== null;
    if (o.socks !== null) wear.socks[j].material = mat(o.socks);
  }
  paint(wear.shoes, o.shoes !== null ? o.shoes : o.skin);
  wear.band.visible = o.band !== null;
  if (o.band !== null) wear.band.material = mat(o.band);
  for (let j = 0; j < wear.pony.length; j++) wear.pony[j].visible = o.pony;
  storeSet("ninja.outfit", String(i));
  const btns = document.querySelectorAll<HTMLElement>(".outfitBtn");
  for (let j = 0; j < btns.length; j++) btns[j].classList.toggle("selected", +(btns[j].dataset.i || -1) === i);
}

// a little paper-doll preview of the outfit for the buttons
function drawOutfitPreview(cv: HTMLCanvasElement, o: Outfit): void {
  const s = 2;
  cv.width = 44 * s; cv.height = 62 * s;
  const c = cv.getContext("2d")!;
  c.scale(s, s);
  function css(h: number): string { return "#" + ("00000" + h.toString(16)).slice(-6); }
  function r(x: number, y: number, w: number, h: number, hex: number): void { c.fillStyle = css(hex); c.fillRect(x, y, w, h); }
  r(14, 6, 16, 14, o.skin);                       // head
  r(12, 3, 20, 7, o.hair);                        // hair
  r(12, 3, 3, 10, o.hair);
  r(29, 3, 3, 10, o.hair);
  if (o.pony) r(31, 8, 4, 16, o.hair);            // ponytail
  r(17, 13, 3, 4, o.eyes);                        // eyes
  r(24, 13, 3, 4, o.eyes);
  r(13, 21, 18, 15, o.shirt);                     // torso
  r(8, 21, 5, 8, o.shirt);                        // sleeves
  r(31, 21, 5, 8, o.shirt);
  r(8, 29, 5, 11, o.skin);                        // arms
  r(31, 29, 5, 11, o.skin);
  if (o.skirt !== null) {
    c.fillStyle = css(o.skirt);
    c.beginPath();
    c.moveTo(12, 36); c.lineTo(32, 36); c.lineTo(35, 46); c.lineTo(9, 46);
    c.closePath(); c.fill();
    r(15, 46, 5, 8, o.skin);                      // legs
    r(24, 46, 5, 8, o.skin);
  } else {
    r(13, 36, 18, 9, o.shorts);                   // shorts
    r(15, 45, 5, 9, o.skin);                      // legs
    r(24, 45, 5, 9, o.skin);
  }
  if (o.socks !== null) { r(14, 52, 7, 4, o.socks); r(23, 52, 7, 4, o.socks); }
  if (o.shoes !== null) { r(14, 56, 7, 5, o.shoes); r(23, 56, 7, 5, o.shoes); }
  else { r(15, 54, 5, 5, o.skin); r(24, 54, 5, 5, o.skin); }    // bare feet
}

function buildOutfitButtons(container: HTMLElement, onPick: () => void): void {
  OUTFITS.forEach(function (o, i) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "outfitBtn";
    b.dataset.i = String(i);
    const cv = document.createElement("canvas");
    drawOutfitPreview(cv, o);
    b.appendChild(cv);
    const nm = document.createElement("span");
    nm.textContent = o.name;
    b.appendChild(nm);
    // pointerdown, so a tap never doubles as a jump or a game start
    b.addEventListener("pointerdown", function (e) {
      e.stopPropagation();
      e.preventDefault();
      applyOutfit(i);
      onPick();
    }, { passive: false });
    b.addEventListener("click", function (e) { e.stopPropagation(); });
    container.appendChild(b);
  });
}

// builds the outfit pickers and dresses the ninja in the stored outfit
export function initOutfits(containers: HTMLElement[], onPick: () => void): void {
  for (const c of containers) buildOutfitButtons(c, onPick);
  applyOutfit(outfitIdx);
}

let squashT = 0;    // seconds of landing squash left
let squashAmp = 1;  // how hard the landing was, 0..1
export function landSquash(t: number, amp: number): void { squashT = t; squashAmp = amp; }

// a soft blob shadow marks the landing point below the ninja
const blobMat = new THREE.MeshBasicMaterial({ color: 0x0e2440, transparent: true, opacity: 0.25, depthWrite: false });
const blob = new THREE.Mesh(new THREE.CircleGeometry(1, 22), blobMat);
blob.rotation.x = -Math.PI / 2;
scene.add(blob);

export function updateBlob(platforms: Platform[]): void {
  let gy = -Infinity;
  for (let i = 0; i < platforms.length; i++) {
    const p = platforms[i];
    if (player.z < p.z0 - 0.2 || player.z > p.z1 + 0.2) continue;
    if (p.y <= player.y + 0.05 && p.y > gy) gy = p.y;
  }
  if (gy === -Infinity) { blob.visible = false; return; }
  const h = player.y - gy;
  blob.visible = true;
  pathPos(player.z, 0, gy + 0.03, blob.position);
  blob.scale.setScalar(clamp(0.62 - h * 0.022, 0.3, 0.62));
  blobMat.opacity = clamp(0.3 - h * 0.012, 0.1, 0.3);
}

// =============================================================================
// character posing
// =============================================================================
// pose cross-blend: a state change (grab, release, land...) snapshots the limb
// angles, then every pose eases from the snapshot over POSE_BLEND seconds so
// no joint ever pops in a single frame
const POSE_BLEND = 0.15;
let poseBlendT = 1;
const poseCap = { aL: 0, aR: 0, lL: 0, lR: 0, head: 0 };

export function snapshotPose(): void {
  poseCap.aL = armL.rotation.x; poseCap.aR = armR.rotation.x;
  poseCap.lL = legL.rotation.x; poseCap.lR = legR.rotation.x;
  poseCap.head = head.rotation.x;
  poseBlendT = 0;
}
export function tickPoseBlend(dt: number): void { poseBlendT += dt; }
function poseK(): number { return smoothstep(clamp(poseBlendT / POSE_BLEND, 0, 1)); }

function setArms(a: number, b: number): void {
  const k = poseK();
  armL.rotation.x = lerp(poseCap.aL, a, k); armR.rotation.x = lerp(poseCap.aR, b, k);
  armL.rotation.z = -player.armSpread; armR.rotation.z = player.armSpread;
}
function setLegs(a: number, b: number): void {
  const k = poseK();
  legL.rotation.x = lerp(poseCap.lL, a, k); legR.rotation.x = lerp(poseCap.lR, b, k);
  legL.rotation.z = -player.legSpread; legR.rotation.z = player.legSpread;
}
function setHead(a: number): void {
  head.rotation.x = lerp(poseCap.head, a, poseK());
}
// the torso leans into whatever the body is doing; eased so poses hand over softly
function setLean(target: number, dt: number): void {
  ninjaBody.rotation.x = damp(ninjaBody.rotation.x, target, 10, dt);
}

// every pose that is not a trick eases the spin and the spread back to normal
function settleTrick(dt: number): void {
  player.twist = damp(player.twist, roundTo2Pi(player.twist), 16, dt);
  player.armSpread = damp(player.armSpread, 0, 16, dt);
  player.legSpread = damp(player.legSpread, 0, 16, dt);
  ninjaFlip.rotation.y = player.twist;
}

export function poseRun(dt: number): void {
  const speed = Math.abs(player.vz);
  player.runPhase += dt * (3.0 + speed * 1.5);
  const s = speed / RUN_SPEED;
  const sw = Math.sin(player.runPhase) * 0.95 * s;
  setLegs(sw, -sw);
  setArms(-sw * 0.85, sw * 0.85);
  setHead(-0.06 * s);
  setLean(0.16 * s, dt);
  ninjaBody.position.y = -1.0 + Math.abs(Math.sin(player.runPhase)) * 0.07 * s;
  player.flip = damp(player.flip, roundTo2Pi(player.flip), 18, dt);
  ninjaFlip.rotation.x = player.flip;
  settleTrick(dt);
  // footsteps
  player.stepT -= dt * (3.0 + speed * 1.5);
  if (s > 0.35 && player.stepT <= 0) {
    player.stepT = Math.PI;
    sfxStep();
    puff(0, player.y + 0.02, player.z - 0.3, 2, 0.18, 0.9);
  }
  if (squashT > 0) squashT -= dt;
  // the squash scales with the landing speed: a hop dips, a big drop crunches
  const sq = clamp(squashT / 0.16, 0, 1) * squashAmp;
  ninjaBody.scale.set(1 + sq * 0.35, 1 - sq * 0.3, 1 + sq * 0.35);
}

export function poseAir(dt: number): void {
  const tr = player.trick;
  ninjaBody.position.y = -1.0;
  ninjaBody.scale.set(0.97, 1.05, 0.97);

  if (!tr) {
    // no trick: the plain tumble, used for lache releases and for falls.
    // the spin winds up over the first third of a second instead of starting
    // at full speed on frame one
    const ramp = smoothstep(clamp(player.air / 0.32, 0, 1));
    player.flip += FLIP_SPEED * ramp * dt;
    ninjaFlip.rotation.x = player.flip;
    settleTrick(dt);
    setLegs(-1.15, -0.85);
    setArms(-2.3, -2.3);
    setHead(0.25);
    setLean(0, dt);
    return;
  }

  tr.t += dt;
  const p = clamp(tr.t / tr.dur, 0, 1);
  const e = smoothstep(p);
  player.flip = tr.x0 + tr.flips * Math.PI * 2 * e;
  player.twist = tr.y0 + tr.twists * Math.PI * 2 * e;
  ninjaFlip.rotation.x = player.flip;
  ninjaFlip.rotation.y = player.twist;

  // the pose fades in at the take off and back out before the landing
  const k = clamp(Math.min(tr.t / 0.14, (1 - p) / 0.22), 0, 1);
  const d = tr.def;
  player.armSpread = d.armZ * k;
  player.legSpread = d.legZ * k;
  setArms(lerp(PREP.arms[0], d.arms[0], k), lerp(PREP.arms[1], d.arms[1], k));
  setLegs(lerp(PREP.legs[0], d.legs[0], k), lerp(PREP.legs[1], d.legs[1], k));
  setHead(lerp(PREP.head, d.head, k));
  setLean(0, dt);
}

export function poseHang(dt: number, tilt: number): void {
  player.flip = damp(player.flip, 0, 16, dt);
  ninjaFlip.rotation.x = player.flip;
  settleTrick(dt);
  setArms(Math.PI * 0.97, Math.PI * 0.97);
  const k = Math.sin(performance.now() * 0.004) * 0.15;
  // kip: the legs drive the swing, tucking hard when the player pumps
  const kip = input.forward ? clamp(player.omega * 0.28, -0.7, 0.7) : 0;
  setLegs(0.35 + k - tilt - kip, 0.1 - k - tilt - kip);
  setHead(-0.2 - kip * 0.3);
  setLean(-0.06 - kip * 0.12, dt);
  ninjaBody.position.y = -1.0;
  ninjaBody.scale.set(1, 1, 1);
}

export function poseRail(dt: number): void {
  player.flip = damp(player.flip, 0, 16, dt);
  ninjaFlip.rotation.x = player.flip;
  settleTrick(dt);
  // hand over hand along the bar; a slow settle when hanging still
  player.moveAnim = damp(player.moveAnim, input.forward ? 1 : 0, 10, dt);
  const m = player.moveAnim;
  player.runPhase += dt * (2 + m * 8);
  const sw = Math.sin(player.runPhase);
  setArms(Math.PI * 0.97 + sw * (0.12 + 0.55 * m), Math.PI * 0.97 - sw * (0.12 + 0.55 * m));
  setLegs(0.4 + sw * (0.2 + 0.55 * m), 0.15 - sw * (0.2 + 0.55 * m));
  setHead(-0.25);
  setLean(0.08 * m, dt);
  // each new grip hitches the body up a little
  ninjaBody.position.y = -1.0 + Math.abs(Math.cos(player.runPhase)) * 0.08 * m;
  ninjaBody.scale.set(1, 1, 1);
}

export function poseClimb(dt: number): void {
  player.flip = damp(player.flip, 0, 16, dt);
  ninjaFlip.rotation.x = player.flip;
  settleTrick(dt);
  // hand over hand up the rope, knees pumping, with a pull-up bob
  player.moveAnim = damp(player.moveAnim, input.forward ? 1 : 0, 10, dt);
  const m = player.moveAnim;
  player.runPhase += dt * (2 + m * 9);
  const sw = Math.sin(player.runPhase);
  setArms(Math.PI * 0.94 + sw * (0.15 + 0.6 * m), Math.PI * 0.94 - sw * (0.15 + 0.6 * m));
  setLegs(0.45 - sw * (0.15 + 0.55 * m), 0.45 + sw * (0.15 + 0.55 * m));
  setHead(-0.15 - m * 0.3);   // look up the rope while climbing
  setLean(-0.1 * m, dt);
  ninjaBody.position.y = -1.0 + Math.abs(sw) * 0.1 * m;
  ninjaBody.scale.set(1, 1, 1);
}

export function poseCelebrate(dt: number, celebrateT: number): void {
  player.flip = damp(player.flip, 0, 14, dt);
  ninjaFlip.rotation.x = player.flip;
  settleTrick(dt);
  const k = Math.sin(celebrateT * 8) * 0.25;
  setArms(-2.6 + k, -2.6 - k);
  setLegs(0.15, -0.15);
  setHead(-0.2);
  setLean(0, dt);
  ninjaBody.position.y = -1.0;
  ninjaBody.scale.set(1, 1, 1);
}

export function idleNinja(dt: number): void {
  player.runPhase += dt * 2;
  const k = Math.sin(player.runPhase) * 0.15;
  setArms(-0.1 + k, -0.1 - k);
  setLegs(0.1, -0.1);
  setHead(0);
  setLean(0, dt);
  ninjaFlip.rotation.x = 0;
  player.twist = 0; player.armSpread = 0; player.legSpread = 0;
  ninjaFlip.rotation.y = 0;
  ninjaBody.position.y = -1.0 + Math.sin(player.runPhase * 1.4) * 0.04;
  ninjaBody.scale.set(1, 1, 1);
}

// =============================================================================
// ponytail: a two-segment lagged follower that trails the body's motion
// =============================================================================
let ponyAng = 0, ponyTipAng = 0;

export function updatePony(dt: number, falling: boolean): void {
  let target: number;
  if (player.hang) {
    // sways with the swing
    target = clamp(player.omega * 0.22, -0.45, 0.45);
  } else if (player.onGround && !falling) {
    // streams out at speed, with a small bounce from the stride
    const s = Math.abs(player.vz) / RUN_SPEED;
    target = s * 0.35 + Math.sin(player.runPhase * 2) * 0.1 * s;
  } else {
    // lifts while falling, tucks while rising
    target = clamp(-player.vy * 0.05, -0.45, 0.85);
  }
  ponyAng = damp(ponyAng, target, 9, dt);
  ponyTipAng = damp(ponyTipAng, ponyAng, 6.5, dt);
  pony.rotation.x = ponyAng;
  // the tip whips by however far it lags behind the upper segment
  ponyTip.rotation.x = clamp((ponyAng - ponyTipAng) * 2.2, -0.9, 0.9);
}

export function syncNinja(dt: number): void {
  // the grab offset eases out over roughly a sixth of a second
  player.visOffZ = damp(player.visOffZ, 0, 13, dt);
  player.visOffY = damp(player.visOffY, 0, 13, dt);
  // placed on the course and turned to face along it; flips and spins are
  // children, so they stay relative to the heading
  placeOnPath(ninja, player.z + player.visOffZ, 0, player.y + player.visOffY);
}
