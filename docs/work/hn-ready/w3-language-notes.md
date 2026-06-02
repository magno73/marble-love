# W3 — Language unification notes (working note, do not publish)

Audit date: 2026-06-02.

## Emergent finding: the PRD undercounted the Italian

The PRD W3 estimated "~8 files, 0.5 day" using a narrow spy-word list
(`uso|fallisce|sostituisce|simile a|tre fasi|però|infatti|quindi`). The real
extent is much larger: a broader detection (`usa, viene, della, chiama, esegue,
cicli, entrambi, coprire, negativi, …`) found **~200 Italian comment lines across
~90 files**. The bilingual comments are pervasive in the per-function parity-test
and probe tools under `packages/cli/src`.

## What this PR does

- **`packages/engine/src` and `packages/web/src`: fully translated to English**
  (0 Italian comment lines by the broad detector). This is the HN-visible core.
- **PRD acceptance met repo-wide**: the PRD's spy-word grep returns 0 over
  `packages/*/src oracle harness`.
- Disasm headers, ROM addresses, `FUN_xxxx` names, and opcode tables were left
  intact; only prose was translated.
- ~101 files changed.

## Residual (recommended follow-up)

`packages/cli/src` still has ~70 Italian comment lines in ~38 maintainer-only
probe/parity-test tools (README: "intended for maintainers rather than casual
users"). These use a wider Italian vocabulary outside the PRD's spy-word list
(`coprire, negativi, neutralizzare, copia, il resto, due volte, …`). They do not
affect the public engine surface and are lower priority for HN; a follow-up pass
should finish them. No `HACK`/`FIXME`-in-Italian comments were found, so nothing
was left deliberately untranslated for that reason.
