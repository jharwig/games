# Grumpy Grandpa — dev notes

Touch-first 2D room-management game designed by Cabin. TypeScript + canvas +
Vite; deploys with the repo's GitHub Pages workflow (builds this directory
with pnpm, publishes `dist/` under `/grandpa/`). Gameplay is the designer's:
ask before changing game design. Vocabulary (Nap, Stir, Wake-up, Gaze sweep,
Grump Meter, Like/Dislike, Reaction, Stash/Display spot, cast names) is
canonical in `CONTEXT.md` — use it in code and docs.

## Commands

- `pnpm run dev` — Vite dev server on :5177
- `pnpm run build` — `tsc --noEmit` then Vite build
- `pnpm run typecheck`

## Architecture (src/)

Everything renders to one 960×540 virtual canvas (`gfx.ts` letterboxes it);
DOM is only the HUD and the title/game-over overlays.

- `main.ts` — composition root and ALL game rules: the Nap → Stir → sweep →
  react → settle phase machine, judgment (what the gaze crossed this frame,
  right-most first, one per frame), the Grump Meter, the chaos-event spawner,
  scoring, drag/tap dispatch, difficulty ramp, run flow, best persistence.
- `constants.ts` — every tuning number (nap/stir/spawn ramps, severities,
  points). A playtest pass is a one-file edit.
- `room.ts` — Room layout and furniture drawing; Stash spots, Display slots,
  TV rect, `GAZE_START/END`. Positions are load-bearing: an item's x IS its
  grace time during a Gaze sweep (mantel = seen almost instantly).
- `items.ts` — loose items (messes + crafts): list, hit test, per-kind art.
- `agents.ts` — the dogs and Grandkids: roster art (Grandkid colors copied
  from ninja's `CHARACTERS`), autonomous behaviour, `startEvent()` chaos
  entry points, tap responses, the Like/Dislike states they present to a
  sweep (`agentJudgeables`, keyed so nothing is judged twice per sweep).
  Squabbles/roughhousing need both partners — a solo brawler self-releases.
- `grandpa.ts` — the headline feature: Reaction repertoire (`REACTIONS` maps
  every roster item to a full-body pose + callout line), the recliner
  (footrest slams down on wake), pose/face drawing, gaze spotlight, callout
  bubble. main drives his mode; this module acts it out.
- `audio.ts` — WebAudio synth, no assets. The snore is the timing
  instrument: `setSnore('steady' | 'stir' | 'off')` — steady = safe, stir =
  the sputter cue players play by ear. Plus one-shot `sfx()` and the
  TV-jingle loop.
- `input.ts` — single-pointer press/drag/release. Everything acts on press
  (no tap-vs-drag delay); holding one mess through a sweep hides it from
  judgment on purpose — the single-pointer rule is what caps that tactic.
- `ui.ts` / `gfx.ts` — DOM overlays (two-dog picker, score card) / canvas
  scale + outlined-shape primitives (`withCtx` redirects them for the
  picker portraits).

`localStorage` keys: `grandpa.best` (`{hours, score}`), `grandpa.dogs`
(two names), `grandpa.muted`.

## Testing flags

- `?hour=N` — start at hour N (shorter naps, faster chaos).
- `?test` — expose `window.__grandpa` (`grandpa`, `items`, `meter`,
  `phase`, `hour`) for a headless harness.
