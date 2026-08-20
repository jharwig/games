// Renderer, scene, camera rig, lights, ground and the procedural sky that
// stands in when the HDRI is missing.
import * as THREE from 'three';
import { EYE_HEIGHT, GROUND_SIZE, PALETTE, RING_RADIUS } from './constants';
import { rand } from './util';

export const canvas = document.getElementById('c') as HTMLCanvasElement;
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

export const scene = new THREE.Scene();
scene.fog = new THREE.Fog(PALETTE.fog, 120, 420);

// Camera rig: yaw (around Y) -> pitch (around X) -> camera. The player never
// moves, so the rig sits at the origin at eye height.
export const camera = new THREE.PerspectiveCamera(62, 1, 0.05, 1200);
export const pitchObj = new THREE.Object3D();
export const yawObj = new THREE.Object3D();
yawObj.position.set(0, EYE_HEIGHT, 0);
pitchObj.add(camera);
yawObj.add(pitchObj);
scene.add(yawObj);

// ---- light ----
// Low golden-hour sun. Azimuth is tuned to roughly match the Plains Sunset
// HDRI so baked sky light and cast shadows agree.
export const SUN_AZIMUTH = -0.6;   // radians around Y
export const SUN_ELEVATION = 0.2;  // radians above horizon
export const sunDir = new THREE.Vector3(
  Math.cos(SUN_ELEVATION) * Math.sin(SUN_AZIMUTH), Math.sin(SUN_ELEVATION), Math.cos(SUN_ELEVATION) * Math.cos(SUN_AZIMUTH),
).normalize();
export const sun = new THREE.DirectionalLight(PALETTE.sun, 3.2);
sun.position.copy(sunDir).multiplyScalar(80);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 10; sun.shadow.camera.far = 200;
const S = 34; sun.shadow.camera.left = -S; sun.shadow.camera.right = S; sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
export const hemi = new THREE.HemisphereLight(0xdcc7ff, 0x7a5a35, 0.9);
scene.add(hemi);

// ---- ground ----
function groundCanvasTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = '#b08a4c'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) {
    const v = rand(-1, 1);
    g.fillStyle = `rgba(${v > 0 ? 210 : 90},${v > 0 ? 170 : 70},${v > 0 ? 95 : 35},${Math.abs(v) * 0.35})`;
    const x = rand(0, 512), y = rand(0, 512);
    g.fillRect(x, y, rand(1, 3), rand(2, 9));
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
export const groundMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
{
  const t = groundCanvasTexture(); t.repeat.set(80, 80); groundMat.map = t;
}
export const ground = new THREE.Mesh(new THREE.CircleGeometry(GROUND_SIZE, 96), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// Worn dirt inside the Ring, fading to grass at its edge.
export const dirtMat = new THREE.MeshStandardMaterial({ color: 0xa07a48, roughness: 1, transparent: true, depthWrite: false });
{
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(128, 128, 40, 128, 128, 128);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.75, 'rgba(255,255,255,0.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  dirtMat.alphaMap = new THREE.CanvasTexture(c);
}
export const dirt = new THREE.Mesh(new THREE.CircleGeometry(RING_RADIUS + 3, 48), dirtMat);
dirt.rotation.x = -Math.PI / 2; dirt.position.y = 0.02; dirt.receiveShadow = true; dirt.renderOrder = -1;
scene.add(dirt);

/** Real PBR ground textures from media/, when present. */
export function setGroundTextures(grass: { diff: THREE.Texture | null; nor: THREE.Texture | null; rough: THREE.Texture | null },
  dirtTex: { diff: THREE.Texture | null; nor: THREE.Texture | null; rough: THREE.Texture | null }) {
  if (grass.diff) {
    groundMat.map = grass.diff; grass.diff.repeat.set(120, 120);
    if (grass.nor) { groundMat.normalMap = grass.nor; grass.nor.repeat.set(120, 120); groundMat.normalScale.set(0.6, 0.6); }
    if (grass.rough) { groundMat.roughnessMap = grass.rough; grass.rough.repeat.set(120, 120); }
    groundMat.needsUpdate = true;
  }
  if (dirtTex.diff) {
    dirtMat.map = dirtTex.diff; dirtTex.diff.repeat.set(6, 6); dirtMat.color.set(0xffffff);
    if (dirtTex.nor) { dirtMat.normalMap = dirtTex.nor; dirtTex.nor.repeat.set(6, 6); }
    if (dirtTex.rough) { dirtMat.roughnessMap = dirtTex.rough; dirtTex.rough.repeat.set(6, 6); }
    dirtMat.needsUpdate = true;
  }
}

// ---- procedural sky (fallback when no HDRI) ----
export const skyGroup = new THREE.Group();
{
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top: { value: new THREE.Color(PALETTE.skyTop) }, horizon: { value: new THREE.Color(PALETTE.skyHorizon) },
      sunDir: { value: sunDir.clone() }, sunCol: { value: new THREE.Color(0xfff0c8) },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 top, horizon, sunDir, sunCol; varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 c = mix(horizon, top, pow(h, 0.55));
        float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);
        c += sunCol * (pow(s, 400.0) * 2.5 + pow(s, 12.0) * 0.35 + pow(s, 3.0) * 0.12);
        if (vDir.y < 0.0) c = mix(horizon, vec3(0.45,0.33,0.2), clamp(-vDir.y*6.0,0.0,1.0));
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), skyMat);
  skyGroup.add(dome);

  // distant mountains on one side of the world, plains on the other
  const ridge = (radius: number, y0: number, amp: number, color: number, from: number, to: number, seed: number) => {
    const segs = 140; const pos: number[] = []; const idx: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs; const a = from + (to - from) * t;
      const env = Math.sin(t * Math.PI);
      const n = Math.sin(a * 7 + seed) * 0.5 + Math.sin(a * 19 + seed * 2.3) * 0.3 + Math.sin(a * 41 + seed * 5.1) * 0.2;
      const h = y0 + amp * env * (0.55 + 0.45 * n);
      pos.push(Math.cos(a) * radius, -20, Math.sin(a) * radius, Math.cos(a) * radius, h, Math.sin(a) * radius);
      if (i < segs) { const b = i * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, fog: false, side: THREE.DoubleSide }));
  };
  skyGroup.add(ridge(900, 0, 160, 0x8a6f8a, 1.6, 4.9, 1.0));
  skyGroup.add(ridge(760, 0, 110, 0x6f5a70, 1.9, 4.4, 3.7));
  skyGroup.add(ridge(620, 0, 60, 0x5a4a55, 2.2, 4.1, 7.9));
}
scene.add(skyGroup);

/** Use a real HDRI for background + image based lighting. */
export function applyEnvironment(hdr: THREE.DataTexture | null) {
  if (!hdr) return;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(hdr).texture;
  scene.environment = env;
  scene.background = hdr;
  scene.backgroundIntensity = 1.0;
  scene.environmentIntensity = 1.0;
  skyGroup.visible = false;
  hemi.intensity = 0.25; // IBL carries the ambient now
  sun.intensity = 2.6;
  pmrem.dispose();
}

export function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

export const yaw = { value: 0 };
export const pitch = { value: 0 };
export function applyLook() {
  yawObj.rotation.y = yaw.value;
  pitchObj.rotation.x = pitch.value;
}
/** unit forward vector of the camera in world space (XZ + Y) */
export const forward = new THREE.Vector3();
export function updateForward() { camera.getWorldDirection(forward); }
/** world position around the ring at angle a (0 = +X, counter-clockwise seen from above), y=0 */
export const ringPos = (a: number, r: number, out = new THREE.Vector3()) => out.set(Math.cos(a) * r, 0, -Math.sin(a) * r);
/** yaw value that looks toward ring angle a */
export const yawToward = (a: number) => a - Math.PI / 2;
/** ring angle the camera yaw is facing */
export const yawAngle = (y: number) => y + Math.PI / 2;
