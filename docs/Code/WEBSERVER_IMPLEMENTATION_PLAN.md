# Web Interface Implementation Plan

**Status:** Draft  
**Date:** 2026-04-06  
**Scope:** Replace the public-facing Telnet interface with a browser-based web client backed by WebSockets; deploy the whole stack in Docker Compose.

---

## Table of Contents

1. [Goals and Non-Goals](#1-goals-and-non-goals)
2. [Architecture Overview](#2-architecture-overview)
3. [Technology Choices and Rationale](#3-technology-choices-and-rationale)
4. [Phase 0 — Docker Compose Infrastructure](#4-phase-0--docker-compose-infrastructure)
5. [Phase 1 — WebSocket Proxy Layer (Node.js)](#5-phase-1--websocket-proxy-layer-nodejs)
6. [Phase 2 — Authentication Flow](#6-phase-2--authentication-flow)
7. [Phase 3 — Frontend TUI (xterm.js + Split Panels)](#7-phase-3--frontend-tui-xtermjs--split-panels)
8. [Phase 4 — Structured Panel Data](#8-phase-4--structured-panel-data)
9. [Phase 5 — TLS and Production Hardening](#9-phase-5--tls-and-production-hardening)
10. [Phase 6 — Optional TinyMUSH Web-API Module](#10-phase-6--optional-tinymush-web-api-module)
11. [Repository Layout Changes](#11-repository-layout-changes)
12. [Milestone Summary](#12-milestone-summary)
13. [Open Questions / Future Work](#13-open-questions--future-work)

---

## 1. Goals and Non-Goals

### Goals

| # | Goal |
|---|------|
| G1 | Telnet remains **internal only** — port 6250 is never exposed outside the Docker internal network. The browser is the sole public interface. |
| G2 | A split-pane browser TUI: xterm.js terminal in the center/left; side panels for the WHO list, current room info, and other structured data. |
| G3 | Full **UTF-8** and ANSI/VT-100 color passthrough so existing ANSI-art and box-drawing characters render correctly. |
| G4 | Authentication uses **the existing MUSH `connect <user> <pass>` protocol** — no separate credential store. |
| G5 | The entire stack runs as a **Docker Compose** project with one command (`docker compose up`). |
| G6 | The MUSH engine binary and its game data require **zero changes** for Phases 0-3. |

### Non-Goals

- Replacing Telnet inside the MUSH engine itself (the engine continues to speak raw TCP).
- Supporting MXP, MCCP, or other Telnet extensions in the web client (out of scope).
- Building a full mobile app — the web TUI is desktop-first (responsive is a Phase 5+ stretch).

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Public Internet                           │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS / WSS (:443)
                    ┌──────▼──────┐
                    │  Caddy/nginx │  ← TLS termination (Phase 5)
                    │  reverse proxy│
                    └──────┬──────┘
                           │ HTTP / WS (:3000)
          ┌────────────────▼──────────────────────┐
          │         tinymush-web container          │
          │         (Node.js + Express + ws)        │
          │                                         │
          │  ┌──────────────────────────────────┐  │
          │  │  Static SPA                       │  │
          │  │  HTML + xterm.js + split panels   │  │
          │  └──────────────────────────────────┘  │
          │  ┌──────────────────────────────────┐  │
          │  │  WebSocket server (/ws)           │  │
          │  │  ↔  TCP bridge  →  port 6250       │  │
          │  └──────────────────────────────────┘  │
          │  ┌──────────────────────────────────┐  │
          │  │  REST API                         │  │
          │  │  POST /api/login                  │  │
          │  └──────────────────────────────────┘  │
          └───────────────────┬───────────────────┘
                              │ TCP :6250
                    ┌─────────▼───────────┐
                    │  tinymush container  │
                    │  (game engine)       │
                    │  select() event loop │
                    │  — bsd.c             │
                    └─────────────────────┘
                    Docker internal network: tinymush-net
                    Port 6250 NOT exposed on host
```

### Key design decisions

| Decision | Choice | Reason |
|----------|--------|--------|
| Web layer location | **Sidecar service** (separate container) | Keeps the C engine untouched; Node.js ecosystem handles WebSocket natively; web layer can be updated/restarted independently without touching game state. |
| Telnet port exposure | Internal Docker network only | Eliminates raw Telnet as an attack surface; all traffic goes through the authenticated web layer. |
| Auth strategy | Pass-through `connect` protocol | No separate user database to maintain; credentials are the same ones players already know. |
| Terminal emulator | xterm.js | De-facto standard; supports VT-100, ANSI color, UTF-8, box-drawing, and emoji without extra configuration. |

---

## 3. Technology Choices and Rationale

### 3.1 Web Layer — Node.js

**Recommended stack:** Node.js 20 LTS + TypeScript

| Package | Purpose |
|---------|---------|
| `express` | HTTP server, static file serving, REST routes |
| `ws` | WebSocket server (`ws` is lighter than `socket.io` and sufficient here) |
| `express-session` | Session cookies (optional if WebSocket auth is sufficient) |
| `net` (Node built-in) | TCP client to talk to the MUSH engine |
| `vite` (dev dependency) | Bundles the frontend SPA |

**Why not a TinyMUSH C module?**  
Embedding a full HTTP/WebSocket stack inside the C engine would require integrating `libwebsockets` or `libevent` with the existing `select()`-based event loop in `bsd.c`. This is feasible but adds significant complexity, risks destabilizing the game loop, and makes the web layer much harder to iterate on independently. The sidecar proxy costs one extra TCP hop (WebSocket → proxy → MUSH TCP) but that overhead is negligible for a text-based game.

### 3.2 Frontend

| Package | Purpose |
|---------|---------|
| `xterm` | Terminal emulator widget |
| `xterm-addon-fit` | Resize terminal to fill its container |
| `xterm-addon-unicode11` | Full Unicode 11 support (UTF-8, box-drawing, CJK) |
| `xterm-addon-web-links` | Clickable URLs in output |
| `split.js` | Drag-to-resize split panes |
| Vanilla TypeScript / minimal framework | No heavy framework needed; React or Svelte are optional if state management becomes complex |

**UTF-8 pipeline:**  
The MUSH engine outputs raw bytes. The Node.js proxy bridges them as binary WebSocket frames. xterm.js with `unicode11` addon decodes UTF-8 and renders box-drawing and ANSI color correctly. The terminal width/height is communicated back to the engine via a special resize message (see §5.4).

### 3.3 Docker

| Service | Base image | Notes |
|---------|------------|-------|
| `tinymush` | `debian:bookworm-slim` | Same distro used for builds; includes gdbm/lmdb runtime libs |
| `tinymush-web` | `node:20-alpine` | Small footprint; multi-stage build |
| `caddy` (Phase 5) | `caddy:2-alpine` | Automatic HTTPS via Let's Encrypt |

---

## 4. Phase 0 — Docker Compose Infrastructure

This phase containerises the existing MUSH engine with no code changes.

### 4.1 Directory layout additions

```
docker/
  Dockerfile.game          # TinyMUSH engine image
  Dockerfile.web           # Node.js web layer image
  Dockerfile.web.dev       # Development variant with hot-reload
  nginx/
    tinymush.conf          # nginx reverse-proxy config (Phase 5 alternative)
  caddy/
    Caddyfile              # Caddy config (Phase 5 preferred)
docker-compose.yml         # Production stack
docker-compose.dev.yml     # Development overrides (port 6250 exposed for direct telnet debugging)
```

### 4.2 `Dockerfile.game`

```dockerfile
# Stage 1 — build
FROM debian:bookworm AS builder
RUN apt-get update && apt-get install -y \
    build-essential cmake git libgdbm-dev liblmdb-dev \
    libpcre2-dev libssl-dev pkg-config
WORKDIR /src
COPY . .
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j"$(nproc)"

# Stage 2 — runtime
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgdbm6 liblmdb0 libpcre2-8-0 libssl3 \
 && rm -rf /var/lib/apt/lists/*

# Copy only the binary and game directory
COPY --from=builder /src/build/src/netmush/netmush /usr/local/bin/netmush
COPY --from=builder /src/game /game

WORKDIR /game

# Port 6250 is declared but only connected to the internal network — never the host
EXPOSE 6250

# Volumes for persistent data
VOLUME ["/game/db", "/game/logs", "/game/backups", "/game/configs"]

# Run in foreground (no fork) so Docker can manage the process
CMD ["netmush", "--no-fork"]
```

> **Note:** A `--no-fork` flag (or equivalent config option `fork_child no`) must be present or added so the process stays in PID 1 and Docker can supervise it. Alternatively, a small shell wrapper can handle this.

### 4.3 `docker-compose.yml`

```yaml
name: tinymush

networks:
  tinymush-net:
    driver: bridge
    internal: true   # No direct host access to this network
  web-net:
    driver: bridge

volumes:
  mush-db:
  mush-logs:
  mush-backups:
  mush-configs:

services:
  # ── Game engine ─────────────────────────────────────────────────
  tinymush:
    build:
      context: .
      dockerfile: docker/Dockerfile.game
    restart: unless-stopped
    networks:
      - tinymush-net          # Internal only — telnet never exposed to host
    volumes:
      - mush-db:/game/db
      - mush-logs:/game/logs
      - mush-backups:/game/backups
      - mush-configs:/game/configs
    environment:
      MUSH_PORT: "6250"
    healthcheck:
      test: ["CMD", "nc", "-z", "localhost", "6250"]
      interval: 30s
      retries: 3

  # ── Web layer ────────────────────────────────────────────────────
  tinymush-web:
    build:
      context: .
      dockerfile: docker/Dockerfile.web
    restart: unless-stopped
    depends_on:
      tinymush:
        condition: service_healthy
    networks:
      - tinymush-net   # Can reach the MUSH engine
      - web-net        # Exposed to the outside world
    ports:
      - "3000:3000"    # nginx/Caddy will proxy this in production
    environment:
      MUSH_HOST: tinymush
      MUSH_PORT: "6250"
      SESSION_SECRET: "${SESSION_SECRET}"   # Set in .env
      NODE_ENV: production
```

### 4.4 `.env` file (not committed — add to `.gitignore`)

```ini
SESSION_SECRET=change_me_to_a_long_random_string
CADDY_EMAIL=admin@example.com
CADDY_DOMAIN=mush.example.com
```

---

## 5. Phase 1 — WebSocket Proxy Layer (Node.js)

The web layer has three responsibilities:

1. Serve the static SPA.
2. Accept WebSocket connections from browsers and bridge them to a TCP connection to the MUSH engine.
3. Provide a thin REST API for login.

### 5.1 Server entry point

```
web/
  src/
    server.ts          # Express + WebSocket server
    bridge.ts          # TCP ↔ WebSocket bridge logic
    auth.ts            # Login REST endpoint
    session.ts         # Session middleware
  public/
    index.html
    bundle.js          # Built by Vite
    bundle.css
  package.json
  tsconfig.json
  vite.config.ts
```

### 5.2 Bridge logic (`bridge.ts`)

The core of the proxy is a bidirectional pipe:

```
Browser  ──WebSocket (binary frames)──►  Node.js proxy  ──TCP socket──►  MUSH engine
Browser  ◄─WebSocket (binary frames)──  Node.js proxy  ◄─TCP socket──   MUSH engine
```

Key implementation points:

- WebSocket frames are passed as **binary** (`ws.binaryType = 'arraybuffer'`) to preserve ANSI escape bytes exactly.
- The Node.js `net.Socket` to the MUSH engine is opened **after** authentication succeeds (see Phase 2) to prevent unauthenticated TCP connections from occupying MUSH descriptors.
- On WebSocket close, the TCP socket is destroyed and vice-versa.
- A **heartbeat** (`ping`/`pong` at 30-second intervals) detects stale WebSocket connections.

```typescript
// Simplified shape of the bridge
async function createBridge(ws: WebSocket, username: string, password: string): Promise<void> {
    const tcp = net.createConnection({ host: MUSH_HOST, port: MUSH_PORT });

    tcp.on('data', (chunk) => ws.send(chunk));   // MUSH → browser
    ws.on('message', (data) => tcp.write(data)); // browser → MUSH

    // Send credentials after TCP connection is established
    tcp.once('connect', () => {
        tcp.write(`connect ${username} ${password}\r\n`);
    });

    tcp.on('close', () => ws.close());
    ws.on('close', () => tcp.destroy());
}
```

### 5.3 WebSocket endpoint

```
GET /ws   →  Upgrade: websocket
```

The WebSocket handshake verifies a session token set during the login flow (§6) before the bridge is created. This prevents anonymous WebSocket connections from consuming MUSH descriptors.

### 5.4 Terminal resize (NAWS equivalent)

When the browser window is resized, xterm.js reports the new dimensions. The web layer forwards them to the MUSH engine as a special framing message. Because the current engine uses raw TCP, the simplest approach is to send an IAC-NAWS (Telnet Negotiate About Window Size, RFC 1073) sequence over the TCP socket:

```
IAC SB NAWS <width-high> <width-low> <height-high> <height-low> IAC SE
0xFF 0xFA 0x1F hh ll hh ll 0xFF 0xF0
```

This requires verifying that `netcommon.c` already handles IAC NAWS negotiation; if not, it is a small addition and can be deferred (the terminal will work at a fixed width).

---

## 6. Phase 2 — Authentication Flow

### 6.1 Login sequence

```
Browser                    Node.js proxy                     MUSH engine
   │                            │                                 │
   │  POST /api/login           │                                 │
   │  { user, password }        │                                 │
   │───────────────────────────►│                                 │
   │                            │  open TCP connection            │
   │                            │────────────────────────────────►│
   │                            │  send: connect user pass\r\n    │
   │                            │────────────────────────────────►│
   │                            │  read response                  │
   │                            │◄────────────────────────────────│
   │                            │  (Connected. / FAILED / etc.)   │
   │                            │                                 │
   │  200 OK + session cookie   │  keep TCP alive in session map  │
   │◄───────────────────────────│                                 │
   │                            │                                 │
   │  WS GET /ws                │                                 │
   │  Cookie: session=...       │                                 │
   │───────────────────────────►│                                 │
   │                            │  retrieve TCP socket from map   │
   │◄──────────── WebSocket established ──────────────────────────│
   │  (bridge active — full duplex)                               │
```

### 6.2 Session management

- After a successful `connect` the proxy stores the **live TCP socket** keyed by session ID in a `Map<sessionId, net.Socket>`.
- The session cookie is `HttpOnly`, `SameSite=Strict`, `Secure` (in production).
- On logout (`POST /api/logout`) or session expiry the TCP socket is closed and the map entry removed.
- `SESSION_SECRET` is injected from the environment (never hardcoded).

### 6.3 Security notes

- Credentials are **never logged** in the proxy layer.
- The REST endpoint rate-limits login attempts (e.g. 5 tries per minute per IP) using `express-rate-limit` to prevent brute-force attacks against MUSH accounts.
- The `connect` command includes the password; the TCP connection is on a Docker-internal network only, so the password is never exposed over a public network in plaintext.

---

## 7. Phase 3 — Frontend TUI (xterm.js + Split Panels)

### 7.1 Layout

```
┌──────────────────────────────────────────────────────────┐
│  ╔═══════════════════════════════╤════════════════════╗  │
│  ║                               │  ┌──────────────┐  ║  │
│  ║                               │  │  WHO List    │  ║  │
│  ║   xterm.js terminal           │  │  (panel)     │  ║  │
│  ║   (main game output)          ├──┤──────────────┤  ║  │
│  ║                               │  │  Room/Loc    │  ║  │
│  ║                               │  │  (panel)     │  ║  │
│  ╠═══════════════════════════════╧════════════════════╣  │
│  ║  cmd input ▌                             [Send]   ║  │
│  ╚══════════════════════════════════════════════════╝  │
└──────────────────────────────────────────────────────────┘
```

- The vertical split between terminal and side panels is draggable (using `split.js`).
- The terminal pane fills its container height; `xterm-addon-fit` propagates a resize event when the pane is dragged.
- The input bar at the bottom is an HTML `<input>` — this keeps mobile keyboards functional and allows browser-native accessibility (screen readers, autocomplete).

### 7.2 xterm.js configuration

```typescript
const term = new Terminal({
    fontFamily: '"Cascadia Code", "Fira Code", "DejaVu Sans Mono", monospace',
    fontSize: 14,
    theme: {
        background: '#0d0d0d',
        foreground: '#c0c0c0',
        // Full 256-color + true-color support
    },
    allowProposedApi: true,
    cursorBlink: true,
    convertEol: true,  // \n → \r\n so MUSH line endings render correctly
});

term.loadAddon(new Unicode11Addon());
term.loadAddon(new FitAddon());
term.loadAddon(new WebLinksAddon());
term.unicode.activeVersion = '11';  // Enable Box Drawing, etc.
```

### 7.3 Input handling

The input bar is separate from xterm to prevent raw keystroke capture issues on mobile. Pressing Enter (or the Send button) appends `\r\n` and writes to the WebSocket. The input bar also maintains a local history buffer (`↑`/`↓`) and a tab-completion hook (Phase 4+ enhancement).

### 7.4 Font choice and box-drawing

For proper box-drawing and ANSI art, the font must be a **monospace Nerd Font** variant or equivalent. A WOFF2 font (e.g. `Cascadia Code NF`) should be bundled in the web layer's `public/fonts/` directory and declared in CSS `@font-face` so players do not depend on local font availability. This guarantees uniform rendering.

---

## 8. Phase 4 — Structured Panel Data

Side panels (WHO list, current room) need structured data. There are two approaches:

### Option A — Parse MUSH output in the proxy (no C changes required)

The proxy watches the MUSH output stream for certain patterns and emits JSON "side-channel" WebSocket messages to the browser alongside the raw terminal bytes. Example: detect the `WHO` command output format and parse it into a JSON array.

**Pros:** No engine changes.  
**Cons:** Brittle — any change to the WHO output format breaks parsing; limited to output that the player explicitly triggers.

### Option B — Dedicated web-API command channel (recommended, see Phase 6)

A TinyMUSH module establishes a second, dedicated TCP port (e.g. 6251) that accepts simple line-delimited JSON requests and returns JSON responses. The proxy polls this port periodically for panel data.

**Pros:** Clean contract; data is fresh even without user action; future-proof.  
**Cons:** Requires a small amount of C code (the module in Phase 6).

### Phase 4 delivery (pragmatic approach)

**Phase 4a** delivers Option A for the WHO list panel only — parse the existing `DOING` command output. This provides immediate visible value without C changes.

**Phase 4b** (after Phase 6 module is implemented) migrates panels to Option B.

---

## 9. Phase 5 — TLS and Production Hardening

### 9.1 Caddy reverse proxy (recommended)

Add a `caddy` service to `docker-compose.yml`:

```yaml
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./docker/caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    networks:
      - web-net
    depends_on:
      - tinymush-web
```

**`Caddyfile`:**
```
{$CADDY_DOMAIN} {
    tls {$CADDY_EMAIL}
    reverse_proxy tinymush-web:3000
}
```

Caddy handles automatic HTTPS certificate provisioning via Let's Encrypt. No manual cert management needed.

### 9.2 Security checklist for production

| Item | Action |
|------|--------|
| `SESSION_SECRET` | ≥ 64 random bytes, set in `.env` (never committed) |
| CORS | Restricted to `CADDY_DOMAIN` in Express |
| Rate limiting | `express-rate-limit` on `/api/login` — 5 attempts / minute per IP |
| HTTP headers | `helmet` middleware: CSP, X-Frame-Options, HSTS |
| WebSocket origin check | Reject upgrades where `Origin` !== allowed domain |
| Container isolation | `tinymush-net` is `internal: true`; game port never reachable from host |
| No root processes | Both containers run as non-root users (USER directive in Dockerfiles) |
| Secrets | Only via environment variables or Docker secrets — never baked into images |

### 9.3 Log rotation

Add a `logging` section to each service in `docker-compose.yml`:

```yaml
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "5"
```

---

## 10. Phase 6 — Optional TinyMUSH Web-API Module

This phase adds a new TinyMUSH module (`src/modules/webapi/`) that exposes a **read-only, internal-only JSON API** so side panels can display rich, structured game data.

### 10.1 Module responsibilities

- Open a second TCP port (configurable, default 6251) that only listens on the loopback / Docker-internal interface.
- Accept line-delimited JSON requests (no auth — it is reachable only from the proxy container on the internal network).
- Return JSON responses for queries like:
  - `{"action":"who"}` → list of connected players with idle time, location, doing string
  - `{"action":"loc","player":"Wizard"}` → player's current room and obvious exits
  - `{"action":"status"}` → server uptime, player count

### 10.2 Module layout (following project conventions)

```
src/modules/webapi/
  CMakeLists.txt
  webapi.c          # Module init/shutdown; TCP server on port 6251
  webapi_query.c    # JSON request handlers
  webapi_json.c     # Minimal JSON serialisation helpers
```

Follows the structure of `src/modules/skeleton/` as documented in `docs/Code/MODULES_DEVELOPMENT.md`.

### 10.3 Security note

Port 6251 must be:
- Bound to `127.0.0.1` (loopback) only, or to the Docker bridge interface, never `0.0.0.0`.
- Not listed in `docker-compose.yml` `ports:` — it is only accessible on `tinymush-net`.
- Return only non-sensitive data (no passwords, no hidden attributes).

---

## 11. Repository Layout Changes

```
TinyMUSH/
  docker/                         ← NEW
    Dockerfile.game
    Dockerfile.web
    Dockerfile.web.dev
    caddy/
      Caddyfile
    nginx/
      tinymush.conf               (alternative to Caddy)
  web/                            ← NEW
    src/
      server.ts
      bridge.ts
      auth.ts
      session.ts
    public/
      index.html
      fonts/
        CascadiaCodeNF.woff2
    package.json
    tsconfig.json
    vite.config.ts
  src/
    modules/
      webapi/                     ← NEW (Phase 6)
        CMakeLists.txt
        webapi.c
        webapi_query.c
        webapi_json.c
  docker-compose.yml              ← NEW
  docker-compose.dev.yml          ← NEW
  .env.example                    ← NEW
```

The existing `src/netmush/`, `game/`, and `scripts/` directories are **unchanged** for Phases 0–5.

---

## 12. Milestone Summary

| Phase | Deliverable | Engine changes? | Effort |
|-------|-------------|-----------------|--------|
| 0 | Docker Compose with game container and persistent volumes | No | Small |
| 1 | Node.js WebSocket proxy bridging to internal telnet port | No | Medium |
| 2 | Login flow (POST /api/login + session cookie + WS auth) | No | Small |
| 3 | xterm.js SPA with UTF-8, ANSI color, split-pane layout, input bar | No | Medium |
| 4a | WHO panel via output parsing | No | Small |
| 5 | Caddy TLS, helmet, rate-limiting, production hardening | No | Small |
| 4b | Panels via JSON API (migrates from parsing) | Yes (module) | Medium |
| 6 | `webapi` module — JSON query port for structured data | Yes (module) | Large |

**Recommended order:** 0 → 1 → 2 → 3 → 5 → 4a → 6 → 4b

---

## 13. Open Questions / Future Work

| Topic | Notes |
|-------|-------|
| `--no-fork` flag | Verify whether the MUSH engine has a config option or flag to disable double-forking so Docker can manage PID 1, or add a wrapper script (`exec netmush`). |
| NAWS negotiation | Check `netcommon.c` for IAC NAWS handling; add it if missing (small patch). |
| Terminal width defaults | Until NAWS is confirmed, default to 80×24. |
| Mobile support | Input bar works on mobile; xterm.js scroll works but the split-panel layout needs a responsive breakpoint (collapse side panel on narrow screens). |
| Reconnect / session resume | When the browser tab is reopened, the WebSocket drops but the MUSH TCP connection could stay alive. A reconnect token could map a new WebSocket to the still-open TCP connection (requires server-side session pinning). |
| GUEST accounts | The `connect guest` flow is identical to regular auth; the proxy just passes the credentials through. |
| Colour scheme configurability | Expose the xterm.js theme as a user preference stored in `localStorage`. |
| IRC / Discord bridge | Out of scope for this plan but the JSON API (Phase 6) makes it feasible in future. |
