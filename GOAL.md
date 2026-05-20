# GOAL - Active Objective

All agents should read this file only for current state. Long historical notes
were archived at:

- `docs/archive/goals/2026-05-20-sprite-goal-full.md`

## Active Goal

Resolve the remaining sprite visibility and physics regressions tracked by:

- `docs/codex-task-sprite-visibility-physics.md`
- `docs/codex-task-l4-pistons-current-context.md`

Current focus: L4/Aerial invisible obstacle reported after the user confirmed
that L3/Intermediate green blob/stain sprites now appear. The new screenshot
points at terrain/script slot `0@0x400a9c`, `tag=0x0c`, around
`(840,864,16228)`. This is an Aerial dynamic obstacle rendered as entity
`type12`, not the already-fixed L3 green `type0x0e` path.

## Current Status

- `sprite1`: previous user retest said OK. Do not reopen unless a new
  regression appears.
- `sprite2`: user confirmed L4/Aerial pistons now move/animate; record as
  user-facing green for the current scope.
- `sprite3`: previous user retest said OK. TS visibility is strong; MAME route
  attach was historically gray.
- `sprite4`: user confirmed green blobs/stains now appear after the
  `FUN_17346` string-slot spawn fix.
- New Aerial invisible obstacle: active focus. Evidence says the physics slot
  is valid and active, but `late-game-logic-26f3e` culled the matching `type12`
  sprite because it treated ROM `moveq #0xe0` as unsigned `+224` instead of
  signed `-32`.
- Compact debug exists via `debugCompact=1`, but overlay coverage is not the
  current suspected cause.
- Update this file and `docs/codex-task-sprite-visibility-physics.md` after
  every new green-sprite finding.

## Known Recent Evidence

- Piston physics can arm through object-pair collision around `0x400a20`.
- Terrain/script piston slots `2..7` may be inactive or late while the
  object-pair path still owns physical collision.
- `packages/engine/src/helper-1bc88.ts` and `packages/engine/src/state.ts`
  record post-collision object-pair fields for debugging.
- `packages/web/src/main.ts` supports `debugCompact=1`.
- Route proof found active `type0x29` draw entries in the first-block zone with
  `d4` values such as `159/143`, `94/90`, and `53/49`; old TS culled them,
  while ROM `0x27e7c` uses `moveq #-0x40,D0`.
- Validation after the `type0x29` fix:
  `npx vitest run packages/engine/test/late-game-logic-26f3e.test.ts --silent`
  PASS, engine/web typechecks PASS, `git diff --check` PASS.
- User confirmed after that patch that the L4 pistons now move.
- Green-sprite route probe:
  `/tmp/marble-sprite-goal/current-run/verdi_user_screenshot_route3_f3130_probe_20260520.json`.
  It matches the user screenshot timer (`36`) and descriptor (`0x02cd9e`) but
  has only the marble in the entity draw list.
- Prior green-visible proof remains:
  `/tmp/marble-sprite-goal/current-run/l3_sprite4_f2400_step22.seed.json` and
  `/tmp/marble-sprite-goal/current-run/browser_l3_sprite4_f2400_step22.png`.
  That state is timer `48`, scrollY about `297`, and has two visible type4
  entries. The user `verdi` screenshot is much later in scroll (`457`).
- Selector-2 ROM tables are asymmetric: visual type4 entries in
  `FUN_14C46` cover range `0x01..0x18`, while collision/rect entries in
  `FUN_12DFA` cover `0x17..0x32` and `0x29..0x40`. Do not "fix" this by
  widening the type4 range unless MAME proof shows the original visual objects
  remain active in the later scroll band.
- Implemented local `FUN_17346` replica in
  `packages/engine/src/string-range-dispatch-17346.ts` and wired it from
  `scrollRange144E4`. It reads selector table `0x23d4a`; selector `2`
  includes the L3/Intermediate ranges `0x0e..0x24` and `0x11..0x2a`, which
  match the later green-blob window better than the earlier `type4` range.
- After the patch, probe
  `/tmp/marble-sprite-goal/current-run/verdi_user_screenshot_route3_f3130_probe_after_17346_20260520.json`
  reaches descriptor `0x02cd9e`, timer `36`, and the linked frame now contains
  `7` sprite entries. The draw list includes `type14`/`type0x0e` rows backed by
  `0x401482..0x40160e`, with active cel pointer `0x02186a`.
- Validation for the `FUN_17346` patch: `npm run typecheck` PASS,
  `npm run lint` PASS,
  `npx vitest run packages/engine/test/string-range-dispatch-17346.test.ts packages/engine/test/scroll-range-144e4.test.ts packages/engine/test/late-game-logic-26f3e.test.ts --silent`
  PASS (`63` tests), and `git diff --check` PASS.
- User confirmed the green blob/stain sprites are visible.
- New screenshot triage: overlay reports L4/Aerial `last terrain-slot collision`
  on `slot=0@400a9c tag=0c` with slot coordinates about `(840,864,16228)`.
  ROM script group `0x1d40c` initializes this as `type12/sub0`; its visible
  animation uses cel-list `0x22346 -> 0x222da`. Focused reproduction shows the
  renderer emitted nothing with the old positive `0xe0` lower bound, then emits
  `{arg0=0x222da,arg1=0x00b8,arg2=0x0088,arg3=0x3800}` after signed `moveq`
  handling.

## Next Concrete Action

Validate and ship the L4/Aerial signed `moveq` renderer-bound fix, then ask the
user to retest the same Aerial spot where the invisible obstacle was pushing or
dropping the marble. Keep the goal open until that retest is recorded.

## Files To Read For This Goal

- `AGENTS.md`
- `docs/context-map.md`
- `docs/codex-task-sprite-visibility-physics.md` only for acceptance criteria
- `packages/engine/src/state-sub-14c46.ts`
- `packages/engine/src/script-rect-dispatch-12dfa.ts`
- `packages/engine/src/sub-14966.ts`
- `packages/engine/src/late-game-logic-26f3e.ts`

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

Use `jq`, targeted probes, or manifest summaries for large JSON.

## Done When

The sprite PRD is green only when:

1. `sprite1` and `sprite2` have visible objects and MAME-like physical
   interaction proven by active-vs-neutral or contact-vs-no-contact evidence.
2. `sprite3` and `sprite4` have correct visible objects, plausible palette and
   layer, and object-to-MO-to-renderer trace.
3. Each case has owner classification updated: object slot, sprite RAM
   emission, `render.buildFrame`, web renderer, collision, or blocker.
4. Focused tests/probes pass.
5. Final checkpoint clearly separates fixed, blocked, and gray. No gray case
   closes the goal.

## Validation Hints

Use targeted checks first:

```sh
npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false
npx tsc -p packages/web/tsconfig.json --noEmit --pretty false
npx vitest run packages/engine/test/refresh-frame-10fce.test.ts packages/engine/test/helper-121b8.test.ts --silent
git diff --check
```

Use broader gates only before final delivery or when the touched area warrants
it.
