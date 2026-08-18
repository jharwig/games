import type { Boat } from './boat';
import type { Course } from './course';
import type { Wind } from './wind';
import { angleDelta, clamp } from './util';

const NO_GO = (38 * Math.PI) / 180; // half-angle of the upwind dead zone
const TACK_ANGLE = (45 * Math.PI) / 180;

/**
 * Racing rules 10 & 11, simplified: which of the two boats must keep clear?
 * Opposite tacks: port-tack boat (windSide === +1 in our convention).
 * Same tack: the windward boat (closer to where the wind comes from).
 */
export function burdenedOf(a: Boat, b: Boat, windFrom: number): Boat {
  if (a.windSide !== b.windSide) {
    return a.windSide === 1 ? a : b;
  }
  const fx = Math.sin(windFrom);
  const fz = Math.cos(windFrom);
  const aUp = a.pos.x * fx + a.pos.z * fz;
  const bUp = b.pos.x * fx + b.pos.z * fz;
  return aUp > bUp ? a : b;
}

/**
 * AI skipper: aims at the next gate, tacks up the beats, flies the kite
 * downwind, times its start-line run, and dips back when it's OCS.
 */
export class AiSkipper {
  /** all boats in the race, for right-of-way awareness (set by the game) */
  fleet: Boat[] | null = null;

  private tack = 1; // +1 or -1: which side of the wind we're beating on
  private laneOffset: number;
  private sloppiness: number;
  private wobblePhase = Math.random() * 10;
  /** latched in-irons recovery — a per-frame check chatters and deadlocks */
  private recovering = false;

  constructor(
    readonly boat: Boat,
    lane: number,
  ) {
    this.laneOffset = lane * 4.5;
    this.sloppiness = 0.04 + Math.random() * 0.08;
  }

  /** race-time steering + trim toward an aim point */
  private sail(boat: Boat, aimX: number, aimZ: number, wind: Wind, course: Course, time: number): void {
    const desired = Math.atan2(aimX - boat.pos.x, aimZ - boat.pos.z);

    const windFrom = wind.from;
    const offWind = angleDelta(windFrom, desired);
    let target = desired;
    const dist = Math.hypot(aimX - boat.pos.x, aimZ - boat.pos.z);
    if (Math.abs(offWind) < NO_GO) {
      // pick/keep a tack; commit for a while mid-leg, react fast at the mark
      const hysteresis = dist < 16 ? 0.1 : 0.38;
      if (Math.abs(offWind) > hysteresis) this.tack = Math.sign(offWind);
      target = windFrom + this.tack * TACK_ANGLE;
    }
    // in irons: latch into recovery and bear away hard until flow reattaches
    if (!this.recovering && boat.speed < 0.7 && boat.apparentAngle < 0.4) {
      this.recovering = true;
    }
    if (this.recovering) {
      // exit on speed alone — apparent wind swings forward once moving, so a
      // gamma-based exit can never fire and the latch sails off forever
      if (boat.speed > 2.0) {
        this.recovering = false;
      } else {
        target = windFrom + this.tack * (TACK_ANGLE * 1.4);
      }
    }

    // island (and committee boat) avoidance: bend around anything ahead
    const lookX = boat.pos.x + Math.sin(boat.heading) * 22;
    const lookZ = boat.pos.z + Math.cos(boat.heading) * 22;
    const obstacles = [
      ...course.islands,
      { x: course.committeePos.x, z: course.committeePos.z, r: 3 },
    ];
    for (const isl of obstacles) {
      const d = Math.hypot(lookX - isl.x, lookZ - isl.z);
      if (d < isl.r + 7) {
        const toIsland = Math.atan2(isl.x - boat.pos.x, isl.z - boat.pos.z);
        const side = Math.sign(angleDelta(toIsland, boat.heading)) || 1;
        target = toIsland + side * (Math.PI / 2.2);
        break;
      }
    }

    // racing rules: if we're the burdened boat on a collision course, duck
    // behind the right-of-way boat's stern
    if (this.fleet) {
      for (const o of this.fleet) {
        if (o === boat || o.finished) continue;
        const rx = o.pos.x - boat.pos.x;
        const rz = o.pos.z - boat.pos.z;
        const d = Math.hypot(rx, rz);
        if (d > 30) continue;
        const vx = o.vel.x - boat.vel.x;
        const vz = o.vel.z - boat.vel.z;
        const v2 = vx * vx + vz * vz;
        if (v2 < 0.5) continue;
        const tCpa = -(rx * vx + rz * vz) / v2;
        if (tCpa < 0 || tCpa > 4.5) continue;
        const cx = rx + vx * tCpa;
        const cz = rz + vz * tCpa;
        if (Math.hypot(cx, cz) > 7) continue;
        if (burdenedOf(boat, o, windFrom) !== boat) continue;
        // duck: aim for a point astern of the stand-on boat
        const duckX = o.pos.x - Math.sin(o.heading) * 14;
        const duckZ = o.pos.z - Math.cos(o.heading) * 14;
        target = Math.atan2(duckX - boat.pos.x, duckZ - boat.pos.z);
        break;
      }
    }

    const err = angleDelta(boat.heading, target);
    boat.steer = clamp(err * 2.4, -1, 1);

    // trim: chase optimal with a little wander
    const wobble = Math.sin(time * 0.7 + this.wobblePhase) * this.sloppiness;
    const want = clamp(boat.optimalTrim + wobble, 0, 1);
    boat.trimInput = clamp((want - boat.trim) * 10, -1, 1);
  }

  update(dt: number, wind: Wind, course: Course, time: number): void {
    const boat = this.boat;

    // OCS: sail back behind the line before racing on
    if (boat.ocs) {
      const sg = course.startGate;
      const dir = course.startDir;
      this.sail(boat, sg.center.x - dir.x * 18, sg.center.z - dir.y * 18, wind, course, time);
      if (boat.spinUp) boat.spinUp = false;
      return;
    }

    const gate = course.gates[boat.nextGate]!;
    // aim point: gate center nudged sideways so AIs don't stack up
    const gx = gate.center.x + gate.normal.y * this.laneOffset;
    const gz = gate.center.z - gate.normal.x * this.laneOffset;
    this.sail(boat, gx, gz, wind, course, time);

    // spinnaker: fly it when the leg is deep downwind AND the flow agrees;
    // douse when back on the wind or while recovering from irons
    const desired = Math.atan2(gx - boat.pos.x, gz - boat.pos.z);
    const legOffWind = Math.abs(angleDelta(wind.from, desired));
    const wantKite = legOffWind > 2.1 && boat.apparentAngle > 1.6 && !this.recovering;
    const douse = legOffWind < 1.65 || this.recovering || boat.apparentAngle < 1.0;
    if (wantKite && !boat.spinUp) boat.spinUp = true;
    else if (douse && boat.spinUp) boat.spinUp = false;
    void dt;
  }

  /** pre-start: loiter behind the line, then time the run to hit it at the gun */
  preStart(dt: number, wind: Wind, course: Course, time: number, timeToGun: number): void {
    const boat = this.boat;
    const sg = course.startGate;
    const dir = course.startDir; // toward the first mark
    const lineW = sg.a.distanceTo(sg.b);
    const alongX = (sg.b.x - sg.a.x) / lineW;
    const alongZ = (sg.b.z - sg.a.z) / lineW;
    const laneX = sg.center.x + alongX * this.laneOffset * 1.6;
    const laneZ = sg.center.z + alongZ * this.laneOffset * 1.6;

    const distToLine = Math.max(0.5, -course.startLineSide(boat));
    const eta = distToLine / Math.max(2, boat.speed);

    let aimX: number;
    let aimZ: number;
    if (eta > timeToGun + 0.7 || timeToGun < 2.5) {
      // late (or gun imminent): charge the line at our lane
      aimX = laneX + dir.x * 5;
      aimZ = laneZ + dir.y * 5;
    } else {
      // early: hold a station well behind our lane spot
      const hold = 14 + this.laneOffset * 0.5 + timeToGun * 1.2;
      aimX = laneX - dir.x * hold;
      aimZ = laneZ - dir.y * hold;
    }
    this.sail(boat, aimX, aimZ, wind, course, time);
    // kill power when about to cross early
    if (eta < timeToGun - 1.5 && distToLine < 10) {
      boat.trimInput = 1; // dump the sheets
    }
    void dt;
  }
}
