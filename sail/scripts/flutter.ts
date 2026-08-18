// Measures sail-cloth agitation: per-frame mean particle displacement after
// the boat settles on a steady course. Trimmed sail should be near-still;
// a luffing sail should shake hard.
import { Boat } from '../src/boat.ts';
import { BOAT_SPECS } from '../src/specs.ts';
import { Wind } from '../src/wind.ts';
import { clamp, wrapAngle } from '../src/util.ts';

import * as THREE from 'three';

function agitation(twa: number, trimMode: 'optimal' | 'eased'): { agit: number; luff: number; speed: number } {
  const wind = new Wind();
  const boat = new Boat(BOAT_SPECS.mono);
  boat.place(0, 0, 0);
  const dt = 1 / 60;
  let t = 0;
  const cloth = (boat as any).main;
  const pos: Float32Array = cloth.pos;
  const inv = new THREE.Matrix4();
  const v = new THREE.Vector3();
  let prevLocal: Float32Array | null = null;
  let acc = 0;
  let samples = 0;

  for (let i = 0; i < 60 * 30; i++) {
    t += dt;
    const target = wrapAngle(wind.from + (twa * Math.PI) / 180);
    boat.steer = clamp(wrapAngle(target - boat.heading) * 3, -1, 1);
    const wantTrim = trimMode === 'optimal' ? boat.optimalTrim : 1.0;
    boat.trimInput = clamp((wantTrim - boat.trim) * 12, -1, 1);
    boat.update(dt, wind, t);

    if (i > 60 * 20) {
      // measure cloth motion in the BOAT frame so hull motion doesn't count
      inv.copy(boat.group.matrixWorld).invert();
      const local = new Float32Array(pos.length);
      for (let j = 0; j < pos.length; j += 3) {
        v.set(pos[j]!, pos[j + 1]!, pos[j + 2]!).applyMatrix4(inv);
        local[j] = v.x;
        local[j + 1] = v.y;
        local[j + 2] = v.z;
      }
      if (prevLocal) {
        let sum = 0;
        for (let j = 0; j < local.length; j += 3) {
          sum += Math.hypot(local[j]! - prevLocal[j]!, local[j + 1]! - prevLocal[j + 1]!, local[j + 2]! - prevLocal[j + 2]!);
        }
        acc += sum / (local.length / 3);
        samples++;
      }
      prevLocal = local;
    }
  }
  return { agit: acc / samples, luff: boat.luffing, speed: boat.speed };
}

const good = agitation(100, 'optimal'); // beam reach, perfect trim
const bad = agitation(50, 'eased'); // close reach with sheets dumped = luffing
console.log(`trimmed:  agitation ${(good.agit * 1000).toFixed(2)} mm/frame  luffing=${good.luff.toFixed(2)} speed=${good.speed.toFixed(1)}`);
console.log(`luffing:  agitation ${(bad.agit * 1000).toFixed(2)} mm/frame  luffing=${bad.luff.toFixed(2)} speed=${bad.speed.toFixed(1)}`);
console.log(`ratio: ${(bad.agit / good.agit).toFixed(1)}x`);
