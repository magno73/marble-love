# Oracle Agent Notes

MAME is the ground truth for gameplay and hardware behavior. This directory
contains Lua taps, oracle scenarios, and CPU fixtures.

## Rules

- Separate MAME capture/proof from seed export and web wiring.
- Do not read large oracle JSON files in full. Use `jq`, targeted scripts, or
  small summaries.
- Keep Lua taps focused on one proof question.
- Preserve determinism. If MAME output differs between runs, stop and explain.
- Do not promote scratch scripts or scenarios without documenting their proof
  purpose.

## Common Areas

- `run_oracle.ts`: MAME wrapper.
- `mame_*.lua`: targeted taps and dumpers.
- `scenarios/`: input, gameplay, playable, and sound scenarios.
- `tom_harte_m68000/`: large CPU fixture JSON and schema docs.

## Validation

```sh
node --experimental-strip-types oracle/run_oracle.ts --scenario <name> --frames <n>
diff /tmp/a.jsonl /tmp/b.jsonl
git diff --check
```

For JSON inspection, prefer examples like:

```sh
jq 'keys' oracle/scenarios/<file>.json
```
