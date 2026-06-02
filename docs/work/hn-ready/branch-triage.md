# W2 — Remote branch triage (working note; Marco decides deletions)

Audit date: 2026-06-02. 21 `codex/*` / `claude/*` branches on `origin`
(excluding the in-flight `claude/hn-ready/*` PR branches). Per the PRD, the agent
does **not** delete remote branches — this is a recommendation list.

## Recommend CLOSE — already merged into `origin/main` (work has landed)

`git branch -r --merged origin/main` confirms these contain no commits missing
from `main`; deleting them loses nothing.

| Branch | Last commit |
|---|---|
| `claude/serene-ritchie-JdHiR` | 2026-06-01 |
| `codex/level-header-decode` | 2026-05-19 |
| `codex/render-score-28e3c` | 2026-05-08 |
| `codex/string-helper-17cb8` | 2026-05-08 |
| `codex/eeprom-helper-40d8` | 2026-05-08 |
| `codex/state-builder-52da` | 2026-05-08 |
| `codex/sprite-helper-1b9cc` | 2026-05-08 |
| `codex/scroll-helper-f6a` | 2026-05-08 |
| `codex/slapstic-dispatcher-1344c` | 2026-05-08 |
| `codex/object-slot-lookup-11b18` | 2026-05-08 |
| `codex/object-init-259b4` | 2026-05-08 |
| `codex/level-init-16f6c` | 2026-05-08 |
| `codex/banner-helper-26b66` | 2026-05-08 |
| `codex/soft-reset-100e0` | 2026-05-08 |
| `codex/init-fn-pointers-28580` | 2026-05-08 |
| `codex/clear-alpha-tiles-28c7e` | 2026-05-08 |
| `codex/scene-obj-init-28ca6` | 2026-05-07 |
| `codex/wire-level-dispatcher-helper16ec6` | 2026-05-07 |

(18 branches — the per-function Codex RE branches; their routines are in `main`.)

## Recommend REVIEW — not merged into `origin/main` (unique commits)

These still carry commits not on `main`; check whether anything is worth keeping
before closing.

| Branch | Last commit | Note |
|---|---|---|
| `claude/repo-review-priorities-8WVoa` | 2026-05-29 | Likely a review/notes branch — confirm nothing actionable is stranded. |
| `claude/marble-1984-analysis-I0AJ0` | 2026-05-18 | Analysis branch — confirm findings are captured in `docs/` before closing. |
| `claude/investigate-level-intro-2vNoG` | 2026-05-17 | Level-intro investigation — the intro work later landed on `main`; verify no unique fix remains. |

## In-flight (do not touch)

- `claude/hn-ready/W1-rom-gating` — PR #32 (this HN-readiness effort).
- `claude/hn-ready/W2-hygiene` — this PR.
