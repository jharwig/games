# Block — domain glossary

- **Run**: one attempt, from first flap to death. Score counts towers passed in a run.
- **Score**: towers passed this run. Never spendable; unrelated to coins.
- **Coin**: a collectible spawned near towers. Three tiers: **bronze** (1), **silver** (5), **gold** (10). Higher tiers spawn rarer and in riskier spots.
- **Wallet**: the player's lifetime coin balance. Coins bank into the wallet the moment they are picked up (dying never forfeits them). Persisted in the browser.
- **Shop**: screen for spending the wallet on cosmetics. Reachable from the title and game-over screens only; never opens automatically.
- **Face**: a cosmetic drawn on the block. One of seven designs (designed by Arthur Harwig). Bought once, owned forever.
- **Color**: a cosmetic body color for the block. Twelve designs. Bought once, owned forever.
- **Animation**: a cosmetic effect the block shows everywhere it appears (in a run, on the title, in the shop). Bought once, owned forever; can be worn or taken off. First design: **Sparkle Trail** — a rainbow sparkle trail behind the block (110 coins, designed by Arthur Harwig).
- **Equipped look**: the one face + one color + (optionally) one animation currently worn. Face, color and animation are independent slots that combine. The original orange, no-face, no-animation block is the free default. Cosmetic only — no gameplay effect.
- **Mystery pickup**: a rainbow-cycling square that floats in the safe middle of a tower gap (it may share a gap with a coin, stacked). Spawns on about 1 in 12 towers. Grabbing it re-rolls the **speed multiplier** to a random value between 0.5× and 2× — you can't tell fast from slow before grabbing. Nothing else changes (no score, coins, text or sound); you just feel it.
- **Speed multiplier**: how much faster or slower than normal the run currently goes. Starts at 1× every run; only a mystery pickup changes it, and it sticks until the next mystery pickup (or the run ends).
