# PRD / Agent Plan - Boot-To-Gameplay Without Runtime Level Seeds

## Goal

Implement an experimental path where Marble Love starts from a cold ROM-backed
boot state, accepts coin/start through the runtime flow, enters Practice/L1
through the original dispatcher, and then progresses level-by-level without
loading true-start seeds at runtime.

The existing level seeds must stay. They are proven checkpoints and must remain
available for `startLevel=1..6`, `playableSeed=...`, regression tests, visual
debugging, and MAME comparison. This task is about removing seed dependency from
the normal boot/play path, not deleting or weakening seed tooling.

## Suggested `/goal`

```text
Implement a gated boot-flow path that reaches playable L1 and then level
progression from cold boot without loading playable/startLevel seeds, while
preserving all existing seed-based diagnostics and startLevel behavior.
```

## Context Files To Read

Cold start:

- `AGENTS.md`
- `docs/context-map.md`
- this file
- `STATUS.md` only for current operational status

Then read only the files needed by the active phase.

Known relevant files:

- `packages/web/src/main.ts`
- `packages/web/src/coin-start-flow.ts`
- `packages/web/src/practice-level.ts`
- `packages/engine/src/boot-init.ts`
- `packages/engine/src/main-tick.ts`
- `packages/engine/src/main-loop-init-117b2.ts`
- `packages/engine/src/main-loop-init-11452.ts`
- `packages/engine/src/main-loop-init-1101e.ts`
- `packages/engine/src/main-loop-init-10504.ts`
- `packages/engine/src/level-intro-banner-resume.ts`
- `packages/engine/src/game-main-gate.ts`
- `oracle/run_oracle.ts` and targeted `oracle/mame_*.lua` taps only when proof
  is needed

## Do Not Read Unless Needed

- `docs/archive/**`
- `HANDOFF_*.md`
- `screenshots/**`
- `traces/**`
- `snap/**`
- `packages/web/dist/**`
- `packages/web/public/scenarios/**/*.json`
- `oracle/scenarios/**/*.json`
- `oracle/tom_harte_m68000/*.json`
- `node_modules/**`
- `.claude/worktrees/**`

Use `rg`, `jq`, focused probes, or small manifests for large data.

## Current Architecture Summary

As of 2026-05-20:

- `?autoLoad=1&play=1` shows an attract/coin/start gate, but after START the web
  code loads the proven L1 true-start seed into `bootInit(..., { warmState })`.
- `?autoLoad=1&startLevel=N` loads one of the six true-start seeds directly.
- `bootInit(..., {})` is a partial cold boot. It intentionally does not run the
  full `FUN_FA0`/`FUN_117B2` boot-to-attract path because earlier attempts
  jumped too far ahead for MAME parity.
- `bootInit(..., { preloadLevel })` and `fullScreenInit` are smoke/rendering
  helpers, not parity-correct boot flow.
- `mainTick(..., { runMainLoopBody: true })` approximates the `FUN_117B2` main
  thread cadence, including wait/body timing, but long boot/attract/gameplay
  progression still has gray areas.
- `level-intro-banner-resume.ts` exists to continue warm-state intro seeds that
  were captured inside the `FUN_10504` presentation loop. A true cold boot path
  should not rely on this warm-state cursor except for seed diagnostics.

## Non-Negotiable Constraints

- Do not delete, rename, or regenerate existing true-start seeds as part of this
  task.
- Do not change `startLevel=1..6` behavior unless the phase explicitly tests and
  preserves it.
- Do not hide boot-flow gaps by loading a warmState, preloadLevel, or
  renderer-only surrogate.
- Do not modify terrain, collision, physics, renderer bounds, route proof, or
  level seed mappings without MAME-backed evidence.
- Keep the new path gated until the final phase. Existing `?autoLoad=1&play=1`
  and `?startLevel=N` behavior must stay usable while the work is in progress.
- Commit only after the phase acceptance criteria pass and the user confirms any
  browser/manual playtest required by that phase.

## Feature Flag Strategy

Add the new path behind an explicit flag first:

```text
?autoLoad=1&bootFlow=1
?autoLoad=1&bootFlow=1&debugState=1&sound=0
```

During development:

- `bootFlow=1` must not load `coinStartWarmState`, `playableSeed`, or
  `startLevel` seeds.
- `startLevel=N` keeps seed behavior and remains the stable diagnostic path.
- `playableSeed=NAME` keeps seed behavior and remains the explicit replay path.
- The default `?autoLoad=1&play=1` should not be switched to boot flow until
  Phase 7 is green.

## Phase 0 - Baseline And Instrumentation Plan

Purpose: establish a clean baseline and prove that the existing seed paths still
work before touching runtime behavior.

Actions:

1. Confirm clean worktree and branch:

   ```sh
   git status --short --branch
   git log --oneline -5
   ```

2. Map the current seed handoff in `packages/web/src/main.ts`:
   - where `livePlaySeedName` is prepared;
   - where `coinStartWarmState` is loaded;
   - where START calls `bootInit(..., { warmState })`;
   - where `runMainLoopBody` is enabled.
3. Write a short research note in `/tmp/marble-love/boot-flow/research.md`.
4. Run baseline validation:

   ```sh
   npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false
   npx tsc -p packages/web/tsconfig.json --noEmit --pretty false
   npm --workspace @marble-love/web run build
   git diff --check
   ```

Acceptance:

- No code changes required.
- Research note identifies the exact current seed-loading points.
- Existing seed/startLevel behavior is not touched.

Commit gate:

- Usually no commit for this phase unless documentation is added.

## Phase 1 - Add Gated Boot Flow Switch

Purpose: introduce a non-default route that prevents seed loading without trying
to solve all boot progression at once.

Allowed files:

- `packages/web/src/main.ts`
- `packages/web/test/**` if URL/flow tests exist or are added
- this PRD checkpoint section

Implementation:

1. Add query parsing for `bootFlow=1`.
2. When `bootFlow=1`:
   - do not prepare `coinStartWarmState`;
   - do not fallback to `manual_level1_start`;
   - call `bootInit(s, tickRom, {})`;
   - enable runtime ticking only through the normal tick path.
3. Add visible/debug logging that says the browser is in cold boot flow.
4. Keep `playableSeed` and `startLevel` higher priority than `bootFlow` only if
   explicitly present, or fail-loud if the combination is ambiguous. Prefer
   fail-loud with an overlay/warning for combinations such as
   `bootFlow=1&startLevel=3`.

Validation:

```sh
npx tsc -p packages/web/tsconfig.json --noEmit --pretty false
npm --workspace @marble-love/web run build
git diff --check
```

Manual/browser check:

- Open `?autoLoad=1&bootFlow=1&debugState=1&sound=0`.
- Confirm from logs/debug that no playable seed is loaded.
- It may still fail to reach playable L1 in this phase; that is acceptable.

Acceptance:

- Existing `?autoLoad=1&play=1` still loads the L1 seed on START.
- Existing `?autoLoad=1&startLevel=1..6` still works.
- New `bootFlow=1` path never calls `bootInit(... warmState ...)` unless an
  explicit seed/debug URL is used.

Commit gate:

- Commit only after validation passes and user confirms the URL opens without
  breaking the existing seed path.

Suggested commit message:

```text
feat: add gated cold boot flow flag
```

## Phase 2 - Cold Boot To Stable Attract

Purpose: make `bootFlow=1` reach a stable original-like attract/high-score state
from `bootInit(..., {})`, not a blank or preloaded playfield state.

Allowed files:

- `packages/engine/src/boot-init.ts`
- `packages/engine/src/main-tick.ts`
- `packages/engine/src/main-loop-init-117b2.ts`
- `packages/engine/src/main-loop-init-11452.ts`
- `packages/engine/src/main-loop-init-10504.ts`
- targeted engine tests
- targeted oracle taps/probes

Implementation approach:

1. Capture or reuse a MAME cold-boot/early-attract trace with small output:
   - key RAM words: `0x390`, `0x392`, `0x394`, `0x396`, `0x39a`, `0x3e2`,
     `0x3e4`, `0x3ae`, `0x3b0`, `0x3b8`, `0x75a`;
   - playfield nonzero count;
   - sprite/MO count;
   - alpha text summary;
   - slapstic bank.
2. Compare TS bootFlow frame windows against MAME by summary, not full JSON.
3. Fill only proven missing boot/main-thread side effects.
4. Do not use `preloadLevel` as a shortcut. If a level appears, it must appear
   through the dispatcher path.

Validation:

```sh
npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false
npx tsc -p packages/web/tsconfig.json --noEmit --pretty false
npm --workspace @marble-love/web run build
git diff --check
```

Add focused tests or probes for any newly replicated boot/init behavior.

Manual/browser check:

- `?autoLoad=1&bootFlow=1&debugState=1&sound=0`
- Confirm attract/high-score/presentation is visible and keeps ticking.
- Confirm no seed is loaded in console logs.

Acceptance:

- Stable visible attract path from cold boot.
- No reliance on `warmState`, `preloadLevel`, or fullScreen smoke helpers.
- MAME comparison has concrete frame/key-field evidence.
- Existing seed URLs still work.

Commit gate:

- Commit only after targeted tests pass and user confirms the attract path is
  visibly alive.

Suggested commit message:

```text
fix: advance cold boot attract flow
```

## Phase 3 - Original Coin And START Path

Purpose: make `bootFlow=1` accept coin/start through runtime state instead of
browser-side seed injection.

Allowed files:

- `packages/web/src/main.ts`
- `packages/web/src/coin-start-flow.ts`
- `packages/web/src/input.ts` only if MMIO/input mapping proof requires it
- `packages/engine/src/game-main-gate.ts`
- `packages/engine/src/main-tick.ts`
- focused web/engine tests

Implementation approach:

1. Trace MAME for coin pulse and START pulse from attract:
   - credit counter;
   - MMIO value;
   - `gameMainGate` branch result;
   - state transition around `0x390/0x392/0x394/0x396`.
2. Make browser coin/start input feed the same runtime-visible inputs for
   `bootFlow=1`.
3. Remove any `bootFlow=1` special case that swaps in a seed at START.
4. Keep the current browser coin/start seed behavior unchanged for the default
   non-bootFlow path.

Validation:

```sh
npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false
npx tsc -p packages/web/tsconfig.json --noEmit --pretty false
npx vitest run packages/web/test/coin-start-flow.test.ts --silent
npm --workspace @marble-love/web run build
git diff --check
```

Manual/browser check:

- `?autoLoad=1&bootFlow=1&debugState=1&sound=0`
- Press coin, then START.
- Confirm no seed load log appears.
- Confirm debug state leaves attract/credit gate through runtime state.

Acceptance:

- Coin/start works in bootFlow without `warmState`.
- Existing default coin/start path still works.
- Ambiguous URL combinations fail loudly or preserve explicit seed behavior.

Commit gate:

- Commit only after validation and user confirms coin/start changes state in
  bootFlow.

Suggested commit message:

```text
fix: route boot flow coin start through runtime
```

## Phase 4 - Runtime Level Enter And L1 Intro

Purpose: after START in `bootFlow=1`, enter L1 through the original dispatcher
and render the Practice Race intro/banner/timer without loading the L1 seed.

Allowed files:

- `packages/engine/src/main-loop-init-117b2.ts`
- `packages/engine/src/main-loop-init-11452.ts`
- `packages/engine/src/main-loop-init-1101e.ts`
- `packages/engine/src/main-loop-init-10504.ts`
- `packages/engine/src/level-intro-banner-resume.ts` only to ensure the warm
  cursor does not auto-arm on true runtime transitions incorrectly
- `packages/web/src/main.ts` for debug/logging only
- focused tests

Implementation approach:

1. Prove which ROM path MAME uses after START:
   - `FUN_11452`;
   - `FUN_10504`;
   - `FUN_16EC6`;
   - `FUN_16F6C`;
   - `FUN_259B4`;
   - timer/HUD routines.
2. Wire missing default callbacks rather than adding browser-level setup.
3. Ensure `level-intro-banner-resume` remains a warm-seed repair path only. A
   true bootFlow transition should be owned by the dispatcher and any real
   presentation wait modeled in engine state.
4. Compare the first playable L1 frame against the proven L1 seed as a
   checkpoint, but do not load that seed.

Validation:

```sh
npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false
npx vitest run \
  packages/engine/test/level-intro-banner-resume.test.ts \
  packages/engine/test/main-loop-init-task-a.test.ts \
  packages/engine/test/main-tick.test.ts --silent
npm --workspace @marble-love/web run build
git diff --check
```

Manual/browser check:

- `?autoLoad=1&bootFlow=1&debugState=1&sound=0`
- Coin/start.
- Confirm Practice Race banner appears.
- Confirm timer counts/adds correctly through runtime.
- Confirm no seed load occurs.

Acceptance:

- L1 intro/banner/timer appears from runtime.
- Playfield/sprites/HUD are initialized by engine routines.
- Difference from L1 true-start seed is explained or bounded by proof.
- Existing `startLevel=1` remains green.

Commit gate:

- Commit only after tests pass and user confirms the L1 intro visually.

Suggested commit message:

```text
fix: enter level one from cold boot flow
```

## Phase 5 - First Playable L1 Without Seed

Purpose: make the marble playable in L1 after runtime level entry, with input,
camera, terrain, collision, timer, HUD, and sprite behavior good enough to use
as a real game start.

Allowed files:

- engine runtime files directly implicated by proof;
- web input plumbing if needed;
- targeted tests/probes.

Implementation approach:

1. Compare the generated bootFlow first-playable state with:
   - MAME cold-boot coin/start first-playable trace;
   - existing L1 true-start seed as a diagnostic checkpoint.
2. Track:
   - object slot count and obj0 fields;
   - player position/velocity;
   - timer cascade fields;
   - scroll target/current;
   - playfield nonzero count;
   - sprite/MO count;
   - input response active-vs-neutral.
3. Fix only proved runtime divergence.
4. Keep keyboard/touch/trackball behavior aligned with existing input tuning.

Validation:

```sh
npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false
npx tsc -p packages/web/tsconfig.json --noEmit --pretty false
npx vitest run \
  packages/engine/test/main-tick.test.ts \
  packages/web/test/coin-start-flow.test.ts \
  packages/web/test/practice-level.test.ts --silent
npm --workspace @marble-love/web run build
git diff --check
```

Manual/browser check:

- `?autoLoad=1&bootFlow=1&debugState=1&sound=0`
- Play L1 for at least 60 seconds or until a clear runtime failure appears.
- Check keyboard and touch/trackball input if the phase touched input.

Acceptance:

- Marble is controllable from bootFlow L1.
- No seed is loaded after START.
- Timer, camera, terrain, collision, and core sprites behave like current
  seed-based L1 within documented tolerance.
- Existing seed-based `?autoLoad=1&play=1` and `?startLevel=1..6` still work.

Commit gate:

- Commit only after automated checks and user playtest confirmation.

Suggested commit message:

```text
fix: make cold boot level one playable
```

## Phase 6 - Runtime Level Progression L1 Through L6

Purpose: complete levels through runtime transitions rather than loading
startLevel seeds between levels.

Implement as subphases. Do not batch all levels into one commit.

Subphases:

1. L1 -> L2
2. L2 -> L3
3. L3 -> L4
4. L4 -> L5
5. L5 -> L6
6. L6 completion/end flow

For each subphase:

1. Use MAME proof or a user/manual route to identify the transition window.
2. Verify `main/state/mode/level`, descriptor, timer carryover, banner text,
   score text, playfield, objects, sprites, and input after transition.
3. Compare against the corresponding true-start seed as a checkpoint only.
4. Fix the smallest runtime divergence.
5. Run focused tests and ask for browser playtest on the transition.

Suggested validation for every subphase:

```sh
npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false
npx tsc -p packages/web/tsconfig.json --noEmit --pretty false
npx vitest run \
  packages/engine/test/level-intro-banner-resume.test.ts \
  packages/engine/test/main-loop-level-end-score.test.ts \
  packages/engine/test/main-tick.test.ts --silent
npm --workspace @marble-love/web run build
git diff --check
```

Add level-specific tests/probes whenever a bug is fixed.

Acceptance for each transition:

- Transition happens without loading a seed.
- Timer carryover is correct: previous remaining seconds + new level bonus.
- Level intro/banner is correct.
- First playable frame of the new level is controllable.
- Dynamic sprites/obstacles already fixed in seed paths remain visible and
  physical in runtime transition paths.
- User confirms the transition in browser or the MAME/TS route proof is strong
  enough for a non-visual subcase.

Commit gate:

- One commit per green transition subphase.
- Do not mark a transition green if any success criterion is gray.

Suggested commit messages:

```text
fix: progress cold boot flow from l1 to l2
fix: progress cold boot flow from l2 to l3
fix: progress cold boot flow from l3 to l4
fix: progress cold boot flow from l4 to l5
fix: progress cold boot flow from l5 to l6
```

## Phase 7 - Make Boot Flow The Default Play Path

Purpose: switch the normal user-facing play URL to the no-seed runtime path only
after Phases 1-6 are green.

Allowed files:

- `packages/web/src/main.ts`
- README/STATUS docs
- web tests

Implementation approach:

1. Keep seed diagnostics:
   - `startLevel=1..6`;
   - `playableSeed=NAME`;
   - optional explicit `seedFlow=1` or equivalent fallback if useful.
2. Change `?autoLoad=1&play=1` to use bootFlow by default only when:
   - cold boot attract works;
   - coin/start works;
   - L1 playable works;
   - level progression through L6 is green;
   - user approves the switch.
3. Update README/STATUS with the new default and the seed fallback URLs.

Final validation:

```sh
npm run typecheck
npm run lint
npm run test --silent
npm --workspace @marble-love/web run build
npm run context:audit
git diff --check
git status --short --branch
```

Manual/browser checks:

- `?autoLoad=1&play=1`: cold boot, attract, coin/start, L1 playable, no seed
  load after START.
- `?autoLoad=1&startLevel=1..6`: all seed starts still load.
- `?autoLoad=1&playableSeed=start_level1_intro_practice_f2479&play=1`: explicit
  seed path still works.

Acceptance:

- Default play path no longer depends on seeds.
- Seed diagnostic paths are preserved and documented.
- Full validation is green or any skipped check is explicitly explained.

Commit gate:

- Commit only after user approves making bootFlow default.

Suggested commit message:

```text
feat: default live play to cold boot flow
```

## Required Checkpoint Discipline

After each material finding:

1. Update this PRD under `Checkpoint Log`.
2. Record:
   - phase;
   - files touched;
   - MAME/TS evidence path or command;
   - tests run;
   - manual browser URL tested;
   - result: green, blocked, or gray.
3. Keep long logs in `/tmp/marble-love/boot-flow/` and link paths only.

Before every commit:

```sh
git diff --check
git status --short --branch
```

Use targeted validation for the phase. Use broad `npm run typecheck`, `npm run
lint`, and `npm run test --silent` before Phase 7 or any default-path switch.

## Done When

The task is complete only when:

- `?autoLoad=1&play=1` can start from cold boot, accept coin/start, enter L1,
  and progress level-by-level without runtime seed loads.
- `startLevel=1..6` still works and still uses the proven true-start seeds.
- `playableSeed=NAME` still works for diagnostics.
- MAME proof or well-scoped manual/browser evidence exists for every transition.
- README/STATUS document the default path and seed fallback paths.
- No phase has an unresolved gray success criterion.

## Checkpoint Log

- 2026-05-20: PRD created. No implementation started.
- 2026-05-20: `/goal` opened and `GOAL.md` updated. Current phase is Phase 0
  baseline/research; no runtime code touched.
- 2026-05-20: Phase 0 complete. Research note:
  `/tmp/marble-love/boot-flow/research.md`. Current seed handoff is mapped in
  `packages/web/src/main.ts`: query parsing lines 48/70/72-76, seed fetch
  helper lines 1011-1039, explicit playable/startLevel/default live seed loads
  lines 1053-1087, initial `bootInit` lines 1164-1174, START warm-state handoff
  lines 1489-1512, and runtime body gate lines 1536-1549. Baseline validation
  passed: engine typecheck, web typecheck, web build, and `git diff --check`.
  Next phase: Phase 1 `bootFlow=1` gated switch.
- 2026-05-20: Phase 1 implemented locally in `packages/web/src/main.ts`, not
  committed yet. Added `bootFlow=1`, conflict overlay for seed/warm-state URL
  combinations, disabled `useCoinStartFlow` seed preparation while bootFlow is
  active, and made bootFlow call `bootInit(..., {})` instead of preloading L1.
  Validation passed: web typecheck, web build, and `git diff --check`. Pending:
  user browser confirmation for `?autoLoad=1&bootFlow=1&debugState=1&sound=0`
  and quick regression confirmation for existing seed URLs before commit.
- 2026-05-20: Phase 1 strengthened locally with
  `packages/web/src/boot-flow-url.ts` and
  `packages/web/test/boot-flow-url.test.ts`. Focused tests prove the default
  `play=1` path still selects seed-backed coin/start flow, `bootFlow=1`
  disables that seed preparation, and seed/warm-state URL combinations fail
  loudly. Validation passed:
  `npx vitest run packages/web/test/boot-flow-url.test.ts packages/web/test/coin-start-flow.test.ts packages/web/test/practice-level.test.ts --silent`,
  web typecheck, web build, and `git diff --check`. Browser in-app verification
  could not run because no active browser pane is available in this session;
  manual confirmation remains the commit gate.
- 2026-05-20: Phase 1 committed and pushed to `origin/main` as `9934721`
  (`feat: add gated cold boot flow flag`) after rerunning focused web routing
  tests, web typecheck, web build, and `git diff --check`. Current phase is
  Phase 2: cold boot to stable attract. Next work must compare compact
  cold-boot/early-attract TS vs MAME summaries before changing engine behavior.
- 2026-05-20: Phase 2 research started. TS probe
  `/tmp/marble-love/boot-flow/probe-cold-boot-summary.mts` and MAME
  `mame_state_multidump.lua` summaries are recorded under
  `/tmp/marble-love/boot-flow/`. Important setup: MAME cold boot summary must
  use clean cfg/nvram and `-nonvram_save`; otherwise the run can stay in a
  misleading service/factory-like state. First finding: TS no-seed cold boot is
  not blank and reaches descriptor-backed attract segments, but main-thread
  cadence/phase drifts against MAME. Focus next on `mainLoopInit117B2`,
  `mainLoopInit11452`, `mainLoopInit10504`, and async wait staging, not on
  terrain/collision/renderer or seed mappings.
