# Audio Bit-Perfect Cycle-Log Checkpoint - 2026-05-24

This note archives the latest explicit-cycle investigation so `GOAL.md` can
stay compact.

## What Changed

- `oracle/mame_pokey_write_tap.lua` now emits `cycleInFrame` and absolute
  `cycle` for YM2151 writes, POKEY writes, and command-tape entries.
- `packages/cli/src/probe-sound-sample-diff.ts` gained
  `--direct-chip-write-cycle-timing attos|log` so direct MAME chip-write replay
  can consume explicit MAME cycles for diagnostics.

## Main Artifacts

- Full regenerated cycle-field MAME run:
  `/tmp/marble-love/audio-bitperfect/cycle-log-proof/full1701/`
- POKEY writes:
  `mame_pokey_writes_inject001f_1701_cyclefields.json`
- YM writes:
  `mame_ym_writes_inject001f_1701_cyclefields.json`
- Command tape:
  `mame_cmds_inject001f_1701_cyclefields.json`
- Replay-vs-direct POKEY cycle-log report:
  `/tmp/marble-love/audio-bitperfect/cycle-log-proof/pcm-diff-replay-vs-direct-pokey-realcycles-resetfetch27-cyclelog-rawtrace-s1080429-compact.json`
- Direct mixed cycle-log reports:
  `/tmp/marble-love/audio-bitperfect/cycle-log-proof/pcm-diff-direct-mixed-cyclelog-offset16-compact.json`
  and
  `/tmp/marble-love/audio-bitperfect/cycle-log-proof/pcm-diff-direct-mixed-cyclelog-offset19-compact.json`

## Findings

- The regenerated full run is deterministic against the old write stream:
  POKEY `27198`, YM `51163`, commands `1579`; comparing event identity and
  existing timestamps against the old JSON produced no mismatches.
- First POKEY write: frame `244`, `cycleInFrame=25542`, `cycle=7313334`,
  `pc=0x824d`, `reg=0x08`, `data=0x00`.
- Write index `30`: frame `245`, `cycleInFrame=27245`, `cycle=7344905`,
  `pc=0x8e28`, `reg=0x04`, `data=0x00`.
- Key SKCTL writes:
  index `4793`, frame `500`, `pc=0x8267`, `reg=0x0f`, `data=0x03`,
  `cycleInFrame=5005`, `cycle=14939005`;
  index `23426`, frame `1500`, `cycleInFrame=9663`, `cycle=44811663`.
- Logged MAME cycles differ from the old POKEY-clock attos conversion by `+3`
  cycles near the first writes and `+15` by the end. At the two SKCTL writes the
  deltas are `+5` and `+14`.
- Using explicit cycles does not close the inspected replay-vs-direct POKEY PCM
  window: lag `305`, corr `0.982084`, RMS `0.018587`, maxAbs `0.167506`.
- Direct mixed MAME-chip rendering with logged cycles also fails against the
  MAME WAV:
  offset `-16` worst corr `0.9983`, maxAbs `0.07029`;
  offset `-19` worst corr `0.9985`, maxAbs `0.07029`.

## Interpretation

The cycle-field tap is useful and should stay, but cycle-log timing is not a
promoted audio fix. The promoted gates remain on the `secs/attos` same-run
baseline. The next useful work is still the `pc=0x8267` `SKCTL=0x03` enable
path: compare TS sound-CPU scheduler phase and MAME fetch/write phase at indices
`4793` and `23426` before changing oscillator, mixer, or resampler logic.

## Online Reference Triage

- MAME Atari System 1 driver documents the sound CPU map: YM2151 at
  `1800-1801`, sound command at `1810`, POKEY at `1870-187F`, NMI on sound
  command.
- MAME POKEY is the immediate oracle; its 2022 accuracy update came from the
  A7800 project.
- Altirra Hardware Reference Manual is the best hardware-level POKEY timing
  document found.
- For YM2151/OPM DSP parity, use MAME `ymopm`/`ymfm` first, then compare with
  Nuked-OPM and JT51.
