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

- Phase 4: runtime level enter and L1 intro.
- Phase 0 baseline/research is complete.
- Phase 1 gated `bootFlow=1` switch is committed and pushed as `9934721`
  (`feat: add gated cold boot flow flag`).
- Phase 2 research has started with compact TS-vs-MAME cold boot summaries.
- Existing seed diagnostics must remain intact: `startLevel=1..6` and
  `playableSeed=NAME`.

Next action:

1. Commit Phase 3 after recording the user/manual browser confirmation.
2. Start Phase 4 by tracing why post-START runtime reaches terrain but has
   `timer=0` and immediately shows game over.
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
