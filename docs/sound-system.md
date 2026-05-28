# Sound System

Marble Love contains a TypeScript sound path for the original Marble Madness
audio architecture.

## Hardware Topology

- Main CPU: 68010.
- Sound CPU: 6502A.
- Music chip: YM2151.
- Effects/noise chip: POKEY.
- Main CPU writes sound commands through the sound latch.
- The 6502 reads commands, drives YM2151/POKEY registers, and can send responses
  back to the main CPU.

## Runtime Paths

There are two intentionally separate browser audio paths:

- `?soundReplay=...`: deterministic oracle replay from command tapes. This is
  the primary path for chip-write and PCM parity work.
- `?sound=1`: live gameplay audio. This uses commands emitted by the TypeScript
  gameplay path and must not mutate `GameState`.

Synthetic cue or beep helpers are debug-only and should not be part of normal
gameplay audio.

## Current Status

Implemented pieces include the 6502 sound CPU memory map, sound command latch,
YM2151 model, POKEY model, command-tape replay, chip-write diff tooling, PCM
window diff tooling, and browser PCM plumbing.

The current oracle work has achieved ordered YM2151/POKEY event parity for the
canonical replay preset, and the PCM comparison is very close on audible
windows. This should not be marketed as complete game-wide bit-perfect audio:
live gameplay wiring and strict PCM exactness remain ongoing work.

Detailed diagnostic history, artifact paths, and rejected timing experiments are
kept in `docs/internal/technical/sound-system.md` and `docs/archive/`.
