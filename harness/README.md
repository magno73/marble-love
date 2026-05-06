# Harness — Differential testing

## Modello mentale

```
trace_truth.jsonl  ──┐
                     ├─►  diff.ts  ──►  divergence_<scen>.json  ──►  report.ts
trace_reimpl.jsonl ──┘
```

Il **primo frame divergente** e il **primo campo divergente** sono il segnale fondamentale del loop di hill-climbing (Phase 6 del PRD). Ogni iterazione di Claude Code dovrebbe ridurre l'indice di quel frame (parità che cresce) o eliminarlo del tutto.

## Pipeline end-to-end

```bash
./harness/run_compare.sh attract_mode
```

Step:
1. `oracle/run_oracle.ts` lancia MAME con il Lua dumper → `traces/oracle_<scen>.jsonl`
2. `packages/cli/src/marble-runner.ts` esegue il reimpl → `traces/reimpl_<scen>.jsonl`
3. `harness/diff.ts` confronta → `traces/divergence_<scen>.json`
4. `harness/report.ts` produce markdown leggibile da umano e da LLM

## Output di `diff.ts`

```jsonc
{
  "scenario": "level1_no_input",
  "parity": 0.058,                 // 0..1
  "framesCompared": 600,
  "fromFrame": 0,                  // (opzionale) frame dal quale si confronta
  "firstDivergence": {
    "frame": 35,
    "fields": ["marble.vx", "marble.x"],
    "annotated": ["marble.vx", "marble.x"],   // campi tradotti per leggibilità
    "truth":  { "f": 35, "marble": { "vx": 12, ... }, ... },
    "reimpl": { "f": 35, "marble": { "vx": 0,  ... }, ... }
  },
  "contextFramesBefore": [...],
  "suspectedSubsystem": "physics"
}
```

`suspectedSubsystem` è euristico (mappa nome campo → modulo). Utile per orientare il fix successivo, non vincolante.

### Schema v2: `workRamHashes` regional

Schema v2 (`TRACE_SCHEMA_VERSION = 2`) aggiunge `workRamHashes`: array di 32 CRC32, uno per regione di 0x100 byte. Quando il diff trova una divergenza in una regione, `annotated` riporta `workRam[0x300..0x3ff]` invece del generico `workRamHash`. Permette di puntare al sub-system specifico molto più velocemente.

Backward-compat: una oracle trace v1 + reimpl v2 produce un warning ma il diff continua usando il `workRamHash` globale.

### Flag utili

- `--from-frame N` salta i primi N frame nella comparazione (utile per ignorare la transitoria di boot MAME, frame 0-5 in attract_mode).

## Curriculum

Vedi [`curriculum.yaml`](./curriculum.yaml). Phase 6 attacca uno stage per volta in ordine di priorità.

## Loop di hill-climbing (riassunto Phase 6)

```pseudo
while curriculum.has_pending():
    scen = curriculum.next()
    while parity(scen) < 100%:
        run compare(scen)
        if no_progress for 3 iter:
            write BLOCKED.md, escalate to Marco
            break
        analyze divergence_report.json
        fix engine source (cite ghidra/mame line)
        commit
    if parity(scen) == 100%:
        curriculum.close(scen)
```
