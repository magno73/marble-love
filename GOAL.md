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

- Phase 1: add gated `bootFlow=1` switch.
- Phase 0 baseline/research is complete.
- Existing seed diagnostics must remain intact: `startLevel=1..6` and
  `playableSeed=NAME`.

Next action:

1. Read only `AGENTS.md`, `docs/context-map.md`, this file, and
   `docs/codex-task-boot-flow-no-seed.md`.
2. Implement Phase 1 from the PRD in `packages/web/src/main.ts`.
3. Validate web typecheck, web build, and `git diff --check`.
4. Ask for user browser confirmation before committing Phase 1.

## Current Evidence

- Phase 0 research note:
  `/tmp/marble-love/boot-flow/research.md`.
- Baseline validation PASS:
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false`;
  `npx tsc -p packages/web/tsconfig.json --noEmit --pretty false`;
  `npm --workspace @marble-love/web run build`;
  `git diff --check`.

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
