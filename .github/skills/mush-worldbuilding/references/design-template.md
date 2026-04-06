# Area / Story Design Document Template

Copy this template and fill in each section before generating MUSH commands.

---

## Overview

> *One paragraph. Establish: What is this place? What is its role in the world? Who built it and why? What mood should players feel when they arrive?*

---

## Room List

| # | Room Name | Purpose | Key Features |
|---|-----------|---------|--------------|
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |
| 5 | | | |

*(Add or remove rows as needed.)*

---

## Exit Map

```
ASCII diagram — example:

  [Entrance Hall]
   n↕s      e↔w
[Chapel]  [Vestry]
    |
[Crypt]
```

Label each arrow with the exit name (and return exit name if different).

---

## Atmosphere Notes

Fill in sensory details that should appear across descriptions:

| Sense | Notes |
|-------|-------|
| Sight | Dominant colors, lighting quality, notable visuals |
| Sound | Ambient sounds (wind, dripping, voices, silence) |
| Smell | Distinctive odors |
| Touch/temperature | Warmth, cold, dampness, texture underfoot |
| Mood/feeling | What the space emotionally conveys |

---

## Story Beats *(leave blank if no story)*

Numbered list of moments a player will experience moving through the area:

1. 
2. 
3. 

For each beat, note:
- **Trigger**: what the player does (enters room, picks up object, reads sign)
- **Response**: what happens (description change, emitted text, teleport, unlock)
- **Purpose**: what narrative information is revealed

---

## Notable Objects

| Object Name | Room | Description Summary | Interactive? |
|-------------|------|---------------------|--------------|
| | | | |

---

## Connections to Existing World

| This exit | Leads to (existing room / dbref) | Notes |
|-----------|----------------------------------|-------|
| | | |

*(Leave blank if the area is standalone for now.)*

---

## Review Checklist (fill in after commands are generated)

- [ ] Every room has a `@desc`
- [ ] Every exit has a `@desc` and is `@link`ed
- [ ] No orphan rooms
- [ ] `@set here = SAFE` on all new rooms
- [ ] Story triggers tested in-game
- [ ] Area announced to players / added to help/news
