// =============================================================================
// shared material / geometry helpers. `setStyle` flips every material built
// through `mat()` between cel-shaded (toon steps) and soft (smooth lambert).
// =============================================================================
import * as THREE from 'three';

export type Style = 'toon' | 'soft';
let style: Style = 'toon';

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
  vertexColors?: boolean;
  map?: THREE.Texture;
}

export function mat(color: number, o: MatOpts = {}): THREE.Material {
  const common = {
    color,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emissiveIntensity ?? 1,
    transparent: o.opacity !== undefined && o.opacity < 1,
    opacity: o.opacity ?? 1,
    side: o.side ?? THREE.FrontSide,
    vertexColors: o.vertexColors ?? false,
    map: o.map ?? null,
  };
  if (style === 'toon') return new THREE.MeshToonMaterial({ ...common, gradientMap: gradient });
  return new THREE.MeshLambertMaterial({ ...common, flatShading: o.flat ?? false });
}

export function box(w: number, h: number, d: number, color: number, o: MatOpts = {}): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, o));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
export function cyl(rt: number, rb: number, h: number, color: number, seg = 12, o: MatOpts = {}): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color, o));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
export function sphere(r: number, color: number, seg = 12, o: MatOpts = {}): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1)), mat(color, o));
  m.castShadow = true;
  return m;
}
export function cone(r: number, h: number, color: number, seg = 8, o: MatOpts = {}): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat(color, o));
  m.castShadow = true; m.receiveShadow = true;
  return m;
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
  const p = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 3, sizeAttenuation: false, fog: false }));
  p.frustumCulled = false;
  return p;
}
