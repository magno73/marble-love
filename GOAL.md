# GOAL — Active Objective

> Goal file root-level. Tutti gli agent e i developer che lavorano nella
> repo leggano questo file PRIMA di iniziare. Sopprime/aggiorna le scelte
> tattiche in conflitto con l'obiettivo dichiarato.

## Active goal

**Concludere il reverse engineering del Level Descriptor Header** seguendo
integralmente `docs/level-header-decode-prd.md`.

Owner sessione corrente: agent su branch `claude/marble-1984-analysis-I0AJ0`.

Stato: open.

## Done when

Il goal e' concluso quando tutti e 7 i success criteria del PRD
(`docs/level-header-decode-prd.md` sezione "Success criteria") sono
soddisfatti:

1. Disasm verificato per ogni offset documentato (citation file:line).
2. MAME tap verificato per ogni offset consumato (run scriptata 6 livelli).
3. Parity test dei 3 consumer esistenti (`FUN_16EC6`, `FUN_16F6C`,
   `FUN_259B4`) restano 500/500.
4. `docs/level-header-format.md` esiste, completo, linkato.
5. `packages/engine/test/level-header-decode.test.ts` + `packages/cli/src/probe-level-header.ts` verdi.
6. `npm test` 1982+N pass, `obj0.x 99/99` invariato, drift workRam @ f+99 invariato.
7. Byte UNKNOWN documentati onestamente (no semantica inventata).

## Coordinamento con Codex

Codex sta lavorando in parallelo sulla codebase (worktree separato, branch
`codex/*` o equivalente). Per evitare merge conflict e proof regression:

### File che questa sessione (level-header-decode) puo' toccare

| Path                                                | Note |
| --------------------------------------------------- | ---- |
| `packages/engine/src/level.ts`                      | Target principale: refactor `LevelHeader` + `HeightRecord`, fix `LEVEL_HEADER_SIZE`. |
| `packages/engine/src/index.ts`                      | **Una sola riga** di export in fondo. Rebase prima del merge. |
| `packages/engine/test/level-header-decode.test.ts`  | File nuovo. |
| `packages/cli/src/probe-level-header.ts`            | File nuovo. |
| `docs/level-header-format.md`                       | File nuovo (deliverable). |
| `docs/level-header-decode-prd.md`                   | Aggiornabile solo per checkpoint (`Status:` + section "Findings"). |
| `oracle/mame_level_header_tap.lua` (se serve)       | File nuovo. |
| `GOAL.md`                                           | Solo per chiudere il goal (`Status: done`). |
| `STATUS.md`                                         | NO. Lo aggiorna Marco al merge. |

### File OFF-LIMITS per questa sessione (territorio Codex / runtime core)

Allineato con `docs/codex-prd.md` regole di non-interferenza:

| Path                                                | Perche' |
| --------------------------------------------------- | ------- |
| `packages/engine/src/main-tick.ts`                  | Runtime orchestrator, modificato da Codex su gate cadence. |
| `packages/engine/src/boot-init.ts`                  | Cold-boot path. Off-limits convenzionale. |
| `packages/engine/src/refresh-frame-10fce.ts`        | Body M68K dispatcher. Tocca lo Codex per chain JSR. |
| `packages/engine/src/state.ts`                      | Interfaccia `GameState`. Modifiche structural rompono Codex. |
| `packages/engine/src/render.ts`                     | Engine->renderer boundary. Modifiche rompono frontend. |
| `packages/engine/src/level-dispatcher-16ec6.ts`     | Consumer bit-perfect del header. **Read-only** per questo task. Se la mia decode contraddice questo consumer, e' la decode sbagliata. |
| `packages/engine/src/level-init-16f6c.ts`           | Idem. |
| `packages/engine/src/object-init-259b4.ts`          | Idem. |
| `packages/engine/src/main-loop-init-*.ts`           | Codex Task A area. |
| `packages/web/src/main.ts`                          | Frontend entry. |
| `STATUS.md`, `README.md`, `HANDOFF_*.md`            | Gestiti da Marco. |

### Regola di conflict resolution

Se questa sessione deve toccare un file off-limits per chiudere il goal:
**stop e flag a Marco**, non procedere. Il goal puo' attendere; un merge
conflict su `main-tick.ts` o `state.ts` no.

## Validation gate (sempre verdi durante e a fine task)

Eseguire prima di ogni commit e prima di chiudere il goal:

```sh
npm run typecheck
npm run test --silent
npx tsc -b
```

Probe non-regressione (vedi `docs/agent-briefing.md` sezione 10):

```sh
npx tsx packages/cli/src/probe-cluster-histogram.ts | head -1
# atteso: total=387 (invariato se non c'e' fix intenzionale gameplay)

npx tsx packages/cli/src/probe-100f-diff.ts | grep "obj0.x"
# atteso: obj0.x bit-perfect 99/99
```

Se uno regredisce: rollback immediato, non avanzare.

## Hard rules (estratto da `CLAUDE.md`)

Per ricordo durante il task:

- **Rule 1 — Think before coding.** State assumptions. Se incerto, ask, non guess.
- **Rule 5 — Use model only for judgment.** Reverse engineering deterministico: usa il disasm + tap MAME, non interpretazione semantica del modello.
- **Rule 8 — Read before write.** Prima di decodare un offset, leggi *tutti* i consumer in TS e ROM.
- **Rule 9 — Tests verify intent.** Un test deve poter fallire se la semantica del campo cambia, non solo se i bit cambiano.
- **Rule 12 — Fail loud.** Un campo UNKNOWN onestamente documentato e' un deliverable valido. Una semantica inventata e' un bug.

## Riferimenti

- PRD del task: `docs/level-header-decode-prd.md`
- Briefing per agent: `docs/agent-briefing.md`
- Coordinamento Codex: `docs/codex-prd.md` (regole non-interferenza)
- Rule template: `CLAUDE.md`
- Context durable: `HANDOFF_CURRENT_CONTEXT.md`

## Chiusura del goal

Quando i 7 success criteria del PRD sono soddisfatti:

1. Marca `Status: done` in cima a questo file (no delete: serve audit trail).
2. Linka il `docs/level-header-format.md` finale da `docs/findings/README.md` se sale a livello di finding, altrimenti da `STATUS.md` come task chiuso.
3. Apri PR (o flag Marco per merge) dal branch della sessione.
4. NON chiudere il goal se anche un solo criterio e' grigio. Vedi Rule 12.

---

Status: **open** — started 2026-05-18 on branch `claude/marble-1984-analysis-I0AJ0`.
