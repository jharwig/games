// =============================================================================
// visual style preview (dev-only, not built): drives each car slowly around
// each track so the look can be judged before gameplay is written.
// =============================================================================
import * as THREE from 'three';
import { TRACKS, buildTrack, type BuiltTrack, type TrackId } from './tracks';
import { CARS, buildCar, buildCoin, type CarModel, type CarId } from './cars';
import { buildScenery, buildObstacle, buildPad, fogFor, type Scenery, type ObstacleKind } from './scenery';
import { setStyle, type Style } from './gfx';
import { seeded } from './util';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('app')!.appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2500);

let scene = new THREE.Scene();
let track: BuiltTrack, scenery: Scenery, car: CarModel;
let trackId: TrackId = 'speedway', carId: CarId = 'f1', style: Style = 'toon';
let driving = true, u = 0;
const coins: THREE.Mesh[] = [];

const OBST: Record<TrackId, ObstacleKind[]> = {
  speedway: ['cone', 'oil', 'tyres'], beach: ['dune', 'rock'], dirt: ['rock', 'oil'],
  ice: ['crack', 'rock'], volcano: ['lava', 'rock'], space: ['asteroid'],
};

function build(): void {
  setStyle(style);
  scene = new THREE.Scene();
  const def = TRACKS.find((t) => t.id === trackId)!;
  track = buildTrack(def);
  scene.add(track.group);
  scenery = buildScenery(track);
  scene.add(scenery.group);
  scene.fog = fogFor(def);
  car = buildCar(CARS.find((c) => c.id === carId)!);
  scene.add(car.group);
  // sprinkle pickups / obstacles / pads along the road so the look is complete
  coins.length = 0;
  const rnd = seeded(42);
  const n = track.samples.length;
  for (let i = 0; i < n; i += 9) {
    const s = track.samples[i];
    if (i % 63 === 0) {
      const kinds = OBST[trackId];
      const o = buildObstacle(kinds[Math.floor(rnd() * kinds.length)], rnd);
      o.position.add(s.p.clone().addScaledVector(s.n, (rnd() - 0.5) * def.width * 0.6));
      scene.add(o);
    } else if (i % 45 === 0) {
      const pad = buildPad(rnd() > 0.4 ? 'boost' : 'slow');
      pad.position.copy(s.p).addScaledVector(s.n, (rnd() - 0.5) * def.width * 0.5);
      pad.rotation.y = Math.atan2(-s.t.x, -s.t.z);
      scene.add(pad);
    } else if (rnd() < 0.55) {
      const r = rnd();
      const c = buildCoin(r < 0.72 ? 'bronze' : r < 0.92 ? 'silver' : 'gold');
      c.position.copy(s.p).addScaledVector(s.n, (rnd() - 0.5) * def.width * 0.7);
      c.position.y += 1.2;
      scene.add(c); coins.push(c);
    }
  }
  u = 0;
}

const fwd = new THREE.Vector3(), camPos = new THREE.Vector3(), look = new THREE.Vector3();
let last = performance.now(), wheelSpin = 0;
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const t = now / 1000;
  const speed = driving ? 24 : 0;
  u = (u + (speed * dt) / track.length) % 1;
  const p = track.curve.getPointAt(u);
  track.curve.getTangentAt(u, fwd);
  car.group.position.copy(p);
  car.group.rotation.y = Math.atan2(-fwd.x, -fwd.z);
  wheelSpin += speed * dt / 0.45;
  for (const w of car.wheels) w.rotation.x = wheelSpin;
  car.body.position.y = Math.sin(t * 9) * 0.02;
  camPos.copy(p).addScaledVector(fwd, -10).add(new THREE.Vector3(0, 4.2, 0));
  look.copy(p).addScaledVector(fwd, 8).add(new THREE.Vector3(0, 1.2, 0));
  camera.position.lerp(camPos, driving ? 1 - Math.exp(-6 * dt) : 1);
  camera.lookAt(look);
  scenery.sun.position.copy(p).add(new THREE.Vector3(...track.def.sunDir).multiplyScalar(140));
  scenery.sun.target.position.copy(p);
  scenery.update(t);
  for (const c of coins) c.rotation.y = t * 2.5;
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function resize(): void {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ---- controls ----
const bar = document.getElementById('bar')!;
function group(label: string, items: { id: string; name: string }[], cur: () => string, set: (id: string) => void): void {
  const wrap = document.createElement('div'); wrap.className = 'grp';
  const l = document.createElement('span'); l.textContent = label; wrap.appendChild(l);
  const btns: HTMLButtonElement[] = [];
  for (const it of items) {
    const b = document.createElement('button'); b.textContent = it.name;
    b.onclick = () => { set(it.id); build(); btns.forEach((x) => x.classList.toggle('on', x.dataset.id === cur())); };
    b.dataset.id = it.id;
    b.classList.toggle('on', it.id === cur());
    wrap.appendChild(b); btns.push(b);
  }
  bar.appendChild(wrap);
}
group('Track', TRACKS.map((t) => ({ id: t.id, name: t.name })), () => trackId, (id) => (trackId = id as TrackId));
group('Car', CARS.map((c) => ({ id: c.id, name: c.name })), () => carId, (id) => (carId = id as CarId));
group('Shading', [{ id: 'toon', name: 'Cartoon' }, { id: 'soft', name: 'Soft' }], () => style, (id) => (style = id as Style));
const drive = document.createElement('button'); drive.textContent = 'Pause'; drive.className = 'on';
drive.onclick = () => { driving = !driving; drive.textContent = driving ? 'Pause' : 'Drive'; };
bar.appendChild(drive);
addEventListener('keydown', (e) => { if (e.code === 'Space') drive.click(); if (e.code === 'KeyH') bar.classList.toggle('hidden'); });

resize();
build();
requestAnimationFrame(frame);
