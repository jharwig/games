# Block — dev notes

One-button pixel-art flappy game, designed by Arthur Harwig. TypeScript +
Vite, no runtime dependencies. Deploys with the repo's GitHub Pages workflow,
which builds this directory (npm) and publishes `dist/` under `/block/`.
Domain vocabulary (coins, wallet, shop, faces) is in `CONTEXT.md`.

## Commands

- `npm run dev` — Vite dev server (HMR) on :5174
- `npm run build` — `tsc --noEmit` then Vite build
- `npm run typecheck`

## Architecture (src/)

Internal resolution is 160×288, integer-upscaled; everything is drawn with
`fillRect` pixels (no images). All screens (title, pause, game over, shop)
are canvas overlays — the only DOM is the pause button.

- `main.ts` — state machine (TITLE/PLAYING/DEAD/PAUSED/SHOP), player physics,
  tower columns, collision, death effects (shake + RGB split), render order,
  input (taps are mapped to canvas pixels for button hit-testing), fixed-
  timestep loop.
- `constants.ts` — scene geometry + course/physics tuning.
- `gfx.ts` — canvas setup, integer scaling, `px` helper, offscreen layers,
  seeded PRNG. `palette.ts` — every colour.
- `background.ts` — pre-rendered sky/skyline/ground tiles + parallax scroll.
- `blocks.ts` — tower bricks (normal/damaged) and column drawing.
- `cosmetics.ts` — Arthur's faces + colours + animations, the coin wallet,
  owned/equipped persistence (`block.coins`, `block.owned`, `block.face`,
  `block.color`, `block.anim`), and `buildGrid`, which bakes the equipped
  look into the hero sprite grid (so debris and the tilt shear inherit it).
- `trail.ts` — the Sparkle Trail animation (rainbow sparks behind the block)
  plus the looping shop preview.
- `hero.ts` — cube rendering with propeller and tilt shear.
- `coins.ts` — coin spawn rules (bronze safe / silver gap lip / gold ceiling
  or ground dive between towers), pickup, drawing.
- `pickups.ts` — mystery pickups (rainbow squares, 1 in 12 towers) and the
  run's `speedMult`, re-rolled in [0.5, 2] on each grab.
- `shop.ts` — shop screen layout, drawing, and purchase/equip logic. The
  shelves scroll (drag / wheel) between a fixed header and footer; a press
  only starts a drag and the tap is decided on release.
- `particles.ts` — pixel debris + block destruction.
- `audio.ts` — synthesized chiptune + SFX (Web Audio).

## Rules

- Gameplay design belongs to Arthur — ask before changing mechanics, prices,
  or coin values. The shop catalog comes from Arthur's hand-drawn mockup.
- Keep the pixel look: whole-pixel coordinates, no smoothing, 3×5 font.
- The user tests in the browser; don't launch browsers or screenshot unless
  asked (repo rule).
