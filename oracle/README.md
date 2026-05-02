# Oracle harness — MAME come ground truth

## Cosa fa

Lancia MAME emulando Atari System 1 / Marble Madness, gli inietta input scriptati da uno scenario, dumpa lo stato del game state ogni frame in `traces/oracle_<scenario>.jsonl`.

Schema del trace: definito in [`packages/engine/src/trace.ts`](../packages/engine/src/trace.ts) (variabile `TRACE_SCHEMA_VERSION`). **Lo schema deve combaciare al byte tra Lua dumper e CLI runner.**

## Prerequisiti

- MAME ≥ 0.279 (testato con 0.286). Verifica: `mame -version`.
- ROM `marble.zip` in `roms/` (l'utente la fornisce).
- Lua scripting abilitato in MAME (di default sì in build standard).

## Uso

```bash
# Run base
node --experimental-strip-types oracle/run_oracle.ts \
    --scenario attract_mode --frames 1800

# Path ROM custom
node --experimental-strip-types oracle/run_oracle.ts \
    --scenario level1_no_input --rom-path /path/to/roms

# Output esplicito
node --experimental-strip-types oracle/run_oracle.ts \
    --scenario level1_no_input --out traces/run_001.jsonl
```

## Determinismo

Determinismo MAME è il **prerequisito non-negoziabile** del Phase 3 (PRD §6 acceptance):

```bash
# Stesso scenario, due volte → diff bit-identico
node --experimental-strip-types oracle/run_oracle.ts -s attract_mode -o /tmp/a.jsonl
node --experimental-strip-types oracle/run_oracle.ts -s attract_mode -o /tmp/b.jsonl
diff /tmp/a.jsonl /tmp/b.jsonl   # deve essere vuoto
```

Se il diff non è vuoto, verifica:
- `-throttle 0` / `-nothrottle` attivo (deve esserlo, lo passa il wrapper)
- Niente input asincroni (joystick fisico, mouse) durante il run
- Random seed pinned: TBD in Phase 3 (potrebbe servire patch al Lua dumper per scrivere RAM)

## Inspect manuale

```bash
node --experimental-strip-types oracle/replay_trace.ts traces/oracle_level1_no_input.jsonl --from 0 --to 300
```

## Scenari disponibili

- `attract_mode` — power-on, niente input
- `level1_no_input` — coin/start, livello 1, biglia rotola
- `level1_basic_movement` — coin/start, livello 1, pattern di movimento base

Aggiungere nuovi scenari in `oracle/scenarios/<name>.json`. Format:

```json
{
  "name": "<name>",
  "description": "...",
  "ticks": 600,
  "inputs": {
    "<frame>": { "dx": -5, "dy": 0, "buttons": 0 }
  }
}
```
