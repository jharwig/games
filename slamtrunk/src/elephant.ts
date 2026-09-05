// =============================================================================
// procedural elephant. Faces +Z. Units are metres; shoulder ≈ 3 m.
// Trunk is a chain of frustums along a curve so it can be posed (down/curled).
// Outfit pieces are rebuilt into `outfitGroup` by `setOutfit`.
// =============================================================================
import * as THREE from 'three';
import { mat, box, cyl, sphere, cone, skinBump, noiseTexture } from './gfx';

export type Hat = 'crown' | 'party' | null;
export type Jersey = 'red' | 'purple' | 'green' | null;
export interface Outfit {
  hat: Hat; jersey: Jersey;
  glasses: boolean; sneakers: boolean; cape: boolean; bowtie: boolean;
}
export const NO_OUTFIT: Outfit = { hat: null, jersey: null, glasses: false, sneakers: false, cape: false, bowtie: false };
export const JERSEY_COLOR: Record<Exclude<Jersey, null>, number> = { red: 0xc62828, purple: 0x6a1b9a, green: 0x2e7d32 };

export interface ElephantSpec { skin: number; tusks: boolean }

export interface Elephant {
  group: THREE.Group;
  /** world-space anchor at the end of the trunk (peanut is held here) */
  trunkTip: THREE.Object3D;
  setOutfit(o: Outfit): void;
  /** 0 = trunk hanging down, 1 = curled up ready to shoot */
  setTrunkPose(t: number): void;
  /** idle animation: ear flap, tail sway, breathing */
  update(t: number): void;
}

const TRUNK_DOWN = [
  [0, 2.3, 2.35], [0, 1.95, 2.65], [0, 1.5, 2.8], [0, 1.05, 2.85], [0, 0.62, 2.9], [0, 0.3, 3.05],
].map((p) => new THREE.Vector3(...p));
const TRUNK_UP = [
  [0, 2.3, 2.35], [0, 2.05, 2.85], [0, 1.85, 3.35], [0, 2.05, 3.75], [0, 2.5, 3.8], [0, 2.75, 3.45],
].map((p) => new THREE.Vector3(...p));
const TRUNK_SEGS = 16;

const UP = new THREE.Vector3(0, 1, 0);
/** place a unit-height cylinder mesh between a and b */
function placeSeg(m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
  const dir = b.clone().sub(a); const len = dir.length();
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.scale.y = len;
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
}
function chain(pts: THREE.Vector3[], segs: number, r0: number, r1: number, material: THREE.Material, ribbed = false): { group: THREE.Group; meshes: THREE.Mesh[]; curve: THREE.CatmullRomCurve3 } {
  const curve = new THREE.CatmullRomCurve3(pts);
  const group = new THREE.Group(); const meshes: THREE.Mesh[] = [];
  const cp = curve.getPoints(segs);
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    let ra = r0 + (r1 - r0) * t0, rb = r0 + (r1 - r0) * t1;
    if (ribbed && i % 2 === 0) { ra *= 1.06; rb *= 1.06; }
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rb, ra, 1, 14, 1), material);
    m.castShadow = true; m.receiveShadow = true;
    placeSeg(m, cp[i], cp[i + 1]);
    group.add(m); meshes.push(m);
  }
  // round the joints
  for (let i = 1; i < segs; i++) {
    const t = i / segs, r = (r0 + (r1 - r0) * t) * (ribbed && i % 2 === 0 ? 1.06 : 1);
    const j = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), material);
    j.position.copy(cp[i]); j.castShadow = true; group.add(j); meshes.push(j);
  }
  return { group, meshes, curve };
}

function earShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, 0.7);
  s.bezierCurveTo(-0.7, 0.9, -1.35, 0.35, -1.25, -0.3);
  s.bezierCurveTo(-1.15, -0.95, -0.5, -1.15, 0, -0.75);
  s.lineTo(0, 0.7);
  return s;
}

export function buildElephant(spec: ElephantSpec): Elephant {
  const group = new THREE.Group();
  const skin = mat(spec.skin, { roughness: 0.95, bump: skinBump(), bumpScale: 0.035 });

  // ---- body / neck / head ----
  const body = sphere(1, spec.skin, 32, { roughness: 0.95, bump: skinBump(), bumpScale: 0.035 });
  body.material = skin;
  body.scale.set(1.3, 1.2, 1.85); body.position.set(0, 2.05, -0.1); group.add(body);
  const neck = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), skin);
  neck.scale.set(1.0, 0.92, 0.9); neck.position.set(0, 2.35, 0.95); neck.castShadow = true; group.add(neck);
  const head = new THREE.Group(); head.position.set(0, 2.6, 1.45); group.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), skin);
  skull.scale.set(0.95, 0.85, 1.0); skull.castShadow = true; head.add(skull);
  for (const sx of [-1, 1]) {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.45, 20, 14), skin);
    dome.position.set(sx * 0.36, 0.38, 0.05); dome.castShadow = true; head.add(dome);
  }

  // ---- ears ----
  const earGeo = new THREE.ExtrudeGeometry(earShape(), { depth: 0.07, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 18 });
  const ears: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(earGeo, skin);
    ear.castShadow = true; ear.receiveShadow = true;
    ear.position.set(sx * 0.88, 0.05, -0.05);
    ear.rotation.y = sx > 0 ? -1.85 : -1.3;
    ear.rotation.z = sx * -0.12;
    head.add(ear); ears.push(ear);
  }

  // ---- eyes ----
  for (const sx of [-1, 1]) {
    const eye = sphere(0.1, 0x2b1d14, 14, { roughness: 0.25 });
    eye.position.set(sx * 0.48, 0.12, 0.82); head.add(eye);
    const hl = sphere(0.03, 0xffffff, 8, { emissive: 0xffffff, emissiveIntensity: 0.8 });
    hl.position.set(sx * 0.46, 0.16, 0.91); head.add(hl);
    const lid = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.45), skin);
    lid.position.set(sx * 0.48, 0.14, 0.8); lid.rotation.x = -0.5; head.add(lid);
  }

  // ---- tusks ----
  if (spec.tusks) {
    const ivory = mat(0xf3e9d2, { roughness: 0.45 });
    for (const sx of [-1, 1]) {
      const pts = [[0.32, 2.15, 2.2], [0.36, 1.85, 2.65], [0.4, 1.7, 3.05], [0.42, 1.78, 3.4]].map((p) => new THREE.Vector3(sx * p[0], p[1], p[2]));
      group.add(chain(pts, 6, 0.09, 0.025, ivory).group);
    }
  }

  // ---- trunk ----
  const trunk = chain(TRUNK_DOWN, TRUNK_SEGS, 0.3, 0.11, skin, true);
  group.add(trunk.group);
  const trunkTip = new THREE.Object3D(); group.add(trunkTip);
  const nostril = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 12), mat(0x2b2020));
  group.add(nostril);
  const posePts = TRUNK_DOWN.map((p) => p.clone());
  function setTrunkPose(t: number): void {
    for (let i = 0; i < posePts.length; i++) posePts[i].lerpVectors(TRUNK_DOWN[i], TRUNK_UP[i], t);
    const curve = new THREE.CatmullRomCurve3(posePts);
    const cp = curve.getPoints(TRUNK_SEGS);
    for (let i = 0; i < TRUNK_SEGS; i++) placeSeg(trunk.meshes[i], cp[i], cp[i + 1]);
    for (let i = 1; i < TRUNK_SEGS; i++) trunk.meshes[TRUNK_SEGS - 1 + i].position.copy(cp[i]);
    trunkTip.position.copy(cp[TRUNK_SEGS]);
    nostril.position.copy(cp[TRUNK_SEGS]);
    nostril.quaternion.copy(trunk.meshes[TRUNK_SEGS - 1].quaternion);
  }
  setTrunkPose(0);

  // ---- legs / feet ----
  const feet: THREE.Vector3[] = [];
  for (const [x, z] of [[-0.7, 0.75], [0.7, 0.75], [-0.7, -1.15], [0.7, -1.15]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 1.6, 18), skin);
    leg.position.set(x, 0.85, z); leg.castShadow = true; leg.receiveShadow = true; group.add(leg);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.46, 0.22, 18), skin);
    foot.position.set(x, 0.11, z); foot.castShadow = true; group.add(foot);
    for (let k = -1; k <= 1; k++) {
      const nail = sphere(0.075, 0xd9d0c0, 10, { roughness: 0.5 });
      nail.position.set(x + k * 0.22, 0.09, z + 0.42 - Math.abs(k) * 0.06); group.add(nail);
    }
    feet.push(new THREE.Vector3(x, 0, z));
  }

  // ---- tail ----
  const tailPts = [[0, 2.55, -1.85], [0, 2.1, -2.0], [0, 1.6, -2.0], [0, 1.25, -1.95]].map((p) => new THREE.Vector3(...p));
  const tail = chain(tailPts, 6, 0.07, 0.035, skin);
  group.add(tail.group);
  const tuft = sphere(0.09, 0x2b2020, 8); tuft.scale.y = 1.6; tuft.position.copy(tailPts[3]); tail.group.add(tuft);

  // ---- outfit ----
  const outfitGroup = new THREE.Group(); group.add(outfitGroup);
  let capeMesh: THREE.Mesh | null = null;
  function setOutfit(o: Outfit): void {
    outfitGroup.clear(); capeMesh = null;
    if (o.hat === 'crown') {
      const gold = { metalness: 0.9, roughness: 0.3 };
      const band = cyl(0.56, 0.6, 0.34, 0xf1c232, 24, gold); band.position.set(0, 3.42, 1.45); outfitGroup.add(band);
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const spike = cone(0.11, 0.34, 0xf1c232, 10, gold);
        spike.position.set(Math.sin(a) * 0.52, 3.72, 1.45 + Math.cos(a) * 0.52); outfitGroup.add(spike);
        const gem = sphere(0.06, [0xe53935, 0x1e88e5, 0x43a047][i % 3], 10, { roughness: 0.15 });
        gem.position.set(Math.sin(a) * 0.58, 3.45, 1.45 + Math.cos(a) * 0.58); outfitGroup.add(gem);
      }
    } else if (o.hat === 'party') {
      const hat = cone(0.45, 1.15, 0x7b3fbf, 24, { roughness: 0.6 }); hat.position.set(0, 3.9, 1.45); outfitGroup.add(hat);
      for (let i = 0; i < 12; i++) {
        const a = i * 2.4, h = 0.15 + (i % 4) * 0.22, r = 0.45 * (1 - h / 1.15) + 0.01;
        const dot = sphere(0.045, 0xffd54f, 8, { roughness: 0.4 });
        dot.position.set(Math.sin(a) * r, 3.9 - 0.575 + h, 1.45 + Math.cos(a) * r); outfitGroup.add(dot);
      }
      const pom = sphere(0.12, 0xff4081, 12, { roughness: 1 }); pom.position.set(0, 4.5, 1.45); outfitGroup.add(pom);
    }
    if (o.glasses) {
      const dark = { roughness: 0.15, metalness: 0.4 };
      for (const sx of [-1, 1]) {
        const lens = box(0.36, 0.22, 0.05, 0x111418, dark); lens.position.set(sx * 0.46, 2.74, 2.33); outfitGroup.add(lens);
        const arm = box(0.04, 0.04, 0.9, 0x111418, dark); arm.position.set(sx * 0.66, 2.76, 1.9); outfitGroup.add(arm);
      }
      const bridge = box(0.24, 0.04, 0.04, 0x111418, dark); bridge.position.set(0, 2.78, 2.33); outfitGroup.add(bridge);
    }
    if (o.jersey) {
      const col = JERSEY_COLOR[o.jersey];
      const cloth = noiseTexture(128, 16, 2, 0.5);
      const j = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.6), mat(col, { roughness: 0.9, bump: cloth, bumpScale: 0.01, side: THREE.DoubleSide }));
      j.scale.set(1.36, 1.26, 1.92); j.position.set(0, 2.05, -0.1); j.castShadow = true; outfitGroup.add(j);
      const trim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 8, 48), mat(0xffffff, { roughness: 0.8 }));
      trim.scale.set(1.36 * Math.sin(Math.PI * 0.6), 1.92 * Math.sin(Math.PI * 0.6), 1);
      trim.rotation.x = Math.PI / 2; trim.position.set(0, 2.05 - 1.26 * Math.cos(Math.PI * 0.6), -0.1); outfitGroup.add(trim);
      // number on the flank
      const c = document.createElement('canvas'); c.width = 256; c.height = 256;
      const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.font = 'bold 200px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('1', 128, 200);
      const num = new THREE.CanvasTexture(c);
      for (const sx of [-1, 1]) {
        const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.0), new THREE.MeshStandardMaterial({ map: num, transparent: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }));
        plate.position.set(sx * 1.37, 2.35, -0.2); plate.rotation.y = sx * Math.PI / 2; plate.rotation.x = sx * 0.28; outfitGroup.add(plate);
      }
    }
    if (o.sneakers) {
      for (const f of feet) {
        const shoe = box(1.0, 0.4, 1.15, 0xf5f5f5, { roughness: 0.5 }); shoe.position.set(f.x, 0.2, f.z + 0.12); outfitGroup.add(shoe);
        const stripe = box(1.02, 0.1, 1.17, 0xc62828, { roughness: 0.5 }); stripe.position.set(f.x, 0.12, f.z + 0.12); outfitGroup.add(stripe);
        const toe = box(1.02, 0.14, 0.4, 0x2b2b2b, { roughness: 0.8 }); toe.position.set(f.x, 0.07, f.z + 0.5); outfitGroup.add(toe);
      }
    }
    if (o.cape) {
      const geo = new THREE.PlaneGeometry(2.4, 2.6, 10, 12);
      capeMesh = new THREE.Mesh(geo, mat(0xb71c1c, { roughness: 0.75, side: THREE.DoubleSide }));
      capeMesh.position.set(0, 3.05, -0.9); capeMesh.rotation.x = 0.35; capeMesh.castShadow = true; outfitGroup.add(capeMesh);
      const collar = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.06, 8, 40, Math.PI), mat(0xf1c232, { metalness: 0.8, roughness: 0.3 }));
      collar.position.set(0, 3.1, 0.45); collar.rotation.x = Math.PI / 2; outfitGroup.add(collar);
    }
    if (o.bowtie) {
      const pink = { roughness: 0.6 };
      for (const sx of [-1, 1]) {
        const wing = cone(0.17, 0.32, 0xe91e63, 4, pink);
        wing.position.set(sx * 0.2, 1.9, 2.18); wing.rotation.z = sx * Math.PI / 2; wing.rotation.y = Math.PI / 4; outfitGroup.add(wing);
      }
      const knot = sphere(0.08, 0xad1457, 10, pink); knot.position.set(0, 1.9, 2.2); outfitGroup.add(knot);
    }
  }
  setOutfit(NO_OUTFIT);

  const capeBase = new THREE.PlaneGeometry(2.4, 2.6, 10, 12).attributes.position.array as Float32Array;
  function update(t: number): void {
    for (let i = 0; i < 2; i++) ears[i].rotation.y = (i === 1 ? -1.85 : -1.3) + Math.sin(t * 1.3 + i) * 0.12;
    tail.group.rotation.y = Math.sin(t * 1.7) * 0.25;
    body.scale.y = 1.2 + Math.sin(t * 1.1) * 0.012;
    if (capeMesh) {
      const pos = capeMesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = capeBase[i * 3], y = capeBase[i * 3 + 1];
        const hang = (1.3 - y) / 2.6;
        pos.setZ(i, Math.sin(t * 2.2 + x * 2 + y * 1.5) * 0.12 * hang);
      }
      pos.needsUpdate = true; capeMesh.geometry.computeVertexNormals();
    }
  }

  return { group, trunkTip, setOutfit, setTrunkPose, update };
}
