# AGENTS.md

Repository root: `/Users/magnus-bot/Code/marble-love`.

Use this file as the startup context for AI agents. Keep it short. Do not paste
long history, trace output, or snapshot JSON into agent prompts.

Cold start rule: read this file and `docs/context-map.md` before exploring the
repo. Do not paste long history, trace output, or snapshot JSON into agent
prompts.

## Layout

- `packages/engine`: core engine, state, runtime logic, renderer model, audio
  model, unit tests.
- `packages/web`: Vite/PixiJS frontend, ROM loader, input, browser renderer.
- `packages/cli`: probes, audits, route search, parity runners.
- `oracle`: MAME Lua scripts and oracle scenarios.
- `harness`: trace diff/report tooling.
- `tools`: Ghidra, ROM prep, and local utility scripts.
- `docs`: public technical notes and the compact context map.

Read `docs/context-map.md` for a compact module map.

## Working Rules

- Preserve dirty and untracked work that you did not create.
- Make surgical changes. Do not refactor adjacent code unless required.
- Prefer `rg`, `git ls-files`, `jq`, `du`, and targeted probes over broad file
  reads.
- Do not read large JSON snapshots in full. Inspect them with `jq`, scripts, or
  summaries.
- Do not read `screenshots/**`, `traces/**`, `snap/**`, `packages/web/dist/**`,
  `node_modules/**`, `.claude/worktrees/**`, or `oracle/tom_harte_m68000/*.json`
  unless a task explicitly requires it.
- Keep investigation output in `/tmp/marble-love/<task>/` or a task artifact
  directory. Summarize findings in small markdown notes.
- Separate MAME proof, seed export, web wiring, and browser smoke checks.
- Do not change gameplay, collision, renderer, route, or seed behavior just to
  make an old diagnostic green.

## Commands

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

Web build:

```sh
npm --workspace @marble-love/web run build
```

## Common Runtime URLs

```text
http://localhost:5173/
http://localhost:5173/?autoLoad=1
http://localhost:5173/?autoLoad=1&coinStart=1
http://localhost:5173/?autoLoad=1&startLevel=N
```

## Done Criteria

- Relevant implementation and tests are updated.
- Targeted validation for the touched area has run.
- Skipped or failing checks are reported explicitly.
- `git diff --check` has run.
- Final handoff names changed files, commands run, and residual risks.
