// Headless AI-only race incl. pre-start & OCS rules; validates both layouts.
// Usage: bundle with esbuild, then `node airace.mjs [wl|tri]`
import { AiSkipper } from '../src/ai.ts';
import { Boat } from '../src/boat.ts';
import { Course, type CourseType } from '../src/course.ts';
import { BOAT_SPECS, type HullType } from '../src/specs.ts';
import { Wind } from '../src/wind.ts';

const layout = (process.argv[2] ?? 'wl') as CourseType;
const wind = new Wind();
const course = new Course(layout);
const types: HullType[] = ['mono', 'cat', 'tri', 'cat'];
const boats = types.map((t) => new Boat(BOAT_SPECS[t]));
const skippers = boats.map((b, i) => new AiSkipper(b, i - 1.5));
const spawns = course.spawnPositions(boats.length);
boats.forEach((b, i) => b.place(spawns[i]!.x, spawns[i]!.z, spawns[i]!.heading));

console.log(`layout: ${layout}, ${course.gates.length} gates, ${course.totalLaps} laps`);

const dt = 1 / 60;
let t = 0;
const finished: string[] = [];

// ---- pre-start (15s) ----
let countdown = 15;
while (countdown > 0) {
  countdown -= dt;
  t += dt;
  wind.update(dt);
  for (let i = 0; i < boats.length; i++) {
    skippers[i]!.preStart(dt, wind, course, t, countdown);
    boats[i]!.update(dt, wind, t);
  }
}
let ocsCount = 0;
for (const b of boats) {
  if (course.startLineSide(b) >= 0) {
    b.ocs = true;
    ocsCount++;
  }
}
console.log(`gun! OCS at start: ${ocsCount}/${boats.length}`);

// ---- race ----
let raceTime = 0;
const maxT = 600;
const traceIdx = process.env.TRACE ? Number(process.env.TRACE) : -1;
let lastTrace = 0;
while (raceTime < maxT && finished.length < boats.length) {
  raceTime += dt;
  t += dt;
  wind.update(dt);
  if (traceIdx >= 0 && raceTime - lastTrace > 5) {
    lastTrace = raceTime;
    const b = boats[traceIdx]!;
    console.log(
      `TRACE t=${raceTime.toFixed(0)} pos=(${b.pos.x.toFixed(0)},${b.pos.z.toFixed(0)}) hdg=${((b.heading * 180) / Math.PI).toFixed(0)} u=${b.speed.toFixed(1)} gate=${b.nextGate} lap=${b.lap} steer=${b.steer.toFixed(1)} spin=${b.spinDeploy.toFixed(1)} luff=${b.luffing.toFixed(1)} gamma=${((b.apparentAngle * 180) / Math.PI).toFixed(0)}`,
    );
  }
  for (let i = 0; i < boats.length; i++) {
    const b = boats[i]!;
    skippers[i]!.update(dt, wind, course, t);
    b.update(dt, wind, t);
    if (b.ocs && course.startLineSide(b) < -1) {
      b.ocs = false;
      course.forget(b);
      console.log(`t=${raceTime.toFixed(0)}s boat${i} cleared OCS`);
    }
    if (!b.finished) {
      const ev = course.track(b, raceTime);
      if (ev === 'lap') console.log(`t=${raceTime.toFixed(0)}s boat${i}(${types[i]}) lap ${b.lap}/${course.totalLaps} spi=${b.spinDeploy.toFixed(1)}`);
      if (ev === 'finish') {
        console.log(`t=${raceTime.toFixed(0)}s boat${i}(${types[i]}) FINISHED  best lap ${b.bestLap.toFixed(1)}s`);
        finished.push(types[i]!);
      }
    }
  }
  for (const b of boats) {
    for (const isl of course.islands) {
      const dx = b.pos.x - isl.x;
      const dz = b.pos.z - isl.z;
      const d = Math.hypot(dx, dz);
      if (d < isl.r + 1.6 && d > 0.001) {
        b.pos.x = isl.x + (dx / d) * (isl.r + 1.6);
        b.pos.z = isl.z + (dz / d) * (isl.r + 1.6);
      }
    }
  }
}

console.log(`\ndone at t=${raceTime.toFixed(0)}s; finished: ${finished.length}/${boats.length}`);
for (let i = 0; i < boats.length; i++) {
  const b = boats[i]!;
  console.log(
    `boat${i} (${types[i]}): lap ${b.lap} gate ${b.nextGate} ocs=${b.ocs} pos (${b.pos.x.toFixed(0)}, ${b.pos.z.toFixed(0)}) finished=${b.finished}`,
  );
}
