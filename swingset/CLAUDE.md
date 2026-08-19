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
  tree sync, round/run flow, scoring, screen transitions, fixed-timestep
  loop. Modules detect and emit events; main applies consequences.
- `world.ts` — terrain/water/sky, the four swingsets (owns swing pendulum
  integration; `pump()` is the only outside input), trees with their
  alive/fallen/stump lifecycle.
- `player.ts` — character (boy/girl), movement state machine (swinging /
  airborne / ground / climbing), and the camera rig (it owns the camera
  every frame).
- `ship.ts` — pirate ship model/scaling, telegraphed firing, cannonball
  ballistics + collision detection (emits `cannonImpact`; never applies
  rules), sinking, trek repositioning.
- `tools.ts` — pickups, held item, throws (hammer boomerang, log, caught
  cannonball), chainsaw felling, wrench jam, magnet catch.
- `ui.ts` — all DOM under `#ui`: screens, HUD, touch controls, mute.
- `audio.ts` — WebAudio sea shanty + event-driven sfx. No audio assets.

Conventions: Y-up, meters; water at z < 0, playground z > 0; swings arc
along Z toward the water; camera behind the player on +Z. Positive swing
angle = seat toward the water.
