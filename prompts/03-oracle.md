# Prompt — Phase 3: MAME oracle harness

**Per Claude Code.**

## Pre-requisito

- MAME 0.279+ installato
- ROM `roms/marble.zip` valida
- `docs/hardware-map.md` per gli indirizzi RAM del game state

## Input

- Lo scaffold di `oracle/mame_dumper.lua` (già scritto da Phase 0)
- `oracle/run_oracle.ts` (già scritto)
- Scenari in `oracle/scenarios/*.json`

## Step

1. Verifica che MAME giri con la ROM:
   ```
   mame marble -window -nothrottle -seconds_to_run 5
   ```
   Deve avviarsi senza errori.

2. Aggiorna gli indirizzi placeholder (`ADDR_RNG_SEED`, `ADDR_MARBLE_*`, ...) in `oracle/mame_dumper.lua` con i veri indirizzi RAM identificati in Phase 1+2.

3. Implementa iniezione input scriptato dal file scenario JSON. Cercare in MAME Lua API: `manager.machine.ioport.ports[":INPUTS"].fields[":COIN1"]:set_value(1)` o equivalente.

4. Verifica determinismo (acceptance criterion del PRD):
   ```bash
   ./harness/run_compare.sh attract_mode
   # Lancia oracle 2 volte, diff i due trace → deve essere vuoto
   ```

5. Aggiungi hash work-RAM al record per-frame (xxhash32 o crc32). Permette di rilevare divergenze ovunque senza dumpare 16K/frame.

## Output

- [ ] `oracle/mame_dumper.lua` con indirizzi reali e input injection
- [ ] Determinismo verificato (2 run = 2 trace bit-identici)
- [ ] Tutti gli scenari del curriculum producono trace validi
- [ ] `oracle/README.md` aggiornato con eventuali tweak runtime

## Vincoli

- Mai usare `os.time()` o `math.random()` nel Lua dumper (deve essere deterministico)
- Se MAME non rispetta il determinismo (improbabile, ma): escalation, valutare patch a MAME o pinning seed via RAM write

## Side effects

- Aggiorna `STATUS.md`
- Commit: `phase-3: mame oracle harness functional`
