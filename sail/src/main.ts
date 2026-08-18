import * as THREE from 'three';
import { AiSkipper, burdenedOf } from './ai';
import { Boat } from './boat';
import { Course, COURSE_INFO, type CourseType } from './course';
import { FishShadows } from './fish';
import { Spray } from './spray';
import { Hud } from './hud';
import { AI_COLORS, BOAT_SPECS, type HullType } from './specs';
import { clamp, damp, formatTime } from './util';
import { Water } from './water';
import { Whitecaps } from './whitecaps';
import { Wind } from './wind';
import { WindLines } from './windlines';

type GameState = 'menu' | 'countdown' | 'racing' | 'finished';

// ---------------------------------------------------------------------------
// renderer / scene
// ---------------------------------------------------------------------------
const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.classList.add('game');
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x06283d);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 1, 900);

// lighting — bright arcade afternoon
scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x0a3a52, 0.85));
const sun = new THREE.DirectionalLight(0xfff2d8, 1.9);
sun.position.set(60, 110, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -70;
sun.shadow.camera.right = 70;
sun.shadow.camera.top = 70;
sun.shadow.camera.bottom = -70;
sun.shadow.camera.far = 320;
sun.shadow.bias = -0.0005;
scene.add(sun);
scene.add(sun.target);

// world
const wind = new Wind();
const course = new Course('wl');
scene.add(course.group);
const water = new Water(course.islands);
scene.add(water.mesh);
const windLines = new WindLines();
scene.add(windLines.ribbons.mesh);
const fish = new FishShadows();
scene.add(fish.group);
const spray = new Spray();
scene.add(spray.points);
const whitecaps = new Whitecaps(course.islands);
scene.add(whitecaps.points);

const PRESTART = 15; // seconds of live sailing before the gun
const COMMITTEE_BUBBLE = 100; // hud.say key for the committee boat

// ---------------------------------------------------------------------------
// fleet
// ---------------------------------------------------------------------------
const hud = new Hud();
// dev/demo autopilot: load with ?auto=1 and the player boat sails itself
const autoPilot = new URLSearchParams(location.search).has('auto');
let playerType: HullType = 'cat';
let player!: Boat;
let boats: Boat[] = [];
let skippers: AiSkipper[] = [];
let playerSkipper: AiSkipper | null = null;

function buildFleet(): void {
  for (const b of boats) {
    scene.remove(b.group, b.sailHolder, b.wake.mesh);
  }
  boats = [];
  skippers = [];

  player = new Boat(BOAT_SPECS[playerType]);
  boats.push(player);
  playerSkipper = autoPilot ? new AiSkipper(player, 1.5) : null;

  const aiTypes: HullType[] = (['mono', 'cat', 'tri'] as HullType[]).sort(
    (a, b) => (a === playerType ? 1 : 0) - (b === playerType ? 1 : 0),
  );
  for (let i = 0; i < 3; i++) {
    const ai = new Boat(BOAT_SPECS[aiTypes[i % aiTypes.length]!], AI_COLORS[i]);
    boats.push(ai);
    skippers.push(new AiSkipper(ai, i - 1));
  }

  for (const b of boats) {
    scene.add(b.group, b.sailHolder, b.wake.mesh);
  }
  if (playerSkipper) playerSkipper.fleet = boats;
  for (const s of skippers) s.fleet = boats;

  const spawns = course.spawnPositions(boats.length);
  boats.forEach((b, i) => b.place(spawns[i]!.x, spawns[i]!.z, spawns[i]!.heading));
  course.resetTracking();
}

// ---------------------------------------------------------------------------
// input
// ---------------------------------------------------------------------------
const keys = new Set<string>();
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  keys.add(e.key.toLowerCase());
  if (e.key.toLowerCase() === 'r' && state !== 'menu') startRace();
  if ((e.key === 'Enter' || e.key === ' ') && state === 'menu') {
    startRace();
    return;
  }
  if (e.key === 'Enter' && state === 'finished') startRace();
  if (e.key === 'Escape' && state !== 'menu') toMenu();
  if (e.key === ' ' && !autoPilot && (state === 'countdown' || state === 'racing')) {
    player.toggleSpinnaker();
    hud.toast(player.spinUp ? 'HOISTING SPINNAKER' : 'DOUSING SPINNAKER', 1100);
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));

function readPlayerInput(): void {
  // screen-right is world -X from this camera, so heading-increase (+steer)
  // reads as a LEFT turn on screen — map the keys to screen direction
  let steer = 0;
  if (keys.has('arrowleft') || keys.has('a')) steer += 1;
  if (keys.has('arrowright') || keys.has('d')) steer -= 1;
  player.steer = steer;
  let trim = 0;
  if (keys.has('arrowup') || keys.has('w')) trim -= 1; // sheet in
  if (keys.has('arrowdown') || keys.has('s')) trim += 1; // ease out
  player.trimInput = trim;
}

// ---------------------------------------------------------------------------
// menu
// ---------------------------------------------------------------------------
const menuEl = document.getElementById('menu')!;
const resultsEl = document.getElementById('results')!;
const fleetEl = document.getElementById('fleet')!;

function buildMenu(): void {
  fleetEl.innerHTML = '';
  (Object.keys(BOAT_SPECS) as HullType[]).forEach((type, i) => {
    const spec = BOAT_SPECS[type];
    const card = document.createElement('div');
    card.className = 'boat-card' + (type === playerType ? ' selected' : '');
    card.innerHTML = `
      <div class="key">${i + 1}</div>
      <h3 style="color:#${spec.color.toString(16).padStart(6, '0')}">${spec.name}</h3>
      <div class="type">${spec.typeLabel}</div>
      <div class="stat"><span class="name">SPEED</span><span class="bar"><i style="width:${spec.stats.speed * 100}%"></i></span></div>
      <div class="stat"><span class="name">ACCEL</span><span class="bar"><i style="width:${spec.stats.accel * 100}%"></i></span></div>
      <div class="stat"><span class="name">AGILITY</span><span class="bar"><i style="width:${spec.stats.handling * 100}%"></i></span></div>
    `;
    card.addEventListener('click', () => selectBoat(type));
    fleetEl.appendChild(card);
  });
}

function selectBoat(type: HullType): void {
  playerType = type;
  document.querySelectorAll('.boat-card').forEach((c, i) => {
    c.classList.toggle('selected', (Object.keys(BOAT_SPECS) as HullType[])[i] === type);
  });
  buildFleet();
}

window.addEventListener('keydown', (e) => {
  if (state !== 'menu') return;
  const types = Object.keys(BOAT_SPECS) as HullType[];
  const i = ['1', '2', '3'].indexOf(e.key);
  if (i >= 0 && types[i]) selectBoat(types[i]!);
});

function buildCoursePicker(): void {
  const el = document.getElementById('course-picker')!;
  el.innerHTML = '';
  (Object.keys(COURSE_INFO) as CourseType[]).forEach((type) => {
    const chip = document.createElement('div');
    chip.className = 'course-chip' + (type === course.type ? ' selected' : '');
    chip.textContent = `${COURSE_INFO[type].name} × ${COURSE_INFO[type].laps} LAPS`;
    chip.addEventListener('click', () => {
      course.setLayout(type);
      buildFleet();
      buildCoursePicker();
    });
    el.appendChild(chip);
  });
}

document.getElementById('start-btn')!.addEventListener('click', startRace);
buildMenu();
buildCoursePicker();

// ---------------------------------------------------------------------------
// race state
// ---------------------------------------------------------------------------
let state: GameState = 'menu';
let raceTime = 0;
let countdown = 0;
let elapsed = 0;

function toMenu(): void {
  state = 'menu';
  menuEl.classList.remove('hidden');
  resultsEl.classList.remove('visible');
  hud.setVisible(false);
  buildFleet();
}

function startRace(): void {
  const spawns = course.spawnPositions(boats.length);
  boats.forEach((b, i) => b.place(spawns[i]!.x, spawns[i]!.z, spawns[i]!.heading));
  course.resetTracking();
  raceTime = 0;
  countdown = PRESTART;
  state = 'countdown';
  menuEl.classList.add('hidden');
  resultsEl.classList.remove('visible');
  hud.setVisible(true);
  hud.clearBubbles();
  hailCooldown.clear();
  hud.toast('PRE-START — don’t cross the line before the gun!', 3000);
}

function finishRace(): void {
  state = 'finished';
  hud.showMessage('FINISH!', 2200);
  const table = document.getElementById('results-table')!;
  const rows = [...boats].sort((a, b) => course.progress(b) - course.progress(a));
  table.innerHTML =
    '<tr><th>#</th><th>BOAT</th><th>CLASS</th><th>TIME</th><th>BEST LAP</th></tr>' +
    rows
      .map((b, i) => {
        const you = b === player ? ' class="you"' : '';
        const time = b.finished ? formatTime(b.finishTime) : '—';
        const best = b.bestLap < Infinity ? formatTime(b.bestLap) : '—';
        return `<tr${you}><td>${i + 1}</td><td>${b === player ? 'YOU' : 'RIVAL ' + i}</td><td>${b.spec.typeLabel}</td><td>${time}</td><td>${best}</td></tr>`;
      })
      .join('');
  document.getElementById('results-title')!.textContent =
    rows[0] === player ? 'YOU WIN! 🏆' : 'FINISH!';
  window.setTimeout(() => resultsEl.classList.add('visible'), 1400);
}

// ---------------------------------------------------------------------------
// collisions
// ---------------------------------------------------------------------------
function resolveCollisions(): void {
  // boat vs island (and the anchored committee boat)
  const obstacles = [
    ...course.islands,
    { x: course.committeePos.x, z: course.committeePos.z, r: 2.2 },
  ];
  for (const b of boats) {
    for (const isl of obstacles) {
      const dx = b.pos.x - isl.x;
      const dz = b.pos.z - isl.z;
      const d = Math.hypot(dx, dz);
      const min = isl.r + 1.6;
      if (d < min && d > 1e-4) {
        const nx = dx / d;
        const nz = dz / d;
        b.pos.x = isl.x + nx * min;
        b.pos.z = isl.z + nz * min;
        const into = b.vel.x * nx + b.vel.z * nz;
        if (into < 0) {
          b.vel.x -= nx * into;
          b.vel.z -= nz * into;
        }
        b.vel.multiplyScalar(0.92);
      }
    }
    // soft world bounds
    const B = 240;
    b.pos.x = clamp(b.pos.x, -B, B);
    b.pos.z = clamp(b.pos.z, -B, B);
  }
  // boat vs boat
  for (let i = 0; i < boats.length; i++) {
    for (let j = i + 1; j < boats.length; j++) {
      const a = boats[i]!;
      const b = boats[j]!;
      const dx = b.pos.x - a.pos.x;
      const dz = b.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      const min = (a.spec.length + b.spec.length) * 0.34;
      if (d < min && d > 1e-4) {
        const push = (min - d) / 2;
        const nx = dx / d;
        const nz = dz / d;
        a.pos.x -= nx * push;
        a.pos.z -= nz * push;
        b.pos.x += nx * push;
        b.pos.z += nz * push;
        a.vel.multiplyScalar(0.985);
        b.vel.multiplyScalar(0.985);

        // racing rules: contact penalizes the boat that had to keep clear
        if (state === 'racing' || state === 'countdown') {
          const closing = Math.hypot(a.vel.x - b.vel.x, a.vel.z - b.vel.z);
          const guilty = burdenedOf(a, b, wind.from);
          const other = guilty === a ? b : a;
          if (closing > 1 && guilty.penalty <= 0 && other.penalty <= 0) {
            guilty.penalty = 3.5;
            hud.say(boats.indexOf(guilty), 'SORRY!', elapsed, 1.6);
            hud.say(boats.indexOf(other), 'PROTEST!', elapsed, 1.6);
            if (guilty === player) hud.toast('PENALTY — you had to keep clear! (3.5s)', 2800);
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// right-of-way hails — starboard-tack boat yells at converging port-tackers
// ---------------------------------------------------------------------------
const hailCooldown = new Map<Boat, number>();

function updateHails(): void {
  if (state !== 'racing' && state !== 'countdown' && state !== 'finished') return;
  for (let i = 0; i < boats.length; i++) {
    for (let j = 0; j < boats.length; j++) {
      if (i === j) continue;
      const s = boats[i]!; // candidate yeller (starboard tack)
      const p = boats[j]!;
      // starboard tack = wind over the starboard (-X for a +Z heading) side,
      // which is windSide === -1 in boat.ts's sign convention
      if (s.windSide !== -1 || p.windSide !== 1) continue;
      if (s.speed < 1.5 || p.speed < 1.5) continue;
      const dx = p.pos.x - s.pos.x;
      const dz = p.pos.z - s.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 26 || d < 3) continue;
      // converging: closing speed along the line between them
      const rvx = p.vel.x - s.vel.x;
      const rvz = p.vel.z - s.vel.z;
      const closing = -(rvx * dx + rvz * dz) / d;
      if (closing < 1.2) continue;
      const last = hailCooldown.get(s) ?? -99;
      if (elapsed - last < 7) continue;
      hailCooldown.set(s, elapsed);
      hud.say(i, 'STARBOARD!', elapsed);
    }
  }
}

// ---------------------------------------------------------------------------
// camera — angled top-down chase, world-locked orientation (no horizon)
// ---------------------------------------------------------------------------
const camTarget = new THREE.Vector3();
const CAM_OFFSET = new THREE.Vector3(12, 44, -27); // slight side offset for depth

function updateCamera(dt: number): void {
  const lead = 1.1;
  const tx = player.pos.x + player.vel.x * lead;
  const tz = player.pos.z + player.vel.z * lead;
  camTarget.x = damp(camTarget.x, tx, 2.4, dt);
  camTarget.z = damp(camTarget.z, tz, 2.4, dt);
  // pull back a touch at speed
  const zoom = 1 + clamp(Math.abs(player.speed) / 14, 0, 0.35);
  camera.position.set(
    camTarget.x + CAM_OFFSET.x * zoom,
    CAM_OFFSET.y * zoom,
    camTarget.z + CAM_OFFSET.z * zoom,
  );
  camera.lookAt(camTarget.x, 0, camTarget.z);

  // sun + shadow frustum follow the player
  sun.position.set(camTarget.x + 60, 110, camTarget.z + 40);
  sun.target.position.set(camTarget.x, 0, camTarget.z);
}

// ---------------------------------------------------------------------------
// main loop
// ---------------------------------------------------------------------------
const STEP = 1 / 60;
let acc = 0;
let last = performance.now();

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dtReal = Math.min((now - last) / 1000, 0.1);
  last = now;
  acc += dtReal;

  let steps = 0;
  while (acc >= STEP && steps < 4) {
    tick(STEP);
    acc -= STEP;
    steps++;
  }

  updateCamera(dtReal);
  water.update(elapsed, camTarget, wind.direction);
  whitecaps.update(dtReal, elapsed, camTarget, wind);
  windLines.update(dtReal, wind, camTarget);
  fish.update(dtReal, elapsed, camTarget);
  updateMarkPointer();
  // anchor speech bubbles above their boats
  for (let i = 0; i < boats.length; i++) {
    const b = boats[i]!;
    _mp1.set(b.pos.x, b.spec.mastHeight * 0.85, b.pos.z).project(camera);
    hud.positionBubble(i, ((_mp1.x + 1) / 2) * window.innerWidth, ((1 - _mp1.y) / 2) * window.innerHeight, elapsed);
  }
  _mp1.set(course.committeePos.x, 7, course.committeePos.z).project(camera);
  hud.positionBubble(
    COMMITTEE_BUBBLE,
    ((_mp1.x + 1) / 2) * window.innerWidth,
    ((1 - _mp1.y) / 2) * window.innerHeight,
    elapsed,
  );
  renderer.render(scene, camera);
}

// arrow orbiting the player that points at the next mark (start line during
// the pre-start and while OCS)
const _mp1 = new THREE.Vector3();
const _mp2 = new THREE.Vector3();
function updateMarkPointer(): void {
  const show = state === 'countdown' || (state === 'racing' && !player.finished);
  if (!show) {
    hud.updateMarkPointer(false, 0, 0, 0, 0, 0);
    return;
  }
  const target =
    state === 'countdown' || player.ocs ? course.startGate.center : course.gates[player.nextGate]!.center;
  _mp1.set(player.pos.x, 0, player.pos.z).project(camera);
  _mp2.copy(target).project(camera);
  const W = window.innerWidth;
  const H = window.innerHeight;
  const px = ((_mp1.x + 1) / 2) * W;
  const py = ((1 - _mp1.y) / 2) * H;
  let dx = (_mp2.x - _mp1.x) * W;
  let dy = -(_mp2.y - _mp1.y) * H;
  const len = Math.hypot(dx, dy) || 1;
  dx /= len;
  dy /= len;
  const dist = Math.hypot(target.x - player.pos.x, target.z - player.pos.z);
  hud.updateMarkPointer(true, px, py, dx, dy, dist);
}

function tick(dt: number): void {
  elapsed += dt;
  wind.update(dt);

  if (state === 'countdown') {
    const prevN = Math.ceil(countdown);
    countdown -= dt;
    const n = Math.ceil(countdown);
    if (countdown <= 0) {
      state = 'racing';
      hud.showMessage('GO!', 700);
      hud.say(COMMITTEE_BUBBLE, 'GO! GO! GO!', elapsed, 2.0);
      // racing rule: anyone on the course side at the gun is OCS
      for (const b of boats) {
        if (course.startLineSide(b) >= 0) {
          b.ocs = true;
          if (b === player) hud.toast('OCS! Return behind the start line ⟲', 3500);
        }
      }
    } else if (n !== prevN && n <= 5) {
      // committee hails the final seconds
      hud.say(COMMITTEE_BUBBLE, `${n}!`, elapsed, 0.85);
    } else if (n !== prevN && n === 10) {
      hud.say(COMMITTEE_BUBBLE, '10 SECONDS!', elapsed, 1.4);
    }
  }
  course.updateFlags(dt, state === 'countdown' || state === 'menu', elapsed);

  const racing = state === 'racing' || state === 'finished';
  if (racing) raceTime += dt;

  // player + AI control — everyone sails during the pre-start too
  if (state === 'countdown') {
    if (playerSkipper) playerSkipper.preStart(dt, wind, course, elapsed, countdown);
    else readPlayerInput();
    for (const s of skippers) s.preStart(dt, wind, course, elapsed, countdown);
  } else if (racing) {
    if (playerSkipper) playerSkipper.update(dt, wind, course, elapsed);
    else readPlayerInput();
    for (const s of skippers) s.update(dt, wind, course, elapsed);
  } else {
    for (const b of boats) {
      b.steer = 0;
      b.trimInput = 0;
      b.vel.multiplyScalar(0.9);
    }
  }

  for (const b of boats) {
    b.update(dt, wind, elapsed);
    // clear OCS once the boat dips back behind the line
    if (racing && b.ocs && course.startLineSide(b) < -1) {
      b.ocs = false;
      course.forget(b);
      if (b === player) hud.toast('Cleared — race on!', 1800);
    }
    if (racing && !b.finished) {
      const ev = course.track(b, raceTime);
      if (b === player) {
        if (ev === 'gate') hud.toast(`MARK ${b.nextGate} / ${course.gates.length}`, 900);
        if (ev === 'lap')
          hud.toast(
            b.lap === course.totalLaps
              ? `FINAL LAP — best ${formatTime(b.bestLap)}`
              : `LAP ${b.lap} — best ${formatTime(b.bestLap)}`,
            2000,
          );
        if (ev === 'finish') finishRace();
      } else if (ev === 'finish' && state === 'racing') {
        hud.toast('A rival has finished!', 1500);
      }
    }
  }

  resolveCollisions();
  updateHails();
  for (const b of boats) spray.emitFromBoat(b);
  spray.update(dt);
  const beaconGate =
    state === 'countdown' || player.ocs ? course.gates.length - 1 : player.nextGate;
  course.updateBeacon(beaconGate, elapsed);

  if (state !== 'menu') {
    const sorted = [...boats].sort((a, b) => course.progress(b) - course.progress(a));
    const position = sorted.indexOf(player) + 1;
    // screen "up" is the horizontal direction the camera looks along
    const screenYaw = Math.atan2(-CAM_OFFSET.x, -CAM_OFFSET.z);
    const clock = state === 'countdown' ? -countdown : raceTime;
    hud.update(player, boats, wind, clock, position, course, screenYaw);
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

buildFleet();
camTarget.set(player.pos.x, 0, player.pos.z);
// headless testing: ?race=1 skips the menu and starts immediately
// (display:none — the opacity fade never finishes under headless virtual time)
if (new URLSearchParams(location.search).has('race')) {
  menuEl.style.display = 'none';
  startRace();
}
requestAnimationFrame(frame);

// dev hook for headless testing
(window as unknown as Record<string, unknown>).__regatta = {
  get heading() {
    return player.heading;
  },
  get speed() {
    return player.speed;
  },
  get luffing() {
    return player.luffing;
  },
};
