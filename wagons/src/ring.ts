// The Ring: stagecoaches around the player. Real GLB coaches when present,
// procedural coaches otherwise. Also exposes blocker boxes for shot
// raycasts and physics colliders.
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { COACH_COUNT, PALETTE, RING_RADIUS } from './constants';
import { ringPos, scene } from './gfx';
import { rand, TAU } from './util';

export interface Blocker { center: THREE.Vector3; size: THREE.Vector3; rotY: number; mesh: THREE.Mesh }
export const blockers: Blocker[] = [];
export const ringGroup = new THREE.Group();
scene.add(ringGroup);

const woodMat = new THREE.MeshStandardMaterial({ color: PALETTE.wood, roughness: 0.85 });
const woodLightMat = new THREE.MeshStandardMaterial({ color: PALETTE.woodLight, roughness: 0.8 });
const paintMat = new THREE.MeshStandardMaterial({ color: 0x8d1e1e, roughness: 0.6 });
const ironMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.7 });
const canvasMat = new THREE.MeshStandardMaterial({ color: 0xd8c9a6, roughness: 0.95 });
const leatherMat = new THREE.MeshStandardMaterial({ color: 0x3b2a1a, roughness: 0.9 });

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}
function wheel(r: number, x: number, z: number) {
  const g = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 8, 24), ironMat);
  rim.castShadow = true; g.add(rim);
  for (let i = 0; i < 12; i++) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.04, r * 2 - 0.06, 0.03), woodLightMat);
    sp.rotation.z = (i / 12) * Math.PI; g.add(sp);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.18, 10), woodMat);
  hub.rotation.z = Math.PI / 2; g.add(hub);
  g.rotation.y = Math.PI / 2; g.position.set(x, r, z);
  return g;
}
/** Procedural Concord-style stagecoach, long axis along Z, ~4 m long. */
function proceduralCoach(variant: number): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = variant % 2 ? paintMat : new THREE.MeshStandardMaterial({ color: 0x2b4a2f, roughness: 0.6 });
  g.add(box(1.5, 1.35, 2.3, bodyMat, 0, 1.55, 0));           // cabin
  g.add(box(1.6, 0.08, 2.4, woodMat, 0, 2.26, 0));           // roof
  g.add(box(1.4, 0.25, 2.2, canvasMat, 0, 2.4, 0));          // roof luggage (tarp)
  g.add(box(1.7, 0.18, 0.7, woodMat, 0, 2.0, 1.55));         // driver's seat
  g.add(box(1.5, 0.3, 0.5, leatherMat, 0, 2.2, 1.5));
  g.add(box(1.3, 0.8, 0.5, leatherMat, 0, 1.2, -1.45));      // rear boot
  g.add(box(0.2, 0.25, 3.2, woodMat, 0, 0.7, 0));            // reach (chassis beam)
  g.add(box(1.7, 0.12, 0.12, woodMat, 0, 0.75, 1.35));       // axles
  g.add(box(1.7, 0.12, 0.12, woodMat, 0, 0.8, -1.35));
  g.add(box(0.1, 0.1, 2.3, woodLightMat, 0, 0.45, 2.9));     // tongue pole
  // windows (dark)
  const win = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2 });
  for (const z of [-0.55, 0.55]) for (const x of [-0.76, 0.76]) g.add(box(0.02, 0.55, 0.6, win, x, 1.75, z));
  // doors
  for (const x of [-0.77, 0.77]) g.add(box(0.03, 1.0, 0.7, woodLightMat, x, 1.45, 0));
  // wheels: big rear, smaller front
  g.add(wheel(0.72, 0.9, -1.35)); g.add(wheel(0.72, -0.9, -1.35));
  g.add(wheel(0.55, 0.9, 1.35)); g.add(wheel(0.55, -0.9, 1.35));
  // lanterns
  for (const x of [-0.85, 0.85]) g.add(box(0.14, 0.22, 0.14, ironMat, x, 2.05, 1.2));
  return g;
}

/** Fit a loaded model to length L along its longest horizontal axis, base at y=0, long axis along Z. */
function fitModel(gltf: GLTF, length: number): THREE.Group {
  const root = new THREE.Group();
  const m = gltf.scene;
  m.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const bb = new THREE.Box3().setFromObject(m);
  const sz = bb.getSize(new THREE.Vector3());
  if (sz.x > sz.z) m.rotation.y = Math.PI / 2; // make long axis Z
  const bb2 = new THREE.Box3().setFromObject(m);
  const sz2 = bb2.getSize(new THREE.Vector3());
  const s = length / Math.max(sz2.z, 0.001);
  m.scale.setScalar(s);
  const bb3 = new THREE.Box3().setFromObject(m);
  const c = bb3.getCenter(new THREE.Vector3());
  m.position.set(-c.x, -bb3.min.y, -c.z);
  root.add(m);
  return root;
}

export function buildRing(models: (GLTF | null)[]) {
  const real = models.filter(Boolean) as GLTF[];
  for (let i = 0; i < COACH_COUNT; i++) {
    const a = (i / COACH_COUNT) * TAU + rand(-0.04, 0.04);
    const r = RING_RADIUS + rand(-0.4, 0.4);
    let coach: THREE.Group;
    if (real.length) {
      const src = real[i % real.length];
      const clone = src.scene.clone(true);
      coach = fitModel({ scene: clone } as GLTF, 4.2);
    } else coach = proceduralCoach(i);
    coach.position.copy(ringPos(a, r));
    // long axis tangent to the ring, alternating which way the coach faces
    const rotY = a + Math.PI + (i % 2 ? Math.PI : 0) + rand(-0.08, 0.08);
    coach.rotation.y = rotY;
    ringGroup.add(coach);
    // blocker (invisible box) for raycasts + physics
    const bmesh = new THREE.Mesh(new THREE.BoxGeometry(1.8, 2.6, 4.2), new THREE.MeshBasicMaterial({ visible: false }));
    bmesh.position.copy(coach.position).setY(1.3);
    bmesh.rotation.y = rotY;
    bmesh.userData.kind = 'coach';
    ringGroup.add(bmesh);
    blockers.push({ center: bmesh.position.clone(), size: new THREE.Vector3(1.8, 2.6, 4.2), rotY, mesh: bmesh });
  }
  // some camp dressing near the player: a crate to stand by, barrels, a cold fire ring
  const crate = box(0.8, 0.6, 0.8, woodLightMat, 0.9, 0.3, -1.2); crate.rotation.y = 0.4; ringGroup.add(crate);
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.3, 0.85, 14), woodMat);
    b.position.set(-1.6 + i * 0.7, 0.425, 1.8 + (i % 2) * 0.4); b.castShadow = true; b.receiveShadow = true; ringGroup.add(b);
  }
  for (let i = 0; i < 9; i++) {
    const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.14), new THREE.MeshStandardMaterial({ color: 0x6d6560, roughness: 1 }));
    const an = (i / 9) * TAU; st.position.set(3 + Math.cos(an) * 0.6, 0.1, 2.5 + Math.sin(an) * 0.6); st.castShadow = true; ringGroup.add(st);
  }
}
