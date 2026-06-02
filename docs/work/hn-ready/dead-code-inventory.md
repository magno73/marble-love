# W2 — Dead-code inventory (working note, do not publish)

Audit date: 2026-06-02. Tools: `knip` 6.15 (config in `knip.json`) + `ts-prune`.
Run `npm run dead-check` (full report) or `npm run dead-check:files` (the green
orphan-file gate).

## Deleted (certainly orphan, one commit each)

| File | Why orphan |
|---|---|
| `packages/engine/src/audio/index.ts` | Re-export barrel with zero importers; the package exposes audio via `src/audio.ts` (package.json `"./audio"`), and `m6502/index.ts` is the analog that is actually re-exported from `src/index.ts`. Pure re-exports → no runtime change. |
| `packages/engine/test/scroll-range-144e4-quicktest.ts` | A manual non-vitest runner ("Quick standalone test ... without vitest"); never collected, never imported, and the routine is already covered by `scroll-range-144e4.test.ts`. |

## Flagged by knip but NOT dead (false positives — handled in `knip.json`)

- **~365 `packages/cli/src/*.ts`** — standalone probe/audit/plan tools, each its
  own entry point (run manually by maintainers). Declared `entry: ["src/*.ts"]`.
- **`oracle/replay_trace.ts`** — standalone trace pretty-printer (`node oracle/replay_trace.ts <path>`). Declared via the root `oracle/**` entry.
- **`packages/web/public/sound-worklet.js`** — Web Audio worklet loaded at
  runtime (`audioWorklet.addModule("/sound-worklet.js")` in sound-renderer.ts),
  invisible to static analysis. Added to `ignore`.

## Unused exports (105) — not actioned

Dominated by intentional public surface, not dead code:
- `src/index.ts` barrel re-exports (the package's public API for web + consumers).
- `*_ADDR` constants and chip internals (`channelKeyOn`, `ENV_STATE_*`, …) used as
  the test/probe assertion surface.

Pruning these is risky (barrel/public API) and outside W2's file/function scope.
Left as-is; `dead-check:files` is the actionable gate.

## Unused dependencies flagged (recommend verify-then-remove in a follow-up)

Not removed in this PR (dependency edits are out of the file/function scope and
need a separate verification pass):
- `pngjs` — `packages/web/package.json`; no usage found in web `src`/`test`.
- `@typescript-eslint/utils`, `typescript-eslint` — root devDeps; there is **no
  eslint config** in the repo, so the `lint` script and these are inert.

## Gate

`npm run dead-check:files` exits 0 (no orphan files) after the two deletions.
