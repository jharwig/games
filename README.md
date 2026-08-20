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
- **Mystery pickups** — rainbow squares that sometimes float in the middle of a gap. Grab one and your speed changes to a random amount, anywhere from half speed to double speed. You can't tell which until you grab it, and it sticks until you grab the next one. Every run starts at normal speed.

Coins float around the towers: **bronze is worth 1**, **silver 5**, **gold 10** — the more valuable the coin, the riskier the spot it floats in. Coins are banked the moment you touch them (dying never takes them away) and are saved in the browser. Spend them in the **shop** — a SHOP button on the title and game-over screens — on new faces, body colors and animations for the block, drawn from Arthur's designs (the **Sparkle Trail** animation, 110 coins, leaves a rainbow sparkle trail behind the block and can be worn with any face and color). The shop scrolls — drag or use the mouse wheel. Your look is saved too, and the block explodes in its equipped colors.

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

Bee Draw is a puzzle game about one line. A swarm of bees tries to reach the animal you chose — a dog, a cat, a cow, a chicken, or a horse. You draw one line of ink to block them. When you lift your finger, the line falls onto the meadow as a rope and the bees are released.

- Keep the animal safe until the timer runs out to win the level.
- The bees are fast and smart. Wherever your rope lies loose on the grass, a bee can crawl under it and lift it up — and its friends slip through underneath. Only rope pressed right against a rock, a mountain, a tree, a log, a honey pot or the fence is braced and cannot be lifted. Think about where you draw.
- You have a limited amount of ink, so each line must count — the budget is
  tuned to each level's layout.
- Made a bad line? Draw backwards along it to erase it and get the ink back
  (as long as your finger stays down).
- Level 1 is easy (the line is a plain wall). From level 2 the levels are extremely hard and get harder: more and more obstacles — boulders, mountains, trees, fallen logs, honey pots, and ponds that you cannot draw on but the bees fly straight over.
- Every try is different: a new layout and a new look (meadow, autumn, snow, dusk, desert) each time you play a level.
- Your progress is saved automatically in the browser.

### Controls

- **Draw** — hold one finger or the mouse button and move to make the line
- **Draw backwards along the line** — erase it and refund the ink
- **Lift the finger / release the button** — release the bees
- **Tap the buttons** — change the level, change the animal, or mute the sound

## Pirates of the Swingset

**Designed by Genevieve**

**Play:** https://jharwig.github.io/games/swingset/

Pirates of the Swingset is a third-person 3D game set on a ring of four small islands — jungle, autumn, snow and volcanic — each with its own swingset, around the water where a pirate ship fires cannonballs at you. The swing is where the fighting happens: pump to the rhythm (press at each end of the arc for a PERFECT push — the ring over your head shows the beat), swing high to dodge — a cannonball passing underneath you is a DODGE and charges up a SUPER throw — and throw from the top of a big swing for a SUPER throw that does double damage and never misses. Jump off and run when your swing is about to be hit, but the ground is not safe: cannonballs shake the earth and hurt anyone caught in the blast.

- Fight back with playground tools scattered around: a chainsaw (cut down a tree and throw it), a boomerang hammer, a giant magnet (catch a cannonball in mid-air and sling it back), and a wrench (jam the ship's cannon). Tools are thrown only from a swing — on the ground, pressing THROW taunts the pirates instead: they get mad and fire at you on the ground (faster the more you taunt), which keeps the cannonballs off your swings.
- The trees near your swingset are your five hearts: lose a heart and a tree falls down dead — but a fallen tree can be picked up and thrown at the ship.
- Sink the ship to win the round; your hearts refill, the trees stand back up, and a slightly bigger ship sails in.
- Climb a tree to survey the islands and grab a zip line to either neighbouring island — the camera rides along in cinematic cuts, and the ship keeps shooting: a mid-ride hit costs a heart.
- Broken swings stay broken. If a whole swingset is wrecked, zip to another island. If every swingset is destroyed, fight on to the last heart in an on-foot last stand — the one time you can throw from the ground, at half power.
- From round 3 the pirates get smarter and sometimes aim at the top of your swing.
- Score points for hitting the ship, sinking ships, swinging (more the higher you go), perfect pumps, dodges, finding swingsets, and climbing trees. Your best score is saved in the browser.

### Controls

- **Space / SWING button** — pump the swing (press on the beat — at either end of the arc — for a PERFECT push)
- **Left / Right arrows** — jump off the swing and run; at a treetop, ride the zip line to that side
- **Up / Down arrows** — walk toward or away from the ship, and climb trees
- **Enter or F / THROW button** — throw the held tool from the swing (SUPER near the top); on the ground, taunt the pirates (or cut with the chainsaw)
- **On touch screens** — a virtual joystick in the lower left replaces the arrows: touch anywhere in that corner and tilt. Bailing off a swing or grabbing a zip line takes a firm sideways tilt.
- **M** — mute / unmute the sea shanty
- Pick the boy or the girl on the title screen; you can switch after every sunken ship.

## Circle the Wagons

**Designed by Jeff**

**Play:** https://jharwig.github.io/games/wagons/

Circle the Wagons is a first-person shooting gallery on a golden-hour prairie. You stand in the middle of a ring of eight stagecoaches and turn freely through 360°, shooting the riders who gallop around the outside of the ring before they shoot you.

- You never move from the centre of the ring. Turning, aiming and reloading are all you have.
- Riders circle at their own speed and radius — some the other way round, later ones hanging off the far side of the horse so they are hard to hit. The stagecoaches are their cover: a rider passing behind one is briefly hidden, so you shoot through the gaps and over the roofs.
- Hitting the horse works too: it goes down and throws its rider, then gets up and runs off.
- Before a rider shoots he aims: he turns in the saddle and raises his gun for about a second, with a sound and a visible cue. Drop him during his aim and the shot never comes.
- A rider you hit falls off his horse as a physics ragdoll — every fall is different, his hat flies off, and the horse gallops away out of the ring. No blood.
- You have five hearts. Every shot that lands on you costs one, and you cannot dodge. Clear all the riders in a raid and your hearts refill, a short breather follows, and the next raid is bigger, faster and more aggressive.
- Two guns, both with infinite ammo — reload time is the only cost. The **rifle** is one accurate, powerful shot and then a lever cycle; the **six-shooter** is six fast shots and then a spin-reload. Swap whenever you like.
- Consecutive riders dropped without a missed shot build a streak, which multiplies your score. Your best score is saved in the browser.
- The game is endless: losing your last heart is the only way a run ends.

### Controls

- **Click the game** — lock the mouse and start playing (**Esc** releases it)
- **Move the mouse** — look and aim
- **Left click** — fire
- **R** — reload
- **Q**, or **1** / **2** — swap between the rifle and the six-shooter
- **Left / Right arrows** or **A** / **D** — also turn
- **On touch screens** — drag to look, and use the **FIRE** and **SWAP** buttons; a toggle lets you steer by tilting the phone (gyroscope) instead

### Credits

Circle the Wagons uses third-party CC-BY and CC0 art and audio. Every asset and its author are listed in [`wagons/CREDITS.md`](wagons/CREDITS.md).
