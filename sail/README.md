# REGATTA//

Top-down arcade sailing racer — off-road-racer energy, real sailing physics.
TypeScript + Three.js + Vite (hot module reloading in dev).

![genre](https://img.shields.io/badge/genre-offshore%20arcade-orange)

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
```

`npm run build` type-checks and bundles to `dist/`.

## How to play

| Input | Action |
| --- | --- |
| `◀ ▶` or `A D` | steer |
| `▲ ▼` or `W S` | sheet in / ease out (trims main + jib together) |
| `SPACE` | hoist / douse the spinnaker (takes a few seconds) |
| `1 2 3` | pick a boat on the menu |
| `R` | restart race, `Esc` back to menu |

- **Racing start**: 15 seconds of open sailing behind the line (committee
  boat = starboard end, orange pin = port end). Cross before the gun and
  you're **OCS** — sail back behind the line before your race counts. The
  committee boat yells the countdown and drops its flags at the start.
- The **wind lines** streaming across the water show true wind direction and
  strength; the dial (top right) shows wind vs. your heading.
- The **green mark** on the SHEET gauge is perfect trim — follow it as you turn.
- You can't sail straight upwind (the sails flog and you park). Tack at ~45°.
- Beam reach is the fastest point of sail — until you hoist the **kite** on a
  run. Fly it upwind and it will flog you to a standstill.
- Two classic courses: **windward/leeward** (3 laps) and **triangle** (2 laps).
  The next mark is the glowing beacon + the arrow pointer by your boat.
- Starboard tack has right of way — you'll hear about it ("STARBOARD!").
  Hit a boat you should have kept clear of and you're **frozen for 3.5s**
  while everyone sails past. The AI ducks sterns to keep clear, too.

## The fleet

- **TEMPEST 30** — monohull sloop. Agile, forgiving, heels dramatically.
- **VAPOR F40** — catamaran. Fastest top end, wide, deliberate turns.
- **HELIX TRI** — trimaran. Quick acceleration, balanced handling.

## Under the hood

- **Sails are real cloth**: each sail is a Verlet-integrated particle grid
  (structural/shear/bend constraints) pinned to mast and boom, pushed by
  per-triangle dynamic wind pressure. Luffing, flogging through tacks, and
  boom swings all emerge from the sim.
- **Sailing model**: apparent wind → angle of attack vs. sheet setting →
  flat-plate lift/drag decomposed against the hull's forward/lateral axes.
  No-go zone, leeway, and heel all fall out of the force balance.
- **AI skippers** sail the same physics: they beat upwind on laylines, pick
  tacks with hysteresis, dodge islands, and chase optimal trim imperfectly.
- Dev harnesses in `scripts/` (run via esbuild bundle, see `CLAUDE.md`):
  polar-table tuning, full AI-race validation, rig pose dumps.
- `?auto=1` query param = autopilot demo mode.
