# GitHub Copilot Instructions for TinyMUSH

TinyMUSH is a MUD game engine written in C. Primary source: `src/netmush/`. Extension modules: `src/modules/`.

## Build & Run

```bash
# Build (stops any running server, reconfigures CMake, compiles, restarts)
./rebuild.sh

# Run — MUST be from the game/ directory
cd game && ./netmush          # forks to background
cd game && ./netmush -d       # debug/foreground (use with gdb)
```

> **Pitfall**: `netmush` resolves config/db paths relative to its working directory. Running it from `build/` or `src/` will fail silently.

### Regression tests

Requires a running server. Credentials come from environment variables:

```bash
export TINY_USER=Wizard TINY_PASS=secret
python3 scripts/regression_test.py --config scripts/commands_messaging.conf
```

Config files for individual feature areas live in `scripts/*.conf`.

## Naming Conventions

| Scope | Pattern | Example |
|-------|---------|---------|
| Public function | `{module}_{action}_{target}` | `bsd_conn_new()` |
| Static/internal function | `_{module}_{action}_{target}` | `_boolexp_check_attr()` |
| Macro / constant | `UPPER_SNAKE_CASE` | `XMALLOC` |
| Source file | `{module}_{component}.c` | `bsd_connection.c` |

Never use camelCase. Headers use `#pragma once`, never traditional include guards.

## Code Style

- **Indentation**: tabs
- **Braces**: opening brace on the same line as the statement
- **Line length**: 120 chars max
- **Comments**: `/* */` for all code comments; `/** */` only for Doxygen — never `//`
- **Comment placement**: above the block it describes; inline (end-of-line) for single-statement notes; `case X: /* description */` inside switch
- **Memory**: `XMALLOC` / `XCALLOC` / `XFREE` — never raw `malloc` / `free`; see [ALLOC_DOCUMENTATION.md](docs/Code/ALLOC_DOCUMENTATION.md)
- **Error reporting**: `log_perror()` for system errors, `log_write()` for application events; never silently discard return values
- **Globals**: defined once in `.c`, declared `extern` in `externs.h` — no duplicate declarations across files
- **Shared headers** in `src/netmush/`: `constants.h`, `externs.h`, `macros.h`, `prototypes.h`, `typedefs.h` — update `prototypes.h` whenever you add or remove a public function

Every public function requires a Doxygen block: `@brief`, `@param`, `@return`, `@note Thread-safe: Yes/No`.

## Architecture

Reference implementations to study before adding new modules:

- **Networking** — `src/netmush/bsd_*.c`: six focused files (connection, socket, I/O, DNS, signals, main)
- **Bool expression** — `src/netmush/boolexp*.c`: split into parse / eval / memory / internal helpers
- **Extension module template** — `src/modules/skeleton/`; full guide: [MODULES_DEVELOPMENT.md](docs/Code/MODULES_DEVELOPMENT.md)
- **Command & function registries** — [COMMANDS_AND_REGISTRIES_REFERENCE.md](docs/Code/COMMANDS_AND_REGISTRIES_REFERENCE.md)

Key design rules: one responsibility per file, public API surface kept minimal, internal helpers marked `static` with a leading `_`.

## Commit Messages

```
Type: Brief description (≤50 chars)

Why this change was needed and what problem it solves.
```

Types: `Refactor` | `Fix` | `Feature` | `Clean` | `Docs` | `Test`

## Further Reading

| Topic | File |
|-------|------|
| Contributing workflow / PR process | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Memory subsystem internals | [docs/Code/ALLOC_DOCUMENTATION.md](docs/Code/ALLOC_DOCUMENTATION.md) |
| Command & function registry layout | [docs/Code/COMMANDS_AND_REGISTRIES_REFERENCE.md](docs/Code/COMMANDS_AND_REGISTRIES_REFERENCE.md) |
| Writing extension modules | [docs/Code/MODULES_DEVELOPMENT.md](docs/Code/MODULES_DEVELOPMENT.md) |
