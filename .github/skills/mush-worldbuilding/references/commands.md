# TinyMUSH Building Command Reference

Annotated quick-reference for the commands used most during world-building.
All examples assume you are already standing in (or have noted the dbref of) the relevant room.

---

## Room Creation

### `@dig`
```
@dig <room name>
@dig/teleport <room name>
@dig <room name> = <exit-to>;<alias>[;<alias>...], <exit-back>;<alias>[;<alias>...]
```
- Creates a new ROOM and prints its dbref.
- `/teleport` — moves you to the new room immediately.
- The optional `= exits` clause opens exits in both directions at once.
- Cost: 10 coins.

**Example:**
```
@dig/teleport The Ruined Chapel = Chapel;chapel;north;n, Exit;exit;south;s
```

---

## Descriptions

### `@desc` (alias `@describe`)
```
@desc <object> = <text>
@desc here = <text>
@desc <exit-name> = <text>
```
Sets the text players see when they `look` at the object or room.
Function calls (`name(me)`, `time()`, etc.) and `%`-substitutions are evaluated at look-time.

**Good practice:**
- Rooms: 3–6 sentences. Establish mood before listing notable features.
- Exits: 1 sentence. Describe what the player sees in that direction, not the destination.
- Objects: 1–3 sentences. Focus on sensory detail.

### `@odesc` (alias `@odescribe`)
```
@odesc <object> = <text shown to others when they look at you looking at it>
```

### `@adesc` (alias `@adescribe`)
```
@adesc <object> = <action/command run on the object when someone looks at it>
```

---

## Exits

### `@open`
```
@open <exit-name>;<alias>;<alias> = <destination-dbref>
```
Opens a new exit from your current location, linked to `<destination-dbref>`.

**Example:**
```
@open North;n;north = #42
```

### `@link`
```
@link <exit-name> = <destination-dbref>
@link <exit-name> = here        (link to current room)
```
Links an already-open exit to a destination.

### `@unlink`
```
@unlink <exit-name>
```
Detaches an exit from its destination (makes it unlinked/locked).

---

## Success / Failure / Drop Messages

### `@succ` / `@osucc` / `@asucc`
```
@succ <exit> = <message shown to mover on successful move>
@osucc <exit> = <message shown to room when someone uses the exit>
@asucc <exit> = <action run on mover after successful move>
```

### `@fail` / `@ofail` / `@afail`
```
@fail <exit> = <message shown when move fails>
@ofail <exit> = <message shown to room when move fails>
@afail <exit> = <action run on object when move fails>
```

### `@drop` / `@odrop` / `@adrop`
```
@drop <room> = <message shown to arriving player>
@odrop <room> = <message shown to room when someone arrives>
@adrop <room> = <action run on room when something is dropped here>
```

---

## Flags

### `@set`
```
@set <object> = <FLAG>
@set <object> = !<FLAG>      (clear a flag)
```

Commonly useful flags for building:

| Flag | Applied to | Effect |
|------|-----------|--------|
| `SAFE` | Room | Prevents accidental destruction |
| `INHERIT` | Room/Object | Inherits parent's attributes |
| `QUIET` | Object/Room | Suppresses default arrive/depart messages |
| `DARK` | Room/Exit | Hidden from `look` listings |
| `JUMP_OK` | Room | Players can `@teleport` here freely |
| `ABODE` | Room | Players can set their home here |
| `STICKY` | Room | Activate drop-to when room empties |

**Example:**
```
@set here = SAFE
@set here = JUMP_OK
```

---

## Parenting

### `@parent`
```
@parent <object> = <parent-dbref>
```
Inherits attributes and `$`-commands from a parent object.
Use a master room parent to share descriptions, ambient triggers, or standard exits across many rooms.

---

## Navigation

### `@teleport`
```
@tel me = #<dbref>
@tel <object> = #<dbref>
```
Moves yourself or an object to a dbref. Useful for testing a new area.

### `@pemit` / `@emit`
```
@emit <text>               (to everyone in your location)
@pemit <player> = <text>   (private message to one player)
```
Used for ambient storytelling, staff narration, or testing trigger text.

---

## Naming

### `@name`
```
@name <object> = <new name>
@name <exit> = <new name>;<alias>;<alias>
```

---

## Decompile / Inspect

### `@decompile`
```
@decompile <object>
@decompile/tf <object>     (tinyfugue-ready format)
```
Prints all commands needed to recreate the object. Use this to:
- Audit an existing room before editing it.
- Copy a room to another MUSH.
- Verify your build is complete.

---

## Typical Build Sequence (copy-paste skeleton)

```
/* ══════════════════════════════════════════ */
/* Area: <AREA NAME>                          */
/* Builder: <your name>   Date: <date>        */
/* ══════════════════════════════════════════ */

/* ── Room 1: <Name> ── */
@dig/teleport <Room 1 Name> = <Exit-to-R1>;<alias>,<Exit-from-R1>;<alias>
@desc here = <description>
@drop here = <arrival message to mover>
@odrop here = <arrival message to room>
@set here = SAFE

/* ── Room 2: <Name> ── */
/* (repeat from @dig) */

/* ── Cross-links (add exits not created by @dig) ── */
/* @tel me = #<dbref-of-room-1> */
/* @open <exit> = #<dbref-of-room-2> */
/* @desc <exit> = <text> */
```

Replace `#<dbref-*>` with the actual numbers printed when each `@dig` runs.
