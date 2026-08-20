// Circle the Wagons — composition root and ALL game rules.
import * as THREE from 'three';
import { applyEnvironment, applyLook, camera, cameraKick, canvas, forward, pitch, renderer, scene, setGroundTextures, updateForward, updateKick, yaw, yawAngle, yawObj } from './gfx';
import { loadHDR, loadManifest, loadModel, loadTexture, media, withProgress } from './assets';
import { buildRing } from './ring';
import { initPhysics, stepPhysics } from './ragdoll';
import { activeRiderCount, assistTarget, clearRiders, fellRider, initRiders, riders, shootRay, spawnRider, updateRiders, type Rider } from './riders';
import { feedSway, gun, gunEvents, gunRandomSpread, initGuns, startReload, swapGun, tryFire, updateGuns } from './guns';
import { calibrateGyro, consume, exitLock, gyroAvailable, gyroLook, gyroPref, input, requestLock, setGyro } from './input';
import { dust, updateParticles } from './particles';
import { audio, type LoopHandle } from './audio';
import * as ui from './ui';
import { AIM_ASSIST, BEST_KEY, BREATHER_TIME, GYRO_KEY, GYRO_SWAY, HEARTS, KEY_TURN_SPEED, PITCH_LIMIT, State, raidParams } from './constants';
import { angDiff, clamp, loadStr, saveStr, rand } from './util';

// ------------------------------------------------------------ game state
let state: State = State.LOADING;
let hearts = HEARTS;
let score = 0, streak = 0, best = parseInt(loadStr(BEST_KEY, '0')) || 0;
let raidNo = 0;
let raid = { count: 0, spawned: 0, concurrent: 0, spawnTimer: 0, params: raidParams(1) };
let breatherTimer = 0;
let paused = false;
let hadLock = false; // pointer lock acquired at least once this run (pause only after losing it)
let demo = false; // riders circling behind the title

// ------------------------------------------------------------ audio helpers
function panFor(r: Rider) {
  const rel = angDiff(yawAngle(yaw.value), r.angle);      // >0 => to the left
  return { pan: clamp(-Math.sin(rel), -1, 1), dist: clamp((r.radius - 8) / 45, 0, 1) };
}
const gallops = new Map<Rider, LoopHandle>();
let wind: LoopHandle | null = null;
function updateRiderAudio() {
  // gallop loops for the nearest few riders, panned by position
  const live = riders.filter(r => r.state !== 'gone').sort((a, b) => a.radius - b.radius).slice(0, 5);
  for (const [r, h] of gallops) if (!live.includes(r)) { h.stop(0.4); gallops.delete(r); }
  for (const r of live) {
    let h = gallops.get(r);
    if (!h) { h = audio.loop('gallop', { vol: 0.0, rate: rand(0.95, 1.05) }); gallops.set(r, h); }
    const { pan, dist } = panFor(r);
    h.setPan(pan); h.setVol(0.55 * (1 - dist) * (r.state === 'fallen' ? 0.6 : 1));
    h.setRate(clamp(r.speed / 11, 0.8, 1.4));
  }
}
function stopAllGallops() { for (const h of gallops.values()) h.stop(0.3); gallops.clear(); }

// ------------------------------------------------------------ flow
function showTitle() {
  state = State.TITLE;
  exitLock();
  ui.showTitle(best);
  ui.hideBanner();
  clearRiders(); stopAllGallops();
  // a few riders circle peacefully behind the title
  demo = true;
  for (let i = 0; i < 3; i++) spawnRider({ speed: 10, reverse: i === 1, hanger: false, aimTime: 1e9, aimGap: 1e9, behindChance: 0 });
  for (const r of riders) { r.radius = r.laneRadius; r.state = 'riding'; r.aimCooldown = 1e9; r.place(); }
}
function startRun() {
  audio.init();
  clearRiders(); stopAllGallops(); demo = false;
  hearts = HEARTS; score = 0; streak = 0; raidNo = 0;
  ui.showHud(); ui.setHearts(hearts); ui.setScore(score, streak);
  pitch.value = 0;
  calibrateGyro(yaw.value, 0); // wherever the phone points now is where the run starts looking
  state = State.PLAYING;
  hadLock = false; paused = false;
  requestLock();
  startRaid(1);
  if (!wind) wind = audio.loop('wind', { vol: 0.1 });
}
function startRaid(n: number) {
  raidNo = n;
  const p = raidParams(n);
  raid = { count: p.count, spawned: 0, concurrent: p.concurrent, spawnTimer: 0.8, params: p };
  ui.setRaid(n);
  ui.banner(`Raid ${n}`, n === 1 ? 'They’re coming. Shoot them before they shoot you.' : `${p.count} riders`, 2.4);
  audio.play('sting', { vol: 0.6 });
  state = State.PLAYING;
}
function raidCleared() {
  state = State.BREATHER;
  breatherTimer = BREATHER_TIME;
  hearts = HEARTS; ui.setHearts(hearts);
  ui.banner(`Raid ${raidNo} cleared`, 'Hearts restored — catch your breath', BREATHER_TIME - 0.5);
  audio.play('whinny', { vol: 0.35, dist: 0.6, pan: rand(-0.6, 0.6) });
}
function runOver() {
  state = State.OVER;
  exitLock();
  const isNew = score > best;
  if (isNew) { best = score; saveStr(BEST_KEY, String(best)); }
  ui.showOver(score, best, isNew);
  audio.play('over', { vol: 0.7 });
  stopAllGallops();
  if (wind) { wind.stop(1.5); wind = null; }
}

// ------------------------------------------------------------ shooting
const rayOrigin = new THREE.Vector3();
const rayDir = new THREE.Vector3();
const RIGHT = new THREE.Vector3();
const UPV = new THREE.Vector3(0, 1, 0);
function fire() {
  const res = tryFire();
  if (!res.ok) {
    if (res.reason === 'dry') audio.play(gun.kind === 'revolver' ? 'reload' : 'dry', { vol: 0.5 });
    return;
  }
  audio.play(gun.kind === 'rifle' ? 'rifle' : 'revolver', { vol: 1.3 });
  cameraKick(gun.kind === 'rifle' ? 1.1 : 0.75);
  // the look was just updated this frame; make the camera matrix current before raycasting
  applyLook(); yawObj.updateWorldMatrix(false, true); updateForward();
  camera.getWorldPosition(rayOrigin);
  rayDir.copy(forward);
  if (res.spread > 0) {
    const s = gunRandomSpread(res.spread);
    RIGHT.crossVectors(forward, UPV).normalize();
    rayDir.addScaledVector(RIGHT, s.x).addScaledVector(UPV, s.y).normalize();
  }
  let hit = shootRay(rayOrigin, rayDir);
  const live = (h: typeof hit) => !!h.rider && h.rider.state !== 'fallen' && h.rider.state !== 'gone';
  if (!((hit.kind === 'rider' || hit.kind === 'horse') && live(hit))) {
    const a = assistTarget(rayOrigin, rayDir, AIM_ASSIST);
    if (a.kind === 'rider') hit = a;
  }
  if ((hit.kind === 'rider' || hit.kind === 'horse') && live(hit) && hit.rider && hit.point) {
    const viaHorse = hit.kind === 'horse';
    fellRider(hit.rider, hit.point, rayDir, !!hit.head, viaHorse);
    streak++;
    score += ui.streakMult(streak);
    ui.setScore(score, streak);
    const { pan, dist } = panFor(hit.rider);
    audio.play('thud', { vol: viaHorse ? 1.0 : 0.8, pan, dist });
    if (viaHorse || Math.random() < 0.25) audio.play('whinny', { vol: viaHorse ? 0.6 : 0.4, pan, dist });
  } else {
    if (streak > 0) { streak = 0; ui.setScore(score, streak); }
    if (hit.point) dust(hit.point, 5, 1.5); // dust/splinters where the shot landed
  }
}

// ------------------------------------------------------------ input per frame
function handleInput(dt: number) {
  // look
  let dy = input.dYaw, dp = input.dPitch;
  if (input.turnLeft) dy += KEY_TURN_SPEED * dt;
  if (input.turnRight) dy -= KEY_TURN_SPEED * dt;
  const g = gyroLook(dy, dp);
  if (g) {
    // the phone is the gun: drag has already rotated the offset inside gyroLook
    const ty = angDiff(yaw.value, g.yaw), tp = clamp(g.pitch, -PITCH_LIMIT, PITCH_LIMIT) - pitch.value;
    yaw.value += ty; pitch.value += tp;
    feedSway(dy + (ty - dy) * GYRO_SWAY, dp + (tp - dp) * GYRO_SWAY);
  } else if (dy || dp) {
    yaw.value += dy;
    pitch.value = clamp(pitch.value + dp, -PITCH_LIMIT, PITCH_LIMIT);
    feedSway(dy, dp);
  }
  if (state === State.PLAYING || state === State.BREATHER) {
    if (input.firePressed || (input.fireHeld && gun.kind === 'revolver')) fire();
    if (input.reloadPressed && startReload()) audio.play('reload', { vol: 0.6 });
    if (input.swapPressed && swapGun()) { /* cock sound on arrival */ }
  }
}

// ------------------------------------------------------------ raid update
const riderEvents = {
  onAimStart(r: Rider) { const { pan, dist } = panFor(r); audio.play('aim', { vol: 0.9, pan, dist: dist * 0.5 }); },
  onShot(r: Rider) {
    const { pan, dist } = panFor(r);
    audio.play('shot', { vol: 0.9, pan, dist: dist * 0.5 });
    if (state !== State.PLAYING) return;
    hearts--; ui.setHearts(hearts); ui.hitFlash();
    audio.play('hit', { vol: 0.9 });
    if (hearts <= 0) runOver();
  },
};
function updateRaid(dt: number) {
  if (state === State.PLAYING) {
    raid.spawnTimer -= dt;
    if (raid.spawned < raid.count && activeRiderCount() < raid.concurrent && raid.spawnTimer <= 0) {
      const p = raid.params;
      spawnRider({
        speed: 11 * p.speed, reverse: Math.random() < p.reverseChance, hanger: Math.random() < p.hangerChance,
        aimTime: p.aimTime, aimGap: p.aimGap, behindChance: p.behindChance,
      });
      raid.spawned++;
      raid.spawnTimer = rand(0.6, 1.6);
    }
    if (raid.spawned >= raid.count && activeRiderCount() === 0) raidCleared();
  } else if (state === State.BREATHER) {
    breatherTimer -= dt;
    if (breatherTimer <= 0) startRaid(raidNo + 1);
  }
}

// ------------------------------------------------------------ loop
let last = performance.now();
let titleSpin = 0;
let lastWeaponKey = '';
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;

  // pause when the pointer lock is lost mid-run on desktop
  const playing = state === State.PLAYING || state === State.BREATHER;
  if (input.locked) hadLock = true;
  const wantPause = playing && !input.touch && hadLock && !input.locked;
  if (wantPause !== paused) { paused = wantPause; if (paused) ui.banner('Paused', 'click to resume', 1e6); else ui.hideBanner(); }

  if (state === State.TITLE) {
    titleSpin += dt * 0.08; yaw.value = titleSpin; pitch.value = 0.02;
  } else if (!paused) {
    handleInput(dt);
  }
  consume();
  updateKick(dt);
  applyLook();
  updateForward();

  if (!paused) {
    updateGuns(dt);
    if (gunEvents.leverClack) audio.play('lever', { vol: 0.7 });
    if (gunEvents.swapped) { audio.play('cock', { vol: 0.6 }); }
    const wk = `${gun.kind}|${gun.rounds}|${gun.state}`;
    if (wk !== lastWeaponKey) { lastWeaponKey = wk; ui.setWeapon(gun.kind, gun.rounds, gun.state); }
    updateRiders(dt, riderEvents);
    if (!demo) updateRaid(dt);
    stepPhysics(dt);
    updateParticles(dt, scene.fog as THREE.Fog);
    if (!demo) updateRiderAudio();
  }
  renderer.render(scene, camera);
}

// ------------------------------------------------------------ boot
async function boot() {
  ui.showControls(input.touch);
  ui.setMuteLabel(audio.muted);
  ui.el.btnMute.addEventListener('click', () => { audio.init(); audio.setMuted(!audio.muted); ui.setMuteLabel(audio.muted); });
  // Gyro aiming: needs a gesture on iOS, so it's enabled from taps — the
  // toggle, or the one-time "aim by turning your phone?" card on first start.
  const enableGyro = async () => { const on = await setGyro(true); if (on) calibrateGyro(yaw.value, pitch.value); ui.setGyroLabel(on, input.gyroBlocked); return on; };
  if (gyroAvailable()) {
    ui.showGyroButton();
    ui.el.btnGyro.addEventListener('click', async () => { if (input.gyro) { await setGyro(false); ui.setGyroLabel(false, false); } else await enableGyro(); });
  }
  ui.el.btnStart.addEventListener('click', async () => {
    if (gyroAvailable() && !input.gyro) {
      const pref = gyroPref();
      if (pref === null) { ui.el.gyroAsk.classList.remove('hidden'); return; }
      if (pref === 'on') await enableGyro();
    }
    startRun();
  });
  ui.el.btnGyroYes.addEventListener('click', async () => { ui.el.gyroAsk.classList.add('hidden'); await enableGyro(); startRun(); });
  ui.el.btnGyroNo.addEventListener('click', () => { ui.el.gyroAsk.classList.add('hidden'); saveStr(GYRO_KEY, '0'); startRun(); });
  ui.el.btnAgain.addEventListener('click', startRun);
  ui.el.btnMenu.addEventListener('click', showTitle);
  ui.el.btnCredits.addEventListener('click', () => ui.el.credits.classList.remove('hidden'));
  ui.el.btnCreditsClose.addEventListener('click', () => ui.el.credits.classList.add('hidden'));
  ui.fillCredits();
  canvas.addEventListener('mousedown', () => {
    if ((state === State.PLAYING || state === State.BREATHER) && !input.locked) requestLock();
  });
  window.addEventListener('keydown', e => { if (e.code === 'Enter' && state === State.TITLE && !ui.el.startRow.classList.contains('hidden')) startRun(); });

  await loadManifest();
  const results = await withProgress([
    () => loadHDR('hdri/plains_sunset_2k.hdr'),
    () => loadTexture('tex/grass_diff.jpg', true), () => loadTexture('tex/grass_nor.jpg'), () => loadTexture('tex/grass_rough.jpg'),
    () => loadTexture('tex/dirt_diff.jpg', true), () => loadTexture('tex/dirt_nor.jpg'), () => loadTexture('tex/dirt_rough.jpg'),
    () => loadModel('models/horse.glb'), () => loadModel('models/rider.glb'),
    () => loadModel('models/stagecoach.glb'), () => loadModel('models/stagecoach2.glb'),
    () => loadModel('models/rifle.glb'), () => loadModel('models/revolver.glb'),
    () => initPhysicsLater(),
    () => audio.load(media.base, media.files.filter(f => f.startsWith('sfx/'))),
  ] as (() => Promise<any>)[], ui.setLoading);
  const [hdr, gDiff, gNor, gRough, dDiff, dNor, dRough, horse, rider, coach1, coach2, rifle, revolver] = results;
  applyEnvironment(hdr);
  setGroundTextures({ diff: gDiff, nor: gNor, rough: gRough }, { diff: dDiff, nor: dNor, rough: dRough });
  buildRing([coach1, coach2]);
  await initPhysics();
  initGuns(rifle, revolver);
  initRiders(horse, rider);
  ui.loadingDone();
  showTitle();
  requestAnimationFrame(frame);
}
// physics needs the ring's blockers, so it's created after buildRing; this
// just keeps the progress bar honest about the WASM download.
async function initPhysicsLater() { return null; }

boot().catch(e => { console.error(e); ui.el.loading.textContent = 'Something broke while loading. ' + e; });
