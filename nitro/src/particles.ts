// =============================================================================
// pooled cartoon particle system: one InstancedMesh of small cubes (~600),
// vertex-coloured, no textures. Every emitter grabs dead slots out of the pool,
// so nothing is allocated per frame. Call update(dt) once a frame.
// =============================================================================
import * as THREE from 'three';

const MAX = 600;

/** Which spin/physics flavour a particle uses. */
const Kind = { Chunk: 0, Spark: 1, Flame: 2, Confetti: 3, Splash: 4 } as const;
type Kind = (typeof Kind)[keyof typeof Kind];

interface P {
  alive: boolean;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  rx: number; ry: number; rz: number;   // rotation
  sx: number; sy: number; sz: number;   // spin rate
  life: number; max: number;
  size: number; grow: number;
  gravity: number; drag: number;
  kind: Kind;
  r: number; g: number; b: number;
}

function makeP(): P {
  return {
    alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    rx: 0, ry: 0, rz: 0, sx: 0, sy: 0, sz: 0,
    life: 0, max: 1, size: 0.2, grow: 0, gravity: -9.8, drag: 1.2,
    kind: Kind.Chunk, r: 1, g: 1, b: 1,
  };
}

/** Track-surface dust colours, keyed by TrackId (plain strings — no import). */
export const DUST_COLORS: Record<string, number> = {
  speedway: 0xbfc4cf, beach: 0xf0d9a0, dirt: 0x9a7448,
  ice: 0xeaf6ff, volcano: 0x6a5a58, space: 0x7f8ae0,
};

export class Particles {
  private readonly pool: P[] = [];
  private readonly mesh: THREE.InstancedMesh;
  private readonly geo: THREE.BoxGeometry;
  private readonly matl: THREE.MeshBasicMaterial;
  private cursor = 0;

  // scratch — reused every frame, never reallocated
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();
  private readonly col = new THREE.Color();

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < MAX; i++) this.pool.push(makeP());
    this.geo = new THREE.BoxGeometry(1, 1, 1);
    this.matl = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(this.geo, this.matl, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.count = MAX;
    // start every instance collapsed so nothing shows before the first update
    this.m4.makeScale(0, 0, 0);
    for (let i = 0; i < MAX; i++) {
      this.mesh.setMatrixAt(i, this.m4);
      this.mesh.setColorAt(i, this.col.setRGB(1, 1, 1));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    scene.add(this.mesh);
  }

  /** Next free slot, recycling the oldest if the pool is saturated. */
  private take(): P {
    for (let i = 0; i < MAX; i++) {
      const p = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % MAX;
      if (!p.alive) return p;
    }
    const p = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % MAX;
    return p;
  }

  private spawn(
    x: number, y: number, z: number, color: number, kind: Kind,
    size: number, life: number, gravity: number, drag: number,
  ): P {
    const p = this.take();
    p.alive = true;
    p.x = x; p.y = y; p.z = z;
    p.vx = 0; p.vy = 0; p.vz = 0;
    p.rx = Math.random() * 6.28; p.ry = Math.random() * 6.28; p.rz = Math.random() * 6.28;
    p.sx = 0; p.sy = 0; p.sz = 0;
    p.life = life; p.max = life;
    p.size = size; p.grow = 0;
    p.gravity = gravity; p.drag = drag;
    p.kind = kind;
    this.col.setHex(color);
    p.r = this.col.r; p.g = this.col.g; p.b = this.col.b;
    return p;
  }

  private tint(p: P, color: number, jitter: number): void {
    this.col.setHex(color);
    const j = 1 + (Math.random() - 0.5) * jitter;
    p.r = this.col.r * j; p.g = this.col.g * j; p.b = this.col.b * j;
  }

  // ---- emitters ------------------------------------------------------------

  /**
   * Wheel spray. dirX/dirZ is the direction the dust is thrown (usually the
   * car's backwards vector); `off` throws bigger, slower clods.
   */
  dust(x: number, y: number, z: number, dirX: number, dirZ: number, surface: 'road' | 'off', color = 0xbfc4cf): void {
    const n = surface === 'off' ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const spd = surface === 'off' ? 3 + Math.random() * 5 : 2 + Math.random() * 3;
      const p = this.spawn(
        x + (Math.random() - 0.5) * 0.4, y + Math.random() * 0.2, z + (Math.random() - 0.5) * 0.4,
        color, Kind.Chunk,
        surface === 'off' ? 0.18 + Math.random() * 0.18 : 0.12 + Math.random() * 0.12,
        surface === 'off' ? 0.75 : 0.5,
        surface === 'off' ? -11 : -3.5, surface === 'off' ? 1.4 : 2.6,
      );
      p.vx = dirX * spd + (Math.random() - 0.5) * 2.2;
      p.vz = dirZ * spd + (Math.random() - 0.5) * 2.2;
      p.vy = 1.4 + Math.random() * (surface === 'off' ? 3.4 : 1.6);
      p.grow = surface === 'off' ? 0.1 : 0.35;
      p.sx = (Math.random() - 0.5) * 9; p.sy = (Math.random() - 0.5) * 9; p.sz = (Math.random() - 0.5) * 9;
      this.tint(p, color, 0.3);
    }
  }

  /** Sparkle ring thrown outwards when a coin is collected. */
  coinBurst(x: number, y: number, z: number, color: number): void {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + Math.random() * 0.3;
      const spd = 4 + Math.random() * 3;
      const p = this.spawn(x, y, z, color, Kind.Spark, 0.13 + Math.random() * 0.1, 0.5 + Math.random() * 0.25, -5, 1.6);
      p.vx = Math.cos(a) * spd;
      p.vz = Math.sin(a) * spd;
      p.vy = 2 + Math.random() * 3.5;
      p.grow = -0.5;
      p.sx = (Math.random() - 0.5) * 14; p.sy = (Math.random() - 0.5) * 14;
      this.tint(p, color, 0.35);
    }
  }

  /** Exhaust flames while boosting — call every frame the boost is on. */
  boostFlames(x: number, y: number, z: number, headingBackX: number, headingBackZ: number): void {
    for (let i = 0; i < 3; i++) {
      const hot = Math.random() < 0.4;
      const spd = 5 + Math.random() * 7;
      const p = this.spawn(
        x + (Math.random() - 0.5) * 0.5, y + (Math.random() - 0.5) * 0.25, z + (Math.random() - 0.5) * 0.5,
        hot ? 0x74c8ff : 0xff9a2a, Kind.Flame,
        0.2 + Math.random() * 0.18, 0.24 + Math.random() * 0.16, 1.5, 4.5,
      );
      p.vx = headingBackX * spd + (Math.random() - 0.5) * 1.6;
      p.vz = headingBackZ * spd + (Math.random() - 0.5) * 1.6;
      p.vy = 0.4 + Math.random();
      p.grow = 1.1;
      p.sy = (Math.random() - 0.5) * 12;
      this.tint(p, hot ? 0x8ad4ff : 0xffb03a, 0.35);
    }
  }

  /** Small grey chunks — bumping a cone / wall. */
  hitBurst(x: number, y: number, z: number): void {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, spd = 2 + Math.random() * 5;
      const p = this.spawn(x, y, z, 0x9aa0ad, Kind.Chunk, 0.14 + Math.random() * 0.14, 0.6 + Math.random() * 0.3, -13, 1.1);
      p.vx = Math.cos(a) * spd; p.vz = Math.sin(a) * spd;
      p.vy = 2.5 + Math.random() * 4;
      p.sx = (Math.random() - 0.5) * 12; p.sz = (Math.random() - 0.5) * 12;
      this.tint(p, 0x9aa0ad, 0.4);
    }
  }

  /** Bigger, longer-lived debris — the Tank smashing an obstacle. */
  smashBurst(x: number, y: number, z: number): void {
    for (let i = 0; i < 22; i++) {
      const a = Math.random() * Math.PI * 2, spd = 4 + Math.random() * 9;
      const warm = Math.random() < 0.3;
      const p = this.spawn(x, y, z, warm ? 0xffd35a : 0xb9a08c, Kind.Chunk, 0.22 + Math.random() * 0.24, 0.9 + Math.random() * 0.5, -15, 0.9);
      p.vx = Math.cos(a) * spd; p.vz = Math.sin(a) * spd;
      p.vy = 4 + Math.random() * 7;
      p.sx = (Math.random() - 0.5) * 16; p.sy = (Math.random() - 0.5) * 16; p.sz = (Math.random() - 0.5) * 16;
      this.tint(p, warm ? 0xffd35a : 0xb9a08c, 0.4);
    }
  }

  /** Finish-line celebration: slow, multi-colour, fluttering down. */
  confetti(x: number, y: number, z: number): void {
    const cols = CONFETTI;
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2, spd = Math.random() * 8;
      const c = cols[(Math.random() * cols.length) | 0];
      const p = this.spawn(
        x + (Math.random() - 0.5) * 3, y + 1 + Math.random() * 5, z + (Math.random() - 0.5) * 3,
        c, Kind.Confetti, 0.22 + Math.random() * 0.16, 2.6 + Math.random() * 1.6, -2.2, 0.9,
      );
      p.vx = Math.cos(a) * spd; p.vz = Math.sin(a) * spd;
      p.vy = 4 + Math.random() * 7;
      p.sx = (Math.random() - 0.5) * 10; p.sy = (Math.random() - 0.5) * 10; p.sz = (Math.random() - 0.5) * 10;
      this.tint(p, c, 0.25);
    }
  }

  /** Lava plume / falling-into-the-void splash. */
  splash(x: number, y: number, z: number, color: number): void {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, spd = 1.5 + Math.random() * 5;
      const p = this.spawn(x, y, z, color, Kind.Splash, 0.2 + Math.random() * 0.25, 0.9 + Math.random() * 0.6, -10, 1.0);
      p.vx = Math.cos(a) * spd; p.vz = Math.sin(a) * spd;
      p.vy = 6 + Math.random() * 9;
      p.grow = 0.2;
      p.sx = (Math.random() - 0.5) * 8; p.sz = (Math.random() - 0.5) * 8;
      this.tint(p, color, 0.45);
    }
  }

  // ---- simulation ----------------------------------------------------------

  update(dt: number): void {
    const pool = this.pool;
    const damp = Math.min(1, dt);
    let any = false;
    for (let i = 0; i < MAX; i++) {
      const p = pool[i];
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        this.m4.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.m4);
        any = true;
        continue;
      }
      const d = 1 - p.drag * damp;
      p.vx *= d; p.vz *= d;
      p.vy = p.vy * (p.kind === Kind.Confetti ? d : 1) + p.gravity * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.rx += p.sx * dt; p.ry += p.sy * dt; p.rz += p.sz * dt;

      const u = p.life / p.max;             // 1 → 0 over the lifetime
      const fade = p.kind === Kind.Flame ? u * u : u;
      const s = Math.max(0.001, p.size * (1 + p.grow * (1 - u)) * (0.35 + 0.65 * u));

      this.pos.set(p.x, p.y, p.z);
      this.e.set(p.rx, p.ry, p.rz);
      this.q.setFromEuler(this.e);
      this.scl.set(s, p.kind === Kind.Confetti ? s * 0.35 : s, s);
      this.m4.compose(this.pos, this.q, this.scl);
      this.mesh.setMatrixAt(i, this.m4);
      this.col.setRGB(p.r * fade, p.g * fade, p.b * fade);
      this.mesh.setColorAt(i, this.col);
      any = true;
    }
    if (any) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }

  /** Kill everything (track change / restart). */
  clear(): void {
    this.m4.makeScale(0, 0, 0);
    for (let i = 0; i < MAX; i++) {
      this.pool[i].alive = false;
      this.mesh.setMatrixAt(i, this.m4);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.geo.dispose();
    this.matl.dispose();
  }
}

const CONFETTI = [0xff4d5a, 0xffd23f, 0x4fd14a, 0x3aa6d8, 0xb44dff, 0xff9a2a, 0xffffff];
