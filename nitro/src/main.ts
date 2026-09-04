// =============================================================================
// Nitro Racing — entry point. Renderer, state machine (menu / countdown /
// racing / finished) and the wiring between race, HUD, audio, particles,
// camera and the save file.
// =============================================================================
import * as THREE from 'three';
import { setStyle } from './gfx';
import { TRACKS, trackById, type TrackId } from './tracks';
import { CARS, carById, COIN_VALUE, type CarId } from './cars';
import { Race } from './race';
import { ChaseCamera } from './camera';
import { Particles, DUST_COLORS } from './particles';
import { loadSave, saveNow, addCoins, unlockCar, recordResult, isUnlocked } from './save';
import { input, initInput, endFrame, onRestart, onMute, enableTilt, disableTilt, recalibrateTilt, tiltAvailable } from './input';
import * as hud from './hud';
import { showMenu, hideMenu, refreshMenu, showResults, hideResults, showTiltPrompt, type MenuState } from './menu';
import { initAudio, setMuted, isMuted, startMusic, stopMusic, setEngine, stopEngine, sfx } from './audio';
import { ABILITY_USES, CHECKPOINTS, COUNTDOWN_SECONDS, type RaceEvents } from './types';
import { fmtTime } from './util';

// ---- renderer / scene -------------------------------------------------------
setStyle('toon');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('app')!.appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2500);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a10);
const chase = new ChaseCamera(camera);
const particles = new Particles(scene);

function resize(): void {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

// ---- state ------------------------------------------------------------------
type State = 'menu' | 'countdown' | 'racing' | 'finished';
let state: State = 'menu';
const save = loadSave();
save.muted = isMuted();
let race: Race | null = null;
let trackId: TrackId = save.lastTrack;
let carId: CarId = save.lastCar;
let countdownLeft = 0, lastCount = -1;
let finishAt = 0;
let resultsShown = false;
let newBest = false;
let tiltAsked = save.tilt !== null;

function menuState(): MenuState {
  return {
    coins: save.coins, unlocked: save.unlocked, best: save.best,
    track: trackId, car: carId, muted: isMuted(), tilt: save.tilt, touch: input.touch,
  };
}

function toggleMute(): boolean {
  setMuted(!isMuted());
  save.muted = isMuted();
  saveNow(save);
  return save.muted;
}

async function setTilt(on: boolean): Promise<boolean> {
  if (!on) { disableTilt(); save.tilt = 'off'; saveNow(save); return false; }
  const ok = await enableTilt();
  save.tilt = ok ? 'on' : 'off';
  saveNow(save);
  return ok;
}

function openMenu(): void {
  state = 'menu';
  stopEngine();
  if (race) { race.dispose(); race = null; }
  hud.showHud(false);
  hud.setMessage('');
  hideResults();
  particles.clear();
  showMenu(menuState(), {
    onStart: (t, c) => { void beginRace(t, c); },
    onBuy: (c) => {
      const spec = carById(c);
      const ok = unlockCar(save, spec);
      if (ok) { sfx.unlock(); carId = c; save.lastCar = c; saveNow(save); }
      else sfx.click();
      refreshMenu(menuState());
      return ok;
    },
    onMute: () => { initAudio(); return toggleMute(); },
    onTilt: (on) => { void setTilt(on).then(() => refreshMenu(menuState())); },
  });
}

// ---- race -------------------------------------------------------------------
const events: RaceEvents = {
  onCoin(kind, x, y, z) {
    const v = COIN_VALUE[kind];
    addCoins(save, v);
    saveNow(save);
    sfx.coin(kind);
    particles.coinBurst(x, y, z, kind === 'gold' ? 0xffd23f : kind === 'silver' ? 0xe8f0ff : 0xffb066);
    hud.toast(`+${v}`, 600);
  },
  onHit(kind) {
    sfx.hit(kind);
    if (!race) return;
    const c = race.car;
    if (kind === 'lava') { particles.splash(c.x, c.y, c.z, 0xff6a1a); chase.shake(0.8); }
    else if (kind === 'fall') chase.shake(0.3);
    else { particles.hitBurst(c.x, c.y + 0.6, c.z); chase.shake(kind === 'oil' ? 0.35 : 0.7); }
  },
  onSmash(x, y, z) { sfx.smash(); particles.smashBurst(x, y, z); chase.shake(0.4); },
  onPad(kind) { sfx.pad(kind); hud.toast(kind === 'boost' ? 'SPEED!' : 'SLOW…', 700); if (kind === 'boost') chase.shake(0.2); },
  onCheckpoint(i, total) { sfx.checkpoint(); hud.setCheckpoint(i, total); hud.toast(`Checkpoint ${i}/${total - 1}`, 900); },
  onRespawn() { sfx.respawn(); hud.toast('Back to the checkpoint', 1200); if (race) chase.snapTo(race.car); },
  onAbility(ability, on) {
    sfx.ability(ability, on);
    if (on && race) hud.toast(race.spec.abilityName + '!', 800);
  },
  onFinish(time) {
    state = 'finished';
    finishAt = performance.now();
    resultsShown = false;
    stopEngine();
    hud.setMessage('FINISH!', 'finish');
    if (race) {
      newBest = recordResult(save, trackId, carId, time, { carId, time, frames: race.recording.slice() });
      sfx.finish(newBest);
      const c = race.car;
      particles.confetti(c.x, c.y + 2, c.z);
      if (newBest) { hud.celebrate(); hud.setBest(time); }
    }
  },
};

async function beginRace(t: TrackId, c: CarId): Promise<void> {
  initAudio();
  sfx.click();
  if (!isUnlocked(save, carById(c))) c = 'f1';
  trackId = t; carId = c;
  save.lastTrack = t; save.lastCar = c; saveNow(save);

  // first race on a phone: offer tilt steering (permission needs a gesture)
  if (input.touch && !tiltAsked && tiltAvailable()) {
    tiltAsked = true;
    hideMenu();
    const on = await showTiltPrompt(() => setTilt(true));
    if (!on && save.tilt === null) { save.tilt = 'off'; saveNow(save); }
  } else if (input.touch && save.tilt === 'on' && !input.tilt) {
    await setTilt(true);
  }
  startRace();
}

function startRace(): void {
  hideMenu(); hideResults();
  if (race) race.dispose();
  particles.clear();
  const def = trackById(trackId);
  const spec = carById(carId);
  race = new Race(scene, def, spec, save.ghosts[trackId] ?? null, events);
  chase.snapTo(race.car);
  state = 'countdown';
  countdownLeft = COUNTDOWN_SECONDS + 0.4;
  lastCount = -1;
  hud.showHud(true);
  hud.setBest(save.best[trackId]?.time ?? null);
  hud.setGhostDelta(null);
  hud.setCheckpoint(0, CHECKPOINTS);
  hud.setCoins(0, save.coins);
  hud.setAbility(spec.abilityName, ABILITY_USES, false, 0, spec.abilityTime);
  hud.setTime(0);
  hud.setMessage('');
  startMusic(trackId);
  recalibrateTilt();
}

function updateCountdown(dt: number): void {
  countdownLeft -= dt;
  const n = Math.ceil(countdownLeft);
  if (n > 0 && n <= COUNTDOWN_SECONDS && n !== lastCount) {
    lastCount = n;
    hud.setMessage(String(n), 'count');
    sfx.countdown(n);
  }
  if (countdownLeft <= 0 && race && !race.started) {
    hud.setMessage('GO!', 'go');
    sfx.countdown(0);
    race.start();
    recalibrateTilt();
    state = 'racing';
    setTimeout(() => { if (state === 'racing') hud.setMessage(''); }, 900);
  }
}

// ---- loop -------------------------------------------------------------------
let last = performance.now();
const back = new THREE.Vector3();
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (race) {
    if (state === 'countdown') updateCountdown(dt);
    race.update(dt, input, now);   // consumes input.abilityPressed
    const c = race.car;

    // HUD
    hud.setSpeed(Math.abs(c.speed));
    hud.setTime(race.time);
    hud.setGhostDelta(race.ghostDelta === null ? null : -race.ghostDelta);
    hud.setAbility(race.spec.abilityName, race.abilityUses, race.abilityActive, race.abilityTimeLeft, race.spec.abilityTime);
    hud.setCoins(race.coinsThisRun, save.coins);

    // sound + particles
    if (state === 'racing') setEngine(Math.abs(c.speed) / race.spec.topSpeed, input.throttle, c.boosting);
    else if (state === 'countdown') setEngine(0, input.throttle, false);
    const sp = Math.abs(c.speed);
    if (c.surface !== 'air' && c.surface !== 'falling' && sp > 6) {
      const drifting = Math.abs(c.lateral) > 3;
      if (c.surface === 'off' || drifting || Math.random() < 0.25) {
        back.set(Math.sin(c.heading), 0, Math.cos(c.heading));
        particles.dust(c.x + back.x * 1.5, c.y + 0.2, c.z + back.z * 1.5, back.x, back.z,
          c.surface === 'off' ? 'off' : 'road', DUST_COLORS[trackId] ?? 0xbfc4cf);
      }
    }
    if (c.boosting) {
      back.set(Math.sin(c.heading), 0, Math.cos(c.heading));
      particles.boostFlames(c.x + back.x * 2.2, c.y + 0.7, c.z + back.z * 2.2, back.x, back.z);
    }

    chase.update(c, dt, { boosting: c.boosting, airborne: c.surface === 'air', finished: state === 'finished' });
    race.updateNearFade(camera, dt);

    if (state === 'finished' && !resultsShown && now - finishAt > 2400) {
      resultsShown = true;
      showResults({
        time: race.time, best: save.best[trackId]?.time ?? race.time, newBest,
        coins: race.coinsThisRun, banked: save.coins,
      }, {
        onAgain: () => { sfx.click(); startRace(); },
        onMenu: () => { sfx.click(); stopMusic(); openMenu(); },
      });
    }
  }
  endFrame();                      // edge flags live for exactly one frame
  particles.update(dt);
  renderer.render(scene, camera);
}

// ---- boot -------------------------------------------------------------------
initInput();
onRestart(() => { if (race) { sfx.click(); startRace(); } });
onMute(() => { initAudio(); toggleMute(); refreshMenu(menuState()); });
addEventListener('pointerdown', () => initAudio(), { once: true });
addEventListener('keydown', () => initAudio(), { once: true });

// sanity: keep the fallback car valid
if (!CARS.some((c) => c.id === carId)) carId = 'f1';
if (!TRACKS.some((t) => t.id === trackId)) trackId = 'speedway';
openMenu();
requestAnimationFrame(frame);

// tiny dev aid: ?race=1 skips the menu
if (new URLSearchParams(location.search).has('race')) void beginRace(trackId, carId);
// keep fmtTime referenced for the console (`window.fmt`) — handy when tuning
(window as unknown as { fmt: typeof fmtTime }).fmt = fmtTime;
