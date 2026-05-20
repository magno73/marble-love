# GOAL - Active Objective

All agents should read this file only for current state. Long historical notes
were archived at:

- `docs/archive/goals/2026-05-20-sprite-goal-full.md`

## Active Goal

Resolve the remaining sprite visibility and physics regressions tracked by:

- `docs/codex-task-sprite-visibility-physics.md`
- `docs/codex-task-l4-pistons-current-context.md`

Current focus: L4/Aerial pistons user retest. The user clarified that debug
overlay coverage is not the cause. The latest code/proof finding is that
`type0x29` piston animation entries were already being inserted, but TS was
dropping them with an incorrect `d4 < 0xc0` renderer cull. Local commit
`0ff49fa` changes `dispatchType0x29` to the ROM signed band
`d4 <= -0x40 || d4 >= 0x100`.

## Current Status

- `sprite1`: previous user retest said OK. Do not reopen unless a new
  regression appears.
- `sprite2`: active focus. L4/Aerial pistons have a code fix for the
  `type0x29` visual cull; needs user live retest before marking green.
- `sprite3`: previous user retest said OK. TS visibility is strong; MAME route
  attach was historically gray.
- `sprite4`: previous pass reported L3 greens as visually present in sampled
  state, but keep proof status tied to the sprite PRD.
- Compact debug exists via `debugCompact=1`, but overlay coverage is not the
  current suspected cause.
- The focused continuity file is
  `docs/codex-task-l4-pistons-current-context.md`; update it after every new
  finding.

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

## Next Concrete Action

Ask the user to retest L4/Aerial pistons from:

```text
http://192.168.85.200:5173/?autoLoad=1&play=1&startLevel=4&debugState=1&debugCompact=1&sound=0&loopReset=0
```

If the first piston block now visibly rises when it repels the marble, mark
`sprite2` pistons green in the sprite PRD. If it still fails, capture the
`draw29` and `last obj-pair collision` debug lines and continue from
`docs/codex-task-l4-pistons-current-context.md`.

## Files To Read For This Goal

- `AGENTS.md`
- `docs/context-map.md`
- `docs/codex-task-l4-pistons-current-context.md`
- `docs/codex-task-sprite-visibility-physics.md` only for acceptance criteria
- touched source/tests around the piston path

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
