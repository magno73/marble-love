# GOAL - Active Objective

This file is only for the current active task. Do not use it as historical
startup context. Long or closed goal notes belong in `docs/archive/goals/` or in
the task PRD checkpoint log.

## Active Goal

Boot-flow no-seed implementation.

Objective:

Implement Marble Love in phases so the normal live path can start from cold
ROM-backed boot, accept coin/start through runtime, enter L1, and progress
level-by-level without loading runtime level seeds.

Authoritative task plan:

- `docs/codex-task-boot-flow-no-seed.md`

Current phase:

- Phase 2: cold boot to stable attract.
- Phase 0 baseline/research is complete.
- Phase 1 gated `bootFlow=1` switch is committed and pushed as `9934721`
  (`feat: add gated cold boot flow flag`).
- Phase 2 research has started with compact TS-vs-MAME cold boot summaries.
- Existing seed diagnostics must remain intact: `startLevel=1..6` and
  `playableSeed=NAME`.

Next action:

1. Start Phase 2 with targeted cold-boot/early-attract research.
2. Compare TS `bootFlow=1` frame windows against a compact MAME/ROM-backed
   summary before changing engine behavior.
3. Fill only proven missing boot/main-thread side effects.
4. Keep `bootFlow=1` gated and do not change default `?autoLoad=1&play=1`.

## Current Evidence

- Phase 0 research note:
  `/tmp/marble-love/boot-flow/research.md`.
- Baseline validation PASS:
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false`;
  `npx tsc -p packages/web/tsconfig.json --noEmit --pretty false`;
  `npm --workspace @marble-love/web run build`;
  `git diff --check`.
- Phase 1 local validation PASS:
  `npx vitest run packages/web/test/boot-flow-url.test.ts packages/web/test/coin-start-flow.test.ts packages/web/test/practice-level.test.ts --silent`;
  `npx tsc -p packages/web/tsconfig.json --noEmit --pretty false`;
  `npm --workspace @marble-love/web run build`;
  `git diff --check`.
- Phase 1 was committed and pushed to `origin/main` as `9934721`.
- Browser in-app verification was attempted before the Phase 1 commit, but this
  session had no active browser pane available. Manual/user browser checks
  remain useful during Phase 2.
- Phase 2 research artifacts:
  `/tmp/marble-love/boot-flow/phase2-ts-cold-boot-summary.json` and
  `/tmp/marble-love/boot-flow/phase2-mame-cold-boot-nonvram-summary.json`.
- Initial Phase 2 finding: MAME cold boot needs clean cfg/nvram plus
  `-nonvram_save` for the expected attract path. TS `bootInit(...,{})` reaches
  descriptor-backed attract-like states without seeds, but cadence drifts:
  examples include MAME f2400 at `main=1/mode=0/level=1/ptr=0x0002c54c`
  versus TS f2400 same descriptor with different PF/alpha counts, and MAME
  f3600 returning to `level=0/mode=0` while TS is still `level=1/mode=2`.

## Active Constraints

- Do not delete, rename, regenerate, or weaken existing true-start seeds.
- Do not change `?autoLoad=1&play=1` default behavior until the PRD reaches
  Phase 7 and the user approves the default switch.
- Keep new behavior behind `bootFlow=1` until all acceptance criteria are green.
- Commit only after the active phase validation passes and any requested user
  playtest is confirmed.

## Last Closed Scope

Sprite visibility and physics fixes were completed on `main` through:

- `b2c597d docs: record l4 piston sprite fix`
- `27ffc19 fix: spawn l3 green blob string sprites`
- `7bf7137 fix: render aerial dynamic obstacles`

User-facing confirmations recorded in the conversation:

- `sprite1`: OK.
- `sprite2`: catapult OK; L4/Aerial pistons now move/animate.
- `sprite3`: OK.
- `sprite4`: L3/Intermediate green blob/stain sprites now appear.
- Later L4/Aerial invisible obstacle: fixed and confirmed before the final
  commit/push of `7bf7137`.

Historical notes for that scope remain in:

- `docs/archive/goals/2026-05-20-sprite-goal-full.md`
- `docs/codex-task-sprite-visibility-physics.md`
- `docs/codex-task-l4-pistons-current-context.md`

## Cold Start Reminder

Do not read `docs/archive/**`, screenshots, traces, `packages/web/dist/**`,
scenario JSON, or Tom Harte fixture JSON unless the active task specifically
requires them. Use `jq`, targeted probes, or manifest summaries for large data.

## Validation Hints

For documentation-only changes:

```sh
npm run context:audit
git diff --check
git status --short --branch
```
