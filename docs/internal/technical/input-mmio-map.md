# Input MMIO Map

Scope: Marble Madness on Atari System 1, for demo/replay input parity.

Primary reference:
- MAME `src/mame/atari/atarisy1.cpp`: `main_map`, `trakball_r`, `INPUT_PORTS_START(marble)`.
- Local hardware summary: `docs/hardware-map.md`.
- Ghidra MMIO xref dump: `ghidra_project/dump_xrefs_mmio.txt`.
- MAME tap added in `oracle/mame_demo_input_tap.lua`.

## 68010 input addresses

| MMIO address | Meaning | MAME behavior | TS consumer |
| --- | --- | --- | --- |
| `0xF20001` | P1 rotated trackball X low byte | `trakball_r` offset 0; Marble computes `IN0 + IN1` when this pair is read | `trackballInputTick(state, p1X, ...)`; replay override in `packages/engine/src/input-replay.ts` |
| `0xF20003` | P1 rotated trackball Y low byte | `trakball_r` offset 1; Marble returns cached `IN0 - IN1` | `trackballInputTick(state, p1Y, ...)`; replay override |
| `0xF20005` | P2 rotated trackball X low byte | `trakball_r` offset 2; `IN2 + IN3` | `trackballInputTick(state, ..., p2X, ...)`; replay override |
| `0xF20007` | P2 rotated trackball Y low byte | `trakball_r` offset 3; `IN2 - IN3` | `trackballInputTick(state, ..., p2Y)`; replay override |
| `0xF40000-0xF4001F` | Joystick/ADC range | Used by other Atari System 1 games; Marble does not use it in the warm demo taps | Replay returns `0xff`; no Marble TS gameplay consumer |
| `0xF60001` | Switch low byte | Active-low START1 bit 0, START2 bit 1; bit 4 VBLANK; bit 6 self-test; bit 7 sound command pending | `gameMainGate(..., { mmioInput })`; replay override |
| `0x1820` on sound CPU | Coin/service status | Coin inputs are read by the 6502 sound CPU, not by the 68010 main CPU | Out of scope for warm demo replay; existing TS coin bookkeeping remains unchanged |

The even addresses in the `0xF20000..0xF20007` and `0xF60000..0xF60003`
word ranges are high bytes on the 68010 bus. The gameplay routines and parity
tests use the low-byte addresses listed above.

MAME Lua read taps report the even bus addresses for these byte handlers
(`F20000/02/04/06`, `F60000`). The playable capture canonicalizes those reads
to the TS low-byte constants (`F20001/03/05/07`, `F60001`) before writing JSON.

## Select/multiplex lines

No Marble-specific ADC select-line write is required for the trackball path.
`0xF40000..0xF4001F` writes arm joystick ADC behavior for other System 1 games;
Marble uses `trakball_r` directly for `0xF20000..0xF20007`.

`0x860001` audio/video control includes trackball test/resolution bits, but it is
not an ADC multiplexer for demo input replay.

## Warm demo tap finding

`oracle/mame_demo_input_tap.lua` captures `0xF20000..0xF20007`,
`0xF40000..0xF4001F`, and `0xF60000..0xF60003`.

Current trace:

| File | Frames | SHA-256 | Result |
| --- | ---: | --- | --- |
| `oracle/scenarios/input/demo_attract.json` | `9700..21900` | `5570b1d5bbf9628760d44f2888cc8e5878fc96d200ee5da5d8ddfe236eea87a6` | No reads observed in tapped MMIO ranges; replay frames therefore carry stable hardware defaults: trackballs `0xff`, switch low byte `0x6f`, buttons `0`. |

Interpretation: the attract warm windows validated by the scenario suite are
driven by internal game/demo state rather than fresh external trackball MMIO
reads. The replay layer still injects the captured default bytes explicitly so
future playable/coin-up traces can reuse the same mechanism without changing
the probe surface.

## Coin/start/playable tap finding

`oracle/mame_playable_input_capture.lua` scripts a deterministic MAME session
with a Coin 1 pulse, START1 pulse, and level-1 P1 trackball movement. It also
captures three playable warm-seed oracle windows:

| File | Seed | Result |
| --- | ---: | --- |
| `oracle/scenarios/playable/coin_start_to_level1.json` | f2045 | PASS @80 consecutive replay frames |
| `oracle/scenarios/playable/level1_trackball_short.json` | f2240 | PASS @100 consecutive replay frames |
| `oracle/scenarios/playable/level1_trackball_obstacle.json` | f2320 | PASS @82 consecutive replay frames |

Input trace:

| File | Frames | SHA-256 | Main tap totals |
| --- | ---: | --- | --- |
| `oracle/scenarios/input/playable_coin_start.json` | `1..2500` | `d92e4b2d7476fec451824efc734c1aac59c0a8613305964c5267e6a5588463ee` | `F20001/F20003/F20005/F20007 = 2256` each, `F60001 = 9306`, `FC0001 = 2382`; sound CPU `0x1820 = 964496` |

The current TS replay goal starts from MAME warm playable seeds rather than
emulating the full 6502 coin-credit path from reset. The sound CPU coin port is
captured and exposed through `inputReplay.read8(0x1820, frame)`, while gameplay
validation injects the 68010-visible trackball/switch bytes into `mainTick`.

## Manual MAME route capture

For visual bugs that are easiest to reach by hand, record a native MAME input
movie first:

```sh
mame marble -rompath /path/to/roms -window -skip_gameinfo -record /tmp/marble_issue.inp
```

Play normally, stop after the bug is visible, then replay the movie through the
same Lua capture without scripted input injection:

```sh
STAMP="$(date +%Y%m%d_%H%M%S)"
MARBLE_PLAYABLE_MANUAL=1 \
MARBLE_PLAYABLE_NAME="manual_issue_${STAMP}" \
MARBLE_PLAYABLE_MAX_FRAME=12000 \
MARBLE_PLAYABLE_MANUAL_WINDOW=240 \
MARBLE_PLAYABLE_INPUT_OUT="oracle/scenarios/input/manual_issue_${STAMP}.json" \
MARBLE_PLAYABLE_INPUT_TRACE_REF="oracle/scenarios/input/manual_issue_${STAMP}.json" \
MARBLE_PLAYABLE_OUT_DIR="oracle/scenarios/playable" \
mame marble -rompath /path/to/roms -skip_gameinfo -nothrottle \
  -playback /tmp/marble_issue.inp \
  -autoboot_script oracle/mame_playable_input_capture.lua -autoboot_delay 0
```

`MARBLE_PLAYABLE_MANUAL=1` records the real MAME/playback MMIO reads and does
not drive MAME ports from `MARBLE_PLAYABLE_ROUTE`. The capture writes the full
input trace plus a tail scenario named `manual_issue_<stamp>_tail.json` covering
the last `MARBLE_PLAYABLE_MANUAL_WINDOW + 1` frames before stop/max-frame. It
also flushes on MAME shutdown, so stopping the playback after the visible issue
still leaves a replayable tail window.

Replay the captured tail against the TypeScript engine with:

```sh
npx tsx packages/cli/src/probe-playable-replay.ts \
  "oracle/scenarios/playable/manual_issue_${STAMP}_tail.json" \
  "oracle/scenarios/input/manual_issue_${STAMP}.json"
```

If a fixed frame is known, `MARBLE_PLAYABLE_FRAME_LIST=name:frame` can be used
with manual mode to capture an additional deterministic warm window alongside
the rolling tail.
