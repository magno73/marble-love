# Context Map

This is the compact map agents should read before exploring the repo. It is a
router, not a replacement for targeted source reads.

## Startup Files

For a cold start, read only:

- `AGENTS.md`: repo-wide agent rules, validation commands, large-file guardrails.
- this file: module routing and large-file guardrails.
- the task file named by the user, if one is active.

## Packages

### `packages/engine`

Core TypeScript reimplementation. Most gameplay, state, renderer-model, audio
model, CPU helper, object, collision, level, and timer changes belong here.

Important areas:

- `src/main-tick.ts`: main runtime tick.
- `src/main-loop-init-*.ts`: init and mode setup.
- `src/state.ts`: shared game state and RAM-backed structures.
- `src/render.ts`: renderer model and frame building.
- `src/level.ts`: level descriptor and terrain decode.
- `src/m68k/`: 68000-oriented helpers, slapstic, cycle data.
- `src/m6502/` and `src/audio/`: sound CPU and chip models.
- `test/`: unit, regression, route, and parity-focused tests.

Use `packages/engine/AGENTS.md` before engine work.

### `packages/web`

Browser app using Vite and PixiJS. Owns ROM loading, frontend controls, URL
flags, input plumbing, web renderer, web tests, and public scenario assets.

Important areas:

- `src/main.ts`: frontend boot, query flags, ROM/seed loading, play flow.
- `src/renderer.ts`: PixiJS rendering.
- `public/scenarios/`: generated or exported web scenarios and seeds.
- `test/`: browser-facing or frontend unit tests.

Use `packages/web/AGENTS.md` before web work.

### `packages/cli`

One-off and repeatable investigation tooling. Owns route search, seed audits,
MAME/TS comparisons, parity probes, and generated summary output.

Important pattern: CLI tools should emit small summaries or manifest JSON, not
full snapshot dumps to the terminal.

Use `packages/cli/AGENTS.md` before CLI work.

## Oracle And Harness

### `oracle`

MAME is the ground truth for behavior. Lua scripts tap MAME state, dump
snapshots, capture proof windows, and create oracle scenarios.

Important areas:

- `run_oracle.ts`: wrapper for MAME oracle runs.
- `mame_*.lua`: targeted MAME tap scripts.
- `scenarios/`: oracle input and gameplay scenarios. Many are large JSON files.
- `tom_harte_m68000/`: CPU fixtures. JSON files here are very large.

Use `oracle/AGENTS.md` before oracle work.

### `harness`

Trace diff and reporting utilities. Use for comparing engine and oracle traces.

## Documentation

- `docs/README.md`: index of public technical notes.
- `docs/level-header-format.md`: verified level descriptor header format.
- `docs/rom-layout.md`: ROM ZIP expectations and region layout.
- `docs/hardware-map.md`: concise Atari System 1 hardware map.
- `docs/input-mmio-map.md`: input register notes.
- `docs/video-system.md`: renderer and video hardware notes.
- `docs/sound-system.md`: sound CPU/chip architecture and current status.
- `docs/fixture-inventory.md`: tracked fixture-size rationale.

## Large Or Noisy Areas

Do not read these broadly:

- `node_modules/**`
- `.claude/worktrees/**`
- `packages/web/dist/**`
- `packages/web/node_modules/**`
- `packages/web/public/scenarios/**/*.json`
- `oracle/scenarios/**/*.json`
- `oracle/tom_harte_m68000/*.json`
- `screenshots/**`
- `traces/**`
- `snap/**`
- `ghidra_project/**`

Use `jq`, `du`, `rg --files`, `git ls-files`, or targeted scripts to summarize
these areas.

## Validation Router

- Engine runtime behavior: `npx tsc -p packages/engine/tsconfig.json --noEmit`
  plus relevant `npx vitest run packages/engine/test/<file>.test.ts`.
- Web behavior: `npx tsc -p packages/web/tsconfig.json --noEmit` and
  `npm --workspace @marble-love/web run build`.
- CLI tooling: `npx tsc -p packages/cli/tsconfig.json --noEmit` and run the
  specific CLI with a small fixture or summary mode.
- Repo hygiene: `npm run context:audit`, `git diff --check`,
  `git status --short --branch`.

## Task Notes

For new non-trivial work, keep task notes small and focused: goal, files to
read, files not to read, commands, done criteria, and a short handoff note.
