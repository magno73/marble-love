# GOAL - Active Objective

This file is only for the current active task. Do not use it as historical
startup context. Long or closed goal notes belong in `docs/archive/goals/` or in
the task PRD checkpoint log.

## Active Goal

Piano audio bit-perfect.

Boot-flow interruption checkpoint (2026-05-22): while preserving this active
audio goal, boot-flow no-seed manual retest found that START could be accepted
from the runtime gate but the next vblank tick ran stale zero object timers
before pending `main=5` new-game init. The focused fix skips gameplay timer
ticks while `main=5` is pending so the main-thread dispatcher can run case 5
and arm the L1 intro timer instead of showing `TIME OVER`.

Boot-flow interruption checkpoint (2026-05-23): manual L2 retest found the
Beginner tube terrain hole near the purple funnel again. Root cause was the
runtime intro cleanup clearing all `spriteRam`; `FUN_1CABA` reads MO RAM as
video RAM for that L2 terrain row, so clearing it turns the projected endpoint
at tile `(78,67)` back to zero. The fix preserves MO RAM and suppresses motion
object rendering during the intro banner instead.

Objective:

Make Marble Love audio match MAME as closely as possible, starting from the
deterministic `soundReplay` oracle path. Close ordered YM2151/POKEY chip-write
parity first, then close PCM parity on audible windows. Keep oracle capture,
seed/gameplay wiring, web replay, and browser smoke checks separate.

Authoritative task plan:

- User-provided "Piano Audio Bit-Perfect" plan from the current thread.
- Current implementation notes: `docs/sound-system.md`.
- Historical background only when needed: `docs/audio-chip-perfect-prd.md`.

## Current Phase

- SoundChip replay is active: 6502 sound CPU, mailbox, YM2151, POKEY, cmd-tape
  replay, sample drains, and ordered chip-write diagnostics exist.
- `?soundReplay=...` is the deterministic workbench for bit-perfect work.
- `?sound=1` gameplay audio must continue to use real engine sound commands;
  do not add synthetic beeps/cues to the bit-perfect path.
- `packages/web/src/main.ts` is dirty from unrelated work. Avoid it unless a
  strictly isolated audio block change is unavoidable.
- Preserve unrelated dirty boot-flow/terrain work. Do not revert or refactor it.

## Latest Evidence

Artifacts are in `/tmp/marble-love/audio-bitperfect/`.

Continuation checkpoint (2026-05-23 late, vector-read window tracing):
`oracle/mame_sound_window_trace.lua` and
`packages/cli/src/probe-sound-window-trace.ts` now have opt-in 6502 vector-read
tracing (`MARBLE_SOUND_TRACE_VECTORS=1` / `--trace-vectors`) for `$fffa-$ffff`.
`packages/cli/src/probe-sound-window-trace-diff.ts` reports both a
`vectorReads` summary and a `commandNmi` window summary, so focused windows can
compare command -> NMI vector -> first `$1810` read -> first chip write directly
instead of inferring interrupt service from `pcFetch`. Smoke artifacts under
`window-vector-smoke/` prove both sides emit the new events: TS
`ts-window-244-248-vectors.json` includes `reset`, `nmi`, and `irq` vector
reads; MAME `mame-window-244-248-vectors.json` was captured with the same Lua
tap and also includes all three vector classes. The MAME-vs-TS smoke diff is
not a parity gate because it intentionally used a short forced-command schedule
rather than the full same-run oracle; it validates the diagnostic plumbing.
The real same-run window has now been recaptured with full oracle flags and
bus-cycle-aware vector/MMIO read timestamps in
`current-mixed-samerun-1701/window-vector-traces/`. Report
`window-diff-260-273-pc-vectors-eventoffset30-busreadcycles-commandnmi.json`
pairs all `14` frame-start commands. `nmiFromCommandDelta` is now bounded to
`-3..+3` cycles, and `cmdReadFromNmiDelta` is exactly `0` for all `14`
commands. The previous stable `$1810` read skew was a TS trace timestamp
artifact: `LDX $1810` was logged at opcode start rather than the absolute-read
bus cycle. The first paired command is representative: MAME vectors NMI at
frame `260`, cycle `8`, PC `0x8138`, reads `$1810` at cycle `76`, then writes
YM `$81bb/$14=$11` at cycle `1225`; TS vectors at the same cycle `8`, PC
`0x8101`, reads `$1810` at cycle `76`, and writes the same YM payload at cycle
`1226`. This keeps the promotion target on pre-NMI PC/catch-up and the first
post-NMI chip-write boundary, not latch payload, YM operator math, or a global
sample phase. The remaining `firstChipWriteFromNmiDelta` range is `-145..+11`
cycles; the large negative cases are frame-boundary crossings where TS emits
the same YM write just after the next frame's command in absolute time. The
same report now makes that explicit as `firstChipWriteCrossFrame: MAME=0,
TS=3, mismatch=3`.

Continuation checkpoint (2026-05-23 late, boundary preemption diagnostic):
`tickFrameWithTape` now preserves diagnostics for chip-write preemptions found
while advancing to a frame boundary, and both focused trace/diff tools serialize
the `preemptedChipWrite` context on the following `cmdSubmit`. The focused
`260..273` window was rerun with
`--command-preempt-chip-write-lookahead 15 --command-preempt-chip-write-pcs 0x81b8`
as a diagnostic only. Report
`window-diff-260-273-pc-vectors-eventoffset30-busreadcycles-preempt15-pc81b8-commandnmi.json`
removes the three cross-frame first-chip-write cases
(`firstChipWriteCrossFrame: MAME=0, TS=0, mismatch=0`) and tightens
`firstChipWriteFromNmiDelta` from `-145..+11` to `-12..+24`. The serialized
command contexts identify exactly three boundary cases, all at `PC 0x81b8`
(`STA $1800`, YM address select), with command target deltas `+3`, `+10`, and
`+15` cycles after the estimated `$1800` bus write. This is strong evidence
that MAME has completed the YM address select before the frame-start command,
then services command/NMI before the following `$81bb` YM data write.
The diagnostic must not be promoted: the current 1701-frame preset remains
green without preemption in
`preempt-boundary/chip-write-diff-current-preset-baseline-after-boundary-diagnostics.json`
(`0` YM and `0` POKEY mismatches), while `--command-preempt-chip-write-lookahead
15` creates `71` YM / `15` POKEY mismatches, and the narrower
`--command-preempt-chip-write-pcs 0x81b8` still creates `72` YM / `11` POKEY
mismatches. The next implementation target is therefore not a PC special case;
it is sub-instruction/bus-cycle execution that can retire the `$1800` store,
sample the command edge, service NMI, and resume at the `$1801` data store.
The stricter variant that completes the imminent chip-write instruction before
the target command (`--command-preempt-chip-write-complete-before-target` plus
delay `0` for completed preemptions) confirms the diagnosis but is also
rejected. In the focused `260..273` window it removes the same cross-frame
cases and tightens `firstChipWriteFromNmiDelta` to `-9..+24`, with serialized
preemptions marked `completedInstructionBeforeTarget=true`. On the full
1701-frame oracle it derails ordered writes badly (`17837` YM and `9363` POKEY
mismatches), because whole-instruction completion changes later sequencer
phase. A fresh no-preemption baseline after adding these diagnostics remains
green in
`preempt-boundary/chip-write-diff-current-preset-baseline-after-complete-preempt-diagnostics.json`
(`51163/51163` YM and `27198/27198` POKEY writes, `0` mismatches). The next
promotion target remains a real bus-cycle/resumable 6502 boundary model, not a
whole-step preemption rule.

Continuation checkpoint (2026-05-23 late, filtered complete-before-target
control): `probe-sound-sample-diff.ts` now honors
`--command-preempt-chip-write-pcs` and
`--command-preempt-chip-write-complete-before-target`; earlier PCM runs with
those flags were unintentionally only applying the lookahead. The corrected
filtered run
`current-preempt-complete-before-target/chip-write-diff-preempt-pc81b8-complete-before-target.json`
is nearly green at the event layer: four completed preemptions, all at
`PC 0x81b8`, POKEY `0` mismatches, and only one YM native-sample mismatch
(`#34411`, frame `1221`, `PC 0x8e9c`, reg `$23=$d7`, native delta `+5`). The
matching PCM oracle
`current-preempt-complete-before-target/pcm-diff-preempt-pc81b8-complete-before-target-pcfiltered.json`
still fails hard (`worstCorrelation=0.6634505`, `worstRms=0.0835583`,
`worstMaxAbs=0.2860247`, worst lag `4`). The worst correlation window is
POKEY-heavy around sample `929693`, where TS POKEY is `0.1015717` while MAME is
near silence (`-0.0025024`). This rejects promotion even for the filtered
variant and proves that native write-order parity alone is not sufficient when
the workaround moves real chip state timing. The next implementation target is
still resumable sub-instruction execution/catch-up, not another boundary
preemption toggle.
`probe-sound-sample-diff.ts` now also exposes
`--command-nmi-delay-completed-chip-write-preemptions`, matching
`probe-chip-write-diff.ts`, so PCM gates can test the same completed-preemption
delay selector as event gates. The filtered `0x81b8` complete-before-target PCM
rerun with that selector forced to `0` is worse, not better:
`current-preempt-complete-before-target/pcm-diff-preempt-pc81b8-complete-before-target-delay0.json`
fails with `worstCorrelation=-0.637592`, worst lag `12`, RMS `0.229396`, and
maxAbs `0.788019`. This reinforces that the missing piece is scheduler/cpu
resume semantics, not a different NMI-delay override around the workaround.

Continuation checkpoint (2026-05-23 late, current-preset rerun and exact
residual): the current worktree rerun under
`current-rerun-20260523-223959/` keeps the serialized
`inject001f-1701-commandedge` preset green on the authoritative same-run mixed
oracle. `chip-write-diff-current-preset-rerun.json` compares all `51163` YM
and `27198` POKEY writes with `0` mismatches at native-sample tolerance `±1`
(YM histogram `{-1:2369,0:46045,1:2749}`, POKEY
`{-1:6126,0:20752,1:320}`). `pcm-diff-current-preset-rerun.json` passes all
`212` audible windows with `worstCorrelation=0.9974095`, `worstAbsLag=1`,
`worstRms=0.0055349`, and `worstMaxAbs=0.0633174`. The strict exact diagnostic
`chip-write-diff-current-preset-sampletol0-rerun.json` shows what remains
between the current replay preset and true sample-exact parity: YM has `5118`
native-sample bucket mismatches and POKEY has `6446`, but both chips stay
bounded to `±1` native sample with no reg/val/order drift. The dominant exact
residuals are broad far-command buckets around YM `0x8e9c/0x8eaf/0x81bb/0x81c3`
and POKEY `0x8e28..0x8e68`, not a new PCM failure. The CLI preset test now
pins the current command-NMI selectors, current-event YM rules, POKEY
`0x91=23` timing basis, and the absence of rejected chip-write preemption.
`probe-chip-write-diff.ts` now also reports `nativeSampleNonExactContext`,
which is independent of `--sample-tolerance`; it exposes exactness debt even
when the tolerance-1 gate is green. Artifact
`current-exact-context-20260523-224533/chip-write-diff-current-preset-nonexact-context.json`
keeps the green write gate (`mismatchCount=0` for both chips) while surfacing
the same non-exact populations: YM `5118` (`far=5091`, top write PCs
`0x8eaf=1723`, `0x8e9c=1660`, `0x81bb=625`, `0x81c3=553`) and POKEY `6446`
(`far=6435`, top write PCs `0x8e54=788`, `0x8e2f=762`, `0x8e68=744`,
`0x8e3c=739`). This makes the next reduction measurable in the normal green
preset run instead of only in a forced failing `sampleTolerance=0` control.
`probe-chip-write-diff.ts --pc-delta-report` now also reports
`nativeSampleMismatchTargetCycleOffset`: the minimal TS cycle shift needed to
put each exact-bucket mismatch into MAME's native-sample bucket. Artifact
`current-exact-bucket-analysis/chip-write-diff-current-preset-sampletol0-pcdelta-targetoffset.json`
keeps the expected strict failures (`5118` YM, `6446` POKEY) and shows the
remaining debt is not a single global phase. YM is sign-mixed in the dominant
PCs: `0x8eaf` has `1723` mismatches with target offsets `-32..+32`
(`meanAbs=4.57`, top offsets `+1=263`, `-1=214`), `0x8e9c` has `1660`
(`-32..+24`, `meanAbs=4.48`, top `+1=229`, `-1=196`), and the early music
init writes at `0x81bb/0x81c3` have similar mixed small offsets. POKEY is more
directional: the hot `0x8e28..0x8e6f` loop is mostly native delta `-1`, with
positive target offsets usually `+1..+8` cycles (for example `0x8e54` has
`788` mismatches, `meanAbs=5.21`, top offsets `+2=110`, `+3=96`, `+5=92`).
This narrows the next implementation target: YM still needs the causal
scheduler/bus-phase model, while POKEY's residual should be tested against a
stream/update-boundary rule that delays the TS-visible write edge by a few
native CPU cycles in that loop, not by a global sample phase.
Continuation checkpoint (2026-05-23 late, POKEY exact event sweep):
`probe-chip-write-diff.ts` now has a generic diagnostics-only
`--ts-event-cycle-adjust-matches` selector
(`kind:frame:pc:reg:val:delta[:cycleMin:cycleMax]`) so event-layer timing
experiments can isolate one-off outliers without changing SoundChip, PCM, web,
or gameplay. The POKEY `0x91` timestamp sweep under
`current-pokey-exact-091-sweep/` shows a causal-looking direction but rejects a
blind global promotion. Moving the opcode adjust from current `23` to `25`
cuts strict POKEY exact native-sample mismatches from `6446` to `5058`, but
creates three tolerance-1 failures. Moving to `30` cuts exact mismatches to
`2836` but creates `19` tolerance-1 failures and large catch-up outliers. With
`0x91=25` plus three narrow frame/cycle outlier matches, the combined YM+POKEY
tolerance-1 gate passes again in
`current-pokey-exact-091-sweep/chip-write-diff-op91-25-threeoutlier-targeted-sampletol1.json`
(`51163/51163` YM, `27198/27198` POKEY, `0` mismatches) and POKEY non-exact
debt drops to `5055` (`{-1:4574,0:22143,1:481}`). The strict companion
`pokey-sampletol0-op91-25-threeoutlier-targeted.json` confirms those `5055`
remaining POKEY mismatches are all bounded to `±1` native sample. Do not
promote the three frame-specific matches as a final fix; they prove the broad
POKEY residual wants a small later visible write edge, while the isolated
frame `860/1306/1616` outliers still point at scheduler/catch-up behavior.
`pcDeltaReport.mismatchSamples` now records per-sample `previousIndex`,
`intervalDelta`, `tsInterval`, and `mameInterval`, so exact-bucket failures can
be tied to the previous same-PC write without cross-reading the separate
`intervalOutliers` list. The rerun
`current-pokey-exact-091-sweep/pokey-sampletol1-op91-25-pcdelta-intervalsamples.json`
shows the three `0x91=25` tolerance-1 failures are scheduler-shaped: frame
`1616` at `PC 0x8e62` has an interval delta `-138` followed by `+142` on the
next same-PC write, and frame `1306` at `PC 0x8e5b` has `-266` followed by
`+266`. The remaining frame `860` `0x8e62` case is a smaller local `+46`
interval expansion. The updated green diagnostic artifact
`current-pokey-exact-091-sweep/chip-write-diff-op91-25-threeoutlier-targeted-sampletol1-intervalsamples.json`
keeps YM `0` and POKEY `0` mismatches at tolerance `±1` with the same POKEY
non-exact `5055`. This makes the next real promotion target explicit:
eliminate those catch-up interval pairs in the 6502 scheduler/replay boundary
model, then retest whether the broad POKEY visible-edge shift can be made
causal without frame-specific selectors.

Continuation checkpoint (2026-05-23 late, POKEY edge sweep): the remaining
zero-lag peak around output sample `569319` is still a POKEY
edge-shape/tap-boundary problem, not an ordered write problem. Focused
`source=pokey` replay against `WAV - TS YM` at window `565248` reproduces the
current preset residual: TS POKEY `0.0029576663` versus MAME-implied POKEY
`0.0443531498`
(`current-validation/pcm-diff-current-preset-pokey-isolated-window565248-sample569319-baseline.json`).
The local output/resample sweep under `current-pokey-edge-sweep/` rejects a
simple global POKEY phase change. `pokeyOutput=-1` anticipates too much
(`maxAbs≈0.080` locally), `pokeyOutput=0` with low resample offsets improves
the focused edge (`resample=18`, `maxAbs≈0.026`) but fails the all-window
zero-lag gate badly (`RMS≈0.011`, `maxAbs≈0.127`), and the existing
`pokeyOutput=1` / `pokeyResampleOffset=23.25` remains the best global
zero-lag tradeoff (`maxAbs≈0.0414`). Direct MAME-write POKEY rendered against
`WAV - direct YM` is a useful tap diagnostic: negative write-cycle offsets
improve the broad POKEY residual (`0` -> `maxAbs≈0.0645`, `-16` ->
`maxAbs≈0.0330` over 168 POKEY-selected windows), and `-16` lands the sample
`569319` intermediate value almost exactly. That does not map to a promoted
SoundChip rule: the runtime POKEY command-edge raw-cycle offset sweep
`0x91=7..23` leaves the focused edge unchanged, so this sample is not fixed by
the current command-edge rule basis. Keep `-16` as direct-tap evidence and
continue with a causal POKEY stream/update-boundary model rather than a global
runtime output shift or negative replay write offset.
The direct tap result is now reproducible as CLI preset
`inject001f-1701-direct-mamechip-pokeytap`, intentionally separate from the
runtime `inject001f-1701-commandedge` preset. With the same MAME WAV/YM/POKEY
logs it renders direct MAME-chip audio using `--pokey-write-cycle-offset -16`
and `--pokey-resample-offset 22.50`, and passes all `212` audible windows in
`current-direct-mix-pokeytap/directmix-allwindows-preset-pokeytap-res2250.json`
(`worstCorrelation=0.9991770669439128`, `worstAbsLag=0`,
`worstRms=0.004345715850694769`, `worstMaxAbs=0.030639760196208954`). This is
an oracle/tap diagnostic preset only; it must not be used to justify a
SoundChip replay or web default.
`probe-sound-sample-diff.ts` can now compare runtime replay against a
reference-only direct POKEY tap using `--reference-pokey-write-cycle-offset`
and `--reference-pokey-resample-offset`; trace reports also record the manual
trace center when it differs from the max-abs sample. Focused runtime-vs-direct
artifact
`current-runtime-vs-direct-pokeytap/runtime-current-vs-directref-pokeytap-window565248.json`
keeps the current preset green for that window and proves the refined direct
tap reaches the expected sample `569319` edge (`refPokey=0.0445159599` while
runtime POKEY is still `0.0029576663`). The same report's true max-abs sample
is earlier, `567780`, where runtime POKEY is `0.0485283285` and the direct
reference is nearly silent. The all-window companion
`current-runtime-vs-direct-pokeytap/runtime-current-vs-directref-pokeytap-allwindows.json`
therefore remains a failing diagnostic (`worstCorrelation=0.9971256909429976`,
`worstAbsLag=1`, `worstRms=0.004316868455558939`,
`worstMaxAbs=0.06680679111741483 > 0.065`). This keeps the next runtime target
on a causal POKEY stream/update-boundary model, not on promoting the direct
tap's negative write-cycle offset.
Strict POKEY event timing is not closed even though the current preset keeps
ordered writes green under its tolerance-1 native-sample gate. Artifact
`current-exact-pokey-timing/pokey-exact-cycle-diff-current-preset.json`
compares all `27198` POKEY writes with `0` payload/order drift but has
`26848` exact cycle mismatches, same-frame cycle deltas up to `33`, and `6446`
native-sample bucket mismatches. The local frame-710 report
`current-exact-pokey-timing/pokey-exact-frame710-event-delta.json` has `18/18`
exact replay-cycle mismatches near the sample-`569319` residual, with TS
`6..12` cycles early and `5` native-sample mismatches. A phase sweep and
positive `--pokey-write-apply-delay` controls were rejected, so the next
promotion target remains sub-instruction scheduler/update-boundary timing.
`POKEY` now has an opt-in raw-latch transition trace, exposed through
`probe-sound-sample-diff.ts` as `--pokey-raw-trace-radius` with an optional
center sample. Focused artifact
`current-pokey-raw-trace/runtime-vs-directref-pokeyraw-window565248.json`
keeps the same runtime-vs-direct window green (`corr=0.998769`, RMS
`0.003797`, maxAbs `0.048362`) and records the causal raw edge around sample
`569319`: runtime has `0x0000 -> 0x0f00 -> 0x0000` at estimated output samples
`569255/569317/569379`, while the direct reference has the same raw pattern at
`569255/569316/569378`; the probe's raw-trace comparison reports
`outputDelta={0:1,1:2}` for the three paired transitions. The PCM trace still
shows the ref POKEY component
rising much faster at samples `569317..569320` (`refPokey=0.044516` vs
runtime `0.002958` at `569319`). This narrows the active POKEY issue to
stream/update-boundary and resampler edge shape for the same raw channel-2
transition, rather than a wrong raw waveform value or a missing POKEY write.

Continuation checkpoint (2026-05-23 late, zero-lag PCM gate and POKEY
post-clock diagnostic): POKEY now has an opt-in diagnostics-only
`sampleAfterClock` mode exposed through `pokeySetSampleAfterClock`,
`setPokeySampleAfterClock`, and `probe-sound-sample-diff.ts`
`--pokey-sample-after-clock`. It is not promoted as a default: the full
current-preset WAV gate with post-clock sampling still passes but does not
improve the global metrics (`worstCorrelation=0.9974095`,
`worstRms=0.0056057`, `worstMaxAbs=0.0633174`), and the focused
runtime-vs-direct POKEY edge only moves `maxAbs` from `0.0483616` to
`0.0476441` while the raw transition comparison remains offset
(`outputDelta={0:1,1:4}`). The more important finding is scoring-related:
the old lag-search gate's global `maxAbs=0.0633174` comes from selecting
`lag=1` in a mixed window and then comparing a fast YM channel-1 transient
against the previous sample; POKEY is silent at that reported peak. A
zero-lag run of the same current preset passes all `212` audible windows with
`worstCorrelation=0.9965714`, `worstAbsLag=0`, `worstRms=0.0055349`, and
`worstMaxAbs=0.0413955`. The serialized
`inject001f-1701-commandedge` preset now uses `--max-lag 0`,
`--max-abs-lag 0`, and `--max-abs 0.045`, so the deterministic oracle gate is
stricter and no longer hides timing artifacts behind a global lag search.
Artifacts:
`current-pokey-batch-check-20260523-2250/pcm-diff-current-preset-pokey-afterclock.json`,
`current-pokey-batch-check-20260523-2250/runtime-vs-directref-pokeyedge-afterclock-567780.json`,
`current-pokey-batch-check-20260523-2250/runtime-vs-directref-worstmax-sampletrace-566592.json`,
and
`current-pokey-batch-check-20260523-2250/pcm-diff-current-preset-zero-lag-gate.json`.

Continuation checkpoint (2026-05-23 late, command-read tap): the MAME
`generic_latch_8` write path is synchronized, so the main `$FE0001` tap is not
by itself the latch-visible moment. `oracle/mame_pokey_write_tap.lua` now also
taps the 6502 `$1810` sound-command read and emits `soundCmdReads[]` with
`sourceIndex`, timestamp/cycle, PC, and optional fetch context. Focused oracle
`current-mixed-samerun-1701/command-fetch-context/mame_cmds_inject001f_1410_cmdread.json`
captured `1277/1277` reads with source indices and command deltas; the paired
report
`chip-write-diff-current-preset-command-cmdread-1410-ymonly.json` stays green
for YM (`43051/43051`, `0` mismatches) and records the MAME read histograms in
`commandSubmitDiagnostics`. The public
`cmd-tape-inject001f-1701-commandedge.json` regression remains green without
read metadata:
`chip-write-diff-current-preset-public-scenario-regression-cmdread.json`
reports YM `51163/51163` and POKEY `27198/27198`, both with `0` mismatches.
Result: the read point is not the missing selector for the current delay-0
overrides. The `10` delay-0 commands and the `1267` delay-1 commands both read
almost entirely at `PC 0x95c6` / opcode `0xae` with overlapping
command-to-read deltas (`delay0` `71..77` cycles; delay1 mostly `70..80`,
excluding the first reset read). This rejects previous/next fetch and actual
latch read PC/delta as unique explanations; the remaining timing work should
model the MAME scheduler synchronize/perfect-quantum catch-up instead of
adding broader wildcard selectors.

Continuation checkpoint (2026-05-23 late, read-delta scheduler controls):
`probe-chip-write-diff.ts` now emits a top-level `commandReadComparison`
summary that compares TS's first `$1810` read after each command against the
MAME `soundCmdReads[]` entry for the same `sourceIndex`. On the green current
1410-frame report
`chip-write-diff-current-preset-command-cmdread-1410-ymonly-readcmp.json`, TS
and MAME both have `1277/1277` reads; the read-delta distribution straddles
zero (`mameMinusTs` top values include `-2:229`, `-1:212`, `0:203`, `1:123`,
`2:89`). Base-delay controls were rejected as replacements for the current
selectors: base delay `0` with no matches preserves payload/order but leaves
`35` YM native-sample mismatches
(`chip-write-diff-base0-immediate-1410-ymonly-readcmp.json`), base delay `1`
with no matches leaves `76`
(`chip-write-diff-base1-nomatches-1410-ymonly-readcmp.json`), dynamic
`sampleCycle=2` explodes to `9784`, and 64-cycle chip-write preemption explodes
to `10045`. `sampleCycle=5/6` are equivalent to immediate for this oracle and
still leave the same `35` mismatches. Conclusion: the current evidence says
TS needs sub-instruction NMI/latch timing between the whole-instruction delay
extremes, not a wider chip-write preemption rule.
The public 1701-frame current-preset regression with the new report field
remains green:
`chip-write-diff-current-preset-public-scenario-regression-readcmp.json`
reports YM `51163/51163` and POKEY `27198/27198`, both with `0` mismatches.

Continuation checkpoint (2026-05-23 late, NMI service-delay control and source
scan): online source review confirms the System 1 hardware model in MAME is the
right timing oracle for this layer: `m_soundlatch->data_pending_callback()` is
wired directly to the 6502 NMI line and also requests
`perfect_quantum(100us)`, while YM2151/POKEY clocks and mix gains are declared
in the same `atarisy1.cpp` machine config. A new diagnostics-only
`commandNmiServiceDelayCycles` control can now stall CPU opcode service by N
sound cycles after command NMI becomes visible while YM/POKEY keep ticking;
`probe-chip-write-diff.ts` exposes it as `--command-nmi-service-delay` and
reports the setting. Focused base-delay-0 sweeps against the 1410-frame
command-read oracle reject this as the missing causal model: service delays
`1/2/3/4` leave `56/51/70/9832` YM native-sample mismatches versus the prior
base0 `35`, and delay `4` loses ordered count (`43049` TS vs `43051` MAME).
The default current-preset public regression remains green with the new code:
`chip-write-diff-current-preset-public-scenario-regression-servicedelay.json`
reports YM `51163/51163` and POKEY `27198/27198`, both with `0` mismatches.
Conclusion: keep the service-delay knob only as an explicit diagnostic; the
promotion target remains MAME scheduler catch-up/sub-instruction command-NMI
placement, not a global N-cycle service latency.

Continuation checkpoint (2026-05-23 late, per-command scheduler table):
`probe-chip-write-diff.ts` now supports `--command-submit-out`, which writes a
compact row per command submit with `sourceIndex`, command byte/cycle,
effective NMI delay, pending state, TS last-step context, MAME command
instruction context, and MAME `$1810` read context. Focused artifact
`current-mixed-samerun-1701/command-fetch-context/command-submit-rows-current-preset-1410.json`
contains `1277` rows for the command-read oracle, and
`command-submit-classifier-analysis-current-preset-1410.json` records candidate
classifier confusion counts. Result: the current byte/cycle selectors are
perfect by construction (`tp=10 fp=0 fn=0`), but the seemingly causal
instruction/read features are not selective enough. Examples:
`nextChronoInstDeltaCycles 0..4` catches all `10` delay-0 commands but also
`641` false positives; `abs(nextChronoInstDelta - ts endDelta) <= 3` catches
all `10` with `638` false positives; `abs(instDelta - targetOffset) <= 20`
catches only `5/10` and still has `30` false positives. This proves the newly
captured command-side fetch/read context is useful for auditing but still not a
promotion rule. The next evidence target is MAME scheduler/latch timing around
`generic_latch_8`/`perfect_quantum`, or a sub-instruction 6502 stepper, not
another rule based only on command PC/opcode/read delta.

Continuation checkpoint (2026-05-23 late): POKEY now preserves MAME's hidden
startup AUDC behavior without changing the visible write shadow. MAME starts
each channel with internal `AUDC=0xb0` until that channel's AUDC register is
explicitly written; TS now tracks that with `audcWrittenMask`, while
`writeRegs` still reports the real external writes. `resetSoundChip` now calls
`pokeyReset(chip.pokey)` so this hidden state, raw latch, clocks, diagnostics,
and buffers reset together. Added a focused POKEY test for the default
pure-tone phase before the first AUDC write. Current validation artifacts:
`current-validation/chip-write-diff-inject001f-1701-commandedge-pokey-default-audc-rerun.json`
keeps YM `51163/51163` and POKEY `27198/27198` at `0` mismatches, while
`current-validation/pcm-diff-inject001f-1701-commandedge-pokey-default-audc-tight.json`
passes `212` audible windows at worst correlation `0.9974094986067521`, lag
`1`, RMS `0.005534884943771918`, and maxAbs `0.06331737129949033`. The
zero-lag rerun remains green at worst correlation `0.9965714236013331`, lag
`0`, RMS `0.005534884943771918`, and maxAbs `0.041395485401153564`. A current
fractional POKEY CPU-clock experiment was rejected (`corr=0.9550`,
`RMS=0.01750`, `maxAbs=0.08758`), as were output offsets `0`/`-1`; resample
offsets `22` and `24.5` were checked but did not beat the promoted `23.25`
tradeoff. A temporary absolute-phase LoFi resampler experiment reduced
zero-lag RMS to `0.00481` but worsened maxAbs to `0.04403`, and the lag-search
gate failed at maxAbs `0.06680 > 0.065`; it was reverted. The remaining
blocker is still the POKEY edge around sample `569319`, not ordered YM/POKEY
write parity.

Continuation checkpoint (2026-05-23): the current `inject001f-1701-commandedge`
preset no longer needs the write-PC filter or command-`soundPc` filter on the
YM `0x8126:current-event` rule, nor the paired `reg=value` signature on the YM
`0x85f3:current-event` rule. The two channel-2 `current-event` rules for
command-source PCs `0x8d5a` and `0x80f5` also no longer use write-PC filters or
paired `reg=value` filters. Reruns under
`current-mixed-samerun-1701/generalize-ym-commandpc-ablation/` show the
`0x8126` command-PC ablation is green:
`chip-write-diff-ym-8126-no-commandpc.json` compares YM `51163/51163` and
POKEY `27198/27198` with zero tolerance-1 mismatches while applying `270` YM
and `36` POKEY command-edge adjustments, and
`pcm-diff-ym-8126-no-commandpc.json` passes all `212` audible windows
(`worstCorrelation=0.9974094986067521`, `worstAbsLag=1`,
`worstRms=0.005375475797895448`, `worstMaxAbs=0.06331737129949033`). The
actual current-preset reruns under
`current-mixed-samerun-1701/current-preset-ym-ch2-no-regvals/` remain green
with the same PCM metrics. The 85f3 payload-ablation artifacts
`generalize-ym-85f3-regvals/chip-write-diff-ym-85f3-no-regvals.json` and
`generalize-ym-85f3-regvals/pcm-diff-ym-85f3-no-regvals.json` remain the
independent proof that the payload simplification is safe for `0x85f3`.
Broader controls remain rejected: removing the POKEY rule-1 command-`soundPc`
filter introduces 10 POKEY native-sample mismatches, removing the YM `0x8123`
command-`soundPc` filter introduces a false positive at command source `0x86d3`
/ write `0x8eaf:0x30` with native delta `-6`, removing the YM `0x85f3`
command-`soundPc` filter explodes to `4936` YM native-sample mismatches, and
removing the YM `0x81bb` command-`soundPc` filter leaves `33` YM native-sample
mismatches.

Full chip-write parity checkpoint (2026-05-23 continuation):

- The apparent frame-1217 YM failure was an oracle-file mismatch, not a replay
  regression. `/tmp/marble-love/audio-bitperfect/mame_ym_writes.json` is a
  stale 2000-frame log that lacks the `PC 0x9385/0x93c6` write burst now seen
  in the refreshed MAME frame trace. The current baseline must use
  `mame_ym_writes_14000_coinpolarity_full.json`, which matches the refreshed
  MAME trace and TS at frame `1217`.
- Ordered chip-write parity is green for the full corrected Coin 1 run with
  reset-delay `25` and embedded reply acks:
  `chip-write-diff-14000-ym-resetdelay25-embeddedreplyack-coinbase-fullmame-order375161.json`
  reports `375161/375161` YM writes compared with `0` mismatches, and
  `chip-write-diff-14000-pokey-resetdelay25-embeddedreplyack-coinbase-fullmame-order257739.json`
  reports `257739/257739` POKEY writes compared with `0` mismatches.
- Full corrected Coin 1 PCM replay now passes without the old key-on
  selector. The promoted fix is in the absolute-origin `mame-stream` drain:
  `drainYm2151Samples` now uses the same `floor((origin+cycles)*rate)` target
  as YM write servicing instead of splitting the floor into
  `sampleOffset + floor(cycles*rate)`. With `mame-stream`, absolute stream
  origin, MAME-LoFi YM/POKEY resamplers, Timer/LFO reg `0x18:+1`, reset-delay
  `25`, and lag-tie epsilon `0.01`, artifact
  `current-ym-absolute-drain-sanity/replay14000-default-sourceym-hop4096-gate.json`
  passes all `849` selected audible windows with worst correlation `0.97668`,
  worst lag `0`, worst RMS `0.00318`, and worst maxAbs `0.01620`.
- Full `source=mix` PCM replay passes under the same default settings:
  `current-ym-absolute-drain-sanity/replay14000-default-sourcemix-hop4096-gate.json`
  reports the same `849` selected audible windows, worst correlation `0.97668`,
  worst lag `0`, worst RMS `0.00318`, and worst maxAbs `0.01620`. The selected
  corrected-WAV windows are still YM-dominant (`pokey=0`), so this closes the
  corrected attract/music gate but does not prove a POKEY-audible mixed oracle.
  The older `0x8fcc/0x78:+48` plus sample `+1` key-on selector remains a
  diagnostics-only historical control, not a promoted replay rule.
- Browser smoke for the replay path is green with the same promoted web flags.
  Headless Chrome loaded ROMs from `/roms`, fetched
  `scenarios/sound/cmd-tape-attract-music.json`, clicked `Start Replay`,
  started the AudioWorklet, and reached `frame=11940` after fast-forward
  `11900` with no serious console errors or non-favicon network failures.
  Artifact:
  `current-browser-smoke/sound-replay-smoke.json`; screenshot:
  `current-browser-smoke/sound-replay-smoke.png`.
- Short forced `inject0005` mixed PCM replay now has a current POKEY-audible
  all-window gate on the live code. With YM `mame-stream`/MAME-LoFi, POKEY
  linear, `--pokey-resample-offset -0.75`, `--pokey-output-sample-offset 3`,
  and `--lag-tie-correlation-epsilon 0.00003`, artifact
  `pcm-diff-inject0005-760-runtime-mix-pokey-resample-neg075-out3-allwindows-current.json`
  passes all `37` audible windows (`21` YM, `5` POKEY, `11` mixed): worst
  correlation `0.9936`, worst lag `3`, worst RMS `0.00526`, and worst maxAbs
  `0.08300`. This is still a replay/mixer diagnostic; the strict write-timing
  residual around the music-update path remains the promotion blocker.
- A stronger forced POKEY-audible replay candidate now also passes with the
  current absolute-origin YM settings. The current streaming rerun
  `current-runtime-pokey-streaming-probe/inject0005-fullclockabs-out-1-hop4096.json`
  uses `--ym-stream-absolute-origin`, `0x18:+1`, YM MAME-LoFi, full-clock
  POKEY (`--pokey-sample-cycles 1`), POKEY MAME-LoFi, and
  `--pokey-output-sample-offset -1`. It passes all `37` hop-4096 audible
  windows (`21` YM, `5` POKEY, `11` mixed): worst correlation `0.99501`, lag
  `2`, RMS `0.00595`, maxAbs `0.08271`. The runtime POKEY-only YM-muted replay
  also passes when the probe searches only the physically relevant `+/-12`
  sample lag band:
  `current-runtime-pokey-streaming-probe/inject0005-runtime-pokey-ymmuted-fullclockabs-out-1-maxlag12.json`
  reports `21` windows at worst correlation `0.99682`, lag `2`, RMS `0.00549`,
  maxAbs `0.07605`; the earlier far lag `1647` was a periodic correlation
  selection artifact. Cross-check `inject001f-direct-pokey-out-1.json` keeps the
  broad direct POKEY-only oracle green across `205` windows (worst correlation
  `0.999975`, lag `1`, RMS `0.000462`, maxAbs `0.00661`). This short
  `inject0005` candidate is now historical support, not the browser promotion
  gate; the stronger same-run `inject001f` mixed oracle below supersedes the
  old "needs event parity" blocker.
- `oracle/mame_pokey_write_tap.lua` now supports same-run cmd-tape capture for
  POKEY WAV/log oracles via `MARBLE_SOUND_CMD_OUT`, optional embedded reply
  acks via `MARBLE_SOUND_CMD_EMBED_REPLY=1`, optional YM key-on mute via
  `MARBLE_SOUND_MUTE_YM=1`, optional same-run YM write logging via
  `MARBLE_YM_OUT`, and configurable coin/start/injected command frames. This
  avoids mixing cmd tapes, WAVs, and YM/POKEY write logs from different MAME Lua
  scripts.
- The same-run YM-muted `inject001f` oracle is coherent when rendered directly
  from the MAME POKEY write log. Artifacts under
  `current-pokey-long-replay/`:
  `mame_pokey_writes_inject001f_1700_samerun_ymmuted.json` has `27171` POKEY
  writes, `mame_cmds_inject001f_1700_samerun_replyack.json` has `1578` cmds
  and `1527` embedded reply acks, and
  `pcm-diff-inject001f-1700-direct-pokey-samerun.json` passes all `168`
  POKEY-dominant windows with worst correlation `0.99997575`, worst lag `0`,
  RMS `0.000451`, and maxAbs `0.00658`.
- The same-run SoundChip POKEY replay blocker is now narrowed and fixed for the
  compared MAME write prefix. The frame-861 mismatch was caused by YM2151 Timer
  A latching status while the enable bit was clear between `$14=$11` and
  `$14=$05`; MAME/ymfm only latches the status bit when the timer enable is set
  at overflow. `ym2151TickCycles` now gates Timer A/B status latching on the
  respective enable bit. The 900-frame same-run POKEY payload gate
  `payload-pokey-900-ymstatus-gated.json` passes `12282/12282` writes with `0`
  mismatches, and the focused `860..862` traces show the early frame-861 IRQ is
  gone: TS now writes zero at `0x8e28/0x8e2f` in frame `861` and `$79/$51` in
  frame `862`, matching MAME.
- The later same-run `inject001f` POKEY divergence was command/NMI sampling, not
  POKEY DSP. With `--command-nmi-delay-instructions 1`, the 1701-frame same-run
  oracle closes the cutoff audit:
  `chip-write-diff-inject001f-1701-pokey-gated-cmdnmi1-wavrun.json` compares
  TS `27198` POKEY writes against MAME `27198` writes with `0` payload/order
  mismatches (`frameTolerance=1`, loose cycle tolerance). The apparent 9-write
  TS tail in the 1700-frame run was an oracle cutoff artifact; the next MAME
  frame contains those writes. Browser `soundReplay` now defaults to the same
  replay preset through `soundReplayCommandNmiDelay=1`, overridable with
  `soundReplayCommandNmiDelay=0`.
- POKEY PCM for the same-run long oracle now passes through the SoundChip path.
  `pcm-diff-inject001f-1701-runtime-pokey-samerun-ymstatus-gated-cmdnmi1-wavrun.json`
  uses the matching 1701-frame same-run YM-muted WAV/tape, `--source pokey`,
  full-clock POKEY
  (`--pokey-sample-cycles 1`), MAME-LoFi resamplers, output offset `-1`, and
  `--command-nmi-delay-instructions 1`. It passes all `168` selected windows:
  worst correlation `0.9967`, worst lag `2`, worst RMS `0.00502`, and worst
  maxAbs `0.06613`.
- A new non-YM-muted same-run `inject001f` mixed oracle is now captured from one
  MAME run under `current-mixed-samerun-1701/`: one WAV, one embedded-reply
  cmd tape, `51163` YM writes, and `27198` POKEY writes. The ordered event gate
  `chip-write-diff-inject001f-1701-mixed-both-gated-cmdnmi1.json` compares
  `51163/51163` YM and `27198/27198` POKEY writes with `0` mismatches using
  `--command-nmi-delay-instructions 1`. The POKEY-audible mixed PCM gate
  `pcm-diff-inject001f-1701-runtime-mix-samerun-pokeywindows-cmdnmi1-gate.json`
  passes all `168` POKEY-selected windows with worst correlation `0.9644`,
  lag `2`, RMS `0.02921`, maxAbs `0.21487`, and dominant windows
  `{ym:5,pokey:88,mixed:75}`. The all-MAME-window mixed gate
  `pcm-diff-inject001f-1701-runtime-mix-samerun-both-cmdnmi1-gate.json`
  remains red because the later YM-only tail fails badly (worst correlation
  `-0.8586` around sample `1253376`). Direct rendering of the same MAME YM log
  at the worst historical YM window
  `pcm-diff-inject001f-1701-direct-mameym-window1265664.json` passes at
  correlation `1.0000`, RMS `0.00019`, and maxAbs `0.00041`, so the remaining
  tail gap is SoundChip replay/sample-timing alignment, not the YM DSP core.
  A strict YM sample-timing report on the same mixed run,
  `chip-write-diff-inject001f-1701-mixed-ym-sampletiming-cmdnmi1.json`, keeps
  ordered payload/PC parity but reports `46454` native-sample mismatches out of
  `51163` YM writes at `55930` Hz; deltas span `-10..+2` samples with main PC
  clusters at `0x8e9c`, `0x8eaf`, `0x81c3`, `0x81bb`, and `0x8fac`. Next work
  should attack that sample-timing distribution rather than YM operator math.
  The companion phase sweep
  `chip-write-diff-inject001f-1701-mixed-ym-samplephase-sweep-cmdnmi1.json`
  barely moves the count (`46454` -> best `46372`, meanAbs still `0.94`), so a
  single global sample/resampler phase is not the fix.
  A global YM event-cycle offset sweep finds a clear diagnostic minimum at
  `+30` cycles (`5210` sample mismatches, meanAbs `0.108`, versus `46454` /
  `0.936` at `0`), but
  `pcm-diff-inject001f-1701-runtime-mix-samerun-allwindows-ymoffset30-cmdnmi1-gate.json`
  still fails the all-window mixed gate in the later YM-only tail (worst
  correlation `-0.6577`, RMS `0.1539`). Keep `+30` diagnostic for the next
  write-timing investigation; do not promote it as a replay preset yet.
  The later YM-tail failure is now localized to an overfit Timer/LFO `0x18:+1`
  event-offset diagnostic. With global YM event offset `+30`, the frame-860
  sensitive burst compensated by `-40`, and **without** `0x18:+1`, the focused
  runtime YM window
  `pcm-diff-runtime-ym-window1273856-globalp30-frame860burst-m40-noreg18p1-streamdiag.json`
  passes at correlation `1.0000`, lag `0`, RMS `0.00018`, and maxAbs
  `0.00040`. The same-run mixed audible-window gate
  `pcm-diff-inject001f-1701-runtime-mix-samerun-audible001-globalp30-frame860burst-m40-noreg18p1-cmdnmi1-gate.json`
  passes the initial PCM target over `212` selected windows (`audibleThreshold`
  `0.001`) with worst correlation `0.9780` and worst abs lag `2`; late YM tail
  windows all report correlation `~1.0000`. The stricter native-sample exact
  write gate without `0x18:+1` still has `5200/51163` YM sample-boundary
  mismatches, so this is a PCM replay candidate, not a final sample-exact
  event-timing fix.
  `probe-sound-sample-diff.ts` now records `ymStreamWriteDiagnostics` for
  `mame-stream` SoundChip renders. The focused stream diagnostic reports
  `51163` YM writes, `alreadyGeneratedWriteCount=0`, and
  `maxAlreadyGeneratedSamples=0`, ruling out the earlier hypothesis that the
  runtime was applying YM writes after their target sample had already been
  generated.
  The remaining strict YM native-sample mismatch is now characterized. With
  `--sample-tolerance 0`, the PCM-green configuration still reports
  `5200/51163` sample-boundary mismatches, mostly split across music-update
  PCs `0x8e9c`, `0x8eaf`, timer-control PCs `0x81bb/0x81c3`, and `0x8fac`.
  With `--sample-tolerance 1`, that drops to `141` mismatches; nearly all of
  the residual are command-crossing cases where the MAME command edge lands
  inside a TS instruction before an imminent chip store. Constant per-PC timing
  offsets over the main clusters do not materially improve the exact-sample
  count. The command preemption diagnostic remains non-promoted: lookahead `6`
  improves the tolerance-1 report to `109` mismatches and still passes the
  audible mixed PCM gate, but slightly worsens the PCM metrics
  (`worstCorrelation=0.9773`, `worstRms=0.02352` vs `0.9780` / `0.02312`);
  lookahead `3` breaks the ordered write count.
  The chip-write diff now records a global `nativeSampleDeltaHistogram` plus
  `nativeSampleDeltaByRegisterCategory` and `nativeSampleDeltaByRegister` when
  `--sample-rate` is enabled. The current mixed baseline histogram is
  dominated by one-sample-early YM writes
  (`{-1:45118,0:4709,-2:1181,...}`) in
  `chip-write-diff-inject001f-1701-mixed-ym-sampletiming-hist-cmdnmi1.json`.
  The PCM-green same-run baseline has refreshed breakdown artifacts:
  `current-mixed-samerun-1701/chip-write-diff-globalp30-frame860burst-m40-noreg18p1-sampletol0-breakdown.json`
  keeps `5200/51163` strict sample mismatches, split mostly as
  `channel-freq-algo=3515`, `timer=1188`, `operator=398`, `key-on=93`,
  `lfo-noise=5`, `global=1`; the top registers are `0x14=1187`, `0x33=291`,
  `0x23=273`, `0x32=252`, and `0x30=234`. With `--sample-tolerance 1`,
  `chip-write-diff-globalp30-frame860burst-m40-noreg18p1-sampletol1-breakdown.json`
  keeps the known `141` residual mismatches, now split as
  `channel-freq-algo=88`, `operator=27`, `timer=21`, and `key-on=5`; the top
  register is `0x14` with `21`, and the first mismatch remains the
  frame-crossing command edge at index `145`. This makes the remaining work a
  command/sub-instruction timing model, not a single key-on, Timer/LFO, or
  constant per-register offset.
  The all-sample capture
  `chip-write-diff-globalp30-frame860burst-m40-noreg18p1-sampletol1-breakdown-allmismatches.json`
  stores all `141` residuals. Direct command-crossings account for `46`, one
  more is a near-miss, and `94` are neither under the current detector; those
  are concentrated in frame-start command bursts, especially frame `1130`
  (`53` writes, command `0x15` at cycle `0`, then `0x03` at cycle `538`,
  uniform `+80` cycle TS-MAME delta) and frame `1250` (`23` writes, command
  `0x19` at cycle `0`, then `0x03` at cycle `623`, uniform `+62` cycle delta).
  Adjacent integer NMI delays are rejected:
  `chip-write-diff-globalp30-frame860burst-m40-noreg18p1-sampletol1-cmdnmi0.json`
  and `...-cmdnmi2.json` both break ordered write count (`TS=51161`,
  `MAME=51163`) and jump to about `17.9k` mismatches. Changing only
  `--command-nmi-sample-cycle` to `0` or `4` keeps the same `141` residuals as
  the default cycle `2`. The next real fix should therefore model how MAME
  samples/services frame-start command NMIs around 6502 instruction boundaries,
  not promote a broader sample tolerance or a different integer NMI delay.
  A narrower diagnostic now exists: `tickFrameWithTape` accepts an opt-in
  `commandNmiDelayOverride` callback, surfaced in
  `probe-chip-write-diff.ts` and `probe-sound-sample-diff.ts` as
  `--command-nmi-delay-matches frame:byte:cycleInFrame:delay`. Default replay is
  unchanged. With `--command-nmi-sample-cycle Infinity` and overrides only for
  the frame-start bursts
  `1130:0x15:0:0,1130:0x03:538:0,1250:0x19:0:0,1250:0x03:623:0`,
  artifact
  `chip-write-diff-globalp30-frame860burst-m40-noreg18p1-sampletol1-delayoverride-frame1130-1250-bothcmds0-nosamplepoint.json`
  improves the strict tolerance-1 YM report from `141` to `65` mismatches while
  preserving write count (`51163/51163`). The command-submit diagnostic records
  `1579` commands, `0` pending-before writes, delay histogram `{0:4,1:1575}`,
  and the four matched commands all effective delay `0`. The same candidate
  only modestly improves `--sample-tolerance 0` (`5200` -> `5173`) in
  `chip-write-diff-globalp30-frame860burst-m40-noreg18p1-sampletol0-delayoverride-frame1130-1250-bothcmds0-nosamplepoint.json`.
  The mixed audible PCM gate remains green and metric-identical to the current
  baseline in
  `pcm-diff-inject001f-1701-runtime-mix-samerun-audible001-globalp30-frame860burst-m40-noreg18p1-cmdnmi1-delayoverride-1130-1250-nosamplepoint-gate.json`
  (`worstCorrelation=0.9779626`, `worstAbsLag=2`,
  `worstRms=0.023118`, `worstMaxAbs=0.218646`). Treat this as strong evidence
  for selective frame-start command/NMI sampling, but keep it diagnostic until
  the remaining `65` residuals are explained and the rule is generalized beyond
  hand-selected frames.
  The refreshed command-context report
  `chip-write-diff-globalp30-frame860burst-m40-noreg18p1-sampletol1-delayoverride-frame1130-1250-bothcmds0-nosamplepoint-commandcontext.json`
  keeps the same `65` residuals and now embeds previous/next cmd-tape context
  in each mismatch sample. The residual split is `46` command crossings, `1`
  near-miss, and `18` neither. The crossings are mostly keepalive edges
  (`43` after `0x03`, `2` after `0x07`, `1` after `0x10`) only `7..33` TS
  cycles before the chip write. The neither bucket is mostly the known
  frame-860 timestamp burst (`13` rows at `+40` cycles), plus isolated
  keepalive aftermath rows at frames `653`, `712`, `1228`, `1497`, and one
  frame-1354 row after command `0x07`. Combining the existing preemption shim
  with this delay override is rejected: lookahead `6`, lookahead `24`, and
  before-only variants worsen the tolerance-1 count to `109`, `111`, and `133`.
  Do not promote the current preemption shim; derive the next rule from
  bus-cycle/NMI sampling around command edges near chip stores.
  The command-context report has been refreshed with per-source-index submit
  diagnostics in
  `chip-write-diff-globalp30-frame860burst-m40-noreg18p1-sampletol1-delayoverride-frame1130-1250-bothcmds0-nosamplepoint-commandcontext-submit.json`.
  All `46` crossing residuals still have effective delay `1`, with small
  frame-start actual-submit overruns (`0..5` cycles). This rejects several
  simple next rules: crossing-only delay `0` worsens to `118` mismatches
  (`...-crossing-delay0-nopreempt-submit.json`), crossing-only delay `2`
  breaks ordered count and jumps to `17905` mismatches
  (`...-crossing-delay2-submit.json`), and moving only command byte `0x03`
  earlier is worse in `command-cycle-offset-03-sweep.tsv` (`0` best at `65`,
  `-4` -> `66`, `-8..-16` -> `77`, `<= -20` breaks count/volume). A temporary
  whole-instruction frame-boundary hold diagnostic was tested and removed; it
  was neutral alone (`65`) and worsened to `118` with crossing delay `0`.
  The next rule must depend on more detailed 6502/MAME scheduler state than
  command byte, constant NMI delay, command phase, or broad preemption.
  Focused same-run window tracing is now coherent when MAME is launched with
  the full oracle flags (`-nothrottle`, `-seconds_to_run`, isolated
  nvram/cfg dirs, `-nonvram_save`, and WAV enabled). The earlier
  `mame_sound_window_trace.lua` run without those flags was a different sound
  schedule; the corrected window
  `current-mixed-samerun-1701/window-traces/mame-window-260-273-pc-oracleflags-rational.json`
  matches the same-run cmd/YM timestamps at frame `261`. The focused trace
  shows the first residual as TS writing `$81bb/$14=$11` before the command
  edge while MAME defers that same write until after NMI return. A manual
  diagnostic (`command-preempt-chip-write-before-only` plus
  `261:0x03:0:0`) moves TS to cycle `177` versus MAME `174`, but the
  generalized chip-store-boundary delay rule is rejected:
  `chip-write-diff-globalp30-frame860burst-m40-noreg18p1-sampletol1-delayoverride-1130-1250-beforeonly-chipboundary0-correctmatches.json`
  worsens the tolerance-1 report to `120` mismatches. This confirms the
  frame-261 shape but rejects promoting a broad "current PC is chip store"
  delay-0 rule.
  The latest raw-timing rerun,
  `chip-write-diff-globalp30-frame860burst-m40-noreg18p1-sampletol1-rawtiming-samples80.json`,
  separates the adjusted YM event timestamp from the actual 6502 bus-store
  cycle. It reproduces the `65`-mismatch baseline, but the apparent
  command-crossing count drops from `46` adjusted crossings to only `8` raw
  bus-cycle crossings; the new `rawCommandNearMisses` bucket accounts for
  `39` more residuals where the command arrives within `64` cycles after the
  raw bus store. The first mismatch still targets command cycle `490051`:
  adjusted TS delta is `31` cycles because of the diagnostic YM event offset
  `+30`, while the raw store delta is only `1` cycle (`rawTsWriteOffset=3`,
  `chipEventCycleOffset=30`) versus MAME delta `174`. Treat most remaining
  crossings as command-edge/event-sample placement artifacts, not proof of a
  broad CPU preemption bug. The follow-up lookahead sweep confirms that:
  `--command-preempt-chip-write-lookahead 1..5` worsens the tolerance-1 report
  to `43879`, `46805`, `46924`, `46472`, and `44194` mismatches respectively
  in the `...lookahead{1..5}-rawtiming.json` controls. The next fix should
  model the YM stream/event timing boundary more directly.
  A narrower probe-only event-placement diagnostic now exists in
  `probe-chip-write-diff.ts`: `--ym-command-edge-event-delay`,
  `--ym-command-edge-event-after`, `--ym-command-edge-event-relation`,
  `--ym-command-edge-event-bytes`, `--ym-command-edge-event-pcs`, and the
  multi-rule `--ym-command-edge-event-rules` form. It rewrites only normalized
  TS event timestamps for the diff; it does not move CPU/chip state and is not
  a promoted replay rule. The first sweep rejects raw-after in bulk: command
  `0x03`, raw-after `<=64`, delay `144` applies `91` events and worsens the
  gate to `86` mismatches (`chip-write-diff-commandedge03-after-delay144-summary.json`).
  Raw-crossing only is useful: command `0x03`, delay `144` applies `8` events
  and improves `65` to `57` in
  `chip-write-diff-commandedge03-rawcross-delay144-samples80.json`; delays
  `144..188` plateau at `57`.
  The current stronger diagnostic must be run with the same PCM-green NMI
  setup (`--command-nmi-sample-cycle none` plus the frame `1130/1250` delay
  overrides); otherwise the same `0x03:-22..3` rule reruns at `101` mismatches
  because the default sampled NMI delay is reintroduced. With that baseline,
  `chip-write-diff-commandedge-nosample-03_-22_3_144.json` reports `25`
  mismatches. Multi-byte rules for `0x03`, `0x07`, and `0x10` reduce this to
  `21` (`chip-write-diff-commandedge-rules-03-07-10-nosample.json`), and
  adding a report-only `raw-before` class for command edges just before the raw
  store instruction reduces it to `16`
  (`chip-write-diff-commandedge-rules-rawbefore03d176-nosample.json`).
  Extending the frame-860 `-40` event-offset burst over the remaining matching
  writes reaches `6` mismatches in
  `chip-write-diff-commandedge-rules-rawbefore-frame860wide-nosample.json`,
  but this is still overfit diagnostics: it contains two known `0x03`
  raw-after false positives (MAME wrote almost immediately after the command)
  and three frame-860 duplicate-register overmatches. Do not promote these
  rules until the underlying NMI/event-boundary model explains them without
  oracle-specific filtering.
  The next diagnostic split adds command-edge `soundPc` reporting from the MAME
  cmd-tape and optional raw-cycle bounds to `ymWriteEventCycleOffsetMatches`.
  This distinguishes the two false `0x03` raw-after adjustments: command
  sources `0x8b80` and `0x8bb5` write almost immediately in MAME, while the
  useful `-19/-16` cases come from `0x86ce`, `0x8672`, and `0x9009`.
  `chip-write-diff-commandedge-rules-soundpcsplit-base-nosample.json` therefore
  reduces the report to `13` frame-860-only mismatches. The wide frame-860
  burst proves the remaining three misses are duplicate-register overmatches
  (`0x32/0x31/0x30` later in the same frame), and the bounded version
  `chip-write-diff-commandedge-rules-soundpcsplit-frame860bounded-nosample.json`
  closes the same-run YM native-sample tolerance-1 gate:
  `51163/51163` compared, `0` mismatches, histogram
  `{0:46033,1:2754,-1:2376}`. The strict sample-exact rerun
  `chip-write-diff-commandedge-rules-soundpcsplit-frame860bounded-sampletol0-nosample.json`
  still reports `5130` mismatches, all within `±1` native sample. Treat this
  as a localization proof for the NMI/event-boundary model, not bit-perfect
  completion: it still relies on MAME `soundPc` filters and frame-specific
  cycle bounds.
  The companion strict phase sweep
  `chip-write-diff-commandedge-rules-soundpcsplit-frame860bounded-samplephase-nosample.json`
  tests `-64..64` cycle sample phases and only improves the exact count to
  `5072` mismatches at phases `-3` and `+30` cycles. This rules out a simple
  global native-sample origin fix for the remaining exact residual. The
  detailed best-phase rerun
  `chip-write-diff-commandedge-rules-soundpcsplit-frame860bounded-samplephase-bestm3-nosample.json`
  reports histogram `{-2:1,-1:2330,0:46091,1:2737,2:4}` and leaves the same
  dominant PC clusters (`0x8eaf`, `0x8e9c`, `0x81bb`, `0x81c3`, `0x8fac`),
  so the phase tweak is not a promotable replay fix.
  `oracle/mame_sound_window_trace.lua` now annotates chip writes with the last
  sound-CPU opcode fetch (`instPc`, `instOpcode`,
  `instFetchVideoCycleInFrame`, `instDeltaCycles`) when
  `MARBLE_SOUND_TRACE_PC=1`, and `probe-chip-write-diff.ts` records
  `firstTsCommandRead` in command contexts. The three proof windows
  (`window-traces/command-edge-instfetch-summary.json`) separate the useful
  command-edge case from false positives causally: the good frame-273 write
  reads the command before the target YM instruction fetch, while the false
  frame-797/frame-975 writes were already in flight before the command read.
  The command-edge rule grammar now accepts `!pc+pc` in the `commandPcs`
  field to express those exclusions directly; the compact rerun
  `chip-write-diff-commandedge-rules-ym-zero-diagnostic-exclude.json` keeps
  the YM tolerance-1 gate at `0` mismatches. This is still a diagnostic proof,
  not a promoted runtime rule. Running the same settings with POKEY included
  (`chip-write-diff-commandedge-rules-combined-zero-diagnostic.json`) leaves
  YM green but reports `742` POKEY native-sample timing mismatches, so POKEY
  event placement remains the next chip-event target.
  A first POKEY timing sweep using the existing report-only opcode adjuster
  shows the main offset class is opcode `0x91` (`STA (zp),Y`): `0x91=37`
  reduces POKEY tolerance-1 mismatches from `742` to `78`, and the tighter
  sweep finds the best mismatch count at `0x91=21/23` with `36` mismatches
  (`chip-write-diff-pokey-op91p23-samples80.json`). `0x91=30` has the best
  meanAbs in the sweep (`0.110`) but still has `42` mismatches. The remaining
  `0x91=23` residual is not a global phase issue: `28/36` mismatches are
  command crossings clustered on POKEY write PCs `0x8e28..0x8e6f`, often at
  frame boundaries where TS writes at command `-14..28` cycles and MAME writes
  at about `+150..190` cycles. The report-only
  `--pokey-command-edge-event-rules` path now closes that residual in
  `chip-write-diff-pokey-commandedge-op91p23-zero-candidate.json`: YM remains
  `51163/51163` with `0` tolerance-1 mismatches and POKEY reaches
  `27198/27198` with `0` tolerance-1 mismatches. This is still localization,
  not promotion: the paired strict run
  `chip-write-diff-pokey-commandedge-op91p23-zero-candidate-sampletol0.json`
  reports `5130` YM and `6434` POKEY exact native-sample mismatches, all
  within `±1` sample. The current CLI implementation was rerun from those
  serialized POKEY rules in
  `chip-write-diff-pokey-commandedge-op91p23-zero-candidate-rerun-current.json`
  and reproduces the same tolerance-1 result (`0/51163` YM, `0/27198` POKEY);
  the POKEY rule path uses adjusted `replayCycle/writeCycleOffset` as the
  timing basis when separate raw POKEY timing is absent.
  The follow-up causal-context rerun
  `chip-write-diff-pokey-commandedge-op91p23-zero-candidate-causal-context-current.json`
  keeps the same green tolerance-1 result and now records, per adjusted write,
  the raw step start, raw write offset, write PC/opcode/reg/value, first TS
  command read, and command-submit timing. Its new summary buckets show a
  stable command-read anchor: YM first-read deltas sit at `74..82` cycles and
  target-from-read is mostly `62..70` cycles (with the `0x07` long path at
  `218/219`); POKEY first-read deltas sit at `74..81` cycles and
  target-from-read ranges `68..112` cycles plus the `0x07` long path at
  `205/217`. Grouping by write PC/reg alone is not enough, because several
  POKEY copy-loop PCs still have multiple target-from-read offsets; command
  source/read-path context remains part of the discriminator. That makes the
  next promotion target a causal NMI/command-read scheduler model; the current
  rule table is still oracle-specific.
  `probe-chip-write-diff.ts` now also supports diagnostic command-edge rules
  anchored at the first TS command read (`anchor=first-read`) plus an optional
  write-PC filter. The generated first-read rule files
  `ym-commandedge-firstread-rules.txt` and
  `pokey-commandedge-firstread-rules.txt` reproduce the same tolerance-1 zero
  result in `chip-write-diff-commandedge-firstread-current.json` (`0/51163`
  YM, `0/27198` POKEY). This proves the first command read is a viable
  diagnostic anchor, but it is still a per-event localization table.
  The refreshed first-read report
  `chip-write-diff-commandedge-firstread-current-contextgroups.json` preserves
  the same zero-mismatch tolerance-1 result and now groups command-edge
  adjustments by write context and command/read context. The top YM timer write
  group (`pc 0x81bb`, reg `0x14`) still needs target-from-first-read buckets
  `64/65/68/69/70`, while POKEY copy-loop write PCs `0x8e3c`, `0x8e5b`, and
  `0x8e62` each have six adjusted writes with multiple target buckets. This
  rejects a simple per-write-PC/reg delay promotion and confirms that command
  source plus first-read path are still required for a causal scheduler model.
  The current combined strict phase sweep
  `chip-write-diff-pokey-commandedge-op91p23-zero-candidate-samplephase-current.json`
  confirms that exact mismatch is not a shared output phase issue. At
  `--sample-tolerance 0`, YM remains `5130` exact mismatches and only improves
  to `5072` at phases `-3/+30`; POKEY remains `6434` exact mismatches and only
  improves to `6329` at phases `-10/+22/+54`. Both chips' strict residuals
  stay within `±1` native sample. `probe-sound-sample-diff.ts` now understands
  the same command-edge rule grammar as the write-diff probe, including
  `anchor=first-read` and write-PC filters. For first-read rules it runs a
  probe-only replay prepass to collect future command submissions and
  `$1810` reads, so the online PCM render can see the same causal context as
  the offline write diff. The mixed 1701-frame YM rerun
  `pcm-diff-inject001f-1701-runtime-mix-boundedym23-cmdedgeym-firstread-prepass-cmdnmi-aud001.json`
  applies all `52` YM first-read adjustments, but the PCM gate remains
  unchanged and red (`worstCorr=0.97796`, `worstRms=0.02312`,
  `worstMaxAbs=0.21865`, max lag `2`). The POKEY side now has a
  diagnostics-only `pokeyWriteApplyDelayProvider` plus PCM probe wiring for
  `--pokey-command-edge-event-rules`; with the write-diff `0x91:+23` raw-cycle
  basis exposed as `--pokey-command-edge-raw-cycle-offset-opcodes 0x91:23`,
  `pcm-diff-inject001f-1701-runtime-mix-cmdedge-both-firstread-prepass-pokeyop91p23-cmdnmi-aud001.json`
  applies `52` YM and `36` POKEY first-read adjustments. It still reports the
  same red PCM metrics, so the current evidence rejects "copy the localized
  event table into PCM replay" as a sufficient fix. The next blocker is the
  mixed-window audio behavior itself, especially the worst windows around
  `1163264..1167360`, not merely missing command-edge context in the probe.
  The PCM probe now accepts the same bounded YM write-offset selector syntax as
  the write-diff probe (`frame:pc:reg:val:delta[:cycleMin:cycleMax]`), so the
  frame-860 YM burst rules can be reused in rendered-audio gates. On the same
  1701-frame oracle, the direct MAME-chip render with MAME YM+POKEY logs passes
  the audible-window PCM gate (`pcm-diff-inject001f-1701-direct-mamechipwrites-mix-aud001.json`):
  `212` windows at audible threshold `0.001`, worst correlation `0.99498`,
  worst RMS `0.01095`, worst maxAbs `0.14196`, and max lag `1` under the
  current `corr>=0.95/rms<=0.02/maxAbs<=0.15` thresholds. The equivalent
  SoundChip replay path with bounded YM offsets and command-NMI overrides
  (`pcm-diff-inject001f-1701-runtime-mix-boundedym23-cmdnmi-aud001.json`)
  still fails: worst correlation `0.97796`, worst RMS `0.02312`, worst maxAbs
  `0.21865`, and lags up to `2`, with the worst windows in POKEY-heavy and
  mixed sections. That split points the current PCM blocker at replay
  event-application timing rather than the direct YM/POKEY DSP and mixer.
  A focused sweep of the existing `--pokey-write-apply-delay` diagnostic on the
  worst POKEY window (`start=1048576`) improves the window enough to pass around
  `24..80` cycles, with the best local RMS near `56` cycles. The worst mixed
  window (`start=1163264`) does not clear: RMS improves, but `maxAbs` remains
  pinned at `0.21865`. The sample trace
  `pcm-trace-runtime-window1163264-channels.json` shows the peak at output
  sample `1168416` is YM-only in TS (`tsYm=0.04045`, `tsPokey=0`) against MAME
  `-0.17819`, dominated by YM channel 2. The matching write-diff residuals in
  this frame band are YM command-edge crossings around frames `1441..1497`
  (`reg 0x23/0x27/0x32/0x37` at `pc 0x8e9c/0x8eaf`). A global POKEY apply
  delay is therefore not sufficient; the next PCM diagnostic step is rendering
  with the same causal YM command-edge timing model already proven in
  write-diff, without hard-promoting the oracle rule table to gameplay.
  Follow-up PCM diagnostics now record YM match-fire evidence in
  `ymStreamWriteDiagnostics`: event-offset histograms, selector hit counts,
  per-frame buckets, and sample writes. This proved that bounded
  `cycleInFrame` selectors do fire; the failed target-only 1458 experiment was
  missing preceding channel-2 phase history, not a parser/runtime bug. The
  broad PC-only channel-2 `+5` rule fixes the focused `1163264` window but
  overmatches. The narrow non-regressing localization is frames `1437` and
  `1458`, regs `0x7a/0x72/0x6a/0x62` plus key-on
  `0x8fcc:0x08=0x7a`, all at `+5`. With
  global YM event offset `+30`, the bounded frame-860 `-40` burst, full-clock
  POKEY/MAME-LoFi, POKEY output offset `+1`, and command-NMI delay `1`, the
  all-window same-run mixed gate passes without a diagnostic POKEY apply delay:
  `pcm-diff-inject001f-1701-runtime-mix-ymevent30-frame860-ch2series1437-1458-keyon-pokeyout1-cmdnmi-aud001.json`
  selects `212` windows at threshold `0.001` and reports worst correlation
  `0.9842`, max lag `1`, worst RMS `0.01901`, and worst maxAbs `0.10682`.
  The no-delay POKEY output sweep leaves offsets `0` and `+1` green, while
  the older output `-1` candidate remains red (`worstRms=0.02246`,
  `worstMaxAbs=0.16239`). A diagnostic POKEY apply delay `56` with output
  `-1` also passes, but the no-delay output-phase candidate is the current
  proof target rather than a promoted replay/web setting.
  `probe-sound-sample-diff.ts` now has a reference-direct mode for this exact
  split: `--reference-mame-ym-writes` and `--reference-mame-pokey-writes` keep
  normal SoundChip replay as the TS side, render the MAME write logs directly
  as the comparison signal, set `mameCompare.source="direct-chip-writes"`, and
  annotate `maxAbsSample`/trace rows with `refYm`/`refPokey`. The focused
  runtime YM versus direct YM report
  `pcm-diff-runtime-vs-directym-window1163264-reference-frame860.json` shows
  frame-860 selectors alone still leave the channel-2 peak at maxAbs `0.21625`
  (`tsYm=0.04045`, `refYm=-0.17579` at sample `1168416`). Adding the
  frame `1437/1458` channel-2 series in
  `pcm-diff-runtime-vs-directym-window1163264-reference-frame860-ch2series.json`
  drops that replay-vs-direct YM comparison to correlation `0.9999638`, RMS
  `0.00102`, and maxAbs `0.00794`. The focused mixed reference report
  `pcm-diff-runtime-vs-directmix-window1163264-reference-frame860-ch2series-pokeyout1.json`
  then reaches correlation `0.9993`, RMS `0.00583`, and maxAbs `0.04579`;
  its peak at sample `1167626` is POKEY-dominant (`tsPokey=0.02323`,
  `refPokey=0.06708`) while YM differs by only about `0.00194`. This confirms
  the channel-2 localization fixes the direct YM replay mismatch itself, and
  the remaining focused mixed residual belongs with the broader POKEY
  phase/application timing work.
  The next POKEY-focused diagnostics add direct-reference channel attribution
  and `--sample-trace-center-sample` for inspecting a chosen output sample. The
  isolated `source=pokey` runtime-vs-direct focused report
  `pcm-diff-runtime-vs-directpokey-window1163264-reference-frame860-ch2series-pokeyout1-refchannels.json`
  still passes but wants lag `-1` (`corr=0.998706`, RMS `0.00510`, maxAbs
  `0.03913`). Its peak at sample `1164301` is a CH0/CH1 transition:
  TS POKEY channels are `0.08614/0.02531`, while direct reference channels at
  the compared sample are `0.07077/0.00155`. A focused
  `--pokey-write-apply-delay` sweep against direct POKEY finds `14` cycles as
  the best local discriminator: lag becomes `0`, correlation `0.999976`, RMS
  `0.00069`, and maxAbs `0.00600`; delay `56` is the next useful local point
  at lag `1`, RMS `0.00123`, maxAbs `0.00941`.
  Applying `--pokey-write-apply-delay 14` to the focused mixed
  runtime-vs-direct report
  `pcm-diff-runtime-vs-directmix-window1163264-reference-frame860-ch2series-pokeyout1-apply14.json`
  improves the old POKEY-dominant residual to correlation `0.999968`, RMS
  `0.00123`, maxAbs `0.00931`, and lag `0`. The all-window
  runtime-vs-direct mixed report
  `pcm-diff-runtime-vs-directmix-allwindows-reference-frame860-ch2series-pokeyout1-apply14.json`
  also passes all `212` windows (`worstCorr=0.9851`, lag `1`,
  RMS `0.01847`, maxAbs `0.10487`). This remains diagnostic only: the same
  candidate against the real MAME WAV,
  `pcm-diff-inject001f-1701-runtime-mix-ymevent30-frame860-ch2series-pokeyout1-apply14-cmdnmi-aud001.json`,
  fails the RMS gate (`worstRms=0.02085 > 0.02`, maxAbs `0.12672`) and is
  worse than the no-apply WAV gate (`worstRms=0.01901`, maxAbs `0.10682`).
  Follow-up residual controls show the true current global peak is not POKEY.
  Direct POKEY rendered from the same MAME write log against `WAV - direct YM`
  is clean across the POKEY-selected windows:
  `pcm-diff-directpokey-vs-mixminusdirectym-pokeywindows-outm1.json` passes at
  worst correlation `0.99927`, RMS `0.00384`, and maxAbs `0.02419`. The
  runtime trace at the old global peak sample `1056072` shows
  `tsPokey=refPokey=0.163636` with matching CH0/CH1 channels, while
  `tsYm=0.088417` and direct `refYm=-0.016452`; the delta is YM channel `0`.
  Therefore `apply14` remains useful for the old focused POKEY
  runtime-vs-direct split, but it is not the active broad WAV blocker.
  The current active localization is YM channel-0 setup/key-on timing. State
  traces show runtime channel 0 is exactly one native YM sample ahead before
  the frame-1317 key-on; the key-on realigns operator phase, but the feedback
  history remains different and creates the audible transient. A wider trace
  finds the first source at frame `1310`: runtime applies the new channel-0
  setup/key-on at native sample `1223464`, while direct-MAME applies it at
  `1223465`. A diagnostics-only `+30` cycle selector for the frame-1310
  channel-0 burst (`0x93a4`, `0x93c6`, `0x8e9c`, `0x8eaf`, `0x8eeb`,
  `0x8fac`, `0x8fcc`) improves the focused runtime-vs-direct YM window
  `1048576` from correlation `0.8995`, RMS `0.01846`, maxAbs `0.10487` to
  correlation `0.9954`, RMS `0.00395`, maxAbs `0.03127`. The all-window
  runtime-vs-direct YM gate
  `pcm-diff-runtime-vs-directym-allwindows-reference-frame860-ch2series-ch0frame1310d30.json`
  passes at worst correlation `0.9954`, RMS `0.00395`, maxAbs `0.05842`, and
  the real mixed WAV gate
  `pcm-diff-inject001f-1701-runtime-mix-ymevent30-frame860-ch2series-ch0frame1310d30-pokeyout1-cmdnmi-aud001.json`
  improves to worst correlation `0.9974`, RMS `0.00704`, maxAbs `0.06602`.
  `probe-sound-sample-diff.ts` now has a `current-event` command-edge anchor
  for this class of diagnostic: it keeps a command-selected burst's relative
  write spacing and adds a constant offset to the current event cycle. The
  non-frame-specific rule
  `0x1b:20000:24100:30:raw-before:0:25000:0x8126:current-event`
  applies around the `0x1b` command edge and reproduces the same focused,
  all-window runtime-vs-direct YM, and real mixed WAV results:
  `pcm-diff-runtime-vs-directym-allwindows-commandedge1310-currentevent30.json`
  passes at worst correlation `0.9954`, RMS `0.00395`, maxAbs `0.05842`, and
  `pcm-diff-inject001f-1701-runtime-mix-commandedge1310-currentevent30-pokeyout1-cmdnmi-aud001.json`
  passes at worst correlation `0.9974`, RMS `0.00704`, maxAbs `0.06602`. The
  no-write-PC ablation
  `chip-write-diff-ym-8126-no-writepc.json` keeps both chips at `0` ordered
  mismatches under native-sample tolerance `±1`, and
  `pcm-diff-ym-8126-no-writepc.json` keeps the mixed PCM gate green
  (`corr=0.9974`, lag `1`, RMS `0.00538`, maxAbs `0.06332`), so this rule no
  longer carries the older `0x93a4/.../0x8fcc` write-PC allow-list.
  `probe-chip-write-diff.ts` now accepts the same `current-event` anchor. On
  the same `inject001f` mixed oracle, the current-event YM event report
  `chip-write-diff-inject001f-1701-mixed-ym-currentevent1310-cmdnmi1.json`
  compares all `51163` ordered YM writes with no reg/val/PC drift; remaining
  mismatches are native-sample timing only. The histogram is
  `{0:45956, 1:2732, -1:2347, 2:45, 3:31, -5:23, -4:24, -8:3, -9:1, -3:1}`,
  so `51035/51163` writes are within `±1` native sample and `128` are still
  outside `±1`. The same tape's POKEY event report
  `chip-write-diff-inject001f-1701-mixed-pokey-order-cmdnmi1.json` compares
  all `27198` POKEY writes with `0` mismatches. Event order is therefore closed
  for this oracle; strict chip timing is still open on the residual YM
  native-sample outliers.
  `probe-chip-write-diff.ts` now serializes those outliers in
  `nativeSampleMismatchByCommandSource`, grouped by command relation,
  command byte/sound PC, write PC/register, first `$1810` read delta, replay
  delta, and native-sample histogram. The refreshed artifact
  `chip-write-diff-inject001f-1701-mixed-ym-currentevent1310-cmdnmi1-commandbreakdown.json`
  keeps the same `128` residuals and groups them into `49` command-source
  buckets. Three far command-burst buckets explain `76` of them:
  `far:0x03@0x83fc` has `37` writes at replay delta `+80`,
  `far:0x03@0x841e` has `23` at `+62`, and `far:0x03@0x8e84` has `16` at
  `+80`. The remaining `52` are command-edge/near or isolated negative-delta
  rows, dominated by `0x03` crossings around `-143..-151` cycles plus the
  known long `0x07` and `0x10` edge cases. This keeps the causal axis on
  command/NMI/sample-event placement rather than YM register class.
  A focused diagnostic confirms the three far buckets are exactly the old
  frame-start command/NMI sample-point class: keeping the normal sample point
  and adding the `1130/1250` delay overrides leaves the report unchanged at
  `128` mismatches, while `--command-nmi-sample-cycle Infinity` plus those
  four overrides removes all three far buckets and leaves `52` YM residuals.
  Artifact
  `chip-write-diff-currentevent1310-frameoverride-nosamplepoint-commandbreakdown.json`
  reports histogram
  `{0:45983,1:2781,-1:2347,-3:1,-4:24,-5:23,-8:3,-9:1}`. The same preset
  keeps POKEY order exact in
  `chip-write-diff-pokey-order-frameoverride-nosamplepoint-cmdnmi1.json`
  (`27198/27198`, `0` mismatches), and the mixed PCM gate
  `pcm-diff-inject001f-1701-runtime-mix-commandedge1310-currentevent30-frameoverride-nosamplepoint-pokeyout1-cmdnmi-aud001.json`
  stays green with the same worst metrics as the baseline current-event run:
  correlation `0.997409`, lag `1`, RMS `0.007037`, maxAbs `0.066018`.
  This is still not a promotion candidate because it is frame-specific, but it
  cleanly separates the remaining work into `52` command-edge/near rows.
  Keep this as a localization proof, not a promoted replay rule; the next
  promotion target is a causal YM stream/event-boundary model for
  one-native-sample setup/key-on placement.
  A fresh diagnostic rule pack closes those `52` residual rows on the same
  oracle without reg/val/PC drift:
  `chip-write-diff-currentevent1310-frameoverride-nosamplepoint-ymzero-commandedge.json`
  compares all `51163` YM writes with `0` native-sample mismatches at
  tolerance `±1` and histogram `{0:46011,1:2782,-1:2370}`. It applies `88`
  command-edge adjustments total: the existing `36` current-event writes for
  command `0x1b`, plus `52` boundary writes (`0x03=47`, `0x07=4`,
  `0x10=1`) with delays `138/144/155/176/296` cycles. The matching mixed PCM
  gate
  `pcm-diff-inject001f-1701-runtime-mix-currentevent-frameoverride-nosamplepoint-ymzero-commandedge-pokeyout1-cmdnmi-aud001.json`
  also stays green with correlation `0.997409`, lag `1`, RMS `0.007037`,
  maxAbs `0.066018`. Do not promote this rule pack yet: it is still a
  command-PC/raw-delta table.
  The refreshed command-source breakdown now records TS/MAME deltas from the
  nearest command and the target delay window needed to land on the accepted
  MAME native-sample interval. That turns the remaining YM boundary rows into
  compact byte/range rules:
  `chip-write-diff-currentevent-frameoverride-nosamplepoint-byteboundary-general2-commandedge.json`
  compares all `51163` YM writes with `0` tolerance-1 native-sample
  mismatches, histogram `{-1:2372,0:46009,1:2782}`. The companion POKEY
  diagnostic first isolates the broad store timing class with report-only
  opcode offset `0x91=23`, then applies compact command-edge rules for
  command bytes `0x03` and `0x07`; artifact
  `chip-write-diff-pokey-op91p23-commandedge-general2.json` compares all
  `27198` POKEY writes with `0` tolerance-1 native-sample mismatches,
  histogram `{-1:6126,0:20752,1:320}`. The combined report
  `chip-write-diff-both-sampletiming-ymgeneral2-pokeyop91p23-commandedge.json`
  keeps both chips green in one run (`51163/51163` YM and `27198/27198`
  POKEY, both `0` mismatches at `55930` Hz, tolerance `±1`). This is still
  diagnostic evidence rather than a promoted replay preset: YM still uses
  frame-860/channel-2 selectors plus current-event classes, and POKEY uses a
  report-only `0x91` timestamp offset plus command-edge timing rules.
  The matching mixed PCM gate
  `pcm-diff-inject001f-1701-runtime-mix-ymgeneral2-pokeyop91p23-commandedge-pokeyout1-cmdnmi-aud001.json`
  passes on all `212` audible MAME-selected windows with correlation
  `0.997409`, lag `1`, RMS `0.007037`, maxAbs `0.066018`, and source split
  `{ym:49,pokey:88,mixed:75,silent:0}`. That makes the compact rule pack
  decisionally useful for the current oracle. The paired `first-read`
  localization artifact
  `pcm-diff-inject001f-1701-runtime-mix-cmdedge-both-firstread-prepass-pokeyop91p23-cmdnmi-aud001.json`
  remains red (`corr=0.977963`, lag `2`, RMS `0.023118`, maxAbs
  `0.218646`), so promotion should stay on current-event/command-boundary
  modeling rather than first-read timestamp replay.
  The same rule pack is now captured as the CLI preset
  `--audio-bitperfect-preset inject001f-1701-commandedge` in
  `packages/cli/src/audio-bitperfect-presets.ts`, so the current oracle gates
  are reproducible without copy/pasting the long diagnostic strings. Preset
  reruns produced
  `chip-write-diff-both-commandedge-preset.json` (`0` YM and `0` POKEY
  mismatches at native-sample tolerance `±1`) and
  `pcm-diff-inject001f-1701-runtime-mix-commandedge-preset.json` (same PCM
  metrics: correlation `0.997409`, lag `1`, RMS `0.007037`, maxAbs
  `0.066018` over `212` audible windows). The preset has now dropped the
  frame-specific `1437/1458` channel-2 YM write-offset matches in favor of two
  command-source `current-event` rules (`soundPc 0x8d5a` and `0x80f5`). The
  first rerun used paired `reg=value` filters; later ablations removed those
  filters as well while keeping the same gate green. Rerun artifact
  `current-validation/chip-write-diff-both-commandedge-preset-cmdpc-ch2-conservative-rerun.json`
  keeps both chips at `0` mismatches. The matching PCM rerun
  `current-validation/pcm-diff-inject001f-1701-commandedge-preset-cmdpc-ch2-strict-rerun.json`
  also passes under tighter guardrails (`corr>=0.995`, `absLag<=2`,
  `RMS<=0.008`, `maxAbs<=0.07`). The no-`reg=value` channel-2 current-preset
  artifacts are
  `current-preset-ym-ch2-no-regvals/chip-write-diff-current-preset-ym-ch2-no-regvals.json`
  and
  `current-preset-ym-ch2-no-regvals/pcm-diff-current-preset-ym-ch2-no-regvals.json`.
  A focused POKEY resampler phase sweep on the same oracle first isolated
  `--pokey-resample-offset 16.5` as the best lag-search RMS point, then the
  zero-lag control promoted `--pokey-resample-offset 20` inside the preset. The
  zero-lag artifact
  `current-validation/pcm-diff-inject001f-1701-commandedge-preset-pokeyresample2000-zero-lag.json`
  passes the same `212` windows with `corr=0.995850`, lag `0`, RMS `0.005375`,
  and maxAbs `0.063239`, while the lag-search artifact
  `current-validation/pcm-diff-inject001f-1701-commandedge-preset-pokeyresample2000-tight.json`
  keeps the main gate green at `corr=0.997409`, lag `1`, RMS `0.005375`, and
  maxAbs `0.063317`. The paired chip-write artifact
  `current-validation/chip-write-diff-both-commandedge-preset-pokeyresample2000.json`
  remains at `0` mismatches for all `51163` YM and `27198` POKEY writes. The
  preset thresholds are therefore tightened to `RMS<=0.006` and `maxAbs<=0.065`.
  A channel trace at sample `723135`
  (`pcm-diff-inject001f-1701-commandedge-pokeytrace-723135-pokeyresample1650.json`)
  shows the previous POKEY edge residual is no longer the peak: TS `0.11056`
  vs MAME `0.10925`, with POKEY `0.07977` and YM `0.03079`; the remaining
  worst residual is a mixed/YM edge at sample `566592`.
  The later zero-lag peak at sample `1145754` was traced to YM channel 1
  timing, not POKEY or mixer: exact MAME-write component rendering gives
  `refPokey=0.08181818` matching TS POKEY, while TS YM channel 1 is about
  `0.052` too high. The promoted `0x81bb` YM command-edge rule
  (`0x03:8000:11200:-26:raw-before:0:12000:0x81bb:current-event`) moves that
  command-source burst without frame-specific selectors. Preset reruns now
  pass chip parity in
  `current-validation/chip-write-diff-both-commandedge-preset-81bb.json`
  (`51163/51163` YM and `27198/27198` POKEY, both `0` mismatches), keep the
  lag-search PCM gate green in
  `current-validation/pcm-diff-inject001f-1701-commandedge-preset-81bb-tight.json`
  (`corr=0.997409`, lag `1`, RMS `0.005375`, maxAbs `0.063317`), and improve
  the strict zero-lag gate in
  `current-validation/pcm-diff-inject001f-1701-commandedge-preset-81bb-zero-lag.json`
  to `corr=0.995850`, lag `0`, RMS `0.005375`, and maxAbs `0.047445`.
  The next zero-lag trace at sample `558051`
  (`current-validation/pcm-diff-inject001f-1701-commandedge-preset-81bb-reftrace-558051.json`)
  moved the residual back to POKEY channel 2 falling-edge shape: TS and direct
  reference YM match exactly at the peak, while TS POKEY is `0.048917` versus
  direct reference POKEY `0.034835`. A narrow resampler sweep first promoted
  `--pokey-resample-offset 22.6`; a follow-up MAME-source check then moved
  POKEY native output sampling before `stepOneClock`, matching MAME's
  `m_stream->update()`-before-raw-change behavior, and promoted
  `--pokey-resample-offset 23.25` as the current preset value. The zero-lag
  artifact
  `current-validation/pcm-diff-inject001f-1701-commandedge-preset-pokey2325-zero-lag.json`
  improves to `corr=0.996571`, lag `0`, RMS `0.005535`, and maxAbs
  `0.041395`. The lag-search control
  `current-validation/pcm-diff-inject001f-1701-commandedge-preset-pokey2325-tight.json`
  remains green at `corr=0.997409`, lag `1`, RMS `0.005535`, and maxAbs
  `0.063317`. The remaining zero-lag peak is sample `569319`; reference-component
  trace
  `current-validation/pcm-diff-inject001f-1701-commandedge-preset-pokey226-reftrace-569319.json`
  shows TS YM and direct-reference YM still match exactly, while POKEY channel
  2 is on a one-sample rising edge. That makes the next target a POKEY
  DSP/resampler edge-shape issue, not another chip-write parity rule.
  Browser `soundReplay` now accepts the command/NMI sample controls and the
  command-edge rule format used by the preset: `soundReplayCommandNmiSampleCycle`,
  `soundReplayCommandNmiDelayMatches`, 7-field
  `soundReplayYmWriteEventCycleOffsetMatches`, `soundReplayYmCommandEdgeEventRules`,
  `soundReplayPokeyCommandEdgeEventRules`, and
  `soundReplayPokeyCommandEdgeRawCycleOffsetOpcodes`, plus the promoted
  `soundReplayPokeyResampleOffset=23.25`. The web replay
  precomputes command events from the cmd tape and applies those rules through
  the existing diagnostics-only YM event-offset and POKEY apply-delay providers,
  keeping the behavior isolated from gameplay. The browser alias
  `soundReplayPreset=inject001f-1701-commandedge` now expands the same rule pack
  for the current oracle while preserving explicit query overrides; it now also
  sets `soundReplayRequireCommandContext=1`, so the preset fails fast unless
  every replay command has both cycle timing and `soundPc` context. The replay
  status reports `commandEvents`, `cycleInFrame`, and `soundPc` counts to avoid
  mistaking a context-free public tape for a parity proof. The new public
  scenario `packages/web/public/scenarios/sound/cmd-tape-inject001f-1701-commandedge.json`
  is copied from the current same-run oracle tape and carries `1579` commands,
  `1701` frames, cycle-precise timing, `soundPc` on all commands, and `1528`
  embedded reply-ack events. A focused TS check of that scenario reports
  `commandEvents=1579 cycleInFrame=1579 soundPc=1579 replyAcks=1528`, and HTTP
  smoke returns `200 OK` for both the JSON and
  `/?autoLoad=1&soundReplay=scenarios/sound/cmd-tape-inject001f-1701-commandedge.json&soundReplayPreset=inject001f-1701-commandedge&soundReplayFastForward=0`.
  The older Chrome/CDP smoke on
  `cmd-tape-attract-cycle-precise.json` remains useful only as replay wiring
  evidence because that tape lacks `soundPc` and reply-ack context.
  A reset-origin diagnostic, `--reset-release-delay 30`, improves ordered YM
  native-sample timing to `4107/51163` mismatches with histogram
  `{0:47056,-1:2101,1:1961,...}` in
  `chip-write-diff-inject001f-1701-mixed-ym-sampletiming-resetdelay30-hist-cmdnmi1.json`,
  but it is still rejected as a promotion: the all-window mixed PCM gate
  `pcm-diff-inject001f-1701-runtime-mix-samerun-allwindows-resetdelay30-cmdnmi1-gate.json`
  remains red in the late YM tail (worst correlation `-0.4726`, RMS
  `0.1257`), and the POKEY-selected mixed gate regresses below threshold
  (`worstCorr=0.9392`, RMS `0.0364`) in
  `pcm-diff-inject001f-1701-runtime-mix-samerun-pokeywindows-resetdelay30-cmdnmi1-gate.json`.
  Simple YM output sample offsets and broad replay sample-offset matches were
  also rejected on this same-run oracle; they leave the late YM tail red.
  The frame-specific command-NMI delay overrides for the current preset have
  now been generalized one step without making them broad CPU rules. CLI and
  web presets use byte+cycle selectors
  `*:0x15:0:0,*:0x19:0:0,*:0x03:538:0,*:0x03:623:0` instead of
  `1130/1250` frame-specific matches. Current-preset reruns under
  `current-mixed-samerun-1701/generalize-nmi-boundary/` stay green:
  `chip-write-diff-current-preset-wildcard-delaymatches.json` compares all
  `51163` YM writes and `27198` POKEY writes with `0` tolerance-1 mismatches
  (native sample histograms YM `{0:46045,1:2749,-1:2369}`, POKEY
  `{0:20752,1:320,-1:6126}`), and
  `pcm-diff-current-preset-wildcard-delaymatches.json` passes all `212`
  audible windows with worst correlation `0.9974094986067521`, lag `1`, RMS
  `0.0055489808240257775`, maxAbs `0.06331737129949033`, and source split
  `{ym:49,pokey:88,mixed:75,silent:0}`. The override now fires on `10`
  commands with no pending-before submissions. The broad causal-looking
  control `--command-nmi-delay-chip-write-boundary 0` is rejected:
  `chip-write-diff-boundary0-no-explicit.json` applies `25` overrides and
  reintroduces `76` YM plus `15` POKEY tolerance-1 mismatches. This keeps the
  current rule table less frame-specific but still diagnostic; exact native
  sample equality and a causal scheduler model remain open.
  `probe-chip-write-diff.ts` now records `commandSubmitDiagnostics.overrideBySelector`
  so these matches can be audited without reading the full command tape. The
  current artifact
  `command-nmi-selector-diagnostics/chip-write-diff-current-preset-selector-diagnostics.json`
  keeps both chips green and splits the `10` override hits as:
  `*:0x03:538:0` on frames `800/1010/1130`, `*:0x03:623:0` on
  `1250/1280/1310/1340/1400`, and single frame-start hits for
  `*:0x15:0:0` at `1130` and `*:0x19:0:0` at `1250`. All have
  `pendingBefore=false`; actual submission deltas are only `0..2` cycles after
  the scheduled command target. The paired current preset PCM rerun
  `command-nmi-selector-diagnostics/pcm-diff-current-preset-selector-diagnostics.json`
  uses the current POKEY `23.25` resample offset and passes all `212` audible
  windows (`worstCorrelation=0.9974094986067521`, `worstAbsLag=1`,
  `worstRms=0.005534884943771918`, `worstMaxAbs=0.06331737129949033`,
  split `{ym:49,pokey:88,mixed:75,silent:0}`). This makes the next NMI step
  measurable: explain why exactly these byte+cycle positions can take delay
  `0`, not just keep them as opaque preset strings.
  `tickFrameWithTape` now emits replay-only command-submit step context, and
  `probe-chip-write-diff.ts` records it under
  `commandSubmitDiagnostics.overrideBySelector`. Rerun
  `command-nmi-step-context/chip-write-diff-current-preset-step-context.json`
  keeps YM `51163/51163` and POKEY `27198/27198` green with zero tolerance-1
  mismatches. All `10` wildcard delay-0 overrides still have
  `pendingBefore=false`, occur outside interrupt service, and end the
  just-executed 6502 step only `0..2` cycles after the command target. The
  frame-start `0x15@0` and `0x19@0` hits both cross frame start in
  `0x8120:0xae`; the `0x03@538` and `0x03@623` hits have varied PCs/opcodes
  but target offsets inside the last step of `1..5` cycles. The paired PCM
  rerun
  `command-nmi-step-context/pcm-diff-current-preset-step-context.json` passes
  the same `212` audible windows (`worstCorrelation=0.9974094986067521`,
  `worstAbsLag=1`, `worstRms=0.005534884943771918`,
  `worstMaxAbs=0.06331737129949033`). This sharpens the causal hypothesis to
  sub-instruction command/NMI sampling around the just-completed instruction;
  it still is not a promoted scheduler model because the `0x03@623` PCs vary.
  Follow-up artifact
  `command-nmi-all-submit-diagnostics/chip-write-diff-current-preset-all-submit-diagnostics.json`
  adds `commandSubmitDiagnostics.byDelay` for all `1579` command submissions.
  It keeps the same green write gate and proves a last-step-only rule is too
  broad: delay `0` has target offsets `1..5` and actual end deltas `0..2`, but
  delay `1` has `1569` commands with the same offset range heavily populated
  (`targetOffset 1=487`, `2=483`, `3=325`, `4=221`, `5=39`; actual end delta
  `0=483`, `1=476`, `2=346`). `1566/1569` delay-1 commands are also normal
  non-interrupt last steps. Therefore the four wildcard overrides cannot be
  promoted as "normal instruction, small target offset" or "not interrupt
  service"; the next causal probe must compare the MAME command-write sample
  point to TS step/bus phase more directly.
  `oracle/mame_pokey_write_tap.lua` now attaches the last MAME sound-CPU
  opcode fetch to cmd-tape entries when `MARBLE_SOUND_TRACE_FETCH=1`, and
  `probe-chip-write-diff.ts` parses that command-side `instPc`/`instOpcode`/
  `instDeltaCycles` into command-submit diagnostics. The focused MAME run under
  `current-mixed-samerun-1701/command-fetch-context/` captured `1277` commands
  through frame `1410`, with all `1277` carrying `soundPc` and `676` carrying
  command-side fetch context. The YM-only current-preset report
  `chip-write-diff-current-preset-command-fetch-context-1410-ymonly.json`
  is green (`43051/43051` YM writes, `0` mismatches) and shows the `10`
  delay-0 overrides split across MAME command `instDeltaCycles`
  `{2,4,5,19,262,301,341,381,390}`. But delay-1 commands still overlap the
  small fetch phase: among the traced subset, delay-1 has `instDeltaCycles`
  `1..6` populated and `instDeltaCycles - TS targetOffset` values around
  `-4..5`. Therefore command-side opcode-fetch delta is also too broad as a
  promotion rule by itself. The combined YM+POKEY 1410 report records the same
  command diagnostics but has one POKEY native-sample timing outlier at frame
  `1306` (`PC 0x8e54`, command `0x07@0x8120`), so use the YM-only artifact as
  the decision-quality fetch-context split and keep POKEY timing on its own
  residual track.
  The follow-up trace now also records the first sound-CPU opcode fetch after
  each MAME command in two forms: callback order (`nextInst*`) and chronological
  non-negative sound time (`nextChronoInst*`). Artifact
  `chip-write-diff-current-preset-command-chronofetch-1410-ymonly.json`
  remains green for YM (`43051/43051`, `0` mismatches) and gives fetch context
  for all `676` traced commands. It rejects another tempting rule: all `10`
  delay-0 overrides have `nextChronoInstDeltaCycles` in `0..4`, but delay-1
  commands in the same traced subset also heavily occupy that same range
  (`0=235`, `1=187`, `2=128`, `3=81`, `4=10`, `5=25`). The relation between
  MAME `nextChronoInstPc` and the TS submit step is also non-unique: delay-0
  is mostly `other` (`8/10`), while delay-1 is also mostly `other` (`599`
  traced commands). Therefore neither "first chronological fetch after command
  is within a few cycles" nor "MAME resumes at/near the TS next PC" explains
  the wildcard delay-0 selectors. The current evidence points past simple
  fetch-phase rules toward modeling MAME's cross-CPU scheduler catch-up around
  these injected command bursts.
- Same-run `$1820` status capture is now available in
  `oracle/mame_pokey_write_tap.lua` via `MARBLE_SOUND_STATUS_OUT`,
  `MARBLE_SOUND_STATUS_FULL=1`, and `MARBLE_SOUND_STATUS_MAX_READS`. The
  900-frame same-run control
  `mame_status_inject001f_900_samerun_full.json` recorded `260851` status
  reads and one compressed base run. Replaying it by read index does not move
  the POKEY mismatch: `payload-pokey-900-statusbase.json` applies `260797`
  reads with `0` base mismatches and still fails at index `11562`; full-value
  replay has `5057` value mismatches and still fails at the same POKEY write.
  This rejects `$1820` status value replay as the cause of the frame-861
  POKEY payload mismatch.
- Focused RAM tracing now exists for both window probes:
  `MARBLE_SOUND_TRACE_RAM` in `oracle/mame_sound_window_trace.lua` and
  `--trace-ram` in `packages/cli/src/probe-sound-window-trace.ts`. The focused
  `860..862` RAM trace proves the bad POKEY values come from IRQ/order phase,
  not POKEY DSP: MAME runs the `$8ccc/$8cd2` zeroing path for `$055f/$055e`
  before the `0x8e20` POKEY reg `4/6` copy at frame `861` cycle
  `28170/28184`, so it writes zero; TS runs the `0x8e20` copy at frame `861`
  cycle `6706/6720` before its later `$8ccc/$8cd2` zeroing at
  `17847/17855`, so it writes `$79/$51`.
- Timer A diagnostics narrow the same bug but are not promotable. A broad
  `--timer-a-start-delay 512` sweep reduces the 900-frame same-run POKEY diff
  from `4` payload mismatches to `2`, but the first pair is still TS
  `$79/$51` vs MAME zero at index `11562`. The new opt-in
  `--timer-a-hold-while-overflow` control is rejected: it worsens the baseline
  to `16` mismatches and does not improve the `512`-delay case. The promoted
  fix is not a Timer A phase delay: status latching is now gated on the YM timer
  enable bit, and long same-run replay uses a one-instruction command-NMI
  latency.
- `probe-sound-sample-diff.ts` now streams SoundChip POKEY resampling when
  POKEY channel diagnostics are off. This removes the full-clock native-buffer
  blocker for long CLI replays: the 14000-frame streaming run
  `current-runtime-pokey-streaming-probe/replay14000-fullclockpokey-source-mix-hop4096-gate.json`
  simulated `410846534` native POKEY samples with `--pokey-sample-cycles 1`
  while storing only output-rate PCM, and still passed all `849` selected
  corrected-WAV windows at worst correlation `0.97668`, lag `0`, RMS `0.00318`,
  and maxAbs `0.01620`. Those windows are all YM-dominant, so this is a memory
  and regression gate, not proof of long POKEY-audible parity.
- POKEY PCM clock is now tied to the MAME `marble -listxml` device clock
  (`1789772`, so `/28 = 63920.428571...`) instead of the fractional
  `14_318_181 / 8` value. This fixes a current regression in direct POKEY
  timing evidence: the direct mixed `POKEY+3` rerun improved from maxAbs
  `0.07029` under the fractional clock to `0.05193` with the MAME-listed
  clock. It still does not recover the old strict direct artifact, so that
  artifact is stale until the remaining current direct POKEY/mixed residual is
  explained.
- A current direct POKEY residual isolation on `inject0005` is green only as a
  local phase diagnostic. With full MAME minus direct TS YM as the oracle,
  `--pokey-resample-offset -1 --pokey-output-sample-offset 3` passes `21`
  selected POKEY-residual windows in
  `pcm-diff-inject0005-760-direct-pokey-fullminusym-resample-neg1-out3-current.json`
  at worst correlation `0.99907`, lag `1`, RMS `0.00241`, and maxAbs
  `0.03350`. The matching full direct mix still fails
  (`pcm-diff-inject0005-760-direct-mix-ym-lofi-pokey-linear-pokeyresample-neg1-out3-current.json`:
  worst correlation `0.99892`, RMS `0.00452`, maxAbs `0.07407`), so the
  residual is split between POKEY phase and YM/mixed interaction.
- The same `-1/+3` POKEY resample/output phase is rejected by the broader
  YM-muted `inject001f` direct POKEY oracle:
  `pcm-diff-inject001f-1700-pokey-mame-write-timed-resample-neg1-out3-strict-current.json`
  fails the strict 205-window gate with worst correlation `0.9991`, far
  periodic lag `616`, RMS `0.00235`, and maxAbs `0.04392`. Keep this phase as
  a local `inject0005` diagnostic; do not promote it over the exact-clock
  direct POKEY baseline or broader current evidence.
- Re-running the old direct `--pokey-write-cycle-offset -1` strict artifact on
  the current code makes it stale: the overwritten
  `pcm-diff-inject001f-1700-pokey-write-offset-m1-strict-pcm-gate.json` now
  fails with worst correlation `0.99769`, far lag `1314`, RMS `0.00381`, and
  maxAbs `0.05604`. A bounded-lag current baseline at offset `0`
  (`pcm-diff-inject001f-1700-pokey-mame-write-timed-current-baseline-lag12.json`)
  also fails the loose gate with worst correlation `0.99738`, lag `4`, RMS
  `0.00417`, and maxAbs `0.06182`.
- Current direct POKEY write-cycle sweep `-3..+3`
  (`/tmp/marble-love/audio-bitperfect/current-pokey-offset-sweep/`) is useful
  only as a tap/update-boundary diagnostic. With loose thresholds and
  `--max-lag 12`, `-3` is best in this rerun (`corr=0.99825`, lag `4`,
  RMS `0.00341`, maxAbs `0.04447`, global gain RMS `0.00211`), followed by
  `-2`, `-1`, and `0`. This contradicts the old promotion story for a fixed
  `-1` cycle rule; do not change SoundChip replay defaults from this sweep.
- MAME POKEY source shows the legacy stream is allocated at full `clock()`, not
  `/28`. The broad YM-muted `inject001f` direct POKEY gate now passes when the
  direct POKEY-only render converts MAME write timestamps with the MAME-listed
  POKEY device clock (`1789772`) instead of the fractional cmd-tape CPU clock.
  Artifact
  `current-pokey-clockrate-sanity/inject001f-pokey-samplecycles1-mamelofi-pokeyclock-allwindows-gate.json`
  uses `--pokey-sample-cycles 1`, `--pokey-resampler mame-lofi`, no
  `--pokey-write-cycle-offset`, and passes all `205` POKEY-dominant windows:
  worst correlation `0.999975`, worst lag `0`, worst RMS `0.000462`, and worst
  maxAbs `0.006613`.
- The prior `--pokey-write-cycle-offset -8` result is now explained as a
  timebase compensation: at the old fractional-vs-integer clock delta, the
  sample-569380 spike landed about `7.4` POKEY cycles off by that point in the
  run. Keep `--pokey-write-cycle-offset` as a tap/update-boundary diagnostic,
  not a POKEY hardware rule.
- Direct MAME-write mixed rendering now uses the same POKEY device-clock
  timebase whenever YM is scheduled by `mame-stream`, because the cycle loop is
  then only advancing POKEY while YM writes land by MAME sample index. The short
  forced `inject0005` direct mixed gate improves from the old POKEY-linear
  `+3` diagnostic (worst RMS `0.00140`, maxAbs `0.01616`) to a full-clock
  POKEY/MAME-LoFi pass with no POKEY output offset:
  `current-pokey-clockrate-sanity/inject0005-direct-mix-ymlofi-pokeyfullclock-lofi-pokeyclock.json`
  passes all `37` audible windows at worst correlation `0.999966`, lag `0`,
  RMS `0.000456`, and maxAbs `0.003888`.
- The same integer-clock idea was explicitly rejected for live SoundChip
  replay. A temporary fractional POKEY clock-domain accumulator in
  `tickSoundDevicesRaw` made the forced `inject0005` replay collapse
  (`current-runtime-pokey-clockdomain-sanity/inject0005-runtime-mix-linear-phase-after-pokeyclockdomain.json`:
  worst correlation `0.8806`, lag `1145`, RMS `0.03575`, maxAbs `0.21510`;
  YM-muted POKEY full-clock replay fell to correlation `0.2262`). The change
  was reverted, and the restored replay baseline
  `current-runtime-pokey-clockdomain-sanity/inject0005-runtime-mix-linear-phase-after-pokeyclockdomain-rejected-rerun-restored.json`
  again passes at worst correlation `0.9936`, lag `3`, RMS `0.00526`, and
  maxAbs `0.08300`. Keep the POKEY device-clock conversion scoped to direct
  MAME-write rendering until replay timing has separate proof.
- MAME source audit supports that caution: write taps call the tap before the
  real handler, while `pokey_device::write` schedules `sync_write` and
  `write_internal` later. Therefore TS direct-write offsets compare tap time
  against update/application time; they are not yet hardware replay rules.
- `probe-sound-sample-diff.ts` reports now include a top-level `probe` block
  with argv, cwd, windowing, lag, padding, and audible-threshold metadata so
  future strict/loose artifacts can be reproduced without guessing the command.
- `resampleMameLofi` and the streaming renderer now accept diagnostics-only
  native resample offsets, and browser `soundReplay` exposes
  `soundReplayPokeySampleCycles=<n>`. The browser replay path now forwards
  `getPokeySampleRate(chip)` to the renderer, so `soundReplayPokeySampleCycles=1`
  can mirror the direct POKEY per-clock diagnostic without touching
  `packages/web/src/main.ts`.
- The older forced runtime POKEY+3 and `--pokey-write-apply-delay 112` notes
  are now historical unless paired with their exact artifact. Re-running them
  on the current code fails the tight gate: POKEY+3 alone misses RMS
  (`0.00707 > 0.0067`), and `--pokey-write-apply-delay 112` with
  `--reset-release-delay 19` collapses on mixed/POKEY windows (worst
  correlation about `0.756`, lag `1910`). Use the `-0.75/+3` POKEY resampler
  diagnostic above as the current short mixed PCM gate.
- The default full `source=ym` PCM replay without the key-on boundary
  diagnostic remains red only on tight lag/maxAbs thresholds, not on write
  order: worst correlation `0.9804`, worst lag `52`, worst maxAbs `0.03846`.
  Direct MAME-write rendering of the same bad window fails the same way until
  the direct `0x8fcc/0x78:+1 sample` diagnostic is applied, so the residual is
  YM DSP/sample-boundary behavior, not 6502 replay ordering.
- Added a target-native-sample diagnostic to the write-diff event report.
  `chip-write-diff-14000-ym-resetdelay25-embeddedreplyack-coinbase-fullmame-keyon78-targetsample1-eventreport.json`
  computes how many TS cycles each selected event would need to land at
  `MAME native sample + 1`, matching the direct MAME-write key-on boundary
  hypothesis. For the 38 `PC 0x8fcc reg 0x08 val 0x78` key-ons, default replay
  is `-24..-5` cycles early with native sample deltas `{0:23,-1:15}`; the
  target offset range is variable (`11..56` cycles, mean `30.13`). This proves
  the broad `+48` replay offset is a diagnostic compensation across event-cycle
  skew and sample-boundary latency, not a constant hardware rule to promote.
- The target-native-sample replay experiment rejects a key-on-only rule. A full
  PCM run using exact frame-specific offsets for `MAME+1 sample`
  (`pcm-diff-replay-14000-resetdelay25-embeddedreplyack-coinbase-default-mamestream-ymreg18offset1-keyon78-targetsample1-sourceym-hop4096-gate.json`)
  still fails at worst lag `52` and maxAbs `0.03913`. `MAME+2 sample`
  improves the `4509696` window locally but full-run
  `pcm-diff-replay-14000-resetdelay25-embeddedreplyack-coinbase-default-mamestream-ymreg18offset1-keyon78-targetsample2-sourceym-hop4096-gate.json`
  still fails at worst lag `53` and maxAbs `0.02898`. A focused sweep on
  window `4546560` (`pcm-keyon-target-sweep-window4546560.tsv`) shows targets
  `0` and `3` pass while targets `1` and `2` fail. The residual therefore
  depends on the surrounding YM write burst and prepare/update ordering, not
  just the `reg 0x08` key-on timestamp.
- Retested the exact `MAME+1 sample` key-on list with the same
  `--lag-tie-correlation-epsilon 0.01` used by the current green diagnostic.
  It still fails the full `849`-window gate:
  `pcm-diff-replay-14000-resetdelay25-embeddedreplyack-coinbase-default-mamestream-ymreg18offset1-keyon78-targetsample1-lagtie001-sourceym-hop4096-gate.json`
  reports worst correlation `0.9715`, worst lag `51`, worst RMS `0.00318`,
  and worst maxAbs `0.01877`. The failure is now lag-only under current
  thresholds, which narrows the problem to YM phase/envelope timing rather than
  simple amplitude error.
- Audited MAME/ymfm OPM stream ordering (`ymfm_fm.ipp`, `ymfm_opm.*`) and
  rejected the simple phase-order hypothesis: MAME clocks/updates FM state
  before output, TS is already broadly aligned, and the diagnostics-only
  `--ym-phase-advance-after-output` run worsens the focused shape instead of
  explaining the replay residual.
- Added a SoundChip replay sample-unit diagnostic:
  `SoundChipConfig.ymWriteEventSampleOffsetMatches` and CLI
  `--ym-write-event-sample-offset-matches frame:pc:reg:val:delta`. It changes
  only the `mame-stream` sample target before a selected YM data write is
  applied; drained chip-write timestamps and CPU/register state stay unchanged.
  Focused sweep on window `4546560` shows `*:0x8fcc:0x08:0x78:-1` is the best
  local replay sample offset (`corr=0.9868`, lag `1`, RMS `0.00160`, maxAbs
  `0.00457`), while `+1/+2` reproduce the poorer target-sample shape. The
  full 14000-frame broad `-1` run improves amplitude but still fails on lag
  (`worstCorr=0.9777`, worstLag `51`, worstMaxAbs `0.01846`), so it is useful
  evidence but not a replacement for the current `+48` cycle diagnostic.
- Layering the sample-offset diagnostic on top of the current broad `+48`
  cycle diagnostic flips the local best polarity and improves the full source-YM
  gate. Focused window `4546560` improves from `+48` plus sample offset `0`
  (`corr=0.9903`, lag `1`, maxAbs `0.00573`) to `+48` plus sample offset `+1`
  (`corr=0.9974`, lag `2`, maxAbs `0.00254`). Full report
  `pcm-diff-replay-14000-resetdelay25-embeddedreplyack-coinbase-default-mamestream-ymreg18offset1-keyon78p48-sampleoffset1-lagtie001-sourceym-hop4096-gate.json`
  passes all `849` selected source-YM windows with worst correlation `0.9958`,
  worst lag `2`, worst RMS `0.00319`, and worst maxAbs `0.01609`. This is the
  strongest current source-YM replay diagnostic. The matching `source=mix`
  artifact
  `pcm-diff-replay-14000-resetdelay25-embeddedreplyack-coinbase-default-mamestream-ymreg18offset1-keyon78p48-sampleoffset1-lagtie001-sourcemix-hop4096-gate.json`
  passes with the same summary, but all selected windows remain YM-dominant
  (`pokey=0`). This remains a stacked compensation on the same key-on selector,
  not a promoted hardware rule or POKEY-audible mixed proof.
- Current controls reject two simpler replacements for that stacked selector.
  A global YM post-resample output offset layered on the `+48/+1` diagnostic
  worsens the full `849`-window source-YM gate: `ymOutput=-2` fails at RMS
  `0.01641` and maxAbs `0.07569`, `ymOutput=-1` fails at RMS `0.00932` and
  maxAbs `0.04079`, and `ymOutput=+1` fails at RMS `0.00661` and maxAbs
  `0.03143`. Broadening the selector from `PC 0x8fcc reg 0x08 val 0x78` to
  all `PC 0x8fcc reg 0x08` writes is also rejected:
  `current-ym-output-offset-sanity/replay14000-pc8fcc-reg08-anyval-p48-sample1-sourceym.json`
  fails hard with worst correlation `0.7783`, RMS `0.01570`, and maxAbs
  `0.12426`. The residual is therefore specific to the repeated `val 0x78`
  key-on/update class, not a global stream offset or all writes to YM key-on
  register `0x08` at that PC.
- TS now also mirrors ymfm's broad cache invalidation on YM data writes:
  `ym2151WriteData` marks all channels modified before applying the register
  side effect, matching `fm_engine_base::write`/`engine_mode_write`. This is a
  hardware-faithful cleanup. The earlier `current-ym-mark-all-sanity/`
  artifacts were captured before the absolute-origin drain fix and are now
  useful only as controls: mark-all alone did not close the old lag-52
  residual, while the current default replay does.
- The browser `soundReplay` workbench can now mirror the current CLI default
  without touching `packages/web/src/main.ts`: `soundReplayYmStreamAbsoluteOrigin=1`,
  `soundReplayYmWriteEventCycleOffsetRegs=0x18:1`,
  `soundReplayYmResampler=mame-lofi`, and
  `soundReplayPokeyResampler=mame-lofi`. The older
  `soundReplayYmWriteEventCycleOffsetMatches=*:0x8fcc:0x08:0x78:48` and
  `soundReplayYmWriteEventSampleOffsetMatches=*:0x8fcc:0x08:0x78:1` controls
  remain parsed in `packages/web/src/sound-replay.ts`, but are no longer
  required for the corrected Coin 1 gate.
- Burst reports around the red windows are now repeatable. Frame `5661`
  (`chip-write-diff-5664-ym-resetdelay25-embeddedreplyack-coinbase-burst-frame5661-eventreport.json`)
  shows the `0x8eeb/0x8fac/0x8fcc` burst is `24` cycles early and one native
  YM sample early for the selected writes; aligning the whole burst to targets
  `0..3` does not change the focused `4546560` PCM window because that window's
  peak is later. Frame `5691`
  (`chip-write-diff-5694-ym-resetdelay25-embeddedreplyack-coinbase-burst-frame5691-eventreport.json`)
  shows parameter writes one native sample early but the `0x8fcc/0x78` key-on
  already at native sample delta `0`. Focused PCM experiments show a single
  frame-`5671` `MAME+1` key-on shift is the first sensitive local event
  (`corr=0.9530`, still passing), and the `5671+5681` cluster reproduces the
  poorer `corr=0.9715` shape while still passing locally. The remaining
  failure is therefore accumulated phase/envelope state across the repeated
  key-on cluster, not a missing ordered chip write or a local parameter-burst
  offset.

Coin/status replay checkpoint (2026-05-23 continuation):

- Traced the frame-5735 reply-value mismatch to a missing Coin 1 input pulse in
  TS cmd-tape replay, not to a global command/NMI/write-cycle offset. MAME's
  `coinFrame=1200` input is visible to the sound CPU from frame `1199` through
  `1213`; without that `$1820` bit-0 low window, TS kept `$27=0x00`, read
  `$31=0x00`, and wrote reply `$1810=0x00`.
- `loadCmdTape` now preserves `coinFrame`/`coinPulseFrames`, and
  `tickFrameWithTape` drives a replay-only `$1820` status-base override for
  the active Coin 1 pulse. `probe-sound-sample-diff.ts` now loads the full tape
  object instead of stripping it to `{cmds}` so PCM probes use the same input
  state as write-diff replay.
- Focused traces now match the causal zero-page state: TS writes `$27=0x01` at
  frame `1215` (`PC 0xe53e`) and frame `5735` reads `$31=0x01`, then writes
  reply `$1810=0x01`, matching MAME's reply value. Artifacts:
  `ts_sound_window_trace_0_1500_resetdelay25_embeddedreplyack_coinbase_zp2527_writes.json`,
  `ts_sound_window_trace_5734_5735_resetdelay25_embeddedreplyack_coinbase_fullpc_zp2231.json`,
  and
  `window-trace-diff-5734-5735-resetdelay25-embeddedreplyack-coinbase-fullpc-zp2231.json`.
- The ordered chip-write prefix gate is green with the promoted coin/status
  replay: YM `compare-count=1098` and `5000` both pass with `0` mismatches;
  POKEY `compare-count=2000` passes with `0` mismatches. The previously noted
  longer YM `45000` failure was against stale `mame_ym_writes.json`; see the
  full chip-write parity checkpoint above for the corrected oracle result.
- The 2000-frame `source=ym` PCM gate also stays green when run against the
  embedded-reply cmd tape carrying `coinFrame`: `117` selected audible windows,
  worst correlation `0.9980`, worst absolute lag `1`, worst RMS `0.00117`,
  and worst maxAbs `0.00677`. Artifact:
  `pcm-diff-replay-2000-resetdelay25-embeddedreplyack-coinbase-default-mamestream-ymreg18offset1-sourceym-hop4096-gate.json`.
- `probe-sound-window-trace` and the MAME window trace tap now support
  `trace-zp-mode=read|write|both`, and the window diff summarizes zero-page
  read/write groups with first mismatch samples. This keeps the `$25..$31`
  causal drill repeatable without producing unbounded trace JSON.

Replay command-boundary checkpoint (2026-05-23 continuation):

- Added `commandBoundaries` reporting to
  `packages/cli/src/probe-sound-window-trace-diff.ts`. Focused trace diffs now
  pair MAME `mainCmdWrite` with TS `cmdSubmit` and report byte, cycle, MAME
  `videoCycleInFrame`, TS `actualCycleInFrame`, and the sound CPU PC observed
  at the command boundary.
- Fresh full-PC trace pair `5660..5662` with reset-delay `25`, embedded reply
  ack, and rational MAME sound clock proves the key-on timing miss is not a
  store-bus bug. Artifact
  `window-trace-diff-5660-5662-resetdelay25-embeddedreplyack-fullpc-rational-aligncmd-commandboundary.json`
  reports ordered YM/POKEY payload parity and `pcToWriteDelta=0` for all paired
  writes. The frame-5661 `PC 0x8fcc, reg 0x08, val 0x78` key-on is fetched and
  written with the same local offset in both traces (`writeMinusFetch=3`), but
  TS is already `23` cycles early at the opcode fetch/write.
- The same trace shows the real upstream mismatch: command bytes and command
  cycle origins match, but the sound CPU PC at command submit does not. For
  frames `5660..5662`, MAME sees `soundPc` `0x8123,0x80ee,0xe507`, while TS
  sees `0x80f7,0x8ff8,0x810b`.
- The `5736..5738` trace confirms the pattern on the special frame-5737
  key-on. Artifact
  `window-trace-diff-5736-5738-resetdelay25-embeddedreplyack-fullpc-rational-aligncmd-commandboundary.json`
  shows `pcToWriteDelta=0`, key-on fetch/write delta `-15` cycles, and
  command-boundary `soundPc` mismatches on all three frames. Forcing `$1820`
  values from the MAME window as a diagnostic narrows YM write deltas from
  `-23..-5` to `-17..-13`, but command-boundary `soundPc` still mismatches.
  Status timing is involved, yet the next fix must align inter-command CPU
  state at cmd boundaries before promoting any key-on timestamp offset.
- Added `$1820` dynamic-bit classification to the trace diff. The preceding
  `5735..5736` trace now identifies the first causal branch as a
  sound-to-main pending bit miss: artifact
  `window-trace-diff-5735-5736-resetdelay25-embeddedreplyack-fullpc-rational-aligncmd-commandboundary-bitstatus.json`
  reports MAME `5735:162 PC 0x8103 = 0x97` versus TS
  `5735:223 PC 0x8103 = 0x87`, followed by MAME branching to `0x8120` while TS
  takes `0x8108`. TS reaches that poll after the embedded MAME main-reply ack
  has already cleared bit `0x10`.
- A diagnostics-only constant reply ack delay proves the axis but not the fix.
  With `--no-embedded-reply-ack --reply-ack-delay 112`, frame `5736`
  command-boundary `soundPc` improves from TS `0x8123` to `0x80f2` versus MAME
  `0x80f5`, and the early `$1820` value mismatch disappears. It remains
  non-promotable: frame `5735` still starts at the wrong PC, later status reads
  diverge, and a full 14000-frame key-on event report
  `chip-write-diff-14000-ym-native-sample-resetdelay25-replydelay112-noembedded-ymreg18offset1-keyon78-eventreport.json`
  lands the 38 target key-ons at native-sample deltas `{-1:18,0:19,2:1}`, not
  the direct-oracle target `{1:37,2:1}`.
- Added `replyHandshakes` reporting to the window-trace diff and TS
  `mainReplyAck` trace events. Artifact
  `window-trace-diff-5735-5736-resetdelay25-embeddedreplyack-fullpc-rational-aligncmd-replyhandshake.json`
  makes the failing handshake explicit: for frame `5735`, MAME writes reply
  `0x01` at cycle `125`, the main reads it at `195`, and the sound CPU polls
  `$1820=0x97` once before the ack. TS writes reply `0x00` at cycle `115`,
  schedules the same embedded ack at `195`, and reaches the matching `$8103`
  poll only at `223`, after bit `0x10` has cleared. Sweeps of
  `--command-nmi-boundary-delay-instructions 0..8` and a targeted
  `--command-cycle-offset 33` are rejected: they do not fix the reply value,
  and either keep or move the pending-poll mismatch. The next fix should trace
  why the interrupted NMI handler produces reply `0x00` in TS versus `0x01` in
  MAME, rather than adding another global NMI/command offset.

Replay key-on sample-boundary checkpoint (2026-05-23 continuation):

- Added `--event-delta-report-matches frame:pc:reg:val` to
  `packages/cli/src/probe-chip-write-diff.ts`. It reports selected ordered
  write deltas, native YM sample deltas, histograms, and sample rows, so
  focused timing hypotheses can be verified by the write-diff gate instead of
  ad hoc JSON filtering.
- The previous live replay hypothesis
  `*:0x8fcc:0x08:0x78:+32,5737:+32` is proven incomplete. The event report
  shows the 38 `PC 0x8fcc, reg 0x08, val 0x78` key-ons land at native sample
  deltas `{0:15,1:22,2:1}` relative to MAME, while the direct oracle target is
  `{1:37,2:1}`. A fixed cycle offset cannot hit all 38 key-ons.
- A targeted diagnostic offset list reaches that sample target exactly:
  broad `*:0x8fcc:0x08:0x78:+48`, frame `5737:+12`, and frame-specific
  corrections for `1686:-12`, `2147:-9`, `5614:+7`, `5661:+8`, `5671:+1`,
  and `5702:-5`. Artifact
  `chip-write-diff-14000-ym-native-sample-resetdelay25-ymreg18offset1-keyon78p48-targeted-eventreport.json`
  reports `compared=38`, `nativeSampleDeltaHistogram {1:37,2:1}` for
  `*:0x8fcc:0x08:0x78`, and `{2:1}` for frame `5737`.
- With those diagnostic offsets, full 14000-frame source-YM replay over 849
  MAME-audible windows nearly passes with pure best-correlation lag selection:
  worst correlation `0.9889`, worst lag `16`, worst RMS `0.00318`, worst
  maxAbs `0.01610`. The only failing condition is the lag threshold on a
  periodic late window.
- Enabling the probe's existing periodic-signal tie-breaker
  `--lag-tie-correlation-epsilon 0.01` makes the same replay source-YM gate
  pass: artifact
  `pcm-diff-replay-14000-resetdelay25-embeddedreplyack-ymstreamabsolute-rationalclock-ymreg18offset1-keyon78p48-targeted-lagtie001-sourceym-hop4096-gate.json`
  reports `passed=true`, 849 selected windows, worst correlation `0.9889`,
  worst lag `1`, worst RMS `0.00318`, and worst maxAbs `0.01610`. This is a
  diagnostics-only replay timing proof; it is not yet a promoted hardware rule,
  does not prove POKEY-audible parity, and does not complete bit-perfect audio.

Direct key-on sample-boundary checkpoint (2026-05-23 overnight):

- Added direct MAME-stream-only PCM diagnostics in
  `packages/cli/src/probe-sound-sample-diff.ts`:
  `--direct-ym-write-sample-offset`,
  `--direct-ym-write-sample-offset-regs`, and
  `--direct-ym-write-sample-offset-matches frame:pc:reg:val:delta`. These
  shift direct MAME YM-write sample indices only; they are rejected outside
  direct chip-write `--ym-scheduler mame-stream` mode and do not change the
  SoundChip replay/runtime path.
- Direct MAME YM still rejects broad timing hacks. The default full 14000-frame
  direct source-YM gate fails near the frame-5661/5737 key-on cluster, while
  `--ym-phase-advance-after-output` is a non-promotable compensating diagnostic
  because MAME/ymfm clocks phase/envelope before output. A global
  `--direct-ym-write-sample-offset 1` and broad `reg 0x08:+1` key-on shift fix
  one late window but break the earlier frame-5479 `val 0x7b` burst.
- The direct oracle gate is now green with a narrow sample-boundary diagnostic:
  `--direct-ym-write-sample-offset-matches "*:0x8fcc:0x08:0x78:1,5737:0x8fcc:0x08:0x78:1"`.
  Full 14000-frame source-YM direct MAME-stream report
  `pcm-diff-direct-mameym-14000-default-mamestream-directym-keyon78p1-frame5737extra1-sourceym-hop4096-gate.json`
  passes across 849 selected audible windows with worst correlation `0.9889`,
  worst lag `2`, worst RMS `0.00316`, and worst maxAbs `0.01558`.
- The same diagnostic also passes the full direct MAME YM+POKEY mix report
  `pcm-diff-direct-mamechips-14000-default-mamestream-directym-keyon78p1-frame5737extra1-mix-hop4096-gate.json`
  with the same summary; selected windows are YM-dominant and POKEY remains
  effectively silent in this audible set.
- Translating the same hypothesis into live replay cycle offsets is still red:
  the SoundChip replay report with matching key-on cycle offsets
  `pcm-diff-replay-14000-resetdelay25-embeddedreplyack-ymstreamabsolute-rationalclock-ymreg18offset1-keyon78p32-frame5737extra32-sourceym-hop4096-gate.json`
  fails at worst correlation `0.9747`, worst lag `52`, and worst maxAbs
  `0.03913`. The direct DSP/mixer oracle is isolated; replay CPU/write phase
  remains the open blocker.

MAME-stream sample-rate checkpoint (2026-05-23):

- Direct YM rendering from the MAME write log shows that the WAV oracle path is
  aligned to a `55930` Hz YM stream cadence, while the current YM DSP tables
  still use `55930.375` internally. Using the fractional DSP rate for
  `mame-stream` scheduling breaks the first source-YM window at output sample
  `1265664` (`correlation 0.340..0.515`, lag hundreds/thousands of samples).
  The CLI/engine now keep those rates separate via
  `YM2151_MAME_STREAM_SAMPLE_RATE = 55930`.
- With the default `mame-stream` rate (no `--ym-native-sample-rate` override),
  direct MAME YM rendering of window `1265664` is green: lag `0`,
  correlation `1.0000`, RMS `0.00018`, maxAbs `0.00040`
  (`pcm-diff-direct-mameym-window1265664-default-mamestream-sourceym.json`).
  The live SoundChip replay of the same window is also green with the corrected
  Coin 1 cmd tape, `reset-release-delay 25`, absolute YM stream origin, and the
  diagnostic `0x18:+1` offset: lag `-1`, correlation `1.0000`, RMS `0.00055`,
  maxAbs `0.00188`
  (`pcm-diff-replay-window1265664-resetdelay25-cmdcoin-default-mamestream-ymreg18offset1-sourceym.json`).
- The 2000-frame source-YM gate is green with the same defaults:
  `pcm-diff-replay-2000-resetdelay25-cmdcoin-default-mamestream-ymreg18offset1-sourceym-hop4096-gate.json`
  reports 117 selected audible windows, worst correlation `0.9980`, worst lag
  `1`, worst RMS `0.00107`, worst maxAbs `0.00546`.
- Full 14000-frame source-YM replay still fails the strict gate:
  `pcm-diff-replay-14000-resetdelay25-cmdcoin-default-mamestream-ymreg18offset1-sourceym-hop4096-gate.json`
  reports 849 selected audible windows, worst correlation `0.9533`, worst lag
  `52`, worst RMS `0.00449`, worst maxAbs `0.05129`. Direct MAME YM is green at
  `4382720` (lag `0`, correlation `0.9994`, maxAbs `0.00610`), while direct TS
  YM reproduces the replay failure there, so the remaining blocker is TS
  write-timestamp phase, not DSP or resampling.

Clock/DSP replay checkpoint (2026-05-23 overnight):

- Promoted the MAME System 1 sound CPU clock used by cmd-tape timestamp
  conversion from the rounded integer `1_789_772` to the exact driver clock
  `14_318_181 / 8 = 1_789_772.625`. This removes the long-run monotonic drift
  seen in Timer A/music-update writes: the frame-5479 `0x8fac/0x8fcc` burst
  moved from roughly `+37` replay cycles late to the low tens of cycles around
  MAME. `sound-chip-diagnostics.test.ts` now locks the rational conversion.
- With the rational clock, `reset-release-delay 25`, absolute YM stream origin,
  and the existing diagnostic `0x18:+1` LFO write offset, the first 2000-frame
  source-YM gate is green across 117 audible windows: worst correlation
  `0.9980`, worst lag `1`, worst RMS `0.00117`, worst maxAbs `0.00677`.
  Artifact:
  `pcm-diff-replay-2000-resetdelay25-embeddedreplyack-ymstreamabsolute-rationalclock-ymreg18offset1-sourceym-hop4096-gate.json`.
- The previous full-run blocker at output sample `4382720` is no longer a lag
  problem under the rational clock plus delay `25`: correlation `0.9993`, lag
  `0`, RMS `0.00054`, maxAbs `0.01620`
  (`pcm-diff-replay-window4382720-resetdelay25-embeddedreplyack-ymstreamabsolute-rationalclock-ymreg18offset1-sourceym.json`).
- Full 14000-frame source-YM replay is still not closed. All 849 audible
  windows now keep correlation above `0.980`, but windows around output samples
  `4526080..4558848` fail the strict lag/maxAbs gate (worst lag `52`, worst
  maxAbs `0.03846`). Artifact:
  `pcm-diff-replay-14000-resetdelay25-embeddedreplyack-ymstreamabsolute-rationalclock-ymreg18offset1-sourceym-hop4096-allwindows-gate.json`.
- Direct MAME YM rendering fails at the same late window unless the existing
  diagnostic `--ym-phase-advance-after-output` is enabled; with that flag,
  direct MAME YM improves to lag `1`, correlation `0.9910`, maxAbs `0.00754`.
  Direct TS YM still fails there because TS write timing is about `14..28`
  cycles early around frame `5661`. A global key-on delay is rejected: it fixes
  the frame-5661 window but breaks the earlier frame-5479 window. Keep key-on
  offsets diagnostic-only until a hardware rule is justified.

Focused YM LFO timing checkpoint (2026-05-23 late):

- Added diagnostics-only YM stream/write controls: `ymStreamCycleOffsetCycles`
  preserves the fractional absolute MAME stream phase for
  `--ym-stream-absolute-origin`, `--ym-write-event-cycle-offset-regs` can move
  selected YM registers, and `--ym-write-event-cycle-offset-matches` can move a
  single `{frame, pc, reg, val}` write timestamp. Defaults preserve current
  runtime/replay behavior.
- The previous direct-render bisection is now reproduced in the live replay
  path. With `--ym-scheduler mame-stream --ym-stream-absolute-origin`, the
  focused source-YM window at output sample `1265664` matches the direct TS
  write-log failure (`correlation 0.4366`, lag `241`). Moving the critical
  LFO-frequency write later by one or more cycles crosses the native YM stream
  sample boundary and makes the same live SoundChip replay window effectively
  green: correlation `1.0000`, lag `0`, RMS `0.00018`, maxAbs `0.00040`.
  Artifact:
  `pcm-diff-replay-window1265664-resetdelay22-embeddedreplyack-ymstreamabsolute-cycleorigin-ymmatch375-9443-18-be-plus1-sourceym.json`.
- The exact write is YM2151 LFO frequency (`reg 0x18`, value `0xbe`) at frame
  `375`, PC `0x9443`. With the corrected absolute stream phase, a global
  `--ym-write-event-cycle-offset-regs 0x18:+1` also passes the first 2000-frame
  source-YM gate across 117 selected audible windows: worst correlation
  `0.9988`, worst lag `1`, worst RMS `0.00107`, worst maxAbs `0.00546`.
  Artifact:
  `pcm-diff-replay-2000-resetdelay22-embeddedreplyack-ymstreamabsolute-cycleorigin-ymreg18offset1-sourceym-hop4096-gate.json`.
  `0x18:+2` is rejected on the focused window (`correlation 0.7639`, lag
  `-558`), so this is a one-native-sample boundary issue, not a broad LFO
  delay. The next fix should justify whether `reg 0x18:+1` is a MAME-stream
  timing rule or whether a deeper CPU/bus timestamp rule should replace the
  diagnostic offset before browser promotion.
- Full-run source-YM replay is not closed yet. The 14000-frame corrected Coin 1
  gate with absolute YM stream phase and `0x18:+1` still fails:
  `pcm-diff-replay-14000-resetdelay22-embeddedreplyack-ymstreamabsolute-cycleorigin-ymreg18offset1-sourceym-hop4096-gate.json`
  reports `849` selected audible windows, worst correlation `0.9464`, worst
  lag `53`, worst RMS `0.00483`, and worst maxAbs `0.05451`. Direct rendering
  the matching TS YM write log reproduces the same bad window at sample
  `4382720`, while direct rendering the MAME YM log stays green, so this is
  again write timing/phase, not DSP payload.
- Hybrid bisection of the second bad window narrows the next timing blocker to
  frame `5479`, write indices `145040..145044`. MAME timing from index
  `145040` onward is green (`correlation 0.9996`, maxAbs `0.00867`), while
  MAME timing only from `145045` onward is red (`correlation 0.8487`, maxAbs
  `0.09729`). The responsible burst is four `PC 0x8fac` operator writes
  (`reg 0x7b/0x73/0x6b/0x63`) followed by key-on `reg 0x08 val 0x7b` at
  `PC 0x8fcc`; TS is about `36` cycles later than MAME there. Moving just the
  key-on or applying broad PC/register offsets did not reproduce the green
  hybrid result, and `--command-cycle-offset -36 --command-cycle-offset-start-frame 5468`
  also leaves the focused window red. The next useful drill is the CPU/replay
  phase source of that frame-5479 update burst, not another global key-on
  constant.

Replay timing diagnostics checkpoint (2026-05-23 late):

- Added diagnostics-only replay controls:
  `--command-nmi-boundary-delay-instructions` in `tickFrameWithTape` and the
  focused audio probes, plus `--command-cycle-offset` /
  `--command-cycle-offset-start-frame` in the PCM/window-trace probes. Defaults
  preserve current replay behavior.
- Frame 1217 refreshed trace rejects a pure NMI-delay fix. With
  `resetReleaseDelay=22`, `commandNmiSampleCycle=0`, and boundary delay `1`,
  the local write timing improves (`YM writeCycleDelta 0..2`, mean `0.41`;
  `POKEY 0..1`, mean `0.50`) and payload stays green, but the PC stream is
  still phase-wrong at the boundary: MAME has fetched `0x80ee` while TS is
  still fetching `0x8138`, and TS adds `10` extra late status polls in the
  focused frame. Artifact:
  `window-trace-diff-1217-fullpc-resetdelay22-statusframe-embeddedreplyack-nmisample0-boundarydelay1-refreshed.json`.
- The new knobs are not promotable. On the baseline status-run gate,
  boundary delay `1` only moves YM native-sample mismatches from `6258/45942`
  to `6194/45942` and POKEY from `4892/31458` to `4837/31458`. A scoped
  `--command-cycle-offset 3 --command-cycle-offset-start-frame 1217` improves
  YM to `6153/45942` but leaves POKEY at `4845/31458`. Combining these or
  changing the PCM resampler to `linear` leaves the focused source-YM PCM
  window unchanged at correlation about `0.5743` and lag about `1352`
  (`1347` with linear).
- Direct rendering the TS YM write log reproduces the failed SoundChip replay
  window, while direct rendering the MAME YM log stays green. This keeps the
  blocker in CPU-produced YM write timing/phase, not in the browser/web
  resampler or the YM DSP core. The next useful drill is exact sub-sample
  write timing/instruction phase around the shared music-update path, not more
  global NMI, command-offset, or resampler constants.

Status-full replay checkpoint (2026-05-23):

- MAME full `$1820` status-read capture is now reproducible for the corrected
  Coin 1 2000-frame oracle:
  `/tmp/marble-love/audio-bitperfect/mame_status_reads_2000_coinpolarity_full.json`
  (`753424` reads), paired with
  `/tmp/marble-love/audio-bitperfect/mame_cmds_2000_coinpolarity_statusfull_replyack.json`
  (`1858` commands, embedded `1836` reply acks).
- `sound-status-replay.ts` now distinguishes status tape mode from status value
  mode. Existing `--status-tape-mode readIndex|frame` still controls read
  selection; new `--status-value-mode base|full` defaults to `base` and only
  forces the complete MAME `$1820` byte when explicitly set to `full`. Frame
  mode can also consume per-frame full status reads instead of only historical
  base runs. `probe-chip-write-diff.ts`, `probe-sound-sample-diff.ts`, and
  `probe-sound-window-trace.ts` expose the flag and report full-value
  mismatch counts.
- Full-value status replay is rejected as the current timing/PCM fix. Read
  index full-value consumes the complete tape but drifts reply acks
  (`scheduled=1771/1836` YM run) and worsens exact native-sample mismatches:
  YM `6628/45942`, POKEY `5180/31458`
  (`chip-write-diff-2000-ym-native-sample-resetdelay22-statusfull-readindex-fullvalue.json`,
  `chip-write-diff-2000-pokey-native-sample-resetdelay21-statusfull-readindex-fullvalue.json`).
  Frame full-value also worsens timing: YM `6703/45942`, POKEY `5194/31458`
  (`chip-write-diff-2000-ym-native-sample-resetdelay22-statusfull-frame-fullvalue.json`,
  `chip-write-diff-2000-pokey-native-sample-resetdelay21-statusfull-frame-fullvalue.json`).
  The focused source-YM PCM window remains unchanged at correlation `0.5743`,
  lag `1352`, RMS `0.07735`, maxAbs `0.23558` for both full-value modes
  (`pcm-diff-replay-window1265664-resetdelay22-statusfull-readindex-fullvalue-sourceym.json`,
  `pcm-diff-replay-window1265664-resetdelay22-statusfull-frame-fullvalue-sourceym.json`).
- The command-NMI sample-point sweep is also diagnostic-only. At reset delay
  `22`, `--command-nmi-sample-cycle 0/1` improves YM exact native-sample
  mismatches only from `6339/45942` to `6258/45942`; POKEY at reset delay
  `21` improves from `4941/31458` to `4892/31458`. The local source-YM PCM
  window stays unchanged. A frame-1217 sorted/aligned trace with opcode/state
  comparison shows `sample=0` can align the NMI handler entry cycle, but the
  interrupted CPU state is already different at `PC 0x9566`
  (MAME `A/X/Y/P/SP = cc/0c/01/b5/1ef`, TS `10/00/00/27/fc`). Continue from
  CPU/status/reply phase history before promoting more sample constants.

Corrected Coin 1 oracle checkpoint (2026-05-22):

- The prior long-run green chip-write reports are historical only. They used
  audio oracle scripts that drove MAME's `Coin 1` field with inverted logical
  polarity. Corrected MAME Lua input is `set_value(1)` while pressed and
  `set_value(0)` while released. The corrected command tape is
  `/tmp/marble-love/audio-bitperfect/mame_cmds_14000_coinpolarity.json`
  (`14647` commands, first divergence from the older tape at command index
  `1041`, frame `1217`).
- Corrected status evidence:
  `/tmp/marble-love/audio-bitperfect/mame_sound_status_runs_14000_coinpolarity.json`
  shows default `$1820` base `$87`, a Coin 1 pulse base `$86` from frame `1199`
  through the short pulse window, then `$87` again. The corrected YM/POKEY logs
  are `mame_ym_writes_14000_coinpolarity_full.json` (`375161` writes) and
  `mame_pokey_writes_14000_coinpolarity.json` (`257739` writes).
- Corrected ordered event gate is now green after the LS259 `write_d0` fix:
  TS matches MAME for all `375161` YM2151 writes and all `257739` POKEY writes
  over the full `14000`-frame corrected Coin 1 oracle. Promoted reports:
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-payload-order-coinpolarity-ls259fix.json`
  and
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-cycle300-frame1-coinpolarity-ls259fix.json`.
  The practical timing gate passes with `frameTolerance=1` and
  `cycleTolerance=300`; residual strict timing is still open with frame deltas
  `-1..0` and max replay-cycle deltas `295` YM / `288` POKEY.
- Root cause: TS treated `$1824=0x02` as a YM reset control. MAME's LS259 map
  is bit-addressed across `$1820-$1827`: address low bits select the latch bit
  and only data bit 0 is stored. Only LS259 bit 0 at `$1820` drives YM reset.
  The frame-1217 trace now shows TS taking the same Timer A service burst as
  MAME (`PC 0x81bb`, `YM reg 0x14 val 0x11`) with `64` YM writes and `18`
  POKEY writes in the focused frame.
- `probe-audioram-diff.ts` now reuses the cycle-precise cmd-tape path and
  supports `--status-tape` with read-index or frame-run mode. The stale
  frame-1217 "missing YM burst" branch is closed by the LS259 fix; future RAM
  drills should use the `coinpolarity-ls259fix` artifacts.
- PCM status: the historical attract WAV/tape pair remains green as an
  anti-regression with `--ym-scheduler mame-stream`; the all-window report
  `/tmp/marble-love/audio-bitperfect/pcm-diff-attract-ymstream-ls259fix-allwindows-hop4096.json`
  passes `minCorrelation=0.95` and `maxAbsLag=12` with worst correlation
  `0.9966`, worst lag `3`, worst RMS `0.00219`, and worst maxAbs `0.01954`.
  A matched MAME WAV run exists at
  `/tmp/marble-love/audio-bitperfect/mame-capture-ls259fix/mame_coinpolarity_14000.wav`;
  its generated cmd/status tapes are byte-identical to the corrected
  `coinpolarity` oracle files. The earlier direct-YM failure around frame
  `1570` is now closed: TS now clocks YM2151 LFO/noise with the ymfm/MAME
  shift-then-feedback order, fixing the waveform-3 PM burst on channel `2`
  (`reg 0x22 = 0xc5`, key-on `reg 0x08 val 0x7a`). Direct MAME-write rendering
  of the formerly bad window now passes both the POKEY-muted 2000-frame oracle
  and the full 14000-frame WAV:
  `pcm-diff-coinpolarity-ls259fix-pokeymuted-directym-window1265664-noiselfsraftershift.json`
  and
  `pcm-diff-coinpolarity-ls259fix-directym-window1265664-noiselfsraftershift.json`
  report correlation `0.9999876`, lag `-5`, RMS `0.0004218`, and maxAbs
  `0.001068`. A standalone ymfm stream render of the same MAME YM log also
  matches the MAME WAV at correlation `0.9999876` (lag `5`), confirming the
  DSP model is no longer the blocker for this window. The full SoundChip replay
  gate still fails after the DSP fix:
  `pcm-diff-coinpolarity-ls259fix-matchedwav-statusframe-ymstream-allwindows-hop4096-noiselfsraftershift.json`
  has `849` MAME-audible windows, worst correlation `0.3156`, worst absolute
  lag `1972`, worst RMS `0.09895`, and worst maxAbs `0.23945`. Because direct
  YM passes the same local window while replay fails it (`start=1265664`,
  correlation `0.5484`, lag `1896`), the open blocker is SoundChip replay
  YM timing/phase around frame `1570`, not ordered payload parity or YM DSP.
  Follow-up native-stream probes found replay/direct YM first diverging at
  relative native sample `908102` (around frame `1217`), when corrected Coin 1
  starts a dense YM rewrite burst. TS event payload/order still matches MAME,
  but under origin-phased native sample indexing most TS YM writes in the
  first 2000 frames land one sample early (`31226` at `-1`, `14358` at `0`,
  worst `-10`). Preclocking YM through reset silence and fixed write-cycle
  offsets did not close the frame-1570 window, so the next productive path is
  exact sub-sample/sub-instruction write timing rather than another global
  DSP or output-offset tweak.
  `probe-chip-write-diff.ts` now has an optional native-sample timing gate
  (`--sample-rate <hz>` / `--sample-tolerance <samples>`). The promoted
  2000-frame diagnostic
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-2000-ym-native-sample-coinpolarity-ls259fix-after-defaultpreemptfix.json`
  keeps reg/value/PC order matched but fails the exact YM sample gate:
  `30187` mismatches out of `45942` compared writes, `nativeSampleDelta`
  `min=-9`, `max=1`, `meanAbs=0.67`; the first mismatch is the boot Timer A
  control write at frame `244`, `PC 0x81a2`, where TS replay cycle `2559`
  maps one sample earlier than MAME replay cycle `2586`. The CLI probes also
  no longer pass a zero command-preemption lookahead into `tickFrameWithTape`;
  explicit `0` is now treated as disabled, matching the documented default.
  Command-cycle offset probes starting at the Coin 1 status window (`+20` and
  `-20` cycles from frame `1199`) did not improve the native-sample mismatch
  counts, so command target phase is not a standalone fix for this residual.
  Reset-release delay remains useful but not sufficient on the corrected Coin 1
  baseline. The first sweep found `--reset-release-delay 26` reduced the
  2000-frame YM native-sample mismatches from `30187` to `8728`, but the local
  PCM window still failed
  (`pcm-diff-replay-window1265664-resetdelay26.json`, correlation `0.5743`,
  lag `1347`). A refined real replay sweep over delays `18..26` now finds
  `22` as the native-sample minimum for both chips: YM `6689/45942`
  mismatches, `meanAbs=0.1499`, and POKEY `5123/31458`, `meanAbs=0.1651`.
  The phase sweep at delay `22` still only makes a small diagnostic dent
  (`6608` YM at phase `-30c`, `4986` POKEY at phase `-38c`), so a global
  sample-index origin is still not the fix. The same local PCM window with
  delay `22` is effectively unchanged
  (`pcm-diff-replay-window1265664-resetdelay22.json`, correlation `0.5743`,
  lag `1352`). Adding `--timer-a-start-delay 8` to the older delay-26 run
  improves the PCM lag to `274` but worsens native-sample mismatches to
  `18466`, so none of these options is a promotable default yet. The refreshed
  delay-22 clusters remain the shared music-update path: YM `0x8eaf` (`2115`
  mismatches), `0x8e9c` (`2043`), `0x81c3` (`1096`), and `0x81bb` (`1091`);
  POKEY clusters stay in `0x8e2x-0x8e6f`. Keep these options as diagnostics
  while the next fix targets the shared Timer A/music-update timing clusters
  instead of YM-only DSP. Follow-up controls on the corrected
  baseline reject the remaining easy knobs: deferring all chip writes to the
  estimated bus cycle with `--defer-chip-write-timing` destroys timing
  (`38065/45942` YM native-sample mismatches, meanAbs `138` samples), deferring
  only YM audio/parameter writes worsens the local PCM window to correlation
  `0.4272`, and `--command-nmi-sample-cycle 0/1/3` only moves the YM
  native-sample count within `8727..8731`. `probe-sound-window-trace.ts` and
  `probe-pc-cycles.ts` now accept `--status-tape-mode frame`, matching the
  current chip-write gate; the new frame-mode trace artifacts
  `ts_sound_window_trace_372_377_resetdelay26_statusframe.json` and
  `ts_pc_cycles_372_377_resetdelay26_statusframe.json` show
  `baseMismatches=0` for the focused first music-update window, so future PC
  drills should use those instead of read-index status trace variants.
  `probe-chip-write-diff.ts` also has an opt-in per-PC delta report
  (`--pc-delta-report`, `--pc-delta-report-pcs`) that does not require pairing
  full execution traces. Current reset-delay artifacts
  `chip-write-diff-2000-ym-pcdelta-resetdelay26.json` and
  `chip-write-diff-2000-pokey-pcdelta-resetdelay26.json` show the remaining
  dominant PCs have small net drift but noisy per-occurrence interval deltas:
  YM `0x8eaf/0x8e9c` compare `14594` writes each with drift `13` cycles and
  interval-delta meanAbs `1.29`, while `0x81bb/0x81c3` compare `7312` writes
  each with drift `18` and interval-delta meanAbs about `4`; POKEY
  `0x8e54/0x8e3c/0x8e62/0x8e68/0x8e6f` compare roughly `3492` writes each
  with drift `3..13` and interval-delta meanAbs about `4.5..4.8`. This points
  at recurring instruction/device phase jitter rather than a monotonic
  long-run clock drift. The report now accepts `--pc-delta-report-samples` and
  records first native-sample mismatches plus largest same-PC interval
  outliers. Refreshed sample artifacts
  `chip-write-diff-2000-ym-pcdelta-samples-resetdelay26.json` and
  `chip-write-diff-2000-pokey-pcdelta-samples-resetdelay26.json` show paired
  local slips that usually resynchronize on the next same-PC write. YM outliers
  include command-adjacent frame `641` and `1963` cases, both frames with an
  extra command byte `0x07`; POKEY outliers include paired `-80/+80` cycle
  slips across frames `529/530` and `593/594`. A corrected Coin 1 native-sample
  preemption check rejects the simple command-boundary shim as a default:
  `--command-preempt-chip-write-lookahead 3` only improves the 2000-frame YM
  mismatch count from `8728` to `8677`, while lookahead `6` and `24` worsen it
  to `8777` and `8811`. `probe-chip-write-diff.ts` now also has
  `--sample-phase-cycles` and `--sample-phase-sweep` diagnostics. The corrected
  Coin 1 reset-delay sweep rejects a global sample-index origin as the missing
  fix: `chip-write-diff-2000-ym-native-sample-phase-sweep-resetdelay26.json`
  only improves YM from `8728` to `8670` exact native-sample mismatches at
  phase `+2` cycles, and
  `chip-write-diff-2000-pokey-native-sample-phase-sweep-resetdelay26.json`
  only improves POKEY from `6673` to `6559` at phase `-11` cycles. The min/max
  deltas remain YM `-8..7` and POKEY `-5..6`, so the residual is still local
  instruction/device phase jitter. The probe now also accepts
  `--command-cycle-offset-bytes` so command-target offsets can be scoped to
  selected command bytes. This rejects the obvious extra-command hypothesis:
  offsetting only byte `0x07` by `+40/+80/+120` cycles leaves YM at
  `8727/8726/8727` mismatches and POKEY at `6668/6658/6666`, versus the
  reset-delay baseline `8728`/`6673`; `-80` is neutral or worse. Offsetting all
  observed non-heartbeat bytes by `+80` breaks alignment (`16716` YM
  mismatches, `11778` POKEY mismatches, TS YM count `45079`), so this stays a
  diagnostic, not a rule to promote. `probe-chip-write-diff.ts` also has a
  report-only `--ts-event-cycle-adjust-opcodes` diagnostic; shifting store
  opcodes earlier improves mismatch counts, but larger negative shifts imply an
  upstream reset/CPU phase issue rather than a physically valid per-opcode bus
  offset. Focused MAME/TS window traces for `529..530` were also generated, but
  the trace diff is not proof-quality because the window trace origins pair
  different local PC/write sequences; use the ordered write delta reports for
  this class.

Embedded reply-ack replay checkpoint (2026-05-23):

- The CLI probes now mirror browser `soundReplay` reply-ack behavior. If
  `--reply-ack-tape` is omitted, they read embedded ack events from the cmd
  tape (`mainReplyReads`, `replyAcks`, or trace `events`) unless
  `--no-embedded-reply-ack` is passed. The current historical corrected cmd
  tape stores only a numeric `mainReplyReads` count, so the sidecar
  `/tmp/marble-love/audio-bitperfect/mame_reply_reads_14000_coinpolarity.json`
  is still needed for that exact file; new MAME captures can embed real ack
  events as `replyAcks` with `MARBLE_SOUND_CMD_EMBED_REPLY=1`.
- A merged validation artifact
  `/tmp/marble-love/audio-bitperfect/mame_cmds_14000_coinpolarity_replyack-embedded.json`
  proves the embedded path is equivalent to the sidecar path. YM reset-delay
  `22` remains `6339/45942` exact native-sample mismatches in
  `chip-write-diff-2000-ym-native-sample-resetdelay22-embeddedreplyack.json`;
  POKEY reset-delay `21` remains `4941/31458` in
  `chip-write-diff-2000-pokey-native-sample-resetdelay21-embeddedreplyack.json`.
  Both schedule `1836/14546` main reply acks from the embedded cmd tape.
- The same local PCM window remains unchanged with embedded reply-ack:
  `pcm-diff-replay-window1265664-resetdelay22-embeddedreplyack.json` reports
  correlation `0.5743`, lag `1352`, RMS `0.07735`, and maxAbs `0.23558`.
  Reply-ack replay is now correct baseline plumbing, not the PCM timing fix.

Frame-budget control checkpoint (2026-05-23):

- `probe-chip-write-diff.ts` now has a diagnostics-only `--fixed-frame-cycles`
  switch that clears TS replay's timestamp-derived frame budgets while keeping
  the original cmd tape timestamps for MAME normalization. This rejects the
  simple "bad frame cadence" hypothesis. On the embedded reply-ack baseline,
  fixed frame cycles drop TS YM output to `13796` writes and produce
  `45010/45942` mismatches
  (`chip-write-diff-2000-ym-native-sample-resetdelay22-embeddedreplyack-fixedframe-probe.json`);
  POKEY drops to `11274` writes and `29571/31458` mismatches
  (`chip-write-diff-2000-pokey-native-sample-resetdelay21-embeddedreplyack-fixedframe-probe.json`).
  The timestamp-derived budgets are still required; the remaining PCM/timing
  blocker is local instruction/device phase jitter, not a constant frame-rate
  replacement.

YM timer/control bus-cycle checkpoint (2026-05-23):

- `probe-chip-write-diff.ts` and `probe-sound-sample-diff.ts` now expose
  `--defer-ym-timer-control-write-timing`, a diagnostics-only control that
  applies only YM timer/control data writes (`0x10/0x11/0x12/0x14`) at the
  estimated 6502 bus-write cycle. This rejects the "only Timer A/control
  writes need bus-cycle deferral" hypothesis. On the embedded reply-ack
  baseline, `reset-delay=22` worsens YM from `6339/45942` to `7555/45942`
  mismatch samples and POKEY from `4941/31458` to `5264/31458`. Sweeping
  reset delays `18..26` finds best YM `6350/45942` at delay `19`, still worse
  than baseline; POKEY only improves trivially to `4933/31458` at delay `18`
  while YM worsens. Keep this as a diagnostic flag, not a promoted replay
  behavior.

IRQ/status/YM-event offset checkpoint (2026-05-23):

- Two new diagnostics split global IRQ latency from YM event timestamping:
  `--irq-service-delay <cycles>` delays only unmasked IRQ service, and
  `--ym-write-event-cycle-offset <cycles>` shifts YM data-write event
  timestamps used by diagnostics and `mame-stream` PCM scheduling without
  moving CPU/register state. Both are rejected as fixes. At the embedded
  reply-ack baseline, `--irq-service-delay 1` worsens YM to `6824/45942` and
  POKEY to `5159/31458`; the local PCM window remains correlation `0.5743`,
  lag `1352`. The YM event offset sweep keeps `0` as the native-sample minimum:
  `-4` is already worse at `7484/45942`, and the local PCM window only moves
  at `-16`, where it regresses to correlation `0.4513`, lag `-1956`.
- Removing frame-mode status replay is also not the PCM fix. The first
  2000-frame native-sample probes improve only trivially without status tape
  (`6321/45942` YM, `4921/31458` POKEY), and the local PCM window remains
  correlation `0.5743`, lag `1352`. The full 14000-frame cycle300/frame1 gate
  without status tape keeps payload counts matched but fails `27` YM rows and
  `51` POKEY rows, first at frames `5702` and `5451`. Keep status replay in
  promoted full timing gates; it is not the local frame-1570 PCM blocker.

YM stream origin / reset / direct-TS timing checkpoint (2026-05-23):

- The local failing window is not fixed by making SoundChip `mame-stream` use
  an absolute MAME stream sample origin. `--ym-stream-absolute-origin` preclocks
  the YM stream by `228311` native samples and removes the output padding for
  `--source ym`, but it worsens the same window to correlation `0.5177`, lag
  `-1958`
  (`pcm-diff-replay-window1265664-resetdelay22-embeddedreplyack-ymstream-absolute-origin-sourceym.json`)
  versus the source-YM baseline correlation `0.5743`, lag `1352`
  (`pcm-diff-replay-window1265664-resetdelay22-embeddedreplyack-sourceym-baseline.json`).
- Key-on-only event offsets are also rejected. The diagnostic
  `--ym-keyon-write-event-cycle-offset` moves only YM `reg 0x08` event
  timestamps; offsets `-16,-8,-4,+4,+8,+16` leave the local window effectively
  unchanged at correlation `0.5741..0.5743`.
- Ignoring LS259 bit-0 YM reset writes is not the missing PCM fix either:
  `--disable-ym-reset` keeps the native-sample mismatch profile unchanged and
  only nudges the local source-YM window to correlation `0.5767`, lag `-437`
  (`pcm-diff-replay-window1265664-resetdelay22-embeddedreplyack-disableymreset-sourceym.json`).
- `probe-chip-write-diff.ts` can now export normalized TS YM writes with
  `--ts-ym-write-out`. Rendering that exported TS event stream through the
  direct MAME-write renderer reproduces the failure without the live SoundChip
  bridge: `pcm-diff-direct-tsymwrites-window1265664-resetdelay22-embeddedreplyack.json`
  reports correlation `0.4366`, lag `241`, while direct MAME YM writes on the
  same window still pass at correlation `0.9999977`. This pins the blocker on
  TS replay event timing/sample placement, not the PCM DSP, browser bridge,
  YM reset handling, or stream-origin padding.
- Re-rendering the exported TS writes with replay-relative origin plus the
  SoundChip output pad reproduces the live SoundChip failure almost exactly:
  `pcm-diff-direct-tsymwrites-replayorigin-offset195941-window1265664-resetdelay22-embeddedreplyack.json`
  reports correlation `0.5743`, lag `1351`. A control render of the MAME YM
  writes with that same replay-relative origin also fails (`0.6285`, lag
  `-1981`), while direct MAME writes with absolute origin and integer-cycle
  sample indexing still pass at correlation about `1.0`. Final PCM parity will
  likely need absolute YM stream preclocking, but only after the TS event
  timing/history is corrected.
- A fresh frame-1217 full-PC trace with reset-delay `22`, frame-mode status,
  and embedded reply acks shows TS taking a command-boundary NMI path one
  instruction later than MAME at the Coin 1 command frame. Disabling the
  sampled NMI delay with `--command-nmi-sample-cycle Infinity` is not a fix:
  the YM native-sample mismatches rise to `6398/45942`, POKEY to `5120/31458`,
  and the local source-YM PCM window remains correlation `0.5743`, lag `1352`
  (`pcm-diff-replay-window1265664-resetdelay22-embeddedreplyack-nmisampleinf-sourceym.json`).
  Treat this as evidence of local command-boundary phase, not a promotable
  replay default.

Older artifacts below predate this corrected baseline unless their filename
contains `coinpolarity`; use them only as historical context.

- Cycle-precise cmd tape:
  `oracle/scenarios/sound-cmd-tape-attract-cycle-precise.json`.
- MAME captures:
  `/tmp/marble-love/audio-bitperfect/mame_ym_writes.json`,
  `/tmp/marble-love/audio-bitperfect/mame_pokey_writes.json`,
  `/tmp/marble-love/audio-bitperfect/mame_attract.wav`,
  `/tmp/marble-love/audio-bitperfect/mame_ym_writes_inject0005_760_pokeymuted.json`,
  `/tmp/marble-love/audio-bitperfect/mame_inject0005_760_pokeymuted.wav`.
- TS captures/reports:
  `/tmp/marble-love/audio-bitperfect/ts_ym_writes.json`,
  `/tmp/marble-love/audio-bitperfect/ym-write-diff-1098-order.json`,
  `/tmp/marble-love/audio-bitperfect/ym-write-diff-full-order-strict.json`,
  `/tmp/marble-love/audio-bitperfect/ym-write-diff-full-order.json`,
  `/tmp/marble-love/audio-bitperfect/pokey-write-diff-2000-order.json`,
  `/tmp/marble-love/audio-bitperfect/pokey-write-diff-2001-prefix.json`,
  `/tmp/marble-love/audio-bitperfect/pokey-write-diff-full-order.json`,
  `/tmp/marble-love/audio-bitperfect/mame_ym_writes_14000.json`,
  `/tmp/marble-love/audio-bitperfect/mame_pokey_writes_14000.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-order.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-order-after-diagnostics.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-order-restored87-after-statusbase.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-order-statusbase86.json`,
  `/tmp/marble-love/audio-bitperfect/mame_cmd_status_runs_14000.json`,
  `/tmp/marble-love/audio-bitperfect/mame_sound_status_runs_14000.json`,
  `/tmp/marble-love/audio-bitperfect/mame_cmd_reply_14000.json`,
  `/tmp/marble-love/audio-bitperfect/mame_reply_reads_14000.json`,
  `/tmp/marble-love/audio-bitperfect/ts_pc_cycles_500_status_runs_compare.json`,
  `/tmp/marble-love/audio-bitperfect/status-diff-500-default87.json`,
  `/tmp/marble-love/audio-bitperfect/status-diff-500-apply-status-tape.json`,
  `/tmp/marble-love/audio-bitperfect/status-diff-500-apply-ignore-frame.json`,
  `/tmp/marble-love/audio-bitperfect/ts_sound_window_trace_244_245_status_tape.json`,
  `/tmp/marble-love/audio-bitperfect/mame_sound_window_trace_244_245_status.json`,
  `/tmp/marble-love/audio-bitperfect/status-diff-246-window-delay30.json`,
  `/tmp/marble-love/audio-bitperfect/status-diff-500-apply-ignore-frame-delay30.json`,
  `/tmp/marble-love/audio-bitperfect/ts_sound_window_trace_244_245_status_tape_delay30.json`,
  `/tmp/marble-love/audio-bitperfect/mame_sound_window_trace_244_245_replyack.json`,
  `/tmp/marble-love/audio-bitperfect/ts_sound_window_trace_245_delay30_replyack75.json`,
  `/tmp/marble-love/audio-bitperfect/status-diff-500-delay30-replyack70.json`,
  `/tmp/marble-love/audio-bitperfect/status-diff-500-delay30-replyack75.json`,
  `/tmp/marble-love/audio-bitperfect/status-diff-500-replyack75.json`,
  `/tmp/marble-love/audio-bitperfect/status-diff-246-window-delay30-replyacktap-allreads.json`,
  `/tmp/marble-love/audio-bitperfect/status-diff-246-window-delay30-replyacktap-pcval.json`,
  `/tmp/marble-love/audio-bitperfect/status-diff-500-replyacktap14000-pcval.json`,
  `/tmp/marble-love/audio-bitperfect/status-diff-500-delay30-replyacktap14000-pcval.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-order-after-resetdelay-option.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-order-resetdelay30.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-order-replyack70.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-order-replyack75.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-order-replyacktap-window.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-order-replyacktap14000.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-order-resetdelay30-replyack70.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-order-resetdelay30-replyack75.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-50w-lag12-after-resetdelay-option.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-50w-lag12-resetdelay30.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-50w-lag12-replyacktap14000.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-order-status-runs500.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-order-status-runs14000.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-cycle120-status-runs14000.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-cycle120-stats.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-order-replaycycle-replyacktap14000.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-cycle120-replaycycle-replyacktap14000.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-order-after-pc-replyacktap14000.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-cycle120-after-pc-replyacktap14000.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-order-buscycle-replyacktap14000.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-cycle120-buscycle-replyacktap14000.json`,
  `/tmp/marble-love/audio-bitperfect/mame_sound_window_trace_260_261_pc8100.json`,
  `/tmp/marble-love/audio-bitperfect/ts_pc_cycles_260_261_irqtrace_replyacktap.json`,
  `/tmp/marble-love/audio-bitperfect/ts_pc_cycles_260_261_irqtrace_ta29_replyacktap.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-order-ta29-replyacktap.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-order-after-taphase-diagnostic.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-cycle120-after-taphase-diagnostic.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-2000-ym6000-cycle120-samples-default.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-2000-ym6000-cycle120-samples-ta29.json`,
  `/tmp/marble-love/audio-bitperfect/mame_sound_window_trace_532_533_pc8e9c.json`,
  `/tmp/marble-love/audio-bitperfect/ts_pc_cycles_532_533_pc8e9c_default.json`,
  `/tmp/marble-love/audio-bitperfect/ts_pc_cycles_532_533_pc8e9c_ta29.json`,
  `/tmp/marble-love/audio-bitperfect/ts_pc_cycles_532_533_pc8e9c_ta29_nmid1.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-2000-ym6000-cycle120-ta29-nmid1.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-2000-ym6000-cycle120-nmid1.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-order-ta29-nmid1-replyacktap.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-order-after-nmidelay-diagnostic.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-order-after-stepctx-diagnostic.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-order-after-helper-doc-replyreads.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-cycle120-after-helper-doc-replyreads.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-2000-cycle120-nmisample2.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-order-default-nmisample2-replyreads.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-cycle120-default-nmisample2-replyreads.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-cycle120-default-nmisample2-crossings.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-order-default-nmisample2-pcsummary.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-cycle120-default-nmisample2-pcsummary.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-2000-cycle120-preempt24-frameend-summary.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-cycle120-preempt24-frameend-summary.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-2000-cycle120-preempt-before-only.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-cycle120-preempt-before-only.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-cycle120-default-after-preemptdiag.json`,
  `/tmp/marble-love/audio-bitperfect/mame_sound_window_trace_278_279_pc8100.json`,
  `/tmp/marble-love/audio-bitperfect/ts_pc_cycles_278_279_ta29.json`,
  `/tmp/marble-love/audio-bitperfect/ts_pc_cycles_278_279_ta29_nmid1.json`,
  `/tmp/marble-love/audio-bitperfect/ts_pc_cycles_260_261_irqtrace_ta29_stepctx.json`,
  `/tmp/marble-love/audio-bitperfect/ts_pc_cycles_278_279_ta29_nmid1_stepctx.json`,
  `/tmp/marble-love/audio-bitperfect/ts_pc_cycles_532_533_pc8e9c_ta29_stepctx.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-50w-lag12-replaycycle-replyacktap14000.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-50w-lag12-buscycle-replyacktap14000.json`,
  `/tmp/marble-love/audio-bitperfect/mame_sound_window_trace_264_268_cycles.json`,
  `/tmp/marble-love/audio-bitperfect/ts_sound_window_trace_264_268_actual_submit.json`,
  `/tmp/marble-love/audio-bitperfect/mame_sound_window_trace_3468_3470.json`,
  `/tmp/marble-love/audio-bitperfect/ts_sound_window_trace_3468_3470.json`,
  `/tmp/marble-love/audio-bitperfect/mame_pc_cycles_500_pconly.json`,
  `/tmp/marble-love/audio-bitperfect/ts_pc_cycles_500_timeracc_compare.json`,
  `/tmp/marble-love/audio-bitperfect/ts_pc_cycles_500_statusbase86_compare.json`,
  `/tmp/marble-love/audio-bitperfect/ts_pc_cycles_260_261_replyacktap_trace.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-10w.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-50w-lag12-timeracc.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-50w-lag12-after-diagnostics.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-50w-lag12-after-statusbase.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-50w-lag12-after-helper-doc-replyreads.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-50w-lag12-default-nmisample2-replyreads.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-50w-lag12-gainstats-components.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-attract-pokey-window-scan.json`,
  `/tmp/marble-love/audio-bitperfect/mame_playable_cmds_14000.json`,
  `/tmp/marble-love/audio-bitperfect/mame_playable_reply_reads_14000.json`,
  `/tmp/marble-love/audio-bitperfect/mame_playable_14000.wav`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-playable14000-pokey-window-scan.json`,
  `/tmp/marble-love/audio-bitperfect/mame_sound_cmd_inject_scan.json`,
  `/tmp/marble-love/audio-bitperfect/mame_cmds_inject0005_760.json`,
  `/tmp/marble-love/audio-bitperfect/mame_ym_writes_inject0005_760.json`,
  `/tmp/marble-love/audio-bitperfect/mame_pokey_writes_inject0005_760.json`,
  `/tmp/marble-love/audio-bitperfect/mame_inject0005_760.wav`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-inject0005-760-pokey-order.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-inject0005-760-ym-prefix12448.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-pokey-windows-after-counter.json`,
  `/tmp/marble-love/audio-bitperfect/mame_cmds_inject0005_760_64k.json`,
  `/tmp/marble-love/audio-bitperfect/mame_inject0005_760_64k.wav`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-pokey-windows-mame64k.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-pokey-windows-after-muted-counters.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-pokey-residual-after-muted-counters.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-pokey-windows-after-mame-step.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-pokey-residual-after-mame-step.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-pokey-windows-after-mame-step-avg28.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-pokey-residual-after-mame-step-avg28.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-inject0005-760-pokey-strict-after-avg28.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-inject0005-760-pokey-cycle180-after-avg28.json`,
  `/tmp/marble-love/audio-bitperfect/mame_pokey_writes_inject0005_760_ymkeymuted.json`,
  `/tmp/marble-love/audio-bitperfect/mame_inject0005_760_ymkeymuted.wav`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-inject0005-760-pokey-cycle180-ymkeymuted.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-pokey-ymkeymuted-mamewindows.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-pokey-ymkeymuted-pokeywindows.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-pokey-ymkeymuted-mamewindows-lag12.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-pokey-ymkeymuted-pokeywindows-lag12.json`,
  `/tmp/marble-love/audio-bitperfect/mame_inject0005_760_nomute_nv_rerun.wav`,
  `/tmp/marble-love/audio-bitperfect/mame_pokey_writes_inject0005_760_nomute_nv_rerun.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-ym-from-full-minus-ymkeymuted-lag12.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-ym-from-full-minus-ymkeymuted-channels-lag12.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-ym-from-full-minus-ymkeymuted-channels-lag12-after-panfix.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-ym-from-full-minus-ymkeymuted-channels-lag12-after-route-gain.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-ym-from-full-minus-ymkeymuted-channels-lag12-after-route-gain-sampledetail.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-ym-window477184-lag80-sampledetail.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-pokey-ymkeymuted-mamewindows-lag12-after-ym-route-gain.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-inject0005-760-ym-strict-after-route-gain.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-2000-cycle120-after-defer-option-default.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-order-after-defer-option-default.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-cycle120-after-defer-option-default.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-50w-lag12-after-defer-option-default.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-2000-cycle120-defer-chip-write-timing-rejected.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-50w-lag12-defer-chip-write-timing-rejected.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-ym-after-defer-option-default.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-pokey-after-defer-option-default.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-50w-lag12-after-pokey-clock.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-50w-lag12-after-pokey-muted-counters.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-50w-lag12-after-pokey-mame-step.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-50w-lag12-after-ym-panfix.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-50w-lag12-after-ym-route-gain.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-ym-after-sampled-key-state.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-50w-lag12-after-sampled-key-state.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-ym-after-ym-prepare-latch.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-50w-lag12-after-ym-prepare-latch.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-14000-order-after-ym-prepare-latch.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-ym-window477184-trace24.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-ym-window477184-trace12-defer-ym-audio-writes.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-ym-defer-ym-audio-writes.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-50w-lag12-defer-ym-audio-writes.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-ym-defer-ym-parameter-writes.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-50w-lag12-defer-ym-parameter-writes.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-ym-window477184-mame-write-timed.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-ym-mame-write-timed.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-pokey-mame-write-timed.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-ym-window477184-phase-after-output.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-ym-mame-write-timed-phase-after-output.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-ym-mame-write-timed-resample-neg025.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-ym-window477184-resample-neg025.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-pokey-mame-write-timed-resample-neg02.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-pokey-mame-write-timed-shared-resampler-wide.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-pokey-mame-write-timed-shared-resampler-wide-neg02.json`,
  `/tmp/marble-love/audio-bitperfect/mame_inject0015_1120_ymkeymuted.wav`,
  `/tmp/marble-love/audio-bitperfect/mame_pokey_writes_inject0015_1120_ymkeymuted.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0015-1120-pokey-mame-write-timed-wide.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0015-1120-pokey-mame-write-timed-wide-neg02.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0015-1120-pokey-mame-write-timed-wide-pos005.json`,
  `/tmp/marble-love/audio-bitperfect/pokey-resample-sweep-inject0015-1120-summary.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0015-1120-pokey-worst786432-channeltrace.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0015-1120-pokey-worst786432-channeltrace-exact-rate.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0015-1120-pokey-worst786432-samplecycle1-channeltrace.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0015-1120-pokey-mame-write-timed-wide-hop4096-exact-rate.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0015-1120-pokey-mame-write-timed-wide-hop4096-exact-rate-neg02.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0015-1120-pokey-mame-write-timed-wide-hop4096-exact-rate-pos005.json`,
  `/tmp/marble-love/audio-bitperfect/mame_inject001f_1700_ymkeymuted.wav`,
  `/tmp/marble-love/audio-bitperfect/mame_pokey_writes_inject001f_1700_ymkeymuted.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject001f-1700-pokey-mame-write-timed-allwindows-hop4096-exact-rate-lag12search.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject001f-1700-pokey-mame-write-timed-allwindows-hop4096-exact-rate-lagtie3e-5.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-ym-after-direct-render-refactor.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-direct-fullminusym-pokey-ymlofi-allwindows.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-direct-mix-ym-lofi-pokey-linear-pokeyout3-strict-allwindows.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-runtime-mix-ym-lofi-pokey-linear-pokeyout3-gated-allwindows.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-inject0005-760-combined-strict-allmismatches.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-runtime-mix-pokeyout3-reset30.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-runtime-mix-pokeyout3-replyack70.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-runtime-mix-pokeyout3-replyack24.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-runtime-mix-pokeyout3-deferchip.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-runtime-mix-pokeyout3-deferymaudio.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-runtime-mix-pokeyout3-nmidelay1.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-runtime-mix-pokeyout3-nmisample0.json`,
  `/tmp/marble-love/audio-bitperfect/pcm-diff-inject0005-760-runtime-mix-pokeyout3-nmisample4.json`,
  `/tmp/marble-love/audio-bitperfect/mame_sound_window_trace_700_712_inject0005_pc.json`,
  `/tmp/marble-love/audio-bitperfect/mame_sound_window_trace_699_700_inject0005_pc.json`,
  `/tmp/marble-love/audio-bitperfect/ts_sound_window_trace_700_712_inject0005.json`,
  `/tmp/marble-love/audio-bitperfect/ts_pc_cycles_700_712_inject0005_trace.json`,
  `/tmp/marble-love/audio-bitperfect/ts_sound_window_trace_699_700_inject0005.json`,
  `/tmp/marble-love/audio-bitperfect/ts_pc_cycles_699_700_inject0005_trace.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-inject0005-760-combined-strict-nearmiss.json`,
  `/tmp/marble-love/audio-bitperfect/chip-write-diff-inject0005-760-combined-strict-statusbase86.json`.

Current gates:

- YM2151 ordered parity: PASS strict over the current 2000-frame capture:
  `46287 / 46287` writes compared, `0` mismatches.
- YM2151 long-run parity: PASS ordered reg/val/PC over the 14000-frame capture:
  `379306 / 379306` writes. The old frame `3469` divergence is closed; TS now
  schedules `cmd 0x08` at cycle `4092`, before the same Timer A IRQ boundary as
  MAME, and allocates YM channel 0 first. The latest oracle ack-tape bus-cycle
  report is `chip-write-diff-14000-order-buscycle-replyacktap14000.json`, which
  also proves the oracle main-reply ack tape does not disturb ordered YM parity.
  Latest default diagnostic rerun
  `chip-write-diff-14000-order-default-nmisample2-pcsummary.json` also stays
  green after the shared command-target helper and command-NMI sample-point
  default. The latest rerun after YM sample-clock prepare latching,
  `chip-write-diff-14000-order-after-ym-prepare-latch.json`, remains green for
  YM2151 `379306 / 379306` and POKEY `257889 / 257889`. The current final
  order-only rerun is `chip-write-diff-14000-order-final.json`, also green for
  YM2151 `379306 / 379306` and POKEY `257889 / 257889`.
- POKEY ordered parity: PASS for the `32920` writes present in the 2000-frame
  MAME capture. A 2001-frame MAME prefix confirms TS writes `32925 / 32925`
  in the same order; the 2000-frame strict-count diff only reports five TS
  writes after the shorter MAME tap cut.
- POKEY long-run parity: PASS ordered reg/val/PC over the 14000-frame capture:
  `257889 / 257889` writes.
- PCM parity: PASS for the current first-four audible-window gate and the
  widened audible-window sweep. Latest rerun after applying MAME's Atari System
  1 YM route gain (`0.48` per stereo output) in TS
  (`pcm-diff-50w-lag12-after-ym-route-gain.json`) found
  38 audible windows and passes `minCorrelation=0.95` plus `maxAbsLag=12` with
  worst correlation about `0.9972`, worst RMS about `0.00214`, worst maxAbs
  about `0.01276`, and worst absolute lag `12` samples. The lag-12 cases are
  late YM tail windows; the first 20 YM windows remain within 5 samples.
  The previous gain/component diagnostic found all 38 selected audible windows
  were YM-dominant (`ymShare=1.0`, POKEY RMS `0`) and estimated a stable
  TS->MAME gain near `0.957`. That matched the exact MAME route relationship:
  the old TS `/65536` normalization was equivalent to route gain `0.50`, while
  MAME `atarisy1` routes each YM output at `0.48`. After promoting that route
  gain, the latest attract best global gain is `0.9971` and the source peak is
  almost aligned (`TS 0.148666`, MAME `0.147583`). This does not touch POKEY
  scaling.
  A new `--window-source pokey` scan makes that explicit:
  `pcm-diff-attract-pokey-window-scan.json` reports TS POKEY `rms=0` and
  `maxAbs=0` across the full attract render, despite YM `maxAbs=0.15486`.
  A first real-playable MAME capture path now exists via optional
  `MARBLE_PLAYABLE_SOUND_CMD_OUT` / `MARBLE_PLAYABLE_SOUND_REPLY_OUT` in
  `oracle/mame_playable_input_capture.lua`, but the 14000-frame default
  playable route produced a sound-cmd stream identical to the attract tape and
  `pcm-diff-playable14000-pokey-window-scan.json` also reports POKEY `maxAbs=0`.
  Treat those as negative evidence for natural route coverage, not as a POKEY
  PCM gate. A new forced-command oracle closes that coverage gap:
  `mame_sound_cmd_inject_scan.json` injected `0x00..0xff` after normal boot and
  found `5064` POKEY AUDC-volume writes, first after command `0x05`. The
  reduced `0x00..0x05` injection tape has ordered event parity green
  (`POKEY 9672 / 9672`; `YM 12448 / 12448` prefix, with only TS tail-cut extras
  after the MAME stop). Earlier POKEY PCM probes were still mixed with YM. The first clock/28 plus
  muted-counter fix reached
  `pcm-diff-inject0005-760-pokey-windows-after-muted-counters.json` with worst
  correlation about `0.4652` and lag `789`; a MAME `63920` Hz capture still
  bottomed out around `0.4628`, so this is not just a resampler-rate artifact.
  The current TS POKEY now follows MAME's per-clock borrow/poly/output order
  for high-clock joined channels and averages the high-clock output into the
  /28 native stream. Attract remains green in
  `pcm-diff-50w-lag12-after-pokey-mame-step.json` (`38` windows, worst
  correlation `0.9972`, max lag `12`, POKEY `maxAbs=0`), and the forced POKEY
  write timing passes with `frameTolerance=1`, `cycleTolerance=180` in
  `chip-write-diff-inject0005-760-pokey-cycle180-after-avg28.json` (max
  replay-cycle delta `172`, mean abs `26.47`). Fixed-gain residual subtraction
  is rejected as a POKEY gate:
  `pcm-diff-inject0005-760-pokey-residual-after-mame-step-avg28.json` bottoms
  out around `0.2955`, while the full-WAV diagnostic remains too mixed/phase
  sensitive. The first isolated forced POKEY PCM gate now passes through the
  new oracle flag `MARBLE_SOUND_MUTE_YM=1` on `mame_pokey_write_tap.lua`,
  which mutes only YM2151 key-on data writes and preserves YM timer/control
  writes. The key-on-muted MAME WAV
  `mame_inject0005_760_ymkeymuted.wav` plus write log
  `mame_pokey_writes_inject0005_760_ymkeymuted.json` keep POKEY write parity
  green (`chip-write-diff-inject0005-760-pokey-cycle180-ymkeymuted.json`,
  `9672 / 9672`, `0` mismatches under `frameTolerance=1`,
  `cycleTolerance=180`) and pass POKEY PCM in
  `pcm-diff-inject0005-760-pokey-ymkeymuted-mamewindows-lag12-after-ym-route-gain.json`:
  40 selected windows, worst correlation about `0.9976`, worst absolute lag
  `2`, worst RMS `0.00434`, best global gain `0.9985`. The earlier
  POKEY-selected report
  `pcm-diff-inject0005-760-pokey-ymkeymuted-pokeywindows-lag12.json` remains
  green under the same threshold family.
  `probe-sound-sample-diff.ts` can now subtract a second MAME WAV with
  `--mame-subtract-wav` / `--mame-subtract-wav-gain`, optional
  `--ym-channel-diagnostics` / `--pokey-channel-diagnostics`, and a per-window
  `maxAbsSample` detail with TS, MAME, component, and channel values.
  Subtracting the key-on-muted WAV from
  the full forced-command WAV isolates the MAME YM component. The pre-fix report
  `pcm-diff-inject0005-760-ym-from-full-minus-ymkeymuted-lag12.json` failed
  the `0.95` gate with worst correlation `0.3604`; the per-channel diagnostic
  localized the bad forced `cmd 0x04` band to TS YM channel 0 after MAME wrote
  `$20+ch0 = 0x9c` and later keyed on channel 0. That exposed a stereo routing
  bug: MAME/Atari routes OPM output 0 (bit 6) to the left speaker and output 1
  (bit 7) to the right speaker, while TS had those bits swapped. After fixing
  the mapping, the isolated YM report
  `pcm-diff-inject0005-760-ym-from-full-minus-ymkeymuted-channels-lag12-after-panfix.json`
  passes 40 selected windows with worst correlation `0.9934`, worst absolute
  lag `7`, worst RMS `0.00431`, and best global gain `0.9585`. Applying the
  MAME YM route gain then produces
  `pcm-diff-inject0005-760-ym-from-full-minus-ymkeymuted-channels-lag12-after-route-gain.json`,
  still passing with worst correlation `0.9934`, worst absolute lag `7`, worst
  RMS `0.00342`, and best global gain `0.9984`. This closes the forced `0x04`
  left-channel failure as routing plus route gain, not POKEY write ordering,
  POKEY PCM, or generic mixer subtraction. The new sample-detail rerun
  `pcm-diff-inject0005-760-ym-from-full-minus-ymkeymuted-channels-lag12-after-route-gain-sampledetail.json`
  shows the current worst forced-YM residual is later, at sample `480848`
  (`mameSample 480854`) in the channel-6 effect band: TS is `-0.02510`, MAME
  is `+0.04044`, and only TS YM channel 6 contributes at that exact sample.
  A local `--max-lag 80` rerun on window `477184` still chooses lag `-6`, so
  this is not solved by a wider integer-lag search. The new
  `--sample-trace-radius` artifact
  `pcm-diff-inject0005-760-ym-window477184-trace24.json` shows this is a short
  transient during the channel-6 write burst, not a steady gain error: samples
  are close before the burst, diverge while regs
  `$26/$2e/$36/$3e/$46...` are rewritten, then settle again.
  YM register side effects now follow ymfm's sample-clock prepare model for the
  pieces implemented in TS: writes to reg `$08` update a per-channel live key
  mask, operator key-on/key-off edges are applied on the next YM sample clock,
  and channel/operator register-derived params are latched from the reg shadow
  during the next YM sample prepare. Unit tests cover the important collapse
  case where key-off and key-on happen between two samples, preventing a false
  phase/envelope retrigger. This is a correctness fix but not the channel-6
  residual root cause: `pcm-diff-inject0005-760-ym-after-ym-prepare-latch.json`
  still passes with worst correlation `0.9934`, worst absolute lag `7`, worst
  RMS `0.00342`, and worst maxAbs `0.06554`. The attract replay rerun
  `pcm-diff-50w-lag12-after-ym-prepare-latch.json` remains green with
  worst correlation `0.9972`, worst absolute lag `12`, worst RMS `0.00214`,
  and worst maxAbs `0.01276`.
  A narrower bus-write timing diagnostic,
  `--defer-ym-audio-write-timing`, is also rejected as a default path. It
  improves the forced channel-6 window
  (`pcm-diff-inject0005-760-ym-window477184-trace12-defer-ym-audio-writes.json`,
  maxAbs `0.05342` vs `0.06554`) and the forced YM gate remains above the
  current threshold family
  (`pcm-diff-inject0005-760-ym-defer-ym-audio-writes.json`, worst correlation
  `0.9939`, worst lag `6`), but the full attract gate fails
  (`pcm-diff-50w-lag12-defer-ym-audio-writes.json`, worst correlation
  `0.8947`, worst lag `1540`). Keep this as evidence for sub-instruction
  CPU/device timing, not as a global YM-audio write delay fix. The even
  narrower `--defer-ym-parameter-write-timing` control keeps key-on writes at
  the default timing; it still behaves like the broader YM-audio delay, with
  the forced YM gate passing
  (`pcm-diff-inject0005-760-ym-defer-ym-parameter-writes.json`, worst
  correlation `0.9939`, worst lag `6`) but attract failing
  (`pcm-diff-50w-lag12-defer-ym-parameter-writes.json`, worst correlation
  `0.8947`, worst lag `1540`). That rules out key-on timing alone as the
  cause of the attract regression. `probe-sound-sample-diff.ts` can now also
  bypass the 6502 replay with `--mame-ym-writes` and/or `--mame-pokey-writes`,
  applying MAME-timestamped chip writes directly to the TS chip models. That
  new DSP/mixer isolation path is not a default replay mode, but it makes the
  split clear: direct MAME-timed YM writes improve the forced channel-6 local
  window from maxAbs `0.06554` to `0.04480`
  (`pcm-diff-inject0005-760-ym-window477184-mame-write-timed.json`), and the
  35-window forced YM gate passes with worst correlation `0.9969`, worst lag
  `6`, worst RMS `0.00305`, and worst maxAbs `0.05215`
  (`pcm-diff-inject0005-760-ym-mame-write-timed.json`). The remaining direct
  YM residual was later isolated to MAME stream scheduling/resampler behavior
  rather than the TS YM operator core: a standalone ymfm render matched the TS
  YM model under the old cycle/linear schedule, while the MAME stream-sample
  scheduler plus default MAME LoFi resampler closes the YM-only direct gate.
  The POKEY-muted oracle `mame_ym_writes_inject0005_760_pokeymuted.json`
  rendered with `--ym-scheduler mame-stream --ym-native-sample-rate 55930
  --resampler mame-lofi` passes the focused channel-6 window with correlation
  `0.9999977`, lag `0`, RMS `0.000136`, and maxAbs `0.00251`
  (`pcm-diff-inject0005-760-ym-window477184-mame-stream-lofi.json`), and the
  35-window YM-only sweep passes with worst correlation `0.999964`, lag `0`,
  RMS `0.000256`, and maxAbs `0.00349`
  (`pcm-diff-inject0005-760-ym-mame-stream-lofi-35w.json`). This MAME stream
  scheduler is currently implemented in the direct-write probe, not promoted
  to default SoundChip replay or browser replay.
  The direct POKEY isolation also passes
  (`pcm-diff-inject0005-760-pokey-mame-write-timed.json`) with 20 selected
  windows, worst correlation `0.9985`, worst lag `1`, worst RMS `0.00308`,
  and worst maxAbs `0.03686`.
  A YM operator phase-control is now falsified as a fix:
  `--ym-phase-advance-after-output` moves the phase increment after the sine
  lookup, but the direct channel-6 local window gets slightly worse
  (`pcm-diff-inject0005-760-ym-window477184-phase-after-output.json`, maxAbs
  `0.04629` vs the direct baseline `0.04480`) and the 35-window direct YM
  sweep also worsens
  (`pcm-diff-inject0005-760-ym-mame-write-timed-phase-after-output.json`,
  worst maxAbs `0.06454` vs `0.05215`). Keep the flag only as a reproducible
  negative control; do not promote it to the default YM path.
  The new resample-phase diagnostic also rejects a simple YM sample-offset fix:
  `--ym-resample-offset -0.25` slightly improves RMS but worsens the 35-window
  direct YM worst maxAbs to `0.05428`, and the forced channel-6 local window
  worsens to maxAbs `0.04791`; offset `0` remains the best peak case in those
  sweeps. The apparent POKEY `--pokey-resample-offset -0.2` improvement was
  masking a rounded native-rate error: the default POKEY stream used `63920`
  Hz instead of `1_789_772 / 28`. `POKEY_NATIVE_SAMPLE_RATE` now derives from
  the same clock as the sound CPU, and the broad YM-key-muted `0x00..0x0f`
  direct POKEY sweep improves over 91 windows from worst maxAbs `0.06274` to
  `0.02711`, worst RMS `0.00158`, worst correlation `0.99973`, and lag `3`
  (`pcm-diff-inject0015-1120-pokey-mame-write-timed-wide-hop4096-exact-rate.json`).
  The wider `0x00..0x1f` YM-key-muted forced-command capture extends this to
  `27105` POKEY writes and `205` audible POKEY-dominant windows:
  `pcm-diff-inject001f-1700-pokey-mame-write-timed-allwindows-hop4096-exact-rate-lag12search.json`
  passes with worst correlation `0.99973`, worst lag `3`, worst RMS
  `0.00158`, and worst maxAbs `0.02711`. A companion wide-search control
  (`--max-lag 2000`) fails only because four periodic windows choose equivalent
  far-away correlations up to lag `1652`; the bounded-lag gate keeps the same
  RMS/maxAbs residuals and is the relevant `maxAbsLag=12` proof.
  `probe-sound-sample-diff.ts` now also exposes explicit
  `--lag-tie-correlation-epsilon` for this periodic-signal ambiguity. The
  default remains `0`; the POKEY control report
  `pcm-diff-inject001f-1700-pokey-mame-write-timed-allwindows-hop4096-exact-rate-lagtie3e-5.json`
  uses epsilon `0.00003`, keeps `--max-lag 2000`, passes with the same worst
  RMS/maxAbs envelope, chooses lag `3`, and records the four absolute far-lag
  candidates in each window record.
  With the exact rate, `--pokey-resample-offset -0.2` worsens worst maxAbs to
  `0.04307`, and `+0.05` worsens it to `0.02855`; keep POKEY resample offsets
  as diagnostics only. The old worst-window channel rerun now reports TS
  `0.09136` against MAME `0.11105` at the maxAbs sample, split evenly across
  POKEY CH0 and CH1, with channels 2 and 3 silent
  (`pcm-diff-inject0015-1120-pokey-worst786432-channeltrace-exact-rate.json`).
  A per-clock diagnostic `--pokey-sample-cycles 1` worsens that window to
  maxAbs `0.11105`, so the promoted fix is the exact `/28` rate, not per-clock
  output. Byte/sample exact parity remains open.
- Strict cycle timing is a diagnostic rather than the current gate. With
  `frameTolerance=0`, `cycleTolerance=120`, and timestamp-derived continuous
  replay cycles, the latest default report
  `chip-write-diff-14000-cycle120-after-defer-option-default.json` has YM2151
  `541` mismatches and POKEY `325` under the default
  `commandNmiSampleCycle=2`; ordered reg/val/PC parity remains green in
  `chip-write-diff-14000-order-after-defer-option-default.json`. The old
  immediate-edge model is still
  reproducible in probes with `--command-nmi-sample-cycle Infinity`. Chip
  write events are now timestamped at the estimated 6502 bus write cycle rather
  than the opcode-fetch cycle, so the strict report measures the residual
  timing issue without the old logging bias. Replay-cycle write deltas are
  YM2151 `[-295, +287]` cycles and POKEY `[-180, +396]`, mean absolute about
  `36` cycles for both chips. The forced 760-frame YM timing report
  `chip-write-diff-inject0005-760-ym-strict-after-route-gain.json` has ordered
  reg/val/PC parity but marks every compared YM write as a strict
  `replayCycle` mismatch under `cycleTolerance=0`; deltas are `[-299,+9]`
  cycles with mean absolute `26.07`. That places the current forced-YM
  `maxAbsSample` residual in the same timing class as the long-run strict
  diagnostics, not in event-order or route-gain parity. The old first POKEY
  frame `255/256` mismatch is gone; the first real POKEY strict mismatch is
  write `#5484`, `PC 0x8e28`, TS
  `170` cycles early. The first YM mismatch is still write `#145`, an IRQ write
  at `PC 0x81bb` immediately before a command/NMI frame boundary (`TS frame 260`
  cycle `29866` vs MAME frame `261` cycle `174`, replay-cycle delta `-173`).
  A diagnostics-only `--defer-chip-write-timing` experiment now applies
  YM2151/POKEY writes at the estimated bus-write cycle instead of opcode start.
  It is rejected as a default model: the 2000-frame strict report
  `chip-write-diff-2000-cycle120-defer-chip-write-timing-rejected.json` jumps
  to YM `27475` and POKEY `19437` replay-cycle mismatches, and
  `pcm-diff-50w-lag12-defer-chip-write-timing-rejected.json` fails the PCM
  gate with worst correlation `0.8947` and worst lag `1540`. This proves the
  bus-write timing change cannot be promoted while the 6502 still executes
  whole opcodes; it needs a sub-instruction/restart model or a narrower proven
  sampling rule.
  The focused window traces show TS frame-boundary submits happen only a couple
  cycles after their tape targets, so the remaining issue is interrupt
  phase/priority timing, not gross replay scheduler delay. The new MAME/TS IRQ
  trace pair (`mame_sound_window_trace_260_261_pc8100.json` and
  `ts_pc_cycles_260_261_irqtrace_replyacktap.json`) proves the first YM case at
  PC level: TS Timer A overflows at replay cycle `489980`, services IRQ, and
  fetches `0x81a6` at frame-261 `cycleInFrame=-64`; MAME fetches the same IRQ
  path at `cycleInFrame=-35`, then the frame-boundary command/NMI preempts
  before the YM write. A diagnostics-only `--timer-a-start-delay 29` aligns
  this local window (`0x81a6` at about `-34`), but it is rejected as a default
  fix because the 14000-frame ordered diff fails YM with `2807` value
  mismatches, first at write `#275037` (`PC 0x9385`, TS `0x07` vs MAME
  `0x06`). Status-only-on-enable and a one-tick initial Timer A delay are also
  rejected by the same long-run evidence. A second diagnostics-only
  `--command-nmi-delay-instructions 1` experiment proves the next failure class
  is NMI sampling at command boundaries: with `--timer-a-start-delay 29`, frame
  `533` aligns MAME's `PC 0x8e9c` write only if NMI is delayed by one
  instruction, but that combination introduces an earlier strict mismatch at
  write `#295` and still fails the 14000-frame ordered YM gate at `PC 0x9385`.
  The frame-279 trace explains why: in the Timer A IRQ handler path
  (`0x81b6/0x81bb`), MAME preempts with NMI before the YM write, while the
  frame-533 music-update path (`0x8e99/0x8e9c`) lets one YM write complete
  before taking NMI. A PC-range hack would fit these two windows but is not a
  proved hardware rule. The latest TS step-context traces make the sampling
  clue sharper: frame `261` has the command edge exactly at the end of TS step
  `0x8ff1` and immediate NMI matches MAME; frame `279` has the edge inside
  `0x81b8` at offset `1/4` cycles and MAME still takes NMI before `0x81bb`;
  frame `533` has the edge inside `0x8e96` at offset `2/4` cycles and MAME
  delays NMI long enough to complete the next YM write. This points at a
  bus-cycle/sample-point rule inside the current instruction. A default
  `commandNmiSampleCycle=2` rule is now implemented in `tickFrameWithTape` for
  scheduled cmd-tape edges; it preserves 14000-frame ordered YM/POKEY parity,
  improves the 2000-frame strict diagnostic to YM `36` / POKEY `30`
  mismatches, and improves the 14000-frame strict diagnostic to YM `517` /
  POKEY `302` mismatches. The remaining first YM mismatch at write `#145`
  is still a Timer A/IRQ phase case plus an I/O-write crossing: the crossing
  report shows TS starts `PC 0x81bb` at replay cycle `490049`, the frame-261
  command target lands at `490051`, and the estimated YM bus write lands at
  `490052`, while MAME defers that same YM write until `490225` after the
  command/NMI handler. Across the 14000-frame strict report, `12` YM mismatches
  and `10` POKEY mismatches are classified as command-target crossings inside
  TS write instructions. The new PC summary in
  `chip-write-diff-14000-cycle120-default-nmisample2-pcsummary.json` shows the
  strict residuals are clustered, not random: YM top PCs are `0x8eaf` (`185`,
  `6` crossings), `0x8e9c` (`172`, `4` crossings), `0x81bb` (`77`, `2`
  crossings), and `0x81c3` (`70`); POKEY top PCs are `0x8e68` (`44`, `2`
  crossings), `0x8e6f` (`42`, `1` crossing), `0x8e28` (`35`, `1` crossing),
  and `0x8e62` (`34`, `3` crossings). The next real timing fix is therefore
  either a bus-cycle/preemption shim for scheduled command targets before chip
  I/O write bus cycles, or the broader sub-instruction 6502 model.
  A diagnostics-only `--command-preempt-chip-write-lookahead 24` experiment now
  tests that first option without changing default replay. It preempts only
  `4` commands in the 2000-frame capture and improves strict timing there from
  YM `36` / POKEY `30` to YM `11` / POKEY `16`, with ordered reg/val/PC still
  intact. The same knob is rejected as a default fix because the 14000-frame
  strict diagnostic worsens to YM `813` / POKEY `506` after `36` preemptions.
  A narrower `--command-preempt-chip-write-before-only` variant is also
  rejected: the 14000-frame strict run still worsens to YM `540` / POKEY `334`
  after `6` preemptions, even though ordered reg/val/PC remains intact.
  The PCM gate now accepts the same diagnostics-only flags. With opt-in
  `--ym-scheduler mame-stream` and linear resampling,
  `pcm-diff-50w-lag12-ym-mame-stream-linear-preempt24-runtime.json` passes with
  worst correlation `0.99668`, lag `3`, RMS `0.001998`, and maxAbs `0.01417`;
  `pcm-diff-50w-lag12-ym-mame-stream-linear-preempt24-beforeonly-runtime.json`
  passes with worst correlation `0.99742`, lag `3`, RMS `0.001993`, and maxAbs
  `0.01417`. This is a small PCM improvement but does not override the strict
  14000-frame write regression, so neither flag is promoted.
  The rerun `chip-write-diff-14000-cycle120-default-after-preemptdiag.json`
  confirms the default path remains unchanged at YM `517` / POKEY `302`.
  Local MAME source documentation backs that diagnosis:
  `/opt/homebrew/Cellar/mame/0.286/share/doc/mame/techspecs/m6502.txt` says the
  MAME 6502 model timestamps bus accesses at sub-instruction precision and can
  restart interrupted instructions midstream. The current TS CPU still steps
  whole opcodes, so strict-cycle parity should target bus-cycle stepping or an
  equivalent sampled-device rule before more phase constants are tried.
  The next fix needs a conditional timer/IRQ/NMI sampling rule, not a constant
  Timer A phase or NMI latency offset.
- Diagnostic `$1820` status-base override is available but not promoted. A
  focused `--status-base 0x86` PC-cycle run matches MAME through the first
  Timer-A IRQ subroutine path, proving that one MAME trace read `$1820=$86` at
  `$e4e5/$e502`. However the same override over 14000 frames breaks ordered YM
  value parity with `2807` mismatches, first at write `#275037`
  (`PC 0x9385`, TS `reg 0x08 val 0x07` vs MAME `0x06`). Therefore the replay
  default stays `$87`; any future `$1820` input fix must be scenario/time-aware,
  not a global coin-bit change.
- A same-script MAME status capture is now available. `mame_sound_cmd_capture`
  can emit compressed `$1820` `statusBaseRuns`; the 14000-frame run produced a
  cmd tape byte/timestamp-identical to
  `oracle/scenarios/sound-cmd-tape-attract-cycle-precise.json` and only three
  status-base runs: `$86` for reads `0..407071`, `$87` for `6461` reads around
  frame `1199..1214`, then `$86` through the end. Replaying only the first
  500-frame status run keeps ordered YM/POKEY parity green, but replaying the
  full 14000-frame status runs reproduces the same YM value failure as global
  `$86`. A frame-based status-run replay mode now exists to remove ordered-read
  count as the only variable, and it is also rejected by the 14000-frame
  cycle-120 write gate. This proves the MAME input-port value alone cannot be
  promoted until the deeper read-count/interrupt-state mismatch is resolved.
- Ordered `$1820` status-read diff now localizes the first real sequence
  mismatch. With full 500-frame MAME `statusReads` applied back into TS, base
  bits match through the first IRQ window. Ignoring frame-label differences,
  the first PC/value mismatch is read `#72`: TS performs one extra polling read
  at `PC 0x8103`, `frame 244`, `cycleInFrame 12122`, `val 0x86`; MAME has
  already received the frame-245 command and reads `PC 0x9569`,
  `cycleInFrame 17`, `val 0x8e`. The surrounding trace shows the frame-245
  command submit is exact in TS (`actualCycleInFrame=0`) and MAME, while TS's
  pre-command poll loop is about 30 cycles earlier than MAME. This shifts the
  next NMI/status read by one ordered `$1820` read and points at residual CPU /
  interrupt phase, not at the `$1820` input value itself.
- A diagnostics-only reset-release delay can now be injected with
  `--reset-release-delay` (engine option `resetReleaseDelayCycles`). The
  `30`-cycle experiment aligns the focused 244..245 MAME status-read window
  through read `#62`, so the initial poll-loop phase clue is real. It is not a
  default fix: the 500-frame status diff still first diverges at read `#73`
  (`PC 0x8103`, MAME status value `0x96` vs TS `0x86`), and the 14000-frame
  ordered chip diff fails YM with `2807` value mismatches at the familiar
  `PC 0x9385` key-on (`TS 0x07`, MAME `0x06`). POKEY stays ordered, and PCM
  still passes the lag-12 correlation gate, but the YM regression means the
  default replay remains delay `0`.
- A diagnostics-only main-reply ack delay now exists as
  `--reply-ack-delay` (engine option `mainReplyAckDelayCycles`). The focused
  MAME 244..245 trace now records `replyWrite` and `mainReplyRead`: MAME writes
  the sound->main reply at `PC 0xe59d`, frame-245 `cycleInFrame=120`; the
  status poll at `cycleInFrame=153` sees `$1820=$96`; the main CPU reads
  `$FC0001` at `PC 0x4d62`, `cycleInFrame=190`; the next status poll returns
  `$86`. TS with `--reply-ack-delay 70` reproduces that local pending lifetime.
  Combined with `--reset-release-delay 30`, the first ordered status mismatch
  moves from read `#73` to `#1066`. It is still not a default fix:
  `--reply-ack-delay 70` or `75` alone breaks the 14000-frame YM ordered gate
  with the same `2807` key-on value mismatches at `PC 0x9385`. The evidence now
  points to scheduled main-CPU ack timing/read-count alignment rather than a
  constant reply-ack delay.
- A scheduled main-reply ack replay is now implemented for the oracle path.
  `mame_sound_cmd_capture` can emit `MARBLE_SOUND_REPLY_OUT`; the 14000-frame
  capture produced `14562` main `$FC0001` reads and a cmd tape identical to the
  current cycle-precise tape. Passing it as `--reply-ack-tape` schedules all
  `14562 / 14562` TS reply writes without skips/exhaustion, preserves 14000
  YM/POKEY ordered parity, and preserves the PCM lag-12 gate. In the focused
  244..245 window, using all main reply reads fixes the `$96` pending-bit
  mismatch; with cycle tolerance ignored, TS and MAME match PC/value through
  the captured window and only differ by TS extra reads after the MAME window
  ends. `packages/web/src/sound-replay.ts` can consume the same oracle timeline
  from embedded `mainReplyReads` or via `?soundReplayReplyAck=<json>`, still
  isolated from gameplay `?sound=1`. The browser replay path now also exposes
  diagnostics-only `?soundReplayYmResampleOffset=<n>` and
  `?soundReplayPokeyResampleOffset=<n>` flags that feed the same shared
  resampler as the CLI PCM probe; defaults remain zero, so no offset is
  promoted to normal replay. It also exposes opt-in
  `?soundReplayYmScheduler=mame-stream` plus optional
  `?soundReplayYmNativeSampleRate=<hz>` so the browser replay can exercise the
  same SoundChip YM stream scheduler that reduces the 14000-frame attract lag
  in the CLI probe. Gameplay `?sound=1` remains on the normal cycle-scheduled
  path.

Recent fix:

- `loadCmdTape` now keeps timestamp offsets relative to the first command in
  each frame. This preserves multi-command frame timing, e.g. frame `375`
  replays `cmd 0x03` at cycle `0` and `cmd 0x08` at cycle `4089` instead of
  collapsing both to cycle `0`.
- `loadCmdTape` also derives per-frame sound-cycle budgets from timestamped
  frame origins. This fixes the reset frame: MAME has only about `12k` sound
  cycles between frame `244`'s first command and frame `245`, not a full
  nominal frame. With this budget, the `cmd 0x08` key-on window matches MAME
  order instead of diverging at write `#1099`.
- `tickFrameWithTape` now keeps an external tape schedule clock instead of
  using `cpu.cycles` as the next frame origin. CPU instruction overshoot no
  longer shifts later command targets; this closes the frame `3469` Timer A /
  `cmd 0x08` ordering bug and makes 14000-frame YM/POKEY ordered parity pass.
- YM DSP improvements landed in the engine model: OPM KC+KF+DT1/DT2/MUL phase
  step, 20-bit operator phase, OPM operator register block mapping, per-operator
  key-on state, KSR-aware envelope rates, D1L/RR semantics, OPM LFO PM/AM, and
  log-domain operator output. The latest pass also fixes ymfm-style attack
  attenuation, preserves current attenuation on key-on retriggers, gates
  envelope stepping to the divided EG clock, uses exact log-sine/power tables,
  applies integer OPM feedback/modulator shifts, simulates YM3012 roundtrip, and
  declares the replay native YM rate as `55930.375 Hz`.
- YM2151 busy status is active again: data-port writes assert bit 7 for 64 YM
  master cycles. The PC-cycle probe showed TS and MAME already reached the
  first YM write PC (`0x8188`) at the same cycle, then TS ran 28 cycles early
  because the `$8FED` busy poll returned immediately. Re-enabling busy makes
  the boot/init checkpoints through `0x81a5`, plus `0x824d` and `0x829e`,
  cycle-exact against the filtered MAME PC tap and improves the PCM lag gate.
- YM2151 Timer A now has its own prescaler, reset on timer load, instead of
  sharing the sample/envelope accumulator. This closes the first IRQ-entry
  drift: PC checkpoints `0x81a6`, `0x81b1`, `0x81b8`, and `0x81c3` now match
  MAME exactly. It also shifts later YM tail PCM windows, so the current broad
  lag gate is `maxAbsLag=12` until the frame-boundary IRQ/NMI ordering is
  resolved.
- `probe-chip-write-diff.ts` now reports `frameDelta`,
  `sameFrameCycleDelta`, and timestamp-derived `replayCycleDelta` separately.
  The replay-cycle metric preserves signed MAME offsets before/after a command
  frame origin, so negative `cycleInFrame` labels are diagnostics instead of
  false strict-gate failures. `probe-sound-sample-diff.ts` has an explicit
  `--max-abs-lag` threshold. `probe-pc-cycles.ts` now replays the same
  cycle-precise cmd tape as the write/PCM probes, accepts `--reply-ack-tape`,
  traces the `0x8100..0x820f` IRQ/poll region, and can compare directly
  against a MAME PC tap.
- Chip-write diagnostics now estimate the bus write cycle from the executing
  6502 store opcode before emitting YM2151/POKEY events. This keeps runtime
  emulation unchanged, but aligns TS write timestamps with MAME memory taps
  (`STA/STX abs` at opcode start +3 cycles, `STA ($zp),Y` at +5 cycles).
- `probe-pc-cycles.ts` now emits focused IRQ/NMI/timer diagnostic events and
  `--timer-a-start-delay`; `probe-chip-write-diff.ts` accepts the same Timer A
  phase knob plus `--command-nmi-delay-instructions` for experiments.
  `probe-sound-sample-diff.ts` now accepts `--timer-a-start-delay` too, so
  Timer A phase hypotheses can be checked against the audible PCM gate instead
  of only against write timestamps. Default remains zero and the latest default ordered report
  `chip-write-diff-14000-order-after-nmidelay-diagnostic.json` still passes
  YM/POKEY ordered parity.
- `tickFrameWithTape` diagnostic callbacks now expose `actualCycle` and
  `actualCycleInFrame` alongside the scheduled tape cycle. The focused MAME
  window trace also emits derived `relativeCycle` and `cycleInFrame` fields, so
  future IRQ/NMI boundary checks do not need one-off timestamp conversion.
- `createSoundMmu`/`createSoundChip` now have a diagnostics-only `statusBase`
  override for `$1820`, and the PC/write/window trace probes expose it as
  `--status-base`. This preserves the `$87` default gate while making the
  `$86` first-IRQ branch experiment repeatable without source edits.
- `packages/cli/src/sound-status-replay.ts` adds a diagnostics-only status
  replay wrapper for `$1820`. `probe-chip-write-diff.ts`,
  `probe-pc-cycles.ts`, `probe-sound-window-trace.ts`, and
  `probe-sound-sample-diff.ts` accept `--status-tape`, which can read either
  full `statusReads` or compressed `statusBaseRuns`. The wrapper preserves TS
  mailbox pending bits (`$18`) and substitutes only the MAME coin/self-test base
  bits (`$e7`).
- `packages/cli/src/probe-sound-status-diff.ts` now compares ordered `$1820`
  reads directly, with `--apply-status-tape` and `--ignore-frame` modes for
  separating input-value mismatches from sequence/PC mismatches.
- `tickFrameWithTape` now has a diagnostics-only `resetReleaseDelayCycles`
  option. `probe-chip-write-diff.ts`, `probe-ym-writes.ts`,
  `probe-pc-cycles.ts`, `probe-sound-status-diff.ts`,
  `probe-sound-window-trace.ts`, and `probe-sound-sample-diff.ts` expose it as
  `--reset-release-delay`. The default is `0` and preserves current replay
  parity.
- `createSoundChip` now has a diagnostics-only `mainReplyAckDelayCycles`
  option. The same CLI probes expose it as `--reply-ack-delay`; default `0`
  preserves the existing immediate reply auto-ack path.
- `createSoundChip` also accepts a diagnostics/oracle
  `mainReplyAckCycle(event)` scheduler. `probe-chip-write-diff.ts`,
  `probe-sound-status-diff.ts`, `probe-sound-window-trace.ts`, and
  `probe-sound-sample-diff.ts` expose the MAME-backed scheduler as
  `--reply-ack-tape`.

## Next Action

1. Keep YM2151/POKEY ordered reg/val/PC parity as closed over the 14000-frame
   oracle unless new evidence appears; use cycle timing only as a stricter
   diagnostic, not the current gate.
2. Treat the `0.95` PCM correlation and `maxAbsLag=12` targets as met for the
   current attract oracle windows on both `source=ym` and `source=mix`; keep
   broadening scenarios/windows, especially POKEY-audible windows, before
   claiming byte-perfect parity.
3. Continue residual DSP/mixer work only with evidence: the direct YM gate is
   now essentially closed when the probe mirrors MAME stream scheduling plus the
   default LoFi resampler, so the remaining YM work is promotion/integration
   rather than another operator-core guess. The SoundChip replay probe can now
   opt into `--ym-scheduler mame-stream`; on the 14000-frame attract tape it
   cuts worst lag to `3` with linear resampling, and the forced mixed
   `cmd 0x00..0x05` runtime gate now passes at worst correlation `0.99403` /
   lag `5`, but neither result is default browser or gameplay behavior yet. Keep
   the new OPM LFO noise and EG_QUIET fixes as correctness work. POKEY-only
   direct gates are broad enough for the current `/28` model. The forced direct
   mixed path now has a much stronger diagnostic candidate: YM MAME-stream/LoFi,
   POKEY linear, and POKEY post-resample output delay `+3` closes the full-mix
   direct gate at lag `0`, RMS `0.00140`, and maxAbs `0.01616`. The browser
   `soundReplay` path now exposes the same combination as explicit replay-only
   URL flags. A direct-render timing sweep now explains that delay as a POKEY
   register-write timing class: `--pokey-write-cycle-offset 112` is equivalent
   to `3.0037` output samples at 48 kHz and reaches the same direct full-mix
   gate without `--pokey-output-sample-offset`. The corresponding SoundChip
   replay diagnostic now exists as `--pokey-write-apply-delay 112` and browser
   `soundReplayPokeyWriteApplyDelay=112`: it delays POKEY register state
   application from the estimated bus-write cycle while leaving diagnostic
   write events at their original timestamp. This replaces the POKEY output
   offset in the forced runtime mixed gate, but it is still not default
   browser/gameplay behavior because strict event timing and residual YM/runtime
   timing are not closed. The CLI probe and browser renderer still
   share the linear resampler in promoted default paths; `resampleMameLofi`
   remains opt-in. Use
   `--mame-ym-writes` / `--mame-pokey-writes` to separate DSP residuals from
   6502 scheduling before changing either side. Do not patch 6502 timing until a
   localized interrupt sampling or bus-cycle cause is proven.
4. Use the new status replay only as a diagnostic while investigating the
   read-count/interrupt-state mismatch. Do not promote the full MAME `$1820`
   status timeline into default replay: it currently fails ordered YM parity at
   write `#275037`.
5. Continue the reset/NMI/main-ack phase investigation from the strict
   all-mismatch and POKEY+3 runtime reports, not from constant offsets. The
   latest forced-runtime sweep rejects `--reset-release-delay 30`,
   `--reply-ack-delay 24/70`, `--defer-chip-write-timing`, and
   `--defer-ym-audio-write-timing`; `--command-nmi-delay-instructions 1` and
   `--command-nmi-sample-cycle 0/4` have no useful effect. The frame-699/700
   forced trace shows one `commandNearMiss` class, but the regenerated strict
   report counts only `13` YM and `4` POKEY near-miss mismatches; the larger
   target is the repeated `25..27` cycle pre-command phase lead in TS. The next
   model must be scheduled from a real variable MAME 6502
   interrupt/status/main-ack rule. The latest command-target sweep adds two
   rejected controls: global `--command-cycle-offset 4..32` worsens strict
   meanAbs to roughly `48..49` cycles, and post-reset-only offsets
   (`--command-cycle-offset-start-frame 245`) leave the class around `26`
   cycles. `--reset-release-delay 25/26` is useful evidence because it reduces
   strict write meanAbs to about `3.4` cycles on the forced 760-frame tape, but
   it still cannot be promoted: the matched forced runtime PCM gate drops to
   correlation about `0.756` with worst lag `1910` samples. Small post-reset
   command offsets combined with reset delays do not close the residual.
   New MAME evidence localizes the reset part of that phase: the focused
   `mame_sound_window_trace_244_245_bankwrite.json` artifact logs `$FE0001=0x00`
   at frame-244 `cycleInFrame=0` and `$860001=0x80` at `cycleInFrame=19`.
   Adding the 6502 reset sequence cost (`7` cycles) explains why
   `--reset-release-delay 26` moves the first strict YM write to TS `2461`
   versus MAME `2462`, but the same reset-delay plus
   `--pokey-write-apply-delay 112` is still rejected by PCM
   (`pcm-diff-inject0005-760-runtime-mix-pokey-applydelay112-resetdelay26-rejected.json`,
   worst correlation `0.7557`, worst lag `1910`, worst RMS `0.07909`, maxAbs
   `0.17837`). Because current TS `releaseSoundReset()` resets `cpu.cycles` to
   zero, the hardware bank-release delay alone is represented by
   `--reset-release-delay 19`; this improves strict meanAbs to roughly
   `7..8` cycles and passes the forced runtime PCM gate with
   `--pokey-write-apply-delay 112`
   (`pcm-diff-inject0005-760-runtime-mix-pokey-applydelay112-resetdelay19-gated.json`,
   worst correlation `0.9975`, lag `1`, RMS `0.00648`, maxAbs `0.07513`).
   Keep it as an opt-in replay diagnostic because strict timing is still early
   by about `8` cycles and the zero-reset-delay POKEY apply-delay PCM baseline
   is cleaner. The new focused PC/write trace support proves the write-bus
   offset is not the remaining bug: `probe-sound-window-trace-diff.ts` pairs
   MAME `mame_sound_window_trace_244_245_pcwrite.json` with TS
   `ts_sound_window_trace_244_245_resetdelay19_pcwrite.json` and writes
   `window-trace-diff-244-245-resetdelay19.json`, where `pcToWriteDelta=0` for
   all `52` comparable YM/POKEY writes. The same diff against
   `ts_sound_window_trace_244_245_resetdelay26_pcwrite.json` also reports
   `pcToWriteDelta=0`: reset-delay `26` only moves the global PC/write phase
   closer in this boot window and remains rejected by PCM. The strict write
   delta equals the PC-fetch delta, so the next fix must adjust PC/reset/
   interrupt phase, not `diagnosticWriteCycleOffset`.
   The full-PC follow-up artifacts sharpen that phase target and separate MAME
   IRQ prefetch noise from a real branch divergence. The original
   `window-trace-diff-244-245-resetdelay19-pcfull.json` mismatch at ordinal
   `3200` (`MAME 244:9752 PC 0x8123`, `TS 244:9751 PC 0x81a6`) is now
   identified as a MAME 6502 IRQ prefetch/dummy-read artifact: the stateful MAME
   capture `mame_sound_window_trace_244_245_pcfull_state.json` records duplicate
   `pcFetch` events with `genpc == pc` and `ir == 0`. The diff tool now emits a
   `pcSequenceDropInterruptPrefetch` report; in
   `window-trace-diff-244-245-resetdelay19-pcfull-state.json`, that filtered
   sequence moves the first real mismatch to the IRQ handler branch:
   MAME executes `PC 0xe514` at frame-244 `cycleInFrame=10536`, while TS takes
   `PC 0xe52b` at `cycleInFrame=10529`. The controlling instruction is
   `e512: BCS e52b`, whose carry comes from the previous `$1820` status value
   shifted in the IRQ subroutine. MAME reads `$1820=$86` at `$e4e5/$e502`; TS
   reset-delay `19` reads `$87`, so TS takes the carry branch and MAME does not.
   Forcing TS `$1820` base to `$86` moves this filtered mismatch later, but it
   still fails the forced 760-frame write diff and remains the same rejected
   global status-base control. Treat this as evidence for a scenario/time-aware
   `$1820` status and interrupt-phase rule, not as another constant
   status-base, Timer A, or write-offset fix.
   The new `--status-tape-mode frame` control removes ordered-read-count drift
   from compressed MAME `statusBaseRuns`, but it is also rejected as a direct
   fix: `chip-write-diff-14000-cycle120-status-runs-framebased.json` still has
   YM `3683` and POKEY `342` mismatches under `cycleTolerance=120`, with first
   YM mismatch `#195` as a command-near-miss timing case. This proves the
   remaining status issue is coupled to interrupt/phase timing, not just to
   mapping MAME's `$86/$87/$86` runs by frame.
6. Use `--timer-a-start-delay` only as a rejected-control experiment. The old
   `29`-cycle control proves the first strict YM mismatch is Timer A
   phase-sensitive, but it breaks the long-run YM ordered gate at `PC 0x9385`.
   The smaller reset-window sweep is also rejected: with
   `--reset-release-delay 19`, `--pokey-write-apply-delay 112`, and
   `--cycle-tolerance 12`, `--timer-a-start-delay 8` improves the forced
   760-frame write diff to YM `203` / POKEY `103`, but
   `pcm-diff-inject0005-760-runtime-mix-pokey-applydelay112-resetdelay19-ta8.json`
   fails the audible PCM gate with worst correlation `0.7554`, lag `1910`, RMS
   `0.0791`, and maxAbs `0.1784`. `probe-sound-sample-diff.ts` exposes this
   flag only so Timer A hypotheses can be checked against PCM before promotion.
7. Keep `--command-nmi-delay-instructions 1` and alternate
   `--command-nmi-sample-cycle` values as no-effect/rejected controls. They do
   not improve the forced-runtime mixed POKEY+3 residual and do not replace a
   conditional interrupt sampling rule.
8. Investigate a real 6502/MAME NMI sampling rule using the contrasting
   frame-279 IRQ-handler and frame-533 music-update windows. Avoid PC-range
   special cases unless they are only diagnostic. Do not promote
   `--defer-chip-write-timing`, `--defer-ym-audio-write-timing`, or
   `--defer-ym-parameter-write-timing`: they are rejected controls until the CPU
   can execute/restart at bus-cycle granularity.
9. Do not promote `--ym-phase-advance-after-output`; the direct YM DSP probe
   shows it worsens peak residuals. Do not promote a YM resample offset either;
   the current direct sweeps keep offset `0` as the best peak case. The
   promotable YM direction is MAME stream scheduling/default LoFi resampling,
   and the scheduler is now available as an opt-in SoundChip replay probe. The
   direct mixed candidate additionally needs POKEY output delay `+3`; keep it
   diagnostics-only until it is tied to MAME mixer latency and replay timing. Do
   not wire it into browser/default gameplay until the runtime gate tradeoff is
   accepted and the web renderer path can be kept mode-explicit. Do not promote a
   POKEY resample offset either; after the exact `/28` native-rate fix, offset
   `0` is the best broad 91-window peak case. Keep
   `--pokey-sample-cycles` as a diagnostic only; per-clock output worsens the
   current worst POKEY window. Continue investigating MAME mixer/resampler
   behavior and remaining YM/POKEY DSP details with direct MAME-write-timed
   reports.
10. Keep browser `soundReplay` separate from gameplay `?sound=1`; do not add
   synthetic cues to the bit-perfect path.

## Validation Commands

Setup:

```sh
mkdir -p /tmp/sound-roms
unzip -q -o roms/marble.zip 136033.421 136033.422 -d /tmp/sound-roms
```

Focused validation:

```sh
npx tsc -b packages/engine/tsconfig.json --pretty false
npx vitest run packages/engine/test/audio-resample.test.ts packages/engine/test/m6502-mailbox.test.ts packages/engine/test/sound-chip-diagnostics.test.ts packages/engine/test/sound-chip-smoke.test.ts packages/engine/test/ym2151.test.ts packages/engine/test/pokey.test.ts packages/web/test/sound-renderer.test.ts --silent
npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false
npx tsc -p packages/cli/tsconfig.json --noEmit --pretty false
npx tsc -p packages/web/tsconfig.json --noEmit --pretty false
npm --workspace @marble-love/web run build
npm run lint
npm run context:audit
git diff --check
```

Latest local validation on 2026-05-22:

- PASS current continuation rerun:
  `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false`,
  `npx tsc -p packages/cli/tsconfig.json --noEmit --pretty false`,
  `npx tsc -p packages/web/tsconfig.json --noEmit --pretty false`,
  `npx vitest run packages/engine/test/sound-chip-diagnostics.test.ts --silent`,
  and
  `npx vitest run packages/engine/test/sound-chip-smoke.test.ts packages/engine/test/ym2151.test.ts packages/engine/test/pokey.test.ts packages/web/test/sound-renderer.test.ts --silent`
  (`77` passed, `1` skipped in the four-file audio set).
- PASS current continuation hygiene:
  `npm --workspace @marble-love/web run build` (known Vite large-chunk warning),
  `npm run context:audit`, and `git diff --check`.
- Current continuation timing artifacts:
  `chip-write-diff-inject0005-760-combined-strict-cmdoffset{0,4,8,12,16,20,24,25,26,28,32}.json`,
  `chip-write-diff-inject0005-760-combined-strict-cmdoffset{4,8,12,16,20,24,25,26,28,32}-start245.json`,
  `chip-write-diff-inject0005-760-combined-strict-resetdelay{20,24,25,26,27,28,29,30,32,36}.json`,
  and
  `pcm-diff-inject0005-760-runtime-mix-ym-lofi-pokey-linear-pokeyout3-resetdelay{0,25,26,27}-gated-allwindows.json`.
- PASS replay-only browser wiring continuation:
  `soundReplayYmResampler`, `soundReplayPokeyResampler`,
  `soundReplayYmOutputSampleOffset`, and `soundReplayPokeyOutputSampleOffset`
  are now parsed by `packages/web/src/sound-replay.ts` and applied by
  `SoundRenderer` with the shared MAME LoFi resampler. Follow-up tightened the
  browser path to use streaming linear/MAME-LoFi resampler state across
  frame-sized PCM pushes, with the output-sample offset applied once at stream
  start rather than once per frame. `soundReplay` now resets renderer PCM stream
  state and worklet PCM queues whenever the tape loops or fast-forward wraps,
  matching the SoundChip reset boundary. Focused validation passed:
  `npx vitest run packages/engine/test/audio-resample.test.ts packages/web/test/sound-renderer.test.ts packages/web/test/sound-replay.test.ts --silent`
  (`30` tests), `npx tsc -p packages/web/tsconfig.json --noEmit --pretty false`,
  and `npm --workspace @marble-love/web run build` (known Vite large-chunk
  warning). HTTP smoke on `127.0.0.1:5174` returned `200` for
  `/?autoLoad=1&soundReplay=scenarios/sound/cmd-tape-attract-music.json&soundReplayFastForward=11900&soundReplayYmScheduler=mame-stream&soundReplayYmResampler=mame-lofi&soundReplayPokeyResampler=linear&soundReplayPokeyOutputSampleOffset=3`,
  the tape JSON, and `/sound-worklet.js`. The in-app Browser tool was not
  exposed in this session.
- PASS PCM rerun matching the new replay-only URL controls:
  `pcm-diff-inject0005-760-runtime-mix-web-replay-options-rerun.json` uses
  `--ym-scheduler mame-stream --ym-native-sample-rate 55930 --ym-resampler
  mame-lofi --pokey-resampler linear --pokey-output-sample-offset 3` and passes
  19 audible windows with worst correlation `0.9979`, worst lag `2`, worst RMS
  `0.00658`, and worst maxAbs `0.06741`.
- PASS direct POKEY timing sweep explaining the `+3` output proxy:
  `pcm-diff-inject0005-760-direct-mix-pokey-writecycle112-refined-out0-with-sampleequiv.json`
  uses YM MAME-stream/LoFi, POKEY linear, no POKEY output-sample offset, and
  `--pokey-write-cycle-offset 112`. The report records
  `pokeyWriteCycleOffsetOutputSamples=3.0037` at `48 kHz` and passes with worst
  correlation `0.99978`, lag `0`, RMS `0.00142`, and maxAbs `0.01645`. The
  coarse sweep `-84..168` and refined sweep `96..128` show the basin centers
  around `108..112` cycles; combining `112` cycles with output offset `+3`
  worsens maxAbs to `0.09734`, so these are the same delay class, not two
  independent corrections.
- PASS runtime POKEY write-apply delay diagnostic:
  `pcm-diff-inject0005-760-runtime-mix-pokey-applydelay112.json` uses
  SoundChip replay with `--pokey-write-apply-delay 112`, YM MAME-stream/LoFi,
  POKEY linear, and no POKEY output-sample offset. It passes 19 audible windows
  with worst correlation `0.9982`, worst lag `2`, worst RMS `0.00593`, and
  worst maxAbs `0.06465`. The order/payload check
  `chip-write-diff-inject0005-760-order-pokey-applydelay112.json` still passes
  YM prefix `12448 / 12448` and POKEY `9672 / 9672` under infinite timing
  tolerance, while the strict control
  `chip-write-diff-inject0005-760-strict-pokey-applydelay112-fail.json`
  remains red with YM maxAbs replay-cycle delta `299` and POKEY `172`. This
  confirms the delay is a PCM phase rule for POKEY application, not a closure of
  ordered event timestamp parity.
- PASS current validation after the POKEY apply-delay patch:
  engine/CLI/web targeted typechecks, the 7-file audio/replay Vitest batch
  (`111` passed, `1` skipped), web build (known Vite large-chunk warning),
  `npm run context:audit`, `git diff --check`, and HTTP smoke on
  `http://127.0.0.1:5174/?autoLoad=1&soundReplay=scenarios/sound/cmd-tape-attract-music.json&soundReplayFastForward=11900&soundReplayYmScheduler=mame-stream&soundReplayYmResampler=mame-lofi&soundReplayPokeyResampler=linear&soundReplayPokeyWriteApplyDelay=112&soundReplayResetReleaseDelay=19`.
- PASS replay reset-release diagnostic:
  `soundReplayResetReleaseDelay=19` is now parsed by the browser replay path and
  passed into `tickFrameWithTape`. The matching gated PCM report
  `pcm-diff-inject0005-760-runtime-mix-pokey-applydelay112-resetdelay19-gated.json`
  passes 19 audible windows with worst correlation `0.9975`, worst lag `1`,
  worst RMS `0.00648`, and worst maxAbs `0.07513`. It remains opt-in because
  strict writes are still about `8` cycles early and the zero-reset-delay
  POKEY apply-delay PCM baseline is cleaner.
- PASS focused PC/write diagnostic:
  `oracle/mame_sound_window_trace.lua` and
  `packages/cli/src/probe-sound-window-trace.ts` now log selected opcode fetches
  alongside YM/POKEY writes, including the main POKEY update PCs. The artifact
  `window-trace-diff-244-245-resetdelay19.json`, produced by
  `packages/cli/src/probe-sound-window-trace-diff.ts`, shows
  `pcToWriteDelta=0` for all `52` comparable writes (`13` YM and `39` POKEY),
  proving the remaining strict write deltas are inherited from PC-fetch phase
  rather than store-bus offset modeling. The reset-delay `26` control
  `window-trace-diff-244-245-resetdelay26.json` also keeps
  `pcToWriteDelta=0`, while only shifting the global write/PC deltas.
- PASS full-PC phase-origin diagnostic:
  MAME/TS full opcode-fetch traces for frame `244..245` are now compared by
  `probe-sound-window-trace-diff.ts`. With reset-delay `19`,
  `window-trace-diff-244-245-resetdelay19-pcfull.json` has `13178` paired PC
  fetches and finds the first PC-flow mismatch at ordinal `3200`: MAME
  `244:9752 PC 0x8123`, TS `244:9751 PC 0x81a6`. With reset-delay `26`,
  `window-trace-diff-244-245-resetdelay26-pcfull.json` moves the initial
  baseline from `-8` to `-1` cycle but keeps the same first mismatch. The
  status-base control
  `window-trace-diff-244-245-resetdelay19-status86-pcfull.json` still mismatches
  at the same ordinal, so the next implementation target is the 6502
  prefetch/restart/IRQ sampling model.
- PASS stateful MAME prefetch filter diagnostic:
  `oracle/mame_sound_window_trace.lua` now records MAME sound-CPU `curpc`,
  `genpc`, `ir`, `opcode`, and `A/X/Y/P/SP` on `pcFetch` / `statusRead`
  events, and
  `probe-sound-window-trace-diff.ts` emits both the raw `pcSequence` and
  `pcSequenceDropInterruptPrefetch`. In the stateful artifact
  `window-trace-diff-244-245-resetdelay19-pcfull-state.json`, the old
  `PC 0x8123` mismatch is classified as an IRQ prefetch/dummy-read pair, and
  the filtered first real mismatch moves to the IRQ handler: MAME
  `244:10536 PC 0xe514`, TS `244:10529 PC 0xe52b`. The branch at `e512` depends on carry
  from `$1820`: MAME reads `$86` at `$e4e5/$e502`, while TS reset-delay `19`
  reads `$87`. The status-base `$86` control moves this local filtered mismatch
  later but still fails the forced 760-frame write diff, so it remains
  diagnostic only.
- PASS status-branch trace diagnostic:
  `probe-sound-window-trace-diff.ts` now emits ordered `$1820` `statusReads`
  and a `firstBranchingMismatch` helper. The artifact
  `window-trace-diff-244-245-resetdelay19-pcfull-regs-statusbranch.json`
  reports status mismatch `#43`: MAME `244:10508 PC 0xe4e5 = 0x86`, TS
  `244:10497 PC 0xe4e5 = 0x87`, followed within `10` filtered opcode fetches
  by the same branch mismatch, MAME `244:10536 PC 0xe514` versus TS
  `244:10529 PC 0xe52b`. This makes the `$1820` / IRQ-branch cause
  reproducible from one report instead of manual trace inspection. The new
  register fields prove the branch behavior itself is correct: at `PC 0xe512`,
  MAME has `A=0x00 P=0x36` (carry clear) after shifting `$86`, while TS has
  `A=0x00 P=0x27` (carry set) after shifting `$87`.
- REJECTED frame-based status run replay:
  `packages/cli/src/sound-status-replay.ts` now supports a diagnostics-only
  frame-based application of compressed MAME `statusBaseRuns`, exposed through
  `probe-chip-write-diff.ts --status-tape-mode frame`. The 14000-frame report
  `chip-write-diff-14000-cycle120-status-runs-framebased.json` applies all
  `5857325` TS status reads without exhaustion, but still worsens the current
  cycle-120 write gate to YM `3683` and POKEY `342` mismatches. The first YM
  mismatch is still a command-near-miss timing case at write `#195`
  (`PC 0x81bb`, TS `6` cycles before command target, MAME `166` after), so this
  rejects simple frame-based `$1820` replay as the bit-perfect path.
- REJECTED small Timer A phase control:
  `chip-write-diff-inject0005-760-cycle12-resetdelay19-ta8-pokeyapply112.json`
  improves the forced 760-frame cycle-tolerance-12 write diff to YM `203` /
  POKEY `103`, but
  `pcm-diff-inject0005-760-runtime-mix-pokey-applydelay112-resetdelay19-ta8.json`
  fails the PCM gate with worst correlation `0.7554`, worst lag `1910`, worst
  RMS `0.0791`, and worst maxAbs `0.1784`. The `ta7` PCM control fails the
  same way. Do not promote a global Timer A start delay.
- PASS `npx tsc -b packages/engine/tsconfig.json --pretty false`.
- PASS `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false`.
- PASS `npx tsc -p packages/cli/tsconfig.json --noEmit --pretty false`.
- PASS `npx tsc -p packages/web/tsconfig.json --noEmit --pretty false`.
- PASS `npx vitest run packages/engine/test/audio-resample.test.ts packages/engine/test/m6502-mailbox.test.ts packages/engine/test/sound-chip-diagnostics.test.ts packages/engine/test/sound-chip-smoke.test.ts packages/engine/test/ym2151.test.ts packages/engine/test/pokey.test.ts packages/web/test/sound-renderer.test.ts --silent`
  plus `packages/web/test/sound-replay.test.ts`
  (`8` files, `119` passed, `1` skipped).
- PASS direct MAME-write-timed probes:
  `pcm-diff-inject0005-760-ym-window477184-mame-write-timed.json`,
  `pcm-diff-inject0005-760-ym-mame-write-timed.json`, and
  `pcm-diff-inject0005-760-pokey-mame-write-timed.json`.
- REJECTED `--ym-phase-advance-after-output` direct YM probes:
  `pcm-diff-inject0005-760-ym-window477184-phase-after-output.json`
  (`maxAbs 0.04629`, worse than direct baseline `0.04480`) and
  `pcm-diff-inject0005-760-ym-mame-write-timed-phase-after-output.json`
  (`worstMaxAbs 0.06454`, worse than direct baseline `0.05215`).
- REJECTED YM resample-offset probes as a global fix:
  `pcm-diff-inject0005-760-ym-mame-write-timed-resample-neg025.json`
  (`worstMaxAbs 0.05428`, worse than direct baseline `0.05215`) and
  `pcm-diff-inject0005-760-ym-window477184-resample-neg025.json`
  (`maxAbs 0.04791`, worse than direct baseline `0.04480`).
- PASS YM-only direct MAME stream/LoFi isolation:
  `oracle/mame_ym2151_write_log.lua` now supports `MARBLE_SOUND_MUTE_POKEY=1`
  for YM-only forced-command WAV capture while preserving YM write logging. With
  `--ym-scheduler mame-stream --ym-native-sample-rate 55930 --resampler
  mame-lofi`, `pcm-diff-inject0005-760-ym-window477184-mame-stream-lofi.json`
  passes the focused channel-6 window at correlation `0.9999977`, lag `0`, RMS
  `0.000136`, maxAbs `0.00251`; the broad
  `pcm-diff-inject0005-760-ym-mame-stream-lofi-35w.json` selects 35 audible
  windows and passes with worst correlation `0.999964`, lag `0`, RMS
  `0.000256`, and maxAbs `0.00349`. This shows the old direct YM residual was
  MAME stream scheduling/default LoFi resampler mismatch, not an operator-DSP
  mismatch under identical native scheduling.
- PASS SoundChip replay opt-in YM MAME stream scheduler:
  `createSoundChip` now supports diagnostics/replay `ymAudioScheduler:
  "mame-stream"` and `probe-sound-sample-diff.ts` wires it from
  `--ym-scheduler mame-stream` for non-direct cmd-tape renders. On the
  14000-frame attract tape, `pcm-diff-50w-lag12-ym-mame-stream-linear-runtime.json`
  passes all 38 audible windows with worst correlation `0.99666`, worst lag
  `3`, worst RMS `0.00246`, and worst maxAbs `0.01425`. This reduces the old
  lag bound pressure but is not yet the default browser/gameplay path.
  `packages/web/src/sound-replay.ts` can now opt into the same scheduler via
  `soundReplayYmScheduler=mame-stream`; unit tests cover the URL parsing and
  default `55930` integer stream rate.
- REJECTED SoundChip replay LoFi-only promotion:
  `pcm-diff-50w-lag12-ym-mame-stream-lofi-runtime.json` still passes with
  MAME-stream YM but worsens RMS/maxAbs (`0.00358` / `0.01740`) versus linear.
  `pcm-diff-50w-lag12-ym-cycle-mame-lofi-runtime.json` fails the lag gate with
  worst lag `70`. Keep MAME LoFi opt-in for runtime replay until chip write
  timing and mixed-chip scheduling are tighter.
- REJECTED SoundChip replay YM stream offsets/fractional native rate:
  `pcm-diff-50w-lag12-ym-mame-stream-linear-offset-neg025-runtime.json`
  improves worst RMS to `0.00228` but worsens peak maxAbs to `0.01436` versus
  offset-0 `0.01425`; `-0.125` and `-0.5` worsen peak further (`0.01565` and
  `0.01637`), and `+0.25` worsens maxAbs to `0.02027`.
  `pcm-diff-50w-lag12-ym-mame-stream-rate55930375-linear-runtime.json` fails
  the lag gate with worst lag `70`; the widened all-window forced-fractional
  report `pcm-diff-attract-runtime-ym-mame-stream-rate55930375-allwindows-hop4096.json`
  reproduces the same drift. The probe default now matches browser replay:
  omitted `--ym-native-sample-rate` under `--ym-scheduler mame-stream` uses the
  integer MAME stream rate `55930`; cycle mode keeps `55930.375`.
- PASS wider SoundChip replay YM stream gate:
  `pcm-diff-attract-runtime-ym-mame-stream-rate55930-default-allwindows-hop4096.json`
  selects all `76` audible attract windows with MAME-stream YM and linear
  resampling. It passes `minCorrelation=0.95` and `maxAbsLag=12` with worst
  correlation `0.99664`, worst lag `3`, RMS `0.00219`, and maxAbs `0.01954`.
  The direct YM isolation regression
  `pcm-diff-inject0005-760-ym-mame-stream-lofi-35w-default-rate55930.json`
  also stays tight: `35` selected windows, lag `0`, worst RMS `0.00024`, and
  maxAbs `0.00349`.
- PASS forced mixed runtime gate:
  `probe-sound-sample-diff.ts` now records effective per-chip resamplers through
  diagnostics-only `--ym-resampler` and `--pokey-resampler`; omitted values
  inherit `--resampler`. It also has diagnostics-only
  `--ym-output-sample-offset` and `--pokey-output-sample-offset` for integer
  post-resample component delay/advance experiments. With MAME-stream YM and
  linear YM/POKEY resampling,
  `pcm-diff-inject0005-760-runtime-mix-ym-mame-stream-linear-resamplerflags-allwindows.json`
  selects `37` audible full-mix windows and passes `minCorrelation=0.95` plus
  `maxAbsLag=12` with worst correlation `0.99403`, worst lag `5`, RMS
  `0.00836`, and maxAbs `0.12329`.
- PASS direct-write mixed control, but not bit/sample parity:
  `pcm-diff-inject0005-760-direct-mix-ym-mame-stream-linear-resamplerflags-allwindows.json`
  uses MAME YM/POKEY write logs against the same full MAME WAV and improves the
  mixed gate to worst correlation `0.99671`, lag `5`, RMS `0.00681`, and maxAbs
  `0.09810`. That separates part of the runtime residual into 6502/device
  scheduling, while the remaining maxAbs keeps the scenario short of
  bit-perfect.
- Historical direct-write mixed candidate with per-chip output timing:
  The full-mix direct residual is largely a component-latency issue. Direct YM
  MAME-stream/LoFi wants lag `0`; direct POKEY in the full mix wants
  worstAbsLag `3`. With YM MAME-stream/LoFi, POKEY linear, and
  `--pokey-output-sample-offset 3`,
  `pcm-diff-inject0005-760-direct-mix-ym-lofi-pokey-linear-pokeyout3-strict-allwindows.json`
  passed all `37` audible full-mix windows under a stricter gate:
  `minCorrelation=0.999`, `maxAbsLag=1`, `maxRms=0.0015`, `maxAbs=0.017`.
  Measured worsts were correlation above `0.9998`, lag `0`, RMS `0.00140`,
  and maxAbs `0.01616`. A current rerun after the POKEY clock correction no
  longer reproduces this strict bound (`corr=0.9975`, lag `1`, RMS `0.00504`,
  maxAbs `0.05193`), so treat the old report as historical until the current
  direct POKEY/mixed residual is explained. The old component control
  `pcm-diff-inject0005-760-direct-fullminusym-pokey-ymlofi-allwindows.json`
  is also historical. The current component rerun needs
  `--pokey-resample-offset -1 --pokey-output-sample-offset 3` to pass `21`
  POKEY-residual windows at worst correlation `0.99907`, RMS `0.00241`, and
  maxAbs `0.03350`, while the same phase fails the full direct mix at maxAbs
  `0.07407` and fails the wider YM-muted `inject001f` POKEY gate at maxAbs
  `0.04392`. The opposite POKEY output offset `-3` worsens maxAbs to
  `0.13897`.
- PASS improved runtime mixed diagnostic, still not bit-perfect:
  Applying YM-LoFi/POKEY-linear with `--pokey-resample-offset -0.75`,
  `--pokey-output-sample-offset 3`, and lag-tie epsilon `0.00003`,
  `pcm-diff-inject0005-760-runtime-mix-pokey-resample-neg075-out3-allwindows-current.json`
  passes all `37` current windows with `minCorrelation=0.99`, `maxRms=0.0067`,
  and `maxAbs=0.084`; measured worsts are correlation `0.9936`, lag `3`, RMS
  `0.00526`, and maxAbs `0.08300`. The older POKEY+3-only artifact is
  historical: re-running it on current code misses the RMS gate at `0.00707`
  even though maxAbs improves to `0.07805`. This improves the prior runtime
  full-mix maxAbs from `0.12329`, but the remaining gap tracks replay/write
  timing. The equivalent direct-write candidate is no longer strict-green on
  the current code, so the remaining gap is split between direct POKEY/mixed
  residual and replay timing.
- TRACE forced mixed worst transient:
  `pcm-diff-inject0005-760-runtime-mix-worst561152-channeltrace.json` localizes
  the runtime maxAbs peak at sample `566589` / MAME sample `566590`: TS
  `0.02207`, MAME `-0.10123`, diff `0.12329`. POKEY is silent at the peak and
  YM channel 1 is dominant, so the worst full-mix transient is a YM/timing edge,
  not a POKEY steady-gain issue.
- REJECTED mixed LoFi/per-chip resampler controls:
  Global runtime LoFi
  `pcm-diff-inject0005-760-runtime-mix-ym-mame-stream-lofi-allwindows.json`
  passes the loose gate but worsens correlation/RMS/maxAbs to `0.9859` /
  `0.01285` / `0.13765`; direct global LoFi
  `pcm-diff-inject0005-760-direct-mix-ym-mame-stream-lofi-allwindows.json`
  fails the lag gate with worst lag `1471`. Hybrid YM-LoFi/POKEY-linear without
  the POKEY output delay also fails the lag gate in both direct and runtime reports
  (`pcm-diff-inject0005-760-direct-mix-ym-lofi-pokey-linear-allwindows.json`,
  `pcm-diff-inject0005-760-runtime-mix-ym-lofi-pokey-linear-allwindows.json`),
  each at worst lag `1469`.
- STRICT timing residual on the forced mix:
  `chip-write-diff-inject0005-760-combined-strict-runtime-mix.json` shows ordered
  write contents are still useful for the scenario, but exact replay-cycle timing
  is not closed: YM maxAbs replay-cycle delta `299`, POKEY maxAbs `172`, with
  repeated clusters around YM PCs `0x8e9c` / `0x8eaf` and POKEY update PCs
  `0x8e28`..`0x8e6f`. Do not hide this with resampler changes.
  The full mismatch capture
  `chip-write-diff-inject0005-760-combined-strict-allmismatches.json` confirms
  the frame `700..720` residual is systematic rather than a single outlier:
  POKEY writes at `PC 0x8e28..0x8e6f` and YM writes at `PC 0x81bb/0x81c3` and
  `0x8e9c/0x8eaf` are typically early by about `15..36` replay cycles
  (`-24..-26` is common; frame `711` POKEY updates show about `-26` and `-33`).
  That matches the remaining runtime PCM residual class.
  `oracle/mame_sound_window_trace.lua` now accepts the same forced-command
  injection env as `mame_sound_cmd_capture.lua`, so MAME window traces can match
  the forced `0x00..0x05` tape. The frame `699..700` trace proves a real command
  boundary case: MAME reaches `PC 0x8e9c` at frame-700 `cycleInFrame=-39`, writes
  at `-36`, then takes the command/NMI before `PC 0x8eaf`; it resumes at
  `PC 0x8ea9`/`0x8eac` after the handler and writes `0x8eaf` at `+166`. TS has
  already executed the matching `0x8eaf` write in frame `699`, `2` cycles before
  the command target. `probe-chip-write-diff.ts` now reports this as a
  `commandNearMiss` class, but the class explains only `13` YM and `4` POKEY
  strict mismatches in the forced 760-frame report, so it is a real edge case,
  not the dominant residual. The dominant residual is still the broader
  pre-command phase: TS is about `25..27` cycles ahead through the
  `0x8e8x..0x8eaf` music-update path. A small preemption-lookahead sweep
  `1..6` cycles did not improve the strict report, and `--status-base 0x86`
  keeps the same mean timing class (`YM` meanAbs about `26.21`, `POKEY` about
  `26.62`), so neither should be promoted.
- REJECTED/NO-EFFECT constant timing controls on the forced runtime mix:
  with the same YM-LoFi/POKEY-linear/POKEY+3 diagnostic baseline
  (`corr=0.9936`, lag `2`, RMS `0.00661`, maxAbs `0.08308`),
  `--reset-release-delay 30` collapses to correlation `0.7558` and lag `1725`;
  `--reply-ack-delay 70` worsens maxAbs to `0.11769`, and
  `--reply-ack-delay 24` worsens to correlation `0.8617` and maxAbs `0.21510`;
  `--defer-chip-write-timing` worsens to correlation `0.9643`, lag `985`, and
  maxAbs `0.13519`; `--defer-ym-audio-write-timing` worsens lag to `1466` and
  maxAbs to `0.12665`. `--command-nmi-delay-instructions 1` and
  `--command-nmi-sample-cycle 0/4` are effectively identical to the baseline.
  These are controls, not promotable fixes; the next timing fix needs a real
  variable MAME 6502 interrupt/status/main-ack rule.
- TRACE reset-release source:
  `oracle/mame_sound_window_trace.lua` now records `$860001` as `bankWrite`.
  The focused MAME run
  `mame_sound_window_trace_244_245_bankwrite.json` shows frame-244
  `$FE0001=0x00` at `cycleInFrame=0` and the `$860001=0x80` sound reset release
  at `cycleInFrame=19`. Together with the 6502 reset sequence's `7` cycles,
  this accounts for the initial `~26` cycle strict write phase:
  `--reset-release-delay 26` moves the first YM write to TS `2461` versus MAME
  `2462`. A tolerance sweep around that delay confirms most residuals are now
  single-digit cycles (`tol16` leaves YM `77` and POKEY `48` mismatches), but
  this is still rejected for PCM when combined with the then-tested POKEY apply
  delay:
  `pcm-diff-inject0005-760-runtime-mix-pokey-applydelay112-resetdelay26-rejected.json`
  bottoms out at correlation `0.7557`, lag `1910`, RMS `0.07909`, and maxAbs
  `0.17837`. The replay-semantics control `--reset-release-delay 19` instead
  represents the measured bank-release delay alone, passes the same forced PCM
  gate as
  `pcm-diff-inject0005-760-runtime-mix-pokey-applydelay112-resetdelay19-gated.json`
  with worst correlation `0.9975`, lag `1`, RMS `0.00648`, and maxAbs
  `0.07513`, but remains diagnostic-only because strict writes are still about
  `8` cycles early and the zero-reset-delay PCM baseline is cleaner.
- PASS exact POKEY `/28` native-rate fix:
  `POKEY_NATIVE_SAMPLE_RATE` is now `1_789_772 / 28`, not rounded to `63920`.
  The broad YM-key-muted `0x00..0x0f` direct POKEY sweep
  `pcm-diff-inject0015-1120-pokey-mame-write-timed-wide-hop4096-exact-rate.json`
  selects 91 windows and improves worst maxAbs from `0.06274` to `0.02711`,
  worst RMS to `0.00158`, worst correlation to `0.99973`, and max lag to `3`.
- HISTORICAL wider POKEY direct gate:
  `mame_inject001f_1700_ymkeymuted.wav` plus
  `mame_pokey_writes_inject001f_1700_ymkeymuted.json` cover forced commands
  `0x00..0x1f` and `27105` POKEY writes. The older all-window direct report
  `pcm-diff-inject001f-1700-pokey-mame-write-timed-allwindows-hop4096-exact-rate-lag12search.json`
  selected all `205` audible windows and passed with worst correlation
  `0.99973`, worst lag `3`, worst RMS `0.00158`, and worst maxAbs `0.02711`.
  A current metadata-bearing offset-0 rerun,
  `pcm-diff-inject001f-1700-pokey-mame-write-timed-current-baseline-lag12.json`,
  no longer reproduces that pass: worst correlation is `0.99738`, lag `4`,
  RMS `0.00417`, and maxAbs `0.06182`. Treat the old pass as stale until the
  current direct POKEY/mixed residual is explained. A `--max-lag 2000` control
  exposed periodic-lag ambiguity rather than a DSP
  regression: four windows choose far equivalent lags up to `1652`, while the
  bounded `maxAbsLag=12` proof keeps the same residual envelope.
  PASS opt-in lag tie-break for the same control:
  `pcm-diff-inject001f-1700-pokey-mame-write-timed-allwindows-hop4096-exact-rate-lagtie3e-5.json`
  runs the wide `--max-lag 2000` search with
  `--lag-tie-correlation-epsilon 0.00003`, passes with worst lag `3`, and
  preserves the absolute far-lag evidence in `absoluteBestLag` /
  `absoluteBestCorrelation` fields.
- REJECTED POKEY offsets after the exact-rate fix:
  `pcm-diff-inject0015-1120-pokey-mame-write-timed-wide-hop4096-exact-rate-neg02.json`
  worsens worst maxAbs to `0.04307`, and
  `pcm-diff-inject0015-1120-pokey-mame-write-timed-wide-hop4096-exact-rate-pos005.json`
  worsens it to `0.02855`; keep `--pokey-resample-offset` diagnostic-only.
  The wider `0x00..0x1f` offset sweep confirms offset `0` is still the global
  best: over 205 windows it holds `worstRms=0.00158` and
  `worstMaxAbs=0.02711`, while `-0.25` worsens maxAbs to `0.05012`, `+0.25`
  to `0.04337`, and `+1.5` to `0.03418`
  (`pcm-diff-inject001f-1700-pokey-mame-write-timed-allwindows-hop4096-exact-rate-offset1p5.json`).
  Offset `+1.5` improves the local attack sample around `720896`, but not the
  aggregate gate.
- SUPERSEDED POKEY direct write-timing diagnostic:
  `probe-sound-sample-diff.ts` now has `--pokey-write-cycle-offset` for
  direct MAME-write renders only. The default remains `0`. The older artifacts
  below recorded a promising `-1` timing class:
  `pcm-diff-inject001f-1700-pokey-write-offset-m1-allwindows-lagtie3e-5.json`
  and `pcm-diff-inject001f-1700-pokey-write-offset-m1-strict-pcm-gate.json`
  reported `205` passing windows near worst correlation `0.99978`, RMS
  `0.00146`, and maxAbs `0.02633`. A current rerun overwrote the strict report
  and rejects that result on the live code: worst correlation `0.99769`, far
  lag `1314`, RMS `0.00381`, and maxAbs `0.05604`. The current bounded-lag
  offset sweep in
  `/tmp/marble-love/audio-bitperfect/current-pokey-offset-sweep/` uses loose
  diagnostic thresholds and ranks `-3` best (`corr=0.99825`, lag `4`,
  RMS `0.00341`, maxAbs `0.04447`), then `-2`, `-1`, `0`, `+1`, `+2`, `+3`.
  Treat the whole class as MAME write-tap/update-boundary evidence until the
  POKEY stream/update boundary is proven from source or a stable broad gate.
- REJECTED POKEY LoFi-only direct render:
  `pcm-diff-inject0015-1120-pokey-mame-write-timed-wide-hop4096-exact-rate-mame-lofi.json`
  still passes the broad correlation gate but worsens worst maxAbs to
  `0.06202`, worst RMS to `0.00525`, and lag to `7` versus the exact-rate
  linear baseline. Do not promote `--resampler mame-lofi` for POKEY without a
  separate MAME stream-scheduler model.
  The wider `0x00..0x1f` LoFi control
  `pcm-diff-inject001f-1700-pokey-mame-write-timed-allwindows-hop4096-exact-rate-mame-lofi.json`
  confirms the rejection with worst maxAbs `0.06774`, RMS `0.00519`, and lag
  `10`.
- PASS POKEY channel diagnostic on the old broad-sweep worst window:
  `pcm-diff-inject0015-1120-pokey-worst786432-channeltrace-exact-rate.json`
  passes correlation `0.9999`, lag `-3`, RMS `0.00149`, and maxAbs `0.01969`.
  The peak residual remains a CH0+CH1 transition, now TS `0.09136` vs MAME
  `0.11105` instead of the old `0.04831` vs `0.11105`.
- PASS wider POKEY channel diagnostic/classification:
  `pcm-diff-inject001f-1700-pokey-worst720896-channeltrace.json` passes with
  correlation `0.9999`, lag `-3`, RMS `0.00149`, and maxAbs `0.02711`. The
  peak sample is a CH0+CH1 attack transient (`TS 0.04793`, MAME `0.07504`)
  followed by a near-matching plateau, so the residual is transition/phase
  shaped rather than steady gain or channel routing.
- REJECTED per-clock POKEY output as a fix:
  `pcm-diff-inject0015-1120-pokey-worst786432-samplecycle1-channeltrace.json`
  worsens the same window to maxAbs `0.11105`; keep
  `--pokey-sample-cycles` diagnostic-only.
- PASS web renderer offset plumbing:
  `npx vitest run packages/web/test/sound-renderer.test.ts --silent`
  verifies YM/POKEY PCM push offsets are forwarded into the shared resampler.
- PASS Vite HTTP smoke for
  `/?autoLoad=1&soundReplay=scenarios/sound/cmd-tape-attract-music.json&soundReplayFastForward=11900&soundReplayPokeyResampleOffset=-0.2`
  and `scenarios/sound/cmd-tape-attract-music.json` (`200 OK` for both). The
  latest replay scheduler smoke also returned `200 OK` for
  `/?autoLoad=1&soundReplay=scenarios/sound/cmd-tape-attract-music.json&soundReplayFastForward=11900&soundReplayYmScheduler=mame-stream`,
  `scenarios/sound/cmd-tape-attract-music.json`, and `/sound-worklet.js`. The
  in-app Browser automation backend was not exposed in this session, so this is
  an HTTP smoke, not an interactive AudioContext/browser playback proof.
- PASS default cmd-tape replay rerun after the direct-render refactor:
  `pcm-diff-inject0005-760-ym-after-direct-render-refactor.json`.
- PASS `npm --workspace @marble-love/web run build` with the existing Vite
  large-chunk warning.
- PASS `npm run lint`.
- PASS `npm run context:audit`.
- PASS `git diff --check`.

Oracle/diff examples:

```sh
MARBLE_YM_TARGET=2000 MARBLE_YM_MAX_WRITES=70000 MARBLE_YM_OUT=/tmp/marble-love/audio-bitperfect/mame_ym_writes.json \
  mame marble -rompath roms -video none -skip_gameinfo -nothrottle -seconds_to_run 40 \
  -nvram_directory /tmp/marble-love/audio-bitperfect/nv \
  -cfg_directory /tmp/marble-love/audio-bitperfect/cfg -nonvram_save \
  -autoboot_script oracle/mame_ym2151_write_log.lua -autoboot_delay 0

MARBLE_POKEY_TARGET=2000 MARBLE_POKEY_OUT=/tmp/marble-love/audio-bitperfect/mame_pokey_writes.json \
  mame marble -rompath roms -video none -skip_gameinfo -nothrottle -seconds_to_run 40 \
  -nvram_directory /tmp/marble-love/audio-bitperfect/nv \
  -cfg_directory /tmp/marble-love/audio-bitperfect/cfg -nonvram_save \
  -autoboot_script oracle/mame_pokey_write_tap.lua -autoboot_delay 0

MARBLE_SOUND_MUTE_YM=1 MARBLE_POKEY_TARGET=760 \
  MARBLE_POKEY_OUT=/tmp/marble-love/audio-bitperfect/mame_pokey_writes_inject0005_760_ymkeymuted.json \
  MARBLE_SOUND_INJECT_START_FRAME=500 MARBLE_SOUND_INJECT_SPACING=30 \
  MARBLE_SOUND_INJECT_COUNT=6 MARBLE_SOUND_INJECT_FIRST_BYTE=0 \
  mame marble -rompath roms -video none -skip_gameinfo -nothrottle -seconds_to_run 20 \
  -nvram_directory /tmp/marble-love/audio-bitperfect/nv \
  -cfg_directory /tmp/marble-love/audio-bitperfect/cfg -nonvram_save \
  -wavwrite /tmp/marble-love/audio-bitperfect/mame_inject0005_760_ymkeymuted.wav \
  -autoboot_script oracle/mame_pokey_write_tap.lua -autoboot_delay 0

npx tsx packages/cli/src/probe-ym-writes.ts --frames 2000 \
  --cmd-tape oracle/scenarios/sound-cmd-tape-attract-cycle-precise.json \
  --out /tmp/marble-love/audio-bitperfect/ts_ym_writes.json

npx tsx packages/cli/src/probe-chip-write-diff.ts \
  --mame-ym /tmp/marble-love/audio-bitperfect/mame_ym_writes.json \
  --frames 2000 \
  --cmd-tape oracle/scenarios/sound-cmd-tape-attract-cycle-precise.json \
  --kinds ym2151 --compare-count 1098 --frame-tolerance 1 \
  --cycle-tolerance 999999 \
  --report /tmp/marble-love/audio-bitperfect/ym-write-diff-1098-order.json

npx tsx packages/cli/src/probe-chip-write-diff.ts \
  --mame-pokey /tmp/marble-love/audio-bitperfect/mame_pokey_writes.json \
  --frames 2000 \
  --cmd-tape oracle/scenarios/sound-cmd-tape-attract-cycle-precise.json \
  --kinds pokey --compare-count 2000 --frame-tolerance 1 \
  --cycle-tolerance 999999 \
  --report /tmp/marble-love/audio-bitperfect/pokey-write-diff-2000-order.json

npx tsx packages/cli/src/probe-sound-sample-diff.ts \
  --mame /tmp/marble-love/audio-bitperfect/mame_attract.wav \
  --frames 14000 \
  --cmd-tape oracle/scenarios/sound-cmd-tape-attract-cycle-precise.json \
  --source mix --window-size 8192 --window-hop 8192 --max-windows 50 \
  --max-lag 2000 --min-correlation 0.95 --max-abs-lag 12 \
  --report /tmp/marble-love/audio-bitperfect/pcm-diff-50w-lag12-timeracc.json
```

## Done Criteria

- Ordered YM2151 and POKEY reg/val/PC writes stay matched over the 14000-frame
  attract oracle and any promoted follow-up scenario.
- PCM audible-window correlation stays at least `0.95` with an explicit lag
  bound on promoted oracle windows.
- Browser `soundReplay` smoke loads the replay URL and tape JSON.
- Byte/sample exactness, strict cycle timing, and broader scenario coverage are
  resolved or explicitly documented before calling the audio truly bit-perfect.
- Relevant tests/typechecks/build/lint/context audit/diff check pass.
- Final handoff names changed files, commands run, and residual risks.

## Boot-flow visual checkpoint — 2026-05-23

- User screenshot after L2 completion showed a broken sprite below the GOAL
  platform during the level-end score hold (`main=3`, `mode=2`, `level=2`).
- Finding: likely stale MO bank selection in the web renderer. During
  `levelEndScoreResumePending`, the cleaned score/GOAL display list is in the
  pending bank from `0x4003B0`, while the renderer could still read the older
  latched bank from `0x4003AE`.
- Local patch: `visibleMotionObjectStartEntry` selects the pending MO bank only
  during the level-end score hold; normal rendering still uses the active
  latched bank. Automated gates passed; manual browser retest pending.
