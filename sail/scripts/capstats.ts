// One-off stats for whitecap tuning: what fraction of probes land on a
// breaking crest over deep water, and roughly how many particles are live.
import { bedAt } from '../src/seabed';
import { waveHeight } from '../src/water';

let deep = 0;
let crest = 0;
let both = 0;
const N = 200000;
for (let i = 0; i < N; i++) {
  const x = (Math.random() - 0.5) * 500;
  const z = (Math.random() - 0.5) * 500;
  const t = Math.random() * 400;
  const d = bedAt(x, z) < 0.52;
  const c = waveHeight(x, z, t) > 1.0;
  if (d) deep++;
  if (c) crest++;
  if (d && c) both++;
}
console.log('deep fraction  ', (deep / N).toFixed(3));
console.log('crest fraction ', (crest / N).toFixed(3));
console.log('accept fraction', (both / N).toFixed(3));

// emission model: 700 probes/s * accept * P(gate) with breeze≈0.6 → clusters/s
const acc = both / N;
const clustersPerSec = 700 * acc * 0.6 * 0.5;
const live = clustersPerSec * 6.5 * 1.25; // avg cluster size * avg life
console.log('clusters/s ≈', clustersPerSec.toFixed(1), ' live particles ≈', live.toFixed(0));

// bed distribution sanity (shader thresholds: 0.34 trench, 0.60 sand)
let lo = 0, hi = 0;
for (let i = 0; i < N; i++) {
  const b = bedAt((Math.random() - 0.5) * 1000, (Math.random() - 0.5) * 1000);
  if (b < 0.34) lo++;
  if (b > 0.6) hi++;
}
console.log('trench frac', (lo / N).toFixed(3), ' sandbank frac', (hi / N).toFixed(3));
