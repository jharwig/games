// toon.ts — the inked-cel look: a shared toon gradient ramp, procedural
// canvas textures, and per-material tuning for the ink outline pass
// (OutlineEffect in main.ts). No image assets — everything is generated.

import * as THREE from 'three';

// --- toon ramp -------------------------------------------------------------

let ramp: THREE.DataTexture | null = null;

/** Shared 3-band gradient map: hard shadow / mid / lit — the cel boundary. */
export function toonRamp(): THREE.DataTexture {
  if (!ramp) {
    const data = new Uint8Array([
      118, 118, 118, 255, // shadow band
      186, 186, 186, 255, // mid band
      255, 255, 255, 255, // lit band
    ]);
    ramp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
    ramp.minFilter = THREE.NearestFilter;
    ramp.magFilter = THREE.NearestFilter;
    ramp.needsUpdate = true;
  }
  return ramp;
}

export function toonMat(
  params: THREE.MeshToonMaterialParameters & { flatShading?: boolean } = {},
): THREE.MeshToonMaterial {
  // MeshToonMaterial's params type omits flatShading, but the renderer honors
  // the property — low-poly meshes keep their faceted cel look.
  const { flatShading, ...rest } = params;
  const m = new THREE.MeshToonMaterial({ gradientMap: toonRamp(), ...rest });
  if (flatShading) (m as unknown as { flatShading: boolean }).flatShading = true;
  return m;
}

// --- outline tuning --------------------------------------------------------

/** Skip the ink outline for this material (ground, water, fx, decals…). */
export function noOutline<T extends THREE.Material>(m: T): T {
  m.userData.outlineParameters = { visible: false };
  return m;
}

/** Custom ink weight for this material (screen-relative thickness). */
export function inkWeight<T extends THREE.Material>(m: T, thickness: number): T {
  m.userData.outlineParameters = { thickness };
  return m;
}

// --- procedural textures ---------------------------------------------------

export function canvasTexture(
  w: number,
  h: number,
  draw: (c: CanvasRenderingContext2D) => void,
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  draw(canvas.getContext('2d')!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** Vertical wood grain, near-white so it multiplies under the material color. */
export function woodGrainTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 128, (c) => {
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * 128;
      c.strokeStyle = `rgba(90,50,20,${0.10 + Math.random() * 0.14})`;
      c.lineWidth = 1 + Math.random() * 2.5;
      c.beginPath();
      c.moveTo(x, -4);
      c.bezierCurveTo(
        x + (Math.random() - 0.5) * 14, 40,
        x + (Math.random() - 0.5) * 14, 90,
        x + (Math.random() - 0.5) * 10, 132,
      );
      c.stroke();
    }
    // a few knots
    for (let i = 0; i < 3; i++) {
      const x = Math.random() * 128;
      const y = Math.random() * 128;
      c.strokeStyle = 'rgba(80,45,18,0.35)';
      c.lineWidth = 1.5;
      c.beginPath();
      c.ellipse(x, y, 3 + Math.random() * 3, 5 + Math.random() * 4, 0, 0, Math.PI * 2);
      c.stroke();
    }
  });
}

/** Wind Waker grass: flat green broken up by darker rounded patch blobs.
 *  Near-white base so it multiplies under vertex colors (grass AND sand). */
export function grassPatchTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, (c) => {
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, 256, 256);
    // large soft-edged patch blobs, slightly dark + green-shifted
    for (let i = 0; i < 10; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      const r = 26 + Math.random() * 34;
      c.fillStyle = 'rgba(40,110,30,0.16)';
      // draw wrapped so the tile repeats seamlessly
      for (const dx of [-256, 0, 256]) {
        for (const dy of [-256, 0, 256]) {
          c.beginPath();
          c.ellipse(x + dx, y + dy, r, r * 0.72, 0, 0, Math.PI * 2);
          c.fill();
        }
      }
    }
    // sparse tiny speckles
    for (let i = 0; i < 260; i++) {
      c.fillStyle = `rgba(30,90,25,${0.05 + Math.random() * 0.08})`;
      c.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
  });
}

/** Worn ground under a swingset: packed dirt scuffed bare under each seat,
 *  ringed by thin ragged grass. `seatFracs` are seat centres as 0..1 across
 *  the texture's width. Transparent decal — lay it over the grass. */
export function wornDirtTexture(seatFracs: number[]): THREE.CanvasTexture {
  const tex = canvasTexture(256, 128, (c) => {
    c.clearRect(0, 0, 256, 128);
    // ragged fringe of thinned-out yellowing grass around the whole patch
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2;
      const wob = 0.82 + Math.random() * 0.3;
      const x = 128 + Math.cos(a) * 112 * wob;
      const y = 64 + Math.sin(a) * 44 * wob;
      c.fillStyle = `rgba(168,150,84,${0.22 + Math.random() * 0.16})`;
      c.beginPath();
      c.ellipse(x, y, 12 + Math.random() * 12, 8 + Math.random() * 8, a, 0, Math.PI * 2);
      c.fill();
    }
    // trampled dirt band spanning the seat row
    c.fillStyle = 'rgba(176,138,84,0.85)';
    c.beginPath();
    c.ellipse(128, 64, 102, 34, 0, 0, Math.PI * 2);
    c.fill();
    for (const f of seatFracs) {
      const x = f * 256;
      // drag ruts along the swing arc (texture y = world z)
      c.fillStyle = 'rgba(150,112,62,0.8)';
      c.beginPath();
      c.roundRect(x - 7, 22, 14, 84, 7);
      c.fill();
      // deepest wear right under the seat
      c.fillStyle = 'rgba(128,92,50,0.9)';
      c.beginPath();
      c.ellipse(x, 64, 15, 20, 0, 0, Math.PI * 2);
      c.fill();
    }
    // pebbles and dry speckles in the dirt
    for (let i = 0; i < 70; i++) {
      const x = 128 + (Math.random() - 0.5) * 190;
      const y = 64 + (Math.random() - 0.5) * 58;
      c.fillStyle =
        Math.random() < 0.5 ? 'rgba(200,170,120,0.5)' : 'rgba(110,80,45,0.4)';
      c.fillRect(x, y, 2, 2);
    }
  });
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** Wind Waker sea: saturated blue with rows of lighter rounded splotches.
 *  Full-color — use with a white material color. */
export function seaSplotchTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 256, (c) => {
    c.fillStyle = '#1f6fd8';
    c.fillRect(0, 0, 256, 256);
    c.fillStyle = '#5da8f0';
    for (let row = 0; row < 6; row++) {
      const y = 12 + row * 42;
      for (let i = 0; i < 5; i++) {
        const x = ((i * 56 + row * 29) % 280) - 12;
        const w = 26 + ((i * 13 + row * 7) % 22);
        c.beginPath();
        c.roundRect(x, y + ((i * 7) % 9), w, 9, 5);
        c.fill();
      }
    }
    // sparse white glints
    c.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 7; i++) {
      const x = (i * 97 + 30) % 256;
      const y = (i * 61 + 15) % 256;
      c.beginPath();
      c.roundRect(x, y, 10, 3, 2);
      c.fill();
    }
  });
}

/** Vertical sky gradient for the dome: bright cyan down to pale horizon. */
export function skyTexture(): THREE.CanvasTexture {
  const tex = canvasTexture(4, 256, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#38b4e8');
    g.addColorStop(0.55, '#7cd4f2');
    g.addColorStop(0.78, '#b8ecfa');
    g.addColorStop(1, '#e8f8f2');
    c.fillStyle = g;
    c.fillRect(0, 0, 4, 256);
  });
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}
