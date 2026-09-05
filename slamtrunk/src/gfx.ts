// =============================================================================
// shared material / geometry helpers. `setStyle` flips every material built
// through `mat()` between the realistic look (physically based, default) and
// a cel-shaded cartoon look kept only for side-by-side comparison.
// =============================================================================
import * as THREE from 'three';

export type Style = 'real' | 'toon';
let style: Style = 'real';

const gradient = (() => {
  const data = new Uint8Array([90, 160, 225, 255]);
  const tex = new THREE.DataTexture(data, 4, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
})();

export function setStyle(s: Style): void { style = s; }
export function getStyle(): Style { return style; }

export interface MatOpts {
  emissive?: number;
  emissiveIntensity?: number;
  opacity?: number;
  flat?: boolean;
  side?: THREE.Side;
  map?: THREE.Texture;
  bump?: THREE.Texture;
  bumpScale?: number;
  roughness?: number;
  metalness?: number;
}

export function mat(color: number, o: MatOpts = {}): THREE.Material {
  const common = {
    color,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emissiveIntensity ?? 1,
    transparent: o.opacity !== undefined && o.opacity < 1,
    opacity: o.opacity ?? 1,
    side: o.side ?? THREE.FrontSide,
    map: o.map ?? null,
  };
  if (style === 'toon') return new THREE.MeshToonMaterial({ ...common, gradientMap: gradient });
  return new THREE.MeshStandardMaterial({
    ...common,
    flatShading: o.flat ?? false,
    roughness: o.roughness ?? 0.85,
    metalness: o.metalness ?? 0,
    bumpMap: o.bump ?? null,
    bumpScale: o.bumpScale ?? 0.02,
  });
}

export function box(w: number, h: number, d: number, color: number, o: MatOpts = {}): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, o));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
export function cyl(rt: number, rb: number, h: number, color: number, seg = 16, o: MatOpts = {}): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color, o));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
export function sphere(r: number, color: number, seg = 24, o: MatOpts = {}): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(8, seg >> 1)), mat(color, o));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
export function cone(r: number, h: number, color: number, seg = 16, o: MatOpts = {}): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat(color, o));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** Tileable value-noise canvas texture (grey), used as bump / grain maps. */
export function noiseTexture(size = 256, cells = 8, octaves = 4, contrast = 1): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  const grids: number[][] = [];
  for (let o = 0; o < octaves; o++) {
    const n = cells << o, arr: number[] = [];
    for (let i = 0; i < n * n; i++) arr.push(Math.random());
    grids.push(arr);
  }
  const lerp = (a: number, b: number, t: number) => a + (b - a) * (t * t * (3 - 2 * t));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let v = 0, amp = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      const n = cells << o, arr = grids[o];
      const fx = (x / size) * n, fy = (y / size) * n;
      const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
      const x1 = (x0 + 1) % n, y1 = (y0 + 1) % n;
      const a = lerp(arr[y0 * n + x0], arr[y0 * n + x1], tx), b = lerp(arr[y1 * n + x0], arr[y1 * n + x1], tx);
      v += lerp(a, b, ty) * amp; norm += amp; amp *= 0.5;
    }
    v = ((v / norm - 0.5) * contrast + 0.5) * 255;
    const i = (y * size + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, v)); img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

let skinTex: THREE.CanvasTexture | null = null;
/** Elephant hide: fine cracked wrinkles. */
export function skinBump(): THREE.CanvasTexture {
  if (skinTex) return skinTex;
  const size = 512;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.drawImage(noiseTexture(size, 6, 5, 1.2).image as HTMLCanvasElement, 0, 0);
  // crack network: many short dark strokes in random directions
  g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 1.5;
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * size, y = Math.random() * size, a = Math.random() * Math.PI, l = 6 + Math.random() * 18;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  skinTex = new THREE.CanvasTexture(c);
  skinTex.wrapS = skinTex.wrapT = THREE.RepeatWrapping;
  skinTex.repeat.set(3, 3);
  return skinTex;
}

/** Gradient sky dome with a sun glow. */
export function makeSky(top: number, mid: number, bot: number, sunDir: THREE.Vector3, sunGlow = 0.3): THREE.Mesh {
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      topCol: { value: new THREE.Color(top) },
      midCol: { value: new THREE.Color(mid) },
      botCol: { value: new THREE.Color(bot) },
      sunDir: { value: sunDir.clone().normalize() },
      glow: { value: sunGlow },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 topCol, midCol, botCol, sunDir; uniform float glow; varying vec3 vDir;
      void main(){ vec3 d = normalize(vDir); float h = clamp(d.y*0.6+0.42,0.0,1.0); h = pow(h,0.85);
        vec3 col = mix(midCol, topCol, smoothstep(0.4,1.0,h)); col = mix(botCol, col, smoothstep(0.0,0.5,h));
        float s = pow(clamp(dot(d,sunDir),0.0,1.0), 6.0); col += vec3(1.0,0.85,0.6)*s*glow;
        float disc = smoothstep(0.9985,0.999,dot(d,sunDir)); col = mix(col, vec3(1.0,0.97,0.85), disc*glow*2.0);
        gl_FragColor = vec4(col,1.0); }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 24, 12), skyMat);
  sky.frustumCulled = false;
  return sky;
}

export function makeStars(count: number, radius: number): THREE.Points {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    pos[i * 3] = r * Math.cos(th) * radius;
    pos[i * 3 + 1] = Math.abs(u) * radius * 0.9 + 20;
    pos[i * 3 + 2] = r * Math.sin(th) * radius;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.5, sizeAttenuation: false, fog: false }));
  p.frustumCulled = false;
  return p;
}
