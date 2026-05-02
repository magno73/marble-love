# Prompt — Phase 2: static analysis (Ghidra + reaper)

**Per Claude Code (autonomo).**

## Pre-requisito

- Ghidra 12.0.4 installato (formula brew). Wrapper progetto-locale a `tools/ghidra_headless.sh` (imposta JAVA_HOME a OpenJDK 21).
- `uv` installato per PyGhidra (verificare con `which uv`; se manca: `brew install uv`)
- Phase 1 chiusa (`docs/hardware-map.md` completa)

## Input

- ROM `roms/marble.zip` (utente fornisce)
- Documentazione Phase 1 in `docs/`

## Step

1. Lanciare `python3 tools/rom_prep.py --rom-zip roms/marble.zip --out ghidra_project/marble_program.bin`. Se `DEFAULT_PAIRS` è vuoto in `tools/rom_prep.py`, riempirlo con i nomi file letti da `atarisys1.cpp` ROM_START(marble) (output Phase 1).
2. Aprire un Ghidra project headless. Esempio:
   ```bash
   ./tools/ghidra_headless.sh ghidra_project marble \
       -import ghidra_project/marble_program.bin \
       -processor 68000:BE:32:default \
       -loader BinaryLoader \
       -loader-baseAddr 0x000000
   ```
   - Memory map riflesso da `docs/hardware-map.md`
   - Vector table parsato (entry point = reset vector)
3. Auto-analysis completa (passa `-analysisTimeoutPerFile 600`)
4. Setup `reaper`:
   - `git clone https://github.com/phulin/reaper` (in directory esterna al repo)
   - Configurare puntando a `ghidra_project/`
   - Run: prima passata di naming sulle top 50 funzioni più chiamate
5. Riempire `docs/static-overview.md`:
   - Main loop (indirizzo + struttura)
   - ISR (vsync, scanline, sound)
   - **RNG** (priorità massima — chiudere il prima possibile)
   - Level loader (pointer table, header format)

## Output

- [ ] `ghidra_project/` popolato (gitignored)
- [ ] `docs/static-overview.md` riempito (≥80% funzioni chiamate >5 volte hanno nome semantico)
- [ ] Identificata posizione esatta della funzione RNG e algoritmo
- [ ] Identificata pointer table dei livelli

## Vincoli

- Niente modifiche al codice TS in questa fase. Solo analisi e documentazione.
- Se reaper si blocca per >2 ore → escalation in `BLOCKED.md`.

## Side effects

- Aggiorna `STATUS.md`
- Commit: `phase-2: static analysis foundation`
