import * as THREE from 'three';

/**
 * Verlet cloth simulating one sail. The grid is tapered: full chord at the
 * foot, `headRatio` of the chord at the head (a modern square-top sail).
 *
 * u (cols) runs luff -> leech, v (rows) runs foot -> head.
 * The luff column is pinned to the mast/forestay each frame; the clew
 * (u = max, v = 0) is pinned to the boom end / sheet point.
 */

const GRAVITY = -3.2; // sails are light; just enough to drape when becalmed
// heavy velocity damping: sailcloth in airflow dissipates fast, so a
// well-trimmed sail settles into a steady billow instead of shimmering
const DAMPING = 0.9;
const ITERATIONS = 5;

interface Constraint {
  a: number;
  b: number;
  rest: number;
}

export class SailCloth {
  readonly cols: number;
  readonly rows: number;
  readonly geometry: THREE.BufferGeometry;

  private pos: Float32Array;
  private prev: Float32Array;
  private pinned: Uint8Array;
  private constraints: Constraint[] = [];
  private tris: number[] = []; // flat triples of particle indices
  private posAttr: THREE.BufferAttribute;
  private placed = false;
  private windK: number;
  private time = Math.random() * 100;
  // optional half-space constraint: particles stay on the +normal side
  private clampPoint: THREE.Vector3 | null = null;
  private clampNormal = new THREE.Vector3();

  /** chord length at row v (0..1) as a fraction of foot chord */
  private chordAt(v: number): number {
    return 1 - (1 - this.headRatio) * v;
  }

  constructor(
    cols = 6,
    rows = 8,
    private headRatio = 0.35,
    windStrength = 1.0,
    private camber = 1.04,
    pinning: 'luff' | 'corners' = 'luff',
  ) {
    this.cols = cols;
    this.rows = rows;
    // effective accel ≈ 2·windK·v² — strong pressure keeps the cloth taut
    // against its constraints (an under-inflated sail wobbles like a flag)
    this.windK = 1.6 * windStrength;
    const n = cols * rows;
    this.pos = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.pinned = new Uint8Array(n);

    if (pinning === 'luff') {
      // whole luff column, plus the clew corner
      for (let r = 0; r < rows; r++) this.pinned[this.idx(0, r)] = 1;
      this.pinned[this.idx(cols - 1, 0)] = 1;
    } else {
      // spinnaker: three corners only — tack, clew, head
      this.pinned[this.idx(0, 0)] = 1;
      this.pinned[this.idx(cols - 1, 0)] = 1;
      this.pinned[this.idx(0, rows - 1)] = 1;
    }

    // Constraints in normalized (u, chord-scaled) space; rest lengths are
    // finalized in place() from the real layout, with a little extra cloth
    // horizontally so the sail carries a natural draft (belly).
    const link = (a: number, b: number) => this.constraints.push({ a, b, rest: 0 });
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = this.idx(c, r);
        if (c + 1 < cols) link(i, this.idx(c + 1, r));
        if (r + 1 < rows) link(i, this.idx(c, r + 1));
        if (c + 1 < cols && r + 1 < rows) {
          link(i, this.idx(c + 1, r + 1));
          link(this.idx(c + 1, r), this.idx(c, r + 1));
        }
        // bend constraints keep the surface from folding like paper
        if (c + 2 < cols) link(i, this.idx(c + 2, r));
        if (r + 2 < rows) link(i, this.idx(c, r + 2));
      }
    }

    // Triangles for rendering + wind sampling.
    const indices: number[] = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = this.idx(c, r);
        const b = this.idx(c + 1, r);
        const cc = this.idx(c + 1, r + 1);
        const d = this.idx(c, r + 1);
        indices.push(a, b, d, b, cc, d);
        this.tris.push(a, b, d, b, cc, d);
      }
    }

    this.geometry = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('position', this.posAttr);
    // uvs for subtle shading in the material
    const uvs = new Float32Array(n * 2);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        uvs[this.idx(c, r) * 2] = c / (cols - 1);
        uvs[this.idx(c, r) * 2 + 1] = r / (rows - 1);
      }
    }
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.geometry.setIndex(indices);
  }

  idx(c: number, r: number): number {
    return r * this.cols + c;
  }

  /** Lay the cloth out flat between the luff line and clew; sets rest lengths. */
  place(luffBottom: THREE.Vector3, luffTop: THREE.Vector3, clew: THREE.Vector3): void {
    const chordDir = new THREE.Vector3().subVectors(clew, luffBottom);
    const footChord = chordDir.length();
    chordDir.normalize();
    const p = new THREE.Vector3();
    for (let r = 0; r < this.rows; r++) {
      const v = r / (this.rows - 1);
      const chord = footChord * this.chordAt(v);
      for (let c = 0; c < this.cols; c++) {
        const u = c / (this.cols - 1);
        p.lerpVectors(luffBottom, luffTop, v).addScaledVector(chordDir, u * chord);
        const i = this.idx(c, r) * 3;
        this.pos[i] = this.prev[i] = p.x;
        this.pos[i + 1] = this.prev[i + 1] = p.y;
        this.pos[i + 2] = this.prev[i + 2] = p.z;
      }
    }
    // Rest lengths from this flat layout; extra horizontal cloth = draft.
    const pa = new THREE.Vector3();
    const pb = new THREE.Vector3();
    for (const cst of this.constraints) {
      this.get(cst.a, pa);
      this.get(cst.b, pb);
      const horizontal = Math.abs((cst.a % this.cols) - (cst.b % this.cols)) > 0;
      cst.rest = pa.distanceTo(pb) * (horizontal ? this.camber : 1.005);
    }
    this.placed = true;
    this.posAttr.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  get isPlaced(): boolean {
    return this.placed;
  }

  private get(i: number, out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos[i * 3]!, this.pos[i * 3 + 1]!, this.pos[i * 3 + 2]!);
  }

  /** Pin the luff column along a line (call every frame with world coords). */
  setLuff(bottom: THREE.Vector3, top: THREE.Vector3): void {
    for (let r = 0; r < this.rows; r++) {
      const t = r / (this.rows - 1);
      const i = this.idx(0, r) * 3;
      this.pos[i] = bottom.x + (top.x - bottom.x) * t;
      this.pos[i + 1] = bottom.y + (top.y - bottom.y) * t;
      this.pos[i + 2] = bottom.z + (top.z - bottom.z) * t;
    }
  }

  setClew(p: THREE.Vector3): void {
    const i = this.idx(this.cols - 1, 0) * 3;
    this.pos[i] = p.x;
    this.pos[i + 1] = p.y;
    this.pos[i + 2] = p.z;
  }

  /**
   * Constrain all free particles to the +normal side of a plane (call every
   * frame with world coords, or with null to disable). Used to keep the
   * spinnaker forward of the mast so it can't blow back through the main.
   */
  setClampPlane(point: THREE.Vector3 | null, normal?: THREE.Vector3): void {
    if (!point || !normal) {
      this.clampPoint = null;
      return;
    }
    this.clampPoint = (this.clampPoint ?? new THREE.Vector3()).copy(point);
    this.clampNormal.copy(normal);
  }

  /** corner-pinned mode: place the three pins (tack, clew, head) */
  setCorners(tack: THREE.Vector3, clew: THREE.Vector3, head: THREE.Vector3): void {
    const write = (idx: number, p: THREE.Vector3) => {
      const i = idx * 3;
      this.pos[i] = p.x;
      this.pos[i + 1] = p.y;
      this.pos[i + 2] = p.z;
    };
    write(this.idx(0, 0), tack);
    write(this.idx(this.cols - 1, 0), clew);
    write(this.idx(0, this.rows - 1), head);
  }

  /**
   * Advance the cloth. `windVel` is the apparent wind at the boat (world),
   * `flog` in [0,1] adds the chaotic shake of a luffing sail.
   */
  step(dt: number, windVel: THREE.Vector3, flog: number): void {
    if (!this.placed) return;
    this.time += dt;
    const { pos, prev, pinned } = this;
    const n = pinned.length;

    // --- integrate ---
    const dt2 = dt * dt;
    const vMax = 22 * dt; // hard speed limit keeps the sim from ever diverging
    for (let i = 0; i < n; i++) {
      if (pinned[i]) continue;
      const j = i * 3;
      let fx = 0;
      let fy = GRAVITY;
      let fz = 0;
      if (flog > 0.02) {
        // turbulent buffeting when the sail is luffing — has to punch through
        // the heavy aero damping, so it's strong
        const ph = i * 1.7 + this.time * 26;
        const s = flog * 160;
        fx += Math.sin(ph) * s;
        fz += Math.cos(ph * 1.31 + 2) * s;
      }
      const x = pos[j]!;
      const y = pos[j + 1]!;
      const z = pos[j + 2]!;
      let vx = (x - prev[j]!) * DAMPING;
      let vy = (y - prev[j + 1]!) * DAMPING;
      let vz = (z - prev[j + 2]!) * DAMPING;
      const v2 = vx * vx + vy * vy + vz * vz;
      if (v2 > vMax * vMax) {
        const s = vMax / Math.sqrt(v2);
        vx *= s;
        vy *= s;
        vz *= s;
      }
      pos[j] = x + vx + fx * dt2;
      pos[j + 1] = y + vy + fy * dt2;
      pos[j + 2] = z + vz + fz * dt2;
      prev[j] = x;
      prev[j + 1] = y;
      prev[j + 2] = z;
    }

    // --- wind: dynamic pressure along each triangle's normal ---
    // accel = n̂ * (n̂·v_rel)|n̂·v_rel| * k, where v_rel subtracts the cloth's
    // own motion — that aerodynamic damping is what lets a well-trimmed sail
    // settle into a steady billow instead of pumping forever.
    const tris = this.tris;
    const k = (this.windK * dt2) / 3;
    const invDt = 1 / dt;
    for (let t = 0; t < tris.length; t += 3) {
      const ia = tris[t]! * 3;
      const ib = tris[t + 1]! * 3;
      const ic = tris[t + 2]! * 3;
      const ax = pos[ia]!;
      const ay = pos[ia + 1]!;
      const az = pos[ia + 2]!;
      const ux = pos[ib]! - ax;
      const uy = pos[ib + 1]! - ay;
      const uz = pos[ib + 2]! - az;
      const vx = pos[ic]! - ax;
      const vy = pos[ic + 1]! - ay;
      const vz = pos[ic + 2]! - az;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      // triangle velocity (average of its verts, from Verlet history)
      const cvx = (pos[ia]! - prev[ia]! + pos[ib]! - prev[ib]! + pos[ic]! - prev[ic]!) * (invDt / 3);
      const cvy =
        (pos[ia + 1]! - prev[ia + 1]! + pos[ib + 1]! - prev[ib + 1]! + pos[ic + 1]! - prev[ic + 1]!) * (invDt / 3);
      const cvz =
        (pos[ia + 2]! - prev[ia + 2]! + pos[ib + 2]! - prev[ib + 2]! + pos[ic + 2]! - prev[ic + 2]!) * (invDt / 3);
      const d = nx * (windVel.x - cvx) + ny * (windVel.y - cvy) + nz * (windVel.z - cvz);
      // cap the pressure impulse — quadratic force on relative velocity can
      // run away in Verlet if a triangle ever gets moving fast
      let f = d * Math.abs(d) * k;
      if (f > 0.05) f = 0.05;
      else if (f < -0.05) f = -0.05;
      const fx = nx * f;
      const fy = ny * f;
      const fz = nz * f;
      if (!pinned[ia / 3]) {
        pos[ia] += fx;
        pos[ia + 1] += fy;
        pos[ia + 2] += fz;
      }
      if (!pinned[ib / 3]) {
        pos[ib] += fx;
        pos[ib + 1] += fy;
        pos[ib + 2] += fz;
      }
      if (!pinned[ic / 3]) {
        pos[ic] += fx;
        pos[ic + 1] += fy;
        pos[ic + 2] += fz;
      }
    }

    // --- satisfy constraints ---
    const cs = this.constraints;
    for (let iter = 0; iter < ITERATIONS; iter++) {
      for (let ci = 0; ci < cs.length; ci++) {
        const c = cs[ci]!;
        const ja = c.a * 3;
        const jb = c.b * 3;
        const dx = pos[jb]! - pos[ja]!;
        const dy = pos[jb + 1]! - pos[ja + 1]!;
        const dz = pos[jb + 2]! - pos[ja + 2]!;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const diff = (dist - c.rest) / dist;
        const pa = pinned[c.a]!;
        const pb = pinned[c.b]!;
        if (pa && pb) continue;
        const wa = pa ? 0 : pb ? 1 : 0.5;
        const wb = pa ? 1 : pb ? 0 : 0.5;
        // only correct half as hard on bend constraints (longer rest)
        const s = diff * 0.9;
        pos[ja] += dx * s * wa;
        pos[ja + 1] += dy * s * wa;
        pos[ja + 2] += dz * s * wa;
        pos[jb] -= dx * s * wb;
        pos[jb + 1] -= dy * s * wb;
        pos[jb + 2] -= dz * s * wb;
      }
    }

    // --- half-space clamp (keeps the kite clear of the main) ---
    if (this.clampPoint) {
      const cp = this.clampPoint;
      const cn = this.clampNormal;
      for (let i = 0; i < n; i++) {
        if (pinned[i]) continue;
        const j = i * 3;
        const d =
          (pos[j]! - cp.x) * cn.x + (pos[j + 1]! - cp.y) * cn.y + (pos[j + 2]! - cp.z) * cn.z;
        if (d < 0) {
          pos[j]! -= cn.x * d;
          pos[j + 1]! -= cn.y * d;
          pos[j + 2]! -= cn.z * d;
        }
      }
    }

    this.posAttr.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
}
