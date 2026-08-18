// Physics tuning harness: node --experimental-strip-types scripts/tune.ts
// Simulates each boat sailing a fixed true-wind angle with auto-trim and
// prints the equilibrium speed — a "polar table" for balancing the specs.
import { Boat } from '../src/boat.ts';
import { BOAT_SPECS, type HullType } from '../src/specs.ts';
import { Wind } from '../src/wind.ts';
import { clamp, wrapAngle } from '../src/util.ts';

const wind = new Wind();
const dt = 1 / 60;
const angles = [40, 50, 60, 90, 120, 150, 180];

console.log(`wind ~${wind.speed.toFixed(1)} m/s\n`);
console.log('TWA°  ' + (Object.keys(BOAT_SPECS) as HullType[]).map((t) => t.padStart(6)).join(' '));

for (const twa of angles) {
  const row: string[] = [];
  for (const type of Object.keys(BOAT_SPECS) as HullType[]) {
    const boat = new Boat(BOAT_SPECS[type]);
    boat.place(0, 0, 0);
    let t = 0;
    for (let i = 0; i < 60 * 45; i++) {
      t += dt;
      const target = wrapAngle(wind.from + (twa * Math.PI) / 180);
      const err = wrapAngle(target - boat.heading);
      boat.steer = clamp(err * 3, -1, 1);
      boat.trimInput = clamp((boat.optimalTrim - boat.trim) * 12, -1, 1);
      boat.update(dt, wind, t);
    }
    row.push(boat.speed.toFixed(2).padStart(6));
  }
  console.log(String(twa).padStart(3) + '   ' + row.join(' '));
}
