# Nitro Racing — dev notes

Third-person 3D arcade time-trial racer, cel-shaded cartoon look. TypeScript +
Three.js + Vite. Designed by Alex — see `CONTEXT.md` for the vocabulary and the
root `README.md` for the player-facing rules. Deploys with the repo's GitHub
Pages workflow (pnpm build, `dist/` published under `/nitro/`).

## Commands

- `pnpm dev` — Vite dev server on :5178
- `pnpm build` — `tsc --noEmit` then Vite build
- `pnpm typecheck`
- Style preview (dev only, never built): http://localhost:5178/mockup.html —
  `mockup.html` + `src/mockup.ts` drive each car around each track with the
  chase camera, a shading toggle and sample coins/obstacles/pads. It is the
  one-time design reference the designer approved; do not turn it into
  gameplay and do not update it during normal work.

## Design decisions (agreed with the designer — ask before changing)

- One lap per race, solo against the clock, 3-2-1-GO countdown.
- Six tracks, all unlocked, menu order easiest→hardest: Speedway, Beach,
  Dirt Rally, Ice Lake, Volcano, Space. Each has its own road surface texture,
  scenery, sky dressing, music and ambience.
- Five cars: F1 Car (free), Frog 30, Ghost 60, Magnet 100, Tank 150 coins.
  Each drives differently and has one ability with **3 uses per race**.
- Coins: bronze 1 (common), silver 5, gold 10 (rare). Banked on touch.
- Off-road slows; Space fall / Volcano lava → back to last checkpoint.
- Best time per track + ghost of the best run. Cartoon (toon) shading.
- Controls: ←/→ steer, ↑ gas, ↓ slow, Space ability. Phone: tilt steering +
  gas and ability buttons.

## Architecture (src/)

- `types.ts` — the shared contract every module codes against (InputState,
  CarState, RaceEvents, GhostData, SaveData, Sfx, constants). Change it
  deliberately; everything imports from it.
- `main.ts` — renderer, state machine (menu / countdown / racing /
  finished), fixed loop, wiring of race ↔ hud ↔ audio ↔ particles ↔ save.
- `tracks.ts` — TRACKS definitions (control points, colours, grip/offRoad/
  fallOff) + `buildTrack` (closed Catmull-Rom, 900 samples with tangent /
  left-normal / distance, textured road ribbon, curbs, start line).
  `nearestSample` / `lateral` are the primitives for on-road tests,
  progress and checkpoints. Ribbon winding must stay counter-clockwise from
  above or the road is back-face culled (this bit us once).
- `roadsurface.ts` — canvas-painted per-theme road textures (tile = road
  width × 24 m along the road).
- `cars.ts` — CARS specs + procedural car models (`buildCar`: local -Z is
  forward, wheels at y=0) and `buildCoin`.
- `scenery.ts` — per-track sky, lights, ground, decorations, sky dressing
  (clouds, blimps, gulls, aurora, comets…), plus `buildObstacle` /
  `buildPad` models used on the road.
- `gfx.ts` — `mat()` builds toon or lambert materials from one flag
  (`setStyle`), primitive helpers, sky dome shader, star field.
- `car.ts` — arcade physics on CarState. `race.ts` — the Race class: builds
  the world, places coins/obstacles/pads/checkpoint gates (seeded, so a
  track's layout is identical every run), abilities, collisions,
  checkpoints, finish, ghost recording/playback, near-fade of props by the
  camera.
- `camera.ts` — chase camera (behind/above, FOV widens on boost, shake,
  orbit on finish). `particles.ts` — pooled dust/sparkle/flame/debris.
- `input.ts` — keyboard, touch buttons, tilt (iOS permission from a
  gesture). `hud.ts` / `menu.ts` — DOM only. `audio.ts` — all sound is
  synthesized with Web Audio (no files): engine, sfx, per-track music and
  ambience. `save.ts` — localStorage `nitro.save` (coins, unlocked, best
  times, ghosts, prefs).

## Gotchas

- Car heading convention: forward = (-sin h, 0, -cos h), right =
  (cos h, 0, -sin h); `rotation.y = heading`.
- Space track has y in its control points: read road height from the
  samples, never assume y = 0.
- Audio must be started from a user gesture (`initAudio`).
