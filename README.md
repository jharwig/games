# Games

A collection of small browser games. Each game lives in its own directory — most are one self-contained HTML file; some are TypeScript apps built during deploy. Every push to `main` deploys all games to GitHub Pages.

**Play:** https://jharwig.github.io/games/

## Block

**Designed by Arthur Harwig**

**Play:** https://jharwig.github.io/games/block/

Block is a one-button arcade game in a retro pixel-art style. You guide a small orange hero through the night sky of a city. Towers of stacked blocks scroll toward you. Each tower has one gap. Tap to flap and keep the hero in the air; fly through the gap in each tower.

- Each tower you pass gives one point.
- The game gets faster every 5 points, up to a maximum speed.
- If you hit a tower or the ground, the hero and the nearby blocks explode into pixel debris, and the run ends.
- Your best score is saved in the browser.

Coins float around the towers: **bronze is worth 1**, **silver 5**, **gold 10** — the more valuable the coin, the riskier the spot it floats in. Coins are banked the moment you touch them (dying never takes them away) and are saved in the browser. Spend them in the **shop** — a SHOP button on the title and game-over screens — on new faces and body colors for the block, drawn from Arthur's designs. Your look is saved too, and the block explodes in its equipped colors.

The scene is drawn on a 160×288 pixel canvas: a starry sky with a cratered moon, two layers of parallax city skyline with lit windows, and a chiptune soundtrack with a mute toggle.

### Controls

- **Tap / click** — flap
- **Space** — flap
- **M** — mute / unmute the sound
- Any input on the title or game-over screen starts a new run; tap **SHOP** on those screens to buy and wear faces and colors.

## Ninja Adventure

**Designed by Gemma**

**Play:** https://jharwig.github.io/games/ninja/

Ninja Adventure is a third-person 3D obstacle-course game in a bright cartoon look. You run a ninja-warrior course full of very colorful obstacles: jumps with flips, rope climbs, rope swings, monkey bars, laché bars, trampolines, ziplines, and wall rides (jump at the wall holding forward, run along it, and jump off the end). Every level ends with the warped wall: run up the curve and jump near the top to grab the ledge and pull yourself up onto the podium's summit — slide back and try again if you're early. Each course is randomly generated, and each level is more difficult than the one before.

- Reach the podium at the end of each level to get a gold, silver, or bronze medal. The faster you are, the better the medal.
- If you fall, you go back to the last podium and try again.
- The game is endless. Your score is the number of podiums you reach.
- Your best run is saved in the browser, separately for each course.

### Courses

Pick a course on the title screen:

- **Straight** — the course runs in a straight line through the sky.
- **Tower** — the course spirals up and around a tower: every obstacle climbs a little higher, and each level keeps winding up the same coil. The camera rides around with you.

### Characters

Pick who you play as on the title screen (or at any podium): **Gemma, Arthur, Anya, Priella, Genevieve, or Alex** — each drawn by the designer, with their own hair and clothes. The picker shuffles every time you load the game, and your pick is remembered.

### Controls

- **Hold W / Up** — run (on touch, hold the left half of the screen)
- **Space** — jump / grab / release (on touch, tap the right half of the screen)
- **M** — mute / unmute the sound
- Tap **Straight** / **Tower** on the title screen to pick the course (`?mode=tower` in the URL also works)

## Bee Draw

**Designed by Priella**

**Play:** https://jharwig.github.io/games/beedraw/

Bee Draw is a puzzle game about one line. A swarm of bees tries to reach the animal you chose — a dog, a cat, a cow, a chicken, or a horse. You draw one line of ink to block them. When you lift your finger, the bees are released and they fly.

- Keep the animal safe for 7 seconds to win the level.
- You have a limited amount of ink, so each line must count — the budget is
  tuned to each level's layout, and it gets tighter as you climb.
- Made a bad line? Draw backwards along it to erase it and get the ink back
  (as long as your finger stays down).
- The levels are endless and randomly generated from a seed. Each level is more difficult than the one before: more bees, less ink, ponds where you cannot draw, honey pots that lure the bees away, and fast bees. Sometimes the animal shelters by the fence, sometimes in a nook of boulders out in the open.
- Your progress is saved automatically in the browser.

### Controls

- **Draw** — hold one finger or the mouse button and move to make the line
- **Draw backwards along the line** — erase it and refund the ink
- **Lift the finger / release the button** — release the bees
- **Tap the buttons** — change the level, change the animal, or mute the sound

## Pirates of the Swingset

**Designed by Genevieve**

**Play:** https://jharwig.github.io/games/swingset/

Pirates of the Swingset is a third-person 3D game set on a ring of four small islands — jungle, autumn, snow and volcanic — each with its own swingset, around the water where a pirate ship fires cannonballs at you. Swing high to dodge — a cannonball can pass right underneath you — or jump off and run when your swing is about to be hit. The ground is not safe: cannonballs shake the earth and hurt anyone caught in the blast.

- Fight back with playground tools scattered around: a chainsaw (cut down a tree and throw it), a boomerang hammer, a giant magnet (catch a cannonball in mid-air and sling it back), and a wrench (jam the ship's cannon).
- The trees near your swingset are your five hearts: lose a heart and a tree falls down dead — but a fallen tree can be picked up and thrown at the ship.
- Sink the ship to win the round; your hearts refill, the trees stand back up, and a slightly bigger ship sails in.
- Climb a tree to survey the islands and grab a zip line to either neighbouring island — the camera rides along in cinematic cuts, and the ship keeps shooting: a mid-ride hit costs a heart.
- Broken swings stay broken. If a whole swingset is wrecked, zip to another island. If every swingset is destroyed, fight on to the last heart in an on-foot last stand.
- Score points for hitting the ship, sinking ships, swinging, finding swingsets, and climbing trees. Your best score is saved in the browser.

### Controls

- **Space / SWING button** — pump the swing
- **Left / Right arrows** — jump off the swing and run; at a treetop, ride the zip line to that side
- **Up / Down arrows** — walk toward or away from the ship, and climb trees
- **Enter or F / THROW button** — throw or use the held tool
- **On touch screens** — a virtual joystick in the lower left replaces the arrows: touch anywhere in that corner and tilt. Bailing off a swing or grabbing a zip line takes a firm sideways tilt.
- **M** — mute / unmute the sea shanty
- Pick the boy or the girl on the title screen; you can switch after every sunken ship.
