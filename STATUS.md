# STATUS

Compact operating context. Historical status copies live in
`docs/archive/status/`; task-specific detail belongs in `GOAL.md`.

## Product State

Marble Love is playable in the browser with local ROMs. The promoted live path
starts from cold ROM-backed boot, accepts runtime coin/start, enters L1,
progresses level-by-level, and preserves true-start seed diagnostics.

Default runtime URL: `http://localhost:5173/?autoLoad=1&play=1`

Useful diagnostics:

- `?autoLoad=1&bootFlow=1&debugState=1&sound=0`
- `?autoLoad=1&coinStart=1`
- `?autoLoad=1&startLevel=N`
- `?soundReplay=...`
- `?sound=1`

## Paused Audio Goal

`GOAL.md` is authoritative for audio bit-perfect work.

- Audio is not bit-perfect.
- Promoted baseline: `inject001f-1701-commandedge`, `secs/attos` timing.
- Green enough for promoted baseline: YM/POKEY ordered writes at `+-1`;
  audible PCM worst corr about `0.99657`.
- Open strict gates: YM `5100/51163`, POKEY `6446/27198` mismatches at `0`.
- Current blocker: frame `1500` first YM Timer A IRQ is recognized too early in
  TS. TS asserts the IRQ during the branch into `0x8100` and vectors after
  `CLI` with saved PC `0x8101`; MAME vectors later with saved PC `0x810b`.
- Current clue: frame-specific NMI override `1500:0x03:624:0` preserves the
  global `+-1` gate and moves the local first IRQ to `pc=0x8108`. Adding the
  diagnostic `--ym-irq-new-assertion-instruction-delay 1` reaches local
  `pc=0x810b`, but needs seven narrow command-edge rules to keep the
  1701-frame gate green. Candidate preset
  `inject001f-1701-yminstr1-commandedge` now reproduces YM/POKEY `+-1` PASS
  with raw bus parity green. Strict `0` is mixed: YM worsens to `6929/51163`,
  POKEY improves to `4331/27198`; PCM still passes the promoted MAME WAV gate
  at lag `0`, worst corr `0.9966`, RMS `0.00553`, maxAbs `0.04140`.
- Current YM strict `0` evidence points at native-sample/apply timing rather
  than bus ordering: raw bus offset parity is exact, and global sample-phase
  sweep only improves `5100` mismatches to `5037`. The new per-PC offset sweep
  reports `0c` as best for each top YM strict cluster, so static per-PC event
  offsets are a dead end.
- Current POKEY strict `0` evidence points at MAME scheduler/stream cursor
  timing. PC/register/write-effect buckets are mixed; the next useful model is
  `sync_write` plus `sound_stream::update()`, not another static offset guard.

## Guardrails

- Worktree is dirty and includes unrelated/parallel edits.
- Preserve changes you did not make.
- Do not touch gameplay, terrain, renderer, route, seed, collision, or
  boot-flow for audio diagnostics.
- Avoid `packages/web/src/main.ts` unless touching an isolated audio block is
  unavoidable.
- Keep large scratch output under `/tmp/marble-love/<task>/` or archive notes.

## Validation Router

```sh
npx tsc -p packages/engine/tsconfig.json --noEmit
npx tsc -p packages/web/tsconfig.json --noEmit
npx tsc -p packages/cli/tsconfig.json --noEmit
npx vitest run packages/engine/test/sound-chip-smoke.test.ts packages/engine/test/ym2151.test.ts packages/engine/test/pokey.test.ts packages/web/test/sound-renderer.test.ts --silent
npm --workspace @marble-love/web run build
git diff --check
git status --short --branch
```
