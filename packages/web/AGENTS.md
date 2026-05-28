# Web Agent Notes

This package owns the Vite/PixiJS browser app: ROM loading, query flags, input,
frontend state, web renderer, web tests, and public scenario assets.

## Rules

- Do not commit `dist`, Vite cache, local ROMs, or generated browser artifacts.
- Treat screenshots as artifacts, not text context.
- Keep debug overlays and URL flags explicit and documented in code/tests.
- Use existing renderer and input patterns before adding new frontend structure.
- Do not fake visual fixes for gameplay, collision, or route proof gaps.

## Common URLs

```text
http://localhost:5173/
http://localhost:5173/?autoLoad=1
http://localhost:5173/?autoLoad=1&coinStart=1
http://localhost:5173/?autoLoad=1&startLevel=N
```

Useful diagnostics:

```text
debugState=1
debugCompact=1
sound=0
loopReset=0
```

## Validation

```sh
npx tsc -p packages/web/tsconfig.json --noEmit
npm --workspace @marble-love/web run build
git diff --check
```

If visual behavior changes, run the app and verify the relevant URL.
