import * as THREE from 'three';

const COUNT = 10;
const AREA = 110;

interface Fish {
  x: number;
  z: number;
  angle: number;
  speed: number;
  wander: number;
  phase: number;
  size: number;
}

/**
 * Dark fish silhouettes gliding just under the surface — cheap life for the
 * ocean. Rendered as flattened teardrops slightly above the water plane so
 * they read as shapes beneath it.
 */
export class FishShadows {
  readonly group = new THREE.Group();
  private fish: Fish[] = [];
  private meshes: THREE.Mesh[] = [];

  constructor() {
    const geo = new THREE.CircleGeometry(1, 12);
    geo.rotateX(-Math.PI / 2);
    geo.scale(0.35, 1, 1); // teardrop-ish when stretched along travel
    const mat = new THREE.MeshBasicMaterial({
      color: 0x04222f,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    for (let i = 0; i < COUNT; i++) {
      const f: Fish = {
        x: (Math.random() * 2 - 1) * AREA,
        z: (Math.random() * 2 - 1) * AREA,
        angle: Math.random() * Math.PI * 2,
        speed: 1.5 + Math.random() * 2.5,
        wander: 0.4 + Math.random() * 0.8,
        phase: Math.random() * 10,
        size: 0.8 + Math.random() * 1.4,
      };
      this.fish.push(f);
      const m = new THREE.Mesh(geo, mat);
      m.position.y = 0.52;
      m.scale.setScalar(f.size);
      m.renderOrder = 1;
      this.group.add(m);
      this.meshes.push(m);
    }
  }

  update(dt: number, time: number, center: THREE.Vector3): void {
    for (let i = 0; i < this.fish.length; i++) {
      const f = this.fish[i]!;
      f.angle += Math.sin(time * 0.7 + f.phase) * f.wander * dt;
      f.x += Math.sin(f.angle) * f.speed * dt;
      f.z += Math.cos(f.angle) * f.speed * dt;
      // keep the school near the action
      if (Math.hypot(f.x - center.x, f.z - center.z) > AREA * 1.4) {
        f.x = center.x + (Math.random() * 2 - 1) * AREA;
        f.z = center.z + (Math.random() * 2 - 1) * AREA;
      }
      const m = this.meshes[i]!;
      m.position.set(f.x, 0.52, f.z);
      m.rotation.y = f.angle;
      // tail wiggle
      m.scale.set(f.size * (1 + Math.sin(time * 6 + f.phase) * 0.08), f.size, f.size);
    }
  }
}
