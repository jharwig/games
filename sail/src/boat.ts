import * as THREE from 'three';
import { SailCloth } from './cloth';
import { buildHull } from './hulls';
import { FlatRibbons } from './ribbons';
import type { BoatSpec } from './specs';
import type { Wind } from './wind';
import { clamp, damp, lerp, wrapAngle } from './util';

const SHEET_MIN = THREE.MathUtils.degToRad(8); // fully sheeted in
const SHEET_MAX = THREE.MathUtils.degToRad(74); // fully eased (vang keeps the boom off the water)
const WAKE_POINTS = 16;

/**
 * One boat: arcade-but-honest sailing physics plus the cloth rig.
 *
 * Force model: with apparent wind at angle gamma off the bow, a free boom
 * would weathervane to gamma; the sheet holds it at `b = min(gamma, sheet)`.
 * Angle of attack = gamma - b. Sail force ~ apparentSpeed^2 * sin(AoA),
 * directed normal to the boom, so drive = F*sin(b), sideforce = F*cos(b).
 * This gives you a real no-go zone, luffing, and a fast beam reach for free.
 */
export class Boat {
  readonly group = new THREE.Group();
  readonly wake: FlatRibbons;

  // --- state ---
  pos = new THREE.Vector3();
  vel = new THREE.Vector3(); // world XZ
  heading = 0; // radians, 0 = +Z
  heel = 0;
  trim = 0.5; // 0 = sheeted in, 1 = fully eased
  /** race progress, written by the course tracker */
  nextGate = 0;
  lap = 1;
  finished = false;
  /** on course side at the gun — must return behind the start line */
  ocs = false;
  /** seconds of penalty freeze left (hit a boat that had right of way) */
  penalty = 0;
  finishTime = 0;
  lapStart = 0;
  bestLap = Infinity;

  // --- inputs (set by player controls or AI each frame) ---
  steer = 0; // -1..1
  trimInput = 0; // -1 sheet in .. +1 ease out

  // --- derived, for HUD/AI ---
  speed = 0; // forward speed
  apparentAngle = 0; // gamma: angle of apparent wind off the bow, 0..PI
  apparentSpeed = 0;
  windSide = 1; // +1 wind from starboard
  optimalTrim = 0.5;
  luffing = 0;

  // --- spinnaker ---
  /** hoist progress 0..1 (animated; hoisting/dousing takes a few seconds) */
  spinDeploy = 0;
  /** desired state, toggled by the player (Space) or the AI */
  spinUp = false;

  private boomPivot = new THREE.Group();
  private boomAngle = 0; // signed rotation.y of the boom
  private main: SailCloth;
  private jib: SailCloth;
  private spin: SailCloth;
  private spinMesh: THREE.Mesh;
  private mastBaseL: THREE.Vector3;
  private mastTopL: THREE.Vector3;
  private jibTackL: THREE.Vector3;
  private boomH: number;
  private fly: THREE.Object3D | null;
  private bobPhase = Math.random() * 10;

  private wakePts: { x: number; z: number; a: number }[] = [];
  private wakeTimer = 0;

  // scratch vectors
  private _wv = new THREE.Vector3();
  private _aw = new THREE.Vector3();
  private _v3a = new THREE.Vector3();
  private _v3b = new THREE.Vector3();
  private _v3c = new THREE.Vector3();

  constructor(
    readonly spec: BoatSpec,
    liveryColor?: number,
  ) {
    const rig = buildHull({ ...spec, color: liveryColor ?? spec.color });
    this.group.add(rig.group);
    this.mastBaseL = rig.mastBase;
    this.mastTopL = rig.mastTop;
    this.jibTackL = rig.jibTack;
    this.boomH = rig.boomHeight;
    this.fly = rig.group.getObjectByName('windfly') ?? null;
    this.group.rotation.order = 'YZX';

    // boom
    this.boomPivot.position.set(this.mastBaseL.x, this.boomH, this.mastBaseL.z);
    const boomGeo = new THREE.CylinderGeometry(0.05, 0.06, spec.mainFoot, 6);
    boomGeo.rotateX(Math.PI / 2);
    boomGeo.translate(0, 0, -spec.mainFoot / 2);
    const boom = new THREE.Mesh(
      boomGeo,
      new THREE.MeshStandardMaterial({ color: 0x2b3a48, roughness: 0.4, metalness: 0.5 }),
    );
    boom.castShadow = true;
    this.boomPivot.add(boom);
    this.group.add(this.boomPivot);

    // sails
    const sailMat = new THREE.MeshStandardMaterial({
      color: 0xf7fafc,
      roughness: 0.75,
      side: THREE.DoubleSide,
      flatShading: false,
      // fake the translucency of sailcloth so sails read bright from any angle
      emissive: 0xcfd8de,
      emissiveIntensity: 0.55,
    });
    this.main = new SailCloth(6, 9, 0.38, 1.0);
    this.jib = new SailCloth(5, 7, 0.12, 1.0);
    const mainMesh = new THREE.Mesh(this.main.geometry, sailMat);
    const jibMesh = new THREE.Mesh(this.jib.geometry, sailMat.clone());
    (jibMesh.material as THREE.MeshStandardMaterial).color.setHex(0xeef2f5);
    mainMesh.castShadow = jibMesh.castShadow = true;
    mainMesh.frustumCulled = jibMesh.frustumCulled = false;
    // cloth positions are in world space already
    mainMesh.matrixAutoUpdate = false;
    jibMesh.matrixAutoUpdate = false;

    // bowsprit to fly the kite from, well forward of the forestay
    const spritLen = 1.6;
    const spritGeo = new THREE.CylinderGeometry(0.04, 0.055, spritLen, 6);
    spritGeo.rotateX(Math.PI / 2);
    const sprit = new THREE.Mesh(
      spritGeo,
      new THREE.MeshStandardMaterial({ color: 0x2b3a48, roughness: 0.4, metalness: 0.5 }),
    );
    sprit.position.set(0, 0.85, spec.length / 2 + spritLen / 2 - 0.35);
    sprit.castShadow = true;
    this.group.add(sprit);

    // spinnaker: big three-corner kite in the livery color
    this.spin = new SailCloth(7, 7, 0.16, 1.0, 1.1, 'corners');
    const spinMat = new THREE.MeshStandardMaterial({
      color: liveryColor ?? spec.color,
      roughness: 0.7,
      side: THREE.DoubleSide,
      emissive: liveryColor ?? spec.color,
      emissiveIntensity: 0.25,
    });
    this.spinMesh = new THREE.Mesh(this.spin.geometry, spinMat);
    this.spinMesh.castShadow = true;
    this.spinMesh.frustumCulled = false;
    this.spinMesh.matrixAutoUpdate = false;
    this.spinMesh.visible = false;

    this.sailHolder.add(mainMesh, jibMesh, this.spinMesh);

    // wake trail
    // ride above the animated wave crests so the trail never clips
    this.wake = new FlatRibbons(1, WAKE_POINTS, new THREE.Color(0xffffff), 0.7);

    // blob shadow to ground the boat on the water
    const blobGeo = new THREE.CircleGeometry(spec.length * 0.42, 24);
    blobGeo.rotateX(-Math.PI / 2);
    const blob = new THREE.Mesh(
      blobGeo,
      new THREE.MeshBasicMaterial({ color: 0x03202f, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    blob.scale.set(0.55, 1, 1);
    blob.position.y = 0.05;
    blob.renderOrder = 1;
    this.group.add(blob);
  }

  /** sails live in world space, parked in their own root added to the scene */
  readonly sailHolder = new THREE.Group();

  get sheetAngle(): number {
    return SHEET_MIN + (SHEET_MAX - SHEET_MIN) * this.trim;
  }

  place(x: number, z: number, heading: number): void {
    this.pos.set(x, 0, z);
    this.heading = heading;
    this.vel.set(0, 0, 0);
    this.heel = 0;
    this.trim = 0.5;
    this.boomAngle = 0;
    this.nextGate = 0;
    this.lap = 1;
    this.finished = false;
    this.finishTime = 0;
    this.bestLap = Infinity;
    this.ocs = false;
    this.penalty = 0;
    this.spinDeploy = 0;
    this.spinUp = false;
    this.spinMesh.visible = false;
    this.wakePts.length = 0;
    this.updateTransforms(0);
    // lay the sails out fresh
    const { mainLuffB, mainLuffT, clew, jibB, jibT, jibClew } = this.rigWorldPoints();
    this.main.place(mainLuffB, mainLuffT, clew);
    this.jib.place(jibB, jibT, jibClew);
    // spinnaker rest lengths come from its full-hoist shape
    const sp = this.spinWorldPoints(1);
    this.spin.place(sp.tack, sp.head, sp.clew);
  }

  toggleSpinnaker(): void {
    this.spinUp = !this.spinUp;
  }

  update(dt: number, wind: Wind, elapsed: number): void {
    const spec = this.spec;

    // penalty freeze: dead in the water, sails flogging, no control
    const penalized = this.penalty > 0;
    if (penalized) {
      this.penalty -= dt;
      this.steer = 0;
      this.trimInput = 1; // sheets dumped
      this.spinUp = false;
    }

    // ---------- apparent wind ----------
    const wv = wind.velocity(this._wv);
    const aw = this._aw.subVectors(wv, this.vel); // air flow relative to boat
    const awSpeed = Math.hypot(aw.x, aw.z);
    this.apparentSpeed = awSpeed;
    const fwdX = Math.sin(this.heading);
    const fwdZ = Math.cos(this.heading);
    // direction the apparent wind comes FROM
    const fromX = -aw.x / (awSpeed || 1);
    const fromZ = -aw.z / (awSpeed || 1);
    const dot = clamp(fwdX * fromX + fwdZ * fromZ, -1, 1);
    const gamma = Math.acos(dot); // 0 = in irons, PI = dead run
    const side = Math.sign(fwdZ * fromX - fwdX * fromZ) || 1; // +1 wind from starboard
    this.apparentAngle = gamma;
    this.windSide = side;

    // ---------- trim input ----------
    this.trim = clamp(this.trim + this.trimInput * 0.55 * dt, 0, 1);
    const sheet = this.sheetAngle;

    // ---------- sail forces (lift ⊥ apparent flow, drag ∥ flow) ----------
    const bFree = gamma; // where a free boom would weathervane to
    const b = Math.min(bFree, sheet);
    const aoa = Math.min(bFree - b, Math.PI / 2);
    const luffLimit = THREE.MathUtils.degToRad(6);
    this.luffing = aoa < luffLimit ? 1 - aoa / luffLimit : 0;
    if (penalized) this.luffing = 1;

    // thin-sail flat-plate coefficients
    const cl = 1.45 * Math.sin(2 * aoa);
    const cd = 0.08 + 1.35 * Math.sin(aoa) * Math.sin(aoa);
    const q = awSpeed * awSpeed * 0.01 * spec.sailPower;

    // flow direction (unit, pointing downwind)
    const flx = -fromX;
    const flz = -fromZ;
    // leeward-facing sail normal (perpendicular to the boom, away from wind)
    const boomWorld = this.heading + Math.PI + side * b;
    let snx = Math.sin(boomWorld + Math.PI / 2);
    let snz = Math.cos(boomWorld + Math.PI / 2);
    if (snx * fromX + snz * fromZ > 0) {
      snx = -snx;
      snz = -snz;
    }
    // lift: ⊥ apparent flow, on the suction (leeward-normal) side
    let lx = flz;
    let lz = -flx;
    if (lx * snx + lz * snz < 0) {
      lx = -lx;
      lz = -lz;
    }
    const latXd = fwdZ; // starboard axis
    const latZd = -fwdX;
    const fTotX = q * (cl * lx + cd * flx);
    const fTotZ = q * (cl * lz + cd * flz);
    const drive = fTotX * fwdX + fTotZ * fwdZ;
    const sideForce = fTotX * latXd + fTotZ * latZd; // + = to starboard

    // optimal trim marker for the HUD: hold ~35° angle of attack
    const bOpt = clamp(gamma - 0.61, SHEET_MIN, SHEET_MAX);
    this.optimalTrim = (bOpt - SHEET_MIN) / (SHEET_MAX - SHEET_MIN);

    // ---------- spinnaker ----------
    // the halyard takes a while — commit to your hoists
    this.spinDeploy = clamp(this.spinDeploy + (this.spinUp ? dt / 2.8 : -dt / 2.2), 0, 1);
    const q0 = awSpeed * awSpeed * 0.01;
    // power band opens as you bear away past ~70° apparent
    const band = clamp((gamma - 1.22) / 0.87, 0, 1);
    const spinDrive = q0 * spec.spinPower * this.spinDeploy * band * 1.15;
    // carrying it upwind is a disaster: flogging chaos and drag
    const spinChaos = this.spinDeploy > 0.2 && gamma < 1.05 ? 1 : 0;
    const spinDrag = spinChaos * q0 * spec.spinPower * 0.35 * this.spinDeploy;

    // ---------- hull dynamics ----------
    // decompose velocity into forward/lateral
    let u = this.vel.x * fwdX + this.vel.z * fwdZ;
    const latX = fwdZ; // starboard direction
    const latZ = -fwdX;
    let w = this.vel.x * latX + this.vel.z * latZ;

    const netDrive = penalized ? 0 : drive + spinDrive - spinDrag;
    u += (netDrive - spec.dragL * u - spec.dragK * u * Math.abs(u)) * dt;
    if (penalized) u *= Math.exp(-0.9 * dt); // parked
    // keel: lateral velocity dies fast, but sideforce causes some leeway
    w += sideForce * 0.12 * dt;
    w *= Math.exp(-2.8 * dt);

    // ---------- steering ----------
    const authority = 0.35 + 0.65 * clamp(Math.abs(u) / 4.5, 0, 1);
    const turn = this.steer * spec.turnRate * authority;
    this.heading = wrapAngle(this.heading + turn * dt);
    // turning scrubs speed
    u *= 1 - Math.abs(turn) * 0.22 * dt;

    // recompose (heading changed — keep momentum mostly along old vector,
    // blended toward the new axes for an arcade-tight feel)
    const nfX = Math.sin(this.heading);
    const nfZ = Math.cos(this.heading);
    this.vel.set(nfX * u + nfZ * w, 0, nfZ * u - nfX * w);
    this.speed = u;

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // ---------- heel ----------
    const heelTarget = clamp(-sideForce * 0.3, -1, 1) * spec.maxHeel;
    this.heel = damp(this.heel, heelTarget, spec.heelRate, dt);

    // ---------- boom ----------
    const boomTarget = side * b; // rotation.y=+φ swings the boom tip toward -X
    this.boomAngle = damp(this.boomAngle, boomTarget, 6, dt);

    this.updateTransforms(elapsed);

    // ---------- cloth ----------
    const { mainLuffB, mainLuffT, clew, jibB, jibT, jibClew } = this.rigWorldPoints();
    if (!this.main.isPlaced) {
      this.main.place(mainLuffB, mainLuffT, clew);
      this.jib.place(jibB, jibT, jibClew);
    }
    this.main.setLuff(mainLuffB, mainLuffT);
    this.main.setClew(clew);
    this.jib.setLuff(jibB, jibT);
    this.jib.setClew(jibClew);
    // raw wind, not apparent: cloth particles carry the boat's motion in
    // their Verlet velocity, and the wind force is relative to that already
    const gustWind = wind.velocityAt(this.pos, this._v3c);
    const flog = this.luffing;
    const dtc = Math.min(dt, 1 / 30);
    this.main.step(dtc, gustWind, flog);
    this.jib.step(dtc, gustWind, Math.min(1, flog * 1.3));

    if (this.spinDeploy > 0.02) {
      const sp = this.spinWorldPoints(this.spinDeploy);
      this.spin.setCorners(sp.tack, sp.clew, sp.head);
      // hard wall just forward of the mast: the kite can never blow back
      // through the mainsail
      const wallPoint = this._v3a
        .set(this.mastBaseL.x, 0, this.mastBaseL.z + 0.8)
        .applyMatrix4(this.group.matrixWorld);
      this._v3b.set(fwdX, 0, fwdZ);
      this.spin.setClampPlane(wallPoint, this._v3b);
      this.spin.step(dtc, gustWind, Math.max(spinChaos, flog * 0.6));
      this.spinMesh.visible = true;
    } else {
      this.spinMesh.visible = false;
    }

    // masthead fly points into the apparent wind
    if (this.fly) {
      this.fly.rotation.y = Math.atan2(fromX, fromZ) - this.heading + Math.PI / 2;
    }

    this.updateWake(dt);
  }

  private updateTransforms(elapsed: number): void {
    const bobY = Math.sin(elapsed * 1.15 + this.bobPhase) * 0.06;
    const pitch = Math.sin(elapsed * 0.9 + this.bobPhase * 1.7) * 0.015 - clamp(this.speed, 0, 8) * 0.004;
    this.group.position.set(this.pos.x, bobY, this.pos.z);
    this.group.rotation.set(pitch, this.heading, this.heel);
    this.boomPivot.rotation.y = this.boomAngle;
    this.group.updateMatrixWorld(true);
  }

  private rigWorldPoints() {
    const m = this.group.matrixWorld;
    const mainLuffB = this._v3a
      .set(this.mastBaseL.x, this.boomH + 0.15, this.mastBaseL.z)
      .applyMatrix4(m)
      .clone();
    const mainLuffT = this._v3a.copy(this.mastTopL).applyMatrix4(m).clone();
    // boom tip in local space
    const foot = this.spec.mainFoot;
    const clew = this._v3a
      .set(
        this.mastBaseL.x - Math.sin(this.boomAngle) * foot,
        this.boomH + 0.12,
        this.mastBaseL.z - Math.cos(this.boomAngle) * foot,
      )
      .applyMatrix4(m)
      .clone();

    const jibB = this._v3a.copy(this.jibTackL).applyMatrix4(m).clone();
    const jibT = this._v3b
      .lerpVectors(this.mastBaseL, this.mastTopL, this.spec.jibHoist)
      .applyMatrix4(m)
      .clone();
    // jib clew: sheeted to the same side as the boom, a bit tighter
    const jibFoot = (this.jibTackL.z - this.mastBaseL.z) * 0.92;
    const ja = this.boomAngle * 0.85;
    const jibClew = this._v3b
      .set(
        this.jibTackL.x - Math.sin(ja) * jibFoot,
        1.1,
        this.jibTackL.z - Math.cos(ja) * jibFoot,
      )
      .applyMatrix4(m)
      .clone();
    return { mainLuffB, mainLuffT, clew, jibB, jibT, jibClew };
  }

  /** spinnaker corner positions at a given hoist fraction (world space) */
  private spinWorldPoints(deploy: number): { tack: THREE.Vector3; clew: THREE.Vector3; head: THREE.Vector3 } {
    const m = this.group.matrixWorld;
    const foot = this.spec.mainFoot * 1.55;
    // clew flies on the boom's side (leeward); boomAngle is smoothed so the
    // kite swings across cleanly on a gybe
    const tipSign = -Math.sign(this.boomAngle) || 1;
    const spritTip = this.spec.length / 2 + 1.15;
    const head = this._v3a
      .set(this.mastTopL.x, lerp(1.6, this.mastTopL.y - 0.1, deploy), this.mastTopL.z + 1.0)
      .applyMatrix4(m)
      .clone();
    // tack on the bowsprit, well forward of the forestay
    const tack = this._v3b.set(0, 0.95, spritTip).applyMatrix4(m).clone();
    const reach = lerp(0.25, 1, deploy);
    // clew forward-leeward: the kite lives ahead of the rig, not over it
    const clew = this._v3b
      .set(tipSign * foot * 0.85 * reach, 1.5, spritTip - foot * 0.45 * reach)
      .applyMatrix4(m)
      .clone();
    return { tack, clew, head };
  }

  private updateWake(dt: number): void {
    this.wakeTimer -= dt;
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const sternX = this.pos.x - Math.sin(this.heading) * this.spec.length * 0.45;
    const sternZ = this.pos.z - Math.cos(this.heading) * this.spec.length * 0.45;
    if (this.wakeTimer <= 0) {
      this.wakeTimer = 0.055;
      this.wakePts.unshift({ x: sternX, z: sternZ, a: clamp(sp / 7, 0, 1) });
      if (this.wakePts.length > WAKE_POINTS - 1) this.wakePts.pop();
    }
    const n = WAKE_POINTS;
    const xs = new Array<number>(n);
    const zs = new Array<number>(n);
    const ws = new Array<number>(n);
    const as = new Array<number>(n);
    const liveA = clamp(sp / 7, 0, 1);
    for (let i = 0; i < n; i++) {
      // slot 0 is pinned to the live stern so the trail head never pops
      const p =
        i === 0
          ? { x: sternX, z: sternZ, a: liveA }
          : this.wakePts[Math.min(i - 1, this.wakePts.length - 1)];
      if (!p) {
        xs[i] = sternX;
        zs[i] = sternZ;
        ws[i] = 0;
        as[i] = 0;
        continue;
      }
      const t01 = i / (n - 1);
      xs[i] = p.x;
      zs[i] = p.z;
      ws[i] = 0.9 + t01 * 3.0;
      // bright foam churn right at the transom, fading down the trail
      const churn = i < 3 ? (3 - i) * 0.16 : 0;
      as[i] = p.a * ((1 - t01) * (1 - t01) * 0.3 + churn);
    }
    this.wake.setRibbon(0, xs, zs, ws, as);
    this.wake.commit();
  }
}
