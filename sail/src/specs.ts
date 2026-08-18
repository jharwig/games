export type HullType = 'mono' | 'cat' | 'tri';

export interface BoatSpec {
  id: HullType;
  name: string;
  typeLabel: string;
  color: number;
  /** drive force multiplier */
  sailPower: number;
  /** spinnaker drive multiplier (downwind only) */
  spinPower: number;
  /** quadratic hull drag — lower = faster top end */
  dragK: number;
  /** linear drag (skin friction / windage) */
  dragL: number;
  /** rad/s of rudder authority */
  turnRate: number;
  /** max visual heel, radians */
  maxHeel: number;
  /** how quickly heel responds */
  heelRate: number;
  /** geometry */
  length: number;
  mastHeight: number;
  mastZ: number; // mast position along centerline (+Z = bow)
  mainFoot: number;
  boomHeight: number;
  jibHoist: number; // fraction of mast height the forestay reaches
  /** 0..1 bars for the menu */
  stats: { speed: number; accel: number; handling: number };
}

export const BOAT_SPECS: Record<HullType, BoatSpec> = {
  mono: {
    id: 'mono',
    name: 'TEMPEST 30',
    typeLabel: 'MONOHULL SLOOP',
    color: 0xff5c39,
    sailPower: 7.2,
    spinPower: 4.6,
    dragK: 0.062,
    dragL: 0.11,
    turnRate: 1.55,
    maxHeel: 0.30,
    heelRate: 2.2,
    length: 8,
    mastHeight: 10,
    mastZ: 0.9,
    mainFoot: 3.6,
    boomHeight: 1.35,
    jibHoist: 0.82,
    stats: { speed: 0.55, accel: 0.6, handling: 0.9 },
  },
  cat: {
    id: 'cat',
    name: 'VAPOR F40',
    typeLabel: 'CATAMARAN',
    color: 0x22d3ee,
    sailPower: 10.5,
    spinPower: 6.6,
    dragK: 0.040,
    dragL: 0.09,
    turnRate: 1.1,
    maxHeel: 0.16,
    heelRate: 1.4,
    length: 7.6,
    mastHeight: 11.5,
    mastZ: 0.4,
    mainFoot: 4.0,
    boomHeight: 1.5,
    jibHoist: 0.78,
    stats: { speed: 1.0, accel: 0.75, handling: 0.55 },
  },
  tri: {
    id: 'tri',
    name: 'HELIX TRI',
    typeLabel: 'TRIMARAN',
    color: 0xffd12e,
    sailPower: 9.2,
    spinPower: 5.8,
    dragK: 0.047,
    dragL: 0.095,
    turnRate: 1.3,
    maxHeel: 0.24,
    heelRate: 1.7,
    length: 8.4,
    mastHeight: 11,
    mastZ: 0.6,
    mainFoot: 3.8,
    boomHeight: 1.45,
    jibHoist: 0.8,
    stats: { speed: 0.88, accel: 0.9, handling: 0.7 },
  },
};

/** liveries for AI boats so the fleet reads distinctly */
export const AI_COLORS = [0xa78bfa, 0x4dffa6, 0xff7ab8, 0xffffff];
