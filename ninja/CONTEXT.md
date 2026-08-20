# Ninja Adventure

The ninja obstacle-course runner (`ninja/`). Shared vocabulary for its
design; see `CLAUDE.md` for how the code is organised.

## Language

**Character**:
One of the named, playable ninjas (Gemma, Arthur, Anya, Priella, Genevieve,
Alex) — a name plus a look: skin, hair style and colour, eyes, clothes.
Characters are drawn on paper by the designer and coloured in here.
_Avoid_: Outfit, skin, costume, ninja (when you mean a specific one)

**Character picker**:
The row of paper-doll buttons on the title screen and the podium where the
player chooses a Character. Its order is shuffled on every load; a new
player starts with whichever Character lands first.
_Avoid_: Outfit picker

**Hair style**:
The shape of a Character's hair, independent of its colour: short, ponytail,
braids (two, one each side, swinging), or long (loose, past the shoulders).
_Avoid_: Hairdo, hair type
