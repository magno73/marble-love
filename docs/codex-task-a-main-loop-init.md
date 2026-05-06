# Codex Task A — Main Loop Init Chain

Branch: `codex/a-main-loop-init-117b2`

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
- parity scripts still need expansion for the long `FUN_10504` presentation loops before this can be called full PRD-complete
