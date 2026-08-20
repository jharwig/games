# Bee Draw — dev notes

Draw-one-line defense game, designed by Priella. TypeScript + Vite, no
dependencies beyond the toolchain — all art is procedural canvas, all audio is
synthesized Web Audio. Deploys with the repo's GitHub Pages workflow, which
builds this directory (pnpm) and publishes `dist/` under `/beedraw/` — see the
root `CLAUDE.md`.

## Commands

- `pnpm run dev` — Vite dev server (HMR) on :5175
- `pnpm run build` — `tsc --noEmit` then Vite build
- `pnpm run typecheck`

## Architecture (src/)

- `main.ts` — canvas scaling, game state machine (`TITLE`/`LEVELS`/`PLAY`,
  play sub-phases `draw → attack → winseq/loseseq → win/lose`), the ink-stroke
  input model (`validInk`/`clampToValid`/`addInkPoint`, plus `slidePoint` so
  the tip follows obstacle edges and `tryErase` so retracing the line refunds
  ink), the rope (`buildRope` classifies each segment braced/loose and groups
  loose runs into `Span`s; `updateSpans` runs the lift clock; `rasterInk`
  leaves lifted spans open), bee simulation (flow-field steering toward the
  animal, or toward the nearest liftable span via the shared multi-source
  field `flowL`; grid collision), a device-resolution background cache of the
  meadow + solids, HUD/overlays, rAF loop, input.
- `level.ts` — level generation (`genLevel`/`tryGen`: a fresh layout every
  call, the numbers come from the level) and the solvability guard
  (`ringSealCost`/`sealedFor`), plus the geometry tests
  (`pointInSolid`/`pointInPond`/`inField`), `Solid` kinds (rock, mountain,
  tree, log, honey — all block bees and pen; ponds block only the pen) and
  gap helpers.
- `grid.ts` — pathfinding primitives shared by the game and the guard:
  BFS `distField` / multi-source `distFieldMulti` on the 64×40 grid (12px
  cells), no corner cutting.
- `art.ts` — smooth-canvas gameplay art: five `BIOMES` (palette only — shapes
  and rules never change), meadow, fence, solids, ponds, the ink stroke and
  the fallen rope (`RopeView`: braced stretches get stitch marks, loose ones a
  shadow, lifted ones rise), bee (tinted by speed), the five animals.
- `screens.ts` — pixel-art title/level-select, drawn at 256×160 and blitted 3×.
- `audio.ts` — Web Audio: 16-step music sequencer, bee buzz loop, sfx.
- `const.ts`, `util.ts` — constants/palette; clamp/lerp, localStorage,
  `mulberry32` seeded PRNG.

## The rope (design, per Priella)

- Level 1 is the only easy level (old rules: the line is a wall). From
  `LIFT_FROM_LEVEL` (2) the line falls onto the meadow when the finger lifts
  and becomes a rope. A segment is **braced** only if it actually runs along
  the pen edge of something solid or the fence (`bracedAt`: pen pad +
  `BRACE_TOL`); everything else is **loose**. A loose run shorter than
  `LIFT_MIN_SPAN` has no room for a bee and counts as braced.
- Bees that are sealed off head for the nearest liftable span (by path) and
  press on it: `LIFT_TIME` seconds for one bee, N bees divide it (capped at
  `LIFT_STACK_MAX`). A lifted span stays up while any bee is within `PUSH_R`
  and drops `LIFT_DROP` s after the last one leaves. The rope's shape never
  changes; the attack phase is hands-off for the player.
- Difficulty comes from the layout (obstacle *count* grows with the level,
  sizes never do), not from bee numbers or starved ink. Every bee rolls a
  speed in `[BEE_SPD_MIN, BEE_SPD_MAX]`. Ink = verified seal × margin × 1.25;
  the old "no full circle" cap is gone — a circle is loose everywhere.
- Honey pots are plain obstacles now; bees are not attracted to anything but
  the animal.
- All the dials live at the top of `const.ts`.

## Gotchas

- Every attempt at level N rolls a fresh layout *and* a fresh biome; only the
  numbers (obstacle counts, bees, timer, ink margin) derive from N. Nothing
  may depend on level N looking the same twice.
- The generator never guesses: it verifies with the same grid the bees walk
  (`gridFor` must stay in sync with `buildStatic` in main.ts) and rejects
  layouts whose cheapest verified seal can't be drawn. It guarantees a seal
  exists, not a fully braced one — at these timers an unbraced seal does not
  survive the first lift, so bracing is how you win from level 2.
- `corridorOK`/`solidFits` keep the pen honest: solids either merge (into
  each other, or into the fence) or leave at least `PEN_ROOM` of drawing room
  — never a slit the bees fit through and the pen does not.
- UI is immediate-mode: `uiButtons` is rebuilt every frame during draw and
  hit-tested on pointerdown; `pixel: true` buttons live in 256×160 coords
  (divide by 3). The win overlay's "next" id is remapped to `nextLevel` on
  click because the levels screen also owns an id `"next"`.
- The shared manifest/icon links are injected at runtime in `index.html` so
  Vite doesn't rebase `../manifest.webmanifest` into the bundle.
- `mockup.html` and `resources/` are design references only — not part of the
  build, never deployed.
