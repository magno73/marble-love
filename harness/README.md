# Harness - Differential Testing

## Mental Model

```
trace_truth.jsonl  ──┐
                     ├─►  diff.ts  ──►  divergence_<scen>.json  ──►  report.ts
trace_reimpl.jsonl ──┘
```

The **first divergent frame** and **first divergent field** are the main signal
for parity work. Each iteration should reduce that frame index, increase the
matching window, or remove the divergence entirely.

## Pipeline end-to-end

```bash
./harness/run_compare.sh attract_mode
```

Step:
1. `oracle/run_oracle.ts` runs MAME with the Lua dumper -> `traces/oracle_<scen>.jsonl`
2. `packages/cli/src/marble-runner.ts` runs the reimplementation -> `traces/reimpl_<scen>.jsonl`
3. `harness/diff.ts` compares the traces -> `traces/divergence_<scen>.json`
4. `harness/report.ts` emits human- and LLM-readable Markdown

## `diff.ts` Output

```jsonc
{
  "scenario": "level1_no_input",
  "parity": 0.058,                 // 0..1
  "framesCompared": 600,
  "fromFrame": 0,                  // optional comparison start frame
  "firstDivergence": {
    "frame": 35,
    "fields": ["marble.vx", "marble.x"],
    "annotated": ["marble.vx", "marble.x"],   // human-friendly field names
    "truth":  { "f": 35, "marble": { "vx": 12, ... }, ... },
    "reimpl": { "f": 35, "marble": { "vx": 0,  ... }, ... }
  },
  "contextFramesBefore": [...],
  "suspectedSubsystem": "physics"
}
```

`suspectedSubsystem` is a heuristic from field names to modules. It is useful
for orienting the next fix, but it is not authoritative.

### Schema v2: Regional `workRamHashes`

Schema v2 (`TRACE_SCHEMA_VERSION = 2`) adds `workRamHashes`: 32 CRC32 values,
one per `0x100`-byte region. When the diff finds a regional divergence,
`annotated` reports ranges such as `workRam[0x300..0x3ff]` instead of the
generic `workRamHash`, which narrows subsystem triage quickly.

Backward compatibility: an oracle v1 trace plus a reimpl v2 trace emits a
warning, then continues using the global `workRamHash`.

### Useful Flags

- `--from-frame N` skips the first N frames during comparison. This is useful
  for ignoring MAME boot transients, such as frames 0-5 in `attract_mode`.

## Curriculum

See [`curriculum.yaml`](./curriculum.yaml). Work through one stage at a time in
priority order.

## Parity Loop

```pseudo
while curriculum.has_pending():
    scen = curriculum.next()
    while parity(scen) < 100%:
        run compare(scen)
        if no_progress for 3 iter:
            write BLOCKED.md, escalate to Marco
            break
        analyze divergence_report.json
        fix engine source (cite ghidra/mame line)
        commit
    if parity(scen) == 100%:
        curriculum.close(scen)
```
