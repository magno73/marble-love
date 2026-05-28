# Task: Public Launch Polish For GitHub And Hacker News

## Goal

Prepare Marble Love for a credible public GitHub release and a later Hacker News
launch. The public face of the project must read like a serious reverse
engineering and reimplementation effort: clear English, honest claims, clean
repository surface, visible validation, and explicit ROM/legal boundaries.

The project should be positioned explicitly as a TypeScript reimplementation of
Atari's Marble Madness built from ROM disassembly, Ghidra analysis, and
differential testing against MAME. Do not overclaim complete bit-perfect
behavior across every subsystem. Be precise about what is parity-checked, what
is playable, and what is still work in progress.

## User Decisions

- Public language policy: English only for public-facing docs, comments, UI
  text, CI, issue templates, and active source comments.
- Remove or rewrite obsolete diagnostic/fix comments in active code. Comments
  should be useful to technically sophisticated readers, including Hacker News
  readers.
- AI-agent task files, handoffs, stale PRDs, and historical working notes should
  move out of the main public reading path or be clearly archived/internal.
- Target is Hacker News readiness, but video/GIF production and final launch
  copy are separate later phases.
- CI should be chosen for public credibility: fast enough for contributors, but
  strong enough that HN/GitHub readers can trust the project.
- Naming/positioning can explicitly say Marble Madness, ROM disassembly, Ghidra,
  and MAME differential testing, with strong legal disclaimers.
- Add `CONTRIBUTING.md`, `THIRD_PARTY.md`, issue templates, and a clear
  `Known limitations` section.

## Context Files To Read First

- `AGENTS.md`
- `docs/context-map.md`
- `README.md`
- `LICENSE`
- `.gitignore`
- `package.json`
- `packages/web/package.json`
- `packages/engine/package.json`
- `packages/cli/package.json`
- `docs/rom-layout.md`
- `docs/context-map.md`
- `docs/codex-task-boot-audio-handoff.md`

Do not bulk-read large JSON fixtures. Use `git ls-files`, `du`, `jq`, and
targeted summaries.

## Do Not Read Unless Needed

- `docs/archive/**`
- `screenshots/**`
- `traces/**`
- `snap/**`
- `packages/web/dist/**`
- `node_modules/**`
- `.claude/worktrees/**`
- `oracle/tom_harte_m68000/*.json`
- `packages/web/public/scenarios/**/*.json`
- `oracle/scenarios/**/*.json`

Use summary commands for those paths if needed.

## Non-Goals

- Do not change gameplay, collision, renderer behavior, audio behavior, seed
  behavior, or oracle semantics.
- Do not remove validation fixtures unless the PR includes a clear replacement,
  manifest, or public-size rationale.
- Do not rewrite the whole codebase just to translate comments.
- Do not add ROM files, screenshots derived from copyrighted ROM art, or any
  copyrighted assets.
- Do not claim the entire game is fully bit-perfect unless validated evidence
  supports that exact claim.

## Current Audit Findings

- There is no `.github/workflows` CI configuration.
- README is currently Italian and written for internal development context.
- The repo tracks both `package-lock.json` and `bun.lock`; choose one public
  package manager policy.
- Tracked files are roughly 215 MB. Scenario/oracle JSON files account for
  roughly 176 MB.
- No ROM ZIPs or ROM files appear to be tracked.
- Many docs are internal AI/task/handoff documents. They should not be the main
  public reading surface.
- Active source comments are mixed English/Italian and include stale diagnostic
  or fix-history comments.
- The web path currently requires user-provided MAME ROM ZIPs. README must make
  that flow clear, legal, and local-only.

## Public Claims Policy

Allowed claims:

- "TypeScript reimplementation of Marble Madness."
- "Built through ROM disassembly and Ghidra analysis."
- "Differentially tested against MAME."
- "Runs in the browser with user-supplied ROMs."
- "No ROMs or copyrighted assets are included."
- "Several subsystems and routines are parity-tested/bit-perfect against oracle
  traces." Only say this where there is specific evidence.

Avoid or qualify:

- "Bit-perfect Marble Madness" as a blanket claim.
- "Fully playable" unless the current browser path has been freshly smoke-tested
  from boot through multiple levels.
- "Original audio is complete" or "audio is bit-perfect." Current safe wording:
  gameplay music/effects are partially wired; attract/insert-coin audio and
  PCM parity remain ongoing work.

## Phase 1: Public README And Documentation Surface

Rewrite `README.md` in English. It should be concise, credible, and skimmable:

1. One-paragraph project summary.
2. Short demo/status section:
   - browser frontend;
   - user-supplied ROM loading;
   - boot/high-score/coin/start flow;
   - level progression;
   - current audio status;
   - differential testing/MAME oracle status.
3. "What works today" and "Known limitations" sections.
4. Quick start from fresh clone:
   - supported Node version;
   - package manager command;
   - where to place legally obtained ROM ZIPs;
   - local dev server command;
   - URL to open.
5. Validation commands.
6. Repository layout.
7. Legal/disclaimer section:
   - no ROMs included;
   - ROM data remains property of rights holders;
   - user must provide legal ROM dumps;
   - project is unaffiliated with Atari/Warner/rights holders.
8. Reverse engineering methodology:
   - Ghidra;
   - MAME oracle scripts;
   - differential tests;
   - TypeScript engine and browser frontend.

Create or update:

- `CONTRIBUTING.md`
- `THIRD_PARTY.md`
- `docs/public/` or equivalent public documentation area
- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `.github/ISSUE_TEMPLATE/feature_request.yml`
- `.github/pull_request_template.md`

Keep public docs English-only.

## Phase 2: Internal Docs And Repository Surface Cleanup

Move internal/agent-facing documents out of the main public reading path. Prefer
one of these approaches, in order:

1. Move historical task/handoff/agent documents under `docs/internal/` or
   `docs/archive/internal/`, and make `docs/README.md` explain that they are
   development history, not public onboarding material.
2. If a file is obsolete and duplicated by a newer handoff, delete it only after
   confirming it is not referenced by `docs/context-map.md`, README, tests, or
   package scripts.
3. Keep `AGENTS.md`, `docs/context-map.md`, and task-template files if they are
   required for AI workflows, but make their audience explicit.

Candidate documents to classify:

- `docs/agent-briefing.md`
- `docs/codex-brief.md`
- `docs/codex-prd.md`
- `docs/codex-task-*.md`
- `docs/audio-replay-session-prompt.md`
- old PRDs and historical status logs under `docs/archive/**`

Do not remove context needed by active tasks without updating
`docs/context-map.md`.

## Phase 3: Source Comment And UI Text Pass

Apply a targeted English cleanup to active source, not a blind mass rewrite.

Priority files:

- `packages/web/src/main.ts`
- `packages/web/src/rom-loader.ts`
- `packages/web/src/coin-start-flow.ts`
- `packages/web/src/sound-gameplay-profile.ts`
- `packages/engine/src/**/*.ts` files with public exports or active runtime
  behavior
- `packages/engine/src/audio/**/*.ts`
- `packages/engine/src/m6502/sound-chip.ts`

Rules:

- Translate active comments to English.
- Delete comments that only describe an obsolete fix attempt, temporary debug
  workaround, or stale phase note.
- Keep comments that explain hardware behavior, ROM addresses, MAME/Ghidra
  provenance, parity constraints, or non-obvious emulation choices.
- New comments should explain "why", not restate "what".
- Avoid Italian UI strings and console messages in public web paths.
- CLI diagnostics may remain verbose, but command help and errors should be
  English.
- Preserve ROM routine names and address references exactly.

Suggested audit commands:

```sh
git grep -n -E 'TODO|FIXME|HACK|XXX' -- 'packages/**/*.ts' 'oracle/**/*.ts' 'harness/**/*.ts'
git grep -n -E '[àèéìòù]|\\b(perche|perché|vecchio|vecchia|utente|livello|schermata|diagnostica|temporaneo|stato|suono)\\b' -- 'packages/**/*.ts'
git grep -n -E 'console\\.log\\(|console\\.warn\\(|console\\.error\\(' -- 'packages/web/src/**/*.ts'
```

The goal is not zero results. The goal is that remaining results are intentional
and not part of the public-facing path.

## Phase 4: CI And Package Manager Policy

Use npm for public onboarding unless there is a strong reason to switch.

Recommended:

- Keep `package-lock.json`.
- Remove `bun.lock` if npm is the documented path.
- README should say `npm ci`, not `npm install`, for reproducible setup.

Add GitHub Actions:

- `pull_request` and `push` to `main`.
- Node 22.
- `npm ci`.
- `npm run typecheck`.
- Targeted tests that are stable and fast.
- `npm --workspace @marble-love/web run build`.
- `git diff --check`.

Recommended CI shape for public credibility:

```sh
npm ci
npm run typecheck
npx vitest run packages/web/test/coin-start-flow.test.ts packages/web/test/boot-flow-url.test.ts packages/web/test/sound-gameplay-profile.test.ts --silent
npm --workspace @marble-love/web run build
git diff --check
```

If full `npm test` is stable and not too slow, add it. If it is slow, create a
separate scheduled/manual `full-test` workflow and explain the split.

## Phase 5: Large Fixture And Public Size Review

Do not delete large fixtures blindly. Produce an inventory and a recommendation.

Required inventory:

```sh
git ls-files -z | xargs -0 du -k 2>/dev/null | sort -nr | head -80
git ls-files 'packages/web/public/scenarios/**/*.json' 'oracle/scenarios/**/*.json' -z | xargs -0 du -k 2>/dev/null | awk '{s+=$1} END {printf "%.1f MB\\n", s/1024}'
git count-objects -vH
```

Classify large JSON files into:

- required for browser public demo;
- required for tests;
- oracle/reference fixtures useful to contributors;
- historical or replaceable diagnostic artifacts.

Possible outcomes:

- Keep essential fixtures.
- Move non-public fixtures out of `packages/web/public/`.
- Add manifests or generation instructions for heavyweight oracle fixtures.
- Compress fixtures only if the loader/test path supports it cleanly.
- Document why large fixtures are present.

Acceptance: no unexplained multi-megabyte public assets in the browser public
folder.

## Phase 6: Legal And Third-Party Review

Create `THIRD_PARTY.md` covering:

- PixiJS
- fflate
- musashi-wasm
- Vitest/TypeScript tooling
- MAME references and scripts
- Tom Harte CPU test fixtures, if retained
- Ghidra as an analysis tool

Update legal/disclaimer wording:

- `LICENSE` covers only original Marble Love source code.
- Marble Madness and Atari-related marks/assets are owned by their respective
  holders.
- No ROMs, original graphics, original sound assets, or copyrighted ROM-derived
  assets are distributed.
- The browser reads local user-provided ROM ZIPs.
- The project is for preservation, education, and reverse engineering research.

If any tracked fixture is derived from ROM execution state rather than ROM bytes,
document the status carefully and avoid implying ownership of original assets.

## Phase 7: Fresh Clone Smoke Test

After cleanup, test a fresh clone path or an equivalent clean checkout:

```sh
npm ci
npm run typecheck
npx vitest run packages/web/test/coin-start-flow.test.ts packages/web/test/boot-flow-url.test.ts packages/web/test/sound-gameplay-profile.test.ts --silent
npm --workspace @marble-love/web run build
```

Manual browser smoke:

```text
http://localhost:5173/?autoLoad=1&play=1&bootFlow=1&sound=1
```

Expected:

- high-score/insert-coin screen appears;
- `5` inserts credit;
- `Enter` starts gameplay;
- level music and gameplay event sounds work after enabling audio;
- no default insert-coin or attract music claim is made.

Record the exact smoke result in the PR.

## Phase 8: Video/GIF Preparation

This is separate from the repo cleanup PR.

Prepare:

- 20-40 second browser capture:
  - boot/high-score;
  - coin/start;
  - level 1 gameplay;
  - level transition if stable.
- Optional short clip showing Ghidra/MAME/differential testing workflow.
- Avoid distributing ROM files or extracted assets outside the live local
  capture context.

Add README media only if licensing risk is acceptable. Otherwise link to a
separate demo page/video with the same legal disclaimers.

## Phase 9: Hacker News Launch Copy Support

This is separate from the repo cleanup PR.

Prepare a short `docs/public/launch-notes.md` with:

- one-sentence hook;
- what is technically interesting;
- what is working;
- what is incomplete;
- how ROM/legal handling works;
- why TypeScript/browser;
- validation methodology.

The user already plans to write final launch copy. Do not publish or post.

## Validation

Run at minimum:

```sh
npm ci
npm run typecheck
npx vitest run packages/web/test/coin-start-flow.test.ts packages/web/test/boot-flow-url.test.ts packages/web/test/sound-gameplay-profile.test.ts --silent
npm --workspace @marble-love/web run build
git diff --check
git status --short --branch
```

If source comments or docs are moved broadly, also run:

```sh
npm run context:audit
```

If CI is added, verify the workflow syntax locally where possible or by pushing
to a test branch.

## Done Criteria

- README is English, concise, honest, and public-ready.
- Public docs and active source comments are English.
- Obsolete diagnostic/fix comments are removed from active code paths.
- Internal AI/task docs are moved out of the primary public reading path or
  clearly labeled.
- GitHub Actions CI exists and passes.
- Package manager policy is documented and lockfiles are consistent.
- `CONTRIBUTING.md`, `THIRD_PARTY.md`, issue templates, and PR template exist.
- Large public fixtures are inventoried and either justified, moved, or reduced.
- Legal/ROM disclaimers are clear.
- Fresh clone instructions have been tested.
- No gameplay/audio/rendering behavior changes are introduced by this PR.
