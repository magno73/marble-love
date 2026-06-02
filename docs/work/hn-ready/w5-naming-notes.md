# W5 — Naming sweep notes (working note, do not publish)

Audit date: 2026-06-02.

## Centrality analysis

Computed import in-degree over `packages/engine/src` (a centrality proxy for the
call graph rooted at `main-tick.ts`). The most-imported hex-address-named files:

```
11  state-sub-2572.ts        7  render-string-entry-28f62.ts
11  sound-cmd-send-158ac.ts  7  sprite-pos-update-1bab2.ts
10  slot-insert-sorted-18e6c 6  render-score-28e3c.ts
 9  sprite-helper-1b9cc.ts   6  object-state-entry-25bae.ts
 8  sprite-project-1cc62.ts  6  level-helper-2ffb8.ts / random-mod-13a98.ts
 8  sound-pair-15884.ts      5  helper-285b0 / helper-18f46 / helper-11ff8 / …
```

## Finding: a large rename sweep is NOT warranted

The PRD estimated 20–50 renames. But the rule is "rename only if the disasm
header justifies a verified semantic name, else leave it." Applying that to the
central files:

- **Most central files are already semantically named** (`sound-cmd-send`,
  `sprite-project`, `render-score`, `render-string-entry`, `sprite-pos-update`,
  `object-state-entry`, `slot-insert-sorted`, …). Renaming them adds churn, not
  clarity.
- **The remaining generic ones** (`helper-XXXXX`, `state-sub-XXXXX`) mostly have
  headers that just say "replica FUN_XXXXX (N bytes)" with no derivable semantic
  name — exactly the "leave it" case.

So only a few central files have a clear, header-justified better name.

## This PR: 3 high-confidence renames (pattern demonstrated)

| Old | New | Justification (header) |
|---|---|---|
| `helper-11ff8.ts` | `read-abs-byte-11ff8.ts` | "Read a byte from an absolute M68k address — ROM or workRam" |
| `state-sub-1844a.ts` | `read-abs-long-1844a.ts` | "Read long from absolute M68k addr — either ROM or workRam" |
| `state-sub-5200.ts` | `buffer-clear-status-5200.ts` | "Port of FUN_00005200 — buffer clear + status flags OR" |

Each kept the `FUN_xxxx` address in the filename suffix and JSDoc (traceability),
used `git mv` (history preserved — shows as `R` in status), updated all import
paths, and renamed the matching engine unit test. Identifiers (exported function
names) were left unchanged per the PRD (files only).

## Recommendation

Do not force a 20–50 sweep on the central files. Further renames, if desired,
should target **pure-hex non-central** files whose header gives a clear purpose
(e.g. `state-sub-540a.ts` → string-record walker), incrementally, ≤20 per PR,
each grep-checked for stale path string-literals before commit.
