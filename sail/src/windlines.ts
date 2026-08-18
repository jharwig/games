import * as THREE from 'three';
import { FlatRibbons } from './ribbons';
import type { Wind } from './wind';

const COUNT = 52;
const POINTS = 10;
const AREA = 85; // half-size of the spawn box around the camera target

interface Streak {
  x: number;
  z: number;
  age: number;
  life: number;
  phase: number;
  wiggle: number;
}

/**
 * Animated wind streaks skating across the water — the primary read for
 * wind direction. Each streak's head advects downwind with a sinusoidal
 * side-slip; a fading tail trails behind it.
 */
export class WindLines {
  readonly ribbons: FlatRibbons;
  private streaks: Streak[] = [];
  private tmp = new THREE.Vector3();

  constructor() {
    // float above the tallest animated wave crests so streaks never clip
    this.ribbons = new FlatRibbons(COUNT, POINTS, new THREE.Color(0xbfe8ff), 0.95);
    for (let i = 0; i < COUNT; i++) {
      this.streaks.push(this.spawn(0, 0, true));
    }
  }

  private spawn(cx: number, cz: number, scatterAge = false): Streak {
    return {
      x: cx + (Math.random() * 2 - 1) * AREA,
      z: cz + (Math.random() * 2 - 1) * AREA,
      age: scatterAge ? Math.random() * 5 : 0,
      life: 3.5 + Math.random() * 3,
      phase: Math.random() * Math.PI * 2,
      wiggle: 0.8 + Math.random() * 1.6,
    };
  }

  update(dt: number, wind: Wind, center: THREE.Vector3): void {
    const xs: number[] = new Array(POINTS);
    const zs: number[] = new Array(POINTS);
    const ws: number[] = new Array(POINTS);
    const as: number[] = new Array(POINTS);

    for (let i = 0; i < this.streaks.length; i++) {
      const s = this.streaks[i]!;
      s.age += dt;
      const wv = wind.velocityAt(this.tmp.set(s.x, 0, s.z), this.tmp);
      const speed = Math.hypot(wv.x, wv.z);
      s.x += wv.x * dt * 1.15;
      s.z += wv.z * dt * 1.15;

      const off = Math.hypot(s.x - center.x, s.z - center.z);
      if (s.age > s.life || off > AREA * 1.45) {
        this.streaks[i] = this.spawn(center.x, center.z);
        continue;
      }

      // life envelope
      const t01 = s.age / s.life;
      const env = Math.min(1, t01 * 6) * Math.min(1, (1 - t01) * 4);

      // build the tail: sample back along the wind with a sine side-slip
      const dirx = wv.x / (speed || 1);
      const dirz = wv.z / (speed || 1);
      const perpx = -dirz;
      const perpz = dirx;
      const tailLen = 10 + speed * 1.6;
      for (let p = 0; p < POINTS; p++) {
        const q = p / (POINTS - 1); // 0 head -> 1 tail
        const back = q * tailLen;
        const sway = Math.sin(s.phase + s.age * 3.0 + q * 3.5) * s.wiggle * q;
        xs[p] = s.x - dirx * back + perpx * sway;
        zs[p] = s.z - dirz * back + perpz * sway;
        ws[p] = 0.55 * (1 - q * 0.7);
        as[p] = env * 0.6 * (1 - q) * (0.4 + 0.6 * Math.min(1, speed / 8));
      }
      this.ribbons.setRibbon(i, xs, zs, ws, as);
    }
    this.ribbons.commit();
  }
}
