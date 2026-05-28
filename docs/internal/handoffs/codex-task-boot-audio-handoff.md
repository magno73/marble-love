# Task: Boot Flow Gameplay Audio Handoff

## Goal

Keep boot-flow play audio stable from the high-score/insert-coin screen into
live gameplay. The current accepted behavior is: boot coin/start works, level
music and gameplay event sounds work after START, and no default boot-screen
audio is emitted.

This handoff is intentionally narrow. It documents the current web audio wiring
and the failed insert-coin experiment so future work does not reintroduce level
music regressions.

## Context Files To Read

- `AGENTS.md`
- `docs/context-map.md`
- `packages/web/AGENTS.md`
- `packages/web/src/main.ts`
- `packages/web/src/coin-start-flow.ts`
- `packages/web/src/sound-gameplay-profile.ts`
- `packages/web/test/coin-start-flow.test.ts`
- `packages/web/test/sound-gameplay-profile.test.ts`

## Current State

- Default URL to test boot flow:
  `http://localhost:5173/?autoLoad=1&play=1&bootFlow=1&sound=1`
- Remote MacBook URL used in this session:
  `http://192.168.85.200:5173/?autoLoad=1&play=1&bootFlow=1&sound=1`
- Press `Enable Audio`, then `5`, then `Enter`.
- Expected default behavior: no insert-coin sound on the initial screen; level
  music and gameplay event sounds start after START and continue across levels.
- `soundCoin=1` is diagnostic only. Do not make it default without a new design.
- `soundAttract=1` is diagnostic only. The current attract tape remains PCM
  silent until much later in the MAME sequence, so it is not suitable as an
  immediate default boot-screen music source.

## Implemented Changes

- `packages/web/src/coin-start-flow.ts`
  - Added `clearBrowserSoundCommandSkip`, clearing work RAM word `0x3b8`.
  - The boot/coin-start runtime calls this when gameplay begins so browser
    boot-flow play does not suppress gameplay sound commands after START.

- `packages/web/src/main.ts`
  - Tracks `soundChipMode` and `soundChipPrepareKind` so attract/gameplay chip
    preparation cannot accidentally share a stale state.
  - Keeps normal gameplay audio gated behind `isSoundGameplayActive()`.
  - On accepted START, clears the browser sound-command skip word and transitions
    to a fresh gameplay SoundChip.
  - Leaves optional attract and coin replay code behind explicit flags only.
  - Disables insert-coin replay by default because it caused slow coin playback,
    renderer queue latency, and missing level music in browser testing.

- `packages/web/test/coin-start-flow.test.ts`
  - Covers clearing the sound-command skip gate.

## What Failed

An attempted insert-coin one-shot used a separate SoundChip replaying
`packages/web/public/scenarios/sound/cmd-tape-gameplay-coin-start-4200.json`
around frame `1217`. It produced non-zero PCM in a node probe, but in the
browser it pushed too much PCM into the shared renderer path:

- coin sound played slowly;
- gameplay events became delayed;
- level music disappeared after entering level 1.

For now the replay remains opt-in with `soundCoin=1`. Do not re-enable it by
default until the renderer/mixer queueing is redesigned or the boot-screen sound
is implemented through a separately bounded path.

## Useful Evidence

- Coin tape probe from this session:
  prewarm to frame `1217`, replay frames `1217-1316`, `maxAbs=0.18`.
- Attract tape probe from this session:
  `cmd-tape-attract-music.json` first non-zero PCM around frame `12485`.

These are useful diagnostics, but neither justifies default boot-screen audio in
the current renderer path.

## Validation Run

```sh
npx tsc -p packages/web/tsconfig.json --noEmit --pretty false
npx vitest run packages/web/test/coin-start-flow.test.ts packages/web/test/boot-flow-url.test.ts packages/web/test/sound-gameplay-profile.test.ts --silent
npm --workspace @marble-love/web run build
git diff --check
```

All passed before this handoff was committed.

## Next Steps

1. Keep the current default boot-flow audio stable and do not regress level
   music/event timing.
2. If insert-coin sound is resumed, isolate it from the gameplay renderer queue.
   Candidate approaches: bounded one-shot mixer lane with queue reset on START,
   a short pre-rendered oracle buffer, or a SoundRenderer API that can flush or
   separate non-gameplay PCM.
3. If attract music is resumed, first decide whether the product wants faithful
   MAME timing or immediate boot-screen music. The current attract tape does not
   produce immediate audible PCM.
4. Add browser-level smoke coverage for:
   `?autoLoad=1&play=1&bootFlow=1&sound=1`.

