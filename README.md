# Marble Love

> Reimplementazione TypeScript di **Marble Madness** (Atari, 1984, hardware Atari System 1, M68010 + 6502), verificata frame-by-frame contro MAME come oracolo.

**Status:** Phase 4d in corso — **103/314 sub-systems bit-perfect (33% del binario)**. Vedi [`STATUS.md`](./STATUS.md).
**PRD:** [`marble-love-prd-v0.2.md`](./marble-love-prd-v0.2.md).
**License:** MIT (codice originale). Le ROM **non** sono incluse né distribuite — l'utente fornisce le proprie.

## Avanzamento Phase 4d (replication bit-perfect)

| Categoria | Status |
|---|---|
| **Root game-logic CORE** | ✅ 4/4 replicati (`trackballInputTick`, `gameTickTimers`, `gameMainGate`, `gameStateMachineTick`) |
| **State machine schedulers** | ✅ Stati 1, 2, 3, 4, 5/6, 7 tutti coperti |
| **Funzioni totali** | 314 (escludendo 29 thunks) |
| **Replicate bit-perfect** | **103** (33%) |
| **Differential test cases** | >35.000 random cases passati al 100% |
| **Vitest** | 215/215 pass |

**Tecniche differential testing (Phase 4d, per-funzione)**:
- ROM-blob caricato in **musashi-wasm** (M68k emulator) come oracolo per-funzione
- Random input setup → `callFunction(addr)` sul binario + chiamata TS reimpl in parallelo
- Compare bit-perfect su workRam / colorRam / spriteRam / alphaRam regions
- Patch ROM (es. `rts` immediate) per stubbare sub-functions HUD/sound non ancora replicate
- Spin-loop patching (`bne` → `bra`) per evitare hang in test deterministici

**Phase 5+ (futuro)**: trace-level testing con MAME come oracolo (vedi sezione sotto).

## Architettura

```
ORACOLO (MAME + Lua) ──▶ trace_truth.jsonl
                                            │
                                            ▼
                            DIFFERENTIAL HARNESS ──▶ divergence_report.json
                                            ▲                    │
                                            │                    ▼
REIMPLEMENTAZIONE TS  ──▶ trace_reimpl.jsonl     Claude Code (hill-climbing)
```

## Packages (monorepo)

| Pacchetto | Ruolo |
|---|---|
| `@marble-love/engine` | Core logic puro: bus, physics, AI, RNG, level, render-adapter, audio-stub, state. No DOM. |
| `@marble-love/cli`    | Bun/Node runner (`marble-runner`) per produrre trace JSONL dallo stesso scenario dell'oracolo. |
| `@marble-love/web`    | Vite + PixiJS shell. ROM file picker locale. PWA installabile. |
| `@marble-love/mobile` | Capacitor wrapper (V2). |

## Quickstart sviluppo

```bash
# 1. Install (preferito Bun, ma npm funziona)
npm install        # oppure: bun install

# 2. Typecheck tutto il monorepo
npm run typecheck

# 3. Test
npm run test

# 4. Lint (custom rule per branded numeric types)
npm run lint

# 5. Web dev server (Phase 7+)
npm run dev --workspace @marble-love/web
```

## Differential testing (cuore del progetto)

### Test per-funzione (Phase 4d)

Per ogni sub-system replicato, esiste un test `packages/cli/src/test-*-parity.ts` che:
1. Setup random workRam state in entrambi (musashi-wasm + TS state)
2. Chiama la funzione binaria + la TS reimpl
3. Confronta byte-by-byte le regioni di memoria modificate

```bash
# Esempi di run (200/500/1000+ casi random per ogni test)
npx tsx packages/cli/src/test-game-tick-timers-parity.ts 2000
npx tsx packages/cli/src/test-game-main-gate-parity.ts 1000
npx tsx packages/cli/src/test-game-state-machine-parity.ts 3000
npx tsx packages/cli/src/test-trackball-input-parity.ts 2000
# ...e ~80 altri test parity
```

### Trace-level testing (Phase 5+, future)

Vedi [`harness/README.md`](./harness/README.md) e [`oracle/README.md`](./oracle/README.md).

```bash
# Dump trace ground-truth da MAME
npm run oracle -- --scenario level1_no_input

# Run reimpl sullo stesso scenario
npm run marble-runner -- --scenario level1_no_input

# Diff e report
npm run compare -- level1_no_input
```

## ROM

Le ROM **non sono fornite**. L'utente deve possederle legalmente (PCB di proprietà, dump personale ecc.) e metterle in `roms/` (gitignored). Vedi [`docs/rom-layout.md`](./docs/rom-layout.md).

## Riferimenti

1. https://phulin.me/blog/simtower
2. https://github.com/phulin/reaper
3. https://garryslist.org/posts/ai-just-ported-simcity-in-4-days-without-reading-the-code
4. https://banteg.xyz/posts/crimsonland/
5. MAME source `src/mame/atari/atarisy1.cpp`
