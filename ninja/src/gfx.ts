// =============================================================================
// renderer, scene, camera, lights + the shared geometry / material caches and
// the box / tube primitives everything is built from
// =============================================================================
import * as THREE from "three";
import { FOG_COL, TOWER_R } from "./constants";
import { pathChunks, pathPos, placeOnPath } from "./path";

export const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
document.body.appendChild(renderer.domElement);

export const scene = new THREE.Scene();
scene.fog = new THREE.Fog(FOG_COL, 55, 195);

export const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 900);
camera.position.set(0, 4, -8);

const hemi = new THREE.HemisphereLight(0xdff3ff, 0x6ba8d0, 1.2);
scene.add(hemi);

export const sun = new THREE.DirectionalLight(0xfff6dd, 1.55);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 60;
sun.shadow.camera.left = -14;
sun.shadow.camera.right = 14;
sun.shadow.camera.top = 16;
sun.shadow.camera.bottom = -16;
sun.shadow.bias = -0.0015;
sun.shadow.normalBias = 0.03;
scene.add(sun);
scene.add(sun.target);

// keep the shadow frustum tight around the player
export function updateSun(playerZ: number, playerY: number): void {
  pathPos(playerZ + 2, 0, playerY, sun.target.position);
  sun.position.set(sun.target.position.x - 12, playerY + 20, sun.target.position.z + 16);
  sun.target.updateMatrixWorld();
}

// -------- shared geometry + material caches --------
export const GEO = {
  box:  new THREE.BoxGeometry(1, 1, 1),
  cyl:  new THREE.CylinderGeometry(1, 1, 1, 10),
  ico:  new THREE.IcosahedronGeometry(1, 1),
  sph:  new THREE.SphereGeometry(1, 14, 10),
  oct:  new THREE.OctahedronGeometry(1, 0)
};

const matCache = new Map<number, THREE.MeshLambertMaterial>();
export function mat(hex: number): THREE.MeshLambertMaterial {
  let m = matCache.get(hex);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: hex });
    matCache.set(hex, m);
  }
  return m;
}

const tmpColor = new THREE.Color();
export function shade(hex: number, k: number): number {
  tmpColor.setHex(hex);
  tmpColor.multiplyScalar(k);
  return tmpColor.getHex();
}

export type Axis = "x" | "y" | "z";

// Parents flagged userData.path (a course group) take course coordinates:
// z is the distance along the course and x is sideways. Parts are placed on
// the path, and anything long along z is split into pieces that hug the arc.
export function box(parent: THREE.Object3D, x: number, y: number, z: number,
                    w: number, h: number, d: number, hex: number, shadowCast?: boolean): THREE.Mesh {
  const onPath = !!parent.userData.path;
  const n = onPath ? pathChunks(d) : 1;
  const len = d / n;
  // pieces overlap a touch so the outer edge of a wide slab never shows a wedge gap
  const ext = n > 1 ? len + (w / 2) * (len / TOWER_R) + 0.02 : d;
  let first: THREE.Mesh | null = null;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(GEO.box, mat(hex));
    if (onPath) placeOnPath(m, z - d / 2 + len * (i + 0.5), x, y);
    else m.position.set(x, y, z);
    m.scale.set(w, h, ext);
    m.receiveShadow = true;
    if (shadowCast) m.castShadow = true;
    parent.add(m);
    if (!first) first = m;
  }
  return first!;
}

// cylinder along Y by default; axis "x" or "z" rotates it
export function tube(parent: THREE.Object3D, x: number, y: number, z: number,
                     r: number, len: number, hex: number, axis?: Axis): THREE.Mesh {
  const onPath = !!parent.userData.path;
  const n = onPath && axis === "z" ? pathChunks(len) : 1;
  const seg = len / n;
  let first: THREE.Mesh | null = null;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(GEO.cyl, mat(hex));
    if (onPath) placeOnPath(m, axis === "z" ? z - len / 2 + seg * (i + 0.5) : z, x, y);
    else m.position.set(x, y, z);
    m.scale.set(r, n > 1 ? seg + 0.06 : len, r);
    // rotate about the mesh's own axes, so the yaw from the path is kept
    if (axis === "x") m.rotateZ(Math.PI / 2);
    else if (axis === "z") m.rotateX(Math.PI / 2);
    m.receiveShadow = true;
    parent.add(m);
    if (!first) first = m;
  }
  return first!;
}

// a straight tube from (z0, y0) to (z1, y1) on the course, split along the
// arc; used for the zipline wire
export function pathWire(parent: THREE.Object3D, z0: number, y0: number, z1: number, y1: number,
                         r: number, hex: number): void {
  const span = z1 - z0, drop = y0 - y1;
  const n = pathChunks(span);
  const tilt = Math.atan2(-span, drop);
  const segLen = Math.hypot(span, drop) / n;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const m = new THREE.Mesh(GEO.cyl, mat(hex));
    placeOnPath(m, z0 + span * t, 0, y0 - drop * t);
    m.scale.set(r, n > 1 ? segLen + 0.06 : segLen, r);
    m.rotateX(tilt);
    m.receiveShadow = true;
    parent.add(m);
  }
}

export function resizeRenderer(): void {
  let w = window.innerWidth, h = window.innerHeight;
  if (window.visualViewport) { w = window.visualViewport.width; h = window.visualViewport.height; }
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
