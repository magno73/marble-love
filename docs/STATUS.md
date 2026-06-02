# Status & Parity Matrix

This page makes the README's "many low-level routines are parity-tested" claim
concrete and checkable. Every row links to evidence and a command you can run.

**What "parity" means here.** Marble Love is a *source-level* reimplementation:
each routine is ported function-by-function from the 68010 program ROM and
checked against MAME (and Musashi for focused 68010 subroutines) as the oracle.
"Bit-perfect" below means the reimplemented routine reproduces the original's
observable bytes/state at the verified points; it does **not** mean
cycle-accurate emulation. See [docs/cpu-config.md](cpu-config.md) for the model
choice.

Most ROM-backed tests require a local MAME program ROM at
`ghidra_project/marble_program.bin` (gitignored, not distributed); without it
those suites skip themselves. See the README "Validation" section.

## Parity matrix

| Subsystem | Claim | Evidence | Verify |
|---|---|---|---|
| Slapstic 137412-103 bank FSM | Bit-perfect, including an **undocumented 68010-prefetch side-channel** we discovered | [finding](findings/slapstic-prefetch-side-channel.md); `slapstic-103.test.ts` (12/12) | `npx vitest run packages/engine/test/slapstic-103.test.ts` |
| 68010 helper routines (function-by-function) | Behavioral parity vs MAME / Musashi oracle | ~2340-test engine suite (1 known failure: L5 birds, see gaps) + 267 `packages/cli/src/test-*-parity.ts` runners | `npx vitest run packages/engine` (needs a local ROM) |
| Trackball input apply + clamp | Behavioral parity | `trackball-apply.test.ts` (4/4), `trackball-input.test.ts` (5/5), `trackball-clamp-flags-28468.test.ts` (6/6) | `npx vitest run packages/engine/test/trackball-apply.test.ts packages/engine/test/trackball-input.test.ts` |
| Slope / waypoint attractor (FUN_1815A) | Behavioral parity | `waypoint-list-step-1815a.test.ts` (7/7) | `npx vitest run packages/engine/test/waypoint-list-step-1815a.test.ts` |
| Per-level gameplay sound-command selection | Verified selectors per race | `sound-gameplay-profile.test.ts` (6/6) | `npx vitest run packages/web/test/sound-gameplay-profile.test.ts` |
| YM2151 / POKEY chip writes | Behavioral chip models (register/envelope level; unit-tested) | `ym2151.test.ts` (35/35), `pokey.test.ts` (20/20) | `npx vitest run packages/engine/test/ym2151.test.ts packages/engine/test/pokey.test.ts` |
| PCM audio (game-wide) | Recognizable, **not** sample-level bit-perfect | README "Known Limitations"; `audio-resample.test.ts` (8/8) | `npx vitest run packages/engine/test/audio-resample.test.ts` |
| 68010 cycle timing | **Heuristic**, table-driven (not cycle-accurate) | `packages/engine/src/m68k/sub-cycle-costs.ts`; `m68k-cycle-table.test.ts` (21/21) | `npx vitest run packages/engine/test/m68k-cycle-table.test.ts` |
| Tom Harte 68000 CPU fixtures | Reference data only — **not** run by the engine suite | `oracle/tom_harte_m68000/` | n/a (reference) |

Test counts are from a run on 2026-06-02 with a local ROM present; the commands
reproduce them.

## Declared non-goals

- **Not** a cycle-accurate 68010 emulator (timing is a documented heuristic).
- **Not** game-wide bit-perfect PCM audio (event ordering and chip writes are
  modeled; raw PCM is recognizable, not sample-exact).
- **Not** a MAME replacement — MAME is the oracle, not the target to replace.

## Known gaps

The single source of truth is the README, to avoid drift:

- [Known Limitations](../README.md#known-limitations)
- [Known Gameplay Bugs](../README.md#known-gameplay-bugs)

Highlights relevant to the matrix: the L5 Silly Race flying-bird motion objects
are not rendered yet (the one failing engine test, skipped on the ROM-less CI
subset); attract-mode music and insert-coin sound are still active work; PCM
audio is not globally bit-perfect.

## How to verify a claim

Each matrix row's "Verify" command runs the cited test(s). The ROM-backed rows
need a legal dump at `ghidra_project/marble_program.bin`; without it the suite
skips those tests rather than failing.
