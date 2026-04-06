---
name: mush-worldbuilding
description: "Build rooms, areas, and story arcs on TinyMUSH. Use when asked to create a room, dig a new area, write MUSH descriptions, design an exit network, build a story, write a scene, create a quest area, add atmosphere to a location, or produce in-game MUSH commands for world-building."
argument-hint: "Describe the area or story you want to build (theme, size, mood, connections)"
---

# TinyMUSH World-Building

## When to Use
- "Create a room / area / zone"
- "Build a story / quest / scene"
- "Write descriptions for my MUSH"
- "Design exits between rooms"
- "Help me build [place name]"

## Workflow

Follow these steps every time. Never skip the Design Document — it prevents wasted commands and keeps the world coherent.

### Step 1 — Clarify Requirements

Ask the user (or infer from their prompt) for:
| Detail | Default if omitted |
|--------|--------------------|
| Name / theme of area | Use prompt as-is |
| Number of rooms | 3–5 for a compact area |
| Connections to existing world | Standalone (can link later) |
| Target audience (new players, veteran, staff-only) | General |
| Story purpose (exploration, social, puzzle, combat) | Exploration |
| Atmosphere / mood | Neutral; infer from theme |

### Step 2 — Produce a Design Document

Output a structured **Area Design Document** before any commands. Use the template in [references/design-template.md](./references/design-template.md).

The document must include:
1. **Overview** — one paragraph: theme, mood, purpose in the world
2. **Room list** — table: Room Name | Brief Purpose | Key features
3. **Exit map** — ASCII diagram showing room connections and exit names
4. **Story beats** (if applicable) — numbered list of narrative moments a player will experience
5. **Atmosphere notes** — sensory details (sights, sounds, smells) for description writing

Ask the user to confirm or refine the design before generating commands.

### Step 3 — Generate MUSH Commands

Once the design is approved, produce a **complete, ordered command block** the user can paste into the MUSH client. Use the command reference in [references/commands.md](./references/commands.md).

**Order of operations:**
1. `@dig` each room (note the dbrefs returned)
2. `@open` any exits not auto-created by `@dig`
3. `@link` exits to their destination rooms
4. `@desc` every room (rich, atmospheric)
5. `@desc` every exit (short, evocative)
6. `@succ` / `@fail` / `@drop` for interactive objects if needed
7. `@set` flags (e.g. `SAFE`, `INHERIT`, `QUIET`)
8. `@parent` if a shared room parent exists

**Command block format:**
```
/* ── Area: <Name> ───────────────────────── */

/* Room 1: <Name> */
@dig/teleport <Room Name> = <Exit to here>;<alias>,<Exit back>;<alias>
@desc here = <rich description>
@set here = SAFE

...
```

Always include `/* comments */` labeling each logical section.

### Step 4 — Story Layer (optional)

If the user wants a story or quest embedded in the area:
- Add `@trigger` / `$`-command attributes for interactive elements
- Write in-character NPC speech as `@attr` blocks with `@verb` or `@listen`
- Include a **Story Summary** the user can share as a `@desc` on a meta-object or bulletin board post

### Step 5 — Review Checklist

Before handing off, verify:
- [ ] Every room has a `@desc`
- [ ] Every exit has a `@desc` and is `@link`ed
- [ ] Orphan rooms (no exits in or out) are flagged to the user
- [ ] dbref placeholders are clearly marked where the user must substitute real numbers
- [ ] No grammar or spelling errors in player-facing text

## Quick Reference

See [references/commands.md](./references/commands.md) for the full annotated command list.

Key commands at a glance:

| Goal | Command |
|------|---------|
| Create a room | `@dig <name>` |
| Create room + exits | `@dig <name> = <to>;<alias>,<back>;<alias>` |
| Teleport there after dig | `@dig/teleport <name>` |
| Describe an object/room | `@desc <obj> = <text>` |
| Describe an exit | `@desc <exit> = <text>` |
| Open a new exit | `@open <name>;<alias> = <dbref>` |
| Link an exit | `@link <exit> = <dbref>` |
| Set a flag | `@set <obj> = <FLAG>` |
| Reparent a room | `@parent <room> = <parent-dbref>` |
| Teleport to a dbref | `@tel me = #<dbref>` |
| Emit room-wide text | `@emit <text>` (staff/testing) |
