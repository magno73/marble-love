# Fixture Inventory

This repository intentionally keeps several large JSON fixtures because they
make MAME and TypeScript comparisons reproducible. The project does not track
ROM files or extracted game assets.

Inventory commands run on 2026-05-28:

```sh
git ls-files -z | xargs -0 du -k 2>/dev/null | sort -nr | head -80
git ls-files 'packages/web/public/scenarios/**/*.json' 'oracle/scenarios/**/*.json' -z | xargs -0 du -k 2>/dev/null | awk '{s+=$1} END {printf "%.1f MB\n", s/1024}'
git count-objects -vH
```

## Current Size Profile

- Tracked scenario JSON under `packages/web/public/scenarios/` and
  `oracle/scenarios/`: about 98.6 MB.
- Git object pack size: about 8.60 MiB.
- Largest individual fixtures are 5.2 MB gameplay/playable scenario snapshots
  retained under `oracle/scenarios/` for oracle comparisons.

## Classification

| Area | Classification | Current action |
| --- | --- | --- |
| `packages/web/public/scenarios/gameplay/*.json` | Former browser warm-scenario fixtures. | Removed from the browser public path; canonical copies remain under `oracle/scenarios/gameplay/`. |
| `packages/web/public/scenarios/playable/*.seed.json` | Browser start-level and warm-seed paths. | Keep; these support public testing without ROM-derived asset commits. |
| `packages/web/public/scenarios/sound/*.json` | Browser sound replay fixtures. | Keep; they exercise the replay path without shipping audio assets. |
| `oracle/scenarios/**/*.json` | MAME oracle/reference fixtures for maintainers. | Keep; they are not the primary public onboarding path. |
| `oracle/tom_harte_m68000/*.json` | CPU validation fixtures. | Keep as third-party test references; do not read them broadly in agent sessions. |

## Size, restated (2026-06-02)

- `oracle/scenarios/`: ~97 MB. `oracle/tom_harte_m68000/`: ~22 MB.
  Total tracked oracle JSON ~120 MB.
- `.git` working directory ~45 MB (the compressed pack is smaller; `git
  count-objects -vH` reports the pack size).
- Largest individual fixtures are ~5.2 MB gameplay/playable snapshots.

## Trade-off and options (HN readiness)

The honest concern for a Hacker News clone: ~120 MB of tracked JSON makes the
pack heavier and the clone slower than a typical TS repo — a near-certain
comment. Three options were considered:

- **A — Git LFS.** Move the oracle JSON to LFS. Shrinks a fresh working-tree
  clone, but reclaiming the existing pack requires a **history rewrite**, which
  an agent does not perform autonomously. If chosen, the agent would prepare
  `.gitattributes` and document the manual rewrite; it would not rewrite history.
- **B — Separate `marble-love-fixtures` repo.** Move the heavy oracle fixtures
  to a companion repo plus a `tools/fetch_fixtures.sh` downloader. Requires the
  maintainer to create the external repo first; the `git rm` removal commit is
  prepared on a branch but **not pushed** until that exists.
- **C — Status quo + documentation (this page).** Keep the fixtures, explain the
  trade-off, and review future large additions deliberately. The browser public
  path already avoids the heaviest snapshots; the remaining size is maintainer
  oracle data. **Safest for the HN launch.**

**Decision (W7 gate).** Option **C is in effect for the launch** and is what this
PR delivers. Options A and B are deliberate, history- or infrastructure-affecting
choices reserved for the maintainer (Marco): they are documented here so the
trade-off is explicit, but not executed without an explicit decision. B is the
natural post-launch follow-up if clone size becomes a real friction point.
