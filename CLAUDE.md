# Games — repo notes

A collection of small browser games, deployed to GitHub Pages on every push
to `main` (https://jharwig.github.io/games/). The root is a PWA shell:
`index.html` (game hub), `sw.js` (offline precache), `manifest.webmanifest`.

## Layout

- Each game lives in its own top-level directory.
- Simple games are a single self-contained `index.html` (block, ninja, beedraw).
- Complex games may be multi-file built apps with a `package.json` (sail).
  The deploy workflow (`.github/workflows/deploy.yml`) auto-builds any
  top-level directory containing a `package.json` and publishes its `dist/`.
- `sail/` has its own `CLAUDE.md` — read it before working there.

## Adding a new game

1. Ask who the designer is — every game credits a designer. Keep gameplay
   faithful to the designer's intent; ask before changing game design.
2. Use TypeScript for new projects (Vite app like `sail/`) to keep code
   organized and type-safe.
3. 3D games fade scenery that gets close to the camera so it never blocks
   the view of the player — see `updateNearFade` in `ninja/index.html` for
   the reference implementation.
4. Update all three of: `index.html` (hub card), `sw.js` (PRECACHE list —
   built apps are precached automatically by the workflow, static files are
   not), and `README.md` (player-facing description + controls + designer).

## Mockups

`mockup.html` files are one-time design references, not living documents.
Do not update them during normal work. If visual changes are requested,
produce new mockup assets instead of editing gameplay code from the old one.

## Testing

The user tests changes in the browser themselves. Do not launch browsers,
take screenshots, or do frame analysis unless explicitly asked.
