# HN Launch Gap Analysis (2026-06-09)

> Superseded where it conflicts by the maintainer decisions recorded in
> `docs/show-hn-launch-prd.md` ("Maintainer Decisions, 2026-06-09"): real
> gameplay capture approved for the README, GitHub Pages live demo in scope,
> launch-prep docs (including this file) to be deleted before the repo goes
> public, "function-by-function" Show HN title.

Full-repo audit against `docs/show-hn-launch-prd.md` to determine what is
still missing before the Show HN launch. Every claim below was re-verified on
this date on a fresh clone of `main` (`891f4ee`).

## Verified green (no action needed)

| Check | Result |
|---|---|
| `npm ci` (Node 22) | passes |
| `npm run typecheck` | passes |
| `npm run lint` | passes |
| `npx vitest run --silent` | 2381 passed, 74 skipped (ROM-dependent suites self-skip) |
| `npm --workspace @marble-love/web run build` | passes (one chunk-size warning, see Minor) |
| `git diff --check` | passes |
| CI on `main` | green (run #47 at `891f4ee`) |
| Diagnostic fetch hardening | real and tested: `public-fetch-url.ts` rejects remote URLs, protocol-relative URLs, traversal (incl. percent-encoded), query/fragment; allowlist enforced; covered by `public-fetch-url.test.ts` |
| Fresh-clone `/` (no ROMs) | no more `invalid zip data`; clear English message + Load ROMs button (`auto-load-rom.ts` validates status/content-type/ZIP magic) |
| `?autoLoad=0` ROM-free demo | works, clearly labeled synthetic ("CLASSIC FRAME DEMO"), no copyrighted assets |
| Language sweep | no Italian left in code or user-facing docs (the one remaining Italian string is a historical quote inside the PRD itself) |
| Secrets / credentials | none found (no .env, keys, emails); `.gitignore` covers `roms/`, `packages/web/public/roms`, `ghidra_project/` |
| Launch copy | README, STATUS.md parity matrix, Show HN post draft (<300 words), and slapstic article draft are sober, falsifiable, and consistent |
| Clone weight | pack is ~9 MiB despite ~120 MB of fixtures in the working tree (JSON compresses well) — acceptable |

## Blockers (must do before posting)

1. **The repository is still private.** GitHub reports
   `visibility: private`. Nothing else matters until it is public. Before
   flipping: run GitHub secret scanning once, and re-read the git history for
   anything unintended (the history contains only project work, but it is
   long — a squash is *not* needed; the i18n-sweep history is honest and HN
   tends to like that).

2. **No visible demo in the README.** `docs/media/` contains only a README;
   the README "Demo" section is a commented-out placeholder. This is the
   single highest-impact missing item for HN conversion, and an explicit PRD
   acceptance item ("README no longer contains a placeholder-only demo
   section"). Options, in order of preference:
   - Maintainer runs `tools/record_demo.sh` locally with legal ROMs and
     decides whether ROM-backed media can be published (PRD requires explicit
     maintainer approval for that).
   - Otherwise capture the ROM-free `?autoLoad=0` synthetic demo and commit
     that as `docs/media/demo-rom-free.gif`, clearly labeled synthetic.

3. **GitHub does not recognize the license** (`Other / NOASSERTION`). The
   appended ROM notice inside `LICENSE` breaks licensee's MIT detection, so
   the repo page will not show the MIT badge — something HN readers check
   immediately. Fix: keep `LICENSE` as pristine MIT text and move the ROM
   notice to a separate `NOTICE` file (the same language already exists in
   README "Legal" and `THIRD_PARTY.md`, so nothing is lost).

## Strongly recommended

4. **Host the ROM-free demo (GitHub Pages or similar) and set it as the repo
   homepage.** `has_pages` is false and the homepage field is empty. A
   clickable live link in the Show HN text dramatically lowers the barrier
   versus "clone, npm ci, provide ROMs". The web build already works; it
   needs a Pages workflow and a Vite `base` setting. The hosted page should
   default to the synthetic demo and keep the local ROM picker for people who
   have ROMs.

5. **Repo metadata.** Set topics (e.g. `typescript`, `reverse-engineering`,
   `marble-madness`, `atari`, `mame`, `m68k`, `emulation`, `game-preservation`)
   and a social-preview image. The description is already good.

6. **Remove the maintainer-machine path from `AGENTS.md`** (line 3:
   `/Users/magnus-bot/Code/marble-love`). Cosmetic, but it is the kind of
   detail HN commenters screenshot.

7. **Decide the fate of the launch-prep docs before going public.**
   `docs/show-hn-launch-prd.md`, `docs/articles/show-hn-post-draft.md`, and
   `docs/articles/slapstic-finding-hn-draft.md` will be world-readable the
   moment the repo is public, and HN readers will find them. Keeping them is
   defensible (they are honest working documents), but it should be a
   conscious choice, not an accident. If kept, fix the PRD's stale
   "Current Readiness" section so it does not contradict the shipped fixes.

8. **Tidy stray artifacts.** `runs/*.txt` (three parity logs) sit at the repo
   root with no README; either delete them or document them like the other
   fixture directories.

## Minor / optional

- The web bundle is one ~983 kB JS chunk (290 kB gzip). Fine for a game, but
  the Vite warning will appear in CI logs; either code-split PixiJS or raise
  `chunkSizeWarningLimit` with a comment.
- 74 skipped tests are all ROM-gated and documented; no action, but be ready
  to explain the number in comments.
- Consider enabling GitHub Discussions as a landing place for HN follow-up
  that is not an issue.

## HN-specific notes (audience: technical, skeptical)

- **Lead with the slapstic prefetch side-channel.** It is the genuinely novel
  artifact; the drafts already do this. The repo's parity matrix
  (`docs/STATUS.md`) is the right defense against "how do you know it's
  faithful".
- **The LLM-agent disclosure in the drafts is the right call.** HN is
  currently hostile to undisclosed AI-generated code; the existing framing
  ("a tool, not the pitch; the oracle and tests make it trustworthy") is the
  strongest available position. Expect questions; do not soften it.
- **Expected top comments to be ready for:** "why not just use MAME"
  (answered in README/STATUS), "is requiring ROMs legal" (answered in Legal),
  "can I try it without ROMs" (this is why item 4 matters), and "what's
  actually bit-perfect" (STATUS matrix).
- Post as the maintainer's own account, ideally a weekday morning US time;
  reply in comments with reproduce-commands rather than assertions.

## Suggested order of work

1. Fix LICENSE/NOTICE split (item 3) and AGENTS.md path (item 6) — minutes.
2. Generate and commit demo media (item 2) — needs maintainer ROMs/decision.
3. Pages deploy + homepage + topics (items 4–5).
4. Sweep `runs/`, PRD staleness (items 7–8).
5. Run secret scan, flip the repo to public (item 1).
6. Post, using `docs/articles/show-hn-post-draft.md` as the text.
