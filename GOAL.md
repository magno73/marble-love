# GOAL - Audio Bit-Perfect

Compact startup checkpoint for the paused audio goal. Detailed history is in
`docs/archive/goals/audio-bitperfect-goal-checkpoint-2026-05-26.md`; bulky
captures stay under `/tmp/marble-love/audio-bitperfect/`.

## Objective

Move Marble Love audio toward MAME parity on the deterministic
`soundReplay`/cmd-tape path first:

- close ordered YM2151 and POKEY write timing against MAME;
- then close PCM parity on audible windows;
- keep oracle capture, CLI diagnostics, web replay, and gameplay audio separate.

Do not mark this goal complete. Audio is not bit-perfect.

## Current Baseline

- Preset: `inject001f-1701-commandedge`.
- Timing source: `secs/attos`; MAME `cycle` fields are diagnostic only.
- Same-run oracle:
  `/tmp/marble-love/audio-bitperfect/current-samerun-soundcmdreads-wav-20260524/`.
- Explicit-cycle proof:
  `/tmp/marble-love/audio-bitperfect/cycle-log-proof/full1701/`.
- `/tmp/marble-love/audio-bitperfect` is about `54M` after cleanup.

Green promoted gates:

- YM ordered writes at native-sample tolerance `+-1`: `51163/51163`.
- POKEY ordered writes at native-sample tolerance `+-1`: `27198/27198`.
- Raw bus offset parity is exact; reply acks scheduled `1528/1528`.
- Audible PCM windows against MAME WAV: `212/212`, lag `0`, worst corr
  `0.996571`, RMS `0.005535`, maxAbs `0.041395`.

Open gates:

- Strict tolerance `0`: YM `5100/51163`, POKEY `6446/27198`.
- POKEY replay-vs-direct PCM in the inspected real-cycle window: lag `305`,
  corr `0.982084`, RMS `0.018587`, maxAbs `0.167506`.
- Direct mixed MAME-chip render with cycle-log timing still misses the WAV gate:
  best tested corr about `0.9985`, maxAbs `0.07029`.

## Current Interpretation

- Payload/order is credible: raw bus write parity is exact, and both chip write
  streams pass at `+-1` native sample.
- Strict `0` residue is native-sample/application timing, not a simple bus-write
  order problem.
- Frame-local drift remains: per-frame offset sweeps improve strict residue
  but do not close it because many frames contain mixed `-1/0/+1` buckets.
- YM frame `1500` still isolates a Timer A IRQ boundary before the POKEY reset
  cluster. MAME vectors with saved `pc=0x810b`; default TS vectors too early
  with saved `pc=0x8101`.
- A diagnostic `--ym-irq-new-assertion-instruction-delay 1` plus frame-specific
  command-NMI override can align the local frame-1500 IRQ boundary, but it is
  not promoted because it needs narrow compensation rules and worsens YM strict
  timing.
- POKEY timing is not direct CPU bus timing. MAME `pokey_device::write()` queues
  `sync_write` through `machine().scheduler().synchronize(...)`; the remaining
  strict work should model the scheduler/device-stream boundary and
  `sound_stream::update()` cursor.

## Rejected Shortcuts

Keep these diagnostic-only unless a later proof changes the evidence:

- global sample phase or frame phase;
- static per-PC YM event offsets;
- static POKEY opcode `0x91` delay, even though it improves strict mismatch
  count, because it breaks the promoted `+-1` gate;
- blind POKEY boundary delay near sample end;
- POKEY guard by PC/reg/value/write-offset/command-edge/scheduler-frame-start;
- POKEY guard by write effect class (`audc-raw`, `audf-frequency`,
  `audctl-same` are all heavily mixed between early/exact/late);
- current TS raw-transition proximity;
- MAME lofi resampler cursor alone.

Useful diagnostic facts:

- Directional oracle-only POKEY guard `baseline-delta-lt0` or
  `target-offset-gte-delay` at `29c..32c` reduces strict POKEY mismatches to
  `320` with histogram `{0:26878,1:320}`, but it uses oracle knowledge and is
  not a runtime rule.
- `--pokey-boundary-candidate-report-cycles 29` found `24672` near-boundary
  candidates: `6126` early, `18354` exact, `192` late.
- POKEY write-effect buckets remain mixed:
  `audc-raw=2697/8173/91`, `audf-frequency=2678/8234/80`,
  `audctl-same=749/1937/21` for early/exact/late.
- Lofi cursor best tested `1789772 Hz`, raw source offset `-4`: strict
  mismatches `6446 -> 6200`; useful but insufficient.

## Browser/Gameplay Audio

- Gameplay audio is explicit through `?sound=1`.
- `?sound=1` uses normal SoundChip config and real TS engine sound command
  notifications. It does not apply `soundReplay` presets, command-edge rules,
  or MAME-only diagnostics.
- The web path keeps `setSoundCmdHook` clear and wires `setGlobalSoundCmdHook`
  only, because `soundCmdSend158AC` already notifies both hooks internally.
- SoundChip is released and ticks with gameplay before the Web Audio user
  gesture; replies and PCM are drained every frame, with PCM discarded until
  the user enables audio.
- Synthetic debug audio remains opt-in: `?soundCue=1`, `?soundTest=1`,
  `?soundSynthCue=1`, `?soundBeepTest=1`.

## Next Moves

1. Commit the current checkpoint before further audio evolution.
2. If continuing strict parity, implement a local diagnostic model of MAME
   POKEY `sync_write` + `sound_stream::update()` sample cursor, then compare
   against the existing POKEY boundary reports.
3. Compare TS 6502 IRQ sampling against Visual6502/MAME behavior around
   prefetch, `CLI`, branch `T2`, and pending IRQ visibility before changing YM
   Timer A again.
4. Use `inject001f-1701-yminstr1-commandedge` only as a diagnostic baseline for
   the IRQ-sampling hypothesis; do not promote it as `current`.
5. Only after ordered chip-write timing is credible, resume DSP work:
   POKEY clocking/AUDCTL/poly/mix, then YM2151 against MAME `ymfm`.
6. Browser-smoke `?soundReplay=...` and `?sound=1` separately; do not mix oracle
   replay timing into normal gameplay.

## Guardrails

- Preserve unrelated dirty work.
- Do not change gameplay, collision, terrain, renderer, route, seed, or
  boot-flow behavior for audio diagnostics.
- Avoid `packages/web/src/main.ts` unless touching an isolated audio block.
- Keep bulky probes and MAME captures under `/tmp/marble-love/audio-bitperfect/`.
- Do not promote changes that regress the current direct MAME WAV or ordered
  write gates.

## References

- MAME Atari System 1:
  `https://github.com/mamedev/mame/blob/master/src/mame/atari/atarisy1.cpp`
- YM2151 MAME/ymfm:
  `https://github.com/mamedev/mame/blob/master/3rdparty/ymfm/src/ymfm.h`,
  `https://github.com/mamedev/mame/blob/master/3rdparty/ymfm/src/ymfm_opm.cpp`
- Visual6502 IRQ timing:
  `https://www.nesdev.org/wiki/Visual6502wiki/6502_Timing_of_Interrupt_Handling`
- MAME scheduler/device synchronization:
  `https://github.com/mamedev/mame/blob/master/src/emu/schedule.h`
- POKEY:
  `https://github.com/mamedev/mame/blob/master/src/devices/sound/pokey.cpp`
