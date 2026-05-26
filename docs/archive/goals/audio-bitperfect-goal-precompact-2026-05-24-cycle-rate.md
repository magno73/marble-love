# GOAL - Audio Bit-Perfect

Compact startup context for the active audio goal. Historical detail belongs in
`docs/archive/goals/` and `/tmp/marble-love/audio-bitperfect/`.

## Objective

Move Marble Love audio toward MAME parity on the deterministic
`soundReplay`/cmd-tape path first:

- close ordered YM2151 and POKEY write timing against MAME;
- then close PCM parity on audible windows;
- keep oracle capture, CLI diagnostics, web replay, and gameplay audio separate.

Do not mark this goal complete yet. The audio is not bit-perfect.

## Current Truth - 2026-05-24

Promoted deterministic preset: `inject001f-1701-commandedge`.
Default cmd-tape timing: `secs/attos`.

Current same-run oracle directory:

`/tmp/marble-love/audio-bitperfect/current-samerun-soundcmdreads-wav-20260524/`

Green gates on that oracle:

- YM2151 ordered writes at native-sample tolerance `+-1`: `51163/51163`, `0`
  mismatches.
- POKEY ordered writes at native-sample tolerance `+-1`: `27198/27198`, `0`
  mismatches.
- Raw bus offset parity: green; reply acks scheduled `1528/1528`.
- Audible PCM windows: `212/212`, lag `0`, worst correlation
  `0.9965714236013331`, RMS `0.005534884943771918`, maxAbs
  `0.041395485401153564`.

Open gaps:

- Strict native-sample tolerance `0`: YM `5100/51163`, POKEY `6446/27198`.
- Direct MAME writes through the TS DSP remain closer to MAME WAV than
  SoundChip replay: direct corr about `0.9992`; replay-vs-direct mixed corr
  about `0.9960`.
- POKEY dominates the strict residual. Raw bus parity is already `0` mismatch,
  so the remaining gap is effective POKEY application/audio timing, not the
  bus-write log itself.

## Latest Interpretation

Event order is good enough for the promoted gate, and audible PCM is
threshold-green. The hard remaining work is exact native-sample timing and
component residual reduction.

The strongest current diagnostic is
`inject001f-1701-pokey-strict-effective-apply-boundary7`:

- strict POKEY mismatches drop from `6446` to `2828`;
- raw bus parity stays `0`;
- but `6` events remain at native-sample delta `+2`;
- it is diagnostic only, not a promoted runtime fix.

The boundary/phase evidence says the residual is not a global sample-grid
offset:

- boundary sweep `0..16`: best tested threshold is `7` with `2828` mismatches;
- residual splits between delay `0` early writes and delayed write overshoots;
- phase sweep `-32..32`: `-32` and `0` both stay at `2828`, `+32` is `2830`.

The POKEY raw-transition replay-vs-direct probe now reports normalized
cycle-delta residuals in the JSON report and console summary. The global
residual report shows:

- `17286` transitions compared with `rawMismatchCount=0`: replay and direct
  have the same raw transition sequence;
- cycle-delta mode `7306039`; after subtracting that absolute origin offset,
  `17067/17286` transitions have residual `0`;
- output-sample delta still spreads as `{-1:1837, 0:15316, 1:133}`, and most
  `-1` deltas occur with cycle residual `0`;
- matching TS/reference POKEY resample offsets reduces the `-1` raw-output
  count, but worsens replay-vs-direct PCM RMS/maxAbs, so it is diagnostic only.

Current interpretation: POKEY raw state/order is not the main replay-vs-direct
PCM gap anymore. The next target is MAME sound-stream resampling/mixer phase
versus the TS `mame-lofi` resampler, while keeping the PCM regression gates
green.

Follow-up lofi-phase diagnostic:

- local MAME `audio_resampler_lofi` source matches the TS `mame-lofi` formula
  structure: `source_divide`, four-sample interpolation, and block averaging;
- projecting raw transitions through the lofi block positions (`s1/s2/s3`) does
  not explain the replay-vs-direct output deltas better than the existing
  linear/round estimate;
- global lofi `s2` delta is `{-1:3420, 0:12712, 1:1144, 2:10}`, worse than the
  simple output estimate `{-1:1837, 0:15316, 1:133}`;
- therefore do not promote a lofi block-position phase shift. The next useful
  diagnostic should inspect actual PCM residual around raw transitions or MAME
  final mix/quantization, not only raw-edge sample labels.

Direct-chip cycle-rate diagnostic:

- `probe-sound-sample-diff.ts` now has
  `--direct-chip-write-cycle-rate-mode auto|sound|pokey` so replay-vs-direct
  reports can force the reference render onto either sound CPU or POKEY clock
  domains without changing runtime audio.
- For the focused POKEY raw window around output sample `562000`, forcing
  `sound` keeps `rawMismatchCount=0` but fails the POKEY replay-vs-direct gate:
  worst correlation `0.9871884455429856`, RMS `0.009215753415276506`, maxAbs
  `0.08351957832928747`.
- Forcing `pokey` matches the existing `auto` result exactly: pass, worst
  correlation `0.9958384450688074`, RMS `0.005243292625747638`, maxAbs
  `0.04836162558058277`.
- Therefore, do not promote a direct reference clock-domain change. The
  remaining gap is still downstream PCM/resampler/mixer phase, not raw sequence
  order or the POKEY-only direct reference cycle rate.

## Rejected As Promotion Targets

- Blind opcode `0x91` offsets.
- Global sample-phase offsets.
- Global `--defer-chip-write-timing`.
- PCM-side boundary apply delays.
- POKEY `--pokey-resample-offset` sweeps that improve replay-vs-direct but
  regress the current mixed WAV gate.
- `--pokey-sample-after-clock`: improves correlation slightly, but worsens
  RMS/maxAbs and fails the direct MAME-chip gate.
- `--ym-phase-advance-after-output`: collapses mixed correlation to about
  `0.951`.
- Fractional YM native rates; current oracle wants integer `55930`.
- Forcing the POKEY-only direct reference to sound CPU cycle rate; it worsens
  replay-vs-direct POKEY PCM while preserving raw transition order.

## Key Reports

In the same-run oracle directory:

- `chip-write-diff-current-wavrun-attos-mode-final.json`
- `pcm-diff-current-wavrun-attos-mode-final.json`
- `chip-write-diff-current-wavrun-attos-mode-sampletol0-sweep-after-recheck.json`
- `pcm-diff-direct-mamechip-vs-wav-after-recheck.json`
- `pcm-diff-replay-vs-direct-mamechip-preset-mix.json`
- `chip-write-diff-pokey-strict-effective-apply-boundary7.json`
- `chip-write-diff-pokey-strict-effective-apply-boundary7-delay-breakdown.json`
- `chip-write-diff-pokey-strict-effective-apply-boundary7-phase-crossbreakdown.json`
- `chip-write-diff-pokey-strict-effective-apply-boundary7-phase-sweep.json`
- `pcm-diff-replay-vs-direct-pokey-rawtrace-567780.json`
- `pcm-diff-replay-vs-direct-pokey-rawtrace-557k-deltaruns-20260524.json`
- `pcm-diff-replay-vs-direct-pokey-rawtrace-global-residualdiag-20260524.json`
- `pcm-diff-replay-vs-direct-pokey-rawtrace-global-residualdiag-ts-offset22_50-20260524.json`
- `pcm-diff-replay-vs-direct-pokey-rawtrace-global-residualdiag-ref-offset23_25-20260524.json`
- `pcm-diff-replay-vs-direct-pokey-rawtrace-global-lofiphase-20260524.json`
- `pcm-diff-replay-vs-direct-pokey-rawtrace-557k-direct-soundcycle-20260524.json`
- `pcm-diff-replay-vs-direct-pokey-rawtrace-557k-direct-pokeycycle-20260524.json`
- `chip-write-diff-pokey-frame695-711-event-delta-20260524.json`

Sound ROMs expected by probes:

`/tmp/sound-roms/136033.421` and `/tmp/sound-roms/136033.422`

## Next Steps

1. Preserve the same-run oracle and promoted `secs/attos` replay baseline.
2. Keep raw POKEY bus timing separate from effective POKEY apply/audio timing.
3. Inspect actual PCM residual around matched POKEY raw transitions and MAME
   final mix/quantization. The lofi block-position projection is diagnostic
   only and should not be promoted.
4. Use `inject001f-1701-replay-vs-direct-mamechip*` as PCM regression gates
   before promoting any timing change.
5. After replay timing is tighter, continue YM2151 DSP parity work
   (KC/KF, detune, operator log/exp, envelope/LFO, stereo pan), then mixer and
   resampler/gain.
6. Browser-smoke isolated `?soundReplay=...` only when
   `packages/web/src/main.ts` contention is safe.

## Guardrails

- Preserve unrelated dirty work.
- Do not change gameplay, collision, terrain, renderer, route, seed, or
  boot-flow behavior for audio diagnostics.
- Avoid `packages/web/src/main.ts` unless an isolated audio block is unavoidable.
- Keep bulky probes and MAME captures under `/tmp/marble-love/audio-bitperfect/`.
- Do not promote frame-specific exceptions, byte-specific NMI hacks, synthetic
  audio cues, or blind offset fits.

## Useful External References

- MAME Atari System 1 driver:
  `https://github.com/mamedev/mame/blob/master/src/mame/atari/atarisy1.cpp`
- MAME POKEY:
  `https://github.com/mamedev/mame/blob/master/src/devices/sound/pokey.cpp`
- MAME YM2151/OPM:
  `https://github.com/mamedev/mame/blob/master/src/devices/sound/ymopm.cpp`
- MAME sound stream docs:
  `https://docs.mamedev.org/techspecs/device_sound_interface.html`
- `ymfm` Yamaha FM cores:
  `https://github.com/aaronsgiles/ymfm`
- Nuked-OPM:
  `https://github.com/nukeykt/Nuked-OPM`
- JT51:
  `https://github.com/jotego/jt51`
- Altirra Hardware Reference Manual, POKEY chapter:
  `https://www.virtualdub.org/downloads/Altirra%20Hardware%20Reference%20Manual.pdf`
- VGMRips Marble Madness pack:
  `https://vgmrips.net/packs/pack/marble-madness-atari-system-1`
