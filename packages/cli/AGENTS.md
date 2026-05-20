# CLI Agent Notes

This package owns probes, audits, route search, parity runners, and small
investigation tools.

## Rules

- Prefer deterministic scripts with small summary output.
- Emit manifest JSON or concise reports, not full snapshots.
- Keep bulky run artifacts in `/tmp/marble-love/<task>/` unless the task asks
  for committed fixtures.
- Do not read large scenario JSON in full. Use `jq`, streaming code, or focused
  extraction.
- Keep one-off probes named clearly. Promote only tools that are repeatable and
  useful beyond one session.

## Common Areas

- `src/test-*-parity.ts`: parity harnesses.
- `src/probe-*.ts`: targeted inspectors.
- `src/search-*.ts`: route and state search tools.
- `src/audit-*.ts`: scenario or seed audits.

## Validation

```sh
npx tsc -p packages/cli/tsconfig.json --noEmit
npx tsx packages/cli/src/<tool>.ts --help
git diff --check
```

If a tool has no `--help`, run it against the smallest safe fixture and capture
only the relevant summary.
