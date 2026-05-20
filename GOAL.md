# GOAL - Active Objective

All agents should read this file only for current state. Long historical notes
were archived at:

- `docs/archive/goals/2026-05-20-sprite-goal-full.md`

## Active Goal

Resolve the remaining sprite visibility and physics regressions tracked by:

- `docs/codex-task-sprite-visibility-physics.md`
- `docs/codex-task-l4-pistons-current-context.md`

Current focus: L4/Aerial pistons. The user clarified that debug overlay
coverage is not the cause. The pistons are visible enough to judge: they remain
stationary when physics already repels the marble, and animation starts only
after the marble moves much farther forward.

## Current Status

- `sprite1`: previous user retest said OK. Do not reopen unless a new
  regression appears.
- `sprite2`: active focus. L4/Aerial pistons physically repel the marble before
  the visible piston animation is synchronized.
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
- The next proof should identify the first frame physics arms, then compare the
  matching visual terrain/script slot and object-pair slot on the same frame.

## Next Concrete Action

Start from `docs/codex-task-l4-pistons-current-context.md`.

Find the first frame when piston physics arms in L4, then explain why the
matching terrain/script visual slot remains static and why the animation trigger
fires late. Prefer a small route/probe and update the continuity file with the
exact frame, slot, state fields, and command output summary.

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
