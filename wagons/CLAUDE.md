# Circle the Wagons — dev notes

First-person shooting gallery designed by Jeff: the player stands fixed in the
centre of a Ring of Stagecoaches on a golden-hour prairie, turns through 360°
and shoots the Riders circling outside. TypeScript + Three.js + Rapier + Vite.
Deploys with the repo's GitHub Pages workflow, which builds this directory
(pnpm) and publishes `dist/` under `/wagons/`.

The vocabulary is in `CONTEXT.md` — use it (Run, Raid, Ring, Stagecoach,
Rider, Horse, Fall, Aim, Heart, Rifle, Six-shooter, Reload, Streak). Gameplay
is the designer's: ask before changing game design.

## Commands

- `pnpm run dev` — Vite dev server on :5176
- `pnpm run build` — `tsc --noEmit` then Vite build
- `pnpm run typecheck`

## Architecture (src/)

The player never moves: the camera rig (`yawObj` → `pitchObj` → `camera`)
sits at the origin at eye height, and everything is positioned on the Ring
with `ringPos(angle, radius)` (angle 0 = +X, counter-clockwise from above;
`yawAngle(yaw)` / `yawToward(angle)` convert between camera yaw and ring
angle). Near-camera fade (the repo's 3D rule) is moot here — nothing but
muzzle smoke ever comes near the camera.

- `main.ts` — composition root and ALL game rules: boot + asset loading
  with progress, the state machine (LOADING/TITLE/PLAYING/BREATHER/OVER),
  Raid progression (`raidParams` in `constants.ts`), shooting (raycast via
  `shootRay`), Hearts/score/Streak/Best, pointer-lock pause, positional
  audio panning, the title demo (riders circling behind the title), the
  frame loop.
- `constants.ts` — tuning constants, `State`, `raidParams(n)`, palette.
- `gfx.ts` — renderer (ACES, shadows), scene, camera rig, sun + hemi
  light, ground (procedural canvas texture, swapped for PBR textures when
  present), the worn-dirt disc inside the Ring, the procedural sky dome +
  mountain ridges used when the HDRI is missing, `applyEnvironment(hdr)`.
- `assets.ts` — reads `media/manifest.json`; `loadModel` (GLTF + meshopt),
  `loadTexture`, `loadHDR` all return `null` for anything missing.
- `ring.ts` — the six Stagecoaches (procedural Concord coaches or fitted
  GLBs), camp dressing, and `blockers` (invisible boxes used both for shot
  raycasts and as Rapier colliders).
- `riders.ts` — `Rider` (angle/radius/dir/speed, `arriving → riding ⇄ aiming
  → fallen → gone`), circling + lane weave, hoof dust, the Aim telegraph
  (`aimPose`) and shot, hitboxes (`userData.kind` = rider/horse/coach),
  `shootRay`, `assistTarget` (small aim-assist cone), and `fellRider` (the
  Fall — also used when the Horse is hit: `viaHorse` drops the horse for
  `HORSE_DOWN_TIME`, then it gets up and runs). Horses and riders each come in
  two flavours with one interface: procedural (`proceduralHorse`,
  `proceduralRider`) or skinned GLB (`skinnedHorse` with an AnimationMixer
  playing the `gallop` clip, `skinnedRider` driving recognised bones).
  Rider posing uses a fixed rider-local joint layout (`ridingJoints`) turned
  into per-segment poses (`SEGS`, `posesFromJoints`); the same `Binder`
  applies those poses whether they come from the riding pose or from the
  ragdoll, so both rider flavours fall identically.
- `ragdoll.ts` — Rapier world (ground + coach colliders), `spawnRagdoll`
  (capsule per `Segment`, spherical joints, collision groups so dolls only
  hit static geometry), `stepPhysics` (60 Hz accumulator, syncs poses into
  the Binder, fades and disposes after `BODY_FADE_TIME`).
- `guns.ts` — first-person viewmodels on a rig parented to the camera
  (procedural Winchester/Colt or fitted GLBs; nodes named `lever` /
  `cylinder` / `hammer` are animated when present), `tryFire` / `startReload`
  / `swapGun` timing, recoil spring, sway, lever-cycle and reload
  animations, muzzle smoke. `gunEvents` flags (lever clack, swapped) are
  read by `main.ts` for sound.
- `input.ts` — pointer lock + mouse look, keys (A/D/arrows turn, Space/LMB
  fire, R reload, Q/1/2/E swap), touch drag-to-look + FIRE/SWAP/RELOAD
  buttons, opt-in gyroscope (`setGyro`, iOS permission).
- `ui.ts` — DOM lookups/updates for `index.html` (HUD, banner, hit flash,
  title/over/credits screens). `credits.ts` — the attribution list shown
  in-game (mirror of `CREDITS.md`).
- `audio.ts` — WebAudio: uses `media/sfx/*.ogg` samples when listed in the
  manifest, synthesises every sound otherwise; `play` / `loop` with pan +
  distance.
- `particles.ts` — one Points pool: muzzle smoke/flash, hoof dust, impacts.

## Assets

The game must run fully with placeholders when no media is present — never
make loading a hard dependency.

- Login-gated originals are downloaded by hand into git-ignored `raw/`;
  `tools/download-wizard.sh` walks through fetching them.
- `tools/process.sh` (Blender headless + gltf-transform + ffmpeg)
  converts `raw/` into `public/media/` plus `public/media/manifest.json`,
  which `assets.ts` reads.
- Third-party CC-BY/CC0 assets are credited in `CREDITS.md`.
- Media contract (paths under `public/media/`): `hdri/plains_sunset_2k.hdr`;
  `tex/{grass,dirt}_{diff,nor,rough}.jpg`; `models/horse.glb` (rigged, clip
  named `gallop`, +Z forward, origin under the hooves), `models/rider.glb`
  (rigged humanoid, Mixamo-ish bone names, +Z forward, origin at the feet),
  `models/stagecoach.glb`, `models/stagecoach2.glb` (long axis Z),
  `models/rifle.glb`, `models/revolver.glb` (barrel along -Z, origin at the
  grip, optional `lever`/`cylinder`/`hammer` nodes); `sfx/*.ogg`.
- `public/media/**` ships to the site but is deliberately excluded from the
  hub service worker's precache by `.github/workflows/deploy.yml` (and from
  its runtime cache by root `sw.js`) — those files are large and load on
  demand.
