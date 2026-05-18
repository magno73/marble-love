# Codex Task — Level Header Decode Phase 2

> Continuazione del task "Decode completo del Level Descriptor Header"
> dopo che Phase 1 (statica) e' stata chiusa da Claude Code su branch
> `claude/marble-1984-analysis-I0AJ0` (commit `e7516e3`).
>
> Branch consigliato per Codex: `codex/level-header-decode` (worktree
> isolato).

## Leggi PRIMA, in quest'ordine, e integralmente

1. `CLAUDE.md` (12-rule template — Rule 12 fail loud e' critica qui)
2. `GOAL.md` (active goal, status corrente phase-1-static-done)
3. `docs/agent-briefing.md` (briefing pack: tooling, sub bit-perfect, ipotesi falsificate)
4. `docs/codex-prd.md` (regole di non-interferenza Codex)
5. `docs/level-header-decode-prd.md` (PRD del task con i 7 success criteria)
6. `docs/level-header-format.md` (output Phase 1: cosa e' verificato staticamente)

## Setup branch

```sh
# Sync con il lavoro Phase 1
git fetch origin claude/marble-1984-analysis-I0AJ0
git checkout -b codex/level-header-decode origin/claude/marble-1984-analysis-I0AJ0

# Verifica baseline
npm install
npx tsc -p packages/engine/tsconfig.json --noEmit  # deve essere pulito
npx vitest run packages/engine/test/level-header-decode.test.ts  # 20 pass
npx vitest run packages/engine/test/level.test.ts  # 4 pass + 6 skip
```

Se la baseline non e' verde, **stop e flag Marco** — Phase 1 deve
restare invariata prima di iniziare.

## Ambiente richiesto

Phase 2 richiede tooling che non era disponibile nel container di
Phase 1:

| Tool | Uso | Verifica |
| ---- | --- | -------- |
| ROMs (`roms/marble.zip` + `roms/atarisy1.zip`) | Tutti i deliverable | `ls roms/*.zip` |
| MAME 0.286+ | Lua taps | `mame -version` |
| Ghidra 12 + `tools/ghidra_*.py` | Disasm xref | `ghidra_project/marble_program.bin` esiste |
| musashi-wasm | Parity test | `node_modules/musashi-wasm/` presente dopo npm install |
| Python 3.11 + PyGhidra | `tools/ghidra_*.py` | `uv tool list` mostra pyghidra |

Se uno manca: **stop e flag Marco**, non simulare ne' ignorare. Phase 2
non e' fattibile senza ambiente completo.

## Deliverable

Cinque blocchi, eseguibili in parallelo dove non c'e' dipendenza
diretta. Ogni blocco ha checkpoint esplicito.

### Deliverable 1 — MAME tap su 6 livelli (PRD Passo 3)

`oracle/mame_level_header_tap.lua` esiste gia' (ready-to-run, scritto in
Phase 1). Lancia su tutti e 6 i livelli usando il workflow
`MARBLE_PLAYABLE_BOOTSTRAP_TARGET_LEVEL=1..6` documentato in
`docs/archive/readme-status-2026-05-18/README.full.md:166-176`.

```sh
for L in 1 2 3 4 5 6; do
  MARBLE_PLAYABLE_BOOTSTRAP_TARGET_LEVEL=$L \
  MARBLE_LEVEL_TAP_OUTPUT=/tmp/marble-level-header-tap-L${L}.log \
  MARBLE_LEVEL_TAP_INDICES=$((L-1)) \
  ./oracle/run-mame.sh marble \
    -autoboot_script oracle/mame_level_header_tap.lua
done
```

**Verifica obbligatoria per ogni livello:**

- Ogni field documentato in `docs/level-header-format.md` produce
  almeno un read FRAME=... nel log.
- VALUE letto coincide con il bytes ROM letto dal probe TS (Deliverable
  2). Se discrepanza → bug nella decode statica Phase 1, **stop e fail
  loud**.

Checkpoint: aggiorna `GOAL.md` con `Status: phase-2-tap-done` + lista
dei 6 log file generati.

### Deliverable 2 — Probe ROM dump (verifica statica vs reale)

Genera `ghidra_project/marble_program.bin` se manca:

```sh
python3 tools/rom_prep.py
```

Esegui il probe scritto in Phase 1:

```sh
npx tsx packages/cli/src/probe-level-header.ts > /tmp/marble-headers.txt
```

Comparalo con i log MAME del Deliverable 1. Output atteso: per ogni
livello, il VALUE del tap MAME al PC del consumer noto coincide con il
field decoded dal probe. Salva il diff/comparazione come
`/tmp/marble-headers-vs-tap.diff`.

Checkpoint: `Status: phase-2-probe-done`.

### Deliverable 3 — Decode dei field UNKNOWN restanti (PRD Passo 4)

Field aperti dopo Phase 1 (documentati in `docs/level-header-format.md`
sezione "Aperture residue"):

#### 3a. `+0x08` (long): nessun consumer noto in attract/playable

Strategia:
1. Tap MAME esteso a path post-victory, mode 2/3, e high-score.
2. Xref Ghidra: cerca tutti i `move.l (0x8,A1)` o `move.l (0x8,An)` nel
   binario disassemblato (`tools/ghidra_dump_range.py`).
3. Se nessun consumer trovato dopo coverage estesa: marca esplicitamente
   `UNKNOWN — verified no consumer on all tested paths (attract +
   playable + post-victory + high-score)`. Rule 12 fail loud: non
   inventare semantica.

#### 3b. `+0x24..0x25` (word): probabile padding

Strategia identica al 3a. Candidato dominante: padding di allineamento
tra `+0x20` (long) e `+0x26` (long). Verifica con xref Ghidra che nessun
PC legge a quegli offset.

#### 3c. `+0x1A..0x1F` (entity init pos 3..5 se mai attive)

Tap MAME con scenario che attivi entity 3..5 (obj+0x18 == 3 per quegli
indici). Se mai osservato, decoda. Se mai osservato, marca
`UNKNOWN — entity 3..5 not active in any tested scenario`.

#### 3d. Height records word 1, 2, 3 (UNKNOWN)

Strategia:
1. Tap MAME sui PC della fisica marble (`helper-1cd00.ts`,
   `bbox-hit-test-19d94.ts`, `helper-121b8.ts`) che leggono i record
   post-`binsearchBasePtr`.
2. Identifica i PC che leggono `record + 2/4/6` (offset interni dei
   words 1, 2, 3).
3. Reversa la semantica via Ghidra disasm a quei PC.
4. Aggiorna `HeightRecord` interface in `packages/engine/src/level.ts`
   con i field decoded.

Per ogni nuovo field decodato:
- Aggiorna `docs/level-header-format.md` con citation file:line + tap
  evidence (FRAME, PC, valore atteso).
- Aggiorna `LevelHeader` o `HeightRecord` in `level.ts`.
- Aggiorna i test in `packages/engine/test/level-header-decode.test.ts`.

Checkpoint: `Status: phase-2-decode-done` quando tutti i field aperti
sono o decodati o marcati UNKNOWN-verified.

### Deliverable 4 — Parity test musashi-wasm (PRD Passo 5)

File: `packages/cli/src/test-level-header-decode-parity.ts`.

Pattern di riferimento: `packages/cli/src/test-init-level-load-1a236-parity.ts`
(parity test con musashi-wasm + sub-injection callback).

Il test deve:
1. Caricare i 6 header reali dalla ROM.
2. Per ogni header, eseguire `decodeLevelHeader` (TS) e raccogliere i
   field.
3. Eseguire il binario originale via musashi-wasm su una sub-routine che
   legge il header (es. `FUN_16EC6` con setup minimale dei pointer).
4. Verificare che 500 random ROM-region inputs producano match
   bit-perfect dei field osservabili (timer/scroll write a `0x40097c`,
   binsearch write a `0x40065a`, ecc.).

Target: 500/500 PASS per ognuno dei 3 consumer del header
(`FUN_16EC6`, `FUN_16F6C`, `FUN_259B4`).

Se uno dei 3 consumer non passa 500/500 dopo Phase 1 (il refactor di
`LevelHeader` typing): **stop e fail loud**, il refactor di Phase 1 ha
rotto qualcosa.

Checkpoint: `Status: phase-2-parity-done` con i tre file di risultato
500/500 in `runs/level-header-parity-{16ec6,16f6c,259b4}.txt`.

### Deliverable 5 — Validation gate finale (PRD Passo 6)

Prima di chiudere il goal, esegui e verifica invariato:

```sh
# Suite completa
npm test  # atteso: 1982 + N nuovi pass

# Drift workRam @ f+99
npx tsx packages/cli/src/probe-cluster-histogram.ts | head -1
# atteso: total=387 (invariato)

# obj0.x bit-perfect 99/99
npx tsx packages/cli/src/probe-100f-diff.ts | grep obj0.x
# atteso: obj0.x TS=... MAME=... ✓ su tutti i 99 frame

# Typecheck completo
npx tsc -b  # exit 0

# ESLint
npx eslint packages/  # exit 0 (no violazioni branded-arith)
```

Se uno regredisce: **rollback non avanzare** (Rule 12).

Checkpoint finale: `Status: done` quando tutti i 7 success criteria del
PRD sono soddisfatti.

## Hard rules

Estratto operativo da `CLAUDE.md` e `GOAL.md`:

### File modificabili

| Path | Modifica? |
| ---- | --------- |
| `packages/engine/src/level.ts` | si (extension del typing per nuovi field) |
| `packages/engine/test/level-header-decode.test.ts` | si (test per nuovi field) |
| `packages/engine/src/index.ts` | una sola riga di export per il parity-test, in fondo |
| `packages/cli/src/test-level-header-decode-parity.ts` | si (file nuovo) |
| `docs/level-header-format.md` | si (aggiungere field decoded + UNKNOWN verified) |
| `docs/level-header-decode-prd.md` | si (solo checkpoint section + status update) |
| `oracle/mame_level_header_tap.lua` | si (extend taps se serve) |
| `GOAL.md` | si (status checkpoint update) |

### File OFF-LIMITS

Allineati con `GOAL.md`:

- `packages/engine/src/main-tick.ts`
- `packages/engine/src/boot-init.ts`
- `packages/engine/src/refresh-frame-10fce.ts`
- `packages/engine/src/state.ts`
- `packages/engine/src/render.ts`
- `packages/engine/src/level-dispatcher-16ec6.ts`
- `packages/engine/src/level-init-16f6c.ts`
- `packages/engine/src/object-init-259b4.ts`
- `packages/engine/src/main-loop-init-*.ts`
- `packages/web/src/main.ts`
- `STATUS.md`, `README.md`, `HANDOFF_*.md`

I 3 consumer del header (`level-dispatcher-16ec6.ts`,
`level-init-16f6c.ts`, `object-init-259b4.ts`) sono **read-only** per
questo task. Se la tua decode contraddice il loro comportamento, e' la
decode sbagliata.

### Regola di conflict resolution

Se per chiudere un deliverable serve toccare un file off-limits:
**stop e flag Marco**, non procedere. Il goal puo' attendere; un
merge conflict su `main-tick.ts` no.

### Tooling vietato

- **NO patch al binario** per testare ipotesi. Solo letture / taps /
  xref.
- **NO modifica di parity test esistenti** per "farli passare". Se la
  decode rompe un consumer, e' la decode sbagliata.
- **NO Un campo UNKNOWN inventato.** Rule 12: meglio "verified no
  consumer observed" che "candidate = X" senza prove.

## Reverse engineering scoperto in Phase 1 — da non re-investigare

Per evitare di replicare il lavoro statico gia' fatto:

- **`LEVEL_HEADER_SIZE = 0x2E`** (non 36): verified, non re-indagare.
- **`+0x10` e' Y scroll base, NON un timer**: il naming
  `LEVEL_TIMER_OFF` in `level-dispatcher-16ec6.ts:26` e' un misnomer.
  Cinque consumer indipendenti confermano semantica scroll (vedi
  `docs/level-header-format.md` per la lista).
- **`+0x18` overlap** con `entityInitPositions[2]`: in attract/playable
  solo i=0,1 sono attivi, quindi non collide. Phase 2 deve verificare
  empiricamente che nessun path attivi i=2 con state==3 — se lo fa,
  e' un caso di "semantici dimensionalmente incompatibili" da
  documentare.

## Chiusura del goal

Il task e' completato quando:

1. I 7 success criteria del PRD (`docs/level-header-decode-prd.md`
   sezione "Success criteria") sono tutti soddisfatti.
2. `GOAL.md` marcato `Status: done` (no delete: audit trail).
3. `docs/level-header-format.md` linkato da `docs/findings/README.md`
   come finding HN-pubblicabile (se sale al livello di finding) o da
   `STATUS.md` come task chiuso.
4. PR aperta solo dopo review Marco — questo branch tocca
   infrastructure cross-cutting (`level.ts` typing) e il merge deve
   passare da lui.

## Estimate

Phase 2 richiede l'ambiente con ROMs/MAME/Ghidra/musashi-wasm. Con
ambiente completo:

- Deliverable 1+2 (tap + probe + comparison): 1-2 giorni.
- Deliverable 3 (UNKNOWN decode): 3-7 giorni. Dipende da quanti field
  hanno consumer trovabili.
- Deliverable 4 (parity): 1-2 giorni per scrivere + verificare 500/500.
- Deliverable 5 (validation gate): 0.5 giorno.

Totale: **5-10 giorni** focalizzati di un agent o developer competente.

Se l'estimate scende sotto 2 giorni significa che stai saltando la
verifica differenziale o non hai eseguito Deliverable 1 (tap reale) —
**flag come red flag**.
