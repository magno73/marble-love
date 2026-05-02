# Prompt — Phase 4: TypeScript skeleton funzionante

**Per Claude Code.**

## Pre-requisito

- Phase 3 chiusa (oracle produce trace deterministici)
- Phase 2 ha identificato RNG + level loader

## Input

- Scaffold engine in `packages/engine/src/` (già pronto)
- `docs/static-overview.md` con info su RNG, main loop, level loader
- `docs/hardware-map.md` per memory map

## Step

### 1. RNG (priorità massima)

In `packages/engine/src/rng.ts`:
- Sostituire lo stub LFSR con la replica esatta dall'analisi Phase 2
- Test in `packages/engine/test/rng.test.ts`: dato lo stesso seed iniziale, le prime 10000 chiamate producono la stessa sequenza dell'oracolo (estrarre da MAME via Lua dumper apposta)

### 2. Bus

In `packages/engine/src/bus.ts`:
- Riempire memory map con i range esatti da `docs/hardware-map.md`
- Implementare `readMmio8`/`writeMmio8` con dispatch reale (input ports, sound mailbox, video ctrl)

### 3. Level loader

In `packages/engine/src/level.ts`:
- Implementare `loadLevel(rom, state, index)` leggendo la pointer table identificata in Phase 2
- NON copiare layout heightmap dal lavoro precedente (`marble-madness-2026`): replicare l'accesso ROM del binario, popolare le RAM regions correttamente

### 4. Tick principale

In `packages/engine/src/index.ts`:
- Ordinare le chiamate del tick come fa il main loop del 68010 (Phase 2)
- Gestire IRQ vsync (incrementare frame counter, swap sprite RAM)

### 5. Marble runner CLI

Far girare:
```bash
npm run marble-runner -- --scenario attract_mode --ticks 100
```

Deve produrre `traces/reimpl_attract_mode.jsonl` valido (anche se diverge da MAME — ce ne occupiamo in Phase 5).

## Output

- [ ] RNG: parità su 10000 chiamate consecutive vs oracolo
- [ ] Bus: tutti gli MMIO documentati da Phase 1 hanno read/write implementato
- [ ] Level loader: livelli 1-6 caricabili (anche se non renderati)
- [ ] CLI runner produce trace JSONL valido per `attract_mode`

## Vincoli

- ESLint custom rule `marble-love/no-raw-arith-on-branded` deve passare (zero warning)
- `npm run typecheck` deve passare clean
- `npm run test` deve passare (test base + rng test specifico)

## Side effects

- Aggiorna `STATUS.md`
- Commit: `phase-4: typescript skeleton + rng parity`
