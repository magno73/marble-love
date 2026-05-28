# Sound System

This file is the compact technical map for Marble Love audio. The long
investigation log that previously lived here was archived in:

- `docs/archive/audio-bitperfect-sound-system-log-2026-05-23.md`
- `docs/archive/goals/audio-bitperfect-goal-log-2026-05-23.md`

Keep this document stable and small. Put bulky probe output, rejected sweeps,
and one-off timelines under `/tmp/marble-love/audio-bitperfect/` and summarize
only the current conclusion here or in `GOAL.md`.

## Hardware Topology

Marble Madness runs on Atari System 1.

Main CPU:

- Motorola 68010.
- Writes sound commands to `$FE0000/$FE0001`.
- Reads sound responses from `$FC0000/$FC0001`.

Sound CPU:

- 6502A.
- Program ROMs from `roms/marble.zip`: `136033.421` and `136033.422`.
- Sound RAM: `$0000-$0fff`.
- Sound command read: `$1810`.
- Sound response write: `$1810`.
- Sound status/input read: `$1820`.
- YM2151 communication: `$1800-$1801`.
- POKEY communication: `$1870-$187f`.
- NMI is driven by the sound command latch.
- IRQ is driven by YM2151 timer/IRQ output.

MAME reference:

- `src/mame/atari/atarisy1.cpp`
- YM route gain: `0.48` to left/right speaker outputs.
- POKEY route gain: `0.24` to both speakers.
- MAME also applies `perfect_quantum(attotime::from_usec(100))` when the sound
  latch asserts data pending; account for this when comparing CPU scheduling.

## Runtime Paths

`soundReplay` oracle path:

- Deterministic replay from cmd-tape.
- Primary path for bit-perfect work.
- Must not contain synthetic cues or gameplay-only shortcuts.

Gameplay audio path:

- Enabled via `?sound=1`.
- Uses real sound commands emitted by the main TS engine.
- Must keep `setSoundCmdHook` as an external side effect and must not alter
  gameplay `GameState`.
- In the browser, the gameplay path wires the global sound hook only. The
  legacy 158AC hook stays clear there because `soundCmdSend158AC` also emits
  through the global hook, and registering both would duplicate commands.
- Synthetic cue/beep helpers are debug-only flags, not part of normal
  `?sound=1` playback.

Web audio path:

- Browser renderer bridges chip PCM into the audio worklet.
- Keep replay controls explicit via URL flags.
- Avoid touching `packages/web/src/main.ts` while it remains dirty/contended
  unless the change is isolated to existing audio blocks.

## Current Implementation Status

Implemented audio pieces:

- 6502 sound CPU replay and memory map.
- 68010 -> 6502 mailbox and command latch modeling.
- YM2151/OPM model with timers, busy flag, register writes, envelope/operator
  logic, key-on behavior, LFO/noise support, stereo routing, and sample drain.
- POKEY model with `/28` native rate, register writes, channel/noise behavior,
  raw transition diagnostics, and sample drain.
- Bit-perfect probes can override POKEY sampling to clock/1 to mirror MAME's
  raw device stream before the final mixer/resampler.
- Cmd-tape replay with cycle-aware command scheduling.
- CLI probes for MAME-vs-TS YM/POKEY write diffs and PCM window diffs.
- Web `soundReplay` loading and PCM renderer plumbing.

Canonical current preset:

- `inject001f-1701-commandedge`
- Artifact directory:
  `/tmp/marble-love/audio-bitperfect/current-samerun-soundcmdreads-wav-20260524/`

Current green event gate at native-sample tolerance `+-1`:

- YM2151: `51163/51163`, `0` mismatches.
- POKEY: `27198/27198`, `0` mismatches.

Current zero-lag PCM gate:

- `212` audible windows pass.
- `worstCorrelation=0.9965714236013331`
- `worstAbsLag=0`
- `worstRms=0.005534884943771918`
- `worstMaxAbs=0.041395485401153564`
- The canonical preset now gates with `--max-lag 0`, `--max-abs-lag 0`,
  and `--max-abs 0.045`.
- Latest rerun after scheduler/command-context diagnostics:
  `/tmp/marble-love/audio-bitperfect/current-scheduler-catchup-20260523/pcm-diff-current-preset-after-command-context.json`
- Latest rerun after command pre-advance diagnostics:
  `/tmp/marble-love/audio-bitperfect/current-preadvance-20260523/pcm-diff-current-preset-preadvance-report.json`
- Latest rerun after strict mismatch context diagnostics:
  `/tmp/marble-love/audio-bitperfect/current-preadvance-context-20260523/pcm-diff-current-preset-context-report.json`
- Latest rerun after reply-ack frame-origin normalization:
  `/tmp/marble-love/audio-bitperfect/current-replyack-frameorigin-20260524/pcm-diff-current-preset-frameorigin-report.json`
- Latest rerun after the promoted YM `0x83fc` rule:
  `/tmp/marble-love/audio-bitperfect/current-raw-bus-gate-20260524/pcm-diff-current-preset-after-ym12.json`
  remains green with `212` audible windows, lag `0`, worst correlation
  `0.9965714236013331`, and worst maxAbs `0.041395485401153564`.
- Latest rerun after the promoted narrow YM residual pack:
  `/tmp/marble-love/audio-bitperfect/current-raw-bus-gate-20260524/pcm-diff-current-preset-after-ym0.json`
  remains green with the same `212` audible windows, lag `0`, worst
  correlation `0.9965714236013331`, and worst maxAbs
  `0.041395485401153564`.
- Latest same-run proof after promoting explicit cmd-tape timing selection:
  `/tmp/marble-love/audio-bitperfect/current-samerun-soundcmdreads-wav-20260524/chip-write-diff-current-wavrun-attos-mode-final.json`
  and
  `/tmp/marble-love/audio-bitperfect/current-samerun-soundcmdreads-wav-20260524/pcm-diff-current-wavrun-attos-mode-final.json`.
  The `current` CLI preset now sets `--cmd-tape-command-timing attos`; browser
  `soundReplay` defaults to the matching `secs/attos` wall-clock mode through
  `soundReplayCmdTapeCommandTiming`, with `cycle` kept as a diagnostic override.
  On the same-run tape that still carries `cycleInFrame`, ordered YM/POKEY
  writes are `0` mismatch at native-sample tolerance `+-1`, raw bus offset
  parity is green, and PCM remains at `212` audible windows, lag `0`, worst
  correlation `0.9965714236013331`, worst RMS `0.005534884943771918`, worst
  maxAbs `0.041395485401153564`.

Current strict exact gap:

- YM2151 exact native-sample bucket mismatches: `5100`.
- POKEY exact native-sample bucket mismatches: `6446`.
- No known payload/order drift in the canonical preset.
- Residuals point mainly at scheduler/boundary timing, not wrong chip commands.
- Latest strict same-run boundary report:
  `/tmp/marble-love/audio-bitperfect/strict-native-sample-20260524/chip-write-diff-current-wavrun-sampletol0-boundary-final.json`
  with the `current` preset-required raw bus offset gate green.
- Latest strict context report:
  `/tmp/marble-love/audio-bitperfect/current-preadvance-context-20260523/chip-write-diff-current-preset-sampletol0-context-report.json`
- Latest event-gate context report:
  `/tmp/marble-love/audio-bitperfect/current-preadvance-context-20260523/chip-write-diff-current-preset-context-report.json`
- Latest reply-ack frame-origin event reports:
  `/tmp/marble-love/audio-bitperfect/current-replyack-frameorigin-20260524/chip-write-diff-current-preset-frameorigin-report.json`
  and
  `/tmp/marble-love/audio-bitperfect/current-replyack-frameorigin-20260524/chip-write-diff-current-preset-sampletol0-frameorigin-report.json`
- Older strict context mismatches occur when command submit pre-advance is already near
  the target (`overshoot0..3`), not in large catch-up lag buckets. Latest global
  phase sweep over `0..63` cycles with raw bus offset parity required still
  leaves best exact native-sample mismatches at YM `5038` (`29`, `30`, or `61`
  cycles) and POKEY `6343` (`22` or `54` cycles), so do not promote a global
  native-sample phase shift.
- The strict boundary report splits residual shape by distance to the native
  sample boundary. YM is balanced around the boundary. POKEY is asymmetric:
  MAME writes cluster just after the boundary while TS effective writes cluster
  just before it. Next POKEY work should separate raw bus-write parity from
  effective application/audio timing instead of adding a blind global `0x91`
  offset.
- The same report now groups strict mismatches by command-edge rule. POKEY is
  `none:6434/6446`, with top write PCs under the baseline `0x91` path
  (`0x8e54`, `0x8e2f`, `0x8e68`, `0x8e3c`, `0x8e62`, `0x8e35`, `0x8e28`,
  `0x8e6f`). The next diagnostic should target baseline POKEY application
  timing, not the already narrow command-edge rules.
- `probe-chip-write-diff.ts` has a diagnostics-only
  `--pokey-event-boundary-delay-cycles` option that delays only POKEY event
  timestamps near the next native sample boundary. The sweep at
  `/tmp/marble-love/audio-bitperfect/strict-native-sample-20260524/pokey-boundary-delay-sweep-20260524.tsv`
  finds threshold `7` as the best strict result: POKEY drops to `2828` strict
  mismatches with raw bus parity intact, but still has `6` mismatches at
  tolerance `+-1`. This supports a boundary-timing model but is not a promoted
  preset rule.
- The analogous naive audio-apply experiment is rejected: running PCM with
  `--pokey-write-apply-delay-opcodes 0x91=23` regresses to worst correlation
  `0.9857`, RMS `0.00987`, and maxAbs `0.08908`.
- `probe-sound-sample-diff.ts` now has the matching diagnostics-only
  `--pokey-write-apply-boundary-delay-cycles` control for PCM-side testing.
  The sweep at
  `/tmp/marble-love/audio-bitperfect/current-samerun-soundcmdreads-wav-20260524/pcm-pokey-boundary-apply-sweep-20260524.tsv`
  rejects promoting it: thresholds `1..2` are unchanged from the current PCM
  baseline, while threshold `3+` collapses correlation to about `0.05` and RMS
  to about `0.081`.
- POKEY resample/output phase sweeps are rejected as runtime changes. Against
  the calibrated direct MAME-chip POKEY reference, increasing
  `--pokey-resample-offset` improves component RMS to about `0.00381` near
  offsets `31..32`, but the same offsets regress the mixed MAME WAV gate:
  offset `27` already fails with RMS `0.005904` and maxAbs `0.053666`.
  The baseline `23.25/1` remains the only green mixed setting in the tested
  range. Results:
  `/tmp/marble-love/audio-bitperfect/current-samerun-soundcmdreads-wav-20260524/pokey-replay-vs-direct-resample-extended-sweep-20260524.tsv`
  and
  `/tmp/marble-love/audio-bitperfect/current-samerun-soundcmdreads-wav-20260524/pokey-current-mixed-resample-output-sweep-20260524.tsv`.
- `--pokey-sample-after-clock` is also rejected. It slightly improves current
  mixed correlation (`0.9968399419701063`) but worsens RMS/maxAbs and fails the
  direct MAME-chip gate with maxAbs `0.03428160399198532` against the `0.031`
  threshold. Result:
  `/tmp/marble-love/audio-bitperfect/current-samerun-soundcmdreads-wav-20260524/pokey-sample-after-clock-check-20260524.tsv`.
- YM `--ym-phase-advance-after-output` is rejected. It badly regresses current
  mixed WAV (`corr=0.9510693198140082`, RMS `0.040499755417860744`, maxAbs
  `0.281564325094223`) and also fails direct MAME-chip with lag `1`. Result:
  `/tmp/marble-love/audio-bitperfect/current-samerun-soundcmdreads-wav-20260524/ym-phase-advance-check-20260524.tsv`.
- YM MAME-stream native rate remains integer `55930` for this oracle. The
  sweep at
  `/tmp/marble-love/audio-bitperfect/current-samerun-soundcmdreads-wav-20260524/ym-direct-mamechip-rate-phase-sweep-20260524.tsv`
  rejects fractional rates and simple YM resample offsets: `55930/0` is the
  only healthy point, while `55930.25` and neighbors move write/sample timing
  far enough to collapse correlation.
- Direct POKEY tap timing remains at the existing calibration. The coarse and
  fine sweeps at
  `/tmp/marble-love/audio-bitperfect/current-samerun-soundcmdreads-wav-20260524/pokey-direct-mamechip-timing-sweep-20260524.tsv`
  and
  `/tmp/marble-love/audio-bitperfect/current-samerun-soundcmdreads-wav-20260524/pokey-direct-mamechip-timing-fine-sweep-20260524.tsv`
  find small RMS-only or maxAbs-only tradeoffs near `-16/22.50`, but no
  setting improves both metrics. Do not promote those micro-adjustments.
- POKEY replay-vs-direct raw traces now isolate the largest replay residuals.
  At sample `567780`, channel 2 raw transitions have the same sequence in
  replay and direct, but replay's estimated output samples are mostly `+1`
  late. Other spike windows flip to `-1/0`, ruling out a global phase fix.
  `probe-sound-sample-diff.ts` also accepts
  `--direct-chip-write-cycle-rate-mode auto|sound|pokey` for direct-reference
  diagnostics. Forcing the POKEY-only reference to `sound` keeps the raw
  transition order exact but fails the PCM gate (`corr=0.9871884455429856`,
  RMS `0.009215753415276506`, maxAbs `0.08351957832928747`); forcing `pokey`
  matches `auto` and passes, so this is not a promotable clock-domain fix.
  The same probe reports `referencePokeyRawTracePcmResidualComparison`: on the
  557k focus, radius-`64` event alignment improves output-delta `+1` groups
  (`0.0060636847124683835` to `0.0036614093674079457` RMS mean) but regresses
  `-1` groups (`0.0009865693038815272` to `0.005837649865146904`), rejecting a
  global event-aligned PCM correction. A local `+-2` best-lag scan lowers mean
  RMS to `0.0024732419949617056` with lag histogram `{0:157,-1:206}`, which is
  segment-local phase evidence only. The global raw-transition run confirms the
  pattern over all `17286` events: best local lag is `{0:17080,-1:206}`. Adding
  local least-squares gain correction barely moves best-lag RMS mean
  (`0.0015873355905320467` to `0.0015851193078975365`) and keeps gain near
  unity (`0.9739..1.0095`), so the remaining POKEY residual is not a mixer-gain
  problem. The problematic `cycleDelta=7306011` bucket is exactly `206` events,
  all best-lag `-1`, with raw transitions limited to `0x0000<->0x0700` and
  `0x0000<->0x0f00`; its lofi `sourceBlockOffsetDelta` is `21` or `-17`, the
  same phase modulo MAME-lofi's POKEY block size `38`.
  Result files:
  `/tmp/marble-love/audio-bitperfect/current-samerun-soundcmdreads-wav-20260524/pcm-diff-replay-vs-direct-pokey-rawtrace-567780.json`,
  `/tmp/marble-love/audio-bitperfect/current-samerun-soundcmdreads-wav-20260524/pokey-replay-vs-direct-rawtrace-multipoint-20260524.tsv`,
  `/tmp/marble-love/audio-bitperfect/current-samerun-soundcmdreads-wav-20260524/pcm-diff-replay-vs-direct-pokey-rawtrace-557k-pcmresidual-20260524.json`,
  `/tmp/marble-love/audio-bitperfect/current-samerun-soundcmdreads-wav-20260524/pcm-diff-replay-vs-direct-pokey-rawtrace-global-pcmresidual-gain-20260524.json`,
  and
  `/tmp/marble-love/audio-bitperfect/current-samerun-soundcmdreads-wav-20260524/pcm-diff-replay-vs-direct-pokey-rawtrace-global-pcmresidual-phasebucket-20260524.json`.
- Forcing the replay path onto the batch POKEY resampler via
  `--pokey-channel-diagnostics` is identical to the default streaming path, so
  the spike is not a streaming-vs-batch resampler bug. Result:
  `/tmp/marble-love/audio-bitperfect/current-samerun-soundcmdreads-wav-20260524/pcm-diff-replay-vs-direct-pokey-batch-via-channeldiag.json`.
- New command-boundary diagnostics can now compare expected MAME sound CPU
  state from cmd-tape (`soundPc/A/X/Y/P/SP`) against TS at submit. The focused
  NMI-phase checkpoint lives under
  `/tmp/marble-love/audio-bitperfect/current-nmi-phase-20260524/`.
- In the valid frame `1615` checkpoint, command byte and submit cycle match
  MAME, but TS is already one command-table index ahead before submit:
  `$0210/$0211 = 0x05` and `PC=0x80f0 A=0x00 X=0x05 P=0x23` versus the
  MAME/tape expectation `$0210/$0211 = 0x04` and
  `PC=0x8126 A=0x10 X=0x04 P=0x33`.
- Timer A phase control is diagnostic only: `--timer-a-start-delay -3238`
  nearly aligns the first post-NMI chip write in that frame, but the command
  boundary remains one index ahead. Do not promote this as a fix.
- New MAME RAM reruns in the same checkpoint did not reproduce the historical
  frame-`1615` command tape, so they are rejected as proof inputs.
- The same-run command-index checkpoint lives under
  `/tmp/marble-love/audio-bitperfect/current-command-index-origin-20260524/`.
  `probe-sound-window-trace.ts` now writes a `commandExpectedState` summary so
  expected MAME cmd-tape state can be checked without ad hoc `jq`.
- On the same-run tape, TS command-table `X` matches through frames `245..248`
  and first diverges at frame `249`: TS is at
  `PC=0x9009 A=0x01 X=0x11 P=0x24`, while MAME expects
  `PC=0x8126 A=0x10 X=0x04 P=0x33`. The `$0210/$0211` RAM trace still shows
  index `0x04` before submit, then TS advances `$0211` at cycle `59` and
  `$0210` at cycle `1013`. This points to IRQ/scheduler phase, not a bad table
  index write before the command.
- A diagnostic boundary preemption for pending IRQs
  (`--command-preempt-pending-irq-lookahead 64`) moves the first `X` mismatch
  to frame `250`, but then misses MAME's expected `0xe54a` subroutine state.
  Treat this as scheduler evidence only; do not promote the flag.
- Cmd-tapes now keep MAME instruction context (`instPc`, `instOpcode`,
  `instDeltaCycles`, `nextChronoInst*`) for diagnostics. The window trace probe
  writes `commandInstContext` and `ymStatus` summaries; current focused output:
  `/tmp/marble-love/audio-bitperfect/current-command-index-origin-20260524/ts-pcfull-245-250-irqpreempt56-nmidelay100-instcontext.json`.
- In that diagnostic run, TS fetches MAME's expected instruction context within
  `18..28` cycles for frames `246..250`; the frame-`250` `$e54a` instruction
  appears in TS at frame `249` cycle `29360`, only `21` cycles before the MAME
  `instDeltaCycles=486` timestamp. This points away from a YM busy-loop delay
  fix and toward scheduler/local-time semantics: TS samples command-submit
  state after catching the sound CPU up to the boundary, while MAME's command
  capture can expose the sound CPU's last scheduled instruction context.

Raw bus-write gate:

- `probe-chip-write-diff.ts` now reports `rawBusWriteParity` separately from
  the event/native-sample diff. Use
  `--require-raw-bus-write-parity --raw-bus-write-parity-mode offset` to gate
  CPU bus write offset against MAME instruction context without conflating it
  with replay-origin or chip-event application offsets.
- The `current` audio bit-perfect preset now requires that offset-only raw bus
  gate with zero tolerance and zero max mismatches.
- Current same-run `soundCmdReads` report:
  `/tmp/marble-love/audio-bitperfect/current-raw-bus-gate-20260524/chip-write-diff-current-preset-soundcmdreads-raw-bus-offset-gate.json`
- Result: YM `51163/51163` and POKEY `27198/27198` pass with `0`
  raw bus offset mismatches and `writeOffsetDelta=[0,0]`.
- Current same-run explicit-cycle event report after the constrained POKEY
  rules and the promoted narrow YM residual pack:
  `/tmp/marble-love/audio-bitperfect/current-raw-bus-gate-20260524/chip-write-diff-current-preset-soundcmdreads-ym0-pokey0.json`
- Result: YM is green at tolerance `+-1` with `51163/51163`, `0` mismatches,
  `nativeSampleMaxAbs=1`, and raw bus offset parity still
  `writeOffsetDelta=[0,0]`. POKEY is also green with `27198/27198`, `0`
  mismatches, `nativeSampleMaxAbs=1`, and raw bus offset parity green.
- The promoted POKEY rules are constrained by command byte, raw relation/window,
  command sound PC, write PC, and in the narrow cases register/value. They close
  the same-run POKEY `+-1` event mismatch without frame-specific exceptions.
- The promoted YM `0x83fc` rule is constrained by command byte `0x03`, command
  sound PC `0x83fc`, raw-before `300..14000` cycles, and a `-42` cycle
  current-event target. It reduces same-run YM `+-1` mismatches from `28` to
  `12` without changing raw bus offset parity.
- The promoted narrow YM residual pack closes those remaining `12` mismatches
  without frame-specific rules. The rules are constrained by command byte,
  command sound PC, raw relation/delta, write PC, register, and value for the
  `0x8123`, `0x8ff5`, `0x8120`, `0x8403`, and `0x8e84` edges.
- Current state-compare report:
  `/tmp/marble-love/audio-bitperfect/current-raw-bus-gate-20260524/chip-write-diff-current-preset-soundcmdreads-statecompare.json`
  leaves the same raw bus offset gate green and adds actual TS submit CPU state
  to command-submit diagnostics.
- Absolute raw bus replay-cycle parity is not green yet: on the same oracle,
  absolute `busReplayCycle` deltas reach about YM `297` and POKEY `299`
  cycles. Treat this as replay-origin/frame-normalization evidence, not as a
  reason to change 6502 opcode write offsets.
- Latest strict rerun after promoting the raw bus offset gate into `current`:
  `/tmp/marble-love/audio-bitperfect/strict-native-sample-20260524/chip-write-diff-current-preset-raw-offset-sampletol0-after-preset-gate.json`.
  It keeps raw bus offset parity green and confirms the remaining exact gap is
  still native-sample boundary timing: YM `5096`, POKEY `6465`.

## Scheduler And Timing Notes

Important MAME behavior:

- MAME schedules multiple CPUs in round-robin slices against timer targets.
- CPU cores may overshoot a target because instructions take multiple cycles.
- MAME accounts for each CPU's local time after overshoot.
- Timer operations inside active CPU callbacks use that CPU's local time.

Why this matters here:

- The TS sound replay currently advances the 6502 by whole instructions to
  reach command/frame targets.
- Focused diagnostics show catch-up shaped residuals: one interval is too short
  and a later matching interval is too long by almost the same amount.
- Example POKEY report:
  `/tmp/marble-love/audio-bitperfect/current-scheduler-catchup-20260523/pokey-op91-25-command-context.json`
- Representative pairs:
  `PC 0x8e62` interval deltas `-138/+142`, and `PC 0x8e5b` `-266/+266`.
- The `0x8e62` pair is anchored to command `#1494` (`0x03`) at frame `1616`,
  cycle `0`, sound PC `0x81ea`: TS writes `33` cycles after the command while
  MAME places the same event `183` cycles after it; the first TS command read is
  `+81` cycles after submit. The command target falls inside TS step
  `PC 0x8e5f`, opcode `0xad`, at target offset `+1`; the whole instruction
  ends at `+3`.
- The `0x8e5b` pair is anchored to command `#1163` (`0x07`) at frame `1306`,
  cycle `6189`, sound PC `0x8120`: TS writes `21` cycles after the command
  while MAME places the same event `294` cycles after it; the first TS command
  read is `+77` cycles after submit. The command target falls inside TS step
  `PC 0x8e5e`, opcode `0xc8`, at target offset `+1`; the whole instruction
  ends at `+1`.
- In that `0x8e5b` case, TS writes before the first `$1810` command read
  (`read - write = 56` cycles), while MAME places the same write after the read
  (`294 - 77 = 217` cycles).
- `tickFrameWithTape` exposes an opt-in `onFrameAdvance` callback, and
  `probe-chip-write-diff.ts` serializes it as `schedulerDrift`. On the current
  1701-frame preset, active frame-start and frame-end local CPU drift are only
  `0..6` cycles, so the large catch-up pairs are not explained by gross
  frame-schedule drift. The remaining target is command submit/read timing plus
  instruction-boundary catch-up inside the frame.
- A two-command diagnostic that forces NMI delay `2` for just those two command
  submits does not fix the issue:
  `/tmp/marble-love/audio-bitperfect/current-scheduler-drift-20260523/pokey-op91-25-pcdelta-two-command-delay2-diagnostic.json`.
  Strict POKEY mismatches change from `5058` to `5059`, and the largest
  `0x8e62` catch-up moves to the `1306` command window. Do not promote simple
  delayed-NMI patches from this evidence.
- `probe-chip-write-diff.ts` now carries frame-start/frame-end scheduler deltas
  on TS write records and command context on `pcDeltaReport` mismatch samples,
  interval outliers, and catch-up pairs. The green event gate for that version
  is:
  `/tmp/marble-love/audio-bitperfect/current-scheduler-catchup-20260523/chip-write-diff-current-preset-after-command-context.json`
- Command-submit diagnostics now include MAME `soundPc` and its relation to the
  TS submit step. On the latest green event gate,
  `/tmp/marble-love/audio-bitperfect/current-scheduler-catchup-20260523/chip-write-diff-current-preset-command-soundpc-report.json`,
  delay-1 submits bucket as `{other:1412, step-next:92, step-pc:64, ?:1}`.
  That makes the mismatch systemic: command timestamps are external scheduler
  events, not proof that the sound CPU has locally advanced to the same PC.
- Current command-submit state comparison records TS `PC/A/X/Y/P/SP` at the
  instant `tickFrameWithTape` submits the command. On the same-run
  `soundCmdReads` oracle it reports `exact=0`, `exactIgnoringP=64`, and PC
  mismatches on `1507` of `1579` commands. PC relation buckets are
  `{other:1361,nextChronoInstPc:75,soundPc:72,nextInstPc:70,?:1}`. The first
  non-reset mismatch is frame `245`, where MAME's tap state is still
  `PC=0x8100` while TS has already advanced to `PC=0x810b`. This confirms the
  remaining absolute-origin problem is scheduler/local-time modeling, not a
  generic chip bus write offset.
- A diagnostic scheduler variant, `--command-submit-before-cpu-catchup`,
  asserts the command/NMI line before executing sound-CPU catch-up to the
  command timestamp. It breaks ordered write parity badly on the same-run
  oracle, so do not promote it.
- `tickFrameWithTape` also reports command pre-advance context: the local CPU
  cycle and PC before replay catches up to a command timestamp. The green gate
  with this context is:
  `/tmp/marble-love/audio-bitperfect/current-preadvance-20260523/chip-write-diff-current-preset-preadvance-report.json`.
  Delay-1 submits bucket MAME `soundPc` vs TS pre-advance relation as
  `{other:1481, pre-pc:88}`. Start-frame commands are mostly already within
  `0..6` cycles of the target; sub-frame commands can start hundreds or
  thousands of cycles behind and then be caught up by `advanceReplayCpuTo()`.
  Treat this as scheduler evidence, not as justification for byte- or
  PC-specific NMI delay patches.
- `probe-chip-write-diff.ts` now also aggregates strict native-sample mismatch
  context by submit pre-advance delta/bucket/PC and MAME sound-PC relation. The
  older strict context report shows YM mostly in `overshoot0..3`
  (`4613/5118`) and POKEY mostly in `overshoot0..3` (`5916/6446`), so the
  exact bucket debt is local event timing around otherwise-matched command
  writes.
- `oracle/mame_sound_window_trace.lua` can now export same-run cmd/status
  inputs via `MARBLE_SOUND_TRACE_CMD_OUT` and
  `MARBLE_SOUND_TRACE_STATUS_OUT`. Use artifacts under
  `/tmp/marble-love/audio-bitperfect/current-window-samerun-20260523/` for
  focused scheduler diagnosis; older window traces that reuse a different
  cmd-tape are not valid proof.
- The later video-cycle checkpoint lives under
  `/tmp/marble-love/audio-bitperfect/current-window-videocycle-20260523/`.
  Same-run cmd tapes now carry video-frame `cycleInFrame`; event traces also
  emit video-frame `cycleInFrame`/`videoCycleInFrame` plus
  `commandRelativeCycleInFrame` for command-relative analysis. Do not compare
  TS replay cycles against older command-relative MAME `cycleInFrame` fields.
- Same-run raw window diffs pass YM/POKEY payload and `pcToWriteDelta` in the
  focused windows after video-cycle normalization. Frame `1615` is now the
  cleaner scheduler target. After reply-ack frame-origin normalization, command
  boundary remains `delta=0`, reply value payloads match, and ack delays are
  close (`MAME 70/71`, TS `65/75/76`) instead of the earlier `11701/11707`
  artifact. Remaining divergence is local CPU/NMI phase: first PC mismatch is
  `MAME 1615:555 0x8100` vs `TS 1615:552 0x80f0`, NMI vector PC is
  `0x8100` vs `0x80f2`, and the first sound-to-main status-bit mismatch is at
  frame `1616`. Frame `1305` still diverges earlier after NMI despite command
  boundary `delta=0`.
- The 2026-05-24 checkpoint validates `SOUND_CYCLES_PER_FRAME = 29868` and
  adds `cmdTapeTimestampVideoCycleInFrame(...)` for deriving video-frame cycles
  from MAME timestamps. Do not use that helper to automatically reinterpret
  timestamp-only legacy replay tapes: the promoted tape must keep its per-frame
  replay origin unless commands carry explicit `cycleInFrame`. The rejected
  automatic fallback report is
  `/tmp/marble-love/audio-bitperfect/current-videoframe-fallback-20260524/chip-write-diff-current-preset-videoframe-fallback.json`.
  With legacy origins preserved, `chip-write-diff-current-preset-legacy-origin-after-helper.json`
  and `pcm-diff-current-preset-legacy-origin-after-helper.json` keep the
  promoted event/PCM gates green; that older strict exact timing remained YM
  `5118` and POKEY `6446`.
- `sound-reply-ack-replay.ts` treats main `$FC0000` reads as absolute external
  events. For cmd tapes that include explicit video-frame `cycleInFrame`,
  `loadMainReplyAckCycles(...)` now subtracts the command frame origin rather
  than the first command's absolute timestamp. This fixes focused window ack
  phase without changing the promoted timestamp-only legacy tape. The full gate
  after this fix remained YM `51163/51163`, POKEY `27198/27198`, strict exact
  YM `5118`, strict exact POKEY `6446`, and PCM worst correlation
  `0.9965714236013331`.

Rejected diagnostic controls:

- Chip-write preemption around `PC 0x81b8`.
- Complete-before-target whole-instruction preemption.
- Focused `before-only` preemption on `PC 0x8e5b/0x8e62`; it preempts zero
  commands because these targets land in setup instructions before the later
  `STA (zp),Y` chip write.
- Byte-wide command-NMI delay `0` for `0x07`; it worsens the focused POKEY
  diagnostic from `3` to `7` tolerance-1 mismatches.
- Global reset/NMI/reply delays.
- Global YM/POKEY sample phase shifts.
- Global and opcode-only real POKEY write apply delays.
- Broad YM far/current-event command-edge rules. The focused experiment
  `/tmp/marble-love/audio-bitperfect/current-raw-bus-gate-20260524/chip-write-diff-experiment-ymfar-rules.json`
  worsened same-run YM `+-1` mismatches from `28` to `43`, so do not promote
  broad current-event corrections for the remaining YM edge.
- The older `soundcmdreads-eventzero` broad residual pack is also rejected for
  `current`: it reaches zero ordered-write mismatches, but
  `/tmp/marble-love/audio-bitperfect/current-raw-bus-gate-20260524/pcm-diff-soundcmdreads-eventzero-preset-verify.json`
  fails PCM thresholds with worst correlation `0.9925152953937386`, worst RMS
  `0.018900813990575922`, and worst maxAbs `0.09973713755607605`.
- The residual YM pack in
  `/tmp/marble-love/audio-bitperfect/current-raw-bus-gate-20260524/chip-write-diff-experiment-ym-specific-zero-attempt-rerun.json`
  is also rejected: it tries to cover `0x8403`, `0x8120`, `0x8e84`, and two
  crossing singles, but over-applies the `0x8120` rule and worsens current YM
  mismatches from `12` to `36`.
- Frame-specific event timestamp exceptions.

Promotion target:

- A causal scheduler/replay boundary model that explains MAME-like
  overshoot/catch-up without frame-specific patches.

## YM2151 Notes

Clock:

- `14.318181 MHz / 4 = 3.57954525 MHz`.
- Native sample cadence is `clock / 64`, about `55930.375 Hz`.

Current TS model includes:

- OPM KC/KF frequency path.
- DT1/DT2/MUL.
- Operator register block mapping.
- Per-operator key-on state.
- KSR-aware envelope rates.
- OPM LFO PM/AM and waveform-3 noise.
- Log-sine/power tables and YM3012-style output quantization.
- YM busy status after data-port writes.
- Timer A/B and IRQ behavior used by the Marble sound ROM.
- MAME speaker routing/order and route gain.

Useful references:

- MAME/ymfm OPM core for readable high-accuracy behavior.
- Nuked-OPM for more exact YM2151/YM2164 behavior when independent comparison
  is needed. Check LGPL implications before vendoring.
- JT51 Verilog as a hardware-oriented reference; GPL-3 makes direct vendoring
  unsuitable unless licensing is explicitly accepted.

Next YM work:

- Do not start with broad DSP rewrites while event timing still has exact
  bucket debt.
- After scheduler timing improves, compare envelope/LFO/operator residuals
  against MAME/ymfm/Nuked-OPM on narrow forced-command windows.

## POKEY Notes

Clock:

- `14.318181 MHz / 8 = 1.789772625 MHz`.
- Native audio divider uses `/28`, not a rounded fixed `63920 Hz`.

Current TS model includes:

- AUDF/AUDC/AUDCTL writes.
- Native-rate sampling and resampling into the shared PCM path.
- Raw-latch transition diagnostics.
- Current replay compromise values used by the canonical preset:
  `pokeySampleCycles=1`, `pokeyOutputSampleOffset=1`,
  `pokeyResampleOffset=23.25`.

Important POKEY hardware/reference notes:

- MAME POKEY documents borrow-cycle delay behavior.
- Channel reset matters.
- A new frequency does not become effective until the counter reaches zero.
- Linked 16-bit channels must be modeled as linked 8-bit counters, not as one
  monolithic 16-bit counter.
- Altirra Hardware Reference is the best document for POKEY timing and edge
  behavior.

Current POKEY diagnostic conclusion:

- The ordered write stream is green at tolerance `+-1`.
- Strict exact native-sample debt is still large but bounded.
- Direct MAME-write POKEY taps can improve some PCM edges, but that is
  diagnostic evidence for stream/update-boundary behavior, not a runtime rule.
- POKEY resample phase and post-clock sampling can improve isolated metrics but
  regress either mixed MAME WAV or direct MAME-chip gates; keep them out of the
  promoted preset.
- The worst replay-vs-direct POKEY PCM spikes are same-waveform raw transition
  timing differences, often one output sample at the edge. The sign changes
  across the run, so the next useful work is a causal replay-origin/stream
  boundary model, not a global phase offset.
- `probe-sound-sample-diff.ts` now records POKEY raw-transition cycle deltas,
  cycle-delta summaries, contiguous cycle-delta runs, and raw edge mismatch
  counts when comparing replay against direct MAME writes. The current focused
  557k window has `rawMismatchCount=0` and a 206-transition run at
  `cycleDelta=7306011`; surrounding runs sit at `7306039`, so this points at
  stream/counter phase, not wrong waveform state.
- `probe-sound-sample-diff.ts` supports
  `--pokey-write-apply-delay-opcodes` for causal state-timing experiments, but
  the current `0x91` sweep fails broad zero-lag PCM and must stay diagnostic.
- Do not promote direct-tap offsets or narrow match exceptions as final fixes.

## CLI / Oracle Workflow

Prepare sound ROMs:

```sh
mkdir -p /tmp/sound-roms
unzip -q -o roms/marble.zip 136033.421 136033.422 -d /tmp/sound-roms
```

Run targeted audio tests:

```sh
npx vitest run packages/engine/test/sound-chip-smoke.test.ts packages/engine/test/ym2151.test.ts packages/engine/test/pokey.test.ts packages/web/test/sound-renderer.test.ts --silent
```

Run typechecks:

```sh
npx tsc -p packages/engine/tsconfig.json --noEmit
npx tsc -p packages/web/tsconfig.json --noEmit
npx tsc -p packages/cli/tsconfig.json --noEmit
```

Run repo hygiene:

```sh
git diff --check
git status --short --branch
```

## Documentation Rules

- `GOAL.md` is the active dashboard.
- This file is the stable technical map.
- Use `/tmp/marble-love/audio-bitperfect/` for large generated artifacts.
- Archive long investigation logs under `docs/archive/`.
- Do not add thousands of lines of probe history to startup context files.
