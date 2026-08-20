# Ninja Adventure — dev notes

Third-person 3D obstacle-course runner designed by Gemma. TypeScript +
Three.js + Vite. Deploys with the repo's GitHub Pages workflow, which builds
this directory (pnpm) and publishes `dist/` under `/ninja/`. Gameplay is the
designer's: ask before changing game design.

## Commands

- `pnpm run dev` — Vite dev server on :5174
- `pnpm run build` — `tsc --noEmit` then Vite build
- `pnpm run typecheck`

## Architecture (src/)

Physics is 1-D: `player.z` is the distance along the course and `player.y`
the height. Only the presentation maps that to a world position (`pathPos` in
`path.ts`) — the straight course is the identity, the Tower course wraps the
same distance around a helix. Everything that builds scenery goes through
`pathPos` / `placeOnPath`, so both courses share one code path.

- `main.ts` — composition root and ALL game rules: state machine
  (TITLE/PLAYING/CELEBRATE/FALLING), world queries, grab/attach/release,
  run/level flow, medals + best, the fixed-step (120 Hz) update and the
  frame loop, boot + the title demo course.
- `constants.ts` — tuning constants, palette, `State`, `Medal`.
- `path.ts` — course mode (straight/tower, persisted), `pathPos`,
  `placeOnPath`, `pathChunks`, `bestKey`.
- `gfx.ts` — renderer, scene, camera, sun; shared `GEO` / `mat()` caches and
  the `box` / `tube` / `pathWire` primitives (path-aware: parents flagged
  `userData.path` take course coordinates and long parts are split to hug
  the arc).
- `course.ts` — course generation (platforms, gap/rail/swing/lache/climb/
  bounce/zip/wall builders, the warped-wall finale every level ends with,
  podium, bunting), the world lists (`platforms`, `grabs`, `blockers`), the
  near-camera fade (`updateNearFade` — the repo's reference implementation),
  disposal, and rig animation (ropes, pads, star). Wall rides and the warped
  wall are `Grab` kinds driven by z/y only (no lateral physics); the wall
  ride's wall is x-offset scenery, the warped wall a quarter-circle arc
  (`warpPos` / `warpSurfaceY` / `warpSurfaceZ`) topped by a vertical lip
  (`WARP_LIP`) up to the ledge. The jump from the top of the arc is a
  scripted `ledge` grab (`startLedge` / `updateLedge` in `main.ts`): leap
  up the lip, hands catch the edge (body hanging below it), pull-up onto
  the summit.
- `player.ts` — the `player` state object, `Grab` types, air tricks.
- `ninja.ts` — the character model, outfits (+ paper-doll picker buttons),
  pose system (run / air / hang / rail / climb / celebrate / idle), ponytail,
  blob shadow.
- `camera.ts` — chase camera (course coords), impact shake/dip, FOV.
- `input.ts` — keyboard + touch/mouse (left half runs, right half jumps),
  `input` flags, jump buffering.
- `sky.ts` — sky dome shader, sun disc, clouds, balloons (recycled as the
  player advances). `particles.ts` — confetti + dust.
- `audio.ts` — WebAudio chiptune loop + sfx. No assets.
- `ui.ts` — DOM lookups/updates for the markup in `index.html` (HUD,
  medals, tips, banner, title, mode buttons).

`localStorage` keys: `ninja.mode`, `ninja.best`, `ninja.best.tower`,
`ninja.outfit`, `ninja.muted`. URL flags: `?mode=tower`, `?auto` (self-play
demo).

## Testing flags

- `?test=warp` skips the title and builds a course that is just the run-up
  and the warped wall; `?test=<gap|rail|swing|lache|climb|bounce|zip|wall>`
  builds one of that rig then the finale.
- `?level=N` starts the run at level N (bigger walls, harder rigs).
- `?slow=0.2` runs the clock at a fifth speed, to watch an animation.
- In test mode `window.__ninja` exposes `{ player, pressJump, autoForward,
  setSlow }` so a headless harness (Playwright) can drive the run and read
  the state while grabbing frames.
