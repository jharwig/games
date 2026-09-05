// =============================================================================
// the five stadiums: sky, lighting, ground and surroundings. Each returns a
// group plus a per-frame `update` for ambient motion (snow, waves, lights).
// Order the designer chose: circus → snow → city → moon → beach.
// =============================================================================
import * as THREE from 'three';
import { mat, box, cyl, sphere, cone, makeSky, makeStars, noiseTexture } from './gfx';

export type StadiumId = 'circus' | 'snow' | 'city' | 'moon' | 'beach';
export const STADIUM_ORDER: StadiumId[] = ['circus', 'snow', 'city', 'moon', 'beach'];
export const STADIUM_NAME: Record<StadiumId, string> = {
  circus: '🎪 Circus Tent', snow: '❄️ Snow', city: '🌃 City at Night', moon: '🌙 Moon', beach: '🏖️ Beach',
};

export interface Stadium {
  group: THREE.Group;
  floorTint: string;
  /** crowd wears space helmets here */
  helmets: boolean;
  update(t: number, dt: number): void;
}

function sun(color: number, intensity: number, x: number, y: number, z: number): THREE.DirectionalLight {
  const l = new THREE.DirectionalLight(color, intensity);
  l.position.set(x, y, z); l.castShadow = true;
  l.shadow.mapSize.set(2048, 2048);
  const c = l.shadow.camera; c.left = c.bottom = -26; c.right = c.top = 26; c.near = 1; c.far = 200;
  l.shadow.bias = -0.0008; l.shadow.normalBias = 0.02;
  return l;
}
function ground(color: number, size = 500, rough = 1, bumpScale = 0.05): THREE.Mesh {
  const g = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat(color, { roughness: rough, bump: noiseTexture(256, 4, 4, 1), bumpScale }));
  (g.material as THREE.MeshStandardMaterial).bumpMap?.repeat.set(size / 12, size / 12);
  g.rotation.x = -Math.PI / 2; g.position.y = -0.3; g.receiveShadow = true;
  return g;
}
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// ---------------------------------------------------------------- circus ----
function circus(scene: THREE.Scene): Stadium {
  const g = new THREE.Group();
  scene.background = new THREE.Color(0x1a0a08);
  // striped canvas
  const c = document.createElement('canvas'); c.width = 512; c.height = 64;
  const ctx = c.getContext('2d')!;
  for (let i = 0; i < 8; i++) { ctx.fillStyle = i % 2 ? '#f3e6d3' : '#b8231c'; ctx.fillRect(i * 64, 0, 64, 64); }
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  const wallTex = tex.clone(); wallTex.repeat.set(14, 1); wallTex.needsUpdate = true;
  const roofTex = tex.clone(); roofTex.repeat.set(14, 1); roofTex.needsUpdate = true;
  const canvasMat = (t: THREE.Texture) => mat(0xffffff, { map: t, roughness: 1, side: THREE.BackSide, bump: noiseTexture(128, 8, 2, 0.8), bumpScale: 0.02 });
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(44, 44, 10, 48, 1, true), canvasMat(wallTex)); wall.position.y = 5; g.add(wall);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(44, 22, 48, 1, true), canvasMat(roofTex)); roof.position.y = 21; g.add(roof);
  // poles and rigging
  for (const z of [-20, 20]) { const p = cyl(0.25, 0.3, 30, 0x6b4a2b, 12, { roughness: 0.8 }); p.position.set(0, 15, z); g.add(p); }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2; const p = cyl(0.12, 0.14, 10, 0x6b4a2b, 8, { roughness: 0.8 }); p.position.set(Math.cos(a) * 42, 5, Math.sin(a) * 42); g.add(p);
  }
  // string lights: rings of bulbs
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffe9a8, emissive: 0xffc860, emissiveIntensity: 2.5 }), 320);
  const m = new THREE.Matrix4(); let k = 0;
  for (const r of [24, 33]) for (let i = 0; i < 160; i++) {
    const a = (i / 160) * Math.PI * 2, sag = Math.abs(Math.sin(a * 8)) * 0.8;
    m.makeTranslation(Math.cos(a) * r, 9.2 - sag + (r - 24) * 0.12, Math.sin(a) * r); bulbs.setMatrixAt(k++, m);
  }
  g.add(bulbs);
  // sawdust ring
  const dust = ground(0xc9a266, 100, 1, 0.08); g.add(dust);
  // lighting: warm spots from the rig
  scene.add(new THREE.AmbientLight(0xffd9b0, 0.35));
  const key = sun(0xfff0d8, 2.2, 8, 18, -6); g.add(key, key.target);
  for (const [x, z] of [[-12, -12], [12, -12], [-12, 12], [12, 12]]) {
    const s = new THREE.SpotLight(0xffe4c0, 900, 60, 0.55, 0.5, 1.6);
    s.position.set(x, 16, z); s.target.position.set(0, 0, 0); g.add(s, s.target);
    const can = cyl(0.3, 0.42, 0.7, 0x222222, 12, { metalness: 0.6, roughness: 0.5 }); can.position.set(x, 16.2, z); g.add(can);
  }
  return { group: g, floorTint: '#c98d48', helmets: false, update: (t) => { (bulbs.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.3 + Math.sin(t * 3) * 0.3; } };
}

// ------------------------------------------------------------------ snow ----
function snow(scene: THREE.Scene): Stadium {
  const g = new THREE.Group();
  const sunDir = new THREE.Vector3(0.4, 0.28, -0.8);
  g.add(makeSky(0x6fa8e6, 0xcfe3f7, 0xe9f2fa, sunDir, 0.45));
  scene.fog = new THREE.FogExp2(0xdbe9f5, 0.0045);
  g.add(ground(0xf4f8fc, 600, 0.9, 0.12));
  // drifts
  for (let i = 0; i < 30; i++) {
    const d = sphere(rnd(2, 6), 0xffffff, 16, { roughness: 0.95 }); d.scale.y = 0.25;
    const a = rnd(0, 6.28), r = rnd(28, 90); d.position.set(Math.cos(a) * r, -0.3, Math.sin(a) * r); g.add(d);
  }
  // pines
  const needles = mat(0x1f4d2b, { roughness: 1 }), snowCap = mat(0xffffff, { roughness: 0.95 }), bark = mat(0x4b3621, { roughness: 1 });
  for (let i = 0; i < 70; i++) {
    const a = rnd(0, 6.28), r = rnd(26, 120), h = rnd(6, 14);
    const tree = new THREE.Group(); tree.position.set(Math.cos(a) * r, -0.3, Math.sin(a) * r);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, h * 0.3, 8), bark); trunk.position.y = h * 0.15; tree.add(trunk);
    for (let l = 0; l < 4; l++) {
      const rr = (h / 3) * (1 - l * 0.2), yy = h * 0.25 + l * h * 0.18;
      const layer = new THREE.Mesh(new THREE.ConeGeometry(rr, h * 0.3, 10), needles); layer.position.y = yy; layer.castShadow = true; tree.add(layer);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(rr * 0.98, h * 0.3 * 0.35, 10), snowCap); cap.position.y = yy + h * 0.3 * 0.33; tree.add(cap);
    }
    g.add(tree);
  }
  // mountains
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rnd(-0.2, 0.2), r = rnd(220, 320), h = rnd(70, 140);
    const mt = cone(rnd(70, 120), h, 0xc9d8e8, 7, { roughness: 1, flat: true }); mt.position.set(Math.cos(a) * r, h / 2 - 20, Math.sin(a) * r); g.add(mt);
    const cap = cone(rnd(70, 120) * 0.45, h * 0.45, 0xffffff, 7, { roughness: 1, flat: true }); cap.position.set(mt.position.x, h / 2 - 20 + h * 0.28, mt.position.z); g.add(cap);
  }
  // snowfall
  const N = 2500, pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pos[i * 3] = rnd(-45, 45); pos[i * 3 + 1] = rnd(0, 30); pos[i * 3 + 2] = rnd(-45, 45); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const flakes = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.85 })); g.add(flakes);
  scene.add(new THREE.HemisphereLight(0xbcd7f0, 0xffffff, 0.9));
  const s = sun(0xfff4e0, 2.4, sunDir.x * 60, sunDir.y * 60, sunDir.z * 60); g.add(s, s.target);
  return {
    group: g, floorTint: '#d4a670', helmets: false,
    update: (t, dt) => {
      for (let i = 0; i < N; i++) {
        pos[i * 3 + 1] -= dt * 1.4; pos[i * 3] += Math.sin(t + i) * dt * 0.3;
        if (pos[i * 3 + 1] < 0) pos[i * 3 + 1] = 30;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

// ------------------------------------------------------------------ city ----
function windows(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 128; c.height = 256;
  const g = c.getContext('2d')!; g.fillStyle = '#0d1020'; g.fillRect(0, 0, 128, 256);
  for (let y = 6; y < 256; y += 16) for (let x = 6; x < 128; x += 16) {
    const on = Math.random() < 0.55; g.fillStyle = on ? (Math.random() < 0.7 ? '#ffd98a' : '#bfe3ff') : '#1a1f33'; g.fillRect(x, y, 9, 11);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}
function city(scene: THREE.Scene): Stadium {
  const g = new THREE.Group();
  g.add(makeSky(0x050716, 0x1a1640, 0x3a2a55, new THREE.Vector3(0, -1, 0), 0));
  g.add(makeStars(1500, 900));
  scene.fog = new THREE.FogExp2(0x1a1630, 0.0035);
  const moon = sphere(7, 0xfff5d6, 24, { emissive: 0xfff2c8, emissiveIntensity: 1.2, roughness: 1 }); moon.position.set(90, 110, -220); g.add(moon);
  g.add(ground(0x17181c, 700, 0.35, 0.03));
  // buildings
  const winTex = windows();
  for (let i = 0; i < 90; i++) {
    const a = rnd(0, 6.28), r = rnd(38, 180), w = rnd(8, 22), d = rnd(8, 22), h = rnd(18, 90);
    const t = winTex.clone(); t.repeat.set(w / 4, h / 8); t.needsUpdate = true;
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: 0x9aa0b0, map: t, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: 0.9, roughness: 0.6 }));
    b.position.set(Math.cos(a) * r, h / 2 - 0.3, Math.sin(a) * r); b.rotation.y = rnd(0, 1); b.castShadow = true; g.add(b);
    if (Math.random() < 0.3) { const beacon = sphere(0.5, 0xff3030, 8, { emissive: 0xff2020, emissiveIntensity: 3 }); beacon.position.set(b.position.x, h, b.position.z); g.add(beacon); }
  }
  // floodlight masts at the corners
  for (const [x, z] of [[-14, -19], [14, -19], [-14, 19], [14, 19]]) {
    const mast = cyl(0.18, 0.3, 17, 0x8a8f99, 10, { metalness: 0.8, roughness: 0.4 }); mast.position.set(x, 8.5, z); g.add(mast);
    const head = box(2.4, 1.2, 0.5, 0x2a2d33, { metalness: 0.5, roughness: 0.4 }); head.position.set(x, 17, z); head.lookAt(0, 0, 0); g.add(head);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.0), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeaf2ff, emissiveIntensity: 4 }));
    panel.position.copy(head.position); panel.lookAt(0, 0, 0); panel.translateZ(0.3); g.add(panel);
    const s = new THREE.SpotLight(0xe8f0ff, 1400, 80, 0.5, 0.6, 1.5); s.position.set(x, 17, z); s.target.position.set(0, 0, 0); g.add(s, s.target);
  }
  scene.add(new THREE.AmbientLight(0x4a4f78, 0.5));
  const key = sun(0xdfe8ff, 1.6, 10, 25, -12); g.add(key, key.target);
  return { group: g, floorTint: '#b98a55', helmets: false, update: () => {} };
}

// ------------------------------------------------------------------ moon ----
function earthTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d')!; g.fillStyle = '#1c5fb8'; g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#3a8f3a';
  for (let i = 0; i < 14; i++) { g.beginPath(); g.ellipse(rnd(0, 512), rnd(30, 226), rnd(20, 70), rnd(15, 45), rnd(0, 3), 0, 6.28); g.fill(); }
  g.fillStyle = 'rgba(255,255,255,0.75)';
  for (let i = 0; i < 40; i++) { g.beginPath(); g.ellipse(rnd(0, 512), rnd(0, 256), rnd(20, 60), rnd(4, 12), rnd(0, 3), 0, 6.28); g.fill(); }
  g.fillStyle = '#eef'; g.fillRect(0, 0, 512, 14); g.fillRect(0, 242, 512, 14);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function moon(scene: THREE.Scene): Stadium {
  const g = new THREE.Group();
  scene.background = new THREE.Color(0x000004);
  g.add(makeStars(4000, 900));
  const et = earthTexture();
  const earth = new THREE.Mesh(new THREE.SphereGeometry(16, 32, 24), new THREE.MeshStandardMaterial({ map: et, emissive: 0xffffff, emissiveMap: et, emissiveIntensity: 0.35, roughness: 0.7 }));
  earth.position.set(-110, 95, 170); g.add(earth);
  // cratered regolith
  const geo = new THREE.PlaneGeometry(500, 500, 160, 160);
  const p = geo.attributes.position;
  const craters = Array.from({ length: 40 }, () => ({ x: rnd(-240, 240), z: rnd(-240, 240), r: rnd(6, 30) })).filter((c) => Math.hypot(c.x, c.z) > 32);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = -p.getY(i);
    let y = (Math.sin(x * 0.11) * Math.cos(z * 0.09) + Math.sin(x * 0.31 + z * 0.17)) * 0.5;
    for (const c of craters) {
      const d = Math.hypot(x - c.x, z - c.z) / c.r;
      if (d < 1.2) y += d < 1 ? -(1 - d * d) * c.r * 0.22 : (1.2 - d) * c.r * 0.35;
    }
    if (Math.hypot(x, z) < 30) y = 0;
    p.setZ(i, y);
  }
  geo.computeVertexNormals();
  const reg = new THREE.Mesh(geo, mat(0x8c8c8c, { roughness: 1, bump: noiseTexture(256, 6, 4, 1), bumpScale: 0.2 }));
  (reg.material as THREE.MeshStandardMaterial).bumpMap?.repeat.set(30, 30);
  reg.rotation.x = -Math.PI / 2; reg.position.y = -0.3; reg.receiveShadow = true; g.add(reg);
  // rocks + a flag
  for (let i = 0; i < 40; i++) {
    const a = rnd(0, 6.28), r = rnd(24, 120), s = rnd(0.5, 3);
    const rock = sphere(s, 0x6f6f6f, 7, { roughness: 1, flat: true }); rock.scale.set(1, 0.6, 0.8); rock.position.set(Math.cos(a) * r, -0.3 + s * 0.3, Math.sin(a) * r); rock.rotation.y = rnd(0, 3); g.add(rock);
  }
  const pole = cyl(0.05, 0.05, 4, 0xdddddd, 8, { metalness: 0.8, roughness: 0.3 }); pole.position.set(-14, 1.7, 20); g.add(pole);
  const flag = box(2.2, 1.4, 0.02, 0xffffff, { roughness: 0.8 }); flag.position.set(-12.9, 3.0, 20); g.add(flag);
  const stripe = box(2.2, 0.35, 0.03, 0xc62828, { roughness: 0.8 }); stripe.position.set(-12.9, 2.75, 20); g.add(stripe);
  scene.add(new THREE.AmbientLight(0x30323c, 0.35));
  const s = sun(0xffffff, 3.2, -40, 50, -30); g.add(s, s.target);
  return { group: g, floorTint: '#c2915c', helmets: true, update: (t) => { earth.rotation.y = t * 0.02; } };
}

// ----------------------------------------------------------------- beach ----
function palm(x: number, z: number, h: number): THREE.Group {
  const t = new THREE.Group(); t.position.set(x, -0.3, z);
  const lean = new THREE.Vector3(rnd(-1, 1), 0, rnd(-1, 1)).normalize().multiplyScalar(0.06);
  const bark = mat(0x8b6a48, { roughness: 1, bump: noiseTexture(64, 8, 2, 1), bumpScale: 0.05 });
  let px = 0, pz = 0;
  const n = 9;
  for (let i = 0; i < n; i++) {
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.22 - i * 0.012, 0.28 - i * 0.012, h / n + 0.1, 10), bark);
    seg.position.set(px, (i + 0.5) * h / n, pz); seg.rotation.z = -lean.x * i * 2.5; seg.rotation.x = lean.z * i * 2.5; seg.castShadow = true; t.add(seg);
    px += lean.x * i * h / n * 0.9; pz += lean.z * i * h / n * 0.9;
  }
  const top = new THREE.Vector3(px, h, pz);
  const leafMat = mat(0x2f8a3a, { roughness: 0.8, side: THREE.DoubleSide });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rnd(-0.2, 0.2);
    const leaf = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 4.2, 1, 6), leafMat);
    const lp = leaf.geometry.attributes.position;
    for (let k = 0; k < lp.count; k++) { const y = lp.getY(k); lp.setZ(k, -Math.pow((y + 2.1) / 4.2, 2) * 1.6); lp.setX(k, lp.getX(k) * (1 - Math.abs(y) / 2.4)); }
    leaf.geometry.computeVertexNormals();
    leaf.position.copy(top); leaf.rotation.y = a; leaf.rotation.x = -Math.PI / 2 + 0.35; leaf.translateY(2.0); leaf.castShadow = true; t.add(leaf);
  }
  for (let i = 0; i < 3; i++) { const nut = sphere(0.22, 0x5b3d1e, 10, { roughness: 0.9 }); nut.position.copy(top).add(new THREE.Vector3(rnd(-0.3, 0.3), -0.3, rnd(-0.3, 0.3))); t.add(nut); }
  return t;
}
function beach(scene: THREE.Scene): Stadium {
  const g = new THREE.Group();
  const sunDir = new THREE.Vector3(-0.5, 0.7, 0.5);
  g.add(makeSky(0x2f7fd8, 0x8ecdf7, 0xdff1fb, sunDir, 0.5));
  scene.fog = new THREE.FogExp2(0xcfe9f7, 0.0025);
  g.add(ground(0xe7d2a3, 600, 1, 0.1));
  // ocean beyond the far hoop
  const og = new THREE.PlaneGeometry(700, 320, 140, 64);
  const ocean = new THREE.Mesh(og, mat(0x1b7fc2, { roughness: 0.12, metalness: 0.15, opacity: 0.94 }));
  ocean.rotation.x = -Math.PI / 2; ocean.position.set(0, -0.05, 205); g.add(ocean);
  const foam = new THREE.Mesh(new THREE.PlaneGeometry(700, 6), mat(0xffffff, { roughness: 1, opacity: 0.8 })); foam.rotation.x = -Math.PI / 2; foam.position.set(0, -0.02, 46); g.add(foam);
  for (let i = 0; i < 18; i++) { const a = rnd(0, 6.28), r = rnd(24, 70); if (Math.sin(a) * r > 40) continue; g.add(palm(Math.cos(a) * r, Math.sin(a) * r, rnd(7, 12))); }
  // umbrellas and towels near the water
  for (let i = 0; i < 7; i++) {
    const x = rnd(-60, 60), z = rnd(28, 42);
    const pole = cyl(0.04, 0.04, 2.6, 0xeeeeee, 8, { metalness: 0.5 }); pole.position.set(x, 1.0, z); g.add(pole);
    const top = cone(1.8, 0.7, [0xe53935, 0x1e88e5, 0xfdd835][i % 3], 12, { roughness: 0.8, side: THREE.DoubleSide }); top.position.set(x, 2.3, z); g.add(top);
    const towel = box(1.2, 0.03, 2.2, [0xff7043, 0x00acc1, 0xab47bc][i % 3], { roughness: 1 }); towel.position.set(x + 1.6, -0.28, z); g.add(towel);
  }
  scene.add(new THREE.HemisphereLight(0xbfe3ff, 0xe7d2a3, 0.8));
  const s = sun(0xfff6e0, 2.8, sunDir.x * 60, sunDir.y * 60, sunDir.z * 60); g.add(s, s.target);
  const base = og.attributes.position.array.slice() as Float32Array;
  return {
    group: g, floorTint: '#d9a561', helmets: false,
    update: (t) => {
      const p = og.attributes.position;
      for (let i = 0; i < p.count; i++) { const x = base[i * 3], y = base[i * 3 + 1]; p.setZ(i, Math.sin(x * 0.08 + t * 1.2) * 0.35 + Math.sin(y * 0.15 - t * 0.9) * 0.25); }
      p.needsUpdate = true; og.computeVertexNormals();
    },
  };
}

export function buildStadium(id: StadiumId, scene: THREE.Scene): Stadium {
  scene.fog = null; scene.background = null;
  return { circus, snow, city, moon, beach }[id](scene);
}
