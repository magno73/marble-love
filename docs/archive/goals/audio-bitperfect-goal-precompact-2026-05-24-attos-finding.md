# GOAL - Audio Bit-Perfect

This is startup context for the active goal. Full prior notes are archived in:

- `docs/archive/goals/audio-bitperfect-goal-precompact-2026-05-24.md`
- `docs/archive/goals/audio-bitperfect-goal-log-2026-05-23.md`
- `docs/archive/audio-bitperfect-sound-system-log-2026-05-23.md`

## Objective

Move Marble Love audio toward MAME parity on the deterministic
`soundReplay`/cmd-tape path first. Close ordered YM2151/POKEY write timing, then
PCM parity on audible windows. Keep oracle capture, CLI diagnostics, web replay,
and gameplay audio separate.

## Current Truth

Not bit-perfect yet.

Promoted deterministic preset: `inject001f-1701-commandedge`, with legacy
timestamp replay origins and the narrow same-run YM residual timing pack.

Green on the promoted oracle:

- YM2151 ordered writes at native-sample tolerance `+-1`: `51163/51163`, `0`
  mismatches.
- POKEY ordered writes at native-sample tolerance `+-1`: `27198/27198`, `0`
  mismatches.
- Audible PCM windows: `212` pass, lag `0`, worst correlation
  `0.9965714236013331`, worst maxAbs `0.041395485401153564`.
- Latest PCM rerun after the promoted narrow YM residual pack:
  `current-raw-bus-gate-20260524/pcm-diff-current-preset-after-ym0.json`
  remains green with the same worst correlation/maxAbs.

Still open:

- Exact native-sample timing. Latest strict same-run gate
  `strict-native-sample-20260524/chip-write-diff-current-preset-raw-offset-sampletol0-after-preset-gate.json`
  has YM `5096` and POKEY `6465` mismatches at tolerance `0`, with the
  preset-required raw bus offset gate still green.
- PCM is close on `current`, but not byte/sample exact.
- The `soundReplay` oracle is the bit-perfect workbench. Normal `?sound=1`
  gameplay must stay on real engine commands and must not gain synthetic cues.

## Latest Diagnostic State

Useful artifact dirs:

- `/tmp/marble-love/audio-bitperfect/current-videoframe-fallback-20260524/`
- `/tmp/marble-love/audio-bitperfect/current-replyack-frameorigin-20260524/`
- `/tmp/marble-love/audio-bitperfect/current-samerun-soundcmdreads-20260524/`
- `/tmp/marble-love/audio-bitperfect/cmd-read-capture-smoke-20260524/`
- `/tmp/marble-love/audio-bitperfect/current-nmi-phase-20260524/`
- `/tmp/marble-love/audio-bitperfect/current-command-index-origin-20260524/`
- `/tmp/marble-love/audio-bitperfect/current-raw-bus-gate-20260524/`
- `/tmp/marble-love/audio-bitperfect/strict-native-sample-20260524/`

New MAME oracle support:

- `oracle/mame_sound_cmd_capture.lua` now emits `soundCmdReads`.
- Full same-run oracle:
  `/tmp/marble-love/audio-bitperfect/current-samerun-soundcmdreads-20260524/`
  has `1579` cmds, `1579` sound command reads, `1528` reply acks, `51163` YM
  writes, and `27198` POKEY writes.
- The same-run explicit-cycle oracle is now green for both chips on `current`:
  `current-raw-bus-gate-20260524/chip-write-diff-current-preset-soundcmdreads-ym0-pokey0.json`
  has YM `51163/51163` and POKEY `27198/27198`, `0` mismatches at tolerance
  `+-1`, `nativeSampleMaxAbs=1`, and raw bus offset parity still green.
- The promoted YM `0x83fc` current-event rule is constrained to command byte
  `0x03`, command sound PC `0x83fc`, raw-before `300..14000` cycles, and a
  `-42` cycle current-event target. It reduces same-run YM `+-1` mismatches
  from `28` to `12` while preserving raw bus offset parity.
- The promoted narrow YM residual pack closes the last `12` same-run YM
  `+-1` mismatches without using frame-specific rules. It is constrained by
  command byte, command sound PC, raw relation/delta, write PC, register, and
  value for the remaining `0x8123`, `0x8ff5`, `0x8120`, `0x8403`, and
  `0x8e84` edges.
- New raw bus-write offset gate:
  `current-raw-bus-gate-20260524/chip-write-diff-current-preset-soundcmdreads-raw-bus-offset-gate.json`
  passes with YM `51163/51163` and POKEY `27198/27198`, `0` mismatches,
  `writeOffsetDelta=[0,0]` for both chips.
- The `current` preset now requires that raw bus-write offset gate directly:
  `--require-raw-bus-write-parity`, `--raw-bus-write-parity-mode offset`,
  zero tolerance, and zero max mismatches. Rerun
  `strict-native-sample-20260524/chip-write-diff-current-preset-raw-offset-sampletol0-after-preset-gate.json`
  confirms raw bus offset parity remains green while strict native-sample
  mismatches stay YM `5096`, POKEY `6465`.
- Latest global sample-phase sweep:
  `strict-native-sample-20260524/chip-write-diff-current-preset-raw-offset-sampletol0-phases0-63.json`
  still leaves best exact mismatches at YM `5047` (`29` or `61` cycles) and
  POKEY `6365` (`22` or `54` cycles), so a single global sample phase is not a
  causal fix for strict timing.
- Current state-compare rerun:
  `current-raw-bus-gate-20260524/chip-write-diff-current-preset-soundcmdreads-statecompare.json`
  keeps the raw bus offset gate green and adds command-submit state comparison.
- Legacy same-run `eventzero` checkpoint:
  `current-raw-bus-gate-20260524/chip-write-diff-soundcmdreads-eventzero-preset-verify.json`
  passes with YM `51163/51163`, POKEY `27198/27198`, `0` mismatches at
  tolerance `+-1`, `nativeSampleMaxAbs=1`, and raw bus offset parity green for
  both chips, but it is not the promoted preset because its broad residual
  rules are not PCM-safe:
  `current-raw-bus-gate-20260524/pcm-diff-soundcmdreads-eventzero-preset-verify.json`
  fails thresholds with worst correlation `0.9925152953937386`, worst RMS
  `0.018900813990575922`, and worst maxAbs `0.09973713755607605`. Worst mixed
  windows start at samples `1142784`, `1146880`, and `1138688`.

Rejected timing attempts:

- Automatic timestamp-only video-cycle replay failed badly.
- Fixed `29868` frame budgets on legacy origins failed badly and skipped reply
  acks.
- Global `command-nmi-delay-instructions=0` and `0 + sample-cycle=2` worsened
  event parity on the new sound-read oracle.
- Diagnostic `--command-preempt-chip-write-lookahead 64` badly desynchronizes
  ordered writes; keep it rejected.
- Diagnostic `--reset-release-delay 12000` badly desynchronizes ordered writes;
  keep reset-release delay unpromoted.
- Diagnostic `--command-submit-before-cpu-catchup` models an external command
  line before local sound-CPU catch-up, but it badly desynchronizes ordered
  writes and breaks the raw bus gate. Keep it rejected.
- Broad YM far/current-event command-edge rules are rejected. The experiment
  `current-raw-bus-gate-20260524/chip-write-diff-experiment-ymfar-rules.json`
  worsened same-run YM `+-1` event mismatches from `28` to `43`, while raw bus
  offset parity stayed green.
- A broader residual-YM pack for `0x8403`, `0x8120`, `0x8e84`, and the two
  crossing singles is also rejected:
  `current-raw-bus-gate-20260524/chip-write-diff-experiment-ym-specific-zero-attempt-rerun.json`
  worsened current YM mismatches from `12` to `36` by over-applying the
  `0x8120` far rule.
- The older `soundcmdreads-eventzero` preset also includes broad `0x8403` and
  `0x8e84` residual rules. Those rules are rejected for `current` because the
  event gate is green but the PCM gate is red. The promoted residual pack keeps
  only the narrower event rules that preserve PCM thresholds.

Important finding:

- For the new full oracle, raw YM bus-write timing aligns with MAME instruction
  fetch plus write offset: `tsRawWriteMinusMameFetchDelta={0:51163}`.
- For the same oracle, the promoted offset-only raw bus gate proves both chips
  have exact CPU bus-write offsets versus MAME instruction context. Therefore
  the remaining strict mismatch should not be treated as a generic 6502
  write-offset bug. Split the proof into replay-origin/absolute event timing,
  chip-event application/native sample timing, and DSP/mixer output.
- Absolute raw bus replay deltas still fail (`maxAbs` about YM `297`, POKEY
  `299` cycles), so do not promote absolute-cycle bus parity until replay
  origins/frame normalization are understood.
- The 2026-05-24 NMI-phase checkpoint extends cmd-tapes and window diffs with
  expected sound CPU state (`soundPc/A/X/Y/P/SP`) at command submit. In the
  valid frame `1615` window the command byte and submit cycle match MAME, but
  TS is already one command-table index ahead before submit: TS sees
  `$0210/$0211 = 0x05` and submit state `PC=0x80f0 A=0x00 X=0x05 P=0x23`,
  while the MAME/tape expectation is index `0x04` and
  `PC=0x8126 A=0x10 X=0x04 P=0x33`.
- Diagnostic Timer A phase control (`--timer-a-start-delay -3238`) nearly
  aligns the first post-NMI chip write in that window, but it does not fix the
  command-boundary state. Do not promote it.
- New MAME RAM reruns in `current-nmi-phase-20260524` did not reproduce the
  historical command tape around frame `1615`; keep them as rejected diagnostic
  attempts, not proof artifacts.
- The same-run command-index checkpoint adds a `commandExpectedState` summary
  to `probe-sound-window-trace.ts`. On the current same-run cmd tape,
  `X` matches MAME through frames `245..248` (`0,1,2,3`) and first diverges at
  frame `249`: TS is already executing `PC=0x9009 A=0x01 X=0x11 P=0x24`
  while the tape expects `PC=0x8126 A=0x10 X=0x04 P=0x33`. The RAM trace shows
  `$0210/$0211` are still `0x04` before that submit, so this is not yet a
  stale command-table index write; it is an IRQ/scheduler phase issue before
  the next table advance.
- A diagnostic pending-IRQ boundary preemption (`--command-preempt-pending-irq-lookahead 64`)
  moves the first `X` mismatch from frame `249` to `250`, but still misses the
  expected MAME subroutine state at `0xe54a`. Keep it diagnostic only.
- `loadCmdTape` now preserves MAME instruction context (`instPc`,
  `instOpcode`, `instDeltaCycles`, `nextChronoInst*`) for diagnostics, and
  `probe-sound-window-trace.ts` emits `commandInstContext` plus a compact
  `ymStatus` summary. The focused artifact
  `current-command-index-origin-20260524/ts-pcfull-245-250-irqpreempt56-nmidelay100-instcontext.json`
  shows TS fetches MAME's `instPc` within `18..28` cycles for frames
  `246..250`; frame `250` expects `$e54a` with `instDeltaCycles=486`, and TS
  fetched `$e54a` at frame `249` cycle `29360`, only `21` cycles before the
  MAME instruction timestamp.
- That refines the causal model: the late frame-`249` Timer A IRQ and YM status
  path are close enough to MAME instruction context. The command-submit state
  mismatch is now more likely TS over-advancing the sound CPU to the external
  command boundary before sampling/injecting, while MAME's main-side command
  capture exposes the sound CPU's last scheduled local instruction context.
  Do not fix this by globally slowing YM busy, changing command table state, or
  promoting the frame-specific NMI-delay experiment.
- `probe-chip-write-diff.ts` now records actual TS submit CPU state and compares
  it with the MAME command-tape state. On the same-run oracle it reports
  `expected=1579/1579`, `actual=1578/1579`, `exact=0`,
  `exactIgnoringP=64`, with PC mismatches on `1507` commands. PC relation
  buckets are `{other:1361,nextChronoInstPc:75,soundPc:72,nextInstPc:70,?:1}`.
  The first non-reset mismatch is frame `245`: MAME tap state reports
  `PC=0x8100`, while TS is already at `PC=0x810b`. Treat this as
  scheduler/local-time evidence; it is not fixed by a simple reset delay or
  by submitting command/NMI before CPU catch-up.

## Guardrails

- Preserve unrelated dirty work. Do not revert boot-flow, terrain, renderer,
  gameplay, collision, or web-main changes.
- `packages/web/src/main.ts` is dirty/contended; avoid it unless an isolated
  audio block is unavoidable.
- Keep bulky reports under `/tmp/marble-love/audio-bitperfect/`.
- Do not promote frame-specific timing exceptions, blind offset sweeps, or
  byte-specific NMI hacks.

## External References

Checked on 2026-05-24:

- MAME `atarisy1.cpp`: Atari System 1 sound wiring, YM2151/POKEY clocks/routes.
- MAME CPU scheduler notes: round-robin execution, local CPU time, instruction
  overshoot, timer dispatch.
- `ymfm`: BSD-licensed Yamaha FM cores; best candidate if replacing the
  hand-written YM2151 DSP.
- MAME `ymopm.cpp`: current MAME YM2151 wrapper around `ymfm`.
- MAME `pokey.cpp` and Altirra Hardware Reference: best POKEY references.
- Nuked-OPM and JT51 are useful comparison cores, but have licensing/integration
  tradeoffs.

## Next Action

1. Stop broad experimentation.
2. Keep the promoted `+-1` event and PCM gates stable.
3. Keep the preset-required raw bus-write offset gate in every promoted event
   rerun: `--require-raw-bus-write-parity --raw-bus-write-parity-mode offset`.
4. Keep `inject001f-1701-soundcmdreads-eventzero` as a historical broad-rule
   diagnostic only; `current` is now the ordered-write checkpoint.
5. Investigate absolute replay-origin drift and strict native-sample timing as
   event application/audio scheduler issues, starting from the same-run
   `soundCmdReads` oracle.
6. Replace the pending-IRQ boundary experiment with a causal scheduler/local
   CPU-time model: MAME command capture can observe a sound CPU instruction
   context hundreds of cycles before the external command boundary, while TS
   currently samples after catch-up to that boundary.
7. After the boundary model is causal, rerun the promoted YM/POKEY and PCM
   gates before touching DSP.
8. Evaluate `ymfm` reuse before spending more time on the custom YM2151 DSP.

## Validation

Targeted checks:

```sh
npx vitest run packages/engine/test/sound-chip-smoke.test.ts packages/engine/test/ym2151.test.ts packages/engine/test/pokey.test.ts packages/web/test/sound-renderer.test.ts --silent
npx tsc -p packages/engine/tsconfig.json --noEmit
npx tsc -p packages/web/tsconfig.json --noEmit
npx tsc -p packages/cli/tsconfig.json --noEmit
git diff --check
git status --short --branch
```
