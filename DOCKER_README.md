# Docker Setup & Usage

TinyMUSH uses Docker Compose to orchestrate three services: a game engine, a web UI, and an optional reverse proxy.

## Services

| Service | Purpose | Network | Exposed (default) |
|---------|---------|---------|-------------------|
| `tinymush` | Game engine (C) | Internal only | No |
| `tinymush-web` | WebSocket proxy + frontend SPA (Node.js) | Internal + web | Port 3000 |
| `caddy` | TLS reverse proxy (Let's Encrypt) | Web only | Ports 80, 443 |

## Local Development

For local development, use the **default** compose setup:

```bash
docker compose up --build
```

This starts:
- `tinymush` — game engine on internal network
- `tinymush-web` — web UI on **http://localhost:3000**

Caddy is **disabled by default** because:
- Let's Encrypt certificate provisioning requires a public domain
- Ports 80/443 may require elevated privileges
- Local development uses direct access to the web container

## Production Deployment

To enable Caddy for production with TLS:

```bash
docker compose --profile production up --build
```

This additionally starts:
- `caddy` — reverse proxy on ports 80/443
  - Automatically obtains TLS certificate for `${CADDY_DOMAIN}` via Let's Encrypt
  - Requires `CADDY_DOMAIN` and `CADDY_EMAIL` in `.env`

## Configuration

Required environment variables in `.env`:

```bash
SESSION_SECRET=<64+ random hex bytes>      # Session cookie signing key
CADDY_DOMAIN=mush.example.com              # Public domain (production only)
CADDY_EMAIL=admin@example.com              # ACME contact email (production only)
```

Generate `SESSION_SECRET` with:
```bash
openssl rand -hex 64
```

## Networking

- **tinymush-net** — internal bridge (game engine only, isolated from host)
- **web-net** — bridge (web container + Caddy; reachable by host)

The game engine is never directly exposed to the host network in production.

## Volumes

- `mush-db` — game database (LMDB)
- `mush-logs` — game logs
- `mush-backups` — game backups
- `caddy-data` — TLS certificates and ACME state
- `caddy-config` — Caddy configuration

## Development Overrides

For local development with hot-reload and direct config editing:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

This additional overrides:
- Exposes Telnet port 6250 for direct debugging
- Mounts game configs read-write for live editing
- Uses `Dockerfile.web.dev` (tsx watch + Vite hot-reload)
- Disables Caddy

## Health Checks

The `tinymush-web` service depends on `tinymush` passing its health check:
```bash
nc -z localhost 6250  # Netcat connectivity check
```

This ensures the game engine is ready before the web layer starts.

## Logs

View container logs:
```bash
# All services
docker compose logs -f

# Single service
docker compose logs -f tinymush-web

# Last 50 lines
docker compose logs --tail 50 tinymush
```

## Cleanup

Stop and remove containers:
```bash
docker compose down              # Keep volumes
docker compose down -v           # Remove volumes too
```

## Troubleshooting

### "Cannot open shared object file" — Module loading failures

**Symptom**: Logs show `module: Loading of /game/modules/libmail.so failed`

**Cause**: Configuration files use absolute host paths (`/home/mike/git/TinyMUSH/game/...`) instead of container paths (`/game/...`).

**Fix**: Ensure all config files in `game/configs/` use container paths:
```bash
# ✓ Correct (container paths)
modules_home    /game/modules
log_home        /game/logs
database_home   /game/db

# ✗ Wrong (host paths)
modules_home    /home/mike/git/TinyMUSH/game/modules
```

### "Couldn't open file" — Missing docs/helpfiles

**Symptom**: `FIL/OPEN: Couldn't open file '/game/docs/connect.txt'`

**Cause**: Modules, docs, or scripts directories not mounted in Docker container.

**Fix**: Ensure volume mounts are configured in `docker-compose.yml`:
```yaml
volumes:
  - ./game/modules:/game/modules:ro
  - ./game/docs:/game/docs:ro
  - ./game/scripts:/game/scripts:ro
  - ./game/configs:/game/configs:ro
```

### "Cannot create directory" — Database/logs permissions

**Symptom**: `lmdb_init: cannot create directory /game/db/netmush.db.lmdb`

**Cause**: Named volumes or mounted directories lack write permissions for the `mush` user (UID 1000).

**Fix**: Verify volume permissions:
```bash
# Check volume ownership
docker volume inspect tinymush_mush-db

# Rebuild containers if volumes are corrupted
docker compose down -v
docker compose up --build
```

### Connection refused on localhost:3000

**Symptom**: Cannot connect to web UI on `http://localhost:3000`

**Cause**: Using production compose without dev overrides, or Vite dev server not started.

**Fix**: For development, use:
```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

### "can't open /game/docs/*.indx for writing" — Helpfile index creation

**Symptom**: `HLP/INDX: can't open /game/docs/help.indx for writing`

**Cause**: Docs directory mounted as read-only, but helpfile indexing requires write access.

**Fix**: Ensure `/game/docs` is mounted **writable** (without `:ro` flag) in `docker-compose.yml`:
```yaml
volumes:
  - ./game/docs:/game/docs      # ✓ writable
  - ./game/docs:/game/docs:ro   # ✗ read-only
```

### "version `GLIBC_2.38' not found" — Module binary incompatibility

**Symptom**: `module: Loading of /game/modules/libmail.so failed: /lib/x86_64-linux-gnu/libc.so.6: version 'GLIBC_2.38' not found`

**Cause**: Modules compiled with GLIBC 2.38, but runtime container has older libc (e.g., from `debian:bookworm-slim`).

**Fix**: Update `docker/Dockerfile.game` runtime stage to use full `debian:bookworm` instead of `bookworm-slim`:
```dockerfile
# ✓ Correct
FROM debian:bookworm AS runtime

# ✗ Outdated
FROM debian:bookworm-slim AS runtime
```

Then rebuild:
```bash
docker compose down -v
docker compose up --build
```
