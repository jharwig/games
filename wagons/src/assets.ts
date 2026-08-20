// Media manifest + loaders. Everything is optional: when a file is missing
// from public/media/manifest.json the game falls back to procedural
// placeholders, so the game runs with no downloads at all.
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const BASE = import.meta.env.BASE_URL.replace(/\/?$/, '/') + 'media/';
let files = new Set<string>();

export const media = {
  get files() { return [...files]; },
  has: (p: string) => files.has(p),
  url: (p: string) => BASE + p,
  base: BASE,
};

export async function loadManifest(): Promise<void> {
  try {
    const r = await fetch(BASE + 'manifest.json', { cache: 'no-cache' });
    if (!r.ok) return;
    const j = await r.json();
    if (Array.isArray(j.files)) files = new Set(j.files as string[]);
  } catch { /* no media: placeholders everywhere */ }
}

const gltfLoader = new GLTFLoader();
gltfLoader.setMeshoptDecoder(MeshoptDecoder);
const texLoader = new THREE.TextureLoader();
const hdrLoader = new RGBELoader();

/** Load a GLB from media/, or null when absent / broken. */
export async function loadModel(path: string): Promise<GLTF | null> {
  if (!files.has(path)) return null;
  try {
    return await gltfLoader.loadAsync(BASE + path);
  } catch (e) {
    console.warn('model failed, using placeholder:', path, e);
    return null;
  }
}

export async function loadTexture(path: string, srgb = false): Promise<THREE.Texture | null> {
  if (!files.has(path)) return null;
  try {
    const t = await texLoader.loadAsync(BASE + path);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  } catch { return null; }
}

export async function loadHDR(path: string): Promise<THREE.DataTexture | null> {
  if (!files.has(path)) return null;
  try {
    const t = await hdrLoader.loadAsync(BASE + path);
    t.mapping = THREE.EquirectangularReflectionMapping;
    return t;
  } catch { return null; }
}

/** Run N loaders, reporting progress 0..1 as each settles. */
export async function withProgress<T>(tasks: (() => Promise<T>)[], onProgress: (p: number) => void): Promise<T[]> {
  let done = 0;
  onProgress(0);
  return Promise.all(tasks.map(t => t().finally(() => onProgress(++done / tasks.length))));
}
