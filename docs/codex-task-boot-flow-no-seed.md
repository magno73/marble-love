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
- 2026-05-20: Phase 2 in progress. Verified compact evidence in
  `/tmp/marble-love/boot-flow/phase2-mame-cold-boot-nonvram-summary.json` and
  reran `/tmp/marble-love/boot-flow/probe-cold-boot-summary.mts` to refresh
  `/tmp/marble-love/boot-flow/phase2-ts-cold-boot-summary.json`. Finding:
  current TS cold boot reaches descriptor-backed attract without seeds but
  drifted ahead of MAME and reached `mode=3` at f12000 with no summary
  timer/content. Touched `packages/engine/src/main-loop-init-11452.ts`,
  `packages/engine/src/mode2-init-11452-async.ts`, and
  `packages/engine/test/main-loop-init-task-a.test.ts` to initialize the mode 3
  attract summary on `b3e4 > 7` overflow. Test run:
  `npx vitest run packages/engine/test/main-loop-init-task-a.test.ts --silent`
  PASS. Updated TS probe shows f12000 `mode=3` now has timer `0x0091` and
  alpha summary content, then returns to visible `mode=0` attract by f12400.
  Result: green for the no-blank/stable-attract fix; full Phase 2 validation
  still pending.
- 2026-05-20: Phase 2 automated validation passed after the mode3 summary fix:
  `npx vitest run packages/engine/test/main-loop-init-task-a.test.ts packages/engine/test/main-tick.test.ts packages/web/test/boot-flow-url.test.ts packages/web/test/coin-start-flow.test.ts packages/web/test/practice-level.test.ts --silent`;
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false`;
  `npx tsc -p packages/web/tsconfig.json --noEmit --pretty false`;
  `npm --workspace @marble-love/web run build`; `git diff --check`. Browser
  automation could not run because Browser Node REPL and local Playwright were
  unavailable; `curl -I` confirmed the existing Vite server answers 200 on
  `http://127.0.0.1:5173/?autoLoad=1&bootFlow=1&debugState=1&sound=0`.
  Manual/user browser confirmation remains the Phase 2 commit gate.
- 2026-05-20: Phase 2 manual browser confirmation received from user for
  `http://192.168.85.200:5173/?autoLoad=1&bootFlow=1&debugState=1&sound=0`:
  levels pass quickly, then the flow settles on a high-score screen with
  `credits 0` and moving marbles. Result: green for visible, ticking attract
  without seed/preload use. Residual risk: attract cadence still differs from
  MAME and should stay visible in future Phase 3 coin/start proof instead of
  being hidden by runtime seeds.
- 2026-05-20: Phase 3 local implementation in progress. Evidence:
  `oracle/scenarios/input/playable_coin_start.json` records 15-frame Coin 1
  and START1 pulses; `docs/input-mmio-map.md` maps START1 to active-low bit 0
  of `0xF60001`, while Coin 1 remains sound CPU `$1820` bookkeeping in the
  current TS path. Touched `packages/web/src/main.ts`,
  `packages/web/src/coin-start-flow.ts`,
  `packages/web/test/coin-start-flow.test.ts`, and `GOAL.md`. Result:
  `bootFlow=1` credits now accept browser coin pulses, START1 is held low for
  the MAME pulse window, and runtime `gateCheck` consumes one credit only when
  `gameMainGate` accepts player 1; no warm seed is loaded on the bootFlow START
  path. Validation passed:
  `npx vitest run packages/web/test/boot-flow-url.test.ts packages/web/test/coin-start-flow.test.ts packages/web/test/input.test.ts packages/web/test/practice-level.test.ts packages/engine/test/game-main-gate.test.ts --silent`;
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false`;
  `npx tsc -p packages/web/tsconfig.json --noEmit --pretty false`;
  `npm --workspace @marble-love/web run build`; `git diff --check`. Manual
  browser confirmation is still pending before commit.
- 2026-05-20: Phase 3 manual browser confirmation received from user. URL:
  `http://192.168.85.200:5173/?autoLoad=1&bootFlow=1&debugState=1&sound=0`.
  User confirmed insert coin adds credits and START loads a piece of terrain.
  Screenshot `/Users/magnus-bot/Desktop/partenza.png` shows runtime state
  `main=2 mode=2 level=0` with visible terrain/player and `timer=0`, then
  `OUT OF TIME / GAME OVER`. Result: green for Phase 3 coin/start leaving the
  attract/credit gate through runtime without a seed handoff; gray blocker for
  Phase 4 because L1 intro/session timer is not initialized yet.
- 2026-05-20: Phase 4 fix started in
  `packages/engine/src/main-loop-init-1101e.ts` and
  `packages/engine/test/main-loop-init-task-a.test.ts`. Finding: new-game
  runtime START enters `FUN_1101E` state 5, calls `FUN_10504`, and enables the
  player timer with outer counter zero without arming the level-intro timer
  resume already used for level transitions. Fix: after state 5 `init10504`,
  call `armLevelIntroBannerResume(..., { baseTimer: 0, parkTimer: true })` so
  Practice adds intro time before the live cascading timer is enabled. Test:
  `npx vitest run packages/engine/test/main-loop-init-task-a.test.ts --silent`
  PASS. Full Phase 4 validation and browser confirmation still pending.
- 2026-05-20: Phase 4 automated validation passed after arming the new-game
  intro timer resume: `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false`;
  `npx vitest run packages/engine/test/level-intro-banner-resume.test.ts packages/engine/test/main-loop-init-task-a.test.ts packages/engine/test/main-tick.test.ts --silent`;
  `npm --workspace @marble-love/web run build`; `git diff --check`. Manual
  browser confirmation remains pending before commit.
- 2026-05-20: Phase 4 manual follow-up received. User confirmed
  `bootFlow=1` START now loads a timer and is playable, but screenshot
  `/Users/magnus-bot/Desktop/partenza nuova.png` shows a black center band with
  debug scroll around `scroll=(0,290)`. Local probe
  `/tmp/marble-love/boot-flow/phase4-start-scroll-summary.json` shows the L1
  diagnostic seed starts with `videoScrollY=0`, while the cold runtime state-5
  path latches `0xff10` as `videoScrollY=272` after `FUN_10504`. Fix in
  progress: reset new-game state-5 scroll to zero after `FUN_10504`, preserving
  the intro timer resume. Focused test
  `npx vitest run packages/engine/test/main-loop-init-task-a.test.ts --silent`
  PASS.
- 2026-05-20: Phase 4 validation passed after the new-game scroll reset:
  `npx tsx /tmp/marble-love/boot-flow/probe-phase4-start-scroll.mts` now shows
  cold runtime state-5 and the L1 diagnostic seed both start with
  `scrollTarget=0`, `scrollLatched=0`, and `videoScrollY=0`; also passed
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false`;
  `npx vitest run packages/engine/test/level-intro-banner-resume.test.ts packages/engine/test/main-loop-init-task-a.test.ts packages/engine/test/main-tick.test.ts --silent`;
  `npm --workspace @marble-love/web run build`; `git diff --check`. Manual
  browser confirmation remains pending before commit.
- 2026-05-20: Phase 4 manual browser confirmation received from user:
  bootFlow coin/start now works, the timer loads, the game is playable, and the
  initial black center band is gone. Phase 4 gate is green. Residual for Phase
  5: immediately after game over, the browser shows a yellow/red terrain screen;
  trace whether this is stale level rendering during the game-over/attract
  transition.
- 2026-05-20: Phase 4 committed and pushed as `70baf5a`
  (`fix: enter level one from cold boot flow`).
- 2026-05-20: Phase 5 post-game-over follow-up, later superseded by the
  high-score default fix below. Probe
  `/tmp/marble-love/boot-flow/phase5-gameover-summary.json` reproduces the
  no-seed bootFlow timeout: timeout summary starts around frame 3782 at
  `main=2/mode=0`; attract returns around frame 3964 at `main=1/mode=2` with
  the level playfield still visible; the playfield clears around frame 4264
  before mode0 attract rebuilds. Existing seed-backed timeout guard passes:
  `npx vitest run packages/engine/test/playable-live-routes.test.ts -t "time-out transition holds" --silent`.
  This was initially gray/documented, then traced to missing cold-boot
  high-score defaults.
- 2026-05-20: Phase 6 L1 -> L2 diagnostic route-search checkpoint. Scratch
  no-seed runtime L1 state exported to
  `/tmp/marble-love/boot-flow/bootflow_l1_runtime_diagnostic_f1000.seed.json`
  for probe use only. Search manifest
  `/tmp/marble-love/boot-flow/phase6-l1-l2-route-search-live-f2400-deaths3/manifest.json`
  did not hit `main=3` or target descriptor L2 `0x0002c54c` within 2400 frames;
  best candidates remain on descriptor L1 `0x0002bee2` with one death/recovery.
  Not a green proof; L1 -> L2 still needs a user/manual or MAME route that
  actually completes Practice from the bootFlow runtime path.
- 2026-05-20: Phase 6 manual browser confirmation received from user:
  `bootFlow=1` completed three levels and progression continued well. Treat as
  green manual proof for at least L1 -> L2 -> L3 -> L4 through runtime without
  runtime seed loads, superseding the diagnostic route-search miss for early
  progression. Residual post-game-over visual: yellow/red terrain remains for a
  few seconds, then a black reset window, then demo mode. Screenshot
  `/Users/magnus-bot/Desktop/schermata nera.png` shows the black window at
  `f=14190 main=1 mode=0 level=0 scroll=(0,340)`, `timer=0`, player
  `a=3 st=6`.
- 2026-05-20: User asked to proceed with item 2 and treat level progression as
  closed for this pass. Phase 5 post-game-over visual fix implemented locally.
  First root cause: cold boot did not initialize the default high-score struct
  pointer/table (`*0x401FFC = 0x401E74`, table at `0x401E92`), so a timeout
  score of 140 ranked against an all-zero table and `FUN_1101E` skipped the
  staged mode2 reset. User then supplied screenshots
  `/Users/magnus-bot/Desktop/1.png`, `/Users/magnus-bot/Desktop/2.png`, and
  `/Users/magnus-bot/Desktop/3.png`, showing a second case after later-level
  play: `main=2/mode=2/level=4` game-over transitions to
  `main=1/mode=2/level=1` while old terrain remains visible, then to a black
  reset window. Second root cause: score-qualified `objectSlotLookup11B18`
  returned 1 even though the interactive initials/high-score flow was not wired,
  so `FUN_1101E` skipped the staged reset. The default unwired qualifying flow
  now returns 0 and lets mode2 reset run. Files touched:
  `packages/engine/src/high-score-defaults.ts`,
  `packages/engine/src/boot-init.ts`,
  `packages/engine/src/object-slot-lookup-11b18.ts`,
  `packages/engine/test/boot-init.test.ts`,
  `packages/engine/test/main-loop-init-task-a.test.ts`,
  `packages/engine/test/object-slot-lookup-11b18.test.ts`, `GOAL.md`, and this
  PRD. Evidence for the first case:
  `/tmp/marble-love/boot-flow/phase5-gameover-summary.json` and
  `/tmp/marble-love/boot-flow/phase5-gameover-probe.log`; stale level playfield
  now clears on the frame after the attract handoff (`f3965`), and `t4100`
  reports playfield count 234 instead of 4183. `packages/engine/test/boot-init.test.ts`
  also proves the exact same default table is initialized from
  `ghidra_project/marble_program.bin`. Evidence for the score-qualified
  later-level case:
  `/tmp/marble-love/boot-flow/phase5-highscore-gameover-probe.log`; a synthetic
  `level=4` game-over with score `0x004000` starts mode2 reset and clears
  playfield from 8192 to 0 at `advance1`. Added
  `packages/engine/test/main-tick.test.ts` coverage proving staged mode2 reset
  clears stale post-game-over playfield through `mainTick`. Validation passed:
  `npx vitest run packages/engine/test/boot-init.test.ts packages/engine/test/main-tick.test.ts packages/engine/test/object-slot-lookup-11b18.test.ts packages/engine/test/main-loop-init-task-a.test.ts --silent`;
  `npx vitest run packages/engine/test/object-slot-lookup-11b18.test.ts packages/engine/test/boot-init.test.ts packages/engine/test/main-loop-init-task-a.test.ts packages/engine/test/playable-live-routes.test.ts --silent`;
  `npx vitest run packages/web/test/boot-flow-url.test.ts packages/web/test/coin-start-flow.test.ts packages/web/test/practice-level.test.ts --silent`
  (also guards explicit `playableSeed`, `startLevel`, `mameDump`, and
  `mameLive` diagnostics away from `bootFlow`/coin-start seed prep);
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false`;
  `npx tsc -p packages/web/tsconfig.json --noEmit --pretty false`;
  `npm --workspace @marble-love/web run build`; `npm run context:audit`;
  `npm run typecheck`; `npm run lint`; `npm run test -- --silent` (259 test
  files passed, 3 skipped; 2260 tests passed, 17 skipped); `git diff --check`.
  Manual URL for commit gate:
  `http://192.168.85.200:5173/?autoLoad=1&bootFlow=1&debugState=1&sound=0`.
  Result: automated green. Manual browser confirmation received from user: the
  yellow/red later-level terrain no longer appears after `GAME OVER`. Screenshot
  `/Users/magnus-bot/Desktop/finisce.png` now shows the high-score/default table
  with credits 0. Residual for the next phase: score-qualified high-score
  initials/save is not implemented; the current unwired `FUN_11B18` fallback
  intentionally proceeds to reset/demo instead of pretending the initials flow
  completed and leaving stale terrain visible. Latest pre-commit rerun passed:
  `npx vitest run packages/web/test/boot-flow-url.test.ts packages/web/test/coin-start-flow.test.ts packages/web/test/practice-level.test.ts packages/engine/test/boot-init.test.ts packages/engine/test/main-tick.test.ts packages/engine/test/object-slot-lookup-11b18.test.ts packages/engine/test/main-loop-init-task-a.test.ts packages/engine/test/playable-live-routes.test.ts --silent`
  (8 files, 64 tests); engine/web targeted typechecks; web build (known Vite
  chunk-size warning only); `git diff --check`.
- 2026-05-20: Phase 5 post-game-over follow-up committed and pushed as
  `c6fca62` (`fix: clear cold boot game-over transition`). Current next gap is
  score-qualified high-score initials/save after game over.
- 2026-05-20: High-score save follow-up started from user report
  `/Users/magnus-bot/Desktop/finisce.png`: the terrain bug is gone, but a
  score-qualified game-over reaches the high-score/default table and then
  resets/demo without saving. Targeted disassembly shows original `FUN_11B18`
  renders the inserted row, blocks on an interactive initials loop, then calls
  `FUN_428E` to register a score/initials record into the table at
  `*0x401FFC + 0x1E`. Added a deterministic `FUN_428E` replica in
  `packages/engine/src/high-score-register-428e.ts` and wired the unwired
  `FUN_11B18` fallback to register the score with the current player initials
  before returning 0 to the staged reset path. This is an incremental save
  fallback only; full interactive initials editing still needs an async
  `FUN_11B18` phase. Focused validation passed:
  `npx tsx packages/cli/src/test-high-score-register-428e-parity.ts 500`
  (500/500 against the binary for caller-valid ranks and positive
  out-of-range ranks);
  `npx vitest run packages/engine/test/high-score-register-428e.test.ts packages/engine/test/object-slot-lookup-11b18.test.ts packages/engine/test/main-loop-init-task-a.test.ts packages/engine/test/boot-init.test.ts packages/engine/test/main-tick.test.ts --silent`;
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false`;
  `git diff --check`. The `FUN_1101E` integration test now asserts a
  score-qualified game-over inserts row 0 as `0040000669` (`0x4000`, `AAA`)
  while still starting staged mode2 reset. Broader validation also passed:
  `npx vitest run packages/web/test/boot-flow-url.test.ts packages/web/test/coin-start-flow.test.ts packages/web/test/practice-level.test.ts packages/engine/test/high-score-register-428e.test.ts packages/engine/test/object-slot-lookup-11b18.test.ts packages/engine/test/main-loop-init-task-a.test.ts packages/engine/test/boot-init.test.ts packages/engine/test/main-tick.test.ts --silent`
  (8 files, 53 tests); engine/cli/web targeted typechecks; web build (known
  Vite chunk-size warning only); `npm run typecheck`; `npm run lint`;
  `npm run context:audit`; `git diff --check`.
- 2026-05-20: High-score save fallback committed and pushed as `00342f9`
  (`fix: save high score fallback on game over`). Remaining gap: full
  interactive initials editing in async `FUN_11B18`; the committed fallback
  saves with the player's current initials.
