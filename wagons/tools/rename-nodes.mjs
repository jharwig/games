#!/usr/bin/env node
/**
 * rename-nodes.mjs — rename nodes inside a .glb in place.
 *
 *   node tools/rename-nodes.mjs <file.glb> lever cylinder hammer
 *   node tools/rename-nodes.mjs <file.glb> --list
 *
 * For each target name given, finds the node whose existing name best matches
 * (case-insensitive substring, shortest match wins) and renames it to exactly
 * the target. Node *names* are cosmetic in glTF — skins, animation channels
 * and the scene graph all reference nodes by index — so this is safe to do
 * after compression.
 *
 * Deliberately dependency-free: it patches the GLB's JSON chunk directly, so
 * it works on a meshopt-compressed file without needing a decoder, and it
 * doesn't require adding anything to the game's package.json.
 */

import { readFileSync, writeFileSync } from "node:fs";

const [, , file, ...targets] = process.argv;
if (!file) {
  console.error("usage: rename-nodes.mjs <file.glb> [--list] [name...]");
  process.exit(1);
}

const buf = readFileSync(file);
if (buf.readUInt32LE(0) !== 0x46546c67) {
  console.error(`${file}: not a GLB (bad magic)`);
  process.exit(1);
}

// GLB: 12-byte header, then chunks of [length u32][type u32][data].
const chunks = [];
let off = 12;
while (off + 8 <= buf.length) {
  const len = buf.readUInt32LE(off);
  const type = buf.readUInt32LE(off + 4);
  chunks.push({ type, start: off + 8, len });
  off += 8 + len;
}
const jsonChunk = chunks.find((c) => c.type === 0x4e4f534a);
if (!jsonChunk) {
  console.error(`${file}: no JSON chunk`);
  process.exit(1);
}
const json = JSON.parse(
  buf.subarray(jsonChunk.start, jsonChunk.start + jsonChunk.len).toString("utf8"),
);
const nodes = json.nodes || [];

console.log(`  nodes in ${file}:`);
for (const [i, n] of nodes.entries()) {
  const bits = [];
  if (n.mesh !== undefined) bits.push(`mesh=${n.mesh}`);
  if (n.skin !== undefined) bits.push(`skin=${n.skin}`);
  if (n.children) bits.push(`children=${n.children.length}`);
  console.log(`    [${i}] ${n.name ?? "<unnamed>"}${bits.length ? "  (" + bits.join(", ") + ")" : ""}`);
}

const wanted = targets.filter((t) => t !== "--list");
if (wanted.length === 0) process.exit(0);

let changed = 0;
const claimed = new Set();
for (const target of wanted) {
  if (nodes.some((n) => n.name === target)) {
    console.log(`  = node '${target}' already named correctly`);
    continue;
  }
  let best = -1;
  for (const [i, n] of nodes.entries()) {
    if (claimed.has(i) || !n.name) continue;
    if (!n.name.toLowerCase().includes(target.toLowerCase())) continue;
    if (best === -1 || n.name.length < nodes[best].name.length) best = i;
  }
  if (best === -1) {
    console.log(`  ! no node matches '${target}' — not separable in this model`);
    continue;
  }
  console.log(`  → renaming [${best}] '${nodes[best].name}' to '${target}'`);
  nodes[best].name = target;
  claimed.add(best);
  changed++;
}

if (changed === 0) process.exit(0);

// Re-serialize: JSON chunk padded with spaces to 4 bytes, BIN chunk untouched.
const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
const jsonOut = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]);

const parts = [Buffer.alloc(12)];
const chunkBufs = [];
for (const c of chunks) {
  const head = Buffer.alloc(8);
  if (c === jsonChunk) {
    head.writeUInt32LE(jsonOut.length, 0);
    head.writeUInt32LE(c.type, 4);
    chunkBufs.push(head, jsonOut);
  } else {
    head.writeUInt32LE(c.len, 0);
    head.writeUInt32LE(c.type, 4);
    chunkBufs.push(head, buf.subarray(c.start, c.start + c.len));
  }
}
const body = Buffer.concat(chunkBufs);
parts[0].writeUInt32LE(0x46546c67, 0);
parts[0].writeUInt32LE(2, 4);
parts[0].writeUInt32LE(12 + body.length, 8);
writeFileSync(file, Buffer.concat([parts[0], body]));
console.log(`  ✓ renamed ${changed} node(s) in ${file}`);
