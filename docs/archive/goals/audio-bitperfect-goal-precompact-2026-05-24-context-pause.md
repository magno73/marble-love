# Audio Bit-Perfect Pause Checkpoint - 2026-05-24

This note preserves the detailed context removed from the startup files during
the pause/compaction pass. Keep `GOAL.md` and `STATUS.md` compact.

## Proven Baseline

- Promoted preset: `inject001f-1701-commandedge`.
- Same-run oracle:
  `/tmp/marble-love/audio-bitperfect/current-samerun-soundcmdreads-wav-20260524/`.
- Explicit-cycle MAME capture:
  `/tmp/marble-love/audio-bitperfect/cycle-log-proof/full1701/`.
- Current MAME tap emits `cycle` and `cycleInFrame` for YM/POKEY writes and
  command-tape entries.
- Promoted `secs/attos` gates:
  - YM ordered writes at native-sample tolerance `+-1`: `51163/51163`.
  - POKEY ordered writes at native-sample tolerance `+-1`: `27198/27198`.
  - Raw bus offset parity green; reply acks scheduled `1528/1528`.
  - Audible PCM windows `212/212`, lag `0`, worst corr `0.996571`,
    RMS `0.005535`, maxAbs `0.041395`.

## Open Evidence

- Strict tolerance `0` is open: YM `5100/51163`, POKEY `6446/27198`.
- Real `cycleInFrame` tape plus `--reset-first-fetch-after-command 27` gives
  exact POKEY raw bus parity, but POKEY replay-vs-direct PCM still fails.
- POKEY replay-vs-direct cycle-log report:
  `/tmp/marble-love/audio-bitperfect/cycle-log-proof/pcm-diff-replay-vs-direct-pokey-realcycles-resetfetch27-cyclelog-rawtrace-s1080429-compact.json`
  has lag `305`, corr `0.982084`, RMS `0.018587`, maxAbs `0.167506`.
- Direct mixed MAME-chip render against MAME WAV remains red with cycle-log
  timing: offset `-16` worst corr `0.9983`, maxAbs `0.07029`; offset `-19`
  worst corr `0.9985`, maxAbs `0.07029`.
- Blind phase fits are rejected: reference POKEY offset `-12` and TS
  `--pokey-resample-offset ~=31.5` improve replay-vs-direct locally but
  regress direct MAME WAV gates. Keep reference offset `-16` and TS POKEY
  resample offset `23.25`.

## SKCTL Finding

- Early write index `30`, frame `245`, `pc=0x8e28`, `reg=0x04`, `val=0x00`
  is explained as relative write-timeline phase: relative cycle delta `+4`
  plus POKEY poly clock delta `-4` sums to `0`.
- First unexplained joint residuals are introduced by `SKCTL=0x03` writes at
  `pc=0x8267`:
  - index `4793`, frame `500`, residual `-7`;
  - index `23426`, frame `1500`, residual `-21`.
- Before each write, `AUDCTL=0x00`, `SKCTL=0x00`, `clockCnt28/114=0`, and poly
  is frozen/aligned. This points at reset/release timing or sound-CPU
  scheduling around SKCTL enable.
- Targeted reports:
  `/tmp/marble-love/audio-bitperfect/skctl-cycle-proof/pokey-skctl-8267-attos-report.json`,
  `/tmp/marble-love/audio-bitperfect/skctl-cycle-proof/pokey-skctl-8267-log-report.json`,
  `/tmp/marble-love/audio-bitperfect/skctl-cycle-proof/pokey-skctl-8267-log-fixedframe-report.json`.
- Normal variable frame budgets: targeted SKCTL writes are late by `0`, `4`,
  and `8` replay cycles.
- `--fixed-frame-cycles` reduces targeted SKCTL lateness to `0`, `1`, and `4`,
  but global strict POKEY mismatches worsen from `17214` to `17232`. Treat it
  as diagnostic only.

## PCM Fixed-Frame Diagnostic

- `probe-sound-sample-diff.ts` now accepts `--fixed-frame-cycles`, matching
  `probe-chip-write-diff.ts`. It clears `tape.frameCycleBudgets` for the main
  replay and the command-edge prepass.
- Single inspected window:
  - variable frame budgets:
    `/tmp/marble-love/audio-bitperfect/skctl-cycle-proof/pcm-diff-replay-vs-direct-pokey-variableframe-cyclelog-rawtrace-s1080429-compact.json`
    failed with lag `305`, corr `0.982084`, RMS `0.018587`, maxAbs `0.167506`.
  - fixed frame cycles:
    `/tmp/marble-love/audio-bitperfect/skctl-cycle-proof/pcm-diff-replay-vs-direct-pokey-fixedframe-cyclelog-rawtrace-s1080429-compact.json`
    passed with lag `490`, corr `0.998860`, RMS `0.004674`, maxAbs `0.046569`.
- First 8 auto-selected audible windows:
  - variable frame budgets:
    `/tmp/marble-love/audio-bitperfect/skctl-cycle-proof/pcm-diff-replay-vs-direct-pokey-variableframe-cyclelog-auto-windows8-compact.json`
    failed with worst corr `0.8959`, RMS `0.01231`, maxAbs `0.07459`.
  - fixed frame cycles:
    `/tmp/marble-love/audio-bitperfect/skctl-cycle-proof/pcm-diff-replay-vs-direct-pokey-fixedframe-cyclelog-auto-windows8-compact.json`
    passed with worst corr `0.9983`, RMS `0.00320`, maxAbs `0.03868`.
- Interpretation: fixed frame cycles are not promotable yet because global
  strict POKEY write parity worsens, but PCM behavior strongly implicates the
  current frame-budget derivation from command timestamps.

## Frame Budget Audit

- Added repeatable CLI:
  `packages/cli/src/probe-cmd-tape-frame-budgets.ts`.
- Reports:
  - `/tmp/marble-love/audio-bitperfect/skctl-cycle-proof/cmd-tape-frame-budget-audit-cyclefields.json`
  - `/tmp/marble-love/audio-bitperfect/skctl-cycle-proof/cmd-tape-frame-budget-audit-realcycles-tape.json`
- For `cycleInFrame` replay, `loadCmdTape` derives frame budgets from the first
  command origin in each frame. That produces:
  - `29868`: `1025` loaded frame budgets;
  - `29869`: `217`;
  - `29867`: `214`.
- Recomputing origins from all MAME chip writes gives much less variable frame
  evidence:
  - YM: `29868` for `1429` consecutive frame intervals, `29869` for `15`,
    `29867` for `12`;
  - POKEY: same `1429/15/12` distribution.
- YM and POKEY origins agree on `1450/1457` common frames. Cmd-tape origins
  differ from chip origins by `-1` cycle on about `438` frames and by `+1` on
  about `67-69` frames.
- At the key frames:
  - frame `244`: cmd/YM/POKEY origin residual all `0`;
  - frame `500`: cmd residual `0`, YM/POKEY residual `1`;
  - frame `1500`: cmd/YM/POKEY residual all `2`.
- Interpretation: the variable frame-budget map is mostly timestamp rounding
  from first-command origins, not strong chip-event evidence for real 29867/29869
  replay frames. The next implementation experiment should use an explicit
  frame-budget policy for `cycleInFrame` replay, then re-run strict ordered
  writes and PCM gates before promotion.

## Frame Budget Smoothing Experiment - 2026-05-24 06:55 CEST

- Added a diagnostic `--frame-budget-smoothing-window` option to the CLI probes
  and `loadCmdTape`; `15` means a median half-window of 15 frames over
  frame-origin residuals.
- Reports:
  - `/tmp/marble-love/audio-bitperfect/skctl-cycle-proof/ym-log-variable-report.json`
  - `/tmp/marble-love/audio-bitperfect/skctl-cycle-proof/ym-log-fixedframe-report.json`
  - `/tmp/marble-love/audio-bitperfect/skctl-cycle-proof/ym-log-smooth15-report.json`
  - `/tmp/marble-love/audio-bitperfect/skctl-cycle-proof/pokey-skctl-8267-log-smooth15-report.json`
  - `/tmp/marble-love/audio-bitperfect/skctl-cycle-proof/pcm-diff-replay-vs-direct-pokey-smooth15-cyclelog-auto-windows8-compact.json`
- Strict log-cycle write mismatches:
  - YM variable: `42925/51163`; fixed: `43033/51163`; smooth15: `43019/51163`.
  - POKEY variable: `17214/27198`; fixed: `17232/27198`; smooth15: `17224/27198`.
- Targeted `pc=0x8267`, `SKCTL=0x03` POKEY writes:
  - variable: `1/3` native-sample mismatches, replay delta max `8`;
  - fixed: `0/3`, replay delta max `4`;
  - smooth15: `0/3`, replay delta max `1`.
- POKEY replay-vs-direct PCM first 8 audible windows:
  - variable fails with worst corr `0.895877694989404`, RMS
    `0.012313148049077044`, maxAbs `0.07459489885150106`;
  - fixed passes with worst corr `0.9983172971515375`, RMS
    `0.0032031220838091945`, maxAbs `0.038681065605487674`;
  - smooth15 passes with worst corr `0.9983131881170656`, RMS
    `0.0032031220838091945`, maxAbs `0.038681065605487674`.
- Decision: do not promote fixed or smoothed frame budgets. They are strong
  diagnostics for the reset/SKCTL area and PCM behavior, but they regress global
  strict ordered write parity. Next focus stays on explaining frame `1500`
  reset-entry timing.

## External Reference Search

- MAME Atari System 1 confirms Marble Madness uses YM2151 at
  `14.318181_MHz_XTAL/4` and POKEY at `14.318181_MHz_XTAL/8`, with routes
  `0.48` for YM stereo channels and `0.24` for POKEY.
- MAME POKEY is the primary executable reference; the current accuracy work is
  derived in part from the A7800 project.
- Altirra Hardware Reference is useful for POKEY timer periods, AUDCTL, clock
  selection, and polynomial behavior.
- MAME `ymopm.cpp` wraps `ymfm`; `ymfm` describes clock-independent chip cores
  and requires the consumer to resample to normal audio rates.
- Nuked-OPM and JT51 are useful secondary YM2151 references, not the first
  parity target.
