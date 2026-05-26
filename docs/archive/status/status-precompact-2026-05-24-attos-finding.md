# STATUS

This file is compact operating context. The verbose pre-compaction copy is:

- `docs/archive/status/status-precompact-2026-05-24.md`

Older boot-flow history remains in:

- `docs/archive/readme-status-2026-05-18/`

## Current Product State

Marble Love is playable in the browser with local ROMs. The default live path
starts from cold ROM-backed boot, accepts coin/start through runtime, enters L1,
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

## Active Work

Active goal: audio bit-perfect parity against MAME on deterministic
`soundReplay`/cmd-tape first. See `GOAL.md`.

Current audio truth:

- Promoted event gate is green at native-sample tolerance `+-1` for YM2151 and
  POKEY on the current deterministic oracle.
- PCM audible-window gate is green with worst correlation about `0.99657`.
- Exact native-sample timing is still open; this is not bit-perfect yet.
- A newer MAME oracle records `soundCmdReads`. The promoted `current` preset has
  POKEY `0` and YM `12` remaining tolerance-`+-1` mismatches there.
- Diagnostic preset `inject001f-1701-soundcmdreads-eventzero` closes ordered
  writes on the newer oracle with YM `0` and POKEY `0`, but PCM fails
  (`corr=0.9925`, `maxAbs=0.0997`), so it is not promoted.

Do not use audio diagnostics to justify gameplay, terrain, renderer, route, or
seed changes.

## Stable Gameplay Baseline

- `play=1` is the promoted no-seed default path.
- Runtime coin/start, L1 entry, level progression, and high-score initials are
  implemented.
- Level runtime content parity has user confirmation for the recent green-wave
  terrain follow-up: all green waves transport the marble, matching the MAME
  behavior observed by the user.
- `startLevel=1..6`, `playableSeed=NAME`, and `coinStart=1` must remain
  diagnostics/fallbacks, not the default path.

Level mapping:

| Level idx | Name | Descriptor | Seed | Bonus |
| --- | --- | --- | --- | --- |
| 0 | Practice | `0x2bee2` | `start_level1_intro_practice_f2479` | 60 |
| 1 | Beginner | `0x2c54c` | `start_level2_intro_beginner_f2436` | 60 |
| 2 | Intermediate | `0x2cd9e` | `start_level3_intro_intermediate_f2435` | 35 |
| 3 | Aerial | `0x2d648` | `start_level4_intro_aerial_f2414` | 30 |
| 4 | Silly | `0x2de1e` | `start_level5_intro_silly_f2472` | 20 |
| 5 | Ultimate | `0x2e790` | `start_level6_intro_ultimate_f2429` | 20 |

Timer rule:

```text
timer after banner = previous carryover + new level bonus
```

## Guardrails

- The worktree is dirty and includes unrelated/parallel edits. Preserve changes
  you did not make.
- Do not revert boot-flow, gameplay, collision, renderer, terrain, route, or
  seed behavior while working on audio.
- `packages/web/src/main.ts` is dirty/contended. Avoid it unless touching an
  isolated audio block is unavoidable.
- Keep large probes, MAME captures, screenshots, traces, and scratch JSON out of
  startup docs; use `/tmp/marble-love/<task>/` or `docs/archive/`.
- Old diagnostics can be stale. Rebuild the MAME proof before changing behavior.

## Validation

General validation:

```sh
npm run typecheck
npm run lint
npm run test --silent
npm run context:audit
git diff --check
git status --short --branch
```

Targeted typechecks:

```sh
npx tsc -p packages/engine/tsconfig.json --noEmit
npx tsc -p packages/web/tsconfig.json --noEmit
npx tsc -p packages/cli/tsconfig.json --noEmit
```

Audio checks:

```sh
npx vitest run packages/engine/test/sound-chip-smoke.test.ts packages/engine/test/ym2151.test.ts packages/engine/test/pokey.test.ts packages/web/test/sound-renderer.test.ts --silent
```
