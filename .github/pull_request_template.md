## Summary

Describe the change and the subsystem it touches.

## Evidence

List the traces, probes, tests, or browser smoke checks used to justify the
change.

## Validation

```sh
npm run typecheck
npx vitest run packages/web/test/coin-start-flow.test.ts packages/web/test/boot-flow-url.test.ts packages/web/test/sound-gameplay-profile.test.ts --silent
npm --workspace @marble-love/web run build
git diff --check
```

## Notes

- No ROM files or copyrighted assets are included.
- Skipped checks or residual risks:
