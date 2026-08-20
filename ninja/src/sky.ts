// =============================================================================
// sky, sun disc, clouds, distant hot air balloons
// =============================================================================
import * as THREE from "three";
import { PALETTE, SKY_BOT, SKY_TOP } from "./constants";
import { GEO, box, camera, mat, scene, shade, tube } from "./gfx";
import { isTower, pathPos, tmpV } from "./path";
import { rand } from "./util";

const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  fog: false,
  uniforms: {
    topCol: { value: new THREE.Color(SKY_TOP) },
    midCol: { value: new THREE.Color(0x7fc8f0) },
    botCol: { value: new THREE.Color(SKY_BOT) },
    sunDir: { value: new THREE.Vector3(-0.42, 0.62, 0.66).normalize() }
  },
  vertexShader: [
    "varying vec3 vDir;",
    "void main() {",
    "  vDir = normalize(position);",
    "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
    "}"
  ].join("\n"),
  fragmentShader: [
    "uniform vec3 topCol;",
    "uniform vec3 midCol;",
    "uniform vec3 botCol;",
    "uniform vec3 sunDir;",
    "varying vec3 vDir;",
    "void main() {",
    "  vec3 d = normalize(vDir);",
    "  float h = clamp(d.y * 0.6 + 0.42, 0.0, 1.0);",
    "  h = pow(h, 0.85);",
    "  vec3 col = mix(midCol, topCol, smoothstep(0.4, 1.0, h));",
    "  col = mix(botCol, col, smoothstep(0.0, 0.5, h));",
    "  float s = pow(clamp(dot(d, sunDir), 0.0, 1.0), 6.0);",
    "  col += vec3(1.0, 0.82, 0.5) * s * 0.3;",
    "  gl_FragColor = vec4(col, 1.0);",
    "  #include <colorspace_fragment>",
    "}"
  ].join("\n")
});
const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(600, 20, 14), skyMat);
skyMesh.frustumCulled = false;
skyMesh.renderOrder = -1000;
scene.add(skyMesh);

// a friendly sun disc, parented to the sky so it always sits far away
const sunDisc = new THREE.Mesh(GEO.sph, new THREE.MeshBasicMaterial({ color: 0xfff4b0, fog: false }));
sunDisc.scale.setScalar(26);
sunDisc.frustumCulled = false;
sunDisc.renderOrder = -999;
scene.add(sunDisc);
const sunGlow = new THREE.Mesh(GEO.sph, new THREE.MeshBasicMaterial({
  color: 0xfff0a0, fog: false, transparent: true, opacity: 0.26, depthWrite: false
}));
sunGlow.scale.setScalar(46);
sunGlow.frustumCulled = false;
sunGlow.renderOrder = -998;
scene.add(sunGlow);
const SUN_DIR = new THREE.Vector3(-0.42, 0.62, 0.66).normalize();

// the sky dome and the sun ride along with the camera
export function updateSky(): void {
  skyMesh.position.copy(camera.position);
  sunDisc.position.copy(camera.position).addScaledVector(SUN_DIR, 420);
  sunGlow.position.copy(sunDisc.position);
}

// clouds: one InstancedMesh of puffs, recycled as the player advances
const CLOUD_N = 46, PUFFS = 4;
const cloudMesh = new THREE.InstancedMesh(GEO.ico, new THREE.MeshLambertMaterial({ color: 0xffffff }), CLOUD_N * PUFFS);
cloudMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
cloudMesh.frustumCulled = false;
scene.add(cloudMesh);
const cloudZ = new Float32Array(CLOUD_N);
const cloudObj = new THREE.Object3D();
const CLOUD_SPAN = 260;

// playerY: heights follow the player, so a climbing tower course keeps its clouds
function placeCloud(i: number, z: number, playerY: number): void {
  cloudZ[i] = z;
  const below = Math.random() < 0.55;
  const cy = playerY + (below ? rand(-34, -11) : rand(11, 34));
  // on the tower every cloud sits outside the coil, leaving the middle clear
  const cx = (isTower() || Math.random() < 0.5 ? -1 : 1) * rand(14, 78);
  const s = rand(2.4, 5.6);
  pathPos(z, cx, cy, tmpV);
  for (let p = 0; p < PUFFS; p++) {
    cloudObj.position.set(
      tmpV.x + rand(-s * 1.15, s * 1.15),
      tmpV.y + rand(-s * 0.24, s * 0.24),
      tmpV.z + rand(-s * 0.9, s * 0.9)
    );
    cloudObj.rotation.set(rand(0, 3.14), rand(0, 3.14), rand(0, 3.14));
    cloudObj.scale.setScalar(s * rand(0.6, 1.05));
    cloudObj.updateMatrix();
    cloudMesh.setMatrixAt(i * PUFFS + p, cloudObj.matrix);
  }
}
export function initClouds(centerZ: number, playerY: number): void {
  for (let i = 0; i < CLOUD_N; i++) placeCloud(i, centerZ + rand(-CLOUD_SPAN * 0.4, CLOUD_SPAN * 0.6), playerY);
  cloudMesh.instanceMatrix.needsUpdate = true;
}
export function updateClouds(z: number, playerY: number): void {
  let dirty = false;
  for (let i = 0; i < CLOUD_N; i++) {
    if (cloudZ[i] < z - CLOUD_SPAN * 0.35) { placeCloud(i, cloudZ[i] + CLOUD_SPAN, playerY); dirty = true; }
    else if (cloudZ[i] > z + CLOUD_SPAN * 0.75) { placeCloud(i, cloudZ[i] - CLOUD_SPAN, playerY); dirty = true; }
  }
  if (dirty) cloudMesh.instanceMatrix.needsUpdate = true;
}

// distant hot air balloons give the sky some depth
interface Balloon { g: THREE.Group; z: number; x: number; y: number; phase: number }
const balloons: Balloon[] = [];
(function initBalloonMeshes() {
  for (let bi = 0; bi < 6; bi++) {
    const bg = new THREE.Group();
    const hex = PALETTE[(bi * 3 + 1) % PALETTE.length];
    const env = new THREE.Mesh(GEO.sph, mat(hex));
    env.scale.set(1.6, 1.85, 1.6);
    bg.add(env);
    const band = new THREE.Mesh(GEO.sph, mat(shade(hex, 0.6)));
    band.scale.set(1.62, 0.5, 1.62);
    band.position.y = -0.72;
    bg.add(band);
    box(bg, 0, -2.6, 0, 0.75, 0.6, 0.75, 0x9a6a3a);
    tube(bg, -0.45, -1.95, 0, 0.035, 1.0, 0x6b4a28);
    tube(bg,  0.45, -1.95, 0, 0.035, 1.0, 0x6b4a28);
    bg.traverse(function (o) { if ((o as THREE.Mesh).isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    scene.add(bg);
    balloons.push({ g: bg, z: -9999, x: 0, y: 0, phase: rand(0, 6.28) });
  }
})();

function placeBalloon(b: Balloon, z: number, playerY: number): void {
  b.z = z;
  b.x = (isTower() || Math.random() < 0.5 ? -1 : 1) * rand(18, 55);
  b.y = playerY + rand(-6, 20);
  b.g.scale.setScalar(rand(0.9, 1.7));
}
export function initBalloons(centerZ: number, playerY: number): void {
  for (let i = 0; i < balloons.length; i++) placeBalloon(balloons[i], centerZ + rand(-30, 190), playerY);
}
export function updateBalloons(now: number, z: number, playerY: number): void {
  for (let i = 0; i < balloons.length; i++) {
    const b = balloons[i];
    if (b.z < z - 60) placeBalloon(b, z + rand(120, 220), playerY);
    pathPos(b.z, b.x, b.y + Math.sin(now * 0.0005 + b.phase) * 1.2, b.g.position);
  }
}
