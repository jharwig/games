# REGATTA// — dev notes

Arcade sailing race game. TypeScript + Three.js + Vite. No test framework;
validation is done with headless sim harnesses + headless-Chrome screenshots.

## Commands

- `npm run dev` — Vite dev server (HMR) on :5173
- `npm run build` — `tsc --noEmit` then Vite build
- `npm run typecheck`
- Sim harnesses (no DOM needed) — bundle then run:
  `npx esbuild scripts/<name>.ts --bundle --format=esm --platform=node --outfile=/tmp/x.mjs && node /tmp/x.mjs`
  - `scripts/tune.ts` — polar table: equilibrium speed per boat per true-wind angle. Use after touching physics/specs.
  - `scripts/airace.ts` — full 4-boat AI race; asserts everyone finishes and prints lap times (~200s total is healthy).
  - `scripts/pose.ts` — per-2s trace of one AI mono + final rig/cloth world positions.
  - `scripts/capstats.ts` — whitecap emission stats (deep/crest fractions, clusters/s). Use after touching seabed.ts or the wave terms.

## Architecture (src/)

- `main.ts` — scene/renderer, game state machine (menu/countdown/racing/finished), fixed-timestep loop, collisions, camera, right-of-way hails, mark pointer. `?auto=1` puts the player on autopilot; `?race=1` skips the menu and starts immediately (headless screenshots). The countdown state is a live 15s pre-start (boats sail); OCS is judged at the gun via `course.startLineSide`.
- `boat.ts` — hull physics + rig. Force model: apparent wind gamma vs sheet
  gives angle of attack; flat-plate Cl/Cd; lift ⊥ apparent flow with sign
  disambiguated by the boom's leeward normal (this sign is easy to get wrong —
  validate with `tune.ts`, a negative speed at TWA 120 means it regressed).
  Boats own two `SailCloth` instances; cloth is world-space, parked in
  `boat.sailHolder` (added to scene separately from `boat.group`).
- `cloth.ts` — Verlet cloth, tapered grid (square-top sails). Wind uses
  normalized per-triangle normals × dynamic pressure; `windK ~1.6` is
  calibrated against gravity — if sails hang limp, this ratio broke.
- `specs.ts` — per-class tuning (sailPower/dragK dominate the polar).
- `course.ts` — two layouts (`wl`, `tri`) rebuilt via `setLayout`; gates
  (crossing detection via signed-side flip + segment test), islands,
  committee boat (IS the starboard end of the start line; flags animate via
  `updateFlags`), progress metric for standings. Gate normals auto-orient
  along the leg from the previous gate — note the start gate's normal points
  down the RUN (lap crossing); use `startDir`/`startLineSide` for anything
  start-related (spawns, OCS).
- CHIRALITY: three.js is Y-up right-handed, so a boat heading +Z has
  starboard = -X, and this camera puts -X on screen-right. Every left/right
  bug so far came from assuming the opposite; `windSide === -1` is starboard
  tack.
- `ai.ts` — aim at gate, no-go beat logic with tack hysteresis (loose at
  16m+ from mark, tight near it), irons recovery, island avoidance.
- `ribbons.ts` — flat additive ribbon pool (wind lines + wakes). Must stay
  `DoubleSide` (winding flips with travel direction) and sit ~0.7+ above
  y=0 or the animated water vertices clip through.
- `ai.ts` also exports `burdenedOf` (rules 10/11: who keeps clear) — used
  for AI ducking and the collision penalty in main.
- `water.ts` — the seabed (depth/sand/coral/caustics) is painted in the
  fragment shader; GLSL reserved words (`patch`!) fail silently as a black
  mesh — if the ocean ever renders as flat background color, read the
  console for shader compile errors first. The surface swell is one shared
  table (`WAVE_TERMS`/`waveHeight`) driving both the vertex shader and CPU
  effects — edit the table, not the GLSL.
- `seabed.ts` — CPU-authoritative depth field (0..1), uploaded to the water
  shader as a tiling DataTexture. Anything gameplay-side that needs "is this
  deep water?" must use `bedAt` — the old in-shader fract(sin()) fbm was
  removed for the bed because it can't be reproduced in JS (float32 GPU sin
  decorrelates the hash).
- `spray.ts` / `fish.ts` — bow-spray point pool and fish shadows.
- `whitecaps.ts` — foam bursts on wave crests over deep water (probes
  `waveHeight` + `bedAt` around the camera, skips island shelves).
- Convention: heading 0 = +Z, angles via `atan2(x, z)`; boat rotation order 'YZX' (yaw, heel, pitch).

## Gotchas

- Node can't run `src/` directly (`--experimental-strip-types` rejects
  parameter properties) — always go through esbuild as above.
- The camera is world-locked at a fixed yaw offset; HUD wind dial compensates
  via `screenYaw` — keep them in sync if `CAM_OFFSET` changes.
- Boats spawn pointing at gate 0 which is upwind: near-zero speed for the
  first seconds of a race is correct sailing, not a bug.
