# Marble Love Show HN Launch PRD

> Revised 2026-06-09 after a full-repo readiness audit
> (`docs/hn-launch-gap-analysis.md`) and maintainer decisions. The original
> onboarding/fetch-safety scope shipped in `e202ea2`; this revision records
> what remains.

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

## Maintainer Decisions (2026-06-09)

These supersede any earlier open questions in this document:

1. **Demo media: real gameplay.** The maintainer explicitly approves
   publishing a ROM-backed gameplay capture (GIF/MP4 containing original game
   graphics) in the README. The maintainer generates it locally with
   `tools/record_demo.sh` using legally owned ROMs.
2. **Live demo: GitHub Pages.** The ROM-free synthetic demo path is deployed
   to GitHub Pages and set as the repository homepage. The Show HN post links
   to it.
3. **Launch-prep docs are removed before the repo goes public.** This PRD,
   `docs/articles/show-hn-post-draft.md`,
   `docs/articles/slapstic-finding-hn-draft.md`, and
   `docs/hn-launch-gap-analysis.md` are deleted from the tree before the
   visibility flip (they remain in git history; no history rewrite). The
   technical finding `docs/findings/slapstic-prefetch-side-channel.md` stays.
4. **Show HN title:** the "function-by-function" variant (see Draft Show HN
   Copy below).

## Current Readiness Summary

Re-verified 2026-06-09 on a fresh clone of `main` (`891f4ee`):

- `npm ci` (Node 22) passes.
- `npm run typecheck` and `npm run lint` pass.
- `npx vitest run --silent` passes: 2381 passed, 74 skipped (ROM-dependent
  suites self-skip).
- `npm --workspace @marble-love/web run build` passes.
- `git diff --check` passes; CI on `main` is green (run #47).
- Fresh-clone `/` no longer shows `invalid zip data`; the missing-ROM message
  is clear and in English (`auto-load-rom.ts` validates status, content type,
  and ZIP magic).
- `?autoLoad=0` renders the clearly-labeled synthetic demo with no console
  errors and no copyrighted assets.
- Diagnostic fetch parameters are hardened (`public-fetch-url.ts`): remote
  URLs, protocol-relative URLs, traversal (including percent-encoded), query
  strings, and fragments are rejected; an allowlist is enforced; tested in
  `public-fetch-url.test.ts`.
- README quickstart matches a clean clone, including
  `mkdir -p packages/web/public/roms` and the Vite alternate-port note.
- No Italian remains in code or user-facing docs; no secrets, credentials, or
  email addresses in the tree; `.gitignore` covers `roms/`,
  `packages/web/public/roms`, and `ghidra_project/`.

Remaining launch blockers:

1. The repository is still **private**.
2. The README has **no committed demo media** (the Demo section is a
   commented-out placeholder).
3. GitHub reports the license as **"Other/NOASSERTION"**: the ROM notice
   appended inside `LICENSE` breaks MIT auto-detection.
4. There is **no hosted live demo** (`has_pages` false, homepage field empty).

## Goals

1. Make the repo understandable in under 30 seconds.
2. Ship a real-gameplay demo capture in the README (maintainer-approved) and
   keep the legal, ROM-free demo path working after `npm ci`.
3. Deploy the ROM-free demo to GitHub Pages and link it from the README and
   the Show HN post.
4. Make the missing-ROM path clear and non-alarming. *(Done — keep it that
   way.)*
5. Keep ROM-backed loading local, explicit, and privacy-preserving.
6. Keep URL-driven fetches restricted so HN security review does not find an
   easy issue. *(Done — do not regress.)*
7. Keep launch copy claims matched to tested behavior.
8. Preserve all current validation strength; do not make diagnostics green by
   weakening gameplay, collision, renderer, route, or seed behavior.

## Non-Goals

- Do not claim cycle accuracy.
- Do not claim complete audio PCM parity.
- Do not hide known gameplay bugs.
- Do not rewrite history, move fixture repos, or introduce Git LFS in this
  task.
- Do not fix old route diagnostics by changing gameplay behavior without fresh
  MAME evidence.
- Do not ship ROM ZIPs or raw extracted assets. (The maintainer-approved
  gameplay *capture* is the one sanctioned exception to publishing imagery of
  the original game.)

## Required User-Facing Outcomes

### Demo Media (maintainer-approved real gameplay)

- Maintainer runs `tools/record_demo.sh` locally with legal ROMs and commits:
  - `docs/media/demo.gif` (README-embeddable, target ≤ ~6 MB), and
    optionally `docs/media/demo.mp4`.
- README "Demo" section embeds the GIF directly — no commented-out
  placeholder may remain.
- `docs/media/README.md` is updated to state that the committed capture was
  produced and approved by the maintainer from legally owned ROMs, and to keep
  the generation instructions.
- The ROM-free synthetic path (`?autoLoad=0`) remains documented in the
  quickstart as the no-ROM smoke check.

### Hosted Live Demo (GitHub Pages)

- Add a Pages deploy workflow (e.g. `.github/workflows/pages.yml`) that builds
  `@marble-love/web` and publishes `dist/`.
- Configure Vite `base` so the app works under the
  `https://<user>.github.io/marble-love/` subpath; verify the synthetic demo,
  the manual ROM picker, and the diagnostic-fetch allowlist all behave under
  that base path.
- The deployed root must land on the ROM-free experience (synthetic demo
  and/or the clear "no local ROMs" message + Load ROMs picker) with no console
  errors. ROM loading stays strictly local to the visitor's browser.
- Set the repository homepage field to the Pages URL.
- README links the live demo above the fold.

Acceptance criteria:

- Pages URL loads the synthetic demo with no console errors.
- The ROM picker works on the deployed site with a local ZIP (manual check by
  the maintainer; ROM data must not leave the browser).
- `?autoLoad=1` on the deployed site does not produce a misleading error when
  no `/roms/` assets exist.

### License Detection Fix

- Restore `LICENSE` to the pristine MIT text (GitHub licensee must detect
  `MIT`).
- Move the ROM/asset notice currently appended to `LICENSE` into a separate
  `NOTICE` file; README "Legal" and `THIRD_PARTY.md` already carry the same
  language.

### Repo Metadata And Hygiene

- Set repository topics (suggested: `typescript`, `reverse-engineering`,
  `marble-madness`, `atari`, `mame`, `m68k`, `emulation`,
  `game-preservation`) and a social-preview image (a frame from the approved
  gameplay capture is fine).
- Remove the maintainer-machine path from `AGENTS.md` line 3
  (`/Users/magnus-bot/Code/marble-love` → a generic placeholder).
- Remove or document the stray `runs/*.txt` parity logs at the repo root.

### Pre-Flip Cleanup And Publication

Ordered launch sequence:

1. License/NOTICE split, AGENTS.md path, `runs/` tidy (minutes).
2. Maintainer generates and commits the gameplay capture; README Demo section
   updated.
3. Pages workflow + Vite base + homepage + topics + social preview.
4. Delete launch-prep docs from the tree: this PRD,
   `docs/articles/show-hn-post-draft.md`,
   `docs/articles/slapstic-finding-hn-draft.md`,
   `docs/hn-launch-gap-analysis.md`. Keep
   `docs/findings/slapstic-prefetch-side-channel.md` and `docs/STATUS.md`.
   Fix any links that pointed at the removed files.
5. Run GitHub secret scanning; final validation pass (commands below).
6. Flip the repository to public.
7. Post the Show HN (copy below), from the maintainer's own account, ideally
   a weekday morning US time. Reply in comments with reproduce-commands
   rather than assertions.

### Known Gameplay Gaps

Do not remove or soften known limitations unless actually fixed with evidence
(MAME proof or seed-based proof, focused test update, browser smoke evidence):

- README known gameplay bugs around Practice Race and Silly Race.
- High-score / insert-coin visual polish.
- Attract-mode and insert-coin audio.
- Skipped ROM-gated suites (74 at last count) stay documented in
  `docs/STATUS.md`; be ready to explain the number in HN comments.

## Validation Commands

Run from repo root before the flip:

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

Browser smoke (local):

```text
http://localhost:<vite-port>/
http://localhost:<vite-port>/?autoLoad=0
http://localhost:<vite-port>/?rom=1
http://localhost:<vite-port>/?autoLoad=1&startLevel=1&sound=0
```

Deployed smoke (after Pages deploy):

```text
https://<user>.github.io/marble-love/
https://<user>.github.io/marble-love/?autoLoad=0
https://<user>.github.io/marble-love/?rom=1   (manual ROM picker, local ZIP)
```

## Acceptance Checklist

Done (verified 2026-06-09 — do not regress):

- [x] Fresh clone `/` does not show `invalid zip data`.
- [x] Fresh clone `?autoLoad=0` works and is documented.
- [x] README quickstart includes `mkdir -p packages/web/public/roms`.
- [x] Vite alternate port behavior is documented.
- [x] ROM picker text still states ROM data stays local.
- [x] Diagnostic fetch params reject remote URLs and traversal.
- [x] Tests cover missing-ROM auto-load behavior.
- [x] Tests cover diagnostic URL validation.
- [x] Full test suite, web build, and `git diff --check` pass.
- [x] Launch copy does not claim complete gameplay/audio/cycle parity.

Remaining:

- [ ] `docs/media/demo.gif` (real gameplay, maintainer-generated) committed
      and embedded in the README; no placeholder Demo section remains.
- [ ] `docs/media/README.md` notes the maintainer approval and provenance.
- [ ] GitHub Pages deploy workflow added; deployed site passes the deployed
      smoke checks; homepage field set; README links the live demo.
- [ ] `LICENSE` is pristine MIT (GitHub shows "MIT"); ROM notice moved to
      `NOTICE`.
- [ ] Topics and social-preview image set.
- [ ] `AGENTS.md` no longer contains a local machine path.
- [ ] `runs/*.txt` removed or documented.
- [ ] Launch-prep docs (this PRD, both article drafts, the gap analysis)
      deleted from the tree; links fixed.
- [ ] Secret scan run; repository flipped to public.
- [ ] Show HN posted with the approved title and copy.

## Draft Show HN Copy (approved title)

Title:

```text
Show HN: Marble Love – a function-by-function TypeScript reimplementation of Marble Madness
```

URL: the GitHub repository (the live demo is linked in the text and from the
README above the fold).

Post:

```text
Marble Love is a source-level reimplementation of Atari's Marble Madness in
TypeScript. It is not an emulator: routines are ported function by function
from the 68010 disassembly, then checked against MAME as the behavioral
oracle.

The interesting part for me was not getting pixels on screen, but making the
original game logic readable and testable. One byte-diff led to an
undocumented slapstic/prefetch side-channel; the repo includes the write-up,
parity matrix, and commands to reproduce the claims.

There is a ROM-free demo running on GitHub Pages (link in the README). Real
gameplay requires legally obtained ROMs, loaded locally in your browser. Known
gameplay/audio gaps are documented rather than hidden.
```

Keep the copy sober and falsifiable; no marketing language. Expected top
comments to be ready for: "why not just use MAME" (README/STATUS answer),
"is requiring ROMs legal" (README Legal answer), "what is actually
bit-perfect" (STATUS parity matrix), and questions about the LLM-agent
workflow — keep the existing honest framing: a tool, not the pitch; the
oracle and tests are what make it trustworthy.

## Handoff Notes For The Implementing Agent

- Read `AGENTS.md` and `docs/context-map.md` first.
- Preserve dirty/untracked work.
- Do not read large JSON fixtures directly.
- Prefer `rg`, targeted tests, and small helper modules.
- Do not change gameplay behavior to make an old diagnostic green.
- Keep public docs in English.
- Report skipped ROM-dependent checks explicitly.
- The Pages deploy must not weaken the fetch allowlist or make ROM loading
  non-local.
