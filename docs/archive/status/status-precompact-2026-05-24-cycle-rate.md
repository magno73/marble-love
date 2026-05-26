# STATUS

Compact operating context. Historical status copies are archived in
`docs/archive/status/` and `docs/archive/readme-status-2026-05-18/`.

## Product State

Marble Love is playable in the browser with local ROMs. The promoted live path
starts from cold ROM-backed boot, accepts runtime coin/start, enters L1,
progresses level-by-level, and preserves true-start seed diagnostics.

Default runtime URL:

```text
http://localhost:5173/?autoLoad=1&play=1
```

Useful diagnostics:

- `?autoLoad=1&bootFlow=1&debugState=1&sound=0`: explicit no-seed boot flow.
- `?autoLoad=1&coinStart=1`: legacy seed-backed coin/start fallback.
- `?autoLoad=1&startLevel=N`: true-start seed for level `1..6`.
- `?autoLoad=1&playableSeed=NAME&play=1`: explicit seed diagnostic.
- `?soundReplay=...`: deterministic audio oracle workbench.
- `?sound=1`: normal gameplay audio path.

## Active Audio Work

Active goal: audio parity against MAME on deterministic `soundReplay`/cmd-tape
first. `GOAL.md` is the authoritative startup checkpoint.

Short truth:

- Not bit-perfect.
- Promoted preset: `inject001f-1701-commandedge`.
- YM/POKEY ordered writes are green at native-sample tolerance `+-1`.
- Audible PCM windows are threshold-green with worst correlation about
  `0.99657`.
- Strict native-sample tolerance `0` remains open: YM `5100`, POKEY `6446`.
- POKEY raw bus parity is already green; remaining POKEY work is effective
  apply/audio timing, not bus timing.
- Global replay-vs-direct POKEY raw trace now compares `17286` transitions with
  `0` raw mismatches; after removing the absolute origin offset, `17067`
  transitions have cycle residual `0`. The remaining output spread points at
  resampler/mixer phase rather than wrong raw POKEY state.
- A lofi block-position projection was checked and rejected as a promotion
  target: `s2` output delta is worse (`{-1:3420,0:12712,1:1144,2:10}`) than
  the simple estimate.

Next audio move: preserve the same-run oracle, keep replay-vs-direct PCM gates
green, and inspect actual PCM residual around matched POKEY raw transitions plus
MAME final mix/quantization before promoting any timing change.

## Gameplay Baseline

- `play=1` is the promoted no-seed default path.
- Runtime coin/start, L1 entry, level progression, and high-score initials are
  implemented.
- `startLevel=1..6`, `playableSeed=NAME`, and `coinStart=1` remain
  diagnostics/fallbacks, not the default path.
- Level timer rule: `timer after banner = previous carryover + new level bonus`.

Do not use audio diagnostics to justify gameplay, terrain, renderer, route, or
seed changes.

## Guardrails

- The worktree is dirty and includes unrelated/parallel edits.
- Preserve changes you did not make.
- Avoid `packages/web/src/main.ts` unless touching an isolated audio block is
  unavoidable.
- Keep large probes, MAME captures, screenshots, traces, and scratch JSON out of
  startup docs; use `/tmp/marble-love/<task>/` or `docs/archive/`.
- Old diagnostics can be stale. Rebuild or pair MAME proof before changing
  behavior.

## Validation Commands

```sh
npx tsc -p packages/engine/tsconfig.json --noEmit
npx tsc -p packages/web/tsconfig.json --noEmit
npx tsc -p packages/cli/tsconfig.json --noEmit
npx vitest run packages/engine/test/sound-chip-smoke.test.ts packages/engine/test/ym2151.test.ts packages/engine/test/pokey.test.ts packages/web/test/sound-renderer.test.ts --silent
npm --workspace @marble-love/web run build
git diff --check
git status --short --branch
```
