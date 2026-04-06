# Web Frontend — Construction Mode Proposal

> **Status:** Proposal / Design document  
> **Scope:** `web/` TypeScript frontend (Vite + xterm.js + Express WebSocket proxy)  
> **Audience:** Developers considering implementing builder-assistance features in the web UI

---

## Table of Contents

1. [Background](#1-background)
2. [Guiding Principles](#2-guiding-principles)
3. [UI Layout Changes](#3-ui-layout-changes)
4. [Feature Catalogue](#4-feature-catalogue)
   - 4.1 [Room Map Graph](#41-room-map-graph)
   - 4.2 [Room Builder Form](#42-room-builder-form)
   - 4.3 [Exit Manager](#43-exit-manager)
   - 4.4 [Object Inspector & Attribute Editor](#44-object-inspector--attribute-editor)
   - 4.5 [Flag & Power Toggles](#45-flag--power-toggles)
   - 4.6 [Lock Expression Builder](#46-lock-expression-builder)
   - 4.7 [Object Browser Tree](#47-object-browser-tree)
   - 4.8 [Softcode Snippet Library](#48-softcode-snippet-library)
5. [Data Pipeline](#5-data-pipeline)
   - 5.1 [Stream-parsing approach (no server changes)](#51-stream-parsing-approach-no-server-changes)
   - 5.2 [Structured-output channel (recommended)](#52-structured-output-channel-recommended)
6. [Implementation Phases](#6-implementation-phases)
7. [Technology Choices](#7-technology-choices)
8. [Open Questions](#8-open-questions)

---

## 1. Background

The current web interface consists of:

| Component | Description |
|-----------|-------------|
| Left pane | `xterm.js` terminal (raw ANSI stream via WebSocket) |
| Right pane | "Who's online" panel + "Location" panel (best-effort stream parsing) |
| Input bar | Single-line command input with history |

The panels work by watching the raw terminal byte stream and extracting room names and WHO output through regex heuristics (`panels.ts`). This is intentionally lightweight.

A **Construction Mode** is a second operational mode of the web UI that overlays builder-focused panels on top of the terminal, providing graphical assistance for the most common world-building tasks: digging rooms, linking exits, editing descriptions and attributes, and visualising the topology of the area being built.

---

## 2. Guiding Principles

1. **The terminal remains the ground truth.** Every action taken through the construction UI sends real MUSH commands via the existing WebSocket; nothing bypasses the game engine.
2. **Progressive disclosure.** The default view is unchanged. Construction Mode is opt-in, activated by a toolbar button, and can be dismissed at any time.
3. **Graceful degradation.** If structured data cannot be obtained (e.g. insufficient wizard bit, or the softcode helper is not installed), every panel shows its last known state or a helpful message rather than crashing.
4. **Minimal new dependencies.** Prefer libraries already used or small, tree-shakeable packages.

---

## 3. UI Layout Changes

### 3.1 Toolbar addition

Add a `[⚒ Build]` toggle button to the existing `#topbar` (next to `[Disconnect]`). When active, the button is highlighted in the accent colour and the right panel pane switches from the "play" panels to the construction panel set.

```
┌──────────────────────────────────────────────────────┐
│ ● TinyMUSH          Wizard    [⚒ Build]  [Disconnect]│
├──────────────────┬───────────────────────────────────┤
│                  │  ← construction panels (right)    │
│  xterm.js        │                                    │
│  terminal        │                                    │
│                  │                                    │
├──────────────────┴───────────────────────────────────┤
│ > _                                         ↵ Send   │
└──────────────────────────────────────────────────────┘
```

### 3.2 Construction panel tabs

The right pane grows a tab bar across the top when Construction Mode is active:

```
[ Map ] [ Rooms ] [ Objects ] [ Attributes ] [ Snippets ]
```

Each tab renders a different sub-panel. The left terminal pane is unchanged.

### 3.3 Map overlay (optional)

For the Map tab specifically, an alternative is to render the graph as a full-screen overlay (modal) so it has more space. A `[⊞]` expand button inside the Map tab launches the overlay.

---

## 4. Feature Catalogue

---

### 4.1 Room Map Graph

**What it does** — Renders a 2-D directed graph where each node is a room and each edge is an exit (with its name as the edge label). The room the connected character currently occupies is highlighted.

**User interactions**

| Action | Result |
|--------|--------|
| Click a room node | Panel shows room details; `@teleport #dbref` is sent |
| Drag an empty area | Pan the canvas |
| Scroll | Zoom in/out |
| Click an edge label | Exit details shown (name, destination, lock status) |
| Double-click empty canvas | Opens "New room" dialog (see §4.2) |
| Drag from one room to a second room | Opens "New exit" dialog (see §4.3) |

**Technology** — [Cytoscape.js](https://js.cytoscape.org/) (`cytoscape` on npm, ~1 MB minified) is the most suitable choice: it has built-in directed-graph layouts, handles thousands of nodes, and is TypeScript-friendly. Alternative: [D3.js](https://d3js.org/) force simulation (more control, more code).

**Layout algorithm** — Start with the `breadthfirst` layout anchored at the player's current room. Provide a `dagre` layout option (hierarchical, good for linear corridors) via `cytoscape-dagre`.

**Data source** — See §5.

**Suggested node colours**

| State | Colour |
|-------|--------|
| Current room | `var(--accent)` (#00b894) |
| Visited room | `#2a2a2a` (dark card) |
| Unknown/unvisited | `#1a2a1a` (dimmer) |
| Room with players | accent with glow |

---

### 4.2 Room Builder Form

**What it does** — A form that lets builders fill in fields and click "Dig" instead of typing `@dig` manually.

**Form fields**

| Field | MUSH equivalent | Notes |
|-------|-----------------|-------|
| Room name | `@dig <name>` | Required |
| Exit from here | `@dig <name>=<exit-here>` | Optional; name of the exit leading to the new room |
| Exit back | `@dig <name>=<here>,<back>` | Optional; reverse exit name |
| Description | `@desc #new=<text>` | Multi-line textarea |
| Parent room | `@parent #new=#parent` | DB ref picker |
| Zone | `@zone #new=#zone` | DB ref picker |
| Flags | checkboxes (see §4.5) | Set after creation |

**Emitted commands (example)**

```
@dig Kitchen=north;n,south;s
@desc #1234=A long oak table dominates the room.
@set #1234=SAFE
```

**UI flow**

1. Form is submitted → commands built and sent one-by-one via `sendCommand()`.
2. The terminal stream is watched for the `Room #NNNN created.` confirmation line.
3. On confirmation, the Map graph is refreshed and the new room is selected.

---

### 4.3 Exit Manager

**What it does** — Show all exits from the current room in a table and allow creating, renaming, relinking, and deleting them.

**Table columns**

| Column | Description |
|--------|-------------|
| Name / aliases | Exit name string, e.g. `north;n;nor` |
| Destination | Room name + dbref |
| Lock | Brief summary of `@lock` |
| Actions | Edit · Relink · Delete |

**Commands wrapped**

| Action | Command |
|--------|---------|
| Create | `@open <name>=<destination>` |
| Rename | `@name #exit=<new-name>` |
| Relink | `@link #exit=#new-destination` |
| Delete | `@recycle #exit` |
| Set lock | `@lock #exit=<boolexp>` |

**Safety** — The Delete button shows a confirmation prompt before sending `@recycle`.

---

### 4.4 Object Inspector & Attribute Editor

**What it does** — Click any object reference (dbref) in the terminal and open a side-panel inspector. The inspector shows all attributes, their values, and the flags set on the object.

**Triggering** — `main.ts` already listens to the xterm.js output stream. Extend it to detect `#NNNN` patterns and render them as clickable links that dispatch an `inspect` event. Alternatively, add a search-by-dbref input at the top of the Attributes tab.

**Attribute table columns**

| Column | Description |
|--------|-------------|
| Attribute name | E.g. `DESC`, `SUCC`, `ASUCC` |
| Value preview | First 120 chars |
| Flags | `no_inherit`, `no_clone`, etc. |
| Actions | Edit · Clear |

**Edit flow**

1. User clicks Edit — value expands to an inline textarea with a monospace font.
2. User edits and clicks Save → `@set #dbref/<attr>=<value>` is sent.
3. Textarea collapses; row is refreshed by re-issuing `examine #dbref/<attr>`.

**Commands wrapped**

| Action | Command |
|--------|---------|
| Full examine | `examine #dbref` |
| Read one attr | `examine #dbref/<attr>` |
| Set attr | `@set #dbref/<attr>=<value>` or `&<ATTR> #dbref=<value>` |
| Clear attr | `@wipe #dbref/<attr>` |
| Examine owner | `examine/owner #dbref` |

---

### 4.5 Flag & Power Toggles

**What it does** — Renders the flags on the currently inspected object as a grid of toggleable badges. Active flags are highlighted; clicking an inactive flag adds it; clicking an active flag removes it. Powers work the same way.

**Common builder flags** (prioritise these in the UI)

```
SAFE  INHERIT  WIZARD  ROYALTY  STAFF  JUDGE  BUILDER  DARK  QUIET
UNFINDABLE  GOING  LINK_OK  ABODE  JUMP_OK  HAVEN  NO_TEL  OPAQUE
```

**Commands**

```
@set #dbref=FLAG        ← set
@set #dbref=!FLAG       ← clear
@power #dbref=POWER     ← grant power
@power #dbref=!POWER    ← revoke power
```

---

### 4.6 Lock Expression Builder

**What it does** — A visual builder for TinyMUSH boolean-expression locks, so builders do not have to hand-write `@lock` expressions.

**UI components**

- A tree editor where each node is a logical operator (`AND`, `OR`, `NOT`) or a leaf condition.
- Leaf condition types:
  - **Player/Object** — dbref or name
  - **Flag** — `FLAG:<flag-name>`
  - **Attribute** — `ATTR:<attr>=<value>`
  - **Power** — `POWER:<power>`
  - **Eval** — free-text softcode expression
- Drag-and-drop to reorder / nest sub-expressions.
- A live preview of the resulting lock string below the tree.

**Output example**

Tree: `AND(Wizard, OR(FLAG:STAFF, ATTR:APPROVED=1))`  
→ lock string: `*Wizard&FLAG:STAFF|ATTR:APPROVED:1`  
→ command: `@lock #1234=*Wizard&FLAG:STAFF|ATTR:APPROVED:1`

---

### 4.7 Object Browser Tree

**What it does** — A hierarchical tree view of all objects inside the current room (and optionally the whole area / zone), similar to a file explorer:

```
▼ The Grand Hall  (#100 R)
  ├── oak table   (#101 T)
  │    └── silver candelabra (#102 T)
  ├── north exit  (#103 E) → The Kitchen
  └── south exit  (#104 E) → The Entrance Hall
```

**Interactions**

| Action | Result |
|--------|--------|
| Click node | Open in Object Inspector (§4.4) |
| Right-click | Context menu: Examine, Teleport, Recycle |
| Drag node | Send `@tel #obj=#destination` |

**Data source** — Issue `@search in=#dbref` or `examine/full #dbref` and parse the output.

---

### 4.8 Softcode Snippet Library

**What it does** — A searchable library of common softcode patterns and command templates that builders can browse, customise, and send to the game.

**Categories (examples)**

| Category | Example snippets |
|----------|-----------------|
| Room atmosphere | Timed descriptions, randomised `ADESC` |
| NPC basics | patrol trigger, `@listen`/`@ahear` |
| Puzzle mechanics | key-and-lock, hit counter, relay |
| Admin utilities | `@pemit` broadcaster, `@search` report |
| Queue tricks | `@switch`, `@wait`, `@trigger` |

**Snippet format**

```json
{
  "title": "Randomised description",
  "description": "Picks one of several room descs at look-time.",
  "tags": ["room", "atmosphere"],
  "template": "@adesc #ROOM=@switch 1=[rand(3)]=1,{...},2,{...},3,{...}"
}
```

Placeholders (`#ROOM`, etc.) are highlighted in the editor. The builder fills them in and clicks "Send".

Snippets live in `web/src/client/snippets/` as JSON files, making them easy to contribute to.

---

## 5. Data Pipeline

### 5.1 Stream-parsing approach (no server changes)

Continue the pattern used in `panels.ts`: watch the raw terminal byte stream in `ws.onmessage` and extract structured data with regex. Works today without any MUSH softcode.

**Pros** — Zero game-engine changes required.  
**Cons** — Fragile (output format varies), cannot request data on demand, no guarantee of completeness.

**Usable for** — Current room name, exits list, basic WHO data, detecting confirmation messages.

### 5.2 Structured-output channel (recommended)

Add a thin MUSH softcode "helper" object in the game that accepts special queries sent via the WebSocket and returns JSON-delimited responses into the terminal stream.

#### Protocol

The web client sends a command beginning with a private sentinel (e.g. `@@JSON`):

```
@@JSON examine #100
```

The helper object catches this with `@listen` / `@ahear`, runs the appropriate command, and emits a response wrapped in sentinel delimiters:

```
\x02JSON:{"type":"examine","dbref":100,"name":"The Grand Hall",...}\x03
```

`0x02` (STX) and `0x03` (ETX) are bytes that never appear in ordinary terminal output. The `ws.onmessage` handler strips these frames from the byte stream before passing it to xterm.js, and routes the JSON payload to the appropriate panel.

**Pros** — Reliable, typed data; panels can request updates on demand.  
**Cons** — Requires a helper object installed in the game (documented in `game/configs/`); can only be used by authenticated builders.

#### Security note

The helper object must check `haspower(enactor(), BUILDER)` or `wizlevel(enactor()) >= ROYALTY` before responding to any query. Raw examine output should never be forwarded to players who would not normally see it through the terminal.

#### Fallback

If the structured query receives no STX/ETX frame within 2 seconds, the panel falls back to stream-parsing for that request and logs a warning to the browser console.

---

## 6. Implementation Phases

### Phase 1 — Scaffolding (no new game features needed)

- [ ] Add `[⚒ Build]` toggle button to topbar
- [ ] Add `construction-mode.ts` client module (panel controller, tab switching)
- [ ] Add CSS for tab bar and builder panel layout
- [ ] Room Map stub: render current room as a single node using parsed panel data

### Phase 2 — Map & Navigation

- [ ] Integrate Cytoscape.js
- [ ] Build map incrementally as the player moves (accumulate rooms/exits from stream parser)
- [ ] Click-to-teleport via `@tel`
- [ ] Double-click to open Room Builder Form (§4.2)
- [ ] Persist map state in `sessionStorage` (survives page refresh within session)

### Phase 3 — Room & Exit editing

- [ ] Room Builder Form (§4.2)
- [ ] Exit Manager table (§4.3)
- [ ] Stream-parser extensions for creation confirmations

### Phase 4 — Object tools

- [ ] Object Inspector / Attribute Editor (§4.4)
- [ ] Flag & Power Toggles (§4.5)
- [ ] Clickable dbref links in the terminal

### Phase 5 — Advanced tools

- [ ] Object Browser Tree (§4.7)
- [ ] Lock Expression Builder (§4.6) — most complex, consider deferring
- [ ] Snippet Library (§4.8)
- [ ] Structured-output channel (§5.2) + helper softcode object

---

## 7. Technology Choices

| Need | Recommendation | Why |
|------|---------------|-----|
| Graph rendering | [Cytoscape.js](https://js.cytoscape.org/) | Active, TS types, MUSH-scale graphs |
| Layout algorithm | `cytoscape-dagre` | Good for grid-like MUSH maps |
| Tree view (Object Browser) | Hand-rolled or [fancytree](https://github.com/mar10/fancytree) | Lightweight; no framework needed |
| Drag-and-drop (Lock Builder) | HTML5 native DnD or [SortableJS](https://sortablejs.github.io/Sortable/) | Already used feel in Vite projects |
| Snippet storage | Static JSON files in `web/src/client/snippets/` | Easy to PR; no backend needed |
| State management | Module-level variables (current approach) | Avoid Redux/Zustand overhead for this scale |
| Styling | Extend existing CSS variables in `index.html` | Consistent with current theme |

No UI framework (React/Vue/Svelte) is proposed. The current project is vanilla TypeScript, and the construction panels do not require reactive data binding that would justify introducing a framework.

---

## 8. Decisions

The following questions were resolved on 2026-04-06.

| # | Question | Decision |
|---|----------|----------|
| 1 | **Permission model** | Show `[⚒ Build]` only when the server confirms `haspower(me, BUILDER)` or `iswizard(me)` at login. All construction panels are hidden from ordinary players. |
| 2 | **Map scope** | Build the map incrementally from the player's current position with a **configurable depth limit** (default: 3 exits). Expose a `mapDepth` setting in the UI so builders can widen the horizon when needed. |
| 3 | **Multi-character sessions** | Accepted as a known constraint. Document in the UI that construction mode requires a character with `BUILDER` power or wizard status. |
| 4 | **Undo** | No undo function. Destructive actions (e.g. `@recycle`) require a confirmation dialog; no local undo stack is maintained. |
| 5 | **Structured-output helper softcode** | Included only in the **Docker build** (`docker/`). The helper object is pre-loaded as part of the Docker game image setup; bare non-Docker installations fall back to stream-parsing only. |
| 6 | **Map persistence** | `sessionStorage` only (client-side). The map snapshot is lost on logout / browser close. Server-side persistence may be revisited in a later phase. |

---

*Document created 2026-04-06. Decisions recorded 2026-04-06. Feedback and additions welcome via PR.*
