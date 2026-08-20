// =============================================================================
// confetti for the podium, dust puffs for jumps, landings and footsteps
// =============================================================================
import * as THREE from "three";
import { PALETTE } from "./constants";
import { GEO, scene } from "./gfx";
import { pathPos, tmpV } from "./path";
import { rand } from "./util";

// ---------------- confetti ----------------
const CONF_N = 170;
const confMesh = new THREE.InstancedMesh(GEO.box, new THREE.MeshLambertMaterial({ color: 0xffffff }), CONF_N);
confMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
confMesh.frustumCulled = false;
scene.add(confMesh);
const confP = new Float32Array(CONF_N * 3);
const confV = new Float32Array(CONF_N * 3);
const confR = new Float32Array(CONF_N * 3);
const confW = new Float32Array(CONF_N * 3);
const confLife = new Float32Array(CONF_N);
const confObj = new THREE.Object3D();
let confActive = false;

(function initConfetti() {
  const c = new THREE.Color();
  for (let i = 0; i < CONF_N; i++) {
    c.setHex(PALETTE[i % PALETTE.length]);
    confMesh.setColorAt(i, c);
    confObj.position.set(0, -9999, 0);
    confObj.scale.setScalar(0.001);
    confObj.updateMatrix();
    confMesh.setMatrixAt(i, confObj.matrix);
  }
  if (confMesh.instanceColor) confMesh.instanceColor.needsUpdate = true;
  confMesh.instanceMatrix.needsUpdate = true;
})();

// x is sideways on the course, z the distance along it
export function burstConfetti(x: number, y: number, z: number): void {
  pathPos(z, x, y, tmpV);
  for (let i = 0; i < CONF_N; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = rand(2.5, 9.5);
    confP[i * 3] = tmpV.x + rand(-1.2, 1.2);
    confP[i * 3 + 1] = tmpV.y + rand(0, 1.2);
    confP[i * 3 + 2] = tmpV.z + rand(-1.2, 1.2);
    confV[i * 3] = Math.cos(a) * sp * 0.55;
    confV[i * 3 + 1] = rand(6, 13);
    confV[i * 3 + 2] = Math.sin(a) * sp * 0.55;
    confR[i * 3] = rand(0, 6.28); confR[i * 3 + 1] = rand(0, 6.28); confR[i * 3 + 2] = rand(0, 6.28);
    confW[i * 3] = rand(-9, 9); confW[i * 3 + 1] = rand(-9, 9); confW[i * 3 + 2] = rand(-9, 9);
    confLife[i] = rand(2.2, 3.6);
  }
  confActive = true;
}

export function updateConfetti(dt: number): void {
  if (!confActive) return;
  let any = false;
  for (let i = 0; i < CONF_N; i++) {
    if (confLife[i] <= 0) {
      confObj.position.set(0, -9999, 0);
      confObj.scale.setScalar(0.001);
      confObj.updateMatrix();
      confMesh.setMatrixAt(i, confObj.matrix);
      continue;
    }
    any = true;
    confLife[i] -= dt;
    confV[i * 3 + 1] -= 13 * dt;
    confV[i * 3] *= 0.985;
    confV[i * 3 + 2] *= 0.985;
    confP[i * 3] += confV[i * 3] * dt;
    confP[i * 3 + 1] += confV[i * 3 + 1] * dt;
    confP[i * 3 + 2] += confV[i * 3 + 2] * dt;
    confR[i * 3] += confW[i * 3] * dt;
    confR[i * 3 + 1] += confW[i * 3 + 1] * dt;
    confR[i * 3 + 2] += confW[i * 3 + 2] * dt;
    confObj.position.set(confP[i * 3], confP[i * 3 + 1], confP[i * 3 + 2]);
    confObj.rotation.set(confR[i * 3], confR[i * 3 + 1], confR[i * 3 + 2]);
    confObj.scale.set(0.24, 0.24, 0.06);
    confObj.updateMatrix();
    confMesh.setMatrixAt(i, confObj.matrix);
  }
  confMesh.instanceMatrix.needsUpdate = true;
  if (!any) confActive = false;
}

// ---------------- dust ----------------
const DUST_N = 64;
const dustMesh = new THREE.InstancedMesh(GEO.sph, new THREE.MeshLambertMaterial({ color: 0xf4fbff }), DUST_N);
dustMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
dustMesh.frustumCulled = false;
scene.add(dustMesh);
const dustP = new Float32Array(DUST_N * 3);
const dustV = new Float32Array(DUST_N * 3);
const dustLife = new Float32Array(DUST_N);
const dustMax = new Float32Array(DUST_N);
const dustS = new Float32Array(DUST_N);
const dustObj = new THREE.Object3D();
let dustHead = 0, dustActive = false;

(function initDust() {
  for (let i = 0; i < DUST_N; i++) {
    dustObj.position.set(0, -9999, 0);
    dustObj.scale.setScalar(0.001);
    dustObj.updateMatrix();
    dustMesh.setMatrixAt(i, dustObj.matrix);
  }
  dustMesh.instanceMatrix.needsUpdate = true;
})();

// x is sideways on the course, z the distance along it
export function puff(x: number, y: number, z: number, n: number, spread: number, up: number): void {
  pathPos(z, x, y, tmpV);
  for (let k = 0; k < n; k++) {
    const i = dustHead++ % DUST_N;
    const a = Math.random() * Math.PI * 2;
    dustP[i * 3] = tmpV.x + Math.cos(a) * rand(0, spread);
    dustP[i * 3 + 1] = tmpV.y + rand(0, 0.15);
    dustP[i * 3 + 2] = tmpV.z + Math.sin(a) * rand(0, spread);
    dustV[i * 3] = Math.cos(a) * rand(0.4, 1.6);
    dustV[i * 3 + 1] = rand(0.4, up);
    dustV[i * 3 + 2] = Math.sin(a) * rand(0.4, 1.6) - 0.5;
    dustLife[i] = dustMax[i] = rand(0.28, 0.55);
    dustS[i] = rand(0.09, 0.2);
  }
  dustActive = true;
}

export function updateDust(dt: number): void {
  if (!dustActive) return;
  let any = false;
  for (let i = 0; i < DUST_N; i++) {
    if (dustLife[i] <= 0) continue;
    dustLife[i] -= dt;
    if (dustLife[i] <= 0) {
      dustObj.position.set(0, -9999, 0);
      dustObj.scale.setScalar(0.001);
      dustObj.updateMatrix();
      dustMesh.setMatrixAt(i, dustObj.matrix);
      continue;
    }
    any = true;
    dustP[i * 3] += dustV[i * 3] * dt;
    dustP[i * 3 + 1] += dustV[i * 3 + 1] * dt;
    dustP[i * 3 + 2] += dustV[i * 3 + 2] * dt;
    const k = dustLife[i] / dustMax[i];
    dustObj.position.set(dustP[i * 3], dustP[i * 3 + 1], dustP[i * 3 + 2]);
    dustObj.scale.setScalar(dustS[i] * (k * (1 - k) * 4 + 0.15));
    dustObj.updateMatrix();
    dustMesh.setMatrixAt(i, dustObj.matrix);
  }
  dustMesh.instanceMatrix.needsUpdate = true;
  if (!any) dustActive = false;
}
