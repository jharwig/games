import * as THREE from 'three';

/**
 * A pool of flat ribbons lying on the water plane, rendered as one mesh.
 * Used for wind streaks and boat wakes. Each ribbon is a polyline of
 * `pointsPerRibbon` XZ points extruded sideways into a thin quad strip.
 * Per-point alpha is encoded in vertex colors with additive blending.
 */
export class FlatRibbons {
  readonly mesh: THREE.Mesh;
  private positions: Float32Array;
  private colors: Float32Array;
  private posAttr: THREE.BufferAttribute;
  private colAttr: THREE.BufferAttribute;

  constructor(
    readonly count: number,
    readonly pointsPerRibbon: number,
    color: THREE.Color,
    y = 0.14,
  ) {
    const vertsPerRibbon = pointsPerRibbon * 2;
    const nVerts = count * vertsPerRibbon;
    this.positions = new Float32Array(nVerts * 3);
    this.colors = new Float32Array(nVerts * 3);
    for (let i = 1; i < nVerts * 3; i += 3) this.positions[i] = y;

    const indices: number[] = [];
    for (let r = 0; r < count; r++) {
      const base = r * vertsPerRibbon;
      for (let p = 0; p < pointsPerRibbon - 1; p++) {
        const a = base + p * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }

    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.colors, 3);
    this.colAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    geo.setIndex(indices);

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      color,
      // winding depends on each ribbon's travel direction — never cull
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /**
   * Write one ribbon. `xs`/`zs` are the centerline points, `widths` and
   * `alphas` per point. Pass alpha 0 everywhere to hide a ribbon.
   */
  setRibbon(r: number, xs: number[], zs: number[], widths: number[], alphas: number[]): void {
    const n = this.pointsPerRibbon;
    const base = r * n * 2;
    for (let p = 0; p < n; p++) {
      // direction along the line for the side offset
      const p0 = Math.max(0, p - 1);
      const p1 = Math.min(n - 1, p + 1);
      let dx = xs[p1]! - xs[p0]!;
      let dz = zs[p1]! - zs[p0]!;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const half = widths[p]! * 0.5;
      // perpendicular in XZ
      const ox = -dz * half;
      const oz = dx * half;
      const vi = (base + p * 2) * 3;
      this.positions[vi] = xs[p]! + ox;
      this.positions[vi + 2] = zs[p]! + oz;
      this.positions[vi + 3] = xs[p]! - ox;
      this.positions[vi + 5] = zs[p]! - oz;
      const a = alphas[p]!;
      for (const ci of [vi, vi + 3]) {
        this.colors[ci] = a;
        this.colors[ci + 1] = a;
        this.colors[ci + 2] = a;
      }
    }
  }

  commit(): void {
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
  }
}
