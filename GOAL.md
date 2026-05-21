# GOAL - Active Objective

This file is only for the current active task. Do not use it as historical
startup context. Long or closed goal notes belong in `docs/archive/goals/` or in
the task PRD checkpoint log.

## Active Goal

Boot-flow no-seed implementation.

Objective:

Implement Marble Love in phases so the normal live path can start from cold
ROM-backed boot, accept coin/start through runtime, enter L1, and progress
level-by-level without loading runtime level seeds, including the score-qualified
post-game high-score initials entry flow and runtime object/collision parity for
progressed levels.

Authoritative task plan:

- `docs/codex-task-boot-flow-no-seed.md`

Current phase:

- Phase 7 default-path switch is implemented locally and validation is green:
  `?autoLoad=1&play=1` now uses the cold boot no-seed runtime path instead of
  the seed-backed coin/start path.
- Phase 6.6 runtime content parity is manually green. User confirmed the last
  L3/Intermediate green-blob fix: the blobs kill the marble, respawn works, and
  the ROM-waypoint path no longer drifts outside the terrain.
- Phase 6.5 interactive high-score initials entry is committed and pushed as
  `658be42` (`fix: add interactive high score initials entry`).
- Phase 5 high-score/post-game-over follow-ups are committed and pushed:
  `c6fca62` (`fix: clear cold boot game-over transition`),
  `00342f9` (`fix: save high score fallback on game over`),
  `0e09ef7` (`fix: refresh high score after fallback save`), and
  `c72fc95` (`docs: record high score refresh checkpoint`).
- Current gate: commit and push. The user explicitly approved promoting the
  no-seed path after the Phase 6.6 browser retest.
- Phase 6 progression has user/manual acceptance for this pass: user completed
  three levels from `bootFlow=1` and asked to treat level-to-level progression
  as mechanically closed; `bug1`/`bug2`/`bug3` reopen the content parity gate,
  not the basic transition proof.
- Phase 0 baseline/research is complete.
- Phase 1 gated `bootFlow=1` switch is committed and pushed as `9934721`
  (`feat: add gated cold boot flow flag`).
- Phase 2 research has started with compact TS-vs-MAME cold boot summaries.
- Phase 2 attract visual cadence remains a known non-blocking parity gap:
  MAME also cycles attract presentation/high-score states, but not as rapidly
  as the current TS/web cold-boot path.
- Existing seed diagnostics must remain intact: `startLevel=1..6` and
  `playableSeed=NAME`.

Next action:

1. Run final `git diff --check` and status after this documentation checkpoint.
2. Commit and push.

Phase 7 completion audit:

- Complete locally. `packages/web/src/boot-flow-url.ts` now has an explicit
  `shouldUseBootFlow(...)` route decision, and default `play=1` uses no-seed
  boot flow while explicit seed diagnostics stay out of boot flow.
- `README.md` and `STATUS.md` document `play=1` as the no-seed default, with
  `startLevel=1..6`, `playableSeed=NAME`, and `coinStart=1` preserved as
  seed-backed diagnostics/fallbacks.
- The score-qualified high-score path is now green for this phase: the
  committed Phase 6.5 implementation lets the player edit initials and saves
  the chosen initials before resuming reset/demo.
- Phase 7 approval gate is satisfied by the latest user instruction.
- Phase 7 validation PASS:
  `npx vitest run packages/web/test/boot-flow-url.test.ts packages/web/test/coin-start-flow.test.ts packages/web/test/practice-level.test.ts --silent`
  (`14` tests);
  focused Phase 6.6 engine set (`143` tests);
  `npx tsc -p packages/web/tsconfig.json --noEmit --pretty false`;
  `npm run typecheck`;
  `npm run lint`;
  `npm --workspace @marble-love/web run build` (known Vite chunk-size warning);
  `npm run context:audit`;
  `npm run test -- --silent` (`263` files passed, `3` skipped; `2285` tests
  passed, `17` skipped).
- HTTP smoke for the Vite dev server returned `200 OK` for default `play=1`,
  `startLevel=1`, explicit `playableSeed`, and explicit boot-flow conflict URL.

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
- Phase 2 MAME visual cadence recheck:
  `/tmp/marble-love/boot-flow/mame-visual-cadence-20260520170512/summary.json`
  samples clean no-input MAME cold boot every 300 frames through f12000. MAME
  alternates visible level/attract presentation and high-score/table states,
  but the sequence is measured in hundreds/thousands of frames: e.g. f600-f1200
  `main=1 mode=0 level=0 b3e4=1`, f1500-f1800 `mode=2`, f2100-f2700
  `level=1 b3e4=2`, f3000-f3300 `mode=2`, and f11400 `mode=3`. Current TS
  summary copied to
  `/tmp/marble-love/boot-flow/mame-visual-cadence-20260520170512/ts-summary-current.json`
  still reaches level/presentation states in the first 5-30 frames, so the
  browser's rapid succession is not visually identical to MAME; it is a
  documented cold-attract cadence gap, not a seed-load regression.
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
- Phase 5 follow-up committed and pushed as `c6fca62`
  (`fix: clear cold boot game-over transition`).
- High-score save follow-up finding: original `FUN_11B18` renders the inserted
  row, blocks on an interactive initials loop, then calls `FUN_428E` to insert
  the score/initials record into `*0x401FFC + 0x1E`. Added a local
  `FUN_428E` replica (`packages/engine/src/high-score-register-428e.ts`) and
  wired the unwired `FUN_11B18` fallback to register the score using the
  player's current initials before returning 0 to the reset path. This is an
  incremental save fallback, not the full interactive initials editor. Focused
  validation PASS:
  `npx tsx packages/cli/src/test-high-score-register-428e-parity.ts 500`
  (500/500 against the binary for caller-valid ranks and positive
  out-of-range ranks);
  `npx vitest run packages/engine/test/high-score-register-428e.test.ts packages/engine/test/object-slot-lookup-11b18.test.ts packages/engine/test/main-loop-init-task-a.test.ts packages/engine/test/boot-init.test.ts packages/engine/test/main-tick.test.ts --silent`;
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false`;
  `git diff --check`. The `FUN_1101E` integration test now asserts a
  score-qualified game-over inserts row 0 as `0040000669` (`0x4000`, `AAA`)
  while still starting the staged mode2 reset. Broader validation PASS:
  `npx vitest run packages/web/test/boot-flow-url.test.ts packages/web/test/coin-start-flow.test.ts packages/web/test/practice-level.test.ts packages/engine/test/high-score-register-428e.test.ts packages/engine/test/object-slot-lookup-11b18.test.ts packages/engine/test/main-loop-init-task-a.test.ts packages/engine/test/boot-init.test.ts packages/engine/test/main-tick.test.ts --silent`
  (8 files, 53 tests); engine/cli/web targeted typechecks; web build (known
  Vite chunk-size warning only); `npm run typecheck`; `npm run lint`;
  `npm run context:audit`; `git diff --check`.
- High-score save fallback committed and pushed as `00342f9`
  (`fix: save high score fallback on game over`). Remaining gap: full
  interactive initials editing in async `FUN_11B18`; the committed fallback
  saves with the player's current initials.
- High-score visible refresh follow-up is committed and pushed as `0e09ef7`
  (`fix: refresh high score after fallback save`). After the fallback registers
  a qualifying score, `FUN_1101E` re-renders the high-score table through the
  existing `FUN_11FF8` renderer so the saved row is visible before the
  reset/demo path continues. Automated validation PASS:
  focused `FUN_11B18`/`FUN_11FF8` tests, bootFlow web URL tests, engine/web
  typechecks, web build, `npm run typecheck`, `npm run lint`, `npm run
  context:audit`, full `npm run test -- --silent`, and `git diff --check`.
  Headless Chrome browser validation PASS:
  `/tmp/marble-love/boot-flow/highscore-refresh-browser-summary.json` and
  `/tmp/marble-love/boot-flow/highscore-refresh-browser.png` show row #1
  refreshed to `AAA 16,384` after a score-qualified game-over injection. This
  is still not the full interactive initials editor.
- Manual screenshot `/Users/magnus-bot/Desktop/Screenshot 2026-05-20 alle 16.00.25.png`
  confirms a real score-qualified browser game reaches the refreshed high-score
  table, but it is still the automatic-current-initials fallback, not an
  interactive initials-entry screen. No keyboard/trackball initials controls
  are wired yet.
- Phase 7 diagnostic preflight retry:
  `/tmp/marble-love/boot-flow/phase7-preflight-seed-diagnostics-retry.json`.
  Headless Chrome confirmed the current default `?autoLoad=1&play=1` still uses
  the seed-backed coin/start path before Phase 7, explicit `startLevel=1..6`
  each fetch and load their expected true-start seed, `startLevel=3` loaded
  twice with HTTP 200 after an earlier transient fetch flake, explicit
  `playableSeed=start_level1_intro_practice_f2479` still loads, and
  `bootFlow=1&startLevel=1` still fails loudly without fetching a seed.
  No runtime default-path change has been made.
- Phase 6.5 interactive high-score initials implementation is committed and
  pushed as `658be42` (`fix: add interactive high score initials entry`).
  Score-qualified game over starts a runtime initials entry instead of
  immediately saving fallback initials; vertical trackball or up/down keys
  cycle the selected letter, horizontal trackball or left/right keys move the
  cursor, and START accepts/saves. Headless Chrome artifact
  `/tmp/marble-love/boot-flow/highscore-initials-entry-browser-summary.json`
  shows overlay `HIGH SCORE #1`, edits `AAA` to `CAA`, saves row
  `00400012e9`, hides the overlay, and resumes mode-2 reset with no stale
  playfield. Validation passed: focused high-score/main-loop vitest set,
  engine/web typechecks, web URL/input tests, web build, `npm run typecheck`,
  `npm run lint`, full `npm run test -- --silent` (261 passed, 3 skipped test
  files; 2271 passed, 17 skipped tests), `npm run context:audit`, and
  `git diff --check`.
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
- Phase 6.6 runtime content parity checkpoint from user screenshots
  `/Users/magnus-bot/Desktop/bug1.png`,
  `/Users/magnus-bot/Desktop/bug2.png`, and
  `/Users/magnus-bot/Desktop/bug3.png`: `bug1`/`bug2` are in the
  L3/Intermediate runtime family (`debug level=2`) with visible green objects
  reported as nonphysical. The overlay evidence records terrain-slot tags
  `0x10` and `0x20`, so this remains a MAME/reference collision-semantics gap,
  not a justified physics patch yet. `bug3` is in the L5/Silly runtime family
  (`debug level=4`) with collision telemetry still alive (`tag=0x0c`) while
  user reports missing sprites in the brown-square area compared with the seed
  path. Result: Phase 6 transitions stay mechanically accepted, but Phase 6.6
  object/collision content parity blocks Phase 7.
- Phase 6.6 diagnostic patch in progress: `packages/web/src/main.ts` now adds
  debug-overlay lines for draw-list entity type/sub, active `string14` slots,
  and L5/Silly `silly7-9` entity table state. This is instrumentation only and
  does not change gameplay, collisions, renderer output, or seed loading.
  Validation PASS:
  `npx tsc -p packages/web/tsconfig.json --noEmit --pretty false`;
  `npx vitest run packages/web/test/boot-flow-url.test.ts packages/web/test/coin-start-flow.test.ts packages/web/test/practice-level.test.ts --silent`;
  `npm --workspace @marble-love/web run build`;
  `npm run context:audit`; `git diff --check`.
- Phase 6.6 retest screenshots
  `/Users/magnus-bot/Desktop/bug1new.png`,
  `/Users/magnus-bot/Desktop/bug2new.png`, and
  `/Users/magnus-bot/Desktop/bug3new.png` confirm the same families but show the
  new object-census lines were below the visible part of the full debug overlay.
  Moved `draw-list`, `string14`, and `silly7-9` lines to the top of both
  compact and full overlays. Validation PASS after the reorder:
  `npx tsc -p packages/web/tsconfig.json --noEmit --pretty false`;
  `npx vitest run packages/web/test/boot-flow-url.test.ts packages/web/test/coin-start-flow.test.ts packages/web/test/practice-level.test.ts --silent`;
  `npm --workspace @marble-love/web run build`;
  `npm run context:audit`; `git diff --check`.
- Phase 6.6 checkpoint from `/Users/magnus-bot/Desktop/bug1n.png`,
  `/Users/magnus-bot/Desktop/bug2n.png`, and
  `/Users/magnus-bot/Desktop/bug3n.png`: `bug1n` has active `string14` green
  visual slots, so it is not direct proof of terrain collision; `bug2n` has
  L3 terrain/script slots with tags `0x05` and `0x06`, making that family the
  next collision-semantics candidate; `bug3n` has `silly7-9 -` and only the
  player in the draw-list, proving the L5/Silly progressed runtime was missing
  upstream type7/8/9 array-9 spawn. Disassembly of `FUN_18FFA` shows it is the
  entry-side array-9 initializer paired with existing `FUN_190EE`; the current
  patch adds that default runtime path before Phase 7 can be reconsidered.
- Phase 6.6 L5 array-9 spawn local validation PASS after adding
  `packages/engine/src/array-9-init-and-dispatch-18ffa.ts` and wiring it from
  `scrollRange144E4`: focused new test PASS (`5 tests`), focused array-9 /
  scroll-range / refresh / late-game set PASS (`91 tests`), web boot-flow URL
  tests PASS (`12 tests`), engine/web/CLI/root typechecks PASS, web build PASS
  with the known Vite chunk-size warning, `npm run context:audit` PASS, and
  `git diff --check` PASS. Manual browser confirmation is still pending before
  Phase 6.6 can be considered green.
- Phase 6.6 manual retest checkpoint from
  `/Users/magnus-bot/Desktop/bug3nn.png`,
  `/Users/magnus-bot/Desktop/bug1nn.png`, and
  `/Users/magnus-bot/Desktop/bug2nn-x.png`: `bug3nn` confirms the L5/Silly
  array-9 fix in browser (`silly7-9` populated and draw-list type `7/8/9`
  entries visible). `bug1nn` remains a real L3 `string14` physical-effect gap:
  the green visual slots are active and visible, but the runtime call from
  `helper121B8` was not wiring `FUN_175C8` to `FUN_25BAE`/`FUN_158AC`, so the
  player did not enter the original hit state. Current patch wires those side
  effects and records compact overlay `last state ... FUN_121B8/FUN_175C8
  ... code=9` for the next retest. `bug2nn-x` shows the tag `0x05` side
  repelling correctly and the tag `0x06` side not repelling; original
  `FUN_29CCE` evidence still treats tag `0x06` as no-op, so no tag `0x06`
  physics will be invented without a MAME/runtime-slot-assignment proof.
  Focused validation for the new `FUN_175C8` wiring is green:
  `npx vitest run packages/engine/test/helper-121b8.test.ts packages/engine/test/string-viewport-hit-175c8.test.ts --silent`.
  Broader local validation is also green:
  engine/web typechecks, `npm run typecheck`, focused engine set including
  array-9/scroll-range (`64` tests), web boot-flow URL tests (`12` tests),
  `npm --workspace @marble-love/web run build` (known chunk-size warning),
  `npm run context:audit`, `npm run lint`, and `git diff --check`.
- Phase 6.6 retest `/Users/magnus-bot/Desktop/bug1e.png` proves the previous
  `FUN_175C8` wiring fix was necessary but incomplete. `string14` slots remain
  active and visible, yet compact overlay still shows only the older
  `FUN_121B8/bounce-below-target code=4`, not `FUN_121B8/FUN_175C8 code=9`.
  Root cause found in the hit-test replica: real `slot+0x3a` is a current
  animation/frame cursor that often points into ROM, and `FUN_175C8` must read
  `*(slot+0x3a)` and the bbox bytes from ROM/RAM. The active patch adds
  ROM-aware absolute reads to `stringViewportHit175C8` and passes the current
  ROM from `helper121B8`. Focused validation is green:
  `npx vitest run packages/engine/test/string-viewport-hit-175c8.test.ts packages/engine/test/helper-121b8.test.ts --silent`;
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false`.
  `/Users/magnus-bot/Desktop/bug2e.png` remains the separate tag `0x06`
  wave-side issue. Static ROM jump-table check from `/tmp/marble-love/marble_program.bin`
  maps tag `0x05` to `0x029f40` and tag `0x06` to the common iter-epilog
  `0x02b072`, so `0x06` is original no-op behavior, not a missing copy of the
  proximity bumper. Added a focused test locking `0x06` as no-op in
  `FUN_29CCE`; the focused helper/string/terrain set now passes (`76` tests).
  Full local validation after this checkpoint is green: web/CLI/engine
  typechecks, root `npm run typecheck`, focused engine set (`101` tests), web
  boot-flow tests (`12` tests), web build with the known chunk-size warning,
  `npm run lint`, `npm run context:audit`, and `git diff --check`.
- Phase 6.6 retest `/Users/magnus-bot/Desktop/bug1a.png` proves the
  ROM-bbox hit-test fix made visible green `string14` slots physically affect
  the player: compact overlay shows
  `last state ... FUN_121B8/FUN_175C8 ... code=9`. New root cause: `FUN_253EC`
  did not yet implement ROM jump-table state `9` (`0x2584e`), so the player
  stayed in `st=9` with the generic fallback and the game appeared frozen.
  Current patch wires `JT[9]` as
  `FUN_176D2 -> FUN_25FC2 -> FUN_1B9CC(obj,1) -> FUN_1281C`, and makes
  `FUN_176D2` ROM-aware for the same `slot+0x3a -> cursor -> bbox` chain as
  `FUN_175C8`. Focused validation is green:
  `npx vitest run packages/engine/test/string-target-step-176d2.test.ts packages/engine/test/refresh-frame-10fce.test.ts --silent`;
  broader focused Phase 6.6 engine validation is green:
  `npx vitest run packages/engine/test/sub-29cce.test.ts packages/engine/test/string-viewport-hit-175c8.test.ts packages/engine/test/helper-121b8.test.ts packages/engine/test/string-target-step-176d2.test.ts packages/engine/test/refresh-frame-10fce.test.ts packages/engine/test/array-9-init-and-dispatch-18ffa.test.ts packages/engine/test/scroll-range-144e4.test.ts --silent`
  (`131` tests); engine/web/CLI targeted typechecks are also green. The user
  also reports that some green blobs move outside the terrain; this remains a
  separate placement/pathing evidence item pending MAME/reference comparison.
- Phase 6.6 manual retest after `JT[9]`: user confirmed the green blobs now
  kill the marble and the game respawns correctly. New screenshot
  `/Users/magnus-bot/Desktop/bug1b.png` keeps the L3 green-blob pathing issue
  open: overlay shows active `string14` slots with ROM bases such as
  `0x23fb2`, `0x23f66`, and `0x23f1a`, while the visible blobs drift off the
  terrain. Root cause found in waypoint reads: `FUN_1D1EC` and `FUN_1D242`
  read `entity+0x2c` path bytes from work RAM only, but `FUN_17346` string
  paths are ROM-resident. A ROM dump confirms those bases contain nonzero
  waypoint bytes (for example `0x23f66: 43 46 01 00, 4a 46 02 00...`); the
  previous TS read returned zeros and drove blobs toward `(0,0)`. Current patch
  makes both waypoint routines ROM-aware and passes the ROM from
  `FUN_1725A`/`scrollRange144E4`. Focused validation is green:
  `npx vitest run packages/engine/test/entity-waypoint-step-1d1ec.test.ts packages/engine/test/string-step-1725a.test.ts packages/engine/test/string-target-step-176d2.test.ts packages/engine/test/refresh-frame-10fce.test.ts --silent`;
  broader Phase 6.6 focused validation is green:
  `npx vitest run packages/engine/test/entity-waypoint-step-1d1ec.test.ts packages/engine/test/string-step-1725a.test.ts packages/engine/test/string-range-dispatch-17346.test.ts packages/engine/test/scroll-range-144e4.test.ts packages/engine/test/sub-29cce.test.ts packages/engine/test/string-viewport-hit-175c8.test.ts packages/engine/test/helper-121b8.test.ts packages/engine/test/string-target-step-176d2.test.ts packages/engine/test/refresh-frame-10fce.test.ts packages/engine/test/array-9-init-and-dispatch-18ffa.test.ts --silent`
  (`143` tests); engine/web/CLI targeted typechecks are also green.
- Phase 6.6 final manual browser retest: user confirmed the ROM-waypoint patch
  fixes the green-blob drift. L3 green blobs now stay on their intended route,
  kill the marble, and respawn works. User then approved promoting the no-seed
  flow to the default `play=1` URL.
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
- Phase 7 default-route promotion is approved and may change
  `?autoLoad=1&play=1` to no-seed boot flow.
- Keep seed diagnostics explicit: `startLevel=1..6`, `playableSeed=NAME`, and
  `coinStart=1` must remain available.
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
