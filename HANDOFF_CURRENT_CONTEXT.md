# Handoff Current Context

> Legacy note: this handoff is historical and may contain stale baseline
> references. Do not read it by default. Prefer `AGENTS.md`,
> `docs/context-map.md`, `STATUS.md`, and the active task/goal file. Use this
> file only when reconstructing the May 18 seed/runtime safety context.

Repo: `/Users/magnus-bot/Code/marble-love`
Branch: `main`
Date: 2026-05-18

This file was originally a minimum session handoff. It is now historical and
should not replace the current startup docs.

## Read First

Current startup docs:

- `AGENTS.md`
- `docs/context-map.md`
- the active task/goal file, if present

Read `STATUS.md` for current product status. Read `HANDOFF_SIX_LEVELS.md` only
when reconstructing the historical six-level seed investigation.

Work from `/Users/magnus-bot/Code/marble-love` as the writable root. Do not edit
the repo from a Codex workspace outside that root.

## Current Ground Rules

- Do not hardcode or rename `startLevel` seeds unless the seed is distinct,
  playable, controllable active-vs-neutral, and backed by MAME/manual route proof.
- The six ROM level descriptors are delicate. Treat descriptor matching,
  playable seed export, and browser `startLevel` wiring as separate proof gates.
- Prefer ROM/MAME-backed causes over visual or physics patches. If the rendered
  level and collision disagree, prove which emulated routine or memory read is
  wrong before adding a workaround.
- Some broad live-route smoke tests are historical diagnostics. Do not update
  their expectations just to make a run green without re-checking the MAME proof
  behind the route.
- The worktree may contain scratch oracle scripts, captures, screenshots, or
  untracked handoff files from earlier investigations. Do not revert or stage
  unrelated changes silently.

## Recent Pushed Baseline

Latest relevant pushed commit at the time of writing:

- `0eb1cb9 Fix Beginner tube terrain scan`

That commit is a closed bugfix baseline, not an instruction to keep debugging
the same issue.

## Validation Habit

For runtime/collision changes, at minimum run the targeted Vitest files for the
touched subsystem and `npm --workspace @marble-love/web run build`. If a broader
diagnostic test fails, report it with the exact failing expectation instead of
normalizing it without proof.
