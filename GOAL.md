# GOAL - Active Objective

This file is only for the current active task. Do not use it as historical
startup context. Long or closed goal notes belong in `docs/archive/goals/` or in
the task PRD checkpoint log.

## Active Goal

No active `/goal` is currently open.

When a new non-trivial goal starts:

1. Create or update a task file from `docs/task-template.md`.
2. Keep the startup read set to `AGENTS.md`, `docs/context-map.md`, this file,
   and the active task file.
3. Update this file after each material finding, patch, validation, or blocker.
4. Archive long history before this file grows into a diary.

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
