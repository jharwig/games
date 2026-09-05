// =============================================================================
// court floor, peanut-bowl hoops, the peanut ball, and bleachers with crowd.
// Court is 28 × 15 m (real basketball), long axis along Z. Hoops at z = ±13.
// =============================================================================
import * as THREE from 'three';
import { mat, cyl, box, noiseTexture } from './gfx';

export const COURT_L = 28, COURT_W = 15, HOOP_Z = 13, RIM_Y = 4.0, RIM_R = 1.05;

function hardwood(tint: string): THREE.CanvasTexture {
  const w = 2048, h = 1170;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = tint; g.fillRect(0, 0, w, h);
  // planks along the long axis (x on canvas), staggered
  const ph = 36;
  for (let y = 0; y < h; y += ph) {
    let x = -((y / ph) % 3) * 180;
    while (x < w) {
      const len = 300 + Math.random() * 260;
      const l = 0.9 + Math.random() * 0.2;
      g.fillStyle = `rgba(${Math.random() > 0.5 ? 255 : 0},${Math.random() > 0.5 ? 200 : 60},0,${(l - 1) * 0.35 + 0.05})`;
      g.fillRect(x, y, len, ph);
      g.strokeStyle = 'rgba(60,30,10,0.35)'; g.lineWidth = 1.5; g.strokeRect(x + 0.5, y + 0.5, len, ph);
      // grain
      g.strokeStyle = 'rgba(70,40,15,0.12)';
      for (let k = 0; k < 6; k++) { const yy = y + 4 + Math.random() * (ph - 8); g.beginPath(); g.moveTo(x, yy); g.bezierCurveTo(x + len * 0.3, yy + 3, x + len * 0.6, yy - 3, x + len, yy); g.stroke(); }
      x += len;
    }
  }
  // court lines (canvas x = world z, canvas y = world x). scale px per metre:
  const s = w / 34, cx = w / 2, cy = h / 2;
  const L = COURT_L * s, W = COURT_W * s;
  g.strokeStyle = '#f5f0e6'; g.lineWidth = 6; g.lineCap = 'round';
  g.strokeRect(cx - L / 2, cy - W / 2, L, W);
  g.beginPath(); g.moveTo(cx, cy - W / 2); g.lineTo(cx, cy + W / 2); g.stroke();
  g.beginPath(); g.arc(cx, cy, 1.8 * s, 0, Math.PI * 2); g.stroke();
  for (const side of [-1, 1]) {
    const bx = cx + side * L / 2;
    // key
    g.fillStyle = 'rgba(180,40,40,0.55)';
    g.fillRect(Math.min(bx, bx - side * 5.8 * s), cy - 2.45 * s, 5.8 * s, 4.9 * s);
    g.strokeRect(Math.min(bx, bx - side * 5.8 * s), cy - 2.45 * s, 5.8 * s, 4.9 * s);
    g.beginPath(); g.arc(bx - side * 5.8 * s, cy, 1.8 * s, 0, Math.PI * 2); g.stroke();
    // three-point arc
    g.beginPath(); g.arc(bx - side * 1.575 * s, cy, 6.75 * s, side > 0 ? Math.PI / 2 : -Math.PI / 2, side > 0 ? Math.PI * 1.5 : Math.PI / 2); g.stroke();
  }
  // centre logo: a peanut
  g.save(); g.translate(cx, cy); g.fillStyle = 'rgba(217,162,90,0.9)'; g.strokeStyle = 'rgba(120,70,20,0.9)'; g.lineWidth = 5;
  g.beginPath(); g.ellipse(-30, 0, 46, 36, 0, 0, Math.PI * 2); g.fill(); g.beginPath(); g.ellipse(30, 0, 46, 36, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(-30, 0, 46, 36, 0, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.ellipse(30, 0, 46, 36, 0, 0, Math.PI * 2); g.stroke();
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildCourt(tint = '#c9924f'): THREE.Group {
  const g = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(34, 34 * 1170 / 2048), mat(0xffffff, { map: hardwood(tint), roughness: 0.42, metalness: 0.05, bump: noiseTexture(256, 8, 3, 0.6), bumpScale: 0.004 }));
  floor.rotation.x = -Math.PI / 2; floor.rotation.z = Math.PI / 2; floor.receiveShadow = true;
  g.add(floor);
  // slab edge
  const slab = box(34 * 1170 / 2048, 0.25, 34, 0x4a3524, { roughness: 0.9 });
  slab.position.y = -0.13; slab.receiveShadow = false; g.add(slab);
  return g;
}

// ---------------------------------------------------------------- peanut ----
let peanutGeo: THREE.LatheGeometry | null = null, peanutMat: THREE.Material | null = null;
function peanutTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d6a763'; g.fillRect(0, 0, 256, 256);
  g.drawImage(noiseTexture(256, 6, 3, 0.7).image as HTMLCanvasElement, 0, 0);
  g.globalCompositeOperation = 'multiply'; g.fillStyle = '#e0b070'; g.fillRect(0, 0, 256, 256);
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = 'rgba(110,70,25,0.55)'; g.lineWidth = 3;
  for (let i = 0; i < 14; i++) { const x = i * 18 + 6; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 6, 80, x - 6, 170, x, 256); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 1);
  return t;
}
/** giant peanut ball, about 1 m long */
export function buildPeanut(): THREE.Mesh {
  if (!peanutGeo) {
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 40; i++) {
      const y = -1 + (i / 40) * 2;
      const r = 0.62 * Math.pow(Math.max(0, 1 - y * y), 0.62) * (0.74 + 0.26 * Math.abs(Math.sin(Math.PI * y)));
      pts.push(new THREE.Vector2(r, y));
    }
    peanutGeo = new THREE.LatheGeometry(pts, 28);
    peanutMat = mat(0xffffff, { map: peanutTexture(), roughness: 0.95, bump: noiseTexture(128, 8, 3, 1), bumpScale: 0.03 });
  }
  const m = new THREE.Mesh(peanutGeo, peanutMat!);
  m.scale.setScalar(0.5); m.castShadow = true; m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------- bowl hoop ----
export interface Hoop { group: THREE.Group; rim: THREE.Vector3 }
export function buildHoop(z: number): Hoop {
  const g = new THREE.Group(); g.position.set(0, 0, z);
  const steel = { metalness: 0.85, roughness: 0.35 };
  const base = cyl(0.9, 1.0, 0.18, 0x2b2b30, 32, { roughness: 0.6 }); base.position.y = 0.09; g.add(base);
  const pole = cyl(0.13, 0.16, 3.2, 0x9aa0a8, 24, steel); pole.position.y = 1.6; g.add(pole);
  const collar = cyl(0.3, 0.2, 0.2, 0x9aa0a8, 24, steel); collar.position.y = 3.2; g.add(collar);
  // glazed ceramic bowl: outer + inner profile
  const prof = [[0.2, 0], [0.55, 0.04], [0.95, 0.28], [1.18, 0.58], [1.25, 0.8], [1.2, 0.86], [1.08, 0.83], [0.95, 0.6], [0.55, 0.28], [0, 0.22]].map((p) => new THREE.Vector2(p[0], p[1]));
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(prof, 48), mat(0xb3261e, { roughness: 0.22, metalness: 0.05, side: THREE.DoubleSide }));
  bowl.position.y = RIM_Y - 0.86; bowl.castShadow = true; bowl.receiveShadow = true; g.add(bowl);
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(1.24, 0.03, 8, 64), mat(0xf5d76e, { roughness: 0.3, metalness: 0.4 }));
  stripe.rotation.x = Math.PI / 2; stripe.position.y = RIM_Y - 0.16; g.add(stripe);
  // peanuts already in the bowl
  for (let i = 0; i < 14; i++) {
    const p = buildPeanut(); p.scale.setScalar(0.42);
    const a = i * 2.39, r = Math.sqrt(i / 14) * 0.62;
    p.position.set(Math.cos(a) * r, RIM_Y - 0.5 + (i % 3) * 0.1, Math.sin(a) * r);
    p.rotation.set(Math.PI / 2 + (i % 5) * 0.2, a, (i % 3) * 0.3); g.add(p);
  }
  return { group: g, rim: new THREE.Vector3(0, RIM_Y, z) };
}

// ------------------------------------------------------------- bleachers ----
const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x5c3a1e];
const SHIRT = [0xe53935, 0x1e88e5, 0x43a047, 0xfdd835, 0x8e24aa, 0xffffff, 0x212121, 0xff7043, 0x00acc1];
export interface Crowd {
  group: THREE.Group;
  update(t: number): void;
  /** go wild for `seconds` after a made shot: everyone bounces, higher */
  excite(seconds: number): void;
}
/** tiered stands on both long sides of the court, with a seated crowd */
export function buildBleachers(helmets = false): Crowd {
  const g = new THREE.Group();
  const tiers = 7, seatsPer = 34, len = 36;
  const n = 2 * tiers * seatsPer;
  const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.24, 12, 8), mat(0xffffff, { roughness: 0.8 }), n);
  const torsos = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.55, 0.35), mat(0xffffff, { roughness: 0.9 }), n);
  heads.castShadow = torsos.castShadow = true;
  const helmet = helmets ? new THREE.InstancedMesh(new THREE.SphereGeometry(0.34, 14, 10), new THREE.MeshPhysicalMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.1 }), n) : null;
  const m = new THREE.Matrix4(), col = new THREE.Color();
  const seats: { x: number; y: number; z: number; ph: number; i: number }[] = [];
  let idx = 0;
  for (const side of [-1, 1]) {
    for (let t = 0; t < tiers; t++) {
      const step = box(1.4, 0.55 + t * 0.5, len, 0x5a5f66, { roughness: 0.85 });
      step.position.set(side * (COURT_W / 2 + 2.2 + t * 1.4), (0.55 + t * 0.5) / 2, 0); g.add(step);
      const seat = box(1.3, 0.08, len, side > 0 ? 0x1f5fa8 : 0xb03030, { roughness: 0.6 });
      seat.position.set(step.position.x, 0.55 + t * 0.5 + 0.04, 0); g.add(seat);
      for (let s = 0; s < seatsPer; s++) {
        if (Math.random() < 0.12) { idx++; continue; }
        const x = step.position.x + (Math.random() - 0.5) * 0.3, z = -len / 2 + 0.6 + s * (len - 1.2) / (seatsPer - 1) + (Math.random() - 0.5) * 0.25;
        const y = 0.55 + t * 0.5;
        seats.push({ x, y, z, ph: Math.random() * 6.28, i: idx });
        m.makeTranslation(x, y + 0.45, z); torsos.setMatrixAt(idx, m); torsos.setColorAt(idx, col.setHex(SHIRT[(Math.random() * SHIRT.length) | 0]));
        m.makeTranslation(x, y + 0.95, z); heads.setMatrixAt(idx, m); heads.setColorAt(idx, col.setHex(SKIN[(Math.random() * SKIN.length) | 0]));
        helmet?.setMatrixAt(idx, m);
        idx++;
      }
    }
    // railing
    const rail = cyl(0.03, 0.03, len, 0xd0d0d0, 8, { metalness: 0.8, roughness: 0.3 });
    rail.rotation.x = Math.PI / 2; rail.position.set(side * (COURT_W / 2 + 1.5), 1.0, 0); g.add(rail);
  }
  g.add(heads, torsos); if (helmet) g.add(helmet);
  // a few excited fans that bounce
  const bouncers = seats.filter((_, i) => i % 9 === 0);
  // when excited every fan bounces; `calm` is the subset that always does
  let exciteLeft = 0, lastT = -1, seated = bouncers;
  function update(t: number): void {
    if (lastT >= 0 && exciteLeft > 0) exciteLeft = Math.max(0, exciteLeft - (t - lastT));
    lastT = t;
    const hot = exciteLeft > 0;
    const who = hot ? seats : bouncers;
    const amp = hot ? 0.55 : 0.25, rate = hot ? 7.5 : 5;
    for (const s of who) {
      const j = Math.max(0, Math.sin(t * rate + s.ph)) * amp;
      m.makeTranslation(s.x, s.y + 0.45 + j, s.z); torsos.setMatrixAt(s.i, m);
      m.makeTranslation(s.x, s.y + 0.95 + j, s.z); heads.setMatrixAt(s.i, m); helmet?.setMatrixAt(s.i, m);
    }
    // settle everyone back down on the frame the excitement ends
    if (!hot && seated !== bouncers) {
      for (const s of seats) {
        m.makeTranslation(s.x, s.y + 0.45, s.z); torsos.setMatrixAt(s.i, m);
        m.makeTranslation(s.x, s.y + 0.95, s.z); heads.setMatrixAt(s.i, m); helmet?.setMatrixAt(s.i, m);
      }
    }
    seated = who;
    heads.instanceMatrix.needsUpdate = torsos.instanceMatrix.needsUpdate = true;
    if (helmet) helmet.instanceMatrix.needsUpdate = true;
  }
  return { group: g, update, excite(seconds: number): void { exciteLeft = Math.max(exciteLeft, seconds); } };
}
