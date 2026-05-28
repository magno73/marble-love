# Oracle Harness - MAME As Ground Truth

## Purpose

The oracle harness launches MAME for Atari System 1 / Marble Madness, injects
scripted scenario input, and dumps game state every frame to
`traces/oracle_<scenario>.jsonl`.

The trace schema is defined in
[`packages/engine/src/trace.ts`](../packages/engine/src/trace.ts) through
`TRACE_SCHEMA_VERSION`. The Lua dumper and CLI runner must match the schema
byte-for-byte.

## Requirements

- MAME 0.279 or newer, tested with 0.286. Check with `mame -version`.
- User-provided `marble.zip` in `roms/`.
- Lua scripting enabled in MAME, which is the default for standard builds.

## Usage

```bash
# Base run
node --experimental-strip-types oracle/run_oracle.ts \
    --scenario attract_mode --frames 1800

# Custom ROM path
node --experimental-strip-types oracle/run_oracle.ts \
    --scenario level1_no_input --rom-path /path/to/roms

# Explicit output
node --experimental-strip-types oracle/run_oracle.ts \
    --scenario level1_no_input --out traces/run_001.jsonl
```

## Determinism

MAME determinism is a hard prerequisite for oracle work:

```bash
# Same scenario twice should produce a bit-identical diff.
node --experimental-strip-types oracle/run_oracle.ts -s attract_mode -o /tmp/a.jsonl
node --experimental-strip-types oracle/run_oracle.ts -s attract_mode -o /tmp/b.jsonl
diff /tmp/a.jsonl /tmp/b.jsonl
```

If the diff is not empty, check:

- `-throttle 0` / `-nothrottle` is active. The wrapper passes this by default.
- No asynchronous physical joystick or mouse input is active during the run.
- Random seed handling is pinned or explicitly documented for the scenario.

## Manual Inspection

```bash
node --experimental-strip-types oracle/replay_trace.ts traces/oracle_level1_no_input.jsonl --from 0 --to 300
```

## Available Scenarios

- `attract_mode`: power-on with no input.
- `level1_no_input`: coin/start, level 1, marble rolls without input.
- `level1_basic_movement`: coin/start, level 1, basic scripted movement.

Add new scenarios under `oracle/scenarios/<name>.json`:

```json
{
  "name": "<name>",
  "description": "...",
  "ticks": 600,
  "inputs": {
    "<frame>": { "dx": -5, "dy": 0, "buttons": 0 }
  }
}
```
