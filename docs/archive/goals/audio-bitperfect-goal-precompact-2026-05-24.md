# GOAL - Audio Bit-Perfect

Archive logs:

- `docs/archive/goals/audio-bitperfect-goal-log-2026-05-23.md`
- `docs/archive/audio-bitperfect-sound-system-log-2026-05-23.md`

Keep this file short. It is startup context, not an experiment log.

## Objective

Move Marble Love audio toward MAME parity on the deterministic
`soundReplay`/cmd-tape path first. Close ordered YM2151/POKEY write parity,
then PCM parity on audible windows. Keep oracle capture, CLI diagnostics, web
replay, and gameplay audio separate.

## Current Truth

Not bit-perfect yet.

Promoted preset: `inject001f-1701-commandedge`.

Green gates already achieved on the promoted deterministic oracle:

- YM2151 ordered writes at native-sample tolerance `+-1`: `51163/51163`, `0`
  mismatches.
- POKEY ordered writes at native-sample tolerance `+-1`: `27198/27198`, `0`
  mismatches.
- Audible PCM windows: `212` pass, zero lag, worst correlation
  `0.9965714236013331`, worst maxAbs `0.041395485401153564`.

Still open:

- Strict exact native-sample timing: YM `5118` mismatches, POKEY `6446`
  mismatches.
- Residuals are currently bounded to `+-1` native sample in the green preset,
  so the main blocker is scheduler/event timing, not write payload/order.
- PCM is very close but not byte/sample exact.

## Active Guardrails

- Preserve unrelated dirty work. Do not revert boot-flow, terrain, renderer,
  gameplay, collision, or web-main changes.
- `packages/web/src/main.ts` is dirty/contended; avoid it unless an isolated
  audio block is unavoidable.
- `?soundReplay=...` is the bit-perfect workbench.
- `?sound=1` must use real engine sound commands; no synthetic cues in the
  bit-perfect path.
- Keep bulky artifacts under `/tmp/marble-love/audio-bitperfect/`.
- Do not promote frame-specific timing exceptions, blind offset sweeps, or
  byte-specific NMI hacks.

## Evidence

Canonical artifact directories:

- `/tmp/marble-love/audio-bitperfect/current-rerun-20260523-223959/`
- `/tmp/marble-love/audio-bitperfect/current-preadvance-context-20260523/`
- `/tmp/marble-love/audio-bitperfect/current-window-videocycle-20260523/`
- `/tmp/marble-love/audio-bitperfect/current-videoframe-fallback-20260524/`
- `/tmp/marble-love/audio-bitperfect/current-replyack-frameorigin-20260524/`

Scheduler findings:

- Use only same-run window artifacts. Old focused traces rebuilt from different
  runs are not proof.
- Compare focused windows by video-frame `cycleInFrame`, not older
  command-relative cycles.
- With video-cycle normalization, command boundaries align and YM/POKEY payloads
  still match. Remaining drift is local 6502 phase, status/read visibility, NMI
  entry, and scheduler catch-up.
- Frame `1615` is the cleaner focused case: command boundary delta `0`,
  YM/POKEY payloads match, reply-ack ordering is fixed, and the first PC
  mismatch is MAME `1615:555 0x8100` vs TS `1615:552 0x80f0`.
- Frame `1305` still diverges earlier after NMI.

Timing checkpoints:

- Atari System 1 video timing implies `(456 * 262) / 4 = 29868` sound-CPU
  cycles per video frame. The engine constant uses `29868`.
- `cmdTapeTimestampVideoCycleInFrame(...)` computes video-frame cycle offsets
  from MAME `secs/attos`; old canonical timestamps map to `1305:1713`,
  `1306:627/6816`, and `1615:554`.
- Timestamp-only legacy tapes must keep legacy per-frame replay origins.
  Explicit `cycleInFrame` is the opt-in path for video-frame command scheduling.
- Automatic timestamp-only video-cycle replay was rejected:
  `current-videoframe-fallback-20260524/chip-write-diff-current-preset-videoframe-fallback.json`
  failed with YM `50676` and POKEY `27177` mismatches.
- Fixed `29868` frame budgets with legacy origins were rejected:
  `current-videoframe-fallback-20260524/chip-write-diff-current-preset-fixedframe29868-sampletol0.json`
  made event parity much worse and skipped reply acks.
- Legacy origins plus current helpers are green at tolerance `+-1`:
  `chip-write-diff-current-preset-legacy-origin-after-helper.json`.
- Strict exact timing remains open:
  `chip-write-diff-current-preset-legacy-origin-sampletol0-after-helper.json`.
- PCM remains green:
  `pcm-diff-current-preset-legacy-origin-after-helper.json`.
- Reply-ack frame-origin normalization fixed focused `$FC0000` replay ordering;
  promoted gates remain unchanged in
  `current-replyack-frameorigin-20260524/`.

## External References

Checked online on 2026-05-24:

- MAME `atarisy1.cpp`: Atari System 1 sound hardware, latch NMI,
  `perfect_quantum(100us)`, YM2151/POKEY clocks and gains:
  https://github.com/mamedev/mame/blob/master/src/mame/atari/atarisy1.cpp
- MAME CPU scheduler notes: round-robin CPU execution, instruction overshoot,
  local CPU time, timer dispatch:
  https://wiki.mamedev.org/index.php?title=CPU_Scheduling_in_MAME
- `ymfm`: BSD-licensed Yamaha FM cores; MAME's YM2151 path uses this family.
  It is the best candidate if we stop hand-maintaining TS YM DSP:
  https://github.com/aaronsgiles/ymfm
- MAME `ymopm.cpp`: YM2151 device wrapper around `ymfm`:
  https://github.com/mamedev/mame/blob/master/src/devices/sound/ymopm.cpp
- MAME `pokey.cpp`: current POKEY implementation/reference:
  https://github.com/mamedev/mame/blob/master/src/devices/sound/pokey.cpp
- Altirra Hardware Reference: best practical POKEY timing documentation:
  https://www.virtualdub.org/downloads/Altirra%20Hardware%20Reference%20Manual.pdf
- Nuked-OPM: useful independent YM2151 comparison core, but licensing and
  integration tradeoffs differ from MAME/ymfm.

## Next Action

Stop broad experimentation. Do this in order:

1. Use the frame `1615` same-run window to investigate local CPU/NMI entry
   phase around `0x80f0/0x8100`; do not add frame-specific timing exceptions.
2. Keep `loadCmdTape`, CLI replay helpers, and web command-edge helpers
   consistent for explicit video-frame `cycleInFrame` tapes.
3. Rerun full YM/POKEY write diff at tolerance `+-1`, then strict
   `sampleTolerance=0`, after any scheduler change.
4. Only after event timing is understood, revisit DSP/mixer choices. Prefer
   evaluating `ymfm` reuse over continuing a hand-written YM2151 clone.

## Validation

Setup ROMs if needed:

```sh
mkdir -p /tmp/sound-roms
unzip -q -o roms/marble.zip 136033.421 136033.422 -d /tmp/sound-roms
```

Targeted checks:

```sh
npx vitest run packages/engine/test/sound-chip-smoke.test.ts packages/engine/test/ym2151.test.ts packages/engine/test/pokey.test.ts packages/web/test/sound-renderer.test.ts --silent
npx tsc -p packages/engine/tsconfig.json --noEmit
npx tsc -p packages/web/tsconfig.json --noEmit
npx tsc -p packages/cli/tsconfig.json --noEmit
git diff --check
git status --short --branch
```
