// Pirates of the Swingset — designed by Genevieve.
// main.ts composes the modules and owns the game rules; see CONTEXT.md for
// the vocabulary and types.ts for the module contracts.

import * as THREE from 'three';
import { OutlineEffect } from 'three/examples/jsm/effects/OutlineEffect.js';
import {
  BLAST_RADIUS,
  EventBus,
  FOG_FAR,
  FOG_NEAR,
  type GameCtx,
  HEARTS_MAX,
  SCORE_POINTS,
  type ScoreBreakdown,
  type SwingInfo,
} from './types';
import { clearFrameInput, createInput } from './input';
import { createWorld } from './world';
import { createPlayer } from './player';
import { createShip } from './ship';
import { createTools } from './tools';
import { createUi } from './ui';
import { createAudio } from './audio';

const BEST_KEY = 'pirates-of-the-swingset-best';

function freshScore(): ScoreBreakdown {
  return { hits: 0, shipsSunk: 0, swingSeconds: 0, swingsetsFound: 0, treesClimbed: 0, total: 0 };
}

// --- renderer / scene ------------------------------------------------------

const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // crisp-edged shadows suit the cel look
app.appendChild(renderer.domElement);

// Ink outline pass: draws an inverted-hull outline around every mesh whose
// material doesn't opt out via userData.outlineParameters (see toon.ts).
const effect = new OutlineEffect(renderer, {
  defaultThickness: 0.0032,
  defaultColor: [0.10, 0.12, 0.20],
});

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9fd8f0, FOG_NEAR, FOG_FAR);
scene.background = new THREE.Color(0x9fd8f0);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  600,
);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- context + modules -----------------------------------------------------

const events = new EventBus();
const input = createInput();

const ctx = {
  scene,
  camera,
  renderer,
  events,
  input,
  screen: 'title',
  round: 1,
  hearts: HEARTS_MAX,
  character: 'girl',
  score: freshScore(),
  bestScore: Number(localStorage.getItem(BEST_KEY) ?? '0'),
  foundSets: new Set<number>(),
} as GameCtx;

ctx.world = createWorld(ctx);
ctx.player = createPlayer(ctx);
ctx.ship = createShip(ctx);
ctx.tools = createTools(ctx);
ctx.ui = createUi(ctx);
ctx.audio = createAudio(ctx);

// Dev-only handle so headless test drivers can read game state.
if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) {
  (window as unknown as { __pots: GameCtx }).__pots = ctx;
}

// --- scoring ---------------------------------------------------------------

function addPoints(n: number): void {
  ctx.score.total += Math.round(n);
}

// --- rules (event handlers) ------------------------------------------------

function loseHeart(reason: 'swingHit' | 'blast' | 'directHit'): void {
  if (ctx.screen !== 'playing' || ctx.hearts <= 0) return;
  ctx.hearts -= 1;
  // A nearby Tree falls down dead — and can be picked up and thrown.
  ctx.world.syncHeartTrees(ctx.player.currentSetIndex, ctx.hearts);
  events.emit('heartLost', { reason });
  ctx.player.cameraShake(0.7);
  if (ctx.hearts <= 0) endRun();
}

function breakSwing(swing: SwingInfo): void {
  if (swing.broken) return;
  ctx.world.breakSwing(swing);
  events.emit('swingBroken', { swing });
  const set = ctx.world.swingsets[swing.setIndex];
  if (set.wrecked()) {
    const anyLeft = ctx.world.swingsets.some((s) => !s.wrecked());
    if (anyLeft) {
      events.emit('message', { text: 'Swingset wrecked! Climb a tree and zip to another island!' });
      ctx.ship.setTrek(true);
    } else {
      events.emit('message', { text: 'Last stand! Fight on foot!' });
    }
  }
}

events.on('cannonImpact', (e) => {
  if (ctx.screen !== 'playing') return;
  const p = ctx.player;
  switch (e.kind) {
    case 'player':
      // Direct mid-air/on-foot hit.
      if (p.ridingSwing) {
        breakSwing(p.ridingSwing);
        p.tumbleOff();
        loseHeart('swingHit');
      } else {
        loseHeart('directHit');
      }
      break;
    case 'swing': {
      const swing = e.swing!;
      const riding = p.ridingSwing === swing;
      breakSwing(swing);
      if (riding) {
        p.tumbleOff();
        loseHeart('swingHit');
      }
      break;
    }
    case 'ground': {
      // Blast radius: the ground is never safe. The punch scales with how
      // close the ball landed — a near miss should rattle the screen.
      const feet = p.position;
      const punch = Math.max(0, 1 - feet.distanceTo(e.pos) / 30);
      events.emit('screenShake', { intensity: 0.45 + 0.5 * punch });
      ctx.player.cameraShake(0.3 + 0.55 * punch);
      // "The ground is never safe": climbing low or mid-bail near the
      // blast counts too — only real height above it protects you.
      const nearGround =
        p.mode === 'ground' ||
        ((p.mode === 'climbing' || p.mode === 'airborne') &&
          feet.y - ctx.world.groundHeightAt(feet.x, feet.z) < 2);
      if (nearGround && feet.distanceTo(e.pos) < BLAST_RADIUS) {
        loseHeart('blast');
      }
      break;
    }
    case 'water':
      break;
  }
});

events.on('shipDamaged', (e) => {
  const pts = e.amount * SCORE_POINTS.hit;
  ctx.score.hits += pts;
  addPoints(pts);
});

events.on('shipSunk', () => {
  if (ctx.screen !== 'playing') return;
  ctx.score.shipsSunk += 1;
  addPoints(SCORE_POINTS.shipSunk * ctx.round);
  ctx.screen = 'roundWon';
  ctx.ui.setScreen('roundWon');
  // Hearts refill — the dead Trees stand back up.
  ctx.hearts = HEARTS_MAX;
  ctx.world.syncHeartTrees(ctx.player.currentSetIndex, ctx.hearts);
});

let hasZipped = false; // first-Lookout hint stops once the player has ridden

events.on('lookoutReached', () => {
  ctx.score.treesClimbed += 1;
  addPoints(SCORE_POINTS.treeClimbed);
  if (!hasZipped) {
    events.emit('message', { text: '◀ ▶ — grab a zip line to another island!' });
  }
});

events.on('zipStarted', () => {
  hasZipped = true;
});

events.on('swingsetArrived', (e) => {
  // The trees near the player's swingset are the health meter.
  ctx.world.syncHeartTrees(e.index, ctx.hearts);
  if (!ctx.foundSets.has(e.index)) {
    ctx.foundSets.add(e.index);
    ctx.score.swingsetsFound += 1;
    addPoints(SCORE_POINTS.swingsetFound);
    if (ctx.foundSets.size > 1) {
      events.emit('message', { text: 'You found a new swingset!' });
    }
  }
  ctx.ship.setTrek(false);
  ctx.ship.moveToSet(e.index);
});

// --- run / round flow ------------------------------------------------------

function startRun(): void {
  ctx.round = 1;
  ctx.hearts = HEARTS_MAX;
  ctx.score = freshScore();
  ctx.foundSets = new Set([0]);
  hasZipped = false;
  ctx.world.repairAllSwings();
  ctx.world.syncHeartTrees(0, ctx.hearts);
  ctx.tools.reset();
  ctx.player.setCharacter(ctx.character);
  ctx.player.reset(0);
  ctx.ship.startRound(1, 0);
  ctx.screen = 'playing';
  ctx.ui.setScreen('playing');
  events.emit('runStarted', { character: ctx.character });
  events.emit('roundStarted', { round: 1 });
}

function startNextRound(): void {
  ctx.round += 1;
  ctx.hearts = HEARTS_MAX;
  ctx.world.syncHeartTrees(ctx.player.currentSetIndex, ctx.hearts);
  ctx.player.setCharacter(ctx.character);
  ctx.ship.startRound(ctx.round, ctx.player.currentSetIndex);
  ctx.screen = 'playing';
  ctx.ui.setScreen('playing');
  events.emit('roundStarted', { round: ctx.round });
}

function endRun(): void {
  ctx.screen = 'gameOver';
  if (ctx.score.total > ctx.bestScore) {
    ctx.bestScore = ctx.score.total;
    localStorage.setItem(BEST_KEY, String(ctx.bestScore));
  }
  ctx.ui.setScreen('gameOver');
  events.emit('gameOver', { score: ctx.score, best: ctx.bestScore });
}

// --- frame loop ------------------------------------------------------------

const STEP = 1 / 120; // fixed-timestep sim
let last = performance.now();
let acc = 0;
let swingScoreAcc = 0;

function simStep(dt: number): void {
  ctx.world.update(dt);
  if (ctx.screen === 'playing') {
    ctx.player.update(dt);
    ctx.ship.update(dt);
    ctx.tools.update(dt);

    // Throw / use the held tool.
    if (ctx.input.throwPressed) ctx.tools.useHeld();

    // Points for real swinging.
    const s = ctx.player.ridingSwing;
    if (s && Math.abs(s.angle) + Math.abs(s.angularVel) * 0.3 > 0.35) {
      ctx.score.swingSeconds += dt;
      swingScoreAcc += dt * SCORE_POINTS.swingPerSecond;
      if (swingScoreAcc >= 1) {
        const whole = Math.floor(swingScoreAcc);
        swingScoreAcc -= whole;
        addPoints(whole);
      }
    }
  } else {
    // Menus: keep the world alive (idle sway, water) and the camera drifting.
    ctx.player.update(dt);
    if (ctx.screen === 'roundWon' || ctx.screen === 'gameOver') ctx.ship.update(dt);
  }
}

function frame(now: number): void {
  requestAnimationFrame(frame);
  const elapsed = Math.min((now - last) / 1000, 0.1);
  last = now;

  if (ctx.input.mutePressed) ctx.audio.toggleMute();
  if (ctx.input.anyPressed || ctx.input.pumpPressed) ctx.audio.userGesture();

  // Screen transitions driven by UI clicks.
  const picked = ctx.ui.consumeStartRequest();
  if (picked && ctx.screen !== 'playing') {
    ctx.character = picked;
    if (ctx.screen === 'title' || ctx.screen === 'gameOver') startRun();
    else if (ctx.screen === 'roundWon') startNextRound();
  }

  acc += elapsed;
  let stepped = false;
  while (acc >= STEP) {
    simStep(STEP);
    acc -= STEP;
    stepped = true;
    // Edge inputs must register in exactly one substep per frame.
    ctx.input.pumpPressed = false;
    ctx.input.throwPressed = false;
  }

  ctx.ui.update(elapsed);
  ctx.audio.update(elapsed);
  if (stepped) {
    clearFrameInput(ctx.input);
  } else {
    // No substep ran this frame (high-refresh displays): keep pump/throw
    // edges alive for the next frame so presses are never dropped.
    ctx.input.mutePressed = false;
    ctx.input.anyPressed = false;
  }
  effect.render(scene, camera);
}

ctx.ui.setScreen('title');
requestAnimationFrame(frame);
