import * as THREE from 'three';
import type { BoatSpec } from './specs';

/**
 * Procedural low-poly hulls. Boat local space: +Z is the bow, +Y up.
 * Returns the group plus the attachment points the rig needs.
 */
export interface HullRig {
  group: THREE.Group;
  mastBase: THREE.Vector3; // local
  mastTop: THREE.Vector3; // local
  jibTack: THREE.Vector3; // local (bow)
  boomHeight: number;
}

function flatCapsuleHull(
  length: number,
  radius: number,
  color: number,
  squashY = 0.55,
  beamScale = 1.0,
): THREE.Mesh {
  const geo = new THREE.CapsuleGeometry(radius, length - radius * 2, 4, 10);
  geo.rotateX(Math.PI / 2); // axis along Z
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.05, flatShading: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.scale.set(beamScale, squashY, 1);
  mesh.castShadow = true;
  return mesh;
}

function deckPlate(w: number, l: number, color: number, y: number, z = 0): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, 0.16, l);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7, flatShading: true });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, y, z);
  mesh.castShadow = true;
  return mesh;
}

function spar(len: number, r: number): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(r * 0.7, r, len, 6);
  const mat = new THREE.MeshStandardMaterial({ color: 0x2b3a48, roughness: 0.4, metalness: 0.5 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  return mesh;
}

export function buildHull(spec: BoatSpec): HullRig {
  const group = new THREE.Group();
  const accent = 0xf4f7f9; // deck white
  const L = spec.length;

  if (spec.id === 'mono') {
    const hull = flatCapsuleHull(L, 1.05, spec.color, 0.5);
    hull.position.y = 0.32;
    group.add(hull);
    group.add(deckPlate(1.55, L * 0.78, accent, 0.72, 0.1));
    // cockpit
    const pit = deckPlate(1.0, 1.6, 0x1d2b36, 0.82, -2.0);
    group.add(pit);
  } else if (spec.id === 'cat') {
    for (const side of [-1, 1]) {
      const hull = flatCapsuleHull(L, 0.5, spec.color, 0.72, 0.9);
      hull.position.set(side * 1.75, 0.3, 0);
      group.add(hull);
    }
    // trampoline + beams
    const tramp = deckPlate(3.6, 3.6, 0x14222e, 0.62, -0.4);
    group.add(tramp);
    for (const z of [1.6, -2.2]) {
      const beam = spar(3.9, 0.09);
      beam.rotation.z = Math.PI / 2;
      beam.position.set(0, 0.68, z);
      group.add(beam);
    }
  } else {
    // trimaran: big center hull + two amas on crossbeams
    const main = flatCapsuleHull(L, 0.75, spec.color, 0.55);
    main.position.y = 0.34;
    group.add(main);
    group.add(deckPlate(1.15, L * 0.7, accent, 0.68, 0.2));
    for (const side of [-1, 1]) {
      const ama = flatCapsuleHull(L * 0.62, 0.34, spec.color, 0.7, 0.85);
      ama.position.set(side * 2.3, 0.26, 0.2);
      group.add(ama);
    }
    for (const z of [1.4, -1.2]) {
      const beam = spar(4.8, 0.08);
      beam.rotation.z = Math.PI / 2;
      beam.position.set(0, 0.62, z);
      group.add(beam);
    }
  }

  // mast
  const mastBase = new THREE.Vector3(0, 0.7, spec.mastZ);
  const mastTop = new THREE.Vector3(0, 0.7 + spec.mastHeight, spec.mastZ - 0.15);
  const mast = spar(spec.mastHeight, 0.09);
  mast.position.copy(mastBase).add(mastTop).multiplyScalar(0.5);
  mast.rotation.x = Math.atan2(mastTop.z - mastBase.z, spec.mastHeight) * -1;
  group.add(mast);

  // bow point for the jib tack
  const jibTack = new THREE.Vector3(0, 0.85, L / 2 - 0.25);

  // masthead wind fly (little pennant) — helps read apparent wind
  const flyGeo = new THREE.ConeGeometry(0.12, 0.7, 4);
  flyGeo.rotateZ(Math.PI / 2);
  const fly = new THREE.Mesh(flyGeo, new THREE.MeshBasicMaterial({ color: 0xff3355 }));
  fly.name = 'windfly';
  fly.position.copy(mastTop).add(new THREE.Vector3(0, 0.25, 0));
  group.add(fly);

  return { group, mastBase, mastTop, jibTack, boomHeight: spec.boomHeight };
}
