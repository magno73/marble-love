# PRD per Codex — Marble Love (porting M68k → TypeScript)

> Documento per dare a Codex (OpenAI Codex CLI / Codex agent) un task ben definito, **senza interferire** col lavoro parallelo che Claude Code sta portando avanti su `main`.

## Contesto in 30 secondi

Stiamo replicando il binario di **Marble Madness** (Atari 1984, hardware Atari System 1, M68010 + 6502) in TypeScript, verificando ogni sub-function bit-perfect contro l'oracolo MAME via [musashi-wasm](https://github.com/dirkfaust/musashi-wasm).

Stato attuale (vedi `STATUS.md` per metriche live):
- **185/314 sub-systems replicati bit-perfect** (~59% del binario)
- Bridge engine ↔ renderer attivo
- Frame 0 (post-bootInit) match bit-perfect vs MAME su tutte le 32 regioni workRam

Approccio attivo su `main`: replica batch da 5 sub-systems alla volta via agent paralleli (Claude Code Task tool con `isolation: "worktree"`). **Ogni batch tocca `packages/engine/src/index.ts`** (linter rebuild). Per Codex, gli assegniamo task che minimizzano il merge conflict su quel file.

---

## Setup Codex (non-interferenza)

```bash
# 1. Crea un worktree per Codex (branch separato)
cd /Users/magnus-bot/Code/marble-love
git worktree add ../marble-love-codex codex-work
cd ../marble-love-codex

# 2. Sync dipendenze
npm install   # o bun install

# 3. Verifica baseline
npm run typecheck
npm run test  # deve essere verde prima di iniziare

# 4. Quando Codex finisce un task, push su un branch e PR (NON merge diretto su main)
git checkout -b codex/<task-name>
git add -A && git commit -m "..."
git push -u origin codex/<task-name>
```

### Regole non-interferenza

| File | Codex può modificare? |
|---|---|
| `packages/engine/src/<NUOVO_MODULO>.ts` | ✅ sì (file nuovo) |
| `packages/engine/test/<NUOVO_MODULO>.test.ts` | ✅ sì |
| `packages/cli/src/test-<NUOVO_MODULO>-parity.ts` | ✅ sì |
| `packages/engine/src/state.ts` | ⚠️ solo per Task B (playfieldRam). Coordina prima con Marco |
| `packages/engine/src/render.ts` | ⚠️ solo per Task B |
| `packages/engine/src/index.ts` | ⚠️ aggiungi UNA riga di export (zona sicura: in fondo, prima di `// Re-export tipi più usati`). Rebase prima del merge |
| `packages/engine/src/main-tick.ts` | ❌ NO (lo gestisce Marco quando integra) |
| `packages/engine/src/boot-init.ts` | ❌ NO |
| `packages/web/src/main.ts` | ⚠️ solo per Task B (renderer integration) |
| `STATUS.md`, `README.md` | ❌ NO (li gestisce Marco) |

Se hai dubbio: **lascialo nel modulo nuovo + parity test, NON integrare in mainTick/bootInit**. Marco fa l'integrazione finale al merge.

---

## Tre task disponibili (scegline UNO)

### Task A — FUN_117B2 main loop init chain ⭐ ALTA PRIORITÀ

**Cosa**: replicare la chain `FUN_117B2 → FUN_1101E / FUN_11452 → FUN_10504 → FUN_10392`. È l'init chain post-boot che popola molto del workRam prima che inizino i tick di gioco. Replicarla in `bootInit` ridurrebbe drammaticamente la divergenza al frame 1 vs MAME.

**Funzioni coinvolte** (analisi via Ghidra prima):

```bash
# Disasm + xrefs
uv run --with pyghidra python3 tools/ghidra_disasm_at.py 0x117B2 | grep -v "no instr"
uv run --with pyghidra python3 tools/ghidra_disasm_at.py 0x1101E | grep -v "no instr"
uv run --with pyghidra python3 tools/ghidra_disasm_at.py 0x11452 | grep -v "no instr"
uv run --with pyghidra python3 tools/ghidra_disasm_at.py 0x10504 | grep -v "no instr"
uv run --with pyghidra python3 tools/find_xrefs.py 0x117B2 0x1101E 0x11452 0x10504
```

**Approccio**: replica una funzione alla volta nel proprio modulo. FUN_10504 e FUN_10392 sono già parzialmente coperti (`slot-array-init.ts` per FUN_10392). Concentrati su FUN_117B2, FUN_1101E, FUN_11452, e completa FUN_10504 (2762 byte — usa stub injection per JSR non replicate).

**File da creare**:
- `packages/engine/src/main-loop-init-117b2.ts` — entry point, orchestratore
- `packages/engine/src/main-loop-init-1101e.ts`
- `packages/engine/src/main-loop-init-11452.ts`
- `packages/engine/src/main-loop-init-10504.ts`
- Per ogni: smoke test in `packages/engine/test/<name>.test.ts` + parity test in `packages/cli/src/test-<name>-parity.ts`

**Pattern di riferimento**: `packages/engine/src/init-level-load-1a236.ts`, `packages/engine/src/scene-init-11428.ts`, `packages/engine/src/state-sub-2c60.ts` (sub-injection per JSR).

**Verifica successo**:
- Per ogni funzione: parity test 500/500 bit-perfect vs musashi-wasm
- `npm run test` totale verde

**Tempo stimato**: 4-8 ore (4 funzioni medie, possibili sub-injection)

---

### Task B — `state.playfieldRam` + renderer integration

**Cosa**: estendere il GameState con `playfieldRam: Uint8Array(0x2000)` (8 KB, mappa hardware @ 0xA00000-0xA01FFF), e fare in modo che `renderer.draw(state)` consumi questa region per renderizzare la playfield tilemap a video.

**Razionale**: attualmente il bridge funziona ma il rendering mostra solo palette + alpha vuota. Non c'è playfield perché lo state non lo modella. Aggiungerlo è prerequisito per "vedere qualcosa di sensato" a video.

**File da modificare**:
- `packages/engine/src/state.ts` — aggiungi field `playfieldRam: Uint8Array` a `GameState`, init a 0x2000 byte zero in `emptyGameState()`
- `packages/engine/src/render.ts` — `buildFrame(state, options)` deve usare `state.playfieldRam` come default per `playfieldRam` opt-in (non più il `Uint8Array` esterno via options); preserva backward-compat tramite override
- `packages/web/src/renderer.ts` — il `draw(state)` deve ora passare lookup tables dal ROM (è già parzialmente fatto). Verifica integrazione
- `packages/engine/test/state.test.ts` — aggiungi test per `playfieldRam` field
- `packages/web/src/main.ts` — opzionale: aggiungi modalità `?engine=2` per forzare render da state reale (default attuale è demo frame in DEV)

**Verifica successo**:
1. `npm run typecheck` clean
2. `npm run test` verde
3. `packages/cli/src/visual-smoke-test.ts` mostra `playfield: ≠ 0 tiles` quando lo state ha contenuto in `playfieldRam`
4. Manual: `npm run dev --workspace @marble-love/web`, carica ROM via UI, verifica che la tilemap si veda (anche solo con dati ROM-derived stub)

**Coordinamento Marco**: dopo PR, Marco integrerà `state.playfieldRam` con i write game-side che le sub-functions replicate dovrebbero fare (FUN_2572 etc.). Tu fornisci solo l'infrastruttura + integrazione renderer.

**Tempo stimato**: 2-4 ore.

---

### Task C — FUN_26F3E (4818 byte late game logic)

**Cosa**: replicare la sub gigantesca `FUN_26F3E` (4818 byte di disasm), conditional sub stubbed in `mainTick.ts` come "lateGameLogic". È il sub più grande ancora aperto. Probabilmente è uno scheduler/dispatcher con molti sub-state.

```bash
uv run --with pyghidra python3 tools/ghidra_dump_range.py 0x26F3E 0x28210 /tmp/fun_26f3e.txt
# Aspettati ~600 righe di disasm. Analizzala incrementalmente.
uv run --with pyghidra python3 tools/find_xrefs.py 0x26F3E
```

**Approccio**: data la dimensione, NON replicarla intera in un colpo. Strategia:
1. Identifica la struttura (switch su byte? loop?)
2. Replica lo skeleton + sub-injection per ogni JSR interno
3. Replica le sub-function chiamate, una per file
4. Parity test progressivo

**File principali**:
- `packages/engine/src/late-game-logic-26f3e.ts` — skeleton + sub-injection
- `packages/engine/src/late-game-sub-<addr>.ts` per ogni JSR sub
- Test parity per ognuno

**Pattern di riferimento**: `packages/engine/src/sound-tick.ts` (wrapper con `SoundTickSubs`), `packages/engine/src/game-state-machine.ts` (state machine con `GameStateMachineSubs`).

**Verifica successo**:
- Skeleton + tutti i sub: parity 500/500
- Smoke test che esegue `lateGameLogic` con state casuale e non crasha

**Tempo stimato**: 8-16 ore.

---

## Tooling pronto

### Differential testing vs binary

```ts
// Template parity test (vedi esempi in packages/cli/src/test-*-parity.ts)
import { createCpu, callFunction, pokeMem, peekMem, disposeCpu } from "./binary-oracle-lib.js";

// 1. Carica ROM (eventualmente patcha sub-functions con rts=0x4E75)
const rom = readFileSync("ghidra_project/marble_program.bin");
// rom[FUN_SUB_ADDR] = 0x4E; rom[FUN_SUB_ADDR + 1] = 0x75;  // patch sub a rts

// 2. Crea CPU oracolo
const cpu = await createCpu({ rom, state });

// 3. Per ogni test case:
//    a. Setup random workRam
//    b. callFunction(cpu, FUN_ADDR, [arg1Long, arg2Long, ...])
//    c. Chiama tua impl TS
//    d. Confronta byte-by-byte le regioni modificate
```

### Pattern noti per JSR non replicate

```ts
// Stub injection nel modulo
export interface MyFunctionSubs {
  fun_xyz?: (state: GameState, arg: number) => void;
}

export function myFunction(state: GameState, subs?: MyFunctionSubs): void {
  // ... logic ...
  subs?.fun_xyz?.(state, someArg);  // chiama solo se fornito
  // ...
}

// Nel parity test: patcha la sub binary con `rts` (0x4E75) o thunk-logger
rom[FUN_XYZ] = 0x4E; rom[FUN_XYZ + 1] = 0x75;
// Nella TS: passa subs={} (default no-op)
```

### Convenzioni M68k

- 68k è **big-endian**: word/long in workRam letti `(buf[off]<<8)|buf[off+1]`
- Args di funzione sempre `long` (32-bit) sullo stack
- `rts` (0x4E75) — return; `rte` (0x4E73) — return from exception (IRQ)
- Per testare IRQ handlers (rte) via callFunction: patcha rte → rts in ROM
- `divu.w` overflow: V flag set, dest invariato (no exception come in altri arch)
- `asl.l #N` con N>=32: result = 0 (M68k specifico)
- `bcc/bhi/bls/bcs`: confronti UNSIGNED. `bge/blt/bgt/ble`: SIGNED. Importante per sub-logic

---

## Workflow consigliato per Codex

```
1. Pick task → leggi questo PRD + docs/static-overview.md
2. Crea branch: git checkout -b codex/<task-letter>-<short-desc>
3. Per ogni funzione/feature:
   a. Disasm via tools/ghidra_disasm_at.py (Ghidra GUI deve essere CHIUSA)
   b. Scrivi modulo TS pure-logic
   c. Smoke test (3+ corner case)
   d. Parity test (500 random cases vs musashi-wasm)
   e. Verifica 500/500 = 100%
4. npm run typecheck + npm run test devono essere verdi
5. Commit atomico (1 funzione = 1 commit, o feature coesa = 1 commit)
6. Push branch + apri PR su GitHub con titolo "[codex] <task>"
7. Tag Marco per review/merge
```

### Cosa NON fare (lessons learned)

- **Non modificare** `packages/engine/src/main-tick.ts` o `boot-init.ts` (Marco gestisce l'integrazione finale)
- **Non chiudere** il Ghidra GUI desktop se ce l'ha aperto (lock conflict). Se incappi nel lock: leggi disasm bytes direttamente dal ROM blob
- **Non sopprimere** divergenze: il parity 500/500 deve essere REALE, no scorciatoie. Se la tua impl differisce dal binary, il binary è corretto e tu sbagli (a parte casi documentati di MMIO non emulato)
- **Non aggiungere** ROM o byte derivati al repo — `roms/` è gitignored
- **Non usare** `Math.random()` o `Date.now()` nel package `@marble-love/engine` (deve essere puro/deterministico)

---

## Sync col main

Ogni 30-60 minuti durante il lavoro lungo:

```bash
git fetch origin
git rebase origin/main
# Risolvi eventuali conflitti su index.ts (di solito banali — adjacent additions)
```

A fine task, prima del PR finale:
```bash
git fetch origin
git rebase origin/main
npm run typecheck && npm run test  # deve essere verde
git push -f origin codex/<task-letter>-<short-desc>
```

---

## Domande?

Aggiungi a `docs/codex-questions.md` (creiamolo se serve) con domande specifiche.

Format:
```md
## Q: <domanda>
**Contesto:** <cosa stai facendo>
**Cosa hai provato:** ...
**Bloccato perché:** ...
```

Marco risponderà via commento PR o nel file stesso.

---

## TL;DR

1. Crea worktree: `git worktree add ../marble-love-codex codex-work`
2. Scegli **un** task: A (main loop init), B (playfield RAM), o C (FUN_26F3E)
3. NON toccare `main-tick.ts`, `boot-init.ts`, `STATUS.md`, `README.md`
4. Tutto in moduli nuovi + parity test 500/500
5. PR su `codex/<task>` quando finito

Buon coding! 🤖
