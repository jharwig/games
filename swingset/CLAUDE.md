# Pirates of the Swingset — dev notes

Third-person 3D swingset-vs-pirate-ship game designed by Genevieve.
TypeScript + Three.js + Vite. Deploys with the repo's GitHub Pages workflow,
which builds this directory (npm) and publishes `dist/` under `/swingset/`.

Read `CONTEXT.md` first — it is the glossary of the game's design language
(Round, Trek, Lookout, Last Stand, heart-Trees…). Keep code names aligned
with it. Gameplay is the designer's: ask before changing game design.

## Commands

- `npm run dev` — Vite dev server on :5174
- `npm run build` — `tsc --noEmit` then Vite build
- `npm run typecheck`

## Architecture (src/)

- `types.ts` — THE module contract: shared types, tuning constants, event
  bus, and the `*Api` interface each module implements. Change contracts
  here first; modules follow.
- `main.ts` — composition root and ALL game rules: hit resolution, hearts ↔
  tree sync, round/run flow, scoring, what a THROW press does right now
  (`ctx.throwPower`: throw from the seat / SUPER / Last Stand weak throw /
  taunt), Dodge → SUPER charge, screen transitions, fixed-timestep loop.
  Modules detect and emit events; main applies consequences.
- `world.ts` — the four themed islands (terrain/water/sky), their swingsets
  (owns swing pendulum integration and the rhythm-pump judging; `pump()` is
  the only outside input and returns the timing quality),
  trees with their alive/fallen/stump lifecycle, zip-line landing posts.
- `player.ts` — character (boy/girl), movement state machine (swinging /
  airborne / ground / climbing / zipline, with the zip's cinematic cuts),
  and the camera rig (it owns the camera every frame).
- `ship.ts` — pirate ship model/scaling, telegraphed firing (rest-seat aim,
  apex aim in later Rounds, taunt anger), cannonball ballistics + collision
  and Dodge detection (emits `cannonImpact` / `cannonDodged`; never applies
  rules), sinking, trek repositioning.
- `tools.ts` — pickups, held item, throws (hammer boomerang, log, caught
  cannonball; each carries a `ThrowPower` — SUPER glows and never misses),
  chainsaw felling, wrench jam, magnet catch.
- `ui.ts` — all DOM under `#ui`: screens, HUD, pump ring / callouts / taunt
  bubble (projected over the kid), touch controls, mute.
- `audio.ts` — WebAudio sea shanty + event-driven sfx. No audio assets.

Conventions: Y-up, meters; four islands ring the archipelago centre, open
water everywhere the land dips below WATER_Y, the Ship near the centre.
Each island's swingset group is yawed (`setYaw`) so its local -Z faces the
centre; player movement and camera work in that island frame (`towardCenter`).
Positive swing angle = seat toward the Ship. Island 0 keeps the historical
axes (-Z toward the water, camera on +Z).
