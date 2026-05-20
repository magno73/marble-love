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

- Phase 5 follow-up: post-game-over visual cleanup after runtime play.
- Phase 6 progression has user/manual acceptance for this pass: user completed
  three levels from `bootFlow=1` and asked to treat level-to-level progression
  as closed.
- Phase 0 baseline/research is complete.
- Phase 1 gated `bootFlow=1` switch is committed and pushed as `9934721`
  (`feat: add gated cold boot flow flag`).
- Phase 2 research has started with compact TS-vs-MAME cold boot summaries.
- Existing seed diagnostics must remain intact: `startLevel=1..6` and
  `playableSeed=NAME`.

Next action:

1. Commit the Phase 5 follow-up after rerunning focused gates: user confirmed
   the seconds-long yellow/red terrain no longer appears after `GAME OVER`.
2. Treat high-score initials/save as the next material gap: screenshot
   `/Users/magnus-bot/Desktop/finisce.png` reaches the high-score/default
   table, but `FUN_11B18` still has no implemented interactive initials flow
   and falls back to reset/demo.
3. Keep the observed rapid attract level cycling as a cadence note, but do not
   hide it with seed/preload behavior.

## Current Evidence

- Phase 0 research note:
  `/tmp/marble-love/boot-flow/research.md`.
- Phase 2 cold-boot comparison artifacts:
  `/tmp/marble-love/boot-flow/phase2-mame-cold-boot-nonvram-summary.json`;
  `/tmp/marble-love/boot-flow/phase2-ts-cold-boot-summary.json`.
- Phase 2 finding: current `bootInit(...,{}) + runMainLoopBody=true` does not
  load seeds and reaches descriptor-backed attract states, but its main-thread
  cadence is ahead of MAME. Reproduced TS f12000 is `main=1 mode=3 level=0`
  with empty playfield while MAME f12000 is visible attract
  `main=1 mode=0 level=1 b3e4=1`.
- Phase 2 fix in progress: initialized the `mode=3` attract summary when mode0
  segment overflow wraps `b3e4 > 7` in both sync and staged `FUN_11452` paths.
  Reproduced TS f12000 now has timer `0x0091` and alpha summary content, then
  returns to visible mode0 attract by f12400 without a seed.
- Phase 2 automated validation PASS:
  `npx vitest run packages/engine/test/main-loop-init-task-a.test.ts packages/engine/test/main-tick.test.ts packages/web/test/boot-flow-url.test.ts packages/web/test/coin-start-flow.test.ts packages/web/test/practice-level.test.ts --silent`;
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false`;
  `npx tsc -p packages/web/tsconfig.json --noEmit --pretty false`;
  `npm --workspace @marble-love/web run build`;
  `git diff --check`.
- Phase 2 browser gate is pending user/manual confirmation. The existing Vite
  server on `http://192.168.85.200:5173/` responds, but this session has no
  available Browser Node REPL or local Playwright package for visual automation.
- Phase 2 manual browser confirmation received from user:
  `http://192.168.85.200:5173/?autoLoad=1&bootFlow=1&debugState=1&sound=0`
  rapidly cycles through levels, then settles on a high-score screen with
  `credits 0` and moving marbles. This confirms the cold boot path is visibly
  alive; rapid level cycling remains a documented cadence gap.
- Phase 3 input proof: `oracle/scenarios/input/playable_coin_start.json`
  records a 15-frame Coin 1 pulse at frames 60-74 and a 15-frame START1 pulse
  at frames 180-194. MAME maps START1 to active-low bit 0 of `0xF60001`, which
  is already routed to `gameMainGate(... inputMmio ...)`; Coin 1 is read on the
  sound CPU `$1820`, so Phase 3 should keep the existing browser credit
  bookkeeping while routing START through the runtime gate instead of swapping
  in a warm seed.
- Phase 3 implementation local validation PASS: browser coin pulses now add
  credits for `bootFlow=1`, START1 is held active-low in `inputMmio` for the
  15-frame MAME pulse window, and `gateCheck` consumes one credit only when
  `gameMainGate` accepts player 1. No `bootInit(... warmState ...)` call was
  added to the bootFlow START path. Commands passed:
  `npx vitest run packages/web/test/boot-flow-url.test.ts packages/web/test/coin-start-flow.test.ts packages/web/test/input.test.ts packages/web/test/practice-level.test.ts packages/engine/test/game-main-gate.test.ts --silent`;
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false`;
  `npx tsc -p packages/web/tsconfig.json --noEmit --pretty false`;
  `npm --workspace @marble-love/web run build`; `git diff --check`.
- Phase 3 manual browser confirmation received from user:
  `bootFlow=1` insert coin adds credits, START loads a piece of terrain through
  the runtime path, and then immediately shows game over. Screenshot
  `/Users/magnus-bot/Desktop/partenza.png` shows `main=2 mode=2 level=0`,
  `timer=0`, terrain/player visible, and `OUT OF TIME / GAME OVER`. Result:
  Phase 3 gate is green because coin/start changed runtime state without a
  seed handoff; the immediate out-of-time transition is the Phase 4 blocker.
- Phase 4 finding/fix in progress: runtime START enters `FUN_1101E` state 5
  and `FUN_10504` enables the live player timer with a zero outer counter, but
  the new-game path did not arm the proven level-intro timer resume used by
  level transitions. Added the resume arm after state 5 `init10504`, with
  `baseTimer=0` and `parkTimer=true`, so Practice starts by adding intro time
  instead of letting `gameTickTimers` expire immediately. Focused test
  `npx vitest run packages/engine/test/main-loop-init-task-a.test.ts --silent`
  PASS.
- Phase 4 automated validation PASS:
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false`;
  `npx vitest run packages/engine/test/level-intro-banner-resume.test.ts packages/engine/test/main-loop-init-task-a.test.ts packages/engine/test/main-tick.test.ts --silent`;
  `npm --workspace @marble-love/web run build`; `git diff --check`.
  Manual/browser confirmation is pending before commit.
- Phase 4 manual follow-up: user confirmed runtime START now loads the timer
  and is playable, but screenshot `/Users/magnus-bot/Desktop/partenza nuova.png`
  shows a black center band with debug scroll around `scroll=(0,290)`.
  Probe `/tmp/marble-love/boot-flow/phase4-start-scroll-summary.json` compares
  the L1 diagnostic seed (`videoScrollY=0`) with the cold runtime state-5 path
  (`0xff10` latched as `videoScrollY=272`). Added a state-5 new-game scroll
  reset to zero after `FUN_10504`, while preserving the timer resume fix.
  Focused test `npx vitest run packages/engine/test/main-loop-init-task-a.test.ts --silent`
  PASS.
- Phase 4 scroll-reset validation PASS: `npx tsx /tmp/marble-love/boot-flow/probe-phase4-start-scroll.mts`
  now shows cold runtime state-5 and the L1 diagnostic seed both start with
  `scrollTarget=0`, `scrollLatched=0`, and `videoScrollY=0`; engine typecheck,
  focused Phase 4 vitest set, web build, and `git diff --check` also pass.
  Manual/browser confirmation remains pending before commit.
- Phase 4 manual browser confirmation received from user: bootFlow coin/start
  now works, the timer loads, the game is playable, and the initial black center
  band is gone. Phase 4 gate is green. Residual for Phase 5: immediately after
  game over, the browser shows a yellow/red terrain screen; trace whether this
  is stale level rendering during the game-over/attract transition.
- Phase 4 committed and pushed as `70baf5a`
  (`fix: enter level one from cold boot flow`).
- Phase 5 post-game-over finding, superseded by the high-score default fix:
  probe
  `/tmp/marble-love/boot-flow/phase5-gameover-summary.json` reproduces the
  bootFlow timeout path without seeds. Timeout summary starts around frame 3782
  at `main=2/mode=0`, then attract returns around frame 3964 at
  `main=1/mode=2` while the level playfield remains visible, and later clears
  at frame 4264 before mode0 attract rebuilds. Existing seed-backed guard
  `npx vitest run packages/engine/test/playable-live-routes.test.ts -t "time-out transition holds" --silent`
  PASS.
- Phase 5 root cause/fix: cold boot did not initialize the ROM-backed default
  high-score pointer/table at `*0x401FFC = 0x401E74`, so a normal timeout score
  such as 140 ranked against an all-zero table and `FUN_1101E` skipped the
  staged mode2 reset. Added `packages/engine/src/high-score-defaults.ts` and
  called it from cold `bootInit`; warm seed diagnostics remain untouched.
  The post-fix probe clears the stale playfield on the next frame after attract
  handoff (`f3965`), and
  `/tmp/marble-love/boot-flow/phase5-gameover-summary.json` now shows
  `t4100` at playfield count 234 instead of the stale 4183 level playfield.
  `packages/engine/test/boot-init.test.ts` also proves the exact same table is
  initialized from `ghidra_project/marble_program.bin`.
- Phase 5 second root cause/fix from user screenshots
  `/Users/magnus-bot/Desktop/1.png`, `/Users/magnus-bot/Desktop/2.png`, and
  `/Users/magnus-bot/Desktop/3.png`: after later-level game-over,
  `main=2/mode=2/level=4` becomes `main=1/mode=2/level=1` while the old
  playfield remains visible until the black reset window. This is the
  qualifying-score path: `objectSlotLookup11B18` returned 1 even when the
  interactive initials/high-score flow was not wired. Changed the default so
  an unwired qualifying flow returns 0, allowing `FUN_1101E` to start the
  staged mode2 reset. Probe
  `/tmp/marble-love/boot-flow/phase5-highscore-gameover-probe.log` now shows a
  score-qualifying level-4 game-over clears playfield from 8192 to 0 at
  `advance1`. Added a tick-level guard in
  `packages/engine/test/main-tick.test.ts` proving staged mode2 reset clears a
  stale post-game-over playfield through `mainTick`.
  Automated gates PASS:
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
  Manual/browser confirmation received from user: the yellow/red later-level
  terrain no longer appears after `GAME OVER`. Screenshot
  `/Users/magnus-bot/Desktop/finisce.png` instead shows the high-score/default
  table with credits 0. Residual: the score-qualified initials/save flow is not
  implemented yet; the current unwired `FUN_11B18` fallback avoids stale terrain
  and proceeds to reset/demo rather than accepting initials.
  Latest pre-commit rerun PASS:
  `npx vitest run packages/web/test/boot-flow-url.test.ts packages/web/test/coin-start-flow.test.ts packages/web/test/practice-level.test.ts packages/engine/test/boot-init.test.ts packages/engine/test/main-tick.test.ts packages/engine/test/object-slot-lookup-11b18.test.ts packages/engine/test/main-loop-init-task-a.test.ts packages/engine/test/playable-live-routes.test.ts --silent`
  (8 files, 64 tests); engine/web targeted typechecks; web build (known Vite
  chunk-size warning only); `git diff --check`.
- Phase 6 L1 -> L2 diagnostic route-search checkpoint: exported a scratch
  no-seed runtime L1 state at
  `/tmp/marble-love/boot-flow/bootflow_l1_runtime_diagnostic_f1000.seed.json`
  for probe use only. Search
  `/tmp/marble-love/boot-flow/phase6-l1-l2-route-search-live-f2400-deaths3/manifest.json`
  did not hit `main=3` or target descriptor L2 `0x0002c54c` within 2400 frames;
  best candidates stay in `main/mode=0/0`, descriptor L1 `0x0002bee2`, timer
  near 6, with one death/recovery. This is not a green transition proof; Phase
  6 still needs a user/manual or MAME route that actually completes Practice.
- Phase 6 manual browser confirmation received from user: from
  `bootFlow=1`, the user completed three levels and progression continued well.
  This supersedes the diagnostic route-search miss for early progression and is
  green manual proof for at least L1 -> L2 -> L3 -> L4 through runtime without
  runtime seed loads. Residual visual after game over: yellow/red terrain stays
  for a few seconds, then a black reset window appears, then demo mode starts.
  Screenshot `/Users/magnus-bot/Desktop/schermata nera.png` shows that black
  window at `f=14190 main=1 mode=0 level=0 scroll=(0,340)`, `timer=0`,
  player `a=3 st=6`.
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
