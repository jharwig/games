// =============================================================================
// per-track scenery (sky, ground, lights, decorations) and the obstacle /
// pad models that sit on the road.
// =============================================================================
import * as THREE from 'three';
import { box, cone, cyl, sphere, mat, makeSky, makeStars } from './gfx';
import type { BuiltTrack, TrackDef } from './tracks';
import { nearestSample } from './tracks';
import { seeded } from './util';

export interface Scenery {
  group: THREE.Group;
  sun: THREE.DirectionalLight;
  /** things that animate (lava glow, waves, planets) */
  update: (t: number) => void;
}

export function buildScenery(track: BuiltTrack): Scenery {
  const def = track.def;
  const g = new THREE.Group();
  const rnd = seeded(def.id.length * 7919 + 17);
  const anim: ((t: number) => void)[] = [];

  // sky + lights
  const sunDir = new THREE.Vector3(...def.sunDir);
  g.add(makeSky(def.sky[0], def.sky[1], def.sky[2], sunDir, def.id === 'volcano' ? 0.4 : def.id === 'space' ? 0 : 0.35));
  if (def.id === 'space' || def.id === 'volcano') g.add(makeStars(def.id === 'space' ? 1800 : 500, 1200));
  const hemi = new THREE.HemisphereLight(def.hemi[0], def.hemi[1], def.hemiIntensity ?? 1.1);
  g.add(hemi);
  const sun = new THREE.DirectionalLight(def.sunColor, def.sunIntensity);
  sun.position.copy(sunDir).multiplyScalar(120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 10; sc.far = 400;
  sun.shadow.bias = -0.0008;
  g.add(sun); g.add(sun.target);

  // ground
  if (def.ground !== null) {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), mat(def.ground));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    g.add(ground);
  }

  // bounds of the track for scattering props
  const bb = new THREE.Box2();
  for (const s of track.samples) bb.expandByPoint(new THREE.Vector2(s.p.x, s.p.z));
  const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.y + bb.max.y) / 2;

  // sky dressing: clouds (and a few flying things) so the horizon isn't bare
  const skyStuff = skyDressing(def, rnd, cx, cz);
  g.add(skyStuff.group);
  anim.push(skyStuff.update);
  const span = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y) + 180;
  const roadClear = def.width / 2 + 5;

  /** random spot away from the road; returns null if unlucky */
  const spot = (margin = roadClear, tries = 20): [number, number] | null => {
    for (let i = 0; i < tries; i++) {
      const x = cx + (rnd() - 0.5) * span, z = cz + (rnd() - 0.5) * span;
      const s = track.samples[nearestSample(track.samples, x, z)];
      const d = Math.hypot(s.p.x - x, s.p.z - z);
      if (d > margin) return [x, z];
    }
    return null;
  };

  const place = (o: THREE.Object3D, x: number, z: number, y = 0) => { o.position.set(x, y, z); g.add(o); };

  switch (def.id) {
    case 'speedway': {
      // grandstands along two long stretches
      for (const side of [1, -1]) {
        for (let i = 0; i < 2; i++) {
          const idx = Math.floor(track.samples.length * (i === 0 ? 0.03 : 0.52));
          const s = track.samples[idx];
          const st = grandstand(rnd);
          st.position.copy(s.p).addScaledVector(s.n, side * (def.width / 2 + 12));
          st.lookAt(s.p.x, 0, s.p.z);
          g.add(st);
        }
      }
      for (let i = 0; i < 90; i++) { const p = spot(roadClear + 6); if (p) place(tree(rnd, 0x2f9a3a, 0x3fb84a), p[0], p[1]); }
      for (let i = 0; i < 40; i++) { const p = spot(roadClear); if (p) place(bush(rnd), p[0], p[1]); }
      // tyre walls at a few corners
      for (let i = 0; i < 6; i++) {
        const s = track.samples[Math.floor(track.samples.length * (i / 6 + 0.08))];
        const side = i % 2 ? 1 : -1;
        const stack = tyreWall(rnd);
        stack.position.copy(s.p).addScaledVector(s.n, side * (def.width / 2 + 3));
        stack.rotation.y = Math.atan2(s.t.x, s.t.z);
        g.add(stack);
      }
      break;
    }
    case 'beach': {
      // sea on one side, glittering
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(2400, 900, 60, 24), mat(0x2a9fd6, { emissive: 0x0a3550, emissiveIntensity: 0.3 }));
      sea.rotation.x = -Math.PI / 2;
      sea.position.set(0, 0.35, bb.max.y + 520);
      g.add(sea);
      const foam = new THREE.Mesh(new THREE.PlaneGeometry(2400, 12), mat(0xffffff));
      foam.rotation.x = -Math.PI / 2; foam.position.set(0, 0.4, bb.max.y + 72); g.add(foam);
      const seaPos = sea.geometry.attributes.position as THREE.BufferAttribute;
      const base = seaPos.array.slice() as Float32Array;
      anim.push((t) => {
        for (let i = 0; i < seaPos.count; i++) {
          seaPos.setZ(i, base[i * 3 + 2] + Math.sin(t * 1.5 + base[i * 3] * 0.05 + base[i * 3 + 1] * 0.08) * 1.2);
        }
        seaPos.needsUpdate = true;
        foam.position.z = bb.max.y + 72 + Math.sin(t * 0.8) * 3;
      });
      for (let i = 0; i < 70; i++) { const p = spot(roadClear + 3); if (p) place(palm(rnd), p[0], p[1]); }
      for (let i = 0; i < 24; i++) { const p = spot(roadClear + 2); if (p) place(umbrella(rnd), p[0], p[1]); }
      for (let i = 0; i < 30; i++) { const p = spot(roadClear); if (p) place(rock(rnd, 0xd9c39a, 0.8), p[0], p[1]); }
      break;
    }
    case 'dirt': {
      for (let i = 0; i < 260; i++) { const p = spot(roadClear + 1); if (p) place(pine(rnd), p[0], p[1]); }
      for (let i = 0; i < 40; i++) { const p = spot(roadClear); if (p) place(rock(rnd, 0x8a8a8a, 1.4), p[0], p[1]); }
      for (let i = 0; i < 30; i++) { const p = spot(roadClear - 3); if (p) place(bush(rnd), p[0], p[1]); }
      // distant hills
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const h = cone(160 + rnd() * 80, 90 + rnd() * 70, 0x3f7a35, 7);
        h.position.set(cx + Math.cos(a) * 700, 0, cz + Math.sin(a) * 700);
        h.castShadow = false;
        g.add(h);
      }
      break;
    }
    case 'ice': {
      // snowy mountains ringing the lake
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + rnd() * 0.3;
        const r = 150 + rnd() * 90, h = 120 + rnd() * 120;
        const m = cone(r, h, 0xdfe9f5, 6);
        m.position.set(cx + Math.cos(a) * (560 + rnd() * 200), h * 0.5 - 40, cz + Math.sin(a) * (560 + rnd() * 200));
        m.castShadow = false;
        const cap = cone(r * 0.45, h * 0.45, 0xffffff, 6);
        cap.position.y = h * 0.28; m.add(cap);
        g.add(m);
      }
      for (let i = 0; i < 80; i++) { const p = spot(roadClear + 4); if (p) place(pine(rnd, true), p[0], p[1]); }
      for (let i = 0; i < 40; i++) { const p = spot(roadClear + 2); if (p) place(snowman(rnd), p[0], p[1]); }
      for (let i = 0; i < 60; i++) { const p = spot(roadClear); if (p) place(rock(rnd, 0xc8d8ea, 1.0), p[0], p[1]); }
      break;
    }
    case 'volcano': {
      // the volcano itself sits inside the loop
      const vol = cone(120, 150, 0x3a2a2e, 10);
      vol.position.set(cx, 70, cz);
      g.add(vol);
      const crater = cyl(24, 30, 6, 0xff7a1a, 12, { emissive: 0xff4a00, emissiveIntensity: 1.2 });
      crater.position.set(cx, 145, cz); g.add(crater);
      const glow = new THREE.PointLight(0xff6a1a, 40, 900, 1.2);
      glow.position.set(cx, 170, cz); g.add(glow);
      anim.push((t) => { glow.intensity = 40 + Math.sin(t * 3) * 12 + Math.sin(t * 7.3) * 6; });
      for (let i = 0; i < 5; i++) {
        const stream = box(4, 0.5, 100, 0xff6a1a, { emissive: 0xff3a00, emissiveIntensity: 1 });
        const a = (i / 5) * Math.PI * 2 + 0.4;
        stream.position.set(cx + Math.cos(a) * 60, 78, cz + Math.sin(a) * 60);
        stream.lookAt(cx, 148, cz);
        stream.castShadow = false;
        g.add(stream);
      }
      for (let i = 0; i < 40; i++) { const p = spot(roadClear + 2); if (p) place(lavaPool(rnd, 5 + rnd() * 8), p[0], p[1], 0.02); }
      for (let i = 0; i < 90; i++) { const p = spot(roadClear); if (p) place(rock(rnd, 0x4a3a3e, 1.8), p[0], p[1]); }
      for (let i = 0; i < 60; i++) { const p = spot(roadClear + 1); if (p) place(deadTree(rnd), p[0], p[1]); }
      // ash particles drifting
      const ash = makeStars(300, 260);
      (ash.material as THREE.PointsMaterial).color.set(0xffa070);
      (ash.material as THREE.PointsMaterial).size = 2;
      ash.position.set(cx, 20, cz);
      g.add(ash);
      anim.push((t) => { ash.rotation.y = t * 0.02; ash.position.y = 20 + Math.sin(t * 0.3) * 6; });
      break;
    }
    case 'space': {
      const planets: [number, number, number][] = [[0x6bb8ff, 90, 0], [0xffa14d, 60, 1], [0xc94dff, 40, 2], [0x8fe08f, 30, 3]];
      planets.forEach(([col, r, i]) => {
        const p = sphere(r, col, 24, { emissive: col, emissiveIntensity: 0.15 });
        const a = i * 1.7 + 0.5;
        p.position.set(cx + Math.cos(a) * 700, 90 + i * 60, cz + Math.sin(a) * 700);
        p.castShadow = false;
        if (i === 1) {
          const ring = new THREE.Mesh(new THREE.RingGeometry(r * 1.4, r * 2.1, 40), mat(0xffd9a0, { side: THREE.DoubleSide }));
          ring.rotation.x = 1.2; p.add(ring);
        }
        g.add(p);
        anim.push((t) => { p.rotation.y = t * 0.05 * (i + 1); });
      });
      for (let i = 0; i < 60; i++) {
        const p = spot(roadClear + 6, 40);
        if (!p) continue;
        const a = asteroid(rnd, 1.5 + rnd() * 5);
        a.position.set(p[0], -30 + rnd() * 90, p[1]);
        const spin = rnd() * 0.5 + 0.1;
        anim.push((t) => { a.rotation.y = t * spin; a.rotation.x = t * spin * 0.6; });
        g.add(a);
      }
      // a nebula glow below the track
      const neb = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshBasicMaterial({ color: 0x1a0f4a, transparent: true, opacity: 0.55, fog: false }));
      neb.rotation.x = -Math.PI / 2; neb.position.set(cx, -160, cz); g.add(neb);
      break;
    }
  }

  return { group: g, sun, update: (t) => { for (const f of anim) f(t); } };
}

export function fogFor(def: TrackDef): THREE.Fog | null {
  return def.fog ? new THREE.Fog(def.fog.color, def.fog.near, def.fog.far) : null;
}

// ---- sky dressing ---------------------------------------------------------

function cloud(rnd: () => number, col: number, size: number, flat = false): THREE.Group {
  const g = new THREE.Group();
  const n = 4 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const r = size * (0.45 + rnd() * 0.55);
    const puff = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 7), mat(col, { emissive: col, emissiveIntensity: 0.25 }));
    puff.position.set((i - n / 2) * size * 0.7 + (rnd() - 0.5) * size * 0.4, (rnd() - 0.3) * size * 0.35, (rnd() - 0.5) * size * 0.6);
    if (flat) puff.scale.y = 0.35;
    puff.castShadow = false;
    g.add(puff);
  }
  return g;
}

function skyDressing(def: TrackDef, rnd: () => number, cx: number, cz: number): { group: THREE.Group; update: (t: number) => void } {
  const g = new THREE.Group();
  const drift: { o: THREE.Object3D; a: number; r: number; y: number; speed: number; bob: number }[] = [];
  const ring = (count: number, make: () => THREE.Object3D, rMin: number, rMax: number, yMin: number, yMax: number, speed: number) => {
    for (let i = 0; i < count; i++) {
      const o = make();
      const a = rnd() * Math.PI * 2, r = rMin + rnd() * (rMax - rMin), y = yMin + rnd() * (yMax - yMin);
      o.position.set(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r);
      g.add(o);
      drift.push({ o, a, r, y, speed: speed * (0.6 + rnd() * 0.8), bob: rnd() * 6.28 });
    }
  };
  switch (def.id) {
    case 'speedway':
      ring(26, () => cloud(rnd, 0xffffff, 14 + rnd() * 16), 350, 900, 110, 220, 0.004);
      ring(2, () => blimp(rnd), 260, 420, 90, 130, 0.01);
      break;
    case 'beach':
      ring(22, () => cloud(rnd, 0xffb28a, 22 + rnd() * 20, true), 400, 950, 60, 170, 0.003);
      ring(10, () => cloud(rnd, 0xfff0d8, 8 + rnd() * 8, true), 300, 700, 120, 200, 0.004);
      ring(3, () => gulls(rnd), 120, 300, 30, 60, 0.03);
      break;
    case 'dirt':
      ring(30, () => cloud(rnd, 0xf6faff, 12 + rnd() * 18), 350, 900, 120, 240, 0.005);
      ring(2, () => balloon(rnd), 250, 450, 80, 140, 0.008);
      break;
    case 'ice':
      ring(24, () => cloud(rnd, 0xe9f2ff, 16 + rnd() * 22, true), 400, 950, 140, 260, 0.003);
      ring(1, () => aurora(rnd), 0, 0, 0, 0, 0);
      break;
    case 'volcano':
      ring(20, () => cloud(rnd, 0x6a3a3a, 18 + rnd() * 20), 350, 900, 120, 230, 0.006);
      ring(6, () => cloud(rnd, 0xff8a4a, 10 + rnd() * 10), 120, 260, 150, 220, 0.01);
      break;
    case 'space':
      ring(4, () => cloud(rnd, 0x6a3ad0, 60 + rnd() * 50, true), 700, 1100, -120, 60, 0.001);
      ring(3, () => cloud(rnd, 0x2a9ad0, 50 + rnd() * 40, true), 700, 1100, 120, 260, 0.001);
      ring(6, () => comet(rnd), 500, 900, 150, 400, 0.02);
      break;
  }
  return {
    group: g,
    update: (t) => {
      for (const d of drift) {
        if (!d.speed) continue;
        const a = d.a + t * d.speed;
        d.o.position.set(cx + Math.cos(a) * d.r, d.y + Math.sin(t * 0.5 + d.bob) * 2, cz + Math.sin(a) * d.r);
        d.o.rotation.y = -a;
      }
    },
  };
}

function blimp(rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  const body = sphere(9, 0xf4f4f4, 14); body.scale.set(1, 1, 2.4); body.castShadow = false; g.add(body);
  const stripe = sphere(9.05, 0xe8262c, 14); stripe.scale.set(1, 0.3, 2.4); stripe.castShadow = false; g.add(stripe);
  const fin = box(0.5, 8, 6, 0xe8262c); fin.position.set(0, 4, 18); g.add(fin);
  const fin2 = box(12, 0.5, 6, 0xe8262c); fin2.position.set(0, 0, 18); g.add(fin2);
  const gondola = box(3, 2, 6, 0x333344); gondola.position.set(0, -9, 0); g.add(gondola);
  g.rotation.y = rnd() * 6.28;
  return g;
}
function balloon(rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  const col = [0xff5c5c, 0x3aa6d8, 0xffd23f, 0x4fd14a][Math.floor(rnd() * 4)];
  const env = sphere(10, col, 14); env.scale.y = 1.2; env.castShadow = false; g.add(env);
  const stripe = sphere(10.05, 0xffffff, 14); stripe.scale.set(0.35, 1.2, 1); stripe.castShadow = false; g.add(stripe);
  const basket = box(4, 3, 4, 0x8a6238); basket.position.y = -16; g.add(basket);
  return g;
}
function gulls(rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Group();
    const l = box(3, 0.2, 0.6, 0xffffff); l.position.x = -1.4; l.rotation.z = 0.35; b.add(l);
    const r = box(3, 0.2, 0.6, 0xffffff); r.position.x = 1.4; r.rotation.z = -0.35; b.add(r);
    b.position.set(i * 5 - 10, Math.abs(i - 2) * -2, Math.abs(i - 2) * 4);
    g.add(b);
  }
  g.rotation.y = rnd() * 6.28;
  return g;
}
function aurora(rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(900, 90 + rnd() * 60, 40, 1),
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0x4fffb0 : 0x7a7aff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, fog: false, depthWrite: false }));
    const pos = m.geometry.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < pos.count; k++) pos.setZ(k, Math.sin(pos.getX(k) * 0.01 + i) * 40);
    m.position.set((rnd() - 0.5) * 300, 260 + i * 40, -900 + i * 60);
    g.add(m);
  }
  return g;
}
function comet(rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  const head = sphere(3, 0xffffff, 8, { emissive: 0xffffff, emissiveIntensity: 1 }); head.castShadow = false; g.add(head);
  const tail = cone(2.5, 40, 0x8fd0ff, 8, { emissive: 0x3d8fff, emissiveIntensity: 0.6, opacity: 0.5 });
  tail.rotation.z = Math.PI / 2; tail.position.x = 20; tail.castShadow = false; g.add(tail);
  g.rotation.z = (rnd() - 0.5) * 0.6;
  return g;
}

// ---- decorations ----------------------------------------------------------

function tree(rnd: () => number, a: number, b: number): THREE.Group {
  const g = new THREE.Group();
  const h = 4 + rnd() * 3;
  const trunk = cyl(0.35, 0.5, h * 0.5, 0x6b4a2a, 7); trunk.position.y = h * 0.25; g.add(trunk);
  const crown = sphere(2 + rnd() * 1.4, rnd() > 0.5 ? a : b, 8); crown.position.y = h * 0.5 + 1.6; crown.scale.y = 1.15; g.add(crown);
  g.rotation.y = rnd() * 6.28;
  return g;
}
function pine(rnd: () => number, snowy = false): THREE.Group {
  const g = new THREE.Group();
  const h = 6 + rnd() * 6;
  const trunk = cyl(0.3, 0.45, h * 0.35, 0x5a3a1e, 6); trunk.position.y = h * 0.17; g.add(trunk);
  const col = snowy ? 0x2f6b4a : 0x2a7a35;
  for (let i = 0; i < 3; i++) {
    const c = cone(2.6 - i * 0.6, h * 0.36, col, 7);
    c.position.y = h * 0.35 + i * h * 0.2;
    g.add(c);
    if (snowy) { const s = cone(2.2 - i * 0.55, h * 0.12, 0xffffff, 7); s.position.y = c.position.y + h * 0.13; g.add(s); }
  }
  g.rotation.y = rnd() * 6.28;
  g.scale.setScalar(0.8 + rnd() * 0.5);
  return g;
}
function palm(rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  const h = 7 + rnd() * 4;
  const lean = (rnd() - 0.5) * 0.4;
  const trunk = cyl(0.25, 0.45, h, 0x9a7048, 7); trunk.position.y = h / 2; trunk.rotation.z = lean; g.add(trunk);
  const top = new THREE.Vector3(Math.sin(-lean) * h, Math.cos(lean) * h, 0);
  for (let i = 0; i < 7; i++) {
    const leaf = box(0.7, 0.12, 4.5, 0x3fbf5a);
    leaf.position.copy(top).add(new THREE.Vector3(0, 0.2, 0));
    leaf.rotation.y = (i / 7) * Math.PI * 2;
    leaf.rotation.x = -0.5;
    leaf.translateZ(2.0);
    g.add(leaf);
  }
  const coco = sphere(0.35, 0x6b4a2a, 6); coco.position.copy(top); g.add(coco);
  g.rotation.y = rnd() * 6.28;
  return g;
}
function umbrella(rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  const pole = cyl(0.08, 0.08, 3, 0xf4f4f4, 6); pole.position.y = 1.5; g.add(pole);
  const top = cone(2.2, 1.0, [0xff5c5c, 0x3aa6d8, 0xffd23f, 0xff8fd8][Math.floor(rnd() * 4)], 8); top.position.y = 3.2; g.add(top);
  const towel = box(2.4, 0.08, 1.2, 0xffffff); towel.position.set(2.2, 0.05, 0.5); towel.rotation.y = rnd(); g.add(towel);
  return g;
}
function bush(rnd: () => number): THREE.Mesh {
  const b = sphere(0.9 + rnd() * 0.8, 0x2f8a3a, 7); b.scale.y = 0.7; b.position.y = 0.5; return b;
}
function rock(rnd: () => number, col: number, size: number): THREE.Mesh {
  const r = sphere(size * (0.7 + rnd() * 0.8), col, 6);
  r.scale.set(1 + rnd() * 0.6, 0.6 + rnd() * 0.5, 1 + rnd() * 0.6);
  r.rotation.y = rnd() * 6.28;
  r.position.y = size * 0.3;
  return r;
}
function snowman(rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  const a = sphere(1.0, 0xffffff, 10); a.position.y = 0.9; g.add(a);
  const b = sphere(0.75, 0xffffff, 10); b.position.y = 2.3; g.add(b);
  const c = sphere(0.55, 0xffffff, 10); c.position.y = 3.35; g.add(c);
  const nose = cone(0.12, 0.6, 0xff7a1a, 6); nose.rotation.x = Math.PI / 2; nose.position.set(0, 3.35, -0.7); g.add(nose);
  const hat = cyl(0.4, 0.4, 0.6, 0x222222, 8); hat.position.y = 4.0; g.add(hat);
  const brim = cyl(0.7, 0.7, 0.08, 0x222222, 8); brim.position.y = 3.75; g.add(brim);
  g.rotation.y = rnd() * 6.28;
  return g;
}
function deadTree(rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  const h = 5 + rnd() * 4;
  const t = cyl(0.2, 0.5, h, 0x1e1416, 6); t.position.y = h / 2; g.add(t);
  for (let i = 0; i < 3; i++) {
    const br = cyl(0.08, 0.2, h * 0.5, 0x1e1416, 5);
    br.position.set(0, h * (0.55 + i * 0.15), 0);
    br.rotation.z = (rnd() - 0.5) * 1.8; br.rotation.y = rnd() * 6.28;
    br.translateY(h * 0.2);
    g.add(br);
  }
  return g;
}
function grandstand(rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  const rows = 6, width = 60;
  for (let r = 0; r < rows; r++) {
    const step = box(width, 1.2, 2.4, r % 2 ? 0x8a93a8 : 0x9aa3b8);
    step.position.set(0, 0.6 + r * 1.2, 2 + r * 2.4);
    g.add(step);
    for (let s = -width / 2 + 2; s < width / 2 - 1; s += 2.2) {
      if (rnd() > 0.35) {
        const fan = box(1.0, 1.2, 0.8, [0xff5c5c, 0x3aa6d8, 0xffd23f, 0x4fd14a, 0xff8fd8, 0xffffff][Math.floor(rnd() * 6)]);
        fan.position.set(s + rnd() * 0.6, 1.8 + r * 1.2, 2 + r * 2.4);
        fan.castShadow = false;
        g.add(fan);
      }
    }
  }
  const roof = box(width + 4, 0.4, rows * 2.4 + 2, 0xe8262c); roof.position.set(0, rows * 1.2 + 4.5, 2 + (rows * 2.4) / 2); g.add(roof);
  for (const x of [-width / 2, width / 2]) { const p = cyl(0.3, 0.3, rows * 1.2 + 4.5, 0x555566, 6); p.position.set(x, (rows * 1.2 + 4.5) / 2, rows * 2.4 + 1); g.add(p); }
  return g;
}
function tyreWall(rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  for (let i = -4; i <= 4; i++) for (let r = 0; r < 2; r++) {
    const t = cyl(0.55, 0.55, 0.5, r ? 0xffffff : 0x1b1b22, 10);
    t.position.set(0, 0.25 + r * 0.5, i * 1.15 + (r ? 0.55 : 0));
    g.add(t);
  }
  g.rotation.y += rnd() * 0.1;
  return g;
}
function asteroid(rnd: () => number, size: number): THREE.Mesh {
  const geo = new THREE.IcosahedronGeometry(size, 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const f = 0.8 + rnd() * 0.4;
    pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f, pos.getZ(i) * f);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, mat(0x7a7a8a, { flat: true }));
  m.castShadow = true;
  return m;
}

// ---- road obstacles & pads ------------------------------------------------

export type ObstacleKind = 'rock' | 'cone' | 'oil' | 'lava' | 'crack' | 'dune' | 'asteroid' | 'tyres';

export function buildObstacle(kind: ObstacleKind, rnd: () => number): THREE.Object3D {
  switch (kind) {
    case 'rock': return rock(rnd, 0x7a7a86, 1.6);
    case 'cone': {
      const g = new THREE.Group();
      const c = cone(0.55, 1.6, 0xff7a1a, 8); c.position.y = 0.8; g.add(c);
      const band = cyl(0.36, 0.42, 0.2, 0xffffff, 8); band.position.y = 0.95; g.add(band);
      const base = box(1.1, 0.12, 1.1, 0xff7a1a); base.position.y = 0.06; g.add(base);
      return g;
    }
    case 'oil': {
      const m = new THREE.Mesh(new THREE.CircleGeometry(2.6, 14), new THREE.MeshBasicMaterial({ color: 0x14141c }));
      m.rotation.x = -Math.PI / 2; m.position.y = 0.06; m.scale.x = 1.3;
      const sheen = new THREE.Mesh(new THREE.CircleGeometry(1.4, 10), new THREE.MeshBasicMaterial({ color: 0x4a3aa8, transparent: true, opacity: 0.5 }));
      sheen.position.set(0.5, 0.3, 0.01); m.add(sheen);
      return m;
    }
    case 'lava': return lavaPool(rnd, 3.2);
    case 'crack': {
      const g = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const seg = box(0.35, 0.05, 3 + rnd() * 2, 0x2a5f9a, { emissive: 0x1a3f7a, emissiveIntensity: 0.4 });
        seg.position.set((rnd() - 0.5) * 4, 0.06, (rnd() - 0.5) * 3);
        seg.rotation.y = rnd() * 3;
        g.add(seg);
      }
      return g;
    }
    case 'dune': {
      const d = sphere(2.4, 0xe9cf95, 10); d.scale.set(1.6, 0.45, 1.0); d.position.y = 0; d.rotation.y = rnd() * 3; return d;
    }
    case 'asteroid': { const a = asteroid(rnd, 2.0); a.position.y = 1.4; return a; }
    case 'tyres': { const t = tyreWall(rnd); t.rotation.y = Math.PI / 2; return t; }
  }
}

function lavaPool(rnd: () => number, r: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CircleGeometry(r, 16), new THREE.MeshBasicMaterial({ color: 0xff6a1a }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.07;
  m.scale.set(1 + rnd() * 0.5, 1, 1);
  const core = new THREE.Mesh(new THREE.CircleGeometry(r * 0.55, 12), new THREE.MeshBasicMaterial({ color: 0xffd23f }));
  core.position.z = 0.01; core.position.x = r * 0.15; m.add(core);
  const light = new THREE.PointLight(0xff6a1a, 6, r * 6, 1.5);
  light.position.z = 1.5; m.add(light);
  return m;
}

export function buildPad(kind: 'boost' | 'slow'): THREE.Group {
  const g = new THREE.Group();
  const col = kind === 'boost' ? 0x2fe06a : 0xff3b3b;
  const glow = kind === 'boost' ? 0x0a5a22 : 0x5a0a0a;
  const base = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 6), mat(col, { emissive: glow, emissiveIntensity: 0.8 }));
  base.rotation.x = -Math.PI / 2; base.position.y = 0.06; g.add(base);
  for (let i = 0; i < 3; i++) {
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(1.4, 1.4, 3), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    arrow.rotation.x = -Math.PI / 2;
    arrow.rotation.z = kind === 'boost' ? 0 : Math.PI;
    arrow.scale.set(1, 1, 0.05);
    arrow.position.set(0, 0.08, -1.8 + i * 1.8);
    g.add(arrow);
  }
  return g;
}
