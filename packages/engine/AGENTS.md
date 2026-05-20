# Engine Agent Notes

This package owns runtime behavior: state, game loop, object logic, collision,
renderer model, level decode, CPU helpers, and engine tests.

## Rules

- Treat replicated routines as MAME-specific behavior, not generic APIs.
- Read direct callers, state fields, and focused tests before editing runtime
  logic.
- Do not change behavior only to make stale smoke tests green.
- Keep changes narrow. Avoid broad refactors of address/RAM helpers.
- Preserve proof boundaries: MAME capture, seed export, runtime wiring, and web
  smoke are separate steps.
- For large fixture JSON, use `jq` or a focused script. Do not paste full
  snapshots into the terminal or agent context.

## Common Areas

- `src/main-tick.ts`: main tick.
- `src/main-loop-init-*.ts`: init and mode setup.
- `src/state.ts`: shared state and RAM-backed structures.
- `src/render.ts`: renderer model.
- `src/level.ts`: level descriptor and terrain decode.
- `src/helper-*.ts`, `src/sub-*.ts`, `src/state-sub-*.ts`: replicated routines.
- `test/`: focused regression and parity tests.

## Validation

```sh
npx tsc -p packages/engine/tsconfig.json --noEmit
npx vitest run packages/engine/test/<target>.test.ts --silent
git diff --check
```

Run broader tests only when shared behavior or exports changed.
