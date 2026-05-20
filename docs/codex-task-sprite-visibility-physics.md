# PRD / Goal Prompt — Sprite visibility and physical interaction gaps

## Suggested `/goal`

```text
/goal Resolve the four sprite regressions documented by /Users/magnus-bot/Desktop/sprite1.png through sprite4.png. For sprite1 and sprite2, the referenced objects are now visible in TS but must also reproduce the original physical interaction with the marble. For sprite3 and sprite4, the referenced objects must become visible in TS at the matching level/location. Prove each case with evidence: MAME/reference observation, TS before/after capture, object/MO/render/collision trace, and tests or probes that fail before the fix and pass after. Keep unrelated dirty/untracked scratch files untouched, update docs/codex-task-sprite-visibility-physics.md with checkpoints after every deliverable, and do not mark the goal complete while any case remains unproven, approximated, or visually/physically ambiguous.
```

## Source Rule From Codex Goals Guide

The OpenAI Goals guide frames a good Goal as a scoped completion contract with
three parts: outcome, verification method, and constraints. This task uses that
pattern because the fix path is investigative: the failure can live in object
spawn/state, motion-object RAM emission, renderer decode/compositing, or
collision/interaction code. The Goal is complete only when the evidence says so.

Source read before writing this PRD:

- `https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex`

## Problem

Some level-specific sprite objects remain incomplete after the previous sprite
work.

User-reported current state:

| Reference | Current TS symptom | Required outcome |
| --- | --- | --- |
| `/Users/magnus-bot/Desktop/sprite1.png` | Object(s) now visible, but they do not physically affect the marble. | Visible object(s) must also reproduce the original MAME collision / shove / block / hazard behavior. |
| `/Users/magnus-bot/Desktop/sprite2.png` | Object(s) now visible, but they do not physically affect the marble. | Visible object(s) must also reproduce the original MAME collision / shove / block / hazard behavior. |
| `/Users/magnus-bot/Desktop/sprite3.png` | Referenced object(s) not visible in TS. | Object(s) visible in the correct level/location, with correct palette/priority/layering. Then verify whether they also need physical interaction. |
| `/Users/magnus-bot/Desktop/sprite4.png` | Referenced object(s) not visible in TS. | Object(s) visible in the correct level/location, with correct palette/priority/layering. Then verify whether they also need physical interaction. |

Visual notes from the screenshots:

- `sprite1`: MAME reference shows yellow obstacle/gate-like objects on an
  orange/red course section.
- `sprite2`: MAME reference shows a small orange/brown obstacle near the marble
  and goal area.
- `sprite3`: MAME reference shows small colored objects on a yellow/black
  section; these are currently reported invisible in TS.
- `sprite4`: MAME reference shows green puddle/blob-like objects on a beige
  course section; these are currently reported invisible in TS.

Do not treat these labels as semantic proof. They are visual anchors. The actual
object type, shape id, collision behavior, and render path must come from MAME,
disasm, object slots, sprite RAM, or existing parity tests.

## Context To Read First

Read these before implementing:

- `README.md`
- `STATUS.md`
- `GOAL.md`
- `docs/missing-subs-inventory.md`
- `docs/hardware-map.md` motion-object section
- `docs/input-mmio-map.md` manual MAME route capture section
- `packages/engine/src/render.ts`
- `packages/web/src/renderer.ts`
- `packages/engine/src/helper-121b8.ts`
- `packages/engine/src/sub-158f6.ts`
- `packages/engine/src/sub-29cce.ts`
- `packages/engine/src/process-all-sprites-189e2.ts`
- `packages/engine/src/mo-block-emit-1a8d2.ts`
- `packages/engine/src/object-type-dispatch-194ba.ts`
- `packages/engine/src/object-render-update-13334.ts`
- `packages/engine/src/object-render-update-1365c.ts`
- `packages/engine/src/bbox-hit-test-19d94.ts`
- `packages/engine/src/script-slot-bbox-test-14e92.ts`

Also inspect existing scratch/probes, but do not assume they are canonical:

- `oracle/mame_sprite_writes_tap.lua`
- `oracle/mame_playable_route_sprite_writes_tap.lua`
- `oracle/mame_1bc88_collision_tap.lua`
- `packages/cli/src/probe-sprite-writes.ts`
- `packages/cli/src/probe-cluster-sprite-diff.ts`

## Non-Negotiable Constraints

- Do not revert unrelated dirty/untracked files. The repo may contain oracle
  scripts, screenshots, captures, and seed scratch from prior sessions.
- Do not rename seeds, hardcode `startLevel`, or promote new playable routes
  without active-vs-neutral proof.
- Do not fake sprite visibility in the renderer if the object/MO emission is
  missing upstream. Renderer-only fixes are valid only when object state and MO
  RAM already contain the correct command but the web renderer loses it.
- Do not fake collision by adding ad hoc screen-space hitboxes. Collision or
  physical interaction must come from the original object/collision path, or be
  explicitly documented as a blocked approximation and left unmerged.
- Rule 12 fail-loud: unknown object semantics are acceptable; invented semantics
  are not.

## Deliverables

### D1 — Case Inventory

Create/update a checkpoint section at the bottom of this file after this
deliverable.

For each of `sprite1..4`:

- Identify the level, approximate location, and visible reference object(s).
- Capture or locate a TS reproduction URL/seed/path.
- Record whether the TS failure is:
  - object missing from object slots,
  - object present but not emitted to sprite RAM,
  - sprite RAM present but `render.buildFrame` drops it,
  - frame command present but web renderer drops/miscolors/layers it,
  - object visible but collision/interaction path missing.
- Save reproducible evidence paths, commands, and frame numbers.

Expected output: a four-row case table with current status and next owner.

### D2 — MAME / TS Evidence Capture

For each case, produce a minimal evidence surface:

- MAME reference: screenshot/video frame is acceptable as visual anchor, but
  preferred proof is a MAME Lua tap around the relevant frames/objects.
- TS capture: screenshot plus debug overlay or CLI dump.
- Structured dump: object slots, active object types/states, sprite RAM linked
  list / all-bank walk, `render.buildFrame().sprites`, and collision-relevant
  globals around the marble.

Use manual MAME route capture from `docs/input-mmio-map.md` if reaching the
exact location manually is easier than scripting.

Do not proceed to implementation until the likely failing layer is identified
for each case.

### D3 — Fix Visible-But-Nonphysical Cases (`sprite1`, `sprite2`)

For `sprite1` and `sprite2`, assume the renderer side is no longer the primary
bug. Trace the original interaction path:

- Which object slot represents the visible obstacle/hazard?
- Which original routine detects marble contact?
- Does TS call the routine?
- If called, where does TS diverge from MAME: bbox, z/projection, object type,
  state byte, script slot, `fun_29cce`, `helper121B8`, `helper1BC88`,
  `scriptSlotBboxTest14E92`, or another path?

Success criteria:

- A deterministic probe/test demonstrates that the object changes the marble or
  game state in the same class as MAME: block, shove, bounce, death, score,
  state transition, or other verified effect.
- The proof must compare against neutral/no-contact or pre-fix behavior.
- Visual presence alone is not sufficient.

### D4 — Fix Invisible Cases (`sprite3`, `sprite4`)

For `sprite3` and `sprite4`, trace the render pipeline from upstream to
downstream:

1. Object slot active?
2. Object render/update routine invoked?
3. Sprite record generated at `0x40098C` path?
4. `processAllSprites189E2` or late-game MO emit creates sprite RAM entry?
5. `render.buildFrame` decodes the MO entry?
6. Web renderer decodes the tile graphics / palette / priority correctly?

Success criteria:

- The referenced object(s) are visible at the correct level/location.
- The object(s) use plausible MAME-correct palette/layering/priority.
- If the object has gameplay interaction in MAME, the interaction is either
  fixed in this deliverable or explicitly routed back into D3 with proof.

### D5 — Regression Gates And Final Audit

Required validation:

- `npm run typecheck`
- `npm run lint`
- `npx vitest run packages/web/test/renderer.test.ts packages/web/test/engine-diagnostic-frame.test.ts packages/engine/test/render.test.ts --silent`
- Relevant focused engine tests for touched files.
- Any parity/probe scripts added for the four cases.
- Manual browser verification for the four reference cases.
- `git diff --check`

Final audit must include:

- four-case status table: fixed / blocked / still ambiguous;
- MAME evidence path;
- TS evidence path;
- files changed;
- tests run;
- residual risk.

Do not close the Goal if any one of the four cases is not green by the stated
evidence standard.

## Likely Investigation Owners

Use these as hypotheses, not answers:

- Visible but nonphysical can implicate `helper-121b8.ts`, `sub-158f6.ts`,
  `sub-29cce.ts`, `helper-1bc88.ts`, `bbox-hit-test-19d94.ts`,
  `script-slot-bbox-test-14e92.ts`, object type dispatch, or stale projection
  fields.
- Invisible but present in sprite RAM can implicate `packages/engine/src/render.ts`
  or `packages/web/src/renderer.ts`.
- Invisible and absent from sprite RAM can implicate object spawn/init, object
  render/update, `process-all-sprites-189e2.ts`, `mo-block-emit-1a8d2.ts`, or
  missing/partial sub wiring from `docs/missing-subs-inventory.md`.

## File-Touch Boundaries

Allowed if evidence points there:

- `packages/engine/src/*object*.ts`
- `packages/engine/src/*sprite*.ts`
- `packages/engine/src/*mo*.ts`
- `packages/engine/src/render.ts`
- `packages/web/src/renderer.ts`
- focused tests under `packages/engine/test` and `packages/web/test`
- focused probes under `packages/cli/src`
- focused oracle scripts under `oracle/`
- this PRD/status file
- `STATUS.md` only after a verified fix

Avoid unless evidence requires it:

- `packages/web/src/main.ts`
- input tuning files
- seed JSON files
- level header / terrain decode files
- unrelated sound/audio files

Forbidden without explicit user approval:

- deleting or mass-renaming scratch oracle/capture files;
- rewiring start-level seed selection;
- renderer-side fake hitboxes;
- changing marble physics constants to hide sprite collision bugs.

## Checkpoint Log

Status: **PRD prepared** — 2026-05-19.

- Read OpenAI Goals guide and converted the request into an outcome +
  verification + constraints contract.
- Inspected `/Users/magnus-bot/Desktop/sprite1.png` through `sprite4.png`.
- No implementation started yet.

Status: **goal-active / D1-in-progress** — 2026-05-19.

- Active Codex goal started for the four screenshot cases. Per the Goals guide,
  completion remains evidence-based: do not close while a case is approximate,
  visually ambiguous, or lacks a physical-interaction proof where required.
- Root verified writable at `/Users/magnus-bot/Code/marble-love` on `main`.
  Existing dirty/untracked oracle scripts, screenshots, generated public state,
  and scratch captures are left untouched unless this task explicitly needs
  them.
- Re-read the durable context and the current likely owners:
  `HANDOFF_CURRENT_CONTEXT.md`, `HANDOFF_SIX_LEVELS.md`, `STATUS.md`,
  `README.md`, `GOAL.md`, `docs/missing-subs-inventory.md`,
  `docs/hardware-map.md`, `docs/input-mmio-map.md`, `CLAUDE.md`, and the
  sprite/render/collision files named above.
- Initial visual mapping, still provisional until direct TS/MAME repro:
  `sprite1` and `sprite2` likely live in the Aerial family
  (`startLevel=4`, descriptor `0x2d648`) and are visible-but-nonphysical;
  `sprite3` likely lives in the Silly family (`startLevel=5`, descriptor
  `0x2de1e`) and is missing from the current TS view; `sprite4` likely lives in
  the Intermediate family (`startLevel=3`, descriptor `0x2cd9e`) and is missing
  from the current TS view.
- CLI visual smoke from true start-level seeds produced diagnostic PPMs under
  `/private/tmp/marble-sprite-goal/`. Current start snapshots show:
  startLevel 4 has active collision slots with tags `0x0b`, `0x0d`, `0x17`,
  `0x18`; startLevel 3 and 5 start snapshots only show marble-like MO output
  at the sampled frames, so exact route/location capture is still required for
  `sprite3` and `sprite4`.
- D1 is not complete yet. Missing proof: exact TS reproduction URLs/frames for
  all four cases, MAME taps around the referenced objects, and a per-case owner
  classification grounded in object slots, MO emission, render output, and
  collision traces.

Status: **D1-correction / sprite4 remapped to descriptor L2 evidence** — 2026-05-19.

- `/Users/magnus-bot/Desktop/sprite4.png` is no longer being treated as an
  Intermediate/L3 default. The screenshot shows beige course plus green
  puddle/blob sprites at video timestamp 1:24, score `18,830`, timer `46`.
  Current repo evidence points at the descriptor `0x2c54c` family, not
  `0x2cd9e`.
- Checked current scenario/seed entity lists through the real ROM lookup table:
  `packages/web/public/scenarios/gameplay/level3_early.json` and
  `level3_end.json` both have descriptor `0x2c54c` and entity list
  `2:type0x2c/sub2`, `1:type0x2c/sub1`, `0:type0x2c/sub0`. These old
  `level3_*` filenames/descriptions are misleading labels, not proof of the
  ROM level descriptor.
- The true-start L2 seed
  `packages/web/public/scenarios/playable/start_level2_intro_beginner_f2436.seed.json`
  also has descriptor `0x2c54c`, but its start entity list is only
  `1:type1/sub0`, `0:type2/sub1`; it does not yet spawn the `type0x2c` puddle
  objects at the sampled start frame.
- Current owner hypothesis for `sprite4`: upstream spawn/progression or route
  reproduction to the `type0x2c` object region. Renderer-only edits are not
  justified unless a TS frame proves the direct sprite entries exist and are
  dropped downstream.
- Updated D1 classification table so future sessions do not continue the stale
  L3 assumption:

| Ref | Current best mapping | Evidence so far | Failing layer status |
| --- | --- | --- | --- |
| `sprite1` | Aerial/L4, descriptor `0x2d648`, yellow gate/bumper family | Desktop reference plus L4 seeds exposing collision tags `0x0b`/`0x0d` with base records `0x22016`/`0x220a6` | Visible in TS; collision branch was missing and now has a partial implementation in `FUN_29CCE`; exact route proof still grey. |
| `sprite2` | Aerial/L4 near GOAL, exact object still grey | Desktop reference; may share Aerial collision family, but not proven by object slot yet | Visible in TS per report; physical interaction still needs exact object/MAME-vs-TS proof. |
| `sprite3` | Silly/L5, descriptor `0x2de1e`, likely colored `type7/8/9` objects | True-start L5 entity list includes `type7/8/9`; array-9 ticker now updates coords, but sampled objects remain outside visible band | Invisible in TS at sampled windows; owner still grey until exact screenshot route/frame is reproduced. |
| `sprite4` | Descriptor `0x2c54c` green `type0x2c` puddle/blob family | `level3_early/end` scenarios are descriptor `0x2c54c` and contain `type0x2c/sub0..2`; true-start L2 does not at start | Missing at live TS location likely because upstream route/spawn state has not reached `type0x2c`; renderer fix not yet justified. |

Status: **D3-partial / Aerial gate collision implemented** — 2026-05-19.

- Independent disassembly of `FUN_29CCE` jump-table entries confirmed:
  `0x0b -> 0x2ab88` and `0x0d -> 0x2ad20`. These are the Aerial gate/bumper
  collision branches that were still no-op in TS.
- Current level-4 seeds expose matching collision slots:
  `candidate_level4_postseed_dr_f3000` / `candidate_level4_bootstrap_dr_f3200`
  have active slots with tags `0x0b` and `0x0d`, `slot+0x1a=4`, and base
  records `0x22016` / `0x220a6`.
- Implemented those two branches in `packages/engine/src/sub-29cce.ts`:
  inner hit state (`obj+0x1a=0x0a`, `obj+0x57=0x20`, `obj+0x58=slot+0x19`),
  signed impulse vector, outer block flags, and state-4 gate path.
- Added focused tests in `packages/engine/test/sub-29cce.test.ts` proving:
  tag `0x0b` writes the ROM hit state, tag `0x0d` applies signed velocity
  impulse, and tag `0x0b` outer block restores XY and reflects velocity.
- Validation so far:
  `npx vitest run packages/engine/test/sub-29cce.test.ts --silent` PASS
  (`30 tests`), and `npx tsc -p packages/engine/tsconfig.json --noEmit` PASS.
- This likely addresses the physical-interaction gap for the yellow Aerial
  gate/bumper objects in `sprite1` and possibly `sprite2` if `sprite2` is the
  same slot family. It is not yet final proof: exact browser/MAME route capture
  for both screenshots is still required.

Status: **D4-partial / array-9 runtime ticker wired, visibility still grey** — 2026-05-19.

- Investigated the Silly/startLevel 5 invisible-object path. The nine
  `type7/8/9` entities referenced by the level entity list are present at
  `0x401890..0x4019d0`, but their screen-coordinate cache (`entity+0x20`) was
  only a stale seed value unless `FUN_1912C` received its real sub-calls.
- Added `packages/engine/src/state-sub-1953e.ts` for `FUN_1953E`: subtype
  7/8/9 writes script pointers `0x21f72`, `0x2194e`, `0x21f06`; other subtype
  values leave `entity+0x1c` unchanged. This was checked with direct binary
  probes before implementation.
- Wired `refreshFrame10FCE`'s default `FUN_1912C` call to run
  `refreshHelper1912C` with real `FUN_194BA` and `FUN_199D6` defaults:
  `FUN_194BA` now reaches `stateSub1960E -> sub19692 -> sub19976/sub1937C`,
  `stateSub198BC`, and `stateSub1953E`; `FUN_199D6` recomputes the array-9
  sprite coordinate cache.
- Added regression tests:
  `packages/engine/test/state-sub-1953e.test.ts` and two default-wiring tests
  in `packages/engine/test/refresh-frame-10fce.test.ts`.
- Validation:
  `npx vitest run packages/engine/test/state-sub-1953e.test.ts packages/engine/test/refresh-frame-10fce.test.ts --silent`
  PASS (`20 tests`), and
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false` PASS.
- This is **not yet a green sprite3 fix**. A current startLevel 5 TS probe now
  shows the array-9 entities moving and `entity+0x20` updating, but the first
  sampled route windows still keep the referenced objects outside the visible
  frame. D4 remains open: exact screenshot-frame owner and TS/MAME route proof
  are still required.
- For `sprite4`, current startLevel 3/postseed L3 entity lists still contain
  only `type1` at the sampled start states; MAME gameplay scenarios
  `level3_early/end` contain `type0x2c` entries. This points to an upstream
  spawn/route progression question, not a renderer-only fix. D1/D2 proof is
  still required before editing spawn or route logic.

Status: **D1/D2-browser-probe / exact sprite3-sprite4 proof still grey** — 2026-05-19.

- Browser probe for
  `/?autoLoad=1&startLevel=5&debugState=1&sound=0` confirms the true Silly
  start loads `start_level5_intro_silly_f2472` and reports
  `frame.sprites=7` through the sampled idle window. The visible browser frame
  does not contain the colored object cluster from
  `/Users/magnus-bot/Desktop/sprite3.png`; this remains a route/location
  reproduction problem, not a proven renderer drop.
- A TS route sweep from the same L5 seed found one leftward sample at route
  tick 240 with `frame.sprites=11` and sprite commands around `x=120,y=52`,
  but that diagnostic has not been matched to the `sprite3` reference. Scratch
  artifact only: `/private/tmp/marble-sprite-goal/l5_left_f240.seed.json`.
- Browser probe for
  `/?autoLoad=1&scenario=level3_early&debugState=1&sound=0` is not usable as
  visual proof for `sprite4`: even though the scenario file is descriptor
  `0x2c54c` with `type0x2c` entities, the browser view presented a
  high-score/Troublemakers-looking screen, not the beige course with green
  puddles from the reference screenshot. Treat this as descriptor/entity
  evidence only.
- Next D1/D2 step: produce exact object/MO/render traces for the active
  `type7/8/9` L5 entities and the descriptor `0x2c54c` `type0x2c` entities,
  then decide whether each failure is upstream spawn, sprite emission,
  `render.buildFrame`, or web renderer. No renderer-only fix is justified yet.

Status: **D4-fix-partial / type7-8-9 cull corrected from disasm** — 2026-05-19.

- Disassembled the original type `7`, `8`, and `9` render handlers at
  `0x28018`, `0x2806e`, and `0x280c4`. All three load coords from
  `0x1f096[subIdx] + 0x20`, then use the same signed vertical cull:
  `-0x10 < d4 < 0x100`. The TS implementation incorrectly used
  `0xf0 <= d4 < 0x100`, which kept only the bottom 16 screen rows and dropped
  ordinary on-screen objects like the colored Silly/L5 sprites.
- Fixed `packages/engine/src/late-game-logic-26f3e.ts` so
  `dispatchType7_9` matches the binary lower edge (`d4 <= -0x10` is culled,
  `d4 == -0x0f` and normal positive screen rows are visible).
- Added regression coverage in
  `packages/engine/test/late-game-logic-26f3e.test.ts`: a `type7` object at
  `d4=0x90` must call `moBlockEmit`, and a `type9` object at `d4=-0x10` must
  be culled.
- TS route proof from `start_level5_intro_silly_f2472`:
  `/tmp/marble-sprite-goal/l5_type79_d4_199_after_fix.seed.json`. At route
  frame `3542`, six `type7/8/9` entities are in the binary-visible band; five
  of them have `d4 < 0xf0` and therefore would have been dropped by the old TS
  bound. `render.buildFrame(... linked-list active bank ...)` now reports
  `14` sprites with entries at `y=199..204`.
- Diagnostic visual-smoke artifact:
  `/tmp/marble-sprite-goal/l5_type79_d4_199_after_fix.ppm` (and converted
  `.png`). It is only a CLI false-color diagnostic, not final screenshot
  proof.
- Validation so far:
  `npx vitest run packages/engine/test/late-game-logic-26f3e.test.ts --silent`
  PASS (`38 tests`) and
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false` PASS.
- `sprite3` status improves from renderer/drop suspicion to a concrete
  corrected cull bug, but it is still **not final green** until browser/MAME
  evidence is matched to `/Users/magnus-bot/Desktop/sprite3.png`.

Status: **D4-fix-partial / sync level init now wires type0x2c particles** — 2026-05-19.

- Rechecked `/Users/magnus-bot/Desktop/sprite4.png`: the reference is the
  beige Beginner/L2 course with green blob/puddle sprites, timer `46`, score
  `18,830`, video timestamp `1:24`.
- Current structured evidence:
  `packages/web/public/scenarios/gameplay/level3_early.json` and
  `level3_end.json` are stale-labeled but descriptor `0x2c54c`; both already
  contain three `type0x2c` entries in the entity draw list and a live particle
  count `workRam[0x3e2]=3`. Example `level3_early`: entries
  `2:type0x2c/sub2`, `1:type0x2c/sub1`, `0:type0x2c/sub0`; `render.buildFrame`
  sees six linked-list sprites from those entries.
- Browser probe of `?scenario=level3_early` still is **not usable as final
  visual proof**: because raw scenarios tick forward, the visible page quickly
  presents a Troublemakers/high-score-looking screen instead of the frozen
  beige gameplay frame. Treat the scenario as object/MO evidence, not visual
  proof.
- Found an actual wiring gap: `main-loop-init-11452.ts` state-2 sync path had
  `FUN_18CD2` (`particleInit18CD2`) only as an optional hook, while the async
  mode-2 path already calls it with `count=3, mode=0xfe` and inserts
  `type0x2c` draw entries through `slotInsertSorted18E6C`.
- Fixed the sync path default to call `particleInit18CD2(..., 3, 0xfe)` and
  wire `fun_18e6c -> slotInsertSorted18E6C`, so code paths using synchronous
  `FUN_11452` now spawn the green blob particle layer instead of silently
  skipping it.
- Added coverage in `packages/engine/test/main-loop-init-task-a.test.ts`:
  state 2 must set `workRam[0x3e2]=3`, insert byte-list entries
  `[0,1,2,0xff]`, and create three rect slots `[0x2c,0]`,
  `[0x2c,1]`, `[0x2c,2]`.
- Validation:
  `npx vitest run packages/engine/test/main-loop-init-task-a.test.ts --silent`
  PASS (`6 tests`), and
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false` PASS.
- `sprite4` improves from unknown/upstream to a concrete fixed init-wiring
  gap, but it is still **not final green** until a frozen/browser or MAME
  gameplay visual is matched to the reference screenshot.

Status: **D3-fix-partial / FUN_29CCE tag 0x0c dynamic bounce implemented** — 2026-05-19.

- Rechecked the Aerial/L4 collision evidence after the previous tag `0x0b`
  and `0x0d` work. The disassembly for those branches is still valid:
  `0x0b -> 0x2ab88` requires `slot+0x46 == 0x22016`, and
  `0x0d -> 0x2ad20` requires `slot+0x46 == 0x220a6`. However, sampled
  current L4 yellow gate/door slots in `start_level4_intro_aerial_f2414`,
  `candidate_level4_postseed_dr_f3000`, and
  `candidate_level4_bootstrap_dr_f3200` include tag `0x0b`/`0x0d` entries
  whose `slot+0x46` is `0x20c14`, not the two gate records above. That means
  the existing gate branch is correct but cannot be treated as proof for every
  visible Aerial obstacle in `sprite1`/`sprite2`.
- Dumped the original branch `0x0c -> 0x2a9a2` from
  `ghidra_project/marble_program.bin` with Python Capstone because Ghidra
  headless could not run without a Java runtime in this session. The branch is
  a real dynamic-bbox bounce path: it dereferences `slot+0x3e`, reads signed
  bbox bytes from record `+4..+7`, checks current and previous marble deltas,
  either sets both restore flags when entering from outside or writes a
  normalized bounce vector, sets script pointer `0x20faa`, sends sound `0x39`,
  calls `FUN_25C74`, then sets `obj+0x57=0x3c` and clears `obj+0x56`.
- Implemented tag `0x0c` in `packages/engine/src/sub-29cce.ts` with the
  original pointered bbox lookup, restore-flag path, vector-bounce path, and
  `helper25C74` call wiring.
- Added focused coverage in `packages/engine/test/sub-29cce.test.ts`:
  one case proves the vector bounce state (`vx=0x00040000`, `vy=0`,
  `state=1`, script `0x20faa`, sound `0x39`), and one case proves the
  outside-entry path sets both restore flags and the epilogue restores XY and
  negates velocity.
- Validation:
  `npx vitest run packages/engine/test/sub-29cce.test.ts --silent` PASS
  (`32 tests`), and
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false` PASS.
- Additional isolated ROM proof: a one-off Musashi/ROM comparison against
  real `FUN_29CCE` at `0x29cce` matched TS for both tag `0x0c` cases
  (`previousInside=true` vector path and `previousInside=false` restore-flag
  path), with only `FUN_158AC` patched to RTS to avoid sound side effects.
- `sprite1`/`sprite2` are still **not final green**. We now have original
  physics for tags `0x0b`, `0x0c`, and `0x0d`, but the exact screenshot object
  slot/route must still be matched before claiming the user-visible cases are
  fixed.

Status: **D2-browser-smoke / frontend confirms proof gaps remain** — 2026-05-19.

- Browser smoke for
  `http://192.168.85.200:5173/?autoLoad=1&startLevel=5&debugState=1&sound=0&loopReset=0`
  loads the Silly/L5 practice seed (`debug overlay level=4`, zero-indexed)
  and stays in real renderer mode with `frame.sprites=7` in console logs.
  The visible start window still does not match `/Users/magnus-bot/Desktop/sprite3.png`;
  this is only a sanity check that the browser route is alive, not final
  `sprite3` proof.
- Browser smoke for
  `http://192.168.85.200:5173/?autoLoad=1&scenario=level3_early&debugState=1&sound=0&loopReset=0`
  still presents the Troublemakers/high-score screen while console logs show
  `frame.sprites=6`. This confirms the old `level3_early` scenario remains
  unusable as visual proof for `sprite4`, even though its serialized state has
  descriptor/entity evidence for `type0x2c`.

Status: **goal-resumed / D4-evidence-correction** — 2026-05-19.

- Resumed the active Codex `/goal` on `main` after context compaction. Root was
  re-verified writable at `/Users/magnus-bot/Code/marble-love`; current dirty
  oracle scripts, public `mame_state.json`, screenshots, and scratch captures
  are left untouched unless explicitly needed for this goal.
- Added focused diagnostic probe:
  `packages/cli/src/probe-sprite-cases.ts`. It loads a seed or scenario,
  optionally replays a route, then emits entity draw-list, `type7/8/9`,
  `type0x2c`, collision-slot, linked-list MO, and all-bank MO evidence. Compile
  check: `npx tsc -p packages/cli/tsconfig.json --noEmit --pretty false` PASS.
- `sprite3` now has strong TS-side evidence for the previous cull bug:
  `/tmp/marble-sprite-goal/l5_type79_d4_199_after_fix.seed.json` is descriptor
  `0x2de1e`; multiple `type7/8/9` entities have binary-visible `d4` values
  below the old TS lower bound, and browser `?mameDump=1` reports
  `frame.sprites=14` with the colored Silly/L5 objects visible around the
  marble. This is still marked D4-partial until the MAME/reference frame is
  attached to the same route.
- `sprite4` correction: the earlier `type0x2c` mapping is not proof. Frozen
  browser loads for `level1_early`, `level1_end`, and `level3_early` all show
  the Troublemakers/high-score scene with moving red/blue balls, not the beige
  course with green puddle/blob objects in `/Users/magnus-bot/Desktop/sprite4.png`.
  Treat those stale scenario labels as unusable visual evidence.
- Independent visual check now remaps `sprite4` back to the beige Intermediate
  race family (`descriptor 0x2cd9e`) rather than the stale `0x2c54c`
  high-score/type0x2c state. Browser frozen starts for
  `start_level3_intro_intermediate_f2435.seed.json` and
  `candidate_level3_postseed_ur_f3000.seed.json` show the correct beige board
  but not yet the green puddle/blob region from the reference screenshot.
- Primary MAME source check rejects an all-bank renderer workaround for
  `sprite4`: Atari System 1 has `slipheight=0`, so MAME starts the MO linked
  list at link `0` for the active bank and follows links from there. TS
  `walkMotionObjectLinkedList(startEntry=activeBank*64)` matches that model.
  Rendering all banks would draw stale/garbage entries and is not a valid fix.
  References checked: `mamedev/mame/src/mame/atari/atarisy1_v.cpp` and
  `mamedev/mame/src/mame/atari/atarimo.cpp`.
- Updated D1/D2 live classification:

| Ref | Current best mapping | Evidence so far | Failing layer status |
| --- | --- | --- | --- |
| `sprite1` | Aerial/L4, descriptor `0x2d648`, yellow gate/bumper family | `FUN_29CCE` tags `0x0b`, `0x0c`, `0x0d` implemented and tested; L4 seeds expose visible `type11/13` entries that map to collision slots, but sampled slots have `base46=0x020c14` and miss the original guard | D3 partial: physics branches exist; sampled gate slots are original no-ops, so user-visible route/slot proof still grey. |
| `sprite2` | Aerial/L4 near GOAL; current best candidate is visible `type5` sub11/sub12 with collision tag `0x05` | Probe on `oracle/scenarios/gameplay/level4_early.json` pairs the visible `type5` entries to collision slots 11/12; `FUN_29CCE` tag `0x05` is now implemented/tested as the ROM proximity bumper path | D3 improved but still grey until the exact screenshot object/contact has active-vs-neutral or contact-vs-no-contact proof. |
| `sprite3` | Silly/L5, descriptor `0x2de1e`, colored `type7/8/9` objects | Old TS cull dropped normal on-screen `d4` values; fixed route seed and browser frozen proof show `frame.sprites=14` and visible colored objects | D4 partial: TS fix proven; needs final MAME/reference route attachment. |
| `sprite4` | Intermediate/L3, descriptor `0x2cd9e`, beige board with green puddle/blob objects | Desktop reference and frozen L3 starts match beige level family; stale `0x2c54c/type0x2c` scenarios render high-score, not the reference | D4 grey: exact route/object owner unknown; no renderer edit justified yet. |
- Additional validation after tag `0x0c`:
  `npx vitest run packages/engine/test/sub-29cce.test.ts packages/engine/test/late-game-logic-26f3e.test.ts packages/engine/test/main-loop-init-task-a.test.ts packages/engine/test/state-sub-1953e.test.ts packages/engine/test/refresh-frame-10fce.test.ts --silent`
  PASS (`96 tests`);
  `npx vitest run packages/web/test/renderer.test.ts packages/web/test/engine-diagnostic-frame.test.ts packages/engine/test/render.test.ts --silent`
  PASS (`29 tests`);
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false` PASS.

Status: **D4-sprite4-type4-route-proof-still-grey** — 2026-05-19.

- Re-validated the active `/goal` contract against the OpenAI Goals guide:
  completion must stay evidence-based. The repository root was again verified
  writable at `/Users/magnus-bot/Code/marble-love` on `main`; no unrelated
  dirty/untracked scratch files were reverted.
- Extended `packages/cli/src/probe-sprite-cases.ts` with `type4` diagnostics:
  for each `type4` draw-list entry it now reports ROM struct pointer, binary
  `d5/d4`, binary visibility, cel-list pointer, active motion-block header,
  and direct inner records. Validation:
  `npx tsc -p packages/cli/tsconfig.json --noEmit --pretty false` PASS.
- `sprite4` desktop reference was inspected again. It is an Intermediate/L3
  beige course view with timer `46`, marble low/right, and multiple green
  blob/puddle-like marks. This remains a visual anchor only, not semantic
  proof.
- TS diagnostic route
  `/tmp/marble-sprite-goal/l3-sprite4-search/top01_f2400.seed.json`
  is descriptor `0x2cd9e`, timer `48`, zero-death, and visually close to the
  reference level family. Probe output shows two upstream `type4` entries
  (`sub3`, `sub2`) and `linkedSprites=13`, but their emitted MO y values are
  outside the visible viewport for that exact frozen frame. The browser frozen
  capture therefore lacks the green blobs. This is **not** enough to claim a
  renderer bug: MAME's Atari MO formula uses `ypos = -yRaw - yscroll - height`
  with System 1 `yscroll=256`, so an offscreen MO in this state may be expected.
- TS diagnostic route
  `/tmp/marble-sprite-goal/l3-sprite4-search/old_route_f1500.seed.json`
  is descriptor `0x2cd9e`, timer `63`, and contains two binary-visible
  `type4` entries with `d4=142`; the active linked list emits 5 sprites at
  palette `294`. Browser frozen proof shows green/yellow objects visible on
  the beige L3 board. This proves the current TS pipeline can render at least
  some L3 `type4` objects, but the route has deaths and does **not** match the
  screenshot frame, so it remains diagnostic only.
- Attempted an independent scripted MAME route capture for the zero-death TS
  route:
  `/tmp/marble-sprite-goal/mame-l3-top01-active/scenarios/l3_top01_f4835.json`.
  The capture is rejected as proof: the resulting snapshot has descriptor
  `0x000000`, player state `6`, zero timer, and no useful entity list. Per
  Rule 12 this is a failed route-proof attempt, not evidence for or against a
  code fix.
- Current `sprite4` owner classification: upstream TS object/MO/render path for
  L3 `type4` is partly proven, renderer-all-banks workaround remains rejected,
  and exact MAME/reference route proof is still grey. Do not close D4 for
  `sprite4` yet.

Status: **goal-started-current-run / D3-L4-route-proof-still-grey** — 2026-05-19.

- Re-started execution of this PRD under the active Codex `/goal` contract.
  Root and branch were verified again: `/Users/magnus-bot/Code/marble-love`
  is writable and the session is on `main`.
- Current L4/Aerial evidence for `sprite1` and `sprite2` is intentionally
  split into proven branch semantics vs. unproven screenshot ownership.
  `FUN_29CCE` branch guards remain binary-backed: tag `0x0b` requires
  `slot+0x46 == 0x22016`, tag `0x0d` requires `slot+0x46 == 0x220a6`, and
  tag `0x0c` is the dynamic bbox bounce path.
- Sampled L4 seeds also expose tag `0x0b`/`0x0d` slots with
  `slot+0x46 == 0x020c14`. Those slots must remain grey/no-op for the
  implemented gate branches unless a new exact MAME route proves a different
  consumer path. Removing the guard would invent semantics and violate Rule 12.
- Prior L4 route search toward the `sprite1` screenshot area failed to reach a
  valid comparable frame: best diagnostic route ended in an airborne/player
  state mismatch around timer `80`, not the reference timer/location. It is
  useful only to guide the next probe, not as active-vs-neutral proof.

Status: **D2-probe-improved / L4-branch-classification-added** — 2026-05-19.

- Extended `packages/cli/src/probe-sprite-cases.ts` collision-slot output with
  `scriptState1a`, `scriptKind1b`, `mode1e`, and a fail-loud
  `fun29cceBranch` classifier. Validation:
  `npx tsc -p packages/cli/tsconfig.json --noEmit --pretty false` PASS.
- Re-ran the probe on
  `packages/web/public/scenarios/playable/candidate_level4_postseed_dr_f3000.seed.json`.
  The sampled visible Aerial slots are `scriptState1a=4`, `scriptKind1b`
  `30..35`, and `base46=0x020c14`. Their tags remain `0x0b`/`0x0d`, but the
  classifier marks them `tag0b-guard-miss-original-noop` or
  `tag0d-guard-miss-original-noop`.
- Interpretation: this sampled L4 state is not evidence that the implemented
  gate branches should accept `0x020c14`. In the original branch those slots
  miss the `slot+0x46` guard. The bug, if these are the user-visible
  nonphysical objects, is still upstream route/slot ownership or script-state
  progression, not a justified collision-guard relaxation.

Status: **D4-sprite4-zero-death-TS-route-found** — 2026-05-19.

- Extended `packages/cli/src/probe-sprite-cases.ts` with `--step-pixels` so
  route replays can match the higher keyboard/trackball force used by the
  playable route search instead of the probe's old fixed 8-pixel diagnostic
  input. Validation:
  `npx tsc -p packages/cli/tsconfig.json --noEmit --pretty false` PASS.
- Ran a fresh zero-death L3/Intermediate route search for the `sprite4`
  reference family:
  `/tmp/marble-sprite-goal/l3-sprite4-current-run-search/manifest.json`.
  The useful intermediate candidate is frame `2400`, descriptor `0x2cd9e`,
  timer `48`, player state `0`, deaths `0`, player around `x=369.8`,
  `y=406.2`. This is close to the desktop reference timer `46` and beige
  board family.
- Replayed the frame-2400 route from
  `packages/web/public/scenarios/playable/start_level3_intro_intermediate_f2435.seed.json`
  with `--step-pixels 22`. Probe output reports two upstream `type4` entries:
  `sub3` at struct `0x401422` and `sub2` at struct `0x4013c2`; both are
  binary-visible (`d4=225` and `d4=217`), both resolve cel lists, and the
  active linked-list frame emits four sprites at palette index `294`.
- Current classification for `sprite4`: TS-side object -> MO -> renderer
  evidence is now strong for the correct L3 family and a zero-death route, but
  D4 is still not final green until a frozen browser capture and MAME/reference
  route attachment are saved for the same route/frame.

Status: **D4-sprite4-browser-frozen-capture** — 2026-05-19.

- Serialized the same TS route/frame to generated scratch seed
  `/tmp/marble-sprite-goal/current-run/l3_sprite4_f2400_step22.seed.json`.
  This seed is diagnostic-only and was not added to playable start-level seed
  wiring.
- Temporarily loaded that seed through `packages/web/public/mame_state.json`
  with `?autoLoad=1&mameDump=1&debugState=1&sound=0&loopReset=0`, captured
  the browser, then restored the prior dirty `mame_state.json` exactly
  (`sha256=3b8f8f926932382aa8b9124e10708653d0094ef7c8a3f970952cc6c40453e37d`).
- Browser capture saved at
  `/tmp/marble-sprite-goal/current-run/browser_l3_sprite4_f2400_step22.png`.
  The debug overlay reports `level=2` (zero-indexed L3), timer `48`, player
  around `x=369.8`, `y=406.2`, and the beige Intermediate board; the green
  object is visible in the same upper-right course family as the reference.
- Current classification for `sprite4`: TS visibility path is green enough for
  local renderer proof on this zero-death route. It still needs MAME/reference
  route attachment before the whole D4 case can be marked final green.

Status: **D4-sprite4-MAME-route-attach-blocker-isolated** — 2026-05-19.

- Attempted to attach the `sprite4` TS route to MAME rather than relying on
  the browser-only frozen seed. A local MAME environment trap was found first:
  repository-local `cfg/marble.cfg` forces the service DIP low
  (`:F60000` mask `64` value `0`), which makes the input tap report
  `F60001=0x2f` and leaves captures in descriptor `0x000000` / timer `0`.
  This invalidates captures made with the default repo cfg for route proof.
- Re-ran MAME with scratch cfg/nvram directories under
  `/tmp/marble-sprite-goal/current-run/`. Sanity check with the known L3
  bootstrap proof works again:
  `/tmp/marble-sprite-goal/current-run/mame-l3-known-proof-clean/scenarios/f3000.json`
  probes as descriptor `0x02cd9e`, timer `83`, player state `0`, and
  `linkedSprites=7`.
- Tried the `sprite4` route with clean cfg/nvram plus L3 bootstrap:
  `/tmp/marble-sprite-goal/current-run/mame-l3-sprite4-step22-clean-active`.
  This is not final proof: at f4835 MAME remains descriptor `0x02cd9e` but the
  player is state `4`, position around `x=180`, `y=84`, and there are no
  `type4` draw-list entries. The neutral capture is separable, but the active
  route is not the TS route (`sprite4` TS had state `0`, x/y around
  `369.8/406.2`, and `type4` entries).
- Verified the checked-in seed
  `packages/web/public/scenarios/playable/start_level3_intro_intermediate_f2435.seed.json`
  is byte-exact against the old authoritative MAME proof:
  `/private/tmp/marble-true-start-banner-delayed-input-proof-20260516/l3-f2435-active/scenarios/f2435.json`
  (`workRam`, `playfieldRam`, `spriteRam`, `alphaRam`, `colorRam` all diff
  `0`). That old proof is still a valid MAME reference for the seed start
  itself.
- A fresh no-bootstrap MAME run with the same route start does **not** recreate
  the old f2435 seed in this environment: it stays in descriptor `0x02c54c`
  at f2435. This means the remaining gap is route attachment from the
  already-proven f2435 warm state, not TS renderer visibility.
- Added `BL = {-0.5, 0.75}` to `oracle/mame_playable_input_capture.lua` route
  units while testing exact input-prefix reconstruction. It is a diagnostic
  route expressiveness addition only; no gameplay or seed wiring changed.
- Current `sprite4` classification: MAME seed-start proof green, TS route and
  browser visibility proof green, but same-route MAME proof still grey. Do not
  close D4 until either MAME can replay from the f2435 warm state or an
  equivalent current-MAME route reaches the same type4 region.

Status: **D4-sprite4-warm-seed-MAME-not-proof** — 2026-05-19.

- Added a diagnostic warm-seed path to
  `oracle/mame_playable_input_capture.lua`:
  `MARBLE_PLAYABLE_WARM_SEED` writes seed JSON regions into MAME RAM and
  `MARBLE_PLAYABLE_WARM_FRAME` chooses the injection frame. This is a proof
  tool only; it does not alter TS gameplay, seed wiring, or start-level
  selection.
- Warm-seed smoke at frame `2435` using
  `packages/web/public/scenarios/playable/start_level3_intro_intermediate_f2435.seed.json`
  loads descriptor `0x02cd9e`, segment `2`, timer `51`, player state `0`,
  and player x/y/z `180/76/16408`. Compared with the checked-in seed,
  `workRam`, `playfieldRam`, `alphaRam`, and `colorRam` are byte-exact after
  injection; `spriteRam` differs because MAME rewrites the motion-object RAM
  during that same frame.
- Replaying the zero-death TS `sprite4` route from that warm state is still
  rejected as proof. The active route input trace contains non-neutral
  `scriptDx/scriptDy`, but MAME remains frozen at the injected L3 state through
  f4200 and then falls to descriptor `0x02bee2` by f4835. The neutral run ends
  in the same descriptor/player state. Active-vs-neutral therefore does not
  demonstrate gameplay route control or object contact.
- Interpretation: RAM-only warm loading is insufficient for route proof because
  CPU/slapstic/IRQ/dispatcher runtime state is not restored to the old MAME
  proof's execution point. This confirms the remaining `sprite4` gap is proof
  attachment, not a renderer-all-banks issue and not a license to hardcode
  route/seed behavior.
- Scratch evidence paths:
  `/tmp/marble-sprite-goal/current-run/mame-warm-f2435-smoke/`,
  `/tmp/marble-sprite-goal/current-run/mame-warm-l3-sprite4-active/`, and
  `/tmp/marble-sprite-goal/current-run/mame-warm-l3-sprite4-neutral/`.
- Validation after this checkpoint:
  `git diff --check -- GOAL.md docs/codex-task-sprite-visibility-physics.md oracle/mame_playable_input_capture.lua packages/cli/src/probe-sprite-cases.ts packages/engine/src packages/engine/test`
  PASS;
  `npx tsc -p packages/cli/tsconfig.json --noEmit --pretty false` PASS;
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false` PASS;
  focused Vitest sprite/render pack PASS (`8` files, `125` tests).

Status: **D3-tag05-proximity-bumper-implemented / sprite2-proof-still-grey** — 2026-05-19.

- Re-read the existing L4 proof seeds instead of relaxing the earlier Aerial
  gate guards. Probe output
  `/tmp/marble-sprite-goal/current-run/l4_mame_existing_proofs_probe.json`
  and
  `/tmp/marble-sprite-goal/current-run/l4_type11_type5_probe_after.json`
  shows the sampled `sprite1`-like visible `type11/13` objects map to collision
  slots with tags `0x0b`/`0x0d`, but `slot+0x46 == 0x020c14`. The original ROM
  branch guards for the implemented gate paths require `0x22016` or `0x220a6`,
  so those sampled slots remain classified as `guard-miss-original-noop`.
  Do not remove or widen those guards without a new exact MAME route.
- Independently decoded `FUN_29CCE` tag `0x05` from the original branch at
  `0x029f40`. It computes the same weighted delta denominator used by the
  other collision branches, accepts only proximity `< 0x38`, sets both restore
  flags, sends sound command `0x42`, then relies on the common epilogue to
  restore X/Y and negate velocity.
- Implemented tag `0x05` in `packages/engine/src/sub-29cce.ts` and covered it
  in `packages/engine/test/sub-29cce.test.ts` with a positive contact case, an
  outside-radius no-op case, and a tracked `level4_early` work-RAM scenario:
  visible `type5` sub12 maps to collision slot 12, reaches `d6=0,a0=0`, sets
  restore flags, negates velocity through the common epilogue, and emits sound
  `0x42`.
- Extended `packages/cli/src/probe-sprite-cases.ts` so visible `type5`,
  `type11`, and `type13` draw-list entities report ROM struct data, active
  motion-block headers, binary visibility, and their matching collision slot.
  The `level4_early` probe now pairs visible `type5` sub11/sub12 with collision
  slots 11/12 and classifies their tag as `tag05-proximity-bumper`.
- Current D3 classification: a real missing original physical branch has been
  fixed for the `sprite2` candidate family and now has a deterministic tracked
  scenario proof, while `sprite1` remains unproven and must not be forced.
  `sprite2` is also not final green until the exact screenshot object/contact
  is attached to a MAME/TS active-vs-neutral or contact-vs-no-contact route.
- Validation already run after this checkpoint:
  `npx vitest run packages/engine/test/sub-29cce.test.ts --silent` PASS
  (`35 tests`);
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false` PASS;
  `npx tsc -p packages/cli/tsconfig.json --noEmit --pretty false` PASS;
  `git diff --check -- packages/engine/src/sub-29cce.ts packages/engine/test/sub-29cce.test.ts packages/cli/src/probe-sprite-cases.ts GOAL.md docs/codex-task-sprite-visibility-physics.md`
  PASS.
- Broader focused validation after updating the durable checkpoint:
  `npx vitest run packages/engine/test/sub-29cce.test.ts packages/engine/test/late-game-logic-26f3e.test.ts packages/engine/test/main-loop-init-task-a.test.ts packages/engine/test/state-sub-1953e.test.ts packages/engine/test/refresh-frame-10fce.test.ts packages/web/test/renderer.test.ts packages/web/test/engine-diagnostic-frame.test.ts packages/engine/test/render.test.ts --silent`
  PASS (`8` files, `128` tests);
  engine typecheck PASS;
  cli typecheck PASS;
  focused `git diff --check` PASS.

Status: **D4-sprite3-browser-proof-strengthened / exact-route-still-grey** — 2026-05-19.

- Re-anchored `sprite3` against the user reference
  `/Users/magnus-bot/Desktop/sprite3.png`: yellow/black L5/Silly board,
  timer `17`, colored small objects in the upper arena, marble near the
  upper-left area. This remains the visual target, not a replaceable seed.
- Probed the current TS diagnostic seed
  `/tmp/marble-sprite-goal/l5_type79_d4_199_after_fix.seed.json`.
  Output saved at
  `/tmp/marble-sprite-goal/current-run/l5_sprite3_probe_current.json`.
  It reports descriptor `0x02de1e`, timer `11`, level family L5, and visible
  `type7/8/9` entries including `d4=245`, `231`, `227`, `217`, `207`, and
  `199`. The old TS cull would have rejected the `d4 < 0xf0` entries, while
  the binary/MAME-style visibility check keeps them. The active linked-list
  frame emits `14` linked sprites, including palette families `295`, `303`,
  and `311`.
- Captured the same frozen TS state in the browser after temporarily loading
  it through `packages/web/public/mame_state.json`, then restored the previous
  dirty `mame_state.json` byte-exact. Clean capture:
  `/tmp/marble-sprite-goal/current-run/browser_l5_sprite3_type79_after_fix_clean.png`;
  debug capture:
  `/tmp/marble-sprite-goal/current-run/browser_l5_sprite3_type79_after_fix.png`.
  The clean capture shows the colored objects visible on the yellow/black
  board, matching the `sprite3` object family.
- Re-probed known L5 start frames
  `packages/web/public/scenarios/playable/start_level5_intro_silly_f2472.seed.json`,
  `/private/tmp/marble-true-start-banner-delayed-input-proof-20260516/l5-f2472-active/scenarios/f2472.json`,
  and
  `/private/tmp/marble-true-start-post-banner-proof-20260516/l5-f2612-active/scenarios/f2612.json`.
  These are still useful seed-start references for descriptor `0x02de1e`, but
  their `type7/8/9` entries sit outside the visible range at start and do not
  attach to the user screenshot route.
- Rejected `/tmp/marble-sprite-goal/mame-l5-snapshots/mame_l5_2200..5600.json`
  as proof: the snapshots probe as descriptor `0x000000`, timer `0`, player
  state `6`, and type-zero/service-like object lists. Per Rule 12, they are
  invalid evidence, not a reason to mark `sprite3` fixed or broken.
- Current `sprite3` classification: TS object -> MO -> renderer visibility is
  now strongly supported for the correct L5 object family, and the previous
  cull bug is plausibly fixed. The case is still not final green because the
  exact MAME/reference route for the desktop screenshot at timer `17` has not
  been attached with active-vs-neutral or equivalent route proof.

Status: **D3-sprite1-corpus-scan-no-gate-eligible-slot** — 2026-05-19.

- Rechecked the disassembly bytes around `FUN_29CCE` tag `0x0b` and `0x0d`.
  The ROM really performs `cmp.l #0x00022016,(0x46,A3)` for tag `0x0b` and
  `cmp.l #0x000220a6,(0x46,A3)` for tag `0x0d` before entering the Aerial
  gate/bumper physical branches. This confirms the TS guard is not an invented
  local constraint.
- Scanned local scenario/seed evidence under
  `/Users/magnus-bot/Code/marble-love`, `/tmp/marble-sprite-goal`, and
  `/private/tmp` for active L4 gate-like slot rows. Evidence saved at
  `/tmp/marble-sprite-goal/current-run/l4_gate_base46_corpus_scan.json`.
  Summary: `88195` JSON snapshots scanned, `16950` rows with `tag 0x0b/0x0d`,
  `0` rows with eligible `base46` values `0x22016` or `0x220a6`. Every sampled
  `tag 0x0b/0x0d` row uses `base46=0x020c14`.
- Current `sprite1` interpretation: the locally captured yellow Aerial
  gate/bumper objects are visible object rows, but all sampled collision slots
  still hit the original ROM guard-miss/no-op path. This is not a license to
  widen the guard or add a screen-space hitbox. To make `sprite1` green, we
  still need either an exact MAME route proving those screenshot gates have
  physical effect, or a different slot/object owner that reaches the
  `0x22016/0x220a6` records.

Status: **D3-sprite2-type5-not-L4-owner-yet** — 2026-05-19.

- Ran a separate entity-list scan to avoid conflating the `type5` proximity
  bumper proof with the Aerial/GOAL desktop reference. Evidence saved at
  `/tmp/marble-sprite-goal/current-run/l4_entity_type_scan.json`.
- Result: across the same local corpus there are `5912` snapshots with level
  descriptor `0x02d648` (Aerial/L4). Their entity-list type distribution is
  `type11=11300`, `type1=5824`, `type13=5650`, `type4=93`, `type2=31`, and
  `type5=0`.
- Interpretation: the implemented `tag 0x05` proximity bumper is still a real
  missing ROM branch and remains covered by the tracked `level4_early`
  scenario, but that scenario is not proven to own the `sprite2` screenshot.
  If `sprite2` is truly the Aerial/GOAL frame shown by the desktop reference,
  the current best local `type5` proof cannot be promoted to final green
  without a new exact route/object owner.
- Validation after this checkpoint: focused `git diff --check` PASS;
  `npx vitest run packages/engine/test/sub-29cce.test.ts --silent` PASS
  (`35` tests);
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false` PASS;
  `npx tsc -p packages/cli/tsconfig.json --noEmit --pretty false` PASS.

Status: **D2-video-reference-anchored / exact-route-proof-still-grey** — 2026-05-19.

- Re-read the Codex Goals guide before setting the objective standard. This PRD
  follows its shape: outcome, verification surface, constraints, iteration
  policy, and fail-loud stop condition. Goal completion remains evidence-based,
  not visual-confidence-based.
- Found the public MAME video reference that matches the four desktop
  screenshots: `https://youtu.be/m2k1WCmkHBM`, title
  "Marble Madness (MAME) - level 1-5", description states it was recorded from
  MAME on 2015-01-27. Saved HTML metadata at
  `/tmp/marble-sprite-goal/video-ref/youtube_m2k1WCmkHBM.html`.
- Parsed the YouTube storyboard spec and saved sheets under
  `/tmp/marble-sprite-goal/video-ref/storyboards/`. Saved the annotated contact
  sheet at
  `/tmp/marble-sprite-goal/video-ref/storyboards_l2_annotated.jpg`.
- Cropped exact visual-anchor tiles under
  `/tmp/marble-sprite-goal/video-ref/reference-tiles/`:
  `sprite1_aerial_red_gates_timer42_idx63_t126s.jpg`,
  `sprite1_aerial_red_gates_timer39_idx64_t128s.jpg`,
  `sprite2_aerial_goal_timer15_idx76_t152s.jpg`,
  `sprite3_silly_colored_timer17_idx107_t214s.jpg`, and
  `sprite4_intermediate_green_timer46_idx42_t84s.jpg`. Matching `_4x.jpg`
  inspection copies exist for each crop.
- Updated D2 classification:

| Case | Video/storyboard anchor | What this proves | Still grey |
| --- | --- | --- | --- |
| `sprite1` | Aerial red gate/bumper family, storyboard idx63/idx64, t126/t128s, timer about 42/39 | The user reference is definitely an Aerial/L4 gate-family frame, not an unrelated local seed. | Exact object slot/contact owner and active-vs-neutral MAME/TS physical effect. |
| `sprite2` | Aerial GOAL frame, storyboard idx76, t152s, timer 15 | The desktop reference belongs to the Aerial/GOAL route. The previous `type5` proximity-bumper candidate is not automatically the owner. | Exact object/contact owner; physical interaction proof for the screenshot object. |
| `sprite3` | Silly/L5 colored objects, storyboard idx107, t214s, timer 17 | The target object family and timer are now anchored to the public MAME reference. | TS route must be brought from current timer 11 diagnostic proof to the timer 17 screenshot route, or otherwise MAME-attached. |
| `sprite4` | Intermediate/L3 green blobs, storyboard idx42, t84s, timer 46 | Confirms the remap away from stale `0x2c54c/type0x2c` high-score-like evidence and toward Intermediate/L3 type4-family objects. | MAME same-route proof for the TS zero-death type4 capture; current warm-seed route attach remains invalid proof. |

- This checkpoint upgrades the reference side of D2. It does **not** close
  D3/D4: `sprite1` and `sprite2` still need original physical interaction
  proof, and `sprite3`/`sprite4` still need exact route/MAME attachment before
  final green status.

Status: **D3-sprite1-L4-timeline-eligible-windows-found / no-contact-proof-yet** — 2026-05-19.

- Extended `packages/cli/src/probe-sprite-cases.ts` with
  `--timeline-every N`. This is diagnostic-only observability: it samples
  compact object/collision state while replaying a route and does not alter
  gameplay, renderer behavior, seed selection, or MAME proof rules.
- Ran a new TS route search from
  `packages/web/public/scenarios/playable/start_level4_intro_aerial_f2414.seed.json`
  toward later Aerial/L4 coordinates. Manifest:
  `/tmp/marble-sprite-goal/current-run/l4-goal-route-search-20260519/manifest.json`.
  The best candidate reaches descriptor `0x02d648`, timer `43`, player
  state `0`, x/y about `449.7/533.3`, but has `deathEvents=2`. Therefore it is
  usable only as object-state exploration, not as playable proof or seed proof.
- Saved the timeline probe at
  `/tmp/marble-sprite-goal/current-run/l4_sprite1_timer43_death_route_timeline.json`.
  Key extraction:
  - routeFrame `1800`, timer `53`: slot `2`, `type19=2`, `tag1f=0x0b`,
    `base46=0x022016`, classified as `tag0b-gate-eligible`.
  - routeFrame `2100`, timer `48`: slot `4`, `type19=4`, `tag1f=0x0d`,
    `base46=0x0220a6`, classified as `tag0d-gate-eligible`.
- This supersedes the earlier corpus-only assumption that no local L4 evidence
  ever reaches the eligible gate records. The previous corpus scan is still
  true for saved JSON snapshots; it was incomplete for replayed TS routes.
- The same timeline still does **not** prove a physical fix:
  - the route includes two deaths before the relevant window;
  - the eligible samples do not have contact-range deltas (`tag0b` sample has
    `d6=-40,a0=-128`; `tag0d` sample has `d6=48,a0=-48`);
  - no MAME active-vs-neutral comparison exists for the same route/window.
- Current `sprite1` next step: search or steer for a zero-death or at least
  MAME-attached route where an eligible L4 gate slot is also inside the ROM
  contact range, then compare active-vs-neutral. Do not widen the existing
  `FUN_29CCE` guard checks; the new evidence supports the original guards.

Status: **D3-runtime-gate-contact-found / MAME-proof-still-grey** — 2026-05-19.

- Added runtime-only observability for `FUN_29CCE` Aerial gate branches:
  `state.debug.lastTerrainGateProbe`, surfaced by
  `packages/cli/src/probe-sprite-cases.ts`. It records the actual `d6/a0`,
  `base46`, branch result, slot, and marble state seen inside the branch, so
  post-frame globals cannot masquerade as collision evidence.
- Replayed the earlier zero-death candidate from
  `/tmp/marble-sprite-goal/current-run/l4-gate-contact-zero-death-20260519`.
  It is now rejected as proof: the old probe showed `slot7 d6/a0=0/0` after
  the frame, but runtime `lastTerrainGateProbe` shows `guard-miss` /
  `outer-range-x-miss` during the actual branch (`tag0d`, `base46` transitions
  to `0x0220a6`, but the real deltas are outside the ROM contact ranges). This
  was a diagnostic false positive, not a gameplay fix.
- Updated `packages/cli/src/search-l4-gate-contact.ts` so scoring uses only
  runtime gate-probe results instead of post-frame slot/global geometry.
  Validation: `npx tsc -p packages/cli/tsconfig.json --noEmit --pretty false`
  PASS; engine typecheck also PASS.
- New runtime-gated zero-death TS candidate saved at
  `/tmp/marble-sprite-goal/current-run/l4-gate-runtime-contact-20260519/manifest.json`.
  Best route:
  `D:90,UR:30,DR:30,UR:30,DR:30,D:60,L:30,R:30` with `stepPixels=32`.
  At routeFrame `321`, timer `78`, player state `0`, slot `2`
  `tag0b/base46=0x022016` reports `runtime-inner-impulse` with real branch
  deltas `d6=19,a0=-29`.
- TS replay evidence:
  active timeline
  `/tmp/marble-sprite-goal/current-run/l4_gate_runtime_contact_candidate01_timeline.json`
  records `lastTerrainSlotCollision.frame=321`, reason `motion`, slot `2`,
  and no `lastHelper121B8BoundsBounce`. Neutral comparison
  `/tmp/marble-sprite-goal/current-run/l4_gate_runtime_contact_candidate01_neutral_timeline.json`
  keeps the same slot eligible but outside contact as `outer-range-x-miss`.
  At routeFrame `325`, active is `x=292.83,y=318.88,vx=-19466,vy=23958`
  with `inner-impulse`; neutral is `x=269.01,y=322.78,vx=-7475,vy=87251`
  with `outer-range-x-miss`.
- Current classification: D3 has a real TS-side runtime contact and physical
  response for an eligible L4 gate slot. This is still not final green for
  `sprite1`/`sprite2`: the candidate timer/location do not match the desktop
  screenshot anchors, and MAME active-vs-neutral proof for this route has not
  been captured.

Status: **D3-MAME-route-attempts-reject-current-TS-candidate** — 2026-05-19.

- Ran three MAME/reference attempts for the runtime-gated TS route
  `D:90,UR:30,DR:30,UR:30,DR:30,D:60,L:30,R:30`, step `32`, around expected
  hit frame `2735` (`start_level4_intro_aerial_f2414 + routeFrame 321`):
  - cold bootstrap L4, cfg/nvram scratch:
    `/tmp/marble-sprite-goal/current-run/mame-l4-runtime-contact-20260519/`
  - cold bootstrap L4 with Y-flipped route labels:
    `/tmp/marble-sprite-goal/current-run/mame-l4-runtime-contact-yflip-20260519/`
  - RAM-only warm seed injection from
    `packages/web/public/scenarios/playable/start_level4_intro_aerial_f2414.seed.json`:
    `/tmp/marble-sprite-goal/current-run/mame-l4-runtime-contact-warm-20260519/`
- All three are diagnostic-only, not D3 proof:
  - cold bootstrap routes keep descriptor `0x02d648` but land in player
    `state1`, show only `tag17/tag18` slots near the sampled frame, and never
    attach to the TS `tag0b/base46=0x022016` contact.
  - the warm-seed run starts from the exact TS seed RAM at frame `2414`, but by
    frame `2735` the player is in `state4`; it exposes the visible L4
    `tag0b/tag0d` slots only with `base46=0x020c14`, matching the previous
    corpus scan, and not the eligible `0x022016/0x0220a6` values.
  - `audit-mame-route-proof.ts` marks all runs `diagnostic-only` because the
    proof snapshots are not a clean playable state-0 active-vs-neutral surface.
- Updated interpretation: the TS runtime contact remains useful as a probe of
  the implemented ROM branch, but the specific route is now suspect as a
  screenshot/reference proof. Do not promote it, do not wire it as a seed, and
  do not mark `sprite1`/`sprite2` green from it. Next D3 work should either
  find a MAME-live/manual route that reaches the exact screenshot object, or
  prove from MAME/disasm that the user-visible L4 `base46=0x020c14` gates are
  intentionally visual/no-op and the missing physical effect belongs to a
  different object family.

Status: **D4-sprite3-timer17-TS-candidate / MAME-route-still-grey** — 2026-05-19.

- Added diagnostic-only route search
  `packages/cli/src/search-l5-sprite3-visibility.ts`. It searches Silly/L5
  from `start_level5_intro_silly_f2472` for playable frames where the ROM
  `type7/8/9` object family is binary-visible. This tool only writes scratch
  candidates; it does not modify gameplay, renderer behavior, playable seeds,
  `startLevel`, or route proof promotion.
- Fixed the new search tool before use: ROM loading now uses
  `bus.emptyRomImage()` plus `applySlapsticBank.loadRomBlob(...)`, matching
  the existing CLI tools, and avoids applying Slapstic to `GameState`.
  Validation: `npx tsc -p packages/cli/tsconfig.json --noEmit --pretty false`
  PASS; 60-frame smoke PASS.
- Negative search: with the current web/keyboard-scale `stepPixels=32`, search
  output
  `/tmp/marble-sprite-goal/current-run/l5-sprite3-visibility-search-20260519/manifest.json`
  reaches descriptor `0x02de1e`, timer `17`, player state `0`, deaths `0`,
  but `visibleCount=0`. This is a useful reject, not a proof.
- Positive TS candidate: with the historical probe scale `stepPixels=8`, search
  output
  `/tmp/marble-sprite-goal/current-run/l5-sprite3-visibility-search-step8-20260519/manifest.json`
  finds a zero-death candidate at routeFrame `3261` / absolute frame `5733`,
  descriptor `0x02de1e`, timer `17`, player state `0`, player around
  `x=814.81,y=732.00`, with `visibleCount=9` and `oldDroppedCount=9`.
  Best route:
  `U:120,R:30,D:60,U:30,D:30,U:30,D:30,U:30,D:30,U:30,D:30,U:30,D:30,U:90,D:30,U:780,R:30,U:90,D:30,U:30,L:30,U:30,L:30,U:90,R:30,U:30,L:30,U:150,D:30,U:1221`.
- Seed/probe evidence saved:
  `/tmp/marble-sprite-goal/current-run/l5-sprite3-visibility-search-step8-20260519/01_l5_sprite3_f3261_timer17.seed.json`
  and
  `/tmp/marble-sprite-goal/current-run/l5_sprite3_timer17_step8_probe.json`.
  Independent probe confirms descriptor `0x02de1e`, timer `17`, main/mode
  `0/0`, player state `0`, nine visible `type7/8/9` rows with `d4` values
  `208,196,170,175,162,154,136,126,120`, all rejected by the old TS
  `d4 >= 0xf0` bound. The active linked-list frame emits `16` sprites and
  includes palette families `295`, `303`, and `311`.
- Browser frozen capture saved at
  `/tmp/marble-sprite-goal/current-run/browser_l5_sprite3_timer17_step8.png`
  after temporarily loading the candidate through
  `packages/web/public/mame_state.json`. The prior dirty
  `mame_state.json` was restored byte-exact (`sha256`
  `3b8f8f926932382aa8b9124e10708653d0094ef7c8a3f970952cc6c40453e37d`).
  The capture shows the L5 yellow/black board at timer `17` with the colored
  object family visible.
- Current `sprite3` classification: TS object -> MO -> renderer visibility is
  now matched to the reference timer and level family much more tightly than
  the older timer-11 seed. It is still not final green: the route uses the TS
  probe input scale, and no MAME/live route has yet confirmed the same path or
  a corresponding reference capture. Per Rule 12, D4 remains grey until that
  MAME/reference attachment exists.

Status: **D4-sprite3-MAME-route-attempts / current-f3520-base-is-live-but-not-visible** — 2026-05-19.

- Tried to attach the timer-17 `sprite3` TS route to MAME instead of relying
  on the browser frozen seed.
- First attempt used the f2472 start-level path plus a reconstructed default
  route prefix (`L:110,U:110,R:110,BL:110,N:12`) before the TS route. Evidence:
  `/tmp/marble-sprite-goal/current-run/mame-l5-sprite3-timer17-step8-prefix-20260519/`.
  Result: rejected. At f5725..f5755 MAME is descriptor `0x02c54c`/L2, player
  state `5`, and active/neutral do not diverge. Probe:
  `/tmp/marble-sprite-goal/current-run/mame-l5-sprite3-timer17-step8-prefix-20260519/probe-sprite-cases.json`.
- Diagnostic timeline for that prefix saved under
  `/tmp/marble-sprite-goal/current-run/mame-l5-sprite3-timer17-step8-prefix-timeline-20260519/`.
  It shows the reconstructed prefix never reaches the promoted L5 f2472 seed:
  f2200/f2341/f2472 remain descriptor `0x02c54c`; later frames fall through
  L1/L2 death/recovery surfaces. This falsifies the assumption that the
  f2472 true-start can be recreated by the default route prefix alone.
- Bootstrap smoke with `MARBLE_PLAYABLE_BOOTSTRAP_TARGET_LEVEL=5` at f1747
  reaches descriptor `0x02de1e` but leaves the player in state `6`, not the
  promoted f2472 state0 seed. Evidence:
  `/tmp/marble-sprite-goal/current-run/mame-l5-bootstrap-smoke-20260519/`.
- Switched to the current reproducible MAME L5 f3520 base. Existing historical
  f3520 proof has timer `80`, but a fresh current-script bootstrap
  (`BOOTSTRAP_TARGET_LEVEL=5`, `BOOTSTRAP_FRAME=2300`) produces descriptor
  `0x02de1e`, main/mode `0/0`, player state `0`, timer `58`, x/y `1004/996`.
  Extracted scratch seed:
  `/tmp/marble-sprite-goal/current-run/mame_current_l5_f3520_timer58_state0.seed.json`.
- TS search from that exact current-MAME seed:
  - step8:
    `/tmp/marble-sprite-goal/current-run/l5-sprite3-from-current-mame-f3520-step8-search-20260519/manifest.json`
    finds timer `17`, zero-death, `visibleCount=9`, `oldDroppedCount=9`, but
    MAME active route is death-prone at the proof window. Evidence:
    `/tmp/marble-sprite-goal/current-run/mame-l5-sprite3-current-f3520-cand01-20260519/`.
    Audit marks `diagnostic-only` because active has one death and the tail is
    unstable; probe shows active f5965 state `4`, no visible type7/8/9.
  - step4:
    `/tmp/marble-sprite-goal/current-run/l5-sprite3-from-current-mame-f3520-step4-search-20260519/manifest.json`
    stays zero-death but never brings type7/8/9 into the visible band at
    timer `17` (`visibleCount=0`), so no MAME attempt was promoted.
  - step6:
    `/tmp/marble-sprite-goal/current-run/l5-sprite3-from-current-mame-f3520-step6-search-20260519/manifest.json`
    finds timer `17`, zero-death, `visibleCount=9`, `oldDroppedCount=9`.
    MAME active/neutral run:
    `/tmp/marble-sprite-goal/current-run/mame-l5-sprite3-current-f3520-step6-cand01-20260519/`
    is the strongest route proof so far: seed f3520 is byte-exact
    active/neutral, active route is responsive and stable, no deaths, and
    `audit-post-seed-mame-proof.ts --min-tail-frames 20` reports
    `post-seed-candidate`. However the MAME proof window f5965..f5985 still
    has `visible789=0` and linked sprites `1` active / `7` neutral. It proves
    control from current L5 f3520, but not the missing colored-object
    visibility.
- Current `sprite3` interpretation: we now have a clean separation:
  TS can put the correct L5 type7/8/9 family onscreen at timer 17 from both
  the promoted f2472 seed and a current-MAME f3520 seed, but MAME route
  attachment has not reproduced those visible objects. Do not mark D4 green.
  The next `sprite3` route work should search against MAME-observed dynamics
  (or use manual MAME capture around the public video route), not promote the
  TS route as equivalent.

Status: **D4-sprite3-MAME-native-sweep-negative** — 2026-05-19.

- Continued from the current reproducible MAME L5 f3520 base instead of the TS
  timer-17 route. The goal was to see whether simple MAME-native route units
  can bring the `type7/8/9` Silly objects into the visible band at the same
  timer window.
- Direction sweep evidence saved under
  `/tmp/marble-sprite-goal/current-run/mame-l5-f3520-direction-sweep-step6-20260519/`.
  At the proof frame all sampled directions (`D`, `DL`, `DR`, `L`, `N`, `R`,
  `U`, `UL`, `UR`) stayed at `visible789=0`. Some directions remained
  playable state `0`, others entered state `4`; none produced visible
  `type7/8/9` rows.
- Focused `DL` step sweep evidence saved at
  `/tmp/marble-sprite-goal/current-run/mame-l5-f3520-dl-step-sweep-20260519/`.
  Steps `8`, `10`, `12`, and `16` all stayed alive (`state=0`, timer `18`),
  but `type7/8/9` rows remained below the visible band with `d4=324..370`,
  `visible789=0`, and `linked=7`.
- Interpretation: this rules out the easy hypothesis that the TS step value is
  the only reason MAME misses the visible objects. It also confirms the L5
  f3520 base is usable and controllable, but the route search must be
  MAME-observed or manually captured; the existing TS route remains
  non-promotable. D4 for `sprite3` stays grey by Rule 12.

Status: **D4-sprite3-MAME-two-segment-sweep-negative** — 2026-05-19.

- Ran a bounded two-segment MAME sweep from the same L5 f3520 base, targeting
  the player coordinate region where the TS f3520 candidates make `type7/8/9`
  visible. Evidence saved at
  `/tmp/marble-sprite-goal/current-run/mame-l5-f3520-two-seg-sweep-20260519/`.
- Routes tested:
  `DL:1200,R:1252`, `DL:1200,DR:1252`, `DL:1200,D:1252`,
  `DL:900,R:1552`, `DL:900,DR:1552`, `DL:900,D:1552`,
  `DL:1500,R:952`, `DL:1500,DR:952`, `DL:1500,D:952`,
  `DL:1800,R:652`, `DL:1800,D:652`, and `R:900,DL:1552`, all with
  `ROUTE_STEP=6`, captured at f5972.
- All runs stayed in descriptor `0x02de1e`, player state `0`, timer `17`, but
  none reached the visible object band: `visible789=0`, `d4=322..370`.
  Several routes converged to `x=932`, `y=844` or `y=916`, suggesting the
  scripted route is reaching a MAME course boundary/plateau rather than the
  TS visible-object region.
- Interpretation: this further separates TS diagnostic visibility from MAME
  route attachment. The likely next proof path is not more straight-line
  scripted MAME input; it is either manual MAME capture near the public video
  route, or a MAME-in-the-loop route search scored directly from MAME
  snapshots.

Status: **D4-sprite3-MAME-top8-TS-candidates-rejected** — 2026-05-19.

- Ran MAME against all eight step-6 TS candidates from
  `/tmp/marble-sprite-goal/current-run/l5-sprite3-from-current-mame-f3520-step6-search-20260519/manifest.json`,
  rather than only candidate #1. Evidence saved at
  `/tmp/marble-sprite-goal/current-run/mame-l5-f3520-step6-top8-ts-candidates-20260519/`.
- Each run used the same reproducible L5 f3520 bootstrap base, `ROUTE_STEP=6`,
  the candidate's exact `routeSpec`, and captured at the TS candidate's
  absolute frame (`f5972`).
- Results:
  - candidates 1..7 stayed player state `0`, candidate 8 entered state `4`;
  - all reached timer `17`;
  - MAME player positions stayed around `x=960..1037`, `y=978..1059` instead
    of the TS visible-object candidate positions around `x=713..824`,
    `y=710..895`;
  - every run kept `type7/8/9` outside the visible band with `d4=322..370`
    and `visible789=0`.
- Interpretation: the TS route family is not MAME-equivalent even when it is
  zero-death and strongly visible in TS. This is not evidence against the
  cull fix; it is evidence that the remaining blocker is route/reference
  attachment. A user-provided debug screenshot or manual MAME capture near the
  public-video position would now be more valuable than more TS route
  variations.

Status: **D3-sprite1-vacuum-state10-fixed / user-debug-screenshot** — 2026-05-19.

- User provided a fresh debug screenshot from the first URL:
  `/Users/magnus-bot/Desktop/Screenshot 2026-05-19 alle 16.28.13.png`.
  The overlay is decisive for the `sprite1` Aerial vacuum/gate case:
  descriptor/L4 view, timer `65`, player `state1a=0x0a`, `f57=0x20`,
  `f58=0x02`, and `lastTerrainSlotCollision` / `lastTerrainScanStop` on
  slot `2@0x400b48`, `tag=0x0b`, with contact deltas `d6/a0=(14,-15)`.
- Interpretation: this is no longer a pure collision-missing symptom. The
  original `FUN_29CCE` tag `0x0b` inner-hit branch is firing in TS and puts
  the player into the ROM hit state. The visible bug is that the player then
  stayed trapped because `FUN_253EC` did not model jump-table entry `JT[10]`
  (`0x2563e`).
- Implemented `JT[10]` in
  `packages/engine/src/refresh-frame-10fce.ts`: it calls
  `spriteHelper1B9CC(obj,1)`, runs `slotSpawnPattern13D38(obj)`, waits while
  the countdown is nonzero, then reproduces the terminal original path:
  select the source script slot via ROM table `0x1f016[obj+0x58]`, write
  script pointer `0x1d752` for tag `0x0b` or `0x1d798` otherwise, send the
  per-kind sound command from table `0x1ef5a`, run `helper12896` on the slot,
  send sound `0x3c`, clear `obj+0x5a`, set `obj+0x1a=4`, increment
  `obj+0xd2`, and set `obj+0x57=0x65`.
- Added focused tests in
  `packages/engine/test/refresh-frame-10fce.test.ts` for both state-10
  surfaces: countdown still active (`0x57` decrements and state remains `10`)
  and terminal transition (slot script pointer advances through
  `helper12896`, player moves to state `4`, `obj+5a` clears, `obj+d2`
  increments, `obj+57=0x65`).
- Validation:
  `npx vitest run packages/engine/test/refresh-frame-10fce.test.ts --silent`
  PASS (`17` tests);
  `npx vitest run packages/engine/test/sub-29cce.test.ts packages/engine/test/refresh-frame-10fce.test.ts packages/engine/test/slot-spawn-pattern-13d38.test.ts --silent`
  PASS (`58` tests);
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false` PASS.
- Current status: the reported "aspirators swallowed the marble and it never
  respawned" failure should be fixed by the missing original state handler.
  This strengthens D3 for `sprite1`, but it does not close the full goal:
  `sprite2`, `sprite3`, `sprite4`, and final MAME/reference attachment still
  have grey criteria.

Status: **D3-sprite1-state10-route-regression-proof** — 2026-05-19.

- Extended diagnostic search tool
  `packages/cli/src/search-l4-gate-contact.ts` with `--target-contact`, so the
  search can require a specific runtime result such as `inner-hit-state`
  instead of stopping at any gate contact (`inner-impulse` was the previous
  best contact).
- Ran targeted TS search:
  `npx tsx packages/cli/src/search-l4-gate-contact.ts --frames 1200 --chunk 30 --step-pixels 32 --beam-width 192 --max-candidates 8 --max-deaths 0 --target-contact inner-hit-state --out-dir /tmp/marble-sprite-goal/current-run/l4-gate-state10-search-20260519`.
  Manifest:
  `/tmp/marble-sprite-goal/current-run/l4-gate-state10-search-20260519/manifest.json`.
- Best route is zero-death:
  `D:90,UR:30,DR:30,UR:30,DR:30,D:60,L:30,U:30` with `stepPixels=32`.
  It hits `runtime-inner-hit-state` at routeFrame `327`, timer `78`, player
  state `10`, slot `2`, `tag=0x0b`, `base46=0x022016`, `d6/a0=(5,-14)`,
  `f57=0x20`, and `f58=0x02`.
- Replay proof with neutral tail saved at
  `/tmp/marble-sprite-goal/current-run/l4_gate_state10_exit_timeline_after_fix.json`
  using route
  `D:90,UR:30,DR:30,UR:30,DR:30,D:60,L:30,U:30,N:100`. Timeline shows:
  `state0` before the hit, `state10` from routeFrame `327` through `390`
  while `f57` counts down, and `state4` from routeFrame `391` onward. Final
  routeFrame `430` has player `state1a=4`, not stuck in `state10`.
- Added ROM+seed+route regression coverage in
  `packages/engine/test/l4-gate-state10-route.test.ts`. This test loads
  `start_level4_intro_aerial_f2414`, replays the same route, asserts the
  exact runtime probe (`slotIndex=2`, `tag0b`, `base46=0x22016`,
  `d6/a0=(5,-14)`), observes `f57=0x20` / `f58=0x02` at entry, and requires
  an eventual transition to `state4`.
- Validation:
  `npx vitest run packages/engine/test/l4-gate-state10-route.test.ts --silent`
  PASS;
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false` PASS;
  `npx tsc -p packages/cli/tsconfig.json --noEmit --pretty false` PASS.
- Current status: `sprite1` now has a strong TS-side route regression proof
  for the exact state-10 aspirator failure reported by the user. It is still
  not a full-goal close because the PRD requires all four sprite cases and
  remaining MAME/reference attachments to be green.

Status: **D3-sprite1-state10-MAME-route-attempt-rejected** — 2026-05-19.

- Tried to attach the new TS `inner-hit-state` route to MAME:
  `/tmp/marble-sprite-goal/current-run/mame-l4-state10-route-20260519/`.
  Active route:
  `D:90,UR:30,DR:30,UR:30,DR:30,D:60,L:30,U:30,N:100`; neutral route:
  `N:430`; both use `ROUTE_STEP=32`, `TRACKBALL_START=2415`, L4 bootstrap at
  frame `2200`, and forced manual dispatcher at frame `2414`.
- Captures:
  active scenarios under
  `/tmp/marble-sprite-goal/current-run/mame-l4-state10-route-20260519/active/scenarios/`;
  neutral scenarios under
  `/tmp/marble-sprite-goal/current-run/mame-l4-state10-route-20260519/neutral/scenarios/`.
  Probe outputs:
  `active_l4_hit_probe.json` and `neutral_l4_hit_probe.json`.
- Result is rejected as proof. At the nominal hit frame (`l4_hit` snapshot
  frame `2741`), active MAME is descriptor `0x02d648` but player is already
  `state1a=4`, x/y `292/196`, timer `82`; neutral is also `state1a=4`.
  The active collision slots in that window show `tag0b/tag0d` rows with
  `base46=0x020c14`, classified as original guard-miss/no-op, not the TS
  `base46=0x022016` eligible slot.
- Audit saved at
  `/tmp/marble-sprite-goal/current-run/mame-l4-state10-route-20260519/audit-route-proof.json`.
  Verdict is `diagnostic-only`: active/neutral are responsive, but the
  initial proof window starts in state `4`, the playfield is not fully
  populated, and the nearest descriptor playfield diff remains too high.
- Interpretation: the new TS route/test proves the TS state-10 regression, but
  it still cannot be promoted to full D3/MAME proof for `sprite1`. The MAME
  route attach blocker remains: current scripted bootstrap does not reproduce
  the TS eligible gate state. Do not close `sprite1` as fully green from this
  route.

Status: **D4-sprite3-user-URL-confirmed-TS-good** — 2026-05-19.

- User clarified that the TS URL
  `http://192.168.85.200:5173/?autoLoad=1&startLevel=5&debugState=1&sound=0&loopReset=0`
  is the "second link" that is OK: all referenced sprites are visible and the
  marble reacts correctly in manual testing.
- Interpretation: this is a strong manual TS confirmation for the L5
  `sprite3` case after the `type7/8/9` visibility work. It does not by itself
  close D4 because the PRD still requires objective MAME/reference attachment
  for the exact screenshot route/window. Keep `sprite3` grey until that proof
  exists or is explicitly re-scoped.

Status: **D3-sprite2-catapult-owner-and-TS-physics-proof** — 2026-05-19.

- Rechecked `/Users/magnus-bot/Desktop/sprite2.png` as a visual anchor only:
  Aerial/L4 near GOAL, timer about `15`, with a small orange/brown object near
  the marble and goal zone.
- Ran TS route search toward that GOAL region:
  `npx tsx packages/cli/src/search-playable-route.ts --seed packages/web/public/scenarios/playable/start_level4_intro_aerial_f2414.seed.json --frames 4200 --chunk 30 --step-pixels 32 --beam-width 192 --max-candidates 8 --target-descriptor 4 --target-segment 2 --target-x 500 --target-y 760 --max-deaths 3 --out-dir /tmp/marble-sprite-goal/current-run/l4-sprite2-goal-route-search-20260519`.
  Candidate route evidence is saved in
  `/tmp/marble-sprite-goal/current-run/l4-sprite2-goal-route-search-20260519/manifest.json`
  and
  `/tmp/marble-sprite-goal/current-run/l4_sprite2_goal_route_probe_type10.json`.
- Corrected the earlier false owner hypothesis. The old `type5`/tag `0x05`
  candidate is real for another Aerial object family, but this GOAL-region
  route exposes the screenshot object as `type10/sub0`, struct `0x400a9c`,
  marker `0x0a`, cel list `0x0210ca`, active MO block `0x02108e`, with linked
  sprites `147/149/152/145` and palette `305`.
- The same `type10/sub0` maps to collision slot `0@0x400a9c`,
  `tag1f=0x0a`, classified as the original catapult-arm branch. The active
  route hits the branch at routeFrame `1309`: `lastTerrainSlotCollision`
  reports `slotIndex=0`, `colorTag=0x0a`, `reason=tag`, `d6/a0=(7,1)`,
  `slotX/Y/Z=(504,560,16276)`. The player immediately enters `state1a=3`,
  `obj+0x58=0x0a`, snaps to `x/y=(504,560)`, lowers Z by 3, and receives
  launch velocity (`vx=3370`, `vy=-163336` in the captured replay).
- Added TS active-vs-neutral regression coverage in
  `packages/engine/test/l4-gate-state10-route.test.ts`: the active route
  triggers the catapult at frame `1309`, while an equal-length neutral route
  never reaches `state1a=3` with `obj+0x58=0x0a`.
- Validation:
  `npx vitest run packages/engine/test/l4-gate-state10-route.test.ts --silent`
  PASS (`2` tests);
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false` PASS;
  `npx tsc -p packages/cli/tsconfig.json --noEmit --pretty false` PASS.
- Current status: `sprite2` has a strong TS-side object/MO/collision/physics
  proof, and the earlier `type5` owner should no longer be used for this
  screenshot. D3 is still not full green because this route has not been
  promoted with a MAME active-vs-neutral proof for the exact screenshot window.

Status: **D3-user-retest-scope-narrowed** — 2026-05-19.

- User retest update:
  - `sprite1`: accepted as working in manual TS gameplay; close for current
    user-facing sprite-goal scope. Keep the older MAME proof gap documented
    above, but do not spend the next investigation pass on sprite1.
  - `sprite2`: catapult interaction is accepted as perfect. The remaining
    `sprite2` issue is the piston family: pistons repel the marble physically
    but do not visually rise/animate. New visual anchor:
    `/Users/magnus-bot/Desktop/pistoncini.png`.
  - `sprite3`: accepted as working in manual TS gameplay; close for current
    user-facing sprite-goal scope.
  - `sprite4`: still open. New visual anchor:
    `/Users/magnus-bot/Desktop/verdi.png`. User reports that green/enemy
    sprites are not visible, while the marble appears to receive impulses at
    points where those enemies likely should be.
- Scope for the next pass:
  1. Investigate L4 piston render/animation state, starting from object-pair
     collision slot `0x400a20` and the type2/MO renderer.
  2. Investigate L3 green/enemy visibility, starting from the type4 objects
     and linked MO sprites observed in the latest `mame_state.json` probe.
- Goal remains open/paused and must not be marked complete while these two
  user-visible failures are still unresolved.

Status: **D3-pistons-state2-animation-wiring-plus-green-overlay-proof** — 2026-05-19.

- L4 piston screenshot anchor:
  `/Users/magnus-bot/Desktop/pistoncini.png`. Overlay shows a real object-pair
  collision against target `0x400a20`, `state/k=33/4`, with physical velocity
  response. This matches the user symptom: hitbox/physics exists while visual
  rise/animation appears missing.
- Code finding: default `refreshFrame10FCE -> objectUpdatePair158CC ->
  fun158F6` did not wire the full state-2 visual/animation callbacks for
  `FUN_25FC2` and `FUN_1281C`. The normal `FUN_253EC` dispatcher already had
  richer wiring (`objectStateEntry25BAE`, object init/target init, sprite
  projection, sound, `FUN_264AA`), but the object-pair path was effectively
  using the thinner defaults.
- Patch:
  `packages/engine/src/refresh-frame-10fce.ts` now defines the full local
  object-state/animation wiring inside `refreshFrame10FCE` and passes it to
  `fun158F6` for object-pair state-2 slots. This is intentionally narrow:
  no new seed/startLevel, no screen-space fake hitbox, no renderer-only
  sprite fabrication.
- Regression test:
  `packages/engine/test/refresh-frame-10fce.test.ts` now exercises the real
  default `158CC -> 158F6` path with slot `0x400a20` in state 2 and asserts
  that `FUN_25FC2` advances the animation timer/state through the wired
  transition.
- Route/probe evidence:
  `/tmp/marble-sprite-goal/current-run/l4_pistoncini_route_probe_after_pair_anim_wiring.json`.
  The replay reaches L4/Aerial descriptor `0x02d648`; final object-pair slot
  `0x400a20` is active (`active18=1`, `state1a=0x20`, `kind1b=0x04`), and
  entity `type2/sub1` emits linked MO sprites. Timeline samples show type2
  screen coordinates changing around the piston zone. This is TS evidence
  that the visual path is alive, but the exact live "rises correctly" behavior
  remains user-retest pending.
- L3 green screenshot anchor:
  `/Users/magnus-bot/Desktop/verdi.png`. The debug overlay covers the upper
  board region where the type4 objects are emitted.
- Probe evidence for greens:
  `/tmp/marble-sprite-goal/current-run/live_mame_state_probe_after_user_retest.json`
  shows two type4 objects with `visibleBinary=true`, active cel pointers
  `0x021b96` and `0x021abe`, MO counts `2` and `3`, and a frame linked-list
  sample with 5 sprites. Browser capture with debug off:
  `/tmp/marble-sprite-goal/current-run/browser_l3_verdi_mamedump_debugoff_20260519.png`
  visibly shows the green objects in the frozen `mameDump` state.
- Current interpretation for `sprite4`: no code patch yet. The best evidence
  says the green sprites are emitted and rendered; the reported invisibility is
  likely caused by the debug overlay/test URL hiding them. Needs user retest
  with `debugState=0` or frozen `mameDump=1`.
- Validation:
  `npx vitest run packages/engine/test/refresh-frame-10fce.test.ts --silent`
  PASS (`18` tests);
  `npx vitest run packages/engine/test/refresh-frame-10fce.test.ts packages/engine/test/sub-158f6.test.ts packages/engine/test/late-game-logic-26f3e.test.ts packages/engine/test/l4-gate-state10-route.test.ts --silent`
  PASS (`66` tests);
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false` PASS;
  `npx tsc -p packages/cli/tsconfig.json --noEmit --pretty false` PASS.
- Goal remains open: pistons need live visual confirmation, and greens need
  debug-off user confirmation before closing the user-facing sprite goal.

Status: **D3-pistons-code-only-retest / spawn-vs-render-separated** — 2026-05-19.

- User asked not to run video/browser verification and reported that the L4
  piston family still is not visible at the initial test point, while moving
  farther into the level eventually makes the first pistons appear.
- Re-ran only text/code probes on the existing L4 piston route. Evidence:
  `/tmp/marble-sprite-goal/current-run/l4_pistoncini_route_probe_after_1281c_else_wiring.json`.
- Spawn timing is now separated from render failure:
  before the scroll descriptor crossing, object-pair slot `0x400a20` contains
  stale-looking data but `active18=0`, so the type2 renderer correctly skips
  it. At routeFrame `1110`, `FUN_15A12`/scroll activation has armed the slot
  (`active18=1`, `state1a=0x20`, `kind1b=0x04`), and the type2 entity exists;
  its projected `d4` is initially above the visible band (`-43`, `-36`,
  `-27`, `-17`) and becomes visible by routeFrame `1150` (`d4=-6`). This
  matches the user's "after moving forward they start appearing" symptom and
  is not, by itself, proof of a renderer drop.
- Collision/render owner is the same object-pair slot. Around routeFrame
  `1780..1790`, type2 is in the visible band (`d5/d4` about `70/139` before
  collision), and `lastObjectPairCollision` records the hit at frame `1783`
  against `selfAddr=0x400a20`, `targetAddr=0x400018`. The slot then enters
  state `0x23` with timer fields changing (`f6c`, `f6e`) and later returns to
  `0x20`; the static type2 body remains driven by the original `active18 != 2`
  branch.
- Checked the tempting `obj+0x38` inner-sprite hypothesis. The root caller now
  wires `helper121B8Subs.fun_1281c` to the real
  `objectEnter1281C -> FUN_264AA` callback for the object-pair ELSE branch in
  `packages/engine/src/refresh-frame-10fce.ts`. A local Musashi/TS comparison
  on the same route state showed both sides leaving the `obj+0x38` inner
  records empty for this piston state, so the missing visual is not explained
  by an unpopulated type2 inner loop.
- With real ROM motion-object lookup tables in a code-only render build at the
  routeFrame `1780` state, the linked MO frame contains nonblank piston-family
  commands: vertical type11/type13 direct-overlay commands such as
  `spriteIndex=3328` and type2 commands such as `spriteIndex=2049/2051`, all
  with nonzero decoded opaque pixels. This says the engine can emit drawable
  commands for this area; no assistant video/browser validation was run per
  user request.
- Current interpretation: the remaining live symptom is most likely one of
  these, in order: exact user test point is before scroll activation/visible
  projection; debug overlay or camera position is hiding the emitted commands;
  or a still-unmatched screenshot state uses a different piston slot/window.
  Do not force `active18=2`, relax collision guards, or fabricate renderer
  sprites without a new exact state proving that MAME draws a different body at
  the same coordinates.
- Validation after the narrow callback wiring:
  `npx vitest run packages/engine/test/refresh-frame-10fce.test.ts --silent`
  PASS (`18` tests);
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false` PASS.

Status: **D3-pistons-slot-loop-wiring / stale state4 slots addressed** — 2026-05-19.

- Latest user clarification changed the diagnosis target: the L4 pistons are
  not simply missing. They behave as groups: first group is static/passable,
  first group starts only after the player reaches the next static group, and
  later groups never animate in the user's live path.
- Code finding: `FUN_1365C` already has the ROM Aerial mode-3 slot-loop that
  should free active `state1a=4` script slots through `FUN_12F44(slot, 1, 0)`
  and re-run active `state1a=2` gate slots through `FUN_12896`. In TS, those
  callees were still default no-ops in `object-render-update-1365c.ts`, so the
  gameplay path could leave stale static piston slots around.
- Patch:
  `packages/engine/src/object-render-update-1365c.ts` now gives `FUN_1365C`
  real defaults for `helper12F44`, `helper12896`, `postStateChange13966`,
  `helper285B0`, and `soundCmdSend158AC`. The isolated parity harness
  `packages/cli/src/test-object-render-update-1365c-parity.ts` passes explicit
  no-op callbacks because it patches those ROM callees to `rts`.
- Evidence:
  `/tmp/marble-sprite-goal/current-run/l4_pistoncini_route_probe_after_1365c_sub_wiring_v2.json`
  shows slots `2/3/4` leaving static `base46=0x020c14` and entering animated
  records as player tile-state reaches `30/32`; when player tile-state reaches
  `4` at routeFrame `1700`, the fixed `FUN_1365C` path frees stale state-4
  piston slots.
- Direct code probe confirms the later `5/6/7` slots are triggerable when the
  player tile-state is `33`, `34`, or `35`; each matching slot moves from
  `state1a=4/base46=0x020c14` to the expected animated record. The existing
  route does not cross those exact states, so this remains a retest item, not
  a completed user-facing proof.
- Validation:
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false` PASS;
  `npx tsc -p packages/cli/tsconfig.json --noEmit --pretty false` PASS;
  `npx vitest run packages/engine/test/post-state-change-13966.test.ts packages/engine/test/refresh-frame-10fce.test.ts packages/engine/test/sub-29cce.test.ts --silent`
  PASS (`55` tests);
  `npx vitest run packages/engine/test/helper-12f44.test.ts packages/engine/test/helper-121b8.test.ts --silent`
  PASS (`48` tests);
  `npx tsx packages/cli/src/test-object-render-update-1365c-parity.ts 40`
  PASS (`40/40`).
- Keep goal open. Next useful proof, if user still sees the bug, is the exact
  player `obj+0x1b` transition sequence near the second/third piston groups;
  do not force slots `5/6/7` without MAME/TS state proof.

Status: **D3-pistons-compact-debug / post-collision telemetry** — 2026-05-20.

- User provided mobile screenshot `Foto 1.jpg` after the earlier piston wiring.
  It shows the physical repulsion still firing while the visible piston rise is
  not apparent. Debug overlay line: frame `3565`, timer `24`, L4/Aerial runtime
  `level=3`, player `k=5`, `f36=02`, and `last obj-pair collision f=2845
  loop=3`.
- Code-only replay to the same frame/timer band shows object-pair slot
  `0x400a20` still active and linked motion-object sprites still emitted in the
  upper viewport. The 25 terrain/script piston slots `2..7` are inactive in the
  sampled route. This keeps the live issue focused on exact object-pair
  post-collision state and/or overlay occlusion, not on fabricating new terrain
  sprites.
- Important observation: the normal debug overlay covers `44vh`, and the sampled
  piston-family motion objects sit in that upper viewport band. A debug overlay
  false negative is plausible, especially on mobile.
- Patch is diagnostic only:
  `helper-1bc88.ts`/`state.ts` now capture post-collision active/state/k/f36
  plus z-depth path (`target-active2`, `target-player-sound`, or skip reason);
  `web/src/main.ts` supports `debugCompact=1` with a 28vh compact overlay and
  early pair/piston summary lines.
- No seed/startLevel, physics, collision, terrain, or renderer behavior changed.
- Validation:
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false` PASS;
  `npx tsc -b packages/engine --pretty false` PASS;
  `npx tsc -p packages/web/tsconfig.json --noEmit --pretty false` PASS;
  `npx vitest run packages/engine/test/refresh-frame-10fce.test.ts packages/engine/test/helper-121b8.test.ts --silent`
  PASS (`48` tests).
- Give the user this retest URL:
  `http://192.168.85.200:5173/?autoLoad=1&play=1&startLevel=4&debugState=1&debugCompact=1&sound=0&loopReset=0`.
  If the visual still seems absent, compare immediately with `debugState=0` at
  the same spot before making any gameplay patch.

Status: **D3-pistons-focused-handoff** — 2026-05-20.

- User clarified that the compact/debug overlay is not the root cause. The
  pistons are genuinely stationary when the physics is already armed; they only
  start moving after the marble advances much farther into the level.
- Created focused handoff:
  `docs/codex-task-l4-pistons-current-context.md`.
- Mandatory next focus: find the exact moment the piston physics is armed, then
  explain why the matching visual slot does not animate until a later
  player/scroll state. Keep updating that focused handoff after every new
  finding so future compacted runs do not repeat already-ruled-out work.

Status: **D3-pistons-type29-cull-fixed / user-retest-needed** — 2026-05-20.

- Focused route evidence showed the L4 piston animation table was already
  inserting `type0x29` draw-list entries in the first-block zone, but the TS
  renderer dropped all sampled entries because `dispatchType0x29` still used
  the old positive lower bound `d4 < 0xc0`. Sampled rows included `d4=159/143`,
  `94/90`, and `53/49`: all are on-screen by the original signed-band logic.
- Independent ROM byte check at `ghidra_project/marble_program.bin`
  `0x27e7c..0x27ed2` confirms the original dispatcher uses `moveq #-0x40,D0`;
  the correct lower cull is `d4 <= -0x40`, with upper cull `d4 >= 0x100`.
- Patch is already in local commit `0ff49fa`:
  `packages/engine/src/late-game-logic-26f3e.ts` now applies the signed
  `type0x29` band, and
  `packages/engine/test/late-game-logic-26f3e.test.ts` has regressions for
  the upper visible band (`d4=0x90`) and the binary lower edge (`d4=-0x40`).
- This is not a collision hack, seed rename, or forced object state. It fixes
  the renderer dropping the already-armed piston animation entries.
- Validation:
  `npx vitest run packages/engine/test/late-game-logic-26f3e.test.ts --silent`
  PASS (`40` tests);
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false` PASS;
  `npx tsc -b packages/engine --pretty false` PASS;
  `npx tsc -p packages/web/tsconfig.json --noEmit --pretty false` PASS;
  `git diff --check` on touched files PASS.
- User-facing status: needs live retest on L4/Aerial. Suggested URL:
  `http://192.168.85.200:5173/?autoLoad=1&play=1&startLevel=4&debugState=1&debugCompact=1&sound=0&loopReset=0`.
  If this passes, `sprite2` pistons can be marked green.
