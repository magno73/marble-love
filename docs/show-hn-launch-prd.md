# Marble Love Show HN Launch PRD

## Purpose

Prepare Marble Love for a credible Hacker News "Show HN" launch.

The launch should present the project as a research-grade, source-level
TypeScript reimplementation of Atari's Marble Madness, not as a finished arcade
game and not as a MAME replacement. The first-time visitor experience must work
without local ROMs, while the ROM-backed path must remain honest about legal
requirements and known gameplay gaps.

## Audience

- Hacker News readers with retrocomputing, emulator, reverse-engineering, and
  TypeScript interests.
- Skeptical maintainers who will clone the repo, run the commands, and look for
  gaps between claims and actual behavior.
- Future contributors who need to understand the proof boundary: MAME oracle,
  TypeScript port, browser wiring, and diagnostic fixtures are separate layers.

## Current Readiness Summary

The repo is technically strong but not launch-ready.

Verified before this PRD:

- `npm ci` passes in the main checkout and in a fresh `git archive` copy.
- `npm run typecheck` passes.
- `npm run lint` passes.
- `npm run test --silent` passes with `2430 passed`, `20 skipped`.
- `npm run context:audit` passes.
- `npm --workspace @marble-love/web run build` passes.
- `git diff --check` passes.
- `npx vitest run packages/engine/test/slapstic-103.test.ts --silent` passes
  with `12/12`.
- Browser smoke with local ROMs reaches a live canvas for
  `/?autoLoad=1&startLevel=1&sound=0`.

Main launch blockers:

- The README has no immediate visible demo.
- A fresh clone without ROMs shows `Errore caricando la ROM: invalid zip data`
  on `/` in dev mode.
- The quickstart assumes `packages/web/public/roms/` exists, but a clean clone
  does not contain it.
- Diagnostic fetch URL parameters are too permissive for a public-facing app.
- Known gameplay gaps are documented, but the launch copy must not overclaim.

## Goals

1. Make the repo understandable in under 30 seconds.
2. Provide a legal, immediate, no-ROM demo path that works after `npm ci`.
3. Make the missing-ROM path clear and non-alarming.
4. Keep ROM-backed loading local, explicit, and privacy-preserving.
5. Tighten public URL-driven fetches so HN security review does not find an easy
   issue.
6. Update launch copy so claims match tested behavior.
7. Preserve all current validation strength; do not make diagnostics green by
   weakening gameplay, collision, renderer, route, or seed behavior.

## Non-Goals

- Do not ship ROMs, extracted graphics, extracted audio, or screenshots/GIFs
  containing copyrighted game assets unless the maintainer explicitly approves
  the legal basis.
- Do not claim cycle accuracy.
- Do not claim complete audio PCM parity.
- Do not hide known gameplay bugs.
- Do not rewrite history, move fixture repos, or introduce Git LFS in this task.
- Do not fix old route diagnostics by changing gameplay behavior without fresh
  MAME evidence.

## Required User-Facing Outcomes

### README First Impact

Update `README.md` so the top section includes:

- A one-line description:
  "A readable TypeScript reimplementation of Marble Madness, ported
  function-by-function from the 68010 disassembly and checked against MAME."
- A visible demo asset or working demo link before the status details.
- A short note that it is source-level, not an emulator.
- A short note that no ROMs or copyrighted assets are included.
- A direct link to `docs/STATUS.md`.
- A direct link to the slapstic finding.

The README must not require a reader to scroll past placeholders to understand
what the project does.

### No-ROM Demo Path

A fresh clone must have a route that works without ROMs:

```text
http://localhost:<vite-port>/?autoLoad=0
```

Expected behavior:

- Shows a canvas or demo screen within a few seconds.
- Makes clear that this is a ROM-free synthetic/demo path, not the real game.
- Does not imply that copyrighted game assets are present.
- Has no console error.

The README quickstart must mention this as the fastest smoke check.

### Missing-ROM Root Path

In dev mode, `/` currently defaults into auto-load. On a fresh clone, Vite
returns HTML for missing `/roms/marble.zip`, producing a misleading
`invalid zip data` error.

Fix this behavior.

Acceptance criteria:

- Fresh clone `/` with no `packages/web/public/roms` directory does not attempt
  to unzip HTML.
- The UI shows a clear message such as:
  "No local ROM ZIPs found under /roms. Use Load ROMs or create
  packages/web/public/roms/ with marble.zip and atarisy1.zip."
- The console should not log an `invalid zip data` stack for this path.
- Explicit `?autoLoad=1` may report a missing local ROM error, but it must be
  clear and actionable.

Likely files:

- `packages/web/src/main.ts`
- `packages/web/test/boot-flow-url.test.ts`
- New focused helper/test if needed, for example:
  `packages/web/src/auto-load-rom.ts`
  `packages/web/test/auto-load-rom.test.ts`

Implementation guidance:

- Before constructing `File` objects from fetch results, validate each response
  by status, content type, and/or ZIP magic bytes (`PK`).
- Treat `text/html` from Vite fallback as "missing local ROM", not as a ROM
  validation failure.
- Keep manual picker behavior unchanged.

### Quickstart Repair

Update README quickstart so it works for a clean clone:

```sh
npm ci
npm --workspace @marble-love/web run dev -- --host 0.0.0.0
```

Then document:

- Vite may choose another port if `5173` is in use.
- No-ROM smoke:

```text
http://localhost:<vite-port>/?autoLoad=0
```

- Manual ROM picker:

```text
http://localhost:<vite-port>/?rom=1
```

- Auto-load local ROMs:

```sh
mkdir -p packages/web/public/roms
cp /path/to/marble.zip packages/web/public/roms/
cp /path/to/atarisy1.zip packages/web/public/roms/
```

Then:

```text
http://localhost:<vite-port>/?autoLoad=1
```

Keep the legal language explicit.

### Demo Media

Add one immediate demo to the README.

Preferred safe option:

- Generate a ROM-free demo capture from `?autoLoad=0`.
- Store it under `docs/media/`, for example `docs/media/demo-rom-free.gif` or
  `docs/media/demo-rom-free.mp4`.
- Document that it is ROM-free/synthetic.

Alternative, only with explicit maintainer approval:

- Generate a ROM-backed gameplay capture using locally owned ROMs.
- Do not commit if it includes copyrighted game graphics and the maintainer has
  not approved publication.

Update `docs/media/README.md` to distinguish:

- committed legal ROM-free media;
- local-only ROM-backed captures;
- generation commands.

### Security And Privacy Hardening

The main ROM picker path is local and privacy-preserving. Preserve that.

Tighten URL-driven diagnostic fetches:

- `soundReplay`
- `soundReplayReplyAck`
- `soundPrewarmTape`
- `soundAttractTape`
- `soundCoinTape`

Acceptance criteria:

- These parameters must not fetch arbitrary remote URLs.
- Allow same-origin public paths only.
- Reject `http://`, `https://`, `//host`, `javascript:`, and path traversal.
- Prefer allowlisted prefixes:
  - `/scenarios/sound/`
  - `scenarios/sound/`
- Show a clear diagnostic error when rejected.
- Add tests for accepted and rejected values.

Likely files:

- `packages/web/src/main.ts`
- `packages/web/src/sound-replay.ts`
- `packages/web/src/sound-replay-presets.ts`
- New helper/test if useful, for example:
  `packages/web/src/public-fetch-url.ts`
  `packages/web/test/public-fetch-url.test.ts`

### Launch Positioning

Use the existing draft as source material:

- `docs/articles/show-hn-post-draft.md`
- `docs/articles/slapstic-finding-hn-draft.md`
- `docs/findings/slapstic-prefetch-side-channel.md`
- `docs/STATUS.md`
- `docs/cpu-config.md`

README and Show HN copy must answer:

- Why not MAME?
  - MAME is the oracle and hardware-preservation reference.
  - Marble Love is a readable source-level model of the game code.
- What is actually new?
  - Function-by-function TypeScript port tied to MAME/Musashi evidence.
  - Slapstic prefetch side-channel finding.
  - Checkable parity matrix.
- What is the catch?
  - No ROMs included.
  - Not cycle-accurate.
  - Audio not globally sample-perfect.
  - Known gameplay bugs remain.

Do not use marketing language. Hacker News copy should be sober and falsifiable.

### Known Gameplay Gaps

Do not remove or soften known limitations unless the agent actually fixes them
with evidence.

Known high-sensitivity gaps:

- README known gameplay bugs around Practice Race and Silly Race.
- `packages/engine/test/l5-silly-race-surface.test.ts` skipped flying-bird test.
- `packages/engine/test/l4-gate-state10-route.test.ts` skipped stale route
  diagnostics.
- High-score / insert-coin visual polish.
- Attract-mode and insert-coin audio.

If the agent chooses to address any of these, it must provide:

- MAME proof or existing seed-based proof.
- Focused test update.
- Browser smoke evidence.

Otherwise, leave them documented and make launch copy clear that the project is
research-grade WIP.

## Suggested Implementation Plan

1. Add a small public URL/path validation helper and tests.
2. Use the helper to restrict diagnostic JSON/tape fetches.
3. Add an auto-load ROM fetch helper with response/ZIP validation and tests.
4. Wire the helper into `packages/web/src/main.ts`.
5. Fix fresh-clone root behavior and explicit `?autoLoad=1` messaging.
6. Update README quickstart and first-impact copy.
7. Add ROM-free demo media or a clearly documented no-ROM live demo path.
8. Update `docs/media/README.md`.
9. Run full validation.
10. Perform browser smoke checks on both fresh-clone/no-ROM and local-ROM paths.

## Validation Commands

Run from repo root:

```sh
npm ci
npm run typecheck
npm run lint
npm run test --silent
npm run context:audit
npm --workspace @marble-love/web run build
git diff --check
git status --short --branch
```

Also run targeted tests for changed files, for example:

```sh
npx vitest run packages/web/test/boot-flow-url.test.ts --silent
npx vitest run packages/web/test/coin-start-flow.test.ts --silent
npx vitest run packages/web/test/sound-gameplay-profile.test.ts --silent
npx vitest run packages/engine/test/slapstic-103.test.ts --silent
```

Browser smoke:

```text
http://localhost:<vite-port>/
http://localhost:<vite-port>/?autoLoad=0
http://localhost:<vite-port>/?rom=1
http://localhost:<vite-port>/?autoLoad=1&startLevel=1&sound=0
```

For the first three, verify behavior in a clean clone or `git archive` copy with
no ROMs. For the last one, use local legally obtained ROMs.

## Acceptance Checklist

- [ ] README has an immediate demo or no-ROM demo link above the fold.
- [ ] README no longer contains a placeholder-only demo section.
- [ ] Fresh clone `/` does not show `invalid zip data`.
- [ ] Fresh clone `?autoLoad=0` works and is documented.
- [ ] README quickstart includes `mkdir -p packages/web/public/roms`.
- [ ] Vite alternate port behavior is documented.
- [ ] ROM picker text still states ROM data stays local.
- [ ] Diagnostic fetch params reject remote URLs and traversal.
- [ ] Tests cover missing-ROM auto-load behavior.
- [ ] Tests cover diagnostic URL validation.
- [ ] Existing focused web tests still pass.
- [ ] Full test suite still passes.
- [ ] Web build still passes.
- [ ] `git diff --check` passes.
- [ ] Final launch copy does not claim complete gameplay/audio/cycle parity.

## Draft Show HN Copy

Title:

```text
Show HN: Marble Love, a readable TypeScript reimplementation of Marble Madness
```

Post:

```text
Marble Love is a source-level reimplementation of Atari's Marble Madness in
TypeScript. It is not an emulator: routines are ported function by function from
the 68010 disassembly, then checked against MAME as the behavioral oracle.

The interesting part for me was not getting pixels on screen, but making the
original game logic readable and testable. One byte-diff led to an undocumented
slapstic/prefetch side-channel; the repo includes the write-up, parity matrix,
and commands to reproduce the claims. It still requires legally obtained ROMs
for real gameplay and has known gameplay/audio gaps, which are documented rather
than hidden.
```

## Handoff Notes For The Implementing Agent

- Read `AGENTS.md` and `docs/context-map.md` first.
- Preserve dirty/untracked work.
- Do not read large JSON fixtures directly.
- Prefer `rg`, targeted tests, and small helper modules.
- Do not change gameplay behavior to make an old diagnostic green.
- Keep public docs in English.
- Report skipped ROM-dependent checks explicitly.
