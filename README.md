# Games

A collection of small browser games. Each game lives in its own directory and is one self-contained HTML file — no build step, no dependencies. Every push to `main` deploys all games to GitHub Pages.

**Play:** https://jharwig.github.io/games/

## Block

**Designed by Arthur Harwig**

**Play:** https://jharwig.github.io/games/block/

Block is a one-button arcade game in a retro pixel-art style. You guide a small orange hero through the night sky of a city. Towers of stacked blocks scroll toward you. Each tower has one gap. Tap to flap and keep the hero in the air; fly through the gap in each tower.

- Each tower you pass gives one point.
- The game gets faster every 5 points, up to a maximum speed.
- If you hit a tower or the ground, the hero and the nearby blocks explode into pixel debris, and the run ends.
- Your best score is saved in the browser.

The scene is drawn on a 160×288 pixel canvas: a starry sky with a cratered moon, two layers of parallax city skyline with lit windows, and a chiptune soundtrack with a mute toggle.

### Controls

- **Tap / click** — flap
- **Space** — flap
- **M** — mute / unmute the sound
- Any input on the title or game-over screen starts a new run.
