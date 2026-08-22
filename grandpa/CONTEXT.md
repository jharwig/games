# Grumpy Grandpa

A touch-first 2D room-management game: Grandpa naps in his recliner while chaos
accumulates in the living room; the player fixes or hides what he'd hate and
stages what he'd love before he wakes. Designed by Cabin, drawn in a 90s
Saturday-morning-cartoon style.

## Language

**Grandpa**:
The napping judge in the recliner. Never player-controlled; he only sleeps,
stirs, wakes, and reacts to what he sees.

**Nap**:
The period while Grandpa sleeps and the player can act freely. Nap lengths are
irregular.

**Stir**:
The telegraphed warning animation and sound cue that always precedes a
Wake-up. The Stir window shrinks as difficulty ramps.
_Avoid_: warning, alert

**Wake-up**:
The moment Grandpa opens his eyes and judges what he sees.

**Gaze sweep**:
How a Wake-up judges the Room: Grandpa's gaze travels from the recliner
across to the far wall, judging each thing as it passes over it. Distance
from the recliner is grace time — the player can keep acting ahead of the
gaze.
_Avoid_: scan, raycast

**Stash spot**:
A place a Dislike mess can be dragged to make it vanish from judgment: the
toy bin, the laundry hamper, or under the couch.
_Avoid_: trash, inventory

**Display spot**:
A place a craft can be dragged so Grandpa sees it as a Like: the mantel or
the coffee table. Spots near the recliner are seen earliest — high value,
high risk.
_Avoid_: shelf slot, pedestal

**Grump Meter**:
The single fail-state gauge. Dislikes he sees fill it (scaled by severity);
Likes he sees drain it. Full meter ends the game.
_Avoid_: anger bar, health

**Dislike**:
Anything that fills the Grump Meter when Grandpa sees it — messes left out,
dogs roughhousing, and the like.

**Like**:
Anything that drains the Grump Meter and banks bonus points when Grandpa sees
it — grandkid crafts, kids cleaning, kids playing nicely.

**Room**:
The single side-view living-room scene where all play happens, with Grandpa's
recliner at one side.

**Reaction**:
The acted-out gag Grandpa performs when his gaze sweep hits a Like or
Dislike — a full pose from his repertoire (pointing, hands on hips, hand on
forehead in exasperation, …) plus a callout line. Reactions are the game's
comedy engine; each roster item has its own.
_Avoid_: feedback, popup

## Cast

**Chaos agents**:
The dogs and Grandkids who roam the Room autonomously and cause Dislikes.

**Grandkids**:
The kid characters, drawn from the Ninja Adventure roster: Gemma, Arthur,
Anya, Priella, Genevieve, Alex. Tap a squabbling Grandkid to redirect them to
a nice activity.
_Avoid_: children, players

**Dogs**:
The four possible dogs: Nova (brown Southern Cur), Will-E (white Southern
Cur), Gnocchi (brown Cockapoo), Lulu (white Cockapoo). Tap to settle them
when roughhousing.
