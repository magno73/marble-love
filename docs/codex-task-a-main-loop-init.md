# Codex Task A — Main Loop Init Chain

Branch: `codex/a-10504-middle-parity`

Scope follows `docs/codex-prd.md` Task A and non-interference rules:

- new engine modules only, plus one safe export line in `packages/engine/src/index.ts`
- no edits to `main-tick.ts`, `boot-init.ts`, `README.md`, or `STATUS.md`
- branch/worktree isolated from `main`

Implemented slice:

- `main-loop-init-117b2.ts`: bootstrap writes and one bounded loop-body runner for the original infinite loop.
- `main-loop-init-1101e.ts`: state dispatcher cases 0..6 with callback injection for non-replicated JSRs.
- `main-loop-init-11452.ts`: transition dispatcher cases 0..3, ROM table read at `0x1D364`, and tail finalizer callback.
- `main-loop-init-10504.ts`: deterministic init prefix, key state-dependent setup calls, object normalization tail, and stub-injectable presentation middle marker.

Verification plan:

- smoke/unit tests cover direct RAM writes, callback order, ROM pointer reads, and key branch transitions
- `packages/cli/src/test-main-loop-init-117b2-parity.ts`: 500/500 with one-loop binary patch and JSR sentinel stubs
- `packages/cli/src/test-main-loop-init-11452-parity.ts`: 500/500 across dispatcher states 0..3 with JSR sentinel stubs
- `packages/cli/src/test-main-loop-init-1101e-parity.ts`: 500/500 across dispatcher states 0..6 with JSR sentinel stubs and deterministic D0 thunks
- `packages/cli/src/test-main-loop-init-10504-parity.ts`: 500/500 scoped direct-workRam parity with downstream JSRs patched to `rts`/deterministic D0 thunks
- `FUN_10504` presentation loop is still partially stubbed: the parity intentionally excludes middle-only object text animation field `0x400082` (`object[0].+0x6A`) because full replication requires the HUD/render loop around `FUN_286EE`, `FUN_28EB2`, and waits.

Fixes from parity:

- `FUN_117B2` does call `FUN_13A98(0x100)` but does not store D0 to `0x400444`; the TS replica now treats it as callback-only.
- The `cmpi.b #8, 0x4003B4` branch is signed byte semantics, not unsigned byte `> 8`.
- `FUN_1101E` jump table order is `0,1,3,4,2,5,6` in the earlier helper naming: ROM state 2 enters the player/setup block, state 3 enters level increment/init, state 4 enters the small vblank/input block.
- `FUN_1101E` compares the transition timer against word `0xFFFF`, not byte-like `0x00FF`.
- The state-3 level increment path calls `FUN_12186` but not `FUN_12174`, and clears `0x400390` after `FUN_10504` when the incremented level is `<=5`.
- `FUN_10504` deterministic prefix calls `FUN_0142` twice for the first player text setup, plus two more calls when `playerCount == 2`.
- `FUN_10504` middle header path (`0x400390 != 1`) issues three additional `FUN_0142` presentation renders before the long HUD loop; these are modeled as callback hooks.
