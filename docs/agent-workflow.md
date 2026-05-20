# Agent Workflow

Use this workflow for non-trivial AI-agent work in this repo.

## Start

1. Start a fresh session for each unrelated task.
2. Read `AGENTS.md`.
3. Read `docs/context-map.md`.
4. Read the task file or `GOAL.md` only for current state.
5. Read only the source files, tests, and docs named by the task.

## Explore

- Use `rg`, `git ls-files`, `du`, `jq`, and focused probes.
- Do not broadly read large JSON, screenshots, dist files, archives,
  `node_modules`, or `.claude/worktrees`.
- If broad research is needed, write a short research note in
  `/tmp/marble-love/<task>/research.md` or `tasks/<id>/research.md`.
- Keep evidence paths and command summaries concise.

## Implement

1. Inspect direct callers and local tests.
2. Make the smallest change that satisfies the task.
3. Add or update focused tests before broad gates.
4. Keep generated artifacts out of the repo unless the task requires them.

## After Compaction

Do not reload the whole repo context. Read only:

- `AGENTS.md`
- `docs/context-map.md`
- the active task or current `GOAL.md`
- files changed or directly relevant to the next step

## Handoff

Summarize:

- changed files
- commands run
- proof or artifact paths
- skipped checks
- remaining blockers

Link long logs or archives instead of pasting them.
