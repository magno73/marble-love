# GOAL - Audio Bit-Perfect

Startup checkpoint for the active audio goal. Keep this file small; detailed
history belongs in `docs/archive/goals/`, and bulky captures stay under
`/tmp/marble-love/audio-bitperfect/`.

## Objective

Move Marble Love audio toward MAME parity on deterministic
`soundReplay`/cmd-tape first:

- close ordered YM2151 and POKEY write timing against MAME;
- then close PCM parity on audible windows;
- keep oracle capture, CLI diagnostics, web replay, and gameplay audio separate.

Do not mark this goal complete yet. The audio is not bit-perfect.

## Current Baseline - 2026-05-24

- Preset: `inject001f-1701-commandedge`.
- Timing source: `secs/attos`; MAME `cycle` fields are diagnostic only.
- Same-run oracle:
  `/tmp/marble-love/audio-bitperfect/current-samerun-soundcmdreads-wav-20260524/`.
- Explicit-cycle proof:
  `/tmp/marble-love/audio-bitperfect/cycle-log-proof/full1701/`.

Green promoted gates:

- YM ordered writes at native-sample tolerance `+-1`: `51163/51163`.
- POKEY ordered writes at native-sample tolerance `+-1`: `27198/27198`.
- Raw bus offset parity is green; reply acks scheduled `1528/1528`.
- Audible PCM windows: `212/212`, lag `0`, worst corr `0.996571`,
  RMS `0.005535`, maxAbs `0.041395`.

Checkpoint 2026-05-26:

- The `current` chip-write gate was rerun after the CLI IRQ-sampling work and
  remains green. The bulky rerun JSON reports were summarized here and then
  removed from `/tmp` cleanup.
- A diagnostics-only `--cpu-cli-irq-delay` probe switch now documents the
  MAME-like `CLI` prefetch behavior: the next opcode was sampled with the old
  IRQ mask before `I` is cleared. It is not promoted: on the same gate it leaves
  raw bus parity and POKEY green but introduces 1 YM native-sample mismatch at
  frame `1354`, PC `0x8e9c`, reg `0x24`.
- A broader diagnostics-only `--cpu-irq-prefetch-latch` probe switch latches IRQ
  recognition at opcode prefetch and resamples after sound-device ticking. It
  is also not promoted: raw bus parity remains exact, but the 1701-frame gate
  regresses to YM `8` native-sample mismatches and POKEY `3` native-sample
  mismatches.
- Sound-chip diagnostics now classify `irqWillService` with the CPU's
  `irqMaskDelayInstructions` / IRQ prefetch latch; this only affects opt-in
  diagnostics.
- The strict `0` gate was rerun after cleanup/current diagnostics and is
  unchanged: YM `5100/51163`, POKEY `6446/27198`, raw bus offset parity still
  exact. Frame-delta-segments and frame-offset-sweep diagnostics were summarized
  below and then removed from `/tmp`.
- Switching the same cmd-tape from `secs/attos` to `cycleInFrame` preserves the
  promoted `+-1` write gate, but does not improve strict timing materially:
  would-be non-exact native-sample buckets are YM `5096` and POKEY `6465`.
- Switching MAME write timing from `secs/attos` to logged cycle fields was also
  neutral for strict `0`: YM `5100`, POKEY `6446`.
- `--frame-delta-report` now groups strict native-sample misses by frame and
  shows this is not one global phase, not a MAME attos/log conversion issue,
  and not a static per-PC offset. Top YM strict frames include `1310` (36
  non-exact, replay delta `[-5,25]`, bus delta `[-35,-30]`), `1130` (31), and
  `537` (30). Top POKEY strict frames include `500` (16), `1435` (13), and
  `1500` (13).
- `--frame-offset-sweep-cycles -32:32` now tests the best single TS event
  offset per frame. It proves frame-origin drift is only partial: YM strict
  would improve from `5100` to `2745`, and POKEY from `6446` to `1499`, but
  neither closes because many frames contain mixed `-1/0/+1` native-sample
  buckets after their best offset.
- Enhanced frame-delta segments show the strict residue is in-frame burst
  timing, not smooth drift. YM frame `1010` has 25 timer writes at PC `0x81bb`
  with replay delta `+33` / bus delta `+3`, then 24 exact writes at `0` / `-30`.
  YM frame `1310` has a command-edge-adjusted 36-write segment at replay delta
  `+25` / bus delta `-35` after 46 writes at `-5` / `-35`. POKEY frames
  `500`, `1435`, and `1500` show repeated 9-register bursts around PC `0x8e28`
  / opcode `0x91`, with alternating replay deltas such as `+27/-15`,
  `+21/+15/-16`, and `+23/-10`.
- Global event-offset sweeps on 2026-05-26 narrowed the strict residue:
  YM `--ym-write-event-cycle-offset` is already optimal at the current `30`
  cycles (`5100` strict mismatches; nearby values worsen sharply, e.g. `28`
  gives `5949` and `32` gives `5958`). POKEY opcode `0x91` is not optimal at
  the current diagnostic `23`: strict mismatches fall monotonically to a local
  best at `0x91=30` (`6446 -> 2834`), but this is not promotable because it
  breaks the existing `+-1` gate with 17 outliers. Nearby POKEY values
  `24..29` also break the `+-1` gate with `3..15` outliers.
- Corrected POKEY boundary sweep on 2026-05-26:
  `--pokey-effective-apply-timing --pokey-write-apply-boundary-delay-cycles N`
  gives strict mismatches `N=1:5778`, `2:5056`, `3:4402`, `4:3823`,
  `5:3305`, `6:2943`, `7:2828`, then worsens (`8:2897`, `10:3804`,
  `16:7928`). But every non-zero threshold breaks the promoted `+-1` gate:
  outliers are `1,1,1,2,3,4,6,8,10,15,29,42,53` for
  `N=1,2,3,4,5,6,7,8,9,10,12,14,16`. The best strict candidate (`N=7`) has
  six `+2` outliers, all opcode `0x91`, command sources `0x03@0x85f3`,
  `0x07@0x8103`, or `0x07@0x865d`, with target offset `-33`; it delays writes
  that are already late into the next native sample. Interpret this as evidence
  for MAME `sync_write`/stream boundary timing plus a missing direction/phase
  guard, not as a static opcode-offset promotion.
- Added `--pokey-boundary-guard-sweep[-cycles]` and preset
  `inject001f-1701-pokey-boundary-guard-sweep` on 2026-05-26 to test that
  missing guard in post-diff without changing runtime timing. On the current
  POKEY strict run, the blind `all@7c` model reproduces the earlier improvement
  (`6446 -> 2828`) but creates `+2` outliers. Oracle-only directional guards
  `baseline-delta-lt0` and `target-offset-gte-delay` at `29c..32c` apply the
  `6126` early writes only and reduce strict mismatches to `320`, with native
  sample histogram `{0:26878,1:320}` and `maxAbs=1`. Looser guards that also
  delay baseline-exact writes (`baseline-delta-lte0`, `target-offset-gte0`, or
  blind `all@29c`) regress to `18674` strict mismatches. Conclusion: the
  remaining POKEY strict work is a directional scheduler/stream-boundary model;
  indiscriminate near-boundary delay is wrong.
- The same preset now emits `--pokey-boundary-candidate-report-cycles 29`,
  grouping near-boundary candidates by TS-only features. It found `24672`
  candidates, but only `6126` are early writes: `18354` are already exact and
  `192` are late. The best coarse TS-only buckets are phase/boundary delay
  buckets (`delay=2`: `808` early / `86` exact; `delay=3`: `757` early /
  `103` exact; `delay=1`: `749` early / `81` exact / `1` late). PC/reg/value,
  write-offset, command-edge-rule, and scheduler-frame-start buckets all mix
  many exact writes with the early writes. This rules out a safe coarse runtime
  guard from those local features and points toward modelling MAME stream
  cursor/update state directly.
- The candidate report now also buckets by POKEY write effect class after
  checking MAME scheduler/Lua source behavior. MAME Lua write taps observe the
  bus access time; `pokey_device::write()` queues `sync_write` through a
  zero-delay scheduler timer, and Lua does not expose a direct memory-tap
  callback after that internal device callback. The new effect buckets are
  still mixed: `audc-raw` has `2697` early / `8173` exact / `91` late,
  `audf-frequency` has `2678` early / `8234` exact / `80` late, and
  `audctl-same` has `749` early / `1937` exact / `21` late. This rules out a
  register/raw-invalidation guard; the missing model is still the MAME stream
  cursor/update phase, not the write payload class.
- Added `--pokey-stream-cursor-report` to the same preset on 2026-05-26. The
  current TS raw-transition cursor found `17286` POKEY raw changes but did not
  separate the `6126` early writes from the `20752` exact and `320` late
  writes. Dominant buckets are still heavily mixed: previous raw transition
  `>256` has `4005` early / `12627` exact / `206` late, next raw transition
  `>256` has `4519` early / `15998` exact / `238` late, and same-native-sample
  transition `yes` has only `77` early / `285` exact / `7` late. This rules out
  using current TS `outRaw` transition proximity as the missing runtime guard.
  Next POKEY work should model MAME `sound_stream::update()` sample cursor
  state around `sync_write`/invalidated raw output, not just raw-value changes.
- Added `--pokey-lofi-cursor-report` to the same preset on 2026-05-26, using
  the MAME lofi resampler mapping from POKEY source stream (`1789772 Hz`) to
  the current strict gate rate (`55930 Hz`). It explains part of the residue but
  does not close it. A follow-up source-rate/raw-offset sweep confirms the best
  tested lofi cursor is still weak: `1789772 Hz` with raw source offset `-4`
  gives `6200` mismatches, from baseline strict `6446`. The useful signal is
  still that many early writes become exact (`-1->0:4395`), but many remain
  early (`-1->-1:1627`) and some move further away (`-1->-2:104`). Conclusion:
  MAME lofi resampler phase is a real contributor, but not the runtime guard by
  itself; it must be combined with exact `sync_write` scheduler timing and
  stream origin/cursor state.
- Cross-checking the same POKEY strict run at the actual MAME WAV rate
  (`48000 Hz`) reduces mismatches from `6446` to `5491`, and a `-40..40` cycle
  phase sweep only improves that to `5455`. The current `55930 Hz` strict gate
  is useful for YM/native stream parity, but POKEY strict interpretation should
  be tied back to the 48000 Hz PCM path before promoting any POKEY timing rule.
- Cleanup 2026-05-26: `/tmp/marble-love/audio-bitperfect` was reduced from
  about `473M` earlier in the goal, then from `170M` to `90M`, and finally to
  about `54M` by removing the summarized `current-rerun-20260526` diagnostics.
  Retained the same-run oracle and explicit-cycle proof.

Gameplay integration checkpoint:

- Web gameplay audio is explicit through `?sound=1`; the default browser game
  path no longer instantiates the sound UI/chip unless requested.
- `?sound=1` uses the normal SoundChip config and real TS engine sound command
  notifications. It does not apply `soundReplay` presets, command-edge rules,
  or MAME-only timing diagnostics.
- The web path keeps the legacy `setSoundCmdHook` clear and wires
  `setGlobalSoundCmdHook` only, because `soundCmdSend158AC` already notifies
  both hooks internally and registering both would submit duplicate commands.
- The SoundChip is released and ticks with gameplay before the Web Audio user
  gesture; replies and PCM are drained every frame, with PCM discarded until
  the user clicks "Enable Audio".
- Synthetic debug audio stays opt-in: `?soundCue=1`, `?soundTest=1`,
  `?soundSynthCue=1`, and `?soundBeepTest=1`.

Open gates:

- Strict tolerance `0`: YM `5100/51163`, POKEY `6446/27198`.
- YM strict `0` is now classified as native-sample/application timing, not
  bus-write order: raw bus offset parity is exact (`0/51163`), and the current
  strict mismatch run reports `tsRawWriteMinusMameFetchDelta={0:51163}`.
  A global sample-phase sweep `-16..16` only improves YM strict `0` from
  `5100` to `5037`, so this is not a single phase knob.
- A per-PC event-cycle offset sweep `-16..16` on the top YM strict clusters
  (`0x8eaf`, `0x8e9c`, `0x81bb`, `0x81c3`, `0x8fac`, `0x93c6`) also keeps
  `0c` as the best result for every PC. Do not chase static per-PC event
  offsets for this gate.
- POKEY replay-vs-direct PCM fails in the inspected real-cycle window:
  lag `305`, corr `0.982084`, RMS `0.018587`, maxAbs `0.167506`.
- Direct mixed MAME-chip render with cycle-log timing still misses the MAME WAV
  gate: best tested corr about `0.9985`, maxAbs `0.07029`.

Diagnostic candidate:

- Preset `inject001f-1701-yminstr1-commandedge` adds the frame `1500`
  command-NMI override, `--ym-irq-new-assertion-instruction-delay 1`, and
  seven narrow command-edge compensation rules.
- It is reproducible and green on the same 1701-frame oracle at `+-1`:
  YM `51163/51163`, POKEY `27198/27198`, raw bus write parity `0` mismatches.
- Strict tolerance `0` is mixed and not promotable: YM worsens to
  `6929/51163` mismatches, POKEY improves to `4331/27198` mismatches.
- PCM against the same MAME WAV still passes the promoted audible-window gate:
  lag `0`, worst corr `0.9966`, worst RMS `0.00553`, maxAbs `0.04140`.

## Active Blocker

Frame `1500` still isolates the first YM Timer A IRQ boundary before the POKEY
reset cluster. The original SKCTL drift is downstream of this interrupt/stack
timing issue.

The bulky raw window traces for this blocker were cleaned up on 2026-05-26.
The important evidence is summarized here; regenerate targeted window traces
under `/tmp/marble-love/audio-bitperfect/` if deeper local inspection is needed.

Key evidence:

- MAME first IRQ vector read: frame `1500`, cycles `2427/2428`, saved
  `pc=0x810b`.
- Default TS first IRQ vector read: cycles `2423/2424`, saved `pc=0x8101`.
- With frame-specific command NMI override `1500:0x03:624:0`, TS preserves the
  global `+-1` write gate and moves the local first IRQ to `pc=0x8108`, but
  MAME is still `pc=0x810b`.
- A diagnostic `--ym-irq-new-assertion-instruction-delay 1` plus that
  frame-specific NMI override moves the local first IRQ to `pc=0x810b`, but is
  not sufficient by itself: the 1701-frame write gate regresses to YM `5`
  native-sample mismatches and POKEY `2` native-sample mismatches, with raw bus
  parity still green. The separate `inject001f-1701-yminstr1-commandedge`
  preset proves those remaining regressions can be contained with narrow
  command-edge rules.
- Global Timer A start delays, global YM IRQ assertion delays, fixed/smoothed
  frame budgets, `cycleInFrame` command timing, and wildcard command NMI
  overrides have all been rejected as promotions
  because they improve a local symptom while breaking global write parity,
  boot/reset ordering, or the current `+-1` gate.
  Current-code rerun: `--timer-a-start-delay 5` regresses the `+-1` gate to
  YM `10` and POKEY `2` native-sample mismatches while raw bus offset parity
  stays exact.

Interpretation:

- YM/POKEY payloads and store-local timing are already close; the open issue is
  interrupt recognition, Timer A phase, or 6502 IRQ sampling around
  `CLI`/branch boundaries.
- Online references found on 2026-05-24 and revisited on 2026-05-26 make the
  CPU side plausible: Visual6502 documents delayed `CLI` masking and special
  branch interrupt windows, while MAME's 6502 opcode list applies `CLI` as
  `read_pc(); prefetch(); m_P &= ~F_I`. Treat this as evidence for a fuller
  prefetch/IRQ-latch model, not proof that the current local `CLI` diagnostic is
  enough.
- A naive global prefetch-latch replacement is too broad for the current replay
  timing model: it improves conceptual fidelity but breaks the promoted
  native-sample gate before any frame-1500-specific benefit can be promoted.
- MAME POKEY timing is not direct CPU bus timing: `pokey_device::write()` calls
  `machine().scheduler().synchronize(... sync_write ...)`, and `sync_write`
  then calls `write_internal`. MAME `schedule.h` defines `synchronize` as a
  zero-delay timer, so the remaining POKEY strict work should model the
  scheduler/device-stream boundary instead of comparing only the 6502 store
  cycle. MAME's sound stream docs say `update()` advances the stream to current
  time in samples, and POKEY calls `m_stream->update()` when raw output changes;
  the next useful model is therefore a local stream cursor, not another
  PC/register filter.

## Next Moves

1. Keep all global phase/fudge switches diagnostic-only unless they preserve
   strict ordered write parity on the 1701-frame tape.
2. Compare the TS 6502 IRQ sampling model against Visual6502/MAME behavior
   around prefetch, `CLI`, branch `T2`, and pending IRQ visibility before
   changing YM Timer A again.
3. Use `inject001f-1701-yminstr1-commandedge` as a diagnostic baseline for the
   IRQ-sampling hypothesis, not as `current`: it improves frame `1500` and
   POKEY strict timing and does not regress the current PCM gate, but worsens
   YM native-sample strict timing.
4. Next strict-work target: explain frame-local native-sample drift between
   replay target time, raw bus write time, and chip application/sample bucket.
   Start from the frame-delta/frame-offset-sweep reports and the POKEY
   `sync_write` timing hypothesis rather than adding static PC offsets, a
   global frame phase, or more local-only command-edge rules.
5. Only after ordered chip-write parity is credible, continue DSP work:
   POKEY clocking/AUDCTL/poly/mix, then YM2151 against MAME `ymfm`.
6. Browser-smoke only the isolated `?soundReplay=...` path while
   `packages/web/src/main.ts` is contended.

## Guardrails

- Preserve unrelated dirty work.
- Do not change gameplay, collision, terrain, renderer, route, seed, or
  boot-flow behavior for audio diagnostics.
- Avoid `packages/web/src/main.ts` unless an isolated audio block is unavoidable.
- Keep bulky probes and MAME captures under `/tmp/marble-love/audio-bitperfect/`.
- Do not promote changes that regress the current direct MAME WAV or ordered
  write gates.

## References

- MAME Atari System 1:
  `https://github.com/mamedev/mame/blob/master/src/mame/atari/atarisy1.cpp`
- YM2151 MAME/ymfm:
  `https://github.com/mamedev/mame/blob/master/3rdparty/ymfm/src/ymfm.h`,
  `https://github.com/mamedev/mame/blob/master/3rdparty/ymfm/src/ymfm_opm.cpp`
- YM2151 datasheet:
  `https://bitsavers.org/components/yamaha/YM2151_199112.pdf`
- Visual6502 6502 IRQ timing:
  `https://www.nesdev.org/wiki/Visual6502wiki/6502_Timing_of_Interrupt_Handling`,
  `https://www.nesdev.org/wiki/Visual6502wiki/6502_Timing_States`
- MAME 6502 core:
  `https://docs.mamedev.org/techspecs/m6502.html`,
  `https://github.com/mamedev/mame/blob/master/src/devices/cpu/m6502/om6502.lst`
- MAME scheduler/device synchronization:
  `https://github.com/mamedev/mame/blob/master/src/emu/schedule.h`,
  `https://wiki.mamedev.org/index.php/Device_Interfaces`
- POKEY references:
  `https://github.com/mamedev/mame/blob/master/src/devices/sound/pokey.cpp`,
  `https://www.cpcwiki.eu/imgs/0/04/Altirra_Hardware_Reference_Manual_-_20240921.pdf`
- Secondary YM2151 implementations:
  `https://github.com/nukeykt/Nuked-OPM`,
  `https://github.com/jotego/jt51`
