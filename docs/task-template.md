# Task: <name>

## Goal

State the concrete outcome in one or two paragraphs.

## Context Files To Read

- `AGENTS.md`
- `docs/context-map.md`
- `<task-specific-file>`

## Do Not Read Unless Needed

- `docs/archive/**`
- `screenshots/**`
- `traces/**`
- `snap/**`
- `packages/web/dist/**`
- `packages/web/public/scenarios/**/*.json`
- `oracle/scenarios/**/*.json`
- `oracle/tom_harte_m68000/*.json`
- `node_modules/**`
- `.claude/worktrees/**`

## Constraints

- Preserve dirty and untracked work not created by this task.
- Keep changes scoped to the requested behavior.
- Use targeted probes or `jq` for large JSON files.
- Do not update expected values just to make stale diagnostics pass.

## Investigation Commands

```sh
git status --short --branch
rg "<symbol-or-term>" packages oracle docs
```

## Implementation Plan

1. Read the listed context files.
2. Inspect direct callers and tests for the touched area.
3. Make the smallest change that satisfies the goal.
4. Add or update focused tests.
5. Run targeted validation.

## Validation

```sh
git diff --check
git status --short --branch
```

Add task-specific commands here.

## Done When

- The requested behavior is implemented.
- Targeted tests or probes pass.
- Skipped checks and residual risks are documented.
- Handoff notes explain changed files and next steps.

## Handoff Notes

Record concise current status, commands run, evidence paths, and remaining
blockers. Link archives instead of pasting long logs.
