# Audio Bit-Perfect Reset Cadence Checkpoint - 2026-05-24

This note archives the reset-frame/cycle-tape finding so `GOAL.md` can stay
small.

## Why This Was Checked

The older promoted same-run cmd tape was deterministic and useful, but it did
not carry `cycleInFrame` in the checked-in web scenario and most historical
captures effectively normalized one command per frame to the frame edge. That
kept the replay green enough for `secs/attos`, but hid the reset-frame cadence.

## MAME Reset Evidence

Artifacts:

- `/tmp/marble-love/audio-bitperfect/reset-cadence-proof/mame-window-244-245-reset.json`
- `/tmp/marble-love/audio-bitperfect/reset-cadence-proof/mame-reset-release-tap-300.json`
- `/tmp/marble-love/audio-bitperfect/reset-cadence-proof/mame-cmd-capture-300-current.json`
- `/tmp/marble-love/audio-bitperfect/reset-cadence-proof/mame-cmds-inject001f-1701-realcycles.json`

Key reset-frame facts from MAME frame `244`:

- bank write `$860001=0x00` at `cycleInFrame=18230`;
- sound command write `$FE0001=0x00` at `cycleInFrame=18234`;
- bank bit 7 set at `cycleInFrame=18253`;
- first `0x8002` opcode fetch at `cycleInFrame=18261`;
- `cmdToBankBit7Cycles=19`;
- `bankBit7ToFirstFetchCycles=8`;
- `cmdToFirstFetchCycles=27`.

The current `oracle/mame_sound_cmd_capture.lua` output now includes real command
cycles. The 1701-frame inject tape has the same command count as the old oracle
(`1579`) but real command cycles, e.g. first commands:

```text
f244 0x00 @ 18234
f245 0x03 @ 516
f246 0x03 @ 535
f247 0x03 @ 532
f248 0x03 @ 529
```

## Probe Results

Command shape:

```sh
npx tsx packages/cli/src/probe-chip-write-diff.ts \
  --audio-bitperfect-preset inject001f-1701-commandedge \
  --cmd-tape /tmp/marble-love/audio-bitperfect/reset-cadence-proof/mame-cmds-inject001f-1701-realcycles.json \
  --cmd-tape-command-timing cycle \
  --mame-pokey /tmp/marble-love/audio-bitperfect/current-samerun-soundcmdreads-wav-20260524/mame_pokey_writes_inject001f_1701_soundcmdreads_wavrun.json \
  --kinds pokey \
  --sample-tolerance 0 \
  --max-mismatches 999999 \
  --reset-first-fetch-after-command 27
```

With the existing preset, including `--ts-event-cycle-adjust-opcodes 0x91=23`:

- POKEY compared `27198/27198`;
- raw bus write parity exact: `0` offset mismatches;
- native-sample mismatches `16997`;
- first mismatch is only `nativeSample`: TS event is `+23` cycles after the
  raw bus write while MAME is at the raw bus write cycle.

With the same command plus `--ts-event-cycle-adjust-opcodes ""`:

- POKEY compared `27198/27198`;
- raw bus write parity exact: `0` offset mismatches;
- native-sample mismatches drop to `3388`;
- native-sample meanAbs drops to about `0.13`;
- best `--sample-phase-sweep -64:64:1` phase is `-39c`, but only improves
  `3388 -> 3338`, so a global phase shift is not the fix.

## PCM Gate Recheck

`probe-sound-sample-diff.ts` now accepts the same
`--reset-first-fetch-after-command` option, passing it through to
`tickFrameWithTape` and recording it in reports.

POKEY replay-vs-direct PCM was rerun on the real-cycle/reset-fetch path with
compact reports:

- `/tmp/marble-love/audio-bitperfect/reset-cadence-proof/pcm-diff-replay-vs-direct-pokey-realcycles-resetfetch27-compact.json`
- `/tmp/marble-love/audio-bitperfect/reset-cadence-proof/pcm-diff-replay-vs-direct-pokey-realcycles-resetfetch27-no-pokey91raw-compact.json`

Both variants fail the current replay-vs-direct POKEY PCM gate:

- `worstCorrelation=0.2999641308420258`;
- `worstRms=0.10406857212485252`;
- `worstMaxAbs=0.1727740354835987`;
- `bestGlobalGain=0.46588142286518347`.

Leaving `--pokey-command-edge-raw-cycle-offset-opcodes 0x91=23` enabled or
overriding it to empty changes the command-edge adjustment count, but not the
PCM summary. This means the write-diff improvement is real but not sufficient:
the real-cycle path still needs PCM origin/rate/resampler alignment before it
can replace the `secs/attos` oracle.

### Direct Reference Origin Sweep

The real-cycle/reset-fetch POKEY PCM gate was also rerun with the direct
MAME-write reference origin/timing options changed:

| Variant | Worst Corr | Worst RMS | Worst MaxAbs | Note |
| --- | ---: | ---: | ---: | --- |
| absolute + attos + auto | `0.299964` | `0.104069` | `0.172774` | baseline failure |
| absolute + cycle + auto | `0.299964` | `0.104069` | `0.172774` | same as baseline |
| cmd-tape-replay + attos + auto | `0` | `0.100328` | `0.173412` | late windows compare against silence |
| cmd-tape-replay + cycle + auto | `0` | `0.100328` | `0.173412` | same failure |
| cmd-tape-replay + cycle + sound | `0` | `0.100328` | `0.173569` | same failure |

Conclusion: `cmd-tape-replay` is not the right direct-reference origin for this
PCM comparison because the TS render remains aligned to the WAV/power-on
timeline while the direct chip-write stream is shifted from the first reset
command. The absolute origin remains the least-bad reference for this gate.

### Local Lag Probe

Allowing local lag on the same absolute-origin baseline:

```sh
npx tsx packages/cli/src/probe-sound-sample-diff.ts \
  --audio-bitperfect-preset inject001f-1701-replay-vs-direct-mamechip-pokey \
  --cmd-tape /tmp/marble-love/audio-bitperfect/reset-cadence-proof/mame-cmds-inject001f-1701-realcycles.json \
  --cmd-tape-command-timing cycle \
  --reset-first-fetch-after-command 27 \
  --max-lag 4096 \
  --max-abs-lag 4096
```

Report:

- `/tmp/marble-love/audio-bitperfect/reset-cadence-proof/pcm-diff-replay-vs-direct-pokey-realcycles-resetfetch27-bestlag4096-compact.json`

Summary:

- still fails: `worstCorrelation=0.8954934663544033`,
  `worstRms=0.018812277017841546`, `worstMaxAbs=0.16762322280555964`;
- `bestGlobalGain=0.9969765713455777`;
- lag histogram is led by `305` samples (`142/168` selected windows);
- other lags: `674` (`7`), `490` (`6`), `417` (`4`), `489` (`3`),
  `1864` (`2`), plus one-off `673`, `855`, `1222`, `2337`;
- there are `20` lag runs, with worst windows starting at output samples
  `532480`, `589824`, `1073152`, `1077248`, `1196032`, and `1200128`.

This shifts the current diagnosis: the waveform/amplitude path is much closer
than the zero-lag report suggests, but the replay timeline has run-varying PCM
lag. A global output offset would hide the dominant `305`-sample region while
leaving the transition runs broken.

### Raw POKEY Phase Probe

The local-lag result was checked against scheduler and raw POKEY state traces.

Frame scheduler artifact:

- `/tmp/marble-love/audio-bitperfect/reset-cadence-proof/pcm-diff-replay-vs-direct-pokey-realcycles-resetfetch27-frameadvance-compact.json`

Key result:

- before reset frame `244`, replay does not advance the sound CPU/schedule;
- reset frame `244` releases the CPU and reaches `cpuEndDelta=3`;
- active-frame scheduler drift in the matching chip-write diff is tiny
  (`maxAbsCpuStartDelta=5`, `maxAbsCpuEndDelta=5`).

That rules out frame-level scheduler drift as the source of the dominant
`305`-sample PCM lag.

Rawtrace artifact around the worst audible sample:

- `/tmp/marble-love/audio-bitperfect/reset-cadence-proof/pcm-diff-replay-vs-direct-pokey-realcycles-resetfetch27-rawtrace-s1080429-compact.json`
- lag-aware summary refresh:
  `/tmp/marble-love/audio-bitperfect/reset-cadence-proof/pcm-diff-replay-vs-direct-pokey-realcycles-resetfetch27-rawtrace-s1080429-aligned-summary-compact.json`
- state-aligned refresh:
  `/tmp/marble-love/audio-bitperfect/reset-cadence-proof/pcm-diff-replay-vs-direct-pokey-realcycles-resetfetch27-rawtrace-s1080429-statealign-v2-compact.json`

Summary:

- selected window still fails: `worstCorrelation=0.9816475780000179`,
  `worstRms=0.018812277017841546`, `worstMaxAbs=0.16723954491317272`,
  `lag=305`;
- POKEY raw trace comparison: `334` events compared, `316` raw mismatches;
- raw cycle delta mode is `7306139`, but residuals still include `0`,
  `-2296`, `-1260`, `2296`, `2156`, etc.;
- event-aligned PCM residual is still poor
  (`eventAlignedRmsMean=0.07496486812048694`);
- best-lag residual is good (`bestLagRmsMean=0.005788254617406228`) with
  lag histogram led by `-305`/`-306`.
- refreshed lag-aware raw matching shows the same raw values and raw
  transitions are most often found at an output-sample delta of `+305`
  (`rawOutputSampleDeltaTop=305:184`,
  `rawTransitionOutputSampleDeltaTop=305:182`), with `+306` next.
- state-aligned matching at the dominant `+305` raw-transition delta has
  `0/182` exact internal-state matches. Event index deltas cluster at `7`
  (`63`), `9` (`61`), `8` (`50`), and `10` (`8`). `clockCnt28` is aligned
  (`0:182`), but `clockCnt114`, channel counters, and poly pointers differ in
  all `182` aligned pairs. Main poly modulo delta is
  `12,25,266,124183` (`163/182`).
- Removing the old diagnostic POKEY raw-cycle opcode offset
  `--pokey-command-edge-raw-cycle-offset-opcodes 0x91=23` did not change this
  inspected window.

Interpretation: the apparent `305`-sample lag is not a simple global output
offset, and the lag-aware state check now shows real internal phase/counter
differences in the dominant alignment. The next useful work is to separate
write/apply timing from the 114-cycle clock and poly/counter phase against
MAME/Altirra: SKCTL reset/release, STIMER behavior, 15/64KHz counter phase,
LFSR seeds and per-channel noise delays.

## Interpretation

The real-cycle tape plus the opt-in reset-first-fetch diagnostic can align
POKEY raw bus order exactly against MAME. The remaining strict native-sample gap
is not explained by register ordering. The PCM gap is now best explained as
POKEY replay phase/timeline divergence involving the 114-cycle clock and
poly/counter phase; the old `0x91=23` TS event adjustment is stale for this
real-cycle/reset-fetch path and did not affect the inspected state-aligned
window.

Do not promote this as the default yet. The current `secs/attos` same-run oracle
is still the baseline until the PCM replay-vs-direct gates pass without local
lag search or blind global phase offsets.
