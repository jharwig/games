// Dump rig pose after 30s of AI sailing — sanity check mast/sail geometry.
import { AiSkipper } from '../src/ai.ts';
import { Boat } from '../src/boat.ts';
import { Course } from '../src/course.ts';
import { BOAT_SPECS } from '../src/specs.ts';
import { Wind } from '../src/wind.ts';

const wind = new Wind();
const course = new Course();
const boat = new Boat(BOAT_SPECS.mono);
const skipper = new AiSkipper(boat, 0);
const spawn = course.spawnPositions(1)[0]!;
boat.place(spawn.x, spawn.z, spawn.heading);

const dt = 1 / 60;
let t = 0;
for (let i = 0; i < 60 * 30; i++) {
  t += dt;
  skipper.update(dt, wind, course, t);
  boat.update(dt, wind, t);
  if (i % 120 === 0) {
    console.log(
      `t=${t.toFixed(1)} hdg=${((boat.heading * 180) / Math.PI).toFixed(0)} ` +
        `windFrom=${((wind.from * 180) / Math.PI).toFixed(0)} steer=${boat.steer.toFixed(2)} ` +
        `gamma=${((boat.apparentAngle * 180) / Math.PI).toFixed(0)} u=${boat.speed.toFixed(1)} ` +
        `luff=${boat.luffing.toFixed(1)} trim=${boat.trim.toFixed(2)} opt=${boat.optimalTrim.toFixed(2)}`,
    );
  }
}

console.log('heading(deg)', ((boat.heading * 180) / Math.PI).toFixed(1));
console.log('heel(deg)', ((boat.heel * 180) / Math.PI).toFixed(1));
console.log('speed', boat.speed.toFixed(2), 'trim', boat.trim.toFixed(2), 'luffing', boat.luffing.toFixed(2));
console.log('apparent angle(deg)', ((boat.apparentAngle * 180) / Math.PI).toFixed(1));

// sample the main sail cloth: luff bottom/top and leech positions
const geo = (boat as any).main.geometry;
const pos = geo.getAttribute('position');
const cols = (boat as any).main.cols;
const rows = (boat as any).main.rows;
const pt = (c: number, r: number) => {
  const i = r * cols + c;
  return `(${pos.getX(i).toFixed(1)}, ${pos.getY(i).toFixed(1)}, ${pos.getZ(i).toFixed(1)})`;
};
console.log('boat pos', `(${boat.pos.x.toFixed(1)}, ${boat.pos.z.toFixed(1)})`);
console.log('main luff bottom', pt(0, 0), 'luff top', pt(0, rows - 1));
console.log('main clew', pt(cols - 1, 0), 'leech mid', pt(cols - 1, Math.floor(rows / 2)), 'head', pt(cols - 1, rows - 1));
