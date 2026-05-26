# Audio Bit-Perfect Write-Phase Checkpoint - 2026-05-24

## Context

Goal remains active. This checkpoint records a diagnostic-only CLI update for
POKEY replay-vs-direct timing on the real-cycle/reset-fetch branch.

Primary report:

```text
/tmp/marble-love/audio-bitperfect/reset-cadence-proof/pcm-diff-replay-vs-direct-pokey-realcycles-resetfetch27-rawtrace-s1080429-writephase-v2-compact.json
```

Command shape:

```sh
npx tsx packages/cli/src/probe-sound-sample-diff.ts \
  --audio-bitperfect-preset inject001f-1701-replay-vs-direct-mamechip-pokey \
  --mame /tmp/marble-love/audio-bitperfect/current-samerun-soundcmdreads-wav-20260524/mame_inject001f_1701_soundcmdreads_wavrun.wav \
  --cmd-tape /tmp/marble-love/audio-bitperfect/reset-cadence-proof/mame-cmds-inject001f-1701-realcycles.json \
  --cmd-tape-command-timing cycle \
  --reference-mame-pokey-writes /tmp/marble-love/audio-bitperfect/current-samerun-soundcmdreads-wav-20260524/mame_pokey_writes_inject001f_1701_soundcmdreads_wavrun.json \
  --reset-first-fetch-after-command 27 \
  --window-start 1073152 \
  --max-windows 1 \
  --max-lag 4096 \
  --max-abs-lag 4096 \
  --pokey-raw-trace-center-sample 1080429 \
  --pokey-raw-trace-radius 6000 \
  --pokey-raw-trace-pcm-radius 48 \
  --pokey-raw-trace-pcm-max-lag 4096 \
  --compact-report
```

The probe exits `1` as expected because this is the failing diagnostic branch.

## Probe Change

`packages/cli/src/probe-sound-sample-diff.ts` now includes POKEY write snapshot
diagnostics for:

- pre/post `clockCnt114`;
- pre/post poly4/poly5/poly9/poly17 state;
- pre-write `clockCnt114` and poly delta histograms;
- first mismatches for `clockCnt114` and poly state;
- console summary for write snapshot comparison.

## Result

The old rawtrace finding still reproduces:

- dominant raw-transition alignment `+305`;
- `0/182` exact state matches;
- `clockCnt28` aligned in the aligned raw-transition pairs;
- `clockCnt114`, counters, and poly state drift.

The new write-boundary comparison shows the drift exists much earlier:

- compared snapshots: `27189`;
- pre-write `clockCnt114=0`: `2848/27189`;
- pre-write poly modulo `0,0,0,0`: `2848/27189`;
- first `clockCnt114`/poly/counter mismatch: index `30`, frame `245`;
- write: `pc=0x8e28`, `reg=0x04`, `val=0x00`;
- first-origin relative cycle delta: `+4`;
- `clockCnt28=-4`, `clockCnt114=-4`;
- counter delta: `[-4,0,-4,0]`;
- poly modulo delta: `[11,27,507,131067]`.

## Interpretation

The POKEY phase problem is already visible at write boundaries shortly after
reset release. The next investigation should inspect the first 30-40 POKEY
writes on the real-cycle branch, especially reset release, STIMER/AUDF writes,
and write apply timing. Do not promote global offsets or change oscillator logic
until this early write-phase drift is explained.
