// Points-based particle pool: muzzle smoke, hoof dust, impact dust.
import * as THREE from 'three';
import { scene } from './gfx';
import { rand } from './util';

const MAX = 900;
const pos = new Float32Array(MAX * 3);
const size = new Float32Array(MAX);
const alpha = new Float32Array(MAX);
const tint = new Float32Array(MAX * 3);
const vel = new Float32Array(MAX * 3);
const life = new Float32Array(MAX);
const maxLife = new Float32Array(MAX);
const grow = new Float32Array(MAX);
const startAlpha = new Float32Array(MAX);
let head = 0;

function softTexture(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
geo.setAttribute('aTint', new THREE.BufferAttribute(tint, 3));
const mat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, fog: true,
  uniforms: { map: { value: softTexture() }, scaleH: { value: 800 }, fogColor: { value: new THREE.Color() }, fogNear: { value: 1 }, fogFar: { value: 1000 } },
  vertexShader: `
    attribute float aSize; attribute float aAlpha; attribute vec3 aTint;
    varying float vAlpha; varying vec3 vTint; uniform float scaleH;
    #include <fog_pars_vertex>
    void main(){
      vec4 mvPosition = modelViewMatrix * vec4(position,1.0);
      gl_PointSize = aSize * scaleH / -mvPosition.z;
      gl_Position = projectionMatrix * mvPosition; vAlpha = aAlpha; vTint = aTint;
      #include <fog_vertex>
    }`,
  fragmentShader: `
    uniform sampler2D map; varying float vAlpha; varying vec3 vTint;
    #include <fog_pars_fragment>
    void main(){
      vec4 t = texture2D(map, gl_PointCoord);
      gl_FragColor = vec4(vTint, t.a * vAlpha);
      #include <fog_fragment>
    }`,
});
const points = new THREE.Points(geo, mat);
points.frustumCulled = false;
points.renderOrder = 10;
scene.add(points);

function emit(p: THREE.Vector3, v: THREE.Vector3, s: number, a: number, l: number, g: number, col: THREE.Color) {
  const i = head; head = (head + 1) % MAX;
  pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
  vel[i * 3] = v.x; vel[i * 3 + 1] = v.y; vel[i * 3 + 2] = v.z;
  size[i] = s; alpha[i] = a; startAlpha[i] = a; life[i] = l; maxLife[i] = l; grow[i] = g;
  tint[i * 3] = col.r; tint[i * 3 + 1] = col.g; tint[i * 3 + 2] = col.b;
}

const tmpV = new THREE.Vector3();
const SMOKE = new THREE.Color(0.92, 0.9, 0.86);
const DUST = new THREE.Color(0.78, 0.62, 0.4);
const FLASH = new THREE.Color(1.0, 0.8, 0.4);

/** Muzzle smoke: a burst drifting along dir, then up. */
export function muzzleSmoke(p: THREE.Vector3, dir: THREE.Vector3, amount = 14) {
  for (let i = 0; i < amount; i++) {
    tmpV.copy(dir).multiplyScalar(rand(1.5, 4.5)).add(new THREE.Vector3(rand(-0.6, 0.6), rand(0.3, 1.2), rand(-0.6, 0.6)));
    emit(p, tmpV, rand(0.12, 0.3), rand(0.35, 0.6), rand(0.8, 1.8), rand(0.6, 1.4), SMOKE);
  }
  tmpV.copy(dir).multiplyScalar(2);
  emit(p, tmpV, 0.45, 0.9, 0.06, 4, FLASH);
}
/** Small dust puff (hooves, impacts). */
export function dust(p: THREE.Vector3, amount = 3, speed = 1) {
  for (let i = 0; i < amount; i++) {
    tmpV.set(rand(-1, 1), rand(0.4, 1.6), rand(-1, 1)).multiplyScalar(speed);
    emit(p, tmpV, rand(0.25, 0.5), rand(0.25, 0.45), rand(0.8, 1.6), rand(0.8, 1.6), DUST);
  }
}
/** Impact puff on a rider (hit) */
export function hitPuff(p: THREE.Vector3) {
  for (let i = 0; i < 8; i++) {
    tmpV.set(rand(-1, 1), rand(-0.3, 1.4), rand(-1, 1)).multiplyScalar(1.5);
    emit(p, tmpV, rand(0.15, 0.35), 0.6, rand(0.4, 0.8), 1.5, DUST);
  }
}

export function updateParticles(dt: number, fog: THREE.Fog | null) {
  for (let i = 0; i < MAX; i++) {
    if (life[i] <= 0) continue;
    life[i] -= dt;
    if (life[i] <= 0) { alpha[i] = 0; continue; }
    const k = life[i] / maxLife[i];
    pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
    vel[i * 3] *= 0.96; vel[i * 3 + 1] = vel[i * 3 + 1] * 0.97 + 0.3 * dt; vel[i * 3 + 2] *= 0.96;
    size[i] += grow[i] * dt;
    alpha[i] = startAlpha[i] * Math.min(1, k * 3);
  }
  geo.attributes.position.needsUpdate = true;
  geo.attributes.aSize.needsUpdate = true;
  geo.attributes.aAlpha.needsUpdate = true;
  geo.attributes.aTint.needsUpdate = true;
  mat.uniforms.scaleH.value = window.innerHeight * 0.9;
  if (fog) { mat.uniforms.fogColor.value.copy(fog.color); mat.uniforms.fogNear.value = fog.near; mat.uniforms.fogFar.value = fog.far; }
}
