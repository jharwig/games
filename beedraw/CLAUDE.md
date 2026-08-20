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
  input model (`validInk`/`clampToValid`/`addInkPoint`), bee simulation
  (flow-field steering + grid collision), HUD/overlays, rAF loop, input.
- `level.ts` — seeded level generation (`genLevel`/`tryGen`) and the
  solvability guard (`ringSealCost`/`sealedFor`), plus the geometry tests
  (`pointInRock`/`pointInPond`/`inField`) and gap helpers.
- `grid.ts` — pathfinding primitives shared by the game and the guard:
  BFS `distField` on the 64×40 grid (12px cells), no corner cutting.
- `art.ts` — smooth-canvas gameplay art (meadow, fence, rocks, ponds, honey,
  ink stroke, bee, the five animals).
- `screens.ts` — pixel-art title/level-select, drawn at 256×160 and blitted 3×.
- `audio.ts` — Web Audio: 16-step music sequencer, bee buzz loop, sfx.
- `const.ts`, `util.ts` — constants/palette; clamp/lerp, localStorage,
  `mulberry32` seeded PRNG.

## Gotchas

- Levels are deterministic from the level number: `mulberry32` plus the exact
  RNG call order in `tryGen`. Reordering `r()` calls reshuffles every level in
  the wild (best-level saves point at levels players have already beaten).
- The generator never guesses: it verifies with the same grid the bees walk
  (`gridFor` must stay in sync with `buildStatic` in main.ts) and rejects
  layouts whose cheapest verified seal doesn't fit the ink budget.
- UI is immediate-mode: `uiButtons` is rebuilt every frame during draw and
  hit-tested on pointerdown; `pixel: true` buttons live in 256×160 coords
  (divide by 3). The win overlay's "next" id is remapped to `nextLevel` on
  click because the levels screen also owns an id `"next"`.
- The shared manifest/icon links are injected at runtime in `index.html` so
  Vite doesn't rebase `../manifest.webmanifest` into the bundle.
- `mockup.html` and `resources/` are design references only — not part of the
  build, never deployed.
