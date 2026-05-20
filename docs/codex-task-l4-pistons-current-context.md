# L4 Pistons Current Context

Last updated: 2026-05-20.

This file is the compact handoff for the remaining L4/Aerial piston bug. Read it
before touching code after context compaction.

## Current User-Facing Bug

The first piston group is physically active: when the marble crosses it, the
marble is repelled. The visible piston sprites, however, stay still. They only
start moving after the marble advances much farther into the level, near a later
piston block.

The user explicitly corrected a false lead: this is not caused by the debug
overlay covering the sprites. The pistons are visible outside/under the overlay,
but they are stationary when the physics is already armed.

## Exact Next Investigation Target

Find the frame/moment when the piston physics becomes armed, then determine why
the corresponding piston sprites do not start animating at that same moment.

In practical terms:

1. Trace the arming point for the physical object-pair slot, especially
   `0x400a20`, and record the active/state/k/f36/f56/f6c/f6e transition.
2. At the same frames, trace terrain/script piston slots `2..7` in the
   `0x400a9c` table: `active18`, `state1a`, `kind1b`, `tag1f`, `pc36`,
   `rec3e`, `base46`, `timer1c`, `ctr20/22`, and position.
3. Identify which ROM path should move visual slots from static
   `base46/rec3e=0x020c14` into animated records such as `0x022016` or
   `0x0220a6`.
4. Explain why that path fires late, only after the marble reaches a later
   block/scroll state.

Do not solve this by forcing sprites, relaxing collision guards, changing seeds,
or adding renderer-only hacks. The fix must follow the original state-machine
trigger.

## What Is Already Known

- `sprite1` and `sprite3` were accepted by the user as OK for the current manual
  retest scope.
- `sprite2` catapult is OK.
- The remaining `sprite2` issue is specifically the L4/Aerial pistons.
- User screenshot `Foto 1.jpg` showed frame `3565`, timer `24`, runtime
  `level=3`, player `k=5`, player `f36=02`, and `last obj-pair collision`
  around frame `2845`, loop `3`.
- A TS route search/replay can reach the same timer/frame band. In one sampled
  replay at `frame=3565/timer=24`, object-pair slot `0x400a20` remained active
  while terrain/script piston slots `2..7` were inactive. That replay may not be
  the user's exact route, so do not overfit it.
- Earlier probes showed that stale/static terrain piston slots have
  `state1a=4`, `base46=0x020c14`, `rec3e=0x020c14`.
- The intended animated gate/piston records observed in probes include
  `0x022016` for tag `0x0b` and `0x0220a6` for tag `0x0d`.
- `FUN_1365C` / `object-render-update-1365c.ts` has an Aerial mode-3 branch for
  player `obj+0x1b == 4`. It scans the 25 slots:
  - active `state1a=4` slots are freed through `FUN_12F44(slot, 1, 0)`;
  - active `state1a=2` slots with tag `0x0b/0x0d` have `pc36` set and then run
    `FUN_12896`.
- That `FUN_1365C` default callee wiring was already fixed to call real
  `helper12F44`, `helper12896`, `postStateChange13966`, `helper285B0`, and
  `soundCmdSend158AC`. Do not redo that work unless new evidence shows a bad
  field or missing callback.
- `helper1BC88` now records object-pair post-collision debug fields:
  pre/post active/state/k/f36 and z-depth path. Use those fields in the next
  screenshot/probe.
- `web/src/main.ts` supports `debugCompact=1`, but the user says overlay
  coverage is not the root cause.

## Files Most Relevant Now

- `packages/engine/src/helper-1bc88.ts`:
  physical object-pair collision and post-collision debug.
- `packages/engine/src/object-render-update-1365c.ts`:
  Aerial player-state slot-loop that advances/frees terrain piston slots.
- `packages/engine/src/script-slot-step-13068.ts`:
  per-frame 25-slot state machine.
- `packages/engine/src/helper-12896.ts`:
  bytecode interpreter that moves piston slot script records.
- `packages/engine/src/object-render-update-13334.ts`:
  render update for script-slot animation records.
- `packages/web/src/main.ts`:
  debug overlay lines for pair slots and piston slots.
- `docs/codex-task-sprite-visibility-physics.md`:
  full PRD/checkpoint history.
- `GOAL.md`:
  high-level current goal status.

## Current Hypotheses To Test

1. The physical object-pair slot is armed before the matching terrain/script
   visual slot is converted from static state `4` to animated state `2`.
2. The visual slot conversion is gated by player `obj+0x1b` / scroll transition,
   not by physical contact. This could explain why animation starts only after
   the marble goes much farther forward.
3. The TS route probes used so far may not reproduce the user's exact loop `3`
   collision ordering. The next probe must capture the precise route/screenshot
   state or instrument live debug compactly enough for the user to screenshot the
   relevant pair/slot lines.

## Do Not Repeat Unless New Evidence Requires It

- Do not revisit the debug-overlay coverage theory as primary cause; the user
  rejected it from direct play observation.
- Do not force `0x400a20` to active state `2` without proof.
- Do not fabricate piston sprites in the renderer from collision state.
- Do not change startLevel, seed names, terrain, or collision gates as a shortcut.
- Do not revert unrelated dirty/untracked oracle scripts, screenshots, or scratch
  files.

## Update Rule

Every time a new finding is made, append it to this file before ending the turn.
Use short dated notes with:

- evidence path or screenshot/debug line;
- exact slot/object fields observed;
- conclusion;
- next step or ruled-out path.

## Open Next Step

Build a focused text probe that logs, frame-by-frame around the first piston
block:

- object-pair slot `0x400a20` arming/collision timeline;
- player `obj+0x1b` transitions;
- terrain/script slots `2..7` state/record timeline;
- calls/effects of `objectRenderUpdate1365C`, `scriptSlotStep13068`, and
  `helper12896`.

The desired proof is a single timeline showing the first frame where physics is
armed and the later frame where visual animation starts, with the missing or late
state transition identified.
