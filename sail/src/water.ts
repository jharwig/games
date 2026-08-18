import * as THREE from 'three';
import type { Island } from './course';
import { SEABED_TILE, makeBedTexture } from './seabed';

/**
 * Stylized tropical water. The plane follows the camera; waves displace in
 * the vertex shader. The fragment shader paints a fake seabed into the
 * water color: depth from the shared seabed texture (sandbanks / deep
 * trenches — see seabed.ts), sandy shallows around islands, coral patches,
 * and animated caustics — the "see-through" look without transparency or
 * real seabed geometry.
 */

const MAX_ISLANDS = 8;

// Surface swell: sum of sines, (kx, kz, omega, amp). One table drives both
// the vertex shader and the CPU mirror below so effects (whitecaps) can
// stand exactly on the rendered surface.
const WAVE_TERMS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.16, 0.11, 1.1, 0.55],
  [0.07, -0.13, 0.7, 0.8],
  [0.31, 0.24, -1.7, 0.22],
];

/** world-Y meters per unit of waveHeight() */
export const WAVE_AMP = 0.28;

/** CPU mirror of the vertex shader's waveH — unscaled; multiply by WAVE_AMP for Y */
export function waveHeight(x: number, z: number, t: number): number {
  let h = 0;
  for (const [kx, kz, w, a] of WAVE_TERMS) h += Math.sin(x * kx + z * kz + t * w) * a;
  return h;
}

const g = (n: number): string => n.toFixed(4);
const waveGLSL = WAVE_TERMS.map(
  ([kx, kz, w, a]) => `h += sin(p.x * ${g(kx)} + p.y * ${g(kz)} + t * ${g(w)}) * ${g(a)};`,
).join('\n          ');

export class Water {
  readonly mesh: THREE.Mesh;
  private uniforms: {
    uTime: { value: number };
    uWindDir: { value: THREE.Vector2 };
    uIslands: { value: THREE.Vector3[] };
    uIslandCount: { value: number };
    uBed: { value: THREE.DataTexture };
  };

  constructor(islands: Island[] = []) {
    const size = 520;
    const segs = 120;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);

    const islandVecs: THREE.Vector3[] = [];
    for (let i = 0; i < MAX_ISLANDS; i++) {
      const isl = islands[i];
      islandVecs.push(isl ? new THREE.Vector3(isl.x, isl.z, isl.r) : new THREE.Vector3(0, 0, -1));
    }

    this.uniforms = {
      uTime: { value: 0 },
      uWindDir: { value: new THREE.Vector2(0, -1) },
      uIslands: { value: islandVecs },
      uIslandCount: { value: Math.min(islands.length, MAX_ISLANDS) },
      uBed: { value: makeBedTexture() },
    };

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vWorld;
        varying float vWave;

        float waveH(vec2 p, float t) {
          float h = 0.0;
          ${waveGLSL}
          return h;
        }

        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float h = waveH(wp.xz, uTime);
          wp.y += h * ${g(WAVE_AMP)};
          vWave = h;
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec2 uWindDir;
        uniform vec3 uIslands[${MAX_ISLANDS}];
        uniform int uIslandCount;
        uniform sampler2D uBed;
        varying vec3 vWorld;
        varying float vWave;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float noise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
                     mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
        }
        float fbm(vec2 p) {
          float v = 0.0;
          v += noise(p) * 0.55;
          v += noise(p * 2.13 + 7.7) * 0.28;
          v += noise(p * 4.31 - 3.1) * 0.17;
          return v;
        }
        vec2 hash2(vec2 p) {
          return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
        }
        // Worley: x = distance to nearest feature point, yz = cell id hash
        vec3 worley(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          float best = 8.0; vec2 bestId = vec2(0.0);
          for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
              vec2 g = vec2(float(x), float(y));
              vec2 o = hash2(i + g);
              float d = length(g + o - f);
              if (d < best) { best = d; bestId = o; }
            }
          }
          return vec3(best, bestId);
        }

        void main() {
          vec2 p = vWorld.xz;

          // ---------- seabed depth field ----------
          // large-scale sandbanks and trenches (baked in seabed.ts so the
          // CPU — whitecaps — sees the exact same field)
          float bed = texture2D(uBed, p / ${g(SEABED_TILE)}).r;
          // shallowness 0..1 (1 = sand at the surface)
          float shallow = smoothstep(0.60, 0.83, bed);
          float trench = smoothstep(0.34, 0.15, bed); // rare deep holes
          // islands shelve up out of the water
          for (int i = 0; i < ${MAX_ISLANDS}; i++) {
            if (i >= uIslandCount) break;
            vec3 isl = uIslands[i];
            float d = distance(p, isl.xy);
            shallow = max(shallow, smoothstep(isl.z * 2.6, isl.z * 1.05, d));
          }
          trench *= 1.0 - shallow;

          // ---------- water color by depth ----------
          vec3 abyssCol  = vec3(0.020, 0.120, 0.260);
          vec3 deepCol   = vec3(0.040, 0.240, 0.420);
          vec3 midCol    = vec3(0.060, 0.420, 0.585);
          vec3 lagoonCol = vec3(0.110, 0.660, 0.660);
          vec3 sandCol   = vec3(0.760, 0.700, 0.480);

          // continuous gradient down into the trenches (no hard blobs);
          // mid-blue stays dominant, abyss only in the deepest cores
          float down = smoothstep(0.0, 1.0, trench);
          vec3 col = mix(midCol, deepCol, down * 0.9);
          col = mix(col, abyssCol, smoothstep(0.7, 1.0, trench) * 0.6);
          // soft mottling + drifting internal light in the deep
          float m1 = fbm(p * 0.045 + uTime * 0.015);
          col += vec3(0.000, 0.030, 0.055) * m1 * down;
          float rays = noise(vec2(p.x * 0.03 + p.y * 0.05 + uTime * 0.06, p.y * 0.01));
          col += vec3(0.010, 0.045, 0.075) * smoothstep(0.55, 0.9, rays) * down;
          // shallow gradient: blue -> lagoon turquoise -> visible sand
          col = mix(col, lagoonCol, smoothstep(0.15, 0.7, shallow));
          col = mix(col, sandCol, smoothstep(0.72, 0.98, shallow));

          // sand ripples on the visible banks
          float ripple = sin(dot(p, vec2(0.9, 0.5)) * 2.2 + fbm(p * 0.4) * 6.0);
          col -= vec3(0.05, 0.045, 0.03) * smoothstep(0.75, 0.95, shallow) * (0.5 + 0.5 * ripple);

          // ---------- coral gardens on the shelf edges ----------
          float shelf = smoothstep(0.28, 0.5, shallow) * (1.0 - smoothstep(0.8, 0.95, shallow));
          // reef patches: only some parts of the shelf grow coral
          float reefPatch = smoothstep(0.55, 0.75, noise(p * 0.11 + 31.0));
          float reef = shelf * reefPatch;
          if (reef > 0.01) {
            // organic reef clumps: domain-warped cellular noise so nothing
            // reads as a perfect circle, colors muted by the water above
            vec2 q = p + vec2(fbm(p * 0.33), fbm(p * 0.33 + 11.0)) * 4.0;
            vec3 w = worley(q * 0.5);
            float clump = 1.0 - smoothstep(0.2, 0.8, w.x);
            clump *= smoothstep(0.38, 0.72, fbm(q * 0.5 + 3.0)); // broken up
            float hue = fract(w.y * 7.31 + w.z * 3.17);
            vec3 coralCol =
                hue < 0.35 ? vec3(0.52, 0.30, 0.33)   // muted rose
              : hue < 0.58 ? vec3(0.46, 0.42, 0.22)   // olive
              : hue < 0.80 ? vec3(0.26, 0.44, 0.33)   // sea green
                           : vec3(0.50, 0.37, 0.22);  // rust
            // seen through water: pull heavily toward the ambient color
            coralCol = mix(coralCol, col, 0.45);
            col = mix(col, coralCol, reef * clump * 0.85);
            // dark crevices between growths
            col *= 1.0 - reef * clump * smoothstep(0.5, 0.2, w.x) * 0.25;
          }

          // ---------- caustics dancing over the shallows ----------
          float c1 = noise(p * 0.55 + uTime * vec2(0.23, 0.17));
          float c2 = noise(p * 0.62 - uTime * vec2(0.19, 0.26) + 4.0);
          float caust = pow(smoothstep(0.45, 0.95, c1 * c2 * 2.2), 2.0);
          col += vec3(0.35, 0.42, 0.38) * caust * smoothstep(0.25, 0.8, shallow);

          // ---------- open-water texture (unchanged feel) ----------
          float n1 = noise(p * 0.035 + uTime * 0.02);
          col = mix(col, col * 1.18 + vec3(0.02), smoothstep(0.55, 0.95, n1) * 0.35 * (1.0 - shallow));

          // wave-crest tinting
          col += vec3(0.03, 0.05, 0.05) * smoothstep(0.6, 1.4, vWave);

          // wind-driven streaks
          vec2 wdir = normalize(uWindDir);
          vec2 wperp = vec2(-wdir.y, wdir.x);
          float along = dot(p, wdir);
          float across = dot(p, wperp);
          float streak = noise(vec2(along * 0.05 - uTime * 0.35, across * 0.45));
          col += vec3(0.020, 0.035, 0.040) * smoothstep(0.6, 0.9, streak);

          // sun sparkle on crests
          float sp = noise(p * 0.9 + uTime * vec2(0.7, 0.9));
          sp = pow(smoothstep(0.88, 0.99, sp), 4.0);
          col += vec3(0.9, 0.85, 0.6) * sp * 0.22 * smoothstep(0.2, 1.2, vWave);

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = false;
    this.mesh.renderOrder = 0;
  }

  update(time: number, center: THREE.Vector3, windDir: number): void {
    this.uniforms.uTime.value = time;
    this.uniforms.uWindDir.value.set(Math.sin(windDir), Math.cos(windDir));
    this.mesh.position.set(center.x, 0, center.z);
  }
}
