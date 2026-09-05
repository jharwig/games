// =============================================================================
// visual style preview (dev-only, not built). Shows Peanut and Ellie on the
// court in each stadium, every shop outfit, and a drag-to-aim peanut throw so
// the look and feel can be approved before gameplay is written.
// =============================================================================
import * as THREE from 'three';
import { buildElephant, NO_OUTFIT, type Elephant, type Outfit, type Hat, type Jersey } from './elephant';
import { buildCourt, buildHoop, buildPeanut, buildBleachers, HOOP_Z, RIM_R, type Hoop, type Crowd } from './court';
import { buildStadium, STADIUM_ORDER, STADIUM_NAME, type Stadium, type StadiumId } from './stadiums';
import { setStyle, type Style } from './gfx';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
const app = document.getElementById('app')!;
app.appendChild(renderer.domElement);
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 3000);

let scene = new THREE.Scene();
let stadiumId: StadiumId = 'circus', style: Style = 'real', camMode: 'play' | 'orbit' | 'closeup' = 'play';
let stadium: Stadium, crowd: Crowd, peanut: Elephant, ellie: Elephant, hoop: Hoop;
const outfit: Outfit = { ...NO_OUTFIT };
const held = buildPeanut();

const PEANUT_POS = new THREE.Vector3(0, 0, -7.5);
const ELLIE_POS = new THREE.Vector3(1.6, 0, -0.5);

function build(): void {
  setStyle(style);
  scene = new THREE.Scene();
  stadium = buildStadium(stadiumId, scene);
  scene.add(stadium.group);
  scene.add(buildCourt(stadium.floorTint));
  crowd = buildBleachers(stadium.helmets); scene.add(crowd.group);
  hoop = buildHoop(HOOP_Z); scene.add(hoop.group);
  scene.add(buildHoop(-HOOP_Z).group);
  peanut = buildElephant({ skin: 0x8d8a86, tusks: false });
  peanut.group.position.copy(PEANUT_POS); peanut.setOutfit(outfit); peanut.setTrunkPose(1);
  scene.add(peanut.group);
  peanut.trunkTip.add(held); held.position.set(0, 0.25, 0.1); held.rotation.z = Math.PI / 2;
  ellie = buildElephant({ skin: 0x24325e, tusks: true });
  ellie.group.position.copy(ELLIE_POS); ellie.group.rotation.y = Math.PI;
  scene.add(ellie.group);
  document.getElementById('tag')!.textContent = STADIUM_NAME[stadiumId];
}

// ---------------------------------------------------------------- panel ----
const bar = document.getElementById('bar')!;
function panel(): void {
  bar.innerHTML = '';
  const row = <T,>(label: string, items: { v: T; label: string }[], cur: () => T, set: (v: T) => void): void => {
    const g = document.createElement('div'); g.className = 'grp';
    const s = document.createElement('span'); s.textContent = label; g.appendChild(s);
    for (const it of items) {
      const b = document.createElement('button'); b.textContent = it.label;
      if (cur() === it.v) b.classList.add('on');
      b.onclick = () => { set(it.v); panel(); };
      g.appendChild(b);
    }
    bar.appendChild(g);
  };
  row<StadiumId>('Stadium', STADIUM_ORDER.map((v) => ({ v, label: v })), () => stadiumId, (v) => { stadiumId = v; build(); });
  row<Hat>('Hat', [null, 'crown', 'party'].map((v) => ({ v: v as Hat, label: v ?? 'none' })), () => outfit.hat, (v) => { outfit.hat = v; peanut.setOutfit(outfit); });
  row<Jersey>('Jersey', [null, 'red', 'purple', 'green'].map((v) => ({ v: v as Jersey, label: v ?? 'none' })), () => outfit.jersey, (v) => { outfit.jersey = v; peanut.setOutfit(outfit); });
  const g = document.createElement('div'); g.className = 'grp';
  const s = document.createElement('span'); s.textContent = 'Extras'; g.appendChild(s);
  for (const k of ['glasses', 'sneakers', 'cape', 'bowtie'] as const) {
    const b = document.createElement('button'); b.textContent = k; b.classList.toggle('on', outfit[k]);
    b.onclick = () => { outfit[k] = !outfit[k]; peanut.setOutfit(outfit); panel(); };
    g.appendChild(b);
  }
  bar.appendChild(g);
  row<typeof camMode>('Camera', [{ v: 'play', label: 'play' }, { v: 'closeup', label: 'close-up' }, { v: 'orbit', label: 'orbit' }], () => camMode, (v) => { camMode = v; });
  row<Style>('Look', [{ v: 'real', label: 'realistic' }, { v: 'toon', label: 'cartoon' }], () => style, (v) => { style = v; build(); });
}
panel();
addEventListener('keydown', (e) => { if (e.key === 'h' || e.key === 'H') { bar.classList.toggle('hidden'); document.getElementById('hint')!.classList.toggle('hidden'); } });

// ------------------------------------------------------------- aim / throw ----
interface Shot { mesh: THREE.Mesh; v: THREE.Vector3; age: number; sunk: boolean }
const shots: Shot[] = [];
let drag: { x0: number; y0: number; x: number; y: number } | null = null;
const G = 14;
const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }), 40);
dots.frustumCulled = false;
const tipWorld = new THREE.Vector3();
function aimVelocity(): THREE.Vector3 {
  // default: a nice arc toward the far hoop. Drag right/left bends it, drag up/down = more/less lift & power
  let dx = 0, dy = 0;
  if (drag) { dx = (drag.x - drag.x0) / innerWidth; dy = (drag.y0 - drag.y) / innerHeight; }
  const power = THREE.MathUtils.clamp(1 + dy * 1.6, 0.45, 1.7);
  return new THREE.Vector3(dx * 14, 10.5 * power, 12.2 * power);
}
function updateDots(): void {
  peanut.trunkTip.getWorldPosition(tipWorld);
  const v = aimVelocity(); const p = tipWorld.clone(); const m = new THREE.Matrix4();
  let n = 0; const step = 0.06;
  for (let i = 0; i < 40 * 3 && n < 40; i++) {
    p.addScaledVector(v, step); v.y -= G * step;
    if (i % 3 === 0) { m.makeTranslation(p.x, p.y, p.z); dots.setMatrixAt(n++, m); }
    if (p.y < 0) break;
  }
  dots.count = n; dots.instanceMatrix.needsUpdate = true;
}
app.addEventListener('pointerdown', (e) => { if (e.target === renderer.domElement) drag = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY }; });
addEventListener('pointermove', (e) => { if (drag) { drag.x = e.clientX; drag.y = e.clientY; } });
addEventListener('pointerup', () => {
  if (!drag) return;
  const mesh = buildPeanut(); peanut.trunkTip.getWorldPosition(mesh.position); mesh.rotation.z = Math.PI / 2;
  scene.add(mesh); shots.push({ mesh, v: aimVelocity(), age: 0, sunk: false });
  drag = null; document.getElementById('tip')!.style.opacity = '0';
});

// ----------------------------------------------------------------- loop ----
const camPos = new THREE.Vector3(), look = new THREE.Vector3();
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; const t = now / 1000;
  stadium.update(t, dt); crowd.update(t);
  peanut.update(t); ellie.update(t + 2);
  // Ellie sways her trunk, ready to block
  ellie.setTrunkPose(0.55 + Math.sin(t * 1.4) * 0.45);
  ellie.group.position.x = ELLIE_POS.x + Math.sin(t * 0.8) * 1.2;
  // shots
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i]; s.age += dt;
    if (!s.sunk) {
      s.v.y -= G * dt; s.mesh.position.addScaledVector(s.v, dt); s.mesh.rotation.x += dt * 6;
      const d = Math.hypot(s.mesh.position.x - hoop.rim.x, s.mesh.position.z - hoop.rim.z);
      if (s.v.y < 0 && Math.abs(s.mesh.position.y - hoop.rim.y) < 0.3 && d < RIM_R * 0.8) { s.sunk = true; s.mesh.position.set(hoop.rim.x, hoop.rim.y - 0.25, hoop.rim.z); }
      if (s.mesh.position.y < 0.25) { s.mesh.position.y = 0.25; s.v.set(s.v.x * 0.6, -s.v.y * 0.35, s.v.z * 0.6); if (Math.abs(s.v.y) < 0.4) s.v.set(0, 0, 0); }
    }
    if (s.age > 5) { scene.remove(s.mesh); shots.splice(i, 1); }
  }
  updateDots(); if (!dots.parent) scene.add(dots);
  // camera
  if (camMode === 'play') { camPos.set(PEANUT_POS.x + 3.2, 4.6, PEANUT_POS.z - 8.5); look.set(0, 2.8, 4); }
  else if (camMode === 'closeup') { camPos.set(PEANUT_POS.x + 5.5, 2.6, PEANUT_POS.z + 1.5); look.set(PEANUT_POS.x, 2.2, PEANUT_POS.z + 1.5); }
  else { camPos.set(Math.cos(t * 0.15) * 26, 9, Math.sin(t * 0.15) * 26); look.set(0, 2, 0); }
  camera.position.lerp(camPos, camMode === 'orbit' ? 1 : 0.08); camera.lookAt(look);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
function resize(): void {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize(); build();
requestAnimationFrame(frame);
