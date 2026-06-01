# Marble Love

Marble Love is a TypeScript reimplementation of Atari's *Marble Madness*
(1984). The project is built from ROM disassembly, Ghidra analysis, and
differential testing against MAME. It contains a browser frontend, a pure
TypeScript engine, command-line oracle/probe tools, and validation fixtures used
to compare reimplemented routines against the original arcade behavior.

No ROMs or copyrighted game assets are included. To run the browser version you
must provide your own legally obtained MAME ROM ZIPs.

## Current Status

Marble Love is a research-grade reimplementation, not a finished commercial
game. The browser path can boot from user-supplied ROMs, show the high-score /
insert-coin screen, accept coin/start input, enter live level 1 gameplay, and
progress through levels. The `startLevel=1..6` practice paths use verified MAME
start seeds for direct level testing.

Many low-level routines are parity-tested against MAME or Musashi-based oracle
runs. Rendering uses decoded ROM graphics in the browser. Gameplay music and
several event sounds are wired through the reimplemented 6502/YM2151/POKEY audio
path. Complete audio PCM parity, attract audio, and insert-coin audio remain
active work.

## What Works

- Browser frontend with PixiJS rendering.
- Local, in-browser loading of user-supplied MAME ROM ZIPs.
- ROM validation by expected file names, sizes, and CRC32 values.
- Cold boot/high-score/coin/start flow in the default `play=1` path.
- Live gameplay entry and level progression.
- Direct `startLevel=1..6` practice entry points.
- ROM-backed graphics decode for playfield, motion objects, alpha/HUD, and
  lookup tables.
- Differential/oracle tooling for MAME traces, seeds, rendering, audio events,
  and many 68010 helper routines.

## Known Limitations

- You must provide ROM ZIPs yourself; this repository does not distribute them.
- The project is still under heavy reverse-engineering development.
- Audio is recognizable in gameplay, but not globally bit-perfect.
- Gameplay audio is enabled by default, but the browser still requires a user
  gesture before Web Audio can start.
- Attract-mode music and insert-coin sound remain active work.
- The high-score / insert-coin screen still needs visual polish and a final
  behavior pass.
- Some CLI probes and oracle fixtures are intended for maintainers rather than
  casual users.
- Large JSON fixtures are checked in under `oracle/` because they support
  reproducible comparisons. Heavy gameplay snapshots are not part of the
  browser public asset path.

## Known Gameplay Bugs

These are current browser-gameplay issues, not original arcade behavior:

- Practice Race: a corrupt motion-object sprite can appear near the end of the
  level.
- Silly Race: the flying bird motion objects are not rendered yet.
- Silly Race: squashing the mini enemies awards bonus time correctly, but the
  marble can remain frozen for several seconds after the collision.
- Silly Race: the browser can become very slow on this level.
- The high-score / insert-coin screen still needs visual polish and a final
  behavior pass.
- A brief browser video flicker has been observed intermittently, but is not yet
  tied to a deterministic engine-state mismatch.

## Quick Start

Requirements:

- Node.js 22 or newer.
- npm.
- Legally obtained MAME ROM ZIPs for `marble` and the Atari System 1 BIOS files
  expected by MAME.

Install dependencies:

```sh
npm ci
```

Place your local ROM ZIPs where the dev server can serve them:

```text
packages/web/public/roms/marble.zip
packages/web/public/roms/atarisy1.zip
```

Start the web frontend:

```sh
npm --workspace @marble-love/web run dev -- --host 0.0.0.0
```

Open:

```text
http://localhost:5173/
```

In dev mode, the root URL auto-loads the local ROM ZIPs from
`packages/web/public/roms/` when they are present. Use `?rom=1` for the manual
ROM picker, or `?sound=0` to disable gameplay audio.

Controls:

- `5` or `C`: insert coin
- `Enter` or `Space`: start
- mouse, WASD, arrow keys, or gamepad: marble control
- first coin/start/click/touch starts Web Audio; the audio button is a fallback

Direct level entry:

```text
http://localhost:5173/?autoLoad=1&startLevel=1
http://localhost:5173/?autoLoad=1&startLevel=2
...
http://localhost:5173/?autoLoad=1&startLevel=6
```

## Validation

Common checks:

```sh
npm run typecheck
npx vitest run packages/web/test/coin-start-flow.test.ts packages/web/test/boot-flow-url.test.ts packages/web/test/sound-gameplay-profile.test.ts --silent
npm --workspace @marble-love/web run build
git diff --check
```

Full test suite:

```sh
npm test
```

The full suite is larger and includes many reverse-engineering/parity tests. Use
targeted tests while developing a specific subsystem, then run broader checks
before publishing changes.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `packages/engine` | Pure TypeScript engine, state model, runtime logic, renderer model, audio model, and unit tests. |
| `packages/web` | Vite/PixiJS frontend, local ROM loader, browser input, renderer, sound renderer, and web tests. |
| `packages/cli` | Probes, audits, route searches, oracle comparison tools, and parity runners. |
| `oracle` | MAME Lua scripts and oracle scenarios. |
| `harness` | Trace diff and reporting utilities. |
| `tools` | ROM prep, Ghidra-oriented utilities, and local support scripts. |
| `docs` | Public technical notes and the compact context map for maintainers. |

## Reverse-Engineering Method

The project uses several complementary sources of truth:

- Ghidra analysis of the original 68010 program ROM.
- MAME as the behavioral oracle for runtime state, rendering, input, and sound
  command traces.
- Musashi-based binary execution for focused 68010 subroutine comparisons.
- TypeScript unit tests and CLI probes that compare reimplemented routines to
  oracle output.

The goal is to build an understandable TypeScript implementation while keeping
behavior tied to reproducible evidence rather than visual guesswork.

## Legal

This repository contains original Marble Love source code under the MIT license.
It does not contain Marble Madness ROMs, extracted graphics, extracted audio, or
other copyrighted game assets.

*Marble Madness*, Atari, and related names/assets are the property of their
respective rights holders. This project is not affiliated with, sponsored by, or
endorsed by Atari or any current rights holder.

Users are responsible for obtaining their own legal ROM dumps. The browser ROM
loader reads ZIP files locally; ROM data is not uploaded by the application.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Third-Party Software And References

See [THIRD_PARTY.md](THIRD_PARTY.md).
