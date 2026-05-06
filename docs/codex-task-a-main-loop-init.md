# Codex Task A — Main Loop Init Chain

Branch: `codex/a-main-loop-init-parity`

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
- parity scripts still need expansion for `FUN_1101E` and for the long `FUN_10504` presentation loops before this can be called full PRD-complete

Fixes from parity:

- `FUN_117B2` does call `FUN_13A98(0x100)` but does not store D0 to `0x400444`; the TS replica now treats it as callback-only.
- The `cmpi.b #8, 0x4003B4` branch is signed byte semantics, not unsigned byte `> 8`.
