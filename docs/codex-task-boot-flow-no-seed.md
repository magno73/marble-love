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

## Phase 6.5 - Interactive High-Score Initials Entry

Purpose: after a score-qualified game over in the boot-flow runtime path, show
and run the original-style initials entry flow instead of silently saving with
the current initials fallback.

Why this is required:

- The current `FUN_11B18` implementation ranks the score and calls the
  deterministic `FUN_428E` register tail with the player's current initials.
- That fallback is useful to avoid losing scores and to keep reset/demo clean,
  but it is not the arcade high-score entry behavior.
- User playtest confirmed the score-qualified table appears, but initials
  cannot be changed.

Allowed files:

- `packages/engine/src/object-slot-lookup-11b18.ts`
- `packages/engine/src/high-score-register-428e.ts` only if the register tail
  contract needs a tighter boundary
- `packages/engine/src/main-loop-init-1101e.ts`
- engine state/input modules needed for an async initials cursor
- `packages/web/src/main.ts` or web input modules only to route existing
  keyboard/trackball inputs into the initials flow
- focused engine/web tests
- this PRD and `GOAL.md`

Implementation approach:

1. Treat `FUN_11B18` as an async/stateful routine for qualifying scores:
   - render the insert row;
   - allow the player to choose initials;
   - call `FUN_428E` only after entry is accepted;
   - then continue the existing reset/demo path without stale playfield.
2. Use the fallback current-initials register path only as a diagnostic or
   emergency path, not as the normal score-qualified browser behavior.
3. Preserve non-qualifying score behavior and the clean post-game-over reset
   already fixed in Phase 5.
4. Keep input mapping consistent with existing controls. Document the manual
   controls used for initials entry.
5. Do not change high-score table format, seed files, level progression, or
   default URL routing as part of this phase.

Suggested validation:

```sh
npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false
npx tsc -p packages/web/tsconfig.json --noEmit --pretty false
npx vitest run \
  packages/engine/test/high-score-register-428e.test.ts \
  packages/engine/test/object-slot-lookup-11b18.test.ts \
  packages/engine/test/main-loop-init-task-a.test.ts \
  packages/engine/test/main-tick.test.ts \
  packages/web/test/coin-start-flow.test.ts --silent
npm --workspace @marble-love/web run build
git diff --check
```

Manual/browser check:

- `?autoLoad=1&bootFlow=1&debugState=1&sound=0`
- Play or inject a score-qualified game over.
- Confirm the initials entry screen accepts input and updates the selected
  initials before saving.
- Confirm the saved row uses the selected initials, not always `AAA`.
- Confirm reset/demo resumes without stale terrain and without losing credits
  display integrity.

Acceptance:

- Score-qualified game over enters an interactive initials-entry state.
- Player can change initials and accept/save them.
- High-score table stores and displays the chosen initials.
- Non-qualifying scores still skip initials entry.
- Existing fallback save remains covered if kept, but is no longer the normal
  score-qualified path.
- Existing `startLevel=1..6`, `playableSeed=NAME`, and bootFlow level
  progression remain untouched.

Commit gate:

- Commit only after automated validation and browser/manual confirmation that
  initials can be changed and saved.

Suggested commit message:

```text
fix: add interactive high score initials entry
```

## Phase 6.6 - Progressed Runtime Sprite And Collision Parity

Purpose: after the user can progress level-by-level from `bootFlow=1`, prove
that progressed no-seed runtime levels contain the same actionable sprites and
collision semantics as the seed diagnostic checkpoints. A level transition is not
green if it reaches the next board but drops visible objects, object motion, or
physical interaction that the corresponding original path has.

Current user evidence:

- `/Users/magnus-bot/Desktop/bug1.png` and
  `/Users/magnus-bot/Desktop/bug2.png` are in the L3/Intermediate runtime family
  (`debug level=2`). Green objects are visible, but user reports that touching
  them has no effect. The screenshots currently show terrain-slot telemetry
  (`tag=0x10` and `tag=0x20`), not enough by itself to justify a physics change.
- `/Users/magnus-bot/Desktop/bug3.png` is in the L5/Silly runtime family
  (`debug level=4`). Collision telemetry still records a live `tag=0x0c` case,
  but user reports missing sprites in the brown-square area compared with the
  seed path.
- `/Users/magnus-bot/Desktop/onda.png` is a post-Phase-7 L3/Intermediate
  follow-up. User reports that only the first/left green wave has physics. The
  screenshot shows visible/moving wave script slots with `tag=0x06` and nearby
  collision slots with `tag=0x05`; current ROM evidence still treats `tag=0x06`
  as a no-op in `FUN_29CCE`, so do not add direct `tag=0x06` bumper physics
  without new MAME proof.
- `/Users/magnus-bot/Desktop/bugx.png` is the browser rejection of the
  `FUN_11AC2` hypothesis: after wiring the `0x40075c` path, the user reports
  that even the previously working first/left wave no longer has physics. Keep
  `FUN_11AC2` unwired unless a new MAME proof requires it.
- `/Users/magnus-bot/Desktop/s1.png` and `/Users/magnus-bot/Desktop/s2.png`
  are the decisive `wave terrain` captures. In both, the marble is on a
  visible/contacted `tag=0x06` wave slot while the nearest `tag=0x05` slots are
  far away. The local `tag=0x06` bumper/hitbox hypothesis was falsified by ROM
  proof and removed. Keep the overlay diagnostic-only: `rom05q` is the original
  `tag=0x05` proximity denominator and is not evidence of `tag=0x06` physics.

Allowed files:

- engine sprite/object/collision files implicated by MAME or structured probes;
- focused CLI/oracle probes for current runtime-vs-seed comparison;
- web debug overlay only if it records object/sprite state and does not change
  gameplay;
- focused engine/web tests;
- this PRD, `GOAL.md`, and the sprite-visibility PRD.

Implementation approach:

1. For `bug1`/`bug2`, compare the same L3/Intermediate area against MAME or the
   seed diagnostic path and identify whether the green visual object is meant to
   be decorative, blocking, a hazard, or tied to a separate missing collision
   slot. Do not widen `FUN_29CCE`, add screen-space hitboxes, or attach physics
   to visual type14/string sprites without original-path proof.
2. For `bug3`, compare progressed `bootFlow=1` L5/Silly state against
   `startLevel=5`/seed diagnostics around the brown-square area. Determine
   whether type7/8/9 objects are absent upstream, present but inactive/out of
   range, emitted to motion-object RAM and culled, or lost in the web renderer.
3. Add the smallest proven runtime fix. Preserve `startLevel=1..6` and
   `playableSeed=NAME`; do not edit seed JSON.
4. Ask for manual/browser retest on the exact `bug1`/`bug2`/`bug3` areas after
   focused automated gates pass.

Suggested validation:

```sh
npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false
npx tsc -p packages/web/tsconfig.json --noEmit --pretty false
npx vitest run \
  packages/engine/test/late-game-logic-26f3e.test.ts \
  packages/engine/test/string-range-dispatch-17346.test.ts \
  packages/engine/test/sub-29cce.test.ts --silent
npm --workspace @marble-love/web run build
git diff --check
```

Acceptance:

- `bug1`/`bug2` have MAME/reference-backed classification and either matching
  physical behavior or documented proof that the visible objects are decorative
  in the original path.
- `bug3` shows the expected L5/Silly sprites in progressed no-seed runtime, or
  has MAME/reference proof explaining why the seed diagnostic differs.
- No seed diagnostic behavior changes.
- User retest confirms the specific reported areas.

Commit gate:

- Commit only after focused validation and user/manual confirmation for the
  affected areas. This phase blocks the Phase 7 default-path switch.

## Phase 7 - Make Boot Flow The Default Play Path

Purpose: switch the normal user-facing play URL to the no-seed runtime path only
after Phases 1-6, the interactive high-score initials phase, and Phase 6.6
runtime sprite/collision parity are green.

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
   - score-qualified high-score initials entry is interactive and saves chosen
     initials;
   - progressed runtime sprite/collision parity for the reported `bug1`/`bug2`/
     `bug3` areas is green;
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
- Progressed runtime sprite/collision parity is green for the `bug1`/`bug2`/
  `bug3` areas, or any remaining difference has MAME/reference proof and is not
  a hidden seed dependency.
- Score-qualified game over supports interactive initials entry and saves the
  chosen initials.
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
- 2026-05-20: Rechecked the visual cold-boot cadence directly in MAME after
  the user asked whether the rapid browser succession of level screens matches
  the arcade. Fresh clean no-input MAME run:
  `/tmp/marble-love/boot-flow/mame-visual-cadence-20260520170512/summary.json`
  (generated from `oracle/mame_state_multidump.lua` with clean cfg/nvram,
  `-nonvram_save`, and 300-frame samples through f12000). MAME does alternate
  level/attract presentation and high-score/table states, but not at the
  compressed TS/web speed: f600-f1200 is visible `main=1/mode=0/level=0`, then
  f1500-f1800 is `mode=2`, f2100-f2700 is visible `level=1/b3e4=2`, and the
  cycle continues until `mode=3` around f11400. Current TS summary copied to
  `/tmp/marble-love/boot-flow/mame-visual-cadence-20260520170512/ts-summary-current.json`
  still reaches visible level/presentation states in the first 5-30 frames.
  Conclusion: the browser's rapid succession is a known cold-attract cadence
  gap versus MAME, not evidence that seeds are being loaded at runtime.
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
- 2026-05-20: High-score visible refresh follow-up started from the same
  `finisce.png` report: saving the score in RAM is not enough if the
  post-game-over screen still shows the pre-insert table. Local change wires
  the fallback registration path to call the existing `FUN_11FF8` table
  renderer after `FUN_428E` succeeds, so a score-qualified game over should
  show the saved row before the reset/demo path continues. Files touched:
  `packages/engine/src/object-slot-lookup-11b18.ts`,
  `packages/engine/src/main-loop-init-1101e.ts`,
  `packages/engine/test/object-slot-lookup-11b18.test.ts`,
  `packages/engine/test/main-loop-init-task-a.test.ts`, `GOAL.md`, and this
  PRD. Focused validation so far:
  `npx vitest run packages/engine/test/main-loop-init-task-a.test.ts packages/engine/test/object-slot-lookup-11b18.test.ts --silent` PASS;
  `npx vitest run packages/engine/test/helper-11ff8.test.ts packages/engine/test/main-loop-init-task-a.test.ts packages/engine/test/object-slot-lookup-11b18.test.ts --silent`
  PASS;
  `npx vitest run packages/engine/test/object-slot-lookup-11b18.test.ts packages/engine/test/main-loop-init-task-a.test.ts packages/engine/test/high-score-register-428e.test.ts packages/engine/test/boot-init.test.ts packages/engine/test/main-tick.test.ts --silent`
  PASS; `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false`
  PASS after fixing `exactOptionalPropertyTypes` handling; bootFlow/web
  focused vitest set PASS; engine/web targeted typechecks PASS; web build PASS
  with the known Vite chunk-size warning; `npm run typecheck` PASS; `npm run
  lint` PASS; `npm run context:audit` PASS; full `npm run test -- --silent`
  PASS (260 passed, 3 skipped; 2267 tests passed, 17 skipped); `git diff
  --check` PASS. Headless Chrome browser validation also PASS:
  `/tmp/marble-love/boot-flow/highscore-refresh-browser-summary.json` shows the
  browser runtime table row 0 changing from `0038a412d2` (`C R 14,500`) to
  `0040000669` (`AAA 16,384`) after a score-qualified game-over injection, with
  the previous row shifted to row 1 and staged reset active at
  `main=1/mode=2`. Screenshot:
  `/tmp/marble-love/boot-flow/highscore-refresh-browser.png`. Result: browser
  and automated green for the focused path. This remains an
  automatic-current-initials fallback, not the full interactive initials editor.
- 2026-05-20: High-score visible refresh follow-up committed and pushed as
  `0e09ef7` (`fix: refresh high score after fallback save`).
- 2026-05-20: Phase 7 readiness checkpoint. Worktree clean after
  `c72fc95`; Phase 7 remains gated by the PRD requirement that the user
  explicitly approve making `?autoLoad=1&play=1` default to the cold boot
  no-seed path. No default-path code change has been made yet. Next approved
  implementation must preserve explicit `startLevel=1..6` and
  `playableSeed=NAME` seed diagnostics, update README/STATUS, and run the full
  Phase 7 validation.
- 2026-05-20: Manual high-score follow-up from
  `/Users/magnus-bot/Desktop/Screenshot 2026-05-20 alle 16.00.25.png`: a real
  browser run reaches the refreshed high-score table after a score-qualified
  game. The visible screen is the automatic-current-initials fallback, not a
  wired interactive initials editor. No initials-entry controls are available
  yet; full async `FUN_11B18` remains a separate gap.
- 2026-05-20: Phase 7 diagnostic preflight retry before any default-path
  change. Evidence:
  `/tmp/marble-love/boot-flow/phase7-preflight-seed-diagnostics-retry.json`.
  Headless Chrome confirmed current `?autoLoad=1&play=1&sound=0` still prepares
  the seed-backed `start_level1_intro_practice_f2479` coin/start path;
  `?autoLoad=1&startLevel=1..6&debugState=1&sound=0` each fetched HTTP 200 and
  logged the expected true-start seed; `startLevel=3` succeeded twice, so the
  earlier browser fetch failure is treated as a transient flake unless it
  recurs; explicit
  `?autoLoad=1&playableSeed=start_level1_intro_practice_f2479&play=1&sound=0`
  still loads as a diagnostic seed; and
  `?autoLoad=1&bootFlow=1&startLevel=1&sound=0` still fails loudly with the
  bootFlow conflict message and no seed fetch. Result: seed diagnostics are
  green pre-Phase-7; the default switch remains gated by explicit user
  approval.
- 2026-05-20: Phase 7 completion audit. Current code and docs still prove the
  final objective is incomplete by design: `packages/web/src/boot-flow-url.ts`
  returns the seed-backed coin/start route for default `play=1`, the matching
  web test still asserts that pre-Phase-7 behavior, and README/STATUS still say
  START loads the L1 true-start seed. Approved Phase 7 patch must flip that
  default path to cold boot no-seed, update those docs, preserve
  `startLevel=1..6` and `playableSeed=NAME`, then run the full Phase 7
  validation. No runtime change made because explicit approval is still the
  commit gate.
- 2026-05-20: User confirmed the high-score initials editor must be
  implemented, not left as the automatic-current-initials fallback. Added
  Phase 6.5 as a required gate before the Phase 7 default-path switch. The
  updated acceptance requires score-qualified game over to enter an
  interactive initials-entry state, let the player change and accept initials,
  save the chosen initials into the high-score table, and then resume the clean
  reset/demo flow. No runtime code changed in this checkpoint.
- 2026-05-20: Phase 6.5 implementation committed and pushed as `658be42`
  (`fix: add interactive high score initials entry`). Files touched:
  `packages/engine/src/high-score-initials-entry.ts`,
  `packages/engine/src/state.ts`, `packages/engine/src/object-slot-lookup-11b18.ts`,
  `packages/engine/src/main-loop-init-1101e.ts`,
  `packages/engine/src/main-tick.ts`, `packages/web/src/main.ts`, and focused
  tests. Runtime behavior now starts an async initials-entry state for
  score-qualified game over, blocks the main-thread reset until START accepts,
  lets vertical trackball/up-down keys cycle the selected letter and
  horizontal trackball/left-right keys move the cursor, then calls `FUN_428E`
  and resumes mode-2 reset. Browser evidence:
  `/tmp/marble-love/boot-flow/highscore-initials-entry-browser-summary.json`
  and `/tmp/marble-love/boot-flow/highscore-initials-entry-browser.png`; the
  smoke starts from `bootFlow=1`, injects a score-qualified game-over state,
  shows overlay `HIGH SCORE #1`, edits `AAA` to `CAA`, saves table row
  `00400012e9`, hides the overlay, and keeps playfield nonzero count at 0
  during entry. Validation passed: focused high-score/main-loop vitest set,
  engine/web typechecks, web URL/input tests, lint, web build,
  `npm run typecheck`, full `npm run test -- --silent` (261 passed, 3 skipped
  test files; 2271 passed, 17 skipped tests), `npm run context:audit`, and
  `git diff --check`. Result: Phase 6.5 is green; next gate is Phase 7 user
  approval for the default `play=1` switch.
- 2026-05-20: New Phase 6.6 opened from user screenshots
  `/Users/magnus-bot/Desktop/bug1.png`,
  `/Users/magnus-bot/Desktop/bug2.png`, and
  `/Users/magnus-bot/Desktop/bug3.png`. Level-to-level progression remains
  mechanically accepted from manual play, but content parity is not green:
  `bug1`/`bug2` show L3/Intermediate visible green objects that the user reports
  as nonphysical, while current overlay evidence only identifies terrain-slot
  tags `0x10` and `0x20`; `bug3` shows the L5/Silly runtime family with live
  `tag=0x0c` collision telemetry but missing brown-square sprites compared with
  the seed diagnostic. Added a diagnostic-only web overlay patch in
  `packages/web/src/main.ts` to print draw-list entity type/sub rows, active
  `string14` slots, and the L5/Silly `silly7-9` entity table. This does not
  change gameplay, collisions, renderer output, or seed loading. Validation
  passed:
  `npx tsc -p packages/web/tsconfig.json --noEmit --pretty false`;
  `npx vitest run packages/web/test/boot-flow-url.test.ts packages/web/test/coin-start-flow.test.ts packages/web/test/practice-level.test.ts --silent`;
  `npm --workspace @marble-love/web run build`;
  `npm run context:audit`; `git diff --check`. Phase 7 is blocked until
  Phase 6.6 is classified, fixed where needed, and manually retested.
- 2026-05-21: User retested with timer 300 and saved
  `/Users/magnus-bot/Desktop/bug1new.png`,
  `/Users/magnus-bot/Desktop/bug2new.png`, and
  `/Users/magnus-bot/Desktop/bug3new.png`. The screenshots confirm the same
  families: `bug1new`/`bug2new` are L3/Intermediate (`debug level=2`) with
  terrain-slot tags `0x10` and `0x20`; `bug3new` is L5/Silly
  (`debug level=4`) with live `tag=0x0c` collision telemetry. The new
  object-census lines existed but were below the visible portion of the full
  overlay, so `packages/web/src/main.ts` now moves `draw-list`, `string14`, and
  `silly7-9` to the top of both full and compact overlays. Validation after the
  reorder passed:
  `npx tsc -p packages/web/tsconfig.json --noEmit --pretty false`;
  `npx vitest run packages/web/test/boot-flow-url.test.ts packages/web/test/coin-start-flow.test.ts packages/web/test/practice-level.test.ts --silent`;
  `npm --workspace @marble-love/web run build`;
  `npm run context:audit`;
  `git diff --check`.
- 2026-05-21: User saved `/Users/magnus-bot/Desktop/bug1n.png`,
  `/Users/magnus-bot/Desktop/bug2n.png`, and
  `/Users/magnus-bot/Desktop/bug3n.png` after the compact overlay reorder.
  New classification: `bug1n` shows active `string14` slots for the visible
  green blobs, so no terrain collision branch should be invented from that
  screenshot alone; `bug2n` shows L3 terrain/script slots with tags `0x05` and
  `0x06`, which remain the collision-semantics candidate needing proof;
  `bug3n` shows `silly7-9 -` and only the player in the draw-list, which moves
  the L5/Silly missing-brown-square issue upstream to array-9 spawn. Disasm
  `0x18FFA..0x190ED` confirms `FUN_18FFA` initializes nine type7/8/9 entries,
  validates random positions through `FUN_1937C`, updates them via
  `FUN_194BA`/`FUN_199D6`, and inserts them through `FUN_18E6C`; the active
  patch wires that default and the paired `FUN_190EE` clear path in
  `scrollRange144E4`.
- 2026-05-21: L5/Silly array-9 spawn fix local validation passed. Added
  `packages/engine/src/array-9-init-and-dispatch-18ffa.ts`, exported it, wired
  default `FUN_18FFA`/`FUN_190EE` from `scrollRange144E4`, added focused engine
  tests, and corrected the web debug draw-list decoder to read rect slots from
  work RAM. Validation:
  `npx vitest run packages/engine/test/array-9-init-and-dispatch-18ffa.test.ts --silent`;
  `npx vitest run packages/engine/test/array-9-init-and-dispatch-18ffa.test.ts packages/engine/test/array-9-clear-and-dispatch.test.ts packages/engine/test/scroll-range-144e4.test.ts packages/engine/test/refresh-frame-10fce.test.ts packages/engine/test/late-game-logic-26f3e.test.ts --silent`;
  `npx vitest run packages/web/test/boot-flow-url.test.ts packages/web/test/coin-start-flow.test.ts packages/web/test/practice-level.test.ts --silent`;
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false`;
  `npx tsc -p packages/web/tsconfig.json --noEmit --pretty false`;
  `npx tsc -p packages/cli/tsconfig.json --noEmit --pretty false`;
  `npm run typecheck`;
  `npm --workspace @marble-love/web run build`;
  `npm run context:audit`;
  `git diff --check`. Manual browser retest remains required; expected overlay
  evidence is `silly7-9` populated and `draw-list` showing type `7/8/9` entries
  in the previous `bug3n` area.
- 2026-05-21: Manual retest update from
  `/Users/magnus-bot/Desktop/bug3nn.png`,
  `/Users/magnus-bot/Desktop/bug1nn.png`, and
  `/Users/magnus-bot/Desktop/bug2nn-x.png`. `bug3nn` confirms the L5/Silly
  fix in browser: the previously empty `silly7-9` table is populated and the
  draw-list contains type `7/8/9` rows. `bug1nn` keeps Phase 6.6 open because
  active `string14` slots are visible but nonphysical; code inspection shows
  `helper121B8` called `stringViewportHit175C8` without wiring its original
  `FUN_25BAE(obj,9)` and `FUN_158AC(0x5e)` side effects. Current patch wires
  those callbacks through the existing runtime `fun_25bae`/`fun_158ac` hooks,
  preserves the modeled `D0` post-call sprite update, and adds compact overlay
  evidence for `last state ... FUN_121B8/FUN_175C8 ... code=9`. Focused
  validation passed:
  `npx vitest run packages/engine/test/helper-121b8.test.ts packages/engine/test/string-viewport-hit-175c8.test.ts --silent`.
  Broader local validation passed after the patch:
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false`;
  `npx tsc -p packages/web/tsconfig.json --noEmit --pretty false`;
  `npx vitest run packages/engine/test/helper-121b8.test.ts packages/engine/test/string-viewport-hit-175c8.test.ts packages/engine/test/array-9-init-and-dispatch-18ffa.test.ts packages/engine/test/scroll-range-144e4.test.ts --silent`;
  `npx vitest run packages/web/test/boot-flow-url.test.ts packages/web/test/coin-start-flow.test.ts packages/web/test/practice-level.test.ts --silent`;
  `npm run typecheck`;
  `npm --workspace @marble-love/web run build` (known Vite chunk-size
  warning);
  `npm run context:audit`;
  `npm run lint`;
  `git diff --check`.
  `bug2nn-x` is classified separately: tag `0x05` repels on the left side, tag
  `0x06` remains non-repelling on the right side, and the current original
  `FUN_29CCE` evidence treats tag `0x06` as a no-op jump-table entry. Do not
  add tag `0x06` physics unless a MAME trace proves that the boot-flow runtime
  assigned the wrong tag or that the previous disassembly owner is incomplete.
- 2026-05-21: User saved `/Users/magnus-bot/Desktop/bug1e.png` and
  `/Users/magnus-bot/Desktop/bug2e.png`. `bug1e` proves the prior
  `FUN_175C8` callback wiring did not yet close the green `string14` issue:
  the overlay still reports the older `FUN_121B8/bounce-below-target code=4`
  and never the expected `FUN_121B8/FUN_175C8 code=9`. Root cause is now
  classified as ROM-backed bbox resolution. In real string slots, `slot+0x3a`
  is the current animation/frame cursor and can point into ROM; `FUN_175C8`
  must read the cursor target and bbox bytes through ROM/RAM absolute reads,
  while the previous replica only read work RAM. Active patch:
  `packages/engine/src/string-viewport-hit-175c8.ts` accepts an optional ROM
  and uses it for the double deref and bbox bytes; `helper121B8` passes its
  current ROM into the default call; tests cover both direct `FUN_175C8` and
  helper integration through a ROM cursor. Focused validation passed:
  `npx vitest run packages/engine/test/string-viewport-hit-175c8.test.ts packages/engine/test/helper-121b8.test.ts --silent`;
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false`.
  `bug2e` remains a distinct wave/tag issue: current screenshot shows the
  marble on the `tag=0x06` side. Static ROM jump-table check using the prepared
  `/tmp/marble-love/marble_program.bin` confirms tag `0x05 -> 0x029f40`
  (proximity bumper) while tag `0x06 -> 0x02b072` (common iter-epilog no-op).
  Added `packages/engine/test/sub-29cce.test.ts` coverage locking tag `0x06`
  as no-op. Focused validation now passes:
  `npx vitest run packages/engine/test/sub-29cce.test.ts packages/engine/test/string-viewport-hit-175c8.test.ts packages/engine/test/helper-121b8.test.ts --silent`
  (`76` tests);
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false`.
  Broader validation also passed after the latest patch:
  web and CLI targeted typechecks, root `npm run typecheck`, focused engine set
  including string/helper/terrain/array-9/scroll-range (`101` tests), web
  boot-flow URL tests (`12` tests), web build with the known chunk-size
  warning, `npm run lint`, `npm run context:audit`, and `git diff --check`.
- 2026-05-21: User saved `/Users/magnus-bot/Desktop/bug1a.png`. This confirms
  the ROM-bbox `FUN_175C8` patch made the L3 green `string14` blobs physically
  affect the marble: overlay shows
  `last state ... FUN_121B8/FUN_175C8 ... code=9`. The new failure is that the
  player remains in `st=9` and the game stops advancing after the hit. Root
  cause found in `FUN_253EC`: ROM jump-table entry `JT[9] = 0x2584e` was still
  missing from the TypeScript dispatcher, so state 9 fell into the conservative
  fallback. Active patch adds the original sequence
  `FUN_176D2(obj); FUN_25FC2(obj); FUN_1B9CC(obj,1); FUN_1281C(obj)` and makes
  `FUN_176D2` ROM-aware for the same string slot cursor/bbox chain. Focused
  validation passed:
  `npx vitest run packages/engine/test/string-target-step-176d2.test.ts packages/engine/test/refresh-frame-10fce.test.ts --silent`;
  Phase 6.6 focused engine validation passed:
  `npx vitest run packages/engine/test/sub-29cce.test.ts packages/engine/test/string-viewport-hit-175c8.test.ts packages/engine/test/helper-121b8.test.ts packages/engine/test/string-target-step-176d2.test.ts packages/engine/test/refresh-frame-10fce.test.ts packages/engine/test/array-9-init-and-dispatch-18ffa.test.ts packages/engine/test/scroll-range-144e4.test.ts --silent`
  (`131` tests); engine/web/CLI targeted typechecks also passed. User also
  reports that some green blobs appear to move outside the terrain. Current
  evidence says those blobs are real active runtime `string14` slots; treat the
  placement/pathing as a separate grey item and do not clamp or offset them
  without MAME/reference proof.
- 2026-05-21: User confirmed the `JT[9]` patch fixes the post-hit freeze:
  green blobs now kill the marble and the normal respawn follows. User saved
  `/Users/magnus-bot/Desktop/bug1b.png` for the remaining green-blob pathing
  issue. The overlay shows active `string14` slots with ROM bases including
  `0x23fb2`, `0x23f66`, and `0x23f1a`; those bases are real ROM waypoint
  streams, not terrain/render offsets. Root cause found: `FUN_1D1EC` and
  `FUN_1D242` only read waypoint bytes from work RAM, so ROM-resident cursors
  read as zero and drove the blobs diagonally toward `(0,0)`, producing the
  off-terrain drift. ROM inspection confirms nonzero path bytes, for example
  `0x23f66: 43 46 01 00, 4a 46 02 00, 4a 48 03 00...`. Active patch makes the
  waypoint reads ROM-aware and passes the ROM from `FUN_1725A` and
  `scrollRange144E4`. Focused validation passed:
  `npx vitest run packages/engine/test/entity-waypoint-step-1d1ec.test.ts packages/engine/test/string-step-1725a.test.ts packages/engine/test/string-target-step-176d2.test.ts packages/engine/test/refresh-frame-10fce.test.ts --silent`;
  broader Phase 6.6 focused validation passed:
  `npx vitest run packages/engine/test/entity-waypoint-step-1d1ec.test.ts packages/engine/test/string-step-1725a.test.ts packages/engine/test/string-range-dispatch-17346.test.ts packages/engine/test/scroll-range-144e4.test.ts packages/engine/test/sub-29cce.test.ts packages/engine/test/string-viewport-hit-175c8.test.ts packages/engine/test/helper-121b8.test.ts packages/engine/test/string-target-step-176d2.test.ts packages/engine/test/refresh-frame-10fce.test.ts packages/engine/test/array-9-init-and-dispatch-18ffa.test.ts --silent`
  (`143` tests); engine/web/CLI targeted typechecks also passed. Manual browser
  retest remains required before closing Phase 6.6.
- 2026-05-21: User manually confirmed the ROM-waypoint patch fixes the
  green-blob pathing issue: the L3 blobs now stay on their route, kill the
  marble, and respawn works. User explicitly approved promoting the no-seed
  flow to the default `?autoLoad=1&play=1` path. Phase 7 patch in progress:
  `packages/web/src/boot-flow-url.ts` now routes default `play=1` to boot flow
  while keeping explicit `startLevel=1..6`, `playableSeed=NAME`, scenario,
  `mameDump`, and `mameLive` URLs out of boot flow; `coinStart=1` remains a
  seed-backed fallback when used without `play=1`.
- 2026-05-21: Phase 7 local validation passed. Default `play=1` now routes to
  the cold boot no-seed flow, and explicit seed diagnostics remain preserved.
  Commands passed:
  `npx vitest run packages/web/test/boot-flow-url.test.ts packages/web/test/coin-start-flow.test.ts packages/web/test/practice-level.test.ts --silent`
  (`14` tests);
  `npx vitest run packages/engine/test/entity-waypoint-step-1d1ec.test.ts packages/engine/test/string-step-1725a.test.ts packages/engine/test/string-range-dispatch-17346.test.ts packages/engine/test/scroll-range-144e4.test.ts packages/engine/test/sub-29cce.test.ts packages/engine/test/string-viewport-hit-175c8.test.ts packages/engine/test/helper-121b8.test.ts packages/engine/test/string-target-step-176d2.test.ts packages/engine/test/refresh-frame-10fce.test.ts packages/engine/test/array-9-init-and-dispatch-18ffa.test.ts --silent`
  (`143` tests);
  `npx tsc -p packages/web/tsconfig.json --noEmit --pretty false`;
  `npm run typecheck`;
  `npm run lint`;
  `npm --workspace @marble-love/web run build` (known Vite chunk-size warning);
  `npm run context:audit`;
  `npm run test -- --silent` (`263` files passed, `3` skipped; `2285` tests
  passed, `17` skipped). Vite dev server HTTP smoke returned `200 OK` for
  default `play=1`, `startLevel=1`, explicit `playableSeed`, and explicit
  `bootFlow=1&startLevel=1` conflict URL.
- 2026-05-21: Phase 6.6 follow-up reopened from
  `/Users/magnus-bot/Desktop/onda.png`. User reports the L3/Intermediate green
  waves still have partial physics: only the first/left wave affects the
  marble. The screenshot shows mixed script-slot families, with
  visible/moving wave slots using `tag=0x06` and nearby collision slots using
  `tag=0x05`. Static ROM jump-table evidence still maps `tag=0x06` to the
  common iter epilog/no-op, so do not add direct `tag=0x06` collision behavior.
  A follow-up hypothesis wired `FUN_12FD0 -> FUN_11AC2` when `0x40075c` is
  nonzero; automated validation passed, but user retest
  `/Users/magnus-bot/Desktop/bugx.png` rejected it because even the previously
  working first/left wave lost physics. That code was removed before commit.
  The local diagnostic patch adds compact `wave terrain` data for active
  `tag=05/06` slots, with physical center, visual cursor words, deltas from the
  collision globals, and the `tag=0x05` ROM proximity denominator. This is
  observability only, not a gameplay fix.
- 2026-05-21: `bugx` diagnostic overlay validation passed:
  `npx vitest run packages/engine/test/refresh-frame-10fce.test.ts packages/engine/test/sub-29cce.test.ts --silent`
  (`55` tests);
  `npx vitest run packages/web/test/boot-flow-url.test.ts packages/web/test/coin-start-flow.test.ts packages/web/test/practice-level.test.ts --silent`
  (`14` tests);
  engine/web targeted typechecks;
  `npm --workspace @marble-love/web run build` (known Vite chunk-size warning);
  `npm run lint`; `npm run context:audit`; `git diff --check`. The Vite dev
  server on `*:5173` answers the wave-debug URL with `200 OK`.
- 2026-05-21: User saved `/Users/magnus-bot/Desktop/s1.png` and
  `/Users/magnus-bot/Desktop/s2.png`. Both captures show visible/contacted
  `tag=0x06` wave slots while the `tag=0x05` slots are distant. A local
  compatibility patch that mirrored the `tag=0x05` proximity bumper for
  `tag=0x06` was explored only as a hypothesis.
- 2026-05-21: User retest `/Users/magnus-bot/Desktop/s3.png` still did not
  bounce. The local debug overlay was extended with `last terrain wave
  candidate`, recorded inside `FUN_29CCE`, to distinguish end-of-frame
  geometry from physics-time candidates.
- 2026-05-22: User retests `/Users/magnus-bot/Desktop/bugnew1.png` and
  `/Users/magnus-bot/Desktop/bugnew2.png` plus the ROM probe changed the
  classification. Static jump-table proof maps `tag=0x05` to `0x029f40`
  (proximity bumper) and `tag=0x06` to `0x02b072` (iter epilog/no-op).
  `npx tsx packages/cli/src/probe-fun29cce-wave-rom.ts` executes original
  `FUN_29CCE` through the binary ROM oracle: `tag05_center_original_bumper`
  restores XY, negates vx/vy, sets both flags, and sends sound `0x42`;
  `tag06_center_original_noop` and `tag06_visible_body_offset_original_noop`
  leave position, velocity, flags, and sounds unchanged. Therefore direct
  `tag=0x06` bumper/hitbox semantics are rejected, and the current code keeps
  only diagnostic overlay/probe support.
- 2026-05-22: User checked original MAME visually and confirmed every green
  wave transports/pushes the marble, not only the first/left wave. New ROM proof
  found the missing upstream path: original `FUN_1D06A`, called from
  `FUN_13334` for script slots with `kind=6`, is not palette-only. Probe
  `npx tsx packages/cli/src/probe-fun1d06a-rom.ts` executes the ROM function
  and shows writes to `0x40076e..` with no color RAM or sound writes; for
  example args `0/1/2` patch `0x40076e..0x400785`, args `15/16` patch
  `0x40077a..0x400791`, and args `29/30` patch later entries. This is the
  original terrain-table lifecycle feeding `FUN_1CABA`/`FUN_25DF6`, so it
  explains MAME wave transport without inventing direct `tag=0x06` collision.
  Local patch adds `packages/engine/src/terrain-wave-update-1d06a.ts`, wires it
  through `refreshFrame10FCE` for `scriptSlotStep13068`/`helper12896`, and keeps
  `FUN_11AC2` unwired because the earlier browser test rejected that path.
  Automated gates passed:
  `npx vitest run packages/engine/test/terrain-wave-update-1d06a.test.ts packages/engine/test/object-render-update-13334.test.ts packages/engine/test/script-slot-step-13068.test.ts packages/engine/test/sub-29cce.test.ts --silent`
  (`63` tests);
  `npx vitest run packages/engine/test/refresh-frame-10fce.test.ts --silent`
  (`19` tests);
  `npx tsx packages/cli/src/probe-fun1d06a-rom.ts`;
  `npx tsx packages/cli/src/probe-fun29cce-wave-rom.ts`;
  engine/CLI/web targeted typechecks;
  `npm --workspace @marble-love/web run build` (known chunk-size warning).
  Manual browser retest is green: user confirmed the patch works and the later
  waves now push/transport the marble.
