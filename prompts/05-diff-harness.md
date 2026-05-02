# Prompt — Phase 5: differential testing harness

**Per Claude Code.**

## Pre-requisito

- Phase 4 chiusa (CLI runner produce trace valido)

## Input

- `harness/diff.ts` (già scritto)
- `harness/report.ts` (già scritto)
- `harness/run_compare.sh` (già scritto)

## Step

1. Verifica che il diff funzioni manualmente:
   ```bash
   ./harness/run_compare.sh attract_mode
   ```
   Deve produrre `traces/divergence_attract_mode.json` con primo frame divergente identificato.

2. Aggiungi al diff:
   - Hash work-RAM mismatch detection (richiede che oracle Lua dumper lo emetta)
   - Tolleranza zero su tutti i campi numerici (no float-rounding)
   - Categorizzazione automatica del sottosistema sospetto (già abbozzata, raffinare)

3. Integrazione con la curriculum:
   - `harness/curriculum.ts` (NUOVO): legge `curriculum.yaml`, ordina per priorità, esegue `run_compare.sh` su ogni scenario, raccoglie risultati in `runs/<timestamp>.md`

4. Edge case:
   - Trace truncato (oracle si ferma prima di reimpl o viceversa)
   - Schema version mismatch (deve fallire forte, già implementato)
   - File JSONL corrotto

## Output

- [ ] `harness/curriculum.ts` operativo
- [ ] Singolo comando `npm run compare attract_mode` → report markdown
- [ ] Test in `harness/test/diff.test.ts` su trace fittizi (verifica che la rilevazione del primo divergente sia corretta)

## Vincoli

- Performance: il diff deve scalare a 10000+ frame (linear scan, non O(n²))
- Non normalizzare mai un trace per "mascherare" divergenze (PRD §10)

## Side effects

- Aggiorna `STATUS.md`
- Commit: `phase-5: differential harness end-to-end`
