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

## Recommendation

The repository is publicable with these fixtures if the README clearly explains
their purpose and if future large additions are reviewed deliberately. The main
remaining size is oracle data, not browser-served assets. A later cleanup can
add a manifest/generation workflow or compressed loader support before adding
more large public scenarios.
