# Audio Bit-Perfect POKEY 206-Event Residual Note - 2026-05-24

This note preserves detailed evidence removed from `GOAL.md` when the active
goal file was compacted. Bulky JSON reports stay under
`/tmp/marble-love/audio-bitperfect/`.

## Current Oracle

- Same-run oracle:
  `/tmp/marble-love/audio-bitperfect/current-samerun-soundcmdreads-wav-20260524/`
- Promoted deterministic preset: `inject001f-1701-commandedge`
- Cmd-tape timing: `secs/attos`

## Green Gates

- YM2151 ordered writes at native-sample tolerance `+-1`: `51163/51163`, `0`
  mismatches.
- POKEY ordered writes at native-sample tolerance `+-1`: `27198/27198`, `0`
  mismatches.
- Raw bus offset parity: green; reply acks scheduled `1528/1528`.
- Audible PCM windows: `212/212`, lag `0`, worst correlation
  `0.9965714236013331`, RMS `0.005534884943771918`, maxAbs
  `0.041395485401153564`.

## Open Gaps

- Strict native-sample tolerance `0`: YM `5100/51163`, POKEY `6446/27198`.
- Direct MAME writes through the TS DSP are still closer to MAME WAV than
  SoundChip replay: direct corr about `0.9992`; replay-vs-direct mixed corr
  about `0.9960`.
- POKEY raw bus parity is exact; the remaining POKEY issue is effective
  apply/audio timing plus downstream PCM phase, not write order.

## Key POKEY Evidence

- POKEY raw replay-vs-direct trace compares `17286` transitions with
  `rawMismatchCount=0`.
- After removing absolute cycle-origin offset, `17067/17286` cycle residuals
  are `0`.
- Local PCM residual best-lag histogram around raw transitions:
  `{0:17080,-1:206}`.
- The isolated `206`-event group is channel 3 only:
  - `AUDCTL=0`, `SKCTL=3`
  - `AUDF3=0x51`
  - `AUDC3=0xa7/0xaf`
  - other channels at `AUDC=0xa0`
- The group has `cycleDeltaResidual=-28`, local best lag `-1`, and raw
  transitions `0x0000<->0x0700` / `0x0000<->0x0f00`.
- The latest timing-run console summary identifies the group as
  `#317-522:n=206` globally, and `#167-372:n=206` in the focused `560k`
  report.

## Command Cadence Evidence

- Command-submit trace:
  `pcm-diff-replay-vs-direct-pokey-command-submit-trace-20260524.json`.
- Around reset release, frame `245` command byte `0x03` is submitted at replay
  cycle `12150` with expected MAME `instPc=0x8100 opcode=0x58`, but TS is
  already at `actualSoundPc=0x810b opcode=0xcc`.
- Frame `246` expects `0x8108/0xac`, while TS is at `0x8138/0x4c`.
- This makes the first POKEY split look like a reset/bootstrap replay cadence
  issue before it becomes a POKEY DSP issue.
- Added CLI diagnostic flag `--trace-frame-advance`, reported as
  `ts.frameReplayEvents`, to capture per-frame replay schedule/cpu deltas.
- Baseline frame trace:
  `/tmp/marble-love/audio-bitperfect/command-catchup-debug/pokey-frame-advance-baseline-report.json`.
  It shows frame `244` has `frameCycles=12150` and `cpuEndDelta=0`; TS uses
  the captured frame budget exactly but arrives too far into the boot code.
- `probe-pc-cycles` bootstrap trace:
  `/tmp/marble-love/audio-bitperfect/command-catchup-debug/ts-pc-cycles-bootstrap-trace.json`.
  MAME tape says first chronological fetch `0x8002` is `27` cycles after the
  reset-frame command, while TS records `0x8002` at cycle `0` after release.
- Diagnostic `--reset-release-delay 27` improves the first checked audible
  window strongly (`RMS 0.00060 -> 0.00023`, `maxAbs 0.01174 -> 0.00487`) and
  moves the frame `245` command context from TS `0x810b` to MAME
  `nextChronoInstPc=0x80f4` with a small instruction-boundary overrun.
- The same delay is not promotable by itself:
  `/tmp/marble-love/audio-bitperfect/command-catchup-debug/pokey-reset-release-delay27-rawtrace-560k-report.json`
  fails the wider POKEY raw-trace PCM gate, with `rawMismatches=173` and later
  windows below threshold. The delay finding should feed a cadence fix, not a
  blind global offset.

## Rejected Diagnostics

- Global and frame-specific apply delay for `pc=0x8e28 reg=0x04 val=0x00`:
  leaves the `206`-event lag bucket unchanged and worsens early device-write
  phase.
- Broad `AUDCTL` apply delay: fails the POKEY replay-vs-direct gate.
- AUDF/AUDC positive apply delays around channel 3 volume enable: did not
  change the `206`-event group.
- Command target offsets from frame `245`: `+1` fails the PCM gate and leaves
  the first device-write split unchanged; `-1` also leaves the first split
  unchanged.
- `--command-submit-before-cpu-catchup`: does not change the first frame-start
  command mismatch and causes replay health regressions (`skippedAckCount=86`);
  keep it diagnostic only.
- `--reset-release-delay 27` by itself: useful evidence for reset/bootstrap
  alignment, but rejected as a standalone promotion target because it breaks the
  wider POKEY raw trace.
- Direct reference origin `cmd-tape-replay`: breaks PCM window alignment.
- Forcing direct-chip reference to sound CPU rate: worse than POKEY/auto.
- MAME `audio_resampler_lofi` block projection and local gain correction:
  diagnostic only, not promotion targets.

## External References Checked

- MAME POKEY/YM2151 sources:
  `https://github.com/mamedev/mame/tree/master/src/devices/sound`
- MAME sound stream docs:
  `https://docs.mamedev.org/techspecs/device_sound_interface.html`
- MAME Atari System 1 driver:
  `https://github.com/mamedev/mame/blob/master/src/mame/atari/atarisy1.cpp`
- Altirra Hardware Reference Manual, POKEY chapter:
  `https://www.atari800xl.eu/docs/reference/altirra-hardware-reference-manual.pdf`
- `ymfm` YM2151 core:
  `https://github.com/aaronsgiles/ymfm`
- Nuked-OPM:
  `https://github.com/nukeykt/Nuked-OPM`
- JT51:
  `https://github.com/jotego/jt51`

## Next Technical Question

Why does reset/bootstrap replay cadence drift before frame `245`, causing TS to
reach the command boundary at a later sound PC than MAME, while raw POKEY
transition order remains exact? Inspect that cadence before adding more blind
POKEY phase offsets.
