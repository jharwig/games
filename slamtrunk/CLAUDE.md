# Slam Trunk — dev notes

3D basketball game where elephants shoot peanuts with their trunks into giant
peanut bowls. TypeScript + Three.js + Vite, realistic look (physically based
materials, procedural textures, no external assets). Designed by Anya. Deploys
with the repo's GitHub Pages workflow (pnpm build, `dist/` published under
`/slamtrunk/`).

## Commands

- `pnpm dev` — Vite dev server on :5179
- `pnpm build` — `tsc --noEmit` then Vite build
- `pnpm typecheck`
- Style preview (dev only, never built): http://localhost:5179/mockup.html —
  `mockup.html` + `src/mockup.ts`. Stadium / outfit / camera / look toggles
  and a drag-to-aim throw. It is the one-time design reference the designer
  approved; do not turn it into gameplay and do not update it during normal
  work.

## Design decisions (agreed with the designer — ask before changing)

- Player is **Peanut** (gray, big floppy ears, friendly smile). Opponent is
  **Ellie** (dark blue, tusks). Everything 3D and realistic-looking.
- Drag to aim, let go to shoot a peanut from the trunk into a giant peanut
  bowl on a pole. Ellie blocks with her trunk and shoots at her own bowl;
  tap to jump and block her shots.
- 60-second games. Score more than Ellie → win a coin and move to the next
  stadium. Lose → replay the same stadium.
- Stadiums in order: circus tent → snow → city at night → moon → beach. After
  the beach it loops and Ellie gets harder each loop.
- Shop unlocks at 5 coins; everything costs 5: crown, party hat, sunglasses,
  red / purple / green jerseys, sneakers, cape, bow tie. One of each kind can
  be worn at once.
- Sounds: swish, elephant trumpet, crowd cheer, buzzer. Phone + computer.

## Architecture (src/)

- `gfx.ts` — `mat()` (standard PBR by default, toon for comparison), shape
  helpers, procedural noise / elephant-skin bump textures, sky dome, stars.
- `elephant.ts` — procedural elephant facing +Z (~3 m at the shoulder). Trunk
  is a posable frustum chain (`setTrunkPose` 0 = down, 1 = curled up; the
  peanut is parented to `trunkTip`). `setOutfit` rebuilds the shop pieces.
- `court.ts` — hardwood court (28×15, long axis Z), `buildHoop` (bowl on a
  pole, rim at `RIM_Y`, z = ±`HOOP_Z`), `buildPeanut` (lathe peanut shell,
  ~1 m), `buildBleachers` (instanced crowd, optional space helmets).
- `stadiums.ts` — the five stadiums: sky/fog/lights/surroundings + `update`.
  Each also picks the floor tint. Lights are added to the scene here.
- `types.ts` — the shared contract (save shape, ITEMS, input state, game
  events, HUD/menu/result/shop/audio interfaces). Change it deliberately.
- `input.ts` — pointer handling: drag = aim (deltas normalised to the short
  screen edge, y up), release past the dead zone = shoot, short tap = jump.
- `game.ts` — one 60 s game: countdown, clock, alternating possession,
  ballistic peanut + rim/ground bounces, Ellie's block/shoot AI, Peanut's
  auto-defence + tap block, camera (over-the-shoulder, swings to a reverse
  angle on Ellie's possession), near-fade of scenery. `difficulty(loop)` holds
  every AI knob per loop — tune there. Shot distance is measured from the
  trunk release point; a three is > 6.75 m. Ties count as a loss.
- `main.ts` — wiring: menu → game → result → next/shop/menu, save
  persistence, game events → HUD flashes + sfx.
- `hud.ts` / `menu.ts` / `result.ts` / `shop.ts` — DOM overlays in
  `index.html`; `save.ts` — localStorage (`slamtrunk.save.v1`).
- `audio.ts` — procedural WebAudio sfx (crowd/buzzer/etc. pre-rendered
  offline and cached), mute persisted under `slamtrunk.muted`.
