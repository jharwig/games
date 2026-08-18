import * as THREE from 'three';
import type { Boat } from './boat';
import { clamp } from './util';

export type CourseType = 'wl' | 'tri';

export interface Gate {
  a: THREE.Vector3;
  b: THREE.Vector3;
  center: THREE.Vector3;
  normal: THREE.Vector2; // required crossing direction (XZ)
}

export interface Island {
  x: number;
  z: number;
  r: number;
}

export type RaceEvent = 'gate' | 'lap' | 'finish' | null;

function makeGate(cx: number, cz: number, angleDeg: number, halfWidth: number): Gate {
  const a2 = THREE.MathUtils.degToRad(angleDeg);
  const dx = Math.cos(a2);
  const dz = Math.sin(a2);
  const a = new THREE.Vector3(cx - dx * halfWidth, 0, cz - dz * halfWidth);
  const b = new THREE.Vector3(cx + dx * halfWidth, 0, cz + dz * halfWidth);
  return { a, b, center: new THREE.Vector3(cx, 0, cz), normal: new THREE.Vector2(-dz, dx) };
}

export const COURSE_INFO: Record<CourseType, { name: string; laps: number }> = {
  wl: { name: 'WINDWARD / LEEWARD', laps: 3 },
  tri: { name: 'TRIANGLE', laps: 2 },
};

/**
 * Classic race courses. Wind starts from +Z, so "windward" is up the map.
 * The last gate in the sequence is always the start/finish line.
 */
export class Course {
  gates: Gate[] = [];
  type: CourseType = 'wl';
  totalLaps = 3;
  readonly islands: Island[] = [
    { x: -75, z: 25, r: 11 },
    { x: 75, z: 95, r: 13 },
    { x: -60, z: -115, r: 12 },
    { x: 130, z: 45, r: 9 },
    { x: -130, z: -30, r: 10 },
  ];
  readonly group = new THREE.Group();

  private courseGroup = new THREE.Group(); // buoys — rebuilt per layout
  private beacon: THREE.Mesh;
  private gatePlane: THREE.Mesh;
  private sideOf = new Map<Boat, number>();

  /** race committee boat anchored at the starboard end of the start line */
  readonly committee = new THREE.Group();
  readonly committeePos = new THREE.Vector3();
  private flags: THREE.Object3D[] = [];
  private flagsRaised = 1;

  constructor(type: CourseType = 'wl') {
    this.group.add(this.courseGroup);
    this.buildIslands();
    this.buildCommittee();
    this.group.add(this.committee);

    const beaconGeo = new THREE.CylinderGeometry(0.8, 0.8, 26, 10, 1, true);
    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0xffd12e,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.beacon = new THREE.Mesh(beaconGeo, beaconMat);
    this.beacon.position.y = 13;
    this.group.add(this.beacon);

    const planeGeo = new THREE.PlaneGeometry(1, 7);
    const planeMat = new THREE.MeshBasicMaterial({
      color: 0xffd12e,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.gatePlane = new THREE.Mesh(planeGeo, planeMat);
    this.gatePlane.position.y = 3.5;
    this.group.add(this.gatePlane);

    this.setLayout(type);
  }

  setLayout(type: CourseType): void {
    this.type = type;
    this.totalLaps = COURSE_INFO[type].laps;
    if (type === 'wl') {
      // beat up, run back, start/finish at the bottom
      this.gates = [
        makeGate(0, 72, 0, 11), // windward gate
        makeGate(0, -72, 0, 12), // leeward = start/finish
      ];
    } else {
      // beat, two broad reaches around the wing mark
      this.gates = [
        makeGate(0, 72, 0, 11), // windward
        makeGate(88, -12, 115, 10), // wing / gybe mark
        makeGate(0, -72, 0, 12), // start/finish
      ];
    }
    // orient every gate's normal along its leg (from the previous gate)
    for (let i = 0; i < this.gates.length; i++) {
      const prev = this.gates[(i + this.gates.length - 1) % this.gates.length]!;
      const g = this.gates[i]!;
      const legX = g.center.x - prev.center.x;
      const legZ = g.center.z - prev.center.z;
      if (g.normal.x * legX + g.normal.y * legZ < 0) g.normal.multiplyScalar(-1);
    }
    this.buildBuoys();
    this.placeCommittee();
    this.sideOf.clear();
  }

  private buildCommittee(): void {
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f7f9, roughness: 0.6, flatShading: true });
    const navy = new THREE.MeshStandardMaterial({ color: 0x11304a, roughness: 0.7, flatShading: true });
    // hull
    const hullGeo = new THREE.CapsuleGeometry(1.15, 5.2, 4, 10);
    hullGeo.rotateX(Math.PI / 2);
    const hull = new THREE.Mesh(hullGeo, white);
    hull.scale.set(1, 0.55, 1);
    hull.position.y = 0.45;
    hull.castShadow = true;
    this.committee.add(hull);
    // cabin
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.3, 2.6), navy);
    cabin.position.set(0, 1.45, 0.4);
    cabin.castShadow = true;
    this.committee.add(cabin);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.16, 3.0), white);
    roof.position.set(0, 2.2, 0.4);
    this.committee.add(roof);
    // flag mast
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.06, 5.4, 6),
      new THREE.MeshStandardMaterial({ color: 0x2b3a48, roughness: 0.4, metalness: 0.5 }),
    );
    mast.position.set(0, 3.4, -1.8);
    this.committee.add(mast);
    // race flags — hauled down at the gun
    const flagColors = [0xff7a1a, 0x2e6fff];
    for (let i = 0; i < 2; i++) {
      const holder = new THREE.Group();
      const cloth = new THREE.Mesh(
        new THREE.PlaneGeometry(1.15, 0.8),
        new THREE.MeshBasicMaterial({ color: flagColors[i], side: THREE.DoubleSide }),
      );
      cloth.position.set(0.62, 0, 0);
      holder.add(cloth);
      holder.position.set(0, 5.6 - i * 1.1, -1.8);
      holder.userData.topY = 5.6 - i * 1.1;
      this.committee.add(holder);
      this.flags.push(holder);
    }
  }

  private placeCommittee(): void {
    // the committee boat IS the starboard end of the start line
    const { committee } = this.startLineEnds();
    const dir = this.startDir;
    this.committeePos.copy(committee);
    this.committee.position.copy(this.committeePos);
    // anchored bow to wind (pointing up the course)
    this.committee.rotation.y = Math.atan2(dir.x, dir.y);
  }

  /** animate the start flags: 1 = hoisted (pre-start), 0 = down (racing) */
  updateFlags(dt: number, raised: boolean, time: number): void {
    const target = raised ? 1 : 0;
    this.flagsRaised += (target - this.flagsRaised) * Math.min(1, dt * 4);
    for (const f of this.flags) {
      const topY = f.userData.topY as number;
      f.position.y = 1.6 + (topY - 1.6) * this.flagsRaised;
      // flags flutter while up
      f.rotation.y = Math.sin(time * 5 + topY) * 0.18 * this.flagsRaised;
    }
    // gentle bob at anchor
    this.committee.position.y = Math.sin(time * 1.1) * 0.07;
    this.committee.rotation.z = Math.sin(time * 0.9 + 1) * 0.02;
  }

  get startGate(): Gate {
    return this.gates[this.gates.length - 1]!;
  }

  /**
   * Direction of the STARTING leg (start line -> first mark). Note this is
   * opposite the gate's lap-crossing normal, which points down the run.
   */
  get startDir(): THREE.Vector2 {
    const g0 = this.gates[0]!;
    const sg = this.startGate;
    const d = new THREE.Vector2(g0.center.x - sg.center.x, g0.center.z - sg.center.z);
    return d.normalize();
  }

  /** signed distance to the start line: >= 0 means over (course side) */
  startLineSide(boat: Boat): number {
    const g = this.startGate;
    const d = this.startDir;
    return (boat.pos.x - g.center.x) * d.x + (boat.pos.z - g.center.z) * d.y;
  }

  /** the two ends of the start line: committee boat (starboard) and pin buoy */
  private startLineEnds(): { committee: THREE.Vector3; pin: THREE.Vector3 } {
    const sg = this.startGate;
    const dir = this.startDir;
    // starboard hand when crossing toward the first mark (Y-up right-handed
    // world: facing (x,z), your right hand is (-z, x))
    const sx = -dir.y;
    const sz = dir.x;
    const aSide = (sg.a.x - sg.center.x) * sx + (sg.a.z - sg.center.z) * sz;
    return aSide > 0 ? { committee: sg.a, pin: sg.b } : { committee: sg.b, pin: sg.a };
  }

  private buildBuoys(): void {
    this.courseGroup.clear();
    const buoyMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.5, flatShading: true });
    const { pin } = this.startLineEnds();
    const startIdx = this.gates.length - 1;
    for (let i = 0; i < this.gates.length; i++) {
      const g = this.gates[i]!;
      // the start/finish line is committee boat + a single pin buoy
      const ends = i === startIdx ? [pin] : [g.a, g.b];
      for (const p of ends) {
        const geo = new THREE.CylinderGeometry(0.55, 0.9, 2.2, 8);
        const buoy = new THREE.Mesh(geo, buoyMat);
        buoy.position.set(p.x, 0.9, p.z);
        buoy.castShadow = true;
        const flagGeo = new THREE.ConeGeometry(0.45, 1.0, 4);
        const flag = new THREE.Mesh(flagGeo, new THREE.MeshBasicMaterial({ color: 0xffd12e }));
        flag.position.y = 2.0;
        buoy.add(flag);
        this.courseGroup.add(buoy);
      }
    }
  }

  private buildIslands(): void {
    const sandMat = new THREE.MeshStandardMaterial({ color: 0xf0dba8, roughness: 0.9, flatShading: true });
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x3f7a52, roughness: 0.85, flatShading: true });
    for (const isl of this.islands) {
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.ConeGeometry(isl.r, isl.r * 0.32, 9), sandMat);
      g.add(base);
      const mound = new THREE.Mesh(new THREE.ConeGeometry(isl.r * 0.62, isl.r * 0.55, 8), rockMat);
      mound.position.set(isl.r * 0.12, isl.r * 0.16, -isl.r * 0.1);
      g.add(mound);
      const mound2 = new THREE.Mesh(new THREE.ConeGeometry(isl.r * 0.34, isl.r * 0.7, 7), rockMat);
      mound2.position.set(-isl.r * 0.3, isl.r * 0.18, isl.r * 0.24);
      g.add(mound2);
      const foam = new THREE.Mesh(
        new THREE.RingGeometry(isl.r * 0.98, isl.r * 1.18, 32),
        new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.25, depthWrite: false }),
      );
      foam.rotation.x = -Math.PI / 2;
      foam.position.y = 0.18;
      g.add(foam);
      g.position.set(isl.x, 0, isl.z);
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = true;
      });
      this.group.add(g);
    }
  }

  spawnPositions(count: number): { x: number; z: number; heading: number }[] {
    // spread along the pre-start box BEHIND the line (opposite the first
    // mark), reaching so everyone starts with speed and must time their run
    const start = this.startGate;
    const dir = this.startDir;
    const alongX = (start.b.x - start.a.x) / start.a.distanceTo(start.b);
    const alongZ = (start.b.z - start.a.z) / start.a.distanceTo(start.b);
    const heading = Math.atan2(alongX, alongZ); // parallel to the line
    const out: { x: number; z: number; heading: number }[] = [];
    for (let i = 0; i < count; i++) {
      const lane = i - (count - 1) / 2;
      out.push({
        x: start.center.x + alongX * lane * 9 - dir.x * 24,
        z: start.center.z + alongZ * lane * 9 - dir.y * 24,
        heading,
      });
    }
    return out;
  }

  /** call once per frame per boat; returns a race event if one fired */
  track(boat: Boat, raceTime: number): RaceEvent {
    if (boat.finished || boat.ocs) return null;
    const g = this.gates[boat.nextGate]!;
    const relX = boat.pos.x - g.center.x;
    const relZ = boat.pos.z - g.center.z;
    const side = Math.sign(relX * g.normal.x + relZ * g.normal.y);
    const prev = this.sideOf.get(boat) ?? side;
    this.sideOf.set(boat, side);

    if (prev < 0 && side >= 0) {
      const abX = g.b.x - g.a.x;
      const abZ = g.b.z - g.a.z;
      const t = ((boat.pos.x - g.a.x) * abX + (boat.pos.z - g.a.z) * abZ) / (abX * abX + abZ * abZ);
      if (t >= -0.05 && t <= 1.05) {
        const isFinishLine = boat.nextGate === this.gates.length - 1;
        boat.nextGate = (boat.nextGate + 1) % this.gates.length;
        this.sideOf.delete(boat);
        if (isFinishLine) {
          const lapTime = raceTime - boat.lapStart;
          boat.bestLap = Math.min(boat.bestLap, lapTime);
          boat.lapStart = raceTime;
          if (boat.lap >= this.totalLaps) {
            boat.finished = true;
            boat.finishTime = raceTime;
            return 'finish';
          }
          boat.lap++;
          return 'lap';
        }
        return 'gate';
      }
    }
    return null;
  }

  /** monotonically increasing race progress for live standings */
  progress(boat: Boat): number {
    const g = this.gates[boat.nextGate]!;
    const d = Math.hypot(boat.pos.x - g.center.x, boat.pos.z - g.center.z);
    const lapsDone = (boat.lap - 1) * this.gates.length;
    return (lapsDone + boat.nextGate) * 1000 - clamp(d, 0, 999) + (boat.finished ? 1e6 - boat.finishTime : 0);
  }

  /** highlight a gate with the pulsing beacon */
  updateBeacon(gateIndex: number, time: number): void {
    const g = this.gates[gateIndex]!;
    this.beacon.position.set(g.center.x, 13, g.center.z);
    const pulse = 0.28 + Math.sin(time * 4) * 0.12;
    (this.beacon.material as THREE.MeshBasicMaterial).opacity = pulse;
    this.beacon.scale.set(1 + Math.sin(time * 4) * 0.15, 1, 1 + Math.sin(time * 4) * 0.15);

    const w = g.a.distanceTo(g.b);
    this.gatePlane.scale.set(w, 1, 1);
    this.gatePlane.position.set(g.center.x, 3.5, g.center.z);
    this.gatePlane.rotation.y = Math.atan2(g.b.z - g.a.z, g.b.x - g.a.x) * -1;
  }

  resetTracking(): void {
    this.sideOf.clear();
  }

  /** drop one boat's crossing state (e.g. after clearing an OCS) */
  forget(boat: Boat): void {
    this.sideOf.delete(boat);
  }
}
