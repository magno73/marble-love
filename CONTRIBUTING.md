# Contributing

Marble Love is a reverse-engineering project. The most useful contributions are
small, evidence-backed changes that preserve or improve parity against the
original game.

## Ground Rules

- Do not add ROMs, extracted graphics, extracted audio, screenshots containing
  copyrighted assets, or other copyrighted game data.
- Keep behavior changes tied to a MAME trace, a binary-oracle comparison, a
  focused unit test, or a documented manual browser smoke test.
- Prefer small pull requests with a clear subsystem boundary.
- Do not update expected values only to make a stale diagnostic pass.
- Preserve unrelated dirty work and avoid broad refactors unless they are the
  point of the change.
- Public docs, user-facing text, and active source comments should be English.

## Development Setup

```sh
npm ci
npm run typecheck
npm test
npm --workspace @marble-love/web run build
git diff --check
```

For browser testing, provide your own legal ROM ZIPs:

```text
packages/web/public/roms/marble.zip
packages/web/public/roms/atarisy1.zip
```

Then run:

```sh
npm --workspace @marble-love/web run dev -- --host 0.0.0.0
```

Some engine parity tests load the original program ROM from
`ghidra_project/marble_program.bin` (gitignored, not distributed). When that file
is absent — on a fresh clone or in CI — those suites skip themselves with a
message, so `npx vitest run packages/engine` stays green. To run the
ROM-dependent tests, place your own legal dump at that path.

## Pull Request Checklist

- Describe the behavior change and the evidence used.
- List the tests or probes you ran.
- Call out skipped checks and remaining risks.
- Do not include ROM data or generated build output.
- Keep diagnostic artifacts out of the repository unless they are intentional
  fixtures with a documented purpose.
