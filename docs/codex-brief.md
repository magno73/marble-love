# Codex briefing — Marble Love drift residuo

> Brief per agent ChatGPT Codex CLI. Stato sessione 2026-05-12.
> Obiettivo: ridurre drift gameplay workRam da 204B verso 0B.

## 1. Repo

```
/Users/magnus-bot/Code/marble-love/
git branch: feature/visual-pixel-match
git remote: github.com/magno73/marble-love (push abilitato)
ultimo commit: ddee46a
```

Stack: TypeScript 5.x strict, monorepo npm workspaces (`packages/engine`,
`packages/cli`, `packages/web`, `packages/mobile`), vitest, MAME 0.286 come
oracolo, Ghidra 11.x per disasm M68K.

## 2. Obiettivo del progetto

Replica TypeScript **bit-perfect** di Marble Madness (Atari 1984, Atari
System 1, M68010 @ 7.16 MHz + 6502 audio). Validazione: ad ogni tick TS,
ogni byte di workRam (8KB) deve matchare il corrispondente snapshot MAME.
Ground truth in `/tmp/mame_100f.json` (100 snapshot da frame 12000 a
12099 attract mode).

## 3. Stato attuale (drift @ f+99)

```
total          = 376 byte
├─ 172B stack-residue (escluso da invariante via trace.ts/oracle/mame_dumper.lua)
└─ 204B gameplay (target residuo)
```

obj0.x bit-perfect 99/99 MAME ✓. Marble visibilmente si muove con
`?play=1` per 99 frame (= 1.65s), poi degrada catastroficamente
(obj0.z → 0 → marble fuori viewport).

## 4. Comandi essenziali

```bash
# Drift attuale
npx tsx packages/cli/src/probe-cluster-histogram.ts | head -10

# obj0.x parity (= deve restare 99/99)
npx tsx packages/cli/src/probe-100f-diff.ts | tail -3

# Test suite
npx vitest run --reporter=basic

# Typecheck
npx tsc -b

# Rigenera ROM blob (se modifichi rom_prep.py)
python3 tools/rom_prep.py --rom-zip roms/marble.zip --bios-zip roms/atarisy1.zip --out ghidra_project/marble_program.bin

# MAME tap (esempio)
MARBLE_TRACE_FROM=11998 MARBLE_TRACE_TO=12010 \
  mame marble -window -nothrottle -skip_gameinfo -seconds_to_run 220 \
  -rompath roms -autoboot_script oracle/<tap-name>.lua -autoboot_delay 0
```

## 5. CLAUDE.md 12-rule (= aderire sempre)

Rule 1 Think before. Rule 2 Simplicity. Rule 3 Surgical. Rule 4
Goal-driven. Rule 5 Model only for judgment. Rule 6 Token budget non
advisory. Rule 7 Surface conflicts. Rule 8 Read before write. Rule 9
Tests verify intent. Rule 10 Checkpoint after step. Rule 11 Match
conventions. **Rule 12 FAIL LOUD** — se ipotesi sbagliata, dichiaralo.

## 6. Cascade chain VERIFIED empiricamente

```
[NOT identified] sub upstream
   → cluster 0x0a00 (P2 slot pair @ 0xA20..0xA9B) drift +15B
      → cluster 0x0640 velocity globals (stateDispatch160F6) +12B
         → marble.vx accumula divergenza
            → srtgt -1 unit a f+56 (TS=0xffffc1b7, MAME=0xffffc1b8)
               → scrollIdx differente body 28+
                  → decoder produce output divergente
                     → cluster 0x0700 esplode 33B@f+58 → 63B@f+99
```

**Fix UNA sub upstream → cascade chiude ~91B**. Non identificato in 13
tentativi (vedi sezione 7).

## 7. Ipotesi gia' FALSIFICATE (Rule 12, NON ripetere)

1. **Consumer di `*0x400006` mancante** → byte boolean self-contained
2. **Drift P2.slot0 inizia f+68 su x_long** → inizia tick 2 su lock_flag
3. **Secondo callsite JSR 158F6** → unico callsite ROM
4. **Cadenza dinamica 30/60Hz MAME** → MAME 30Hz puro (49 bodies in 100 frame)
5. **Wire 30 sub stack-heavy chiude 0x1D40** → 430 PC distinti, top-1=6%
6. **SUB_CYCLE_ESTIMATE calibration** → behavior-correct anche se magnitude-wrong
7. **"obj2 struct" misnomer** → era scene-obj rect-list (32 slot × 14B)
8. **Phase-flip body 30Hz** → drift sale (+55B), obj0.x diverge
9. **Stack residue 172B** → escluso da invariante (effetto compilatore C)
10. **obj0.z stuck → screenX cascade** → wire helper121B8 per tutti obj no-op
11. **Cluster 0x0700 intrinseco decoder** → decoder bit-perfect, e' cascade
12. **`sub1CABA` produce STRUCT=0 runtime** → bit-perfect (con bank=1)
13. **Wire `fun_1bab2` per tutti obj** → canonical applicato, drift invariato

## 8. Sub TS verificate bit-perfect (NON re-investigare)

Parity test 100% o probe runtime conferma:

- `decodeBitstream1A668` (parity 500/500 + runtime body 1)
- `sub1CABATileRedraw` (3/3 attract con `SLAPSTIC_BANK=1`)
- `spriteProject1CC62` (formula verified vs disasm M68K)
- `spritePosUpdate1BAB2` (logic verified)
- `spriteHelper1B9CC` (writes obj+0x1e/+0x22/+0x26 packed)
- `helper121B8` (chain canonical wired)
- `objectScanDispatch251DE` (= FUN_251DE wired)
- `objectUpdatePair158CC` + `fun158F6` (P1/P2 dispatcher)
- `lateGameLogic26F3E` (100/100 escluso wrapper artifact 0x39a)
- `bufferFill1B12A` (parity in repo)
- `regfile.ts` 8 istruzioni stack ABI (Tom Harte 2879/2879)
- `slapstic 137412-103 FSM` (11/11 vitest)

## 9. Sub TS NON verificate direttamente (= candidate per drill)

Mai verificate bit-perfect runtime:

- **`stateDispatch160F6`** — scrive cluster 0x0640 velocity globals.
  File `packages/engine/src/state-dispatch-160f6.ts`. Cluster 0x0640
  drift +12B inizia tick 2. **PRIMO CANDIDATE.**
- **`helper182BA`** — invocata in chain `fun158F6` ELSE branch.
- **`helper25C74`** — invocata in path specifico stateDispatch.
- **Chain `fun158F6(P2_slot)`** completa — non testata isolata su input
  attract reale.
- **`helper253BC`** — wired in path C ma non testato bit-perfect runtime.

## 10. File chiave per drill

```
packages/engine/src/state-dispatch-160f6.ts (508 righe — TOP CANDIDATE)
packages/engine/src/helper-182ba.ts
packages/engine/src/helper-25c74.ts
packages/engine/src/sub-158f6.ts
packages/engine/src/refresh-frame-10fce.ts (orchestrator body)
packages/engine/src/helper-121b8.ts (chain caller)

oracle/mame_p2_slot0_tap.lua (template tap MAME)
oracle/run-mame.sh (sintassi)
oracle/mame_z_long_tap.lua, mame_struct_1c28_tap.lua, ecc. (12 lua tap)

docs/agent-briefing.md (briefing pack 205 righe — referenza interna)
docs/gameplay-drift-byte-map.md (per-byte drift map)
STATUS.md (storia commit-by-commit, ultimo update 2026-05-12)
```

## 11. Probe diagnostici riusabili

```
packages/cli/src/probe-cluster-histogram.ts (drift per-cluster + split stack/gameplay)
packages/cli/src/probe-100f-diff.ts (obj0.x parity invariant check)
packages/cli/src/probe-gameplay-byte-map.ts (per-byte first-diverge)
packages/cli/src/probe-srtgt-evolution.ts (srtgt drift f+56 esplosione)
packages/cli/src/probe-speed-accum.ts (OFF_SPEED + ACCUM evolution)
packages/cli/src/probe-w20-writer.ts (Proxy tap obj0.W20 writes)
packages/cli/src/probe-p2-slot0-writers.ts (Proxy tap P2 slot pair)
packages/cli/src/probe-long-run.ts (1000 tick cumulativo — mostra degrado)
packages/cli/src/probe-1caba-runtime-state.ts (= ultimo aggiunto, full state pre/post)
packages/cli/src/test-sub-1caba-attract-parity.ts (con SLAPSTIC_BANK=1: 3/3 ✓)
```

## 12. Strategia suggerita per Codex

**Step 1: drill `stateDispatch160F6` runtime** (= TOP CANDIDATE)

Cluster 0x0640 (= writer principale di stateDispatch160F6) drift +12B
inizia a tick 2. Velocity globals (`*0x400666..0x40068B`) divergono in
quella zona.

- Tap MAME su writes a `0x400640..0x4006BF` durante tick 2
  (= MAME f12001)
- Confronta con TS runtime tick 2 (= via Proxy/observer su workRam)
- Identifica PRIMO byte divergente + writer responsabile

**Step 2: fix bit-by-bit**

Se identificato, fix chirurgico in `state-dispatch-160f6.ts` con riferimento
disasm M68K @ 0x160F6..0x16700 (vedi commenti header).

**Step 3: misura cascade**

Drift cluster 0x0640 chiude → cluster 0x0a00 chiude → srtgt match →
cluster 0x0700 chiude → drift gameplay 204 → ~110B (atteso).

## 13. Vincoli inviolabili

- **obj0.x 99/99 MAME** non deve regredire — `probe-100f-diff.ts | tail -3`
- **Drift totale workRam non deve aumentare** rispetto baseline 376
- **1982 vitest** verdi (= con 1 fail pre-esistente `level-helper-2ffb8.test.ts`
  conosciuto, OK ignorare)
- **Branded types**: `u8/u16/u32/i8/i16/i32` da `packages/engine/src/wrap.ts`.
  ESLint `marble-love/no-raw-arith-on-branded` blocca `+/-/*/>>>` su branded
- **No commit dagli agent**: io committo dopo verifica utente

## 14. Cosa l'agent NON deve fare

- NON re-investigare ipotesi falsificate (sezione 7)
- NON re-testare sub bit-perfect (sezione 8)
- NON modificare `decode-bitstream-1a668.ts` (= 500/500 parity)
- NON modificare `sub-1caba-tile-redraw.ts` (= 3/3 attract con bank=1)
- NON modificare `m68k/regfile.ts`, `m68k/cycle-table.ts`, `m68k/slapstic-103.ts`
- NON modificare `trace.ts` invariante esclusioni
- NON usare `git push -f` o reset hard

## 15. Onesta valutazione

13 agent Opus + ~24h drill ha identificato cascade chain ma NON il root
cause. Ogni ipotesi del root cause è stata falsificata. Il bug è
**sottile**: tutte le sub TS investigate sono bit-perfect in isolamento,
ma il sistema runtime accumula divergenza tramite un meccanismo non
localizzato.

Possibili spiegazioni:
- **Sub interna NON ancora investigata** (= stateDispatch160F6 più
  probabile) ha bug bit-perfect
- **Side-effect ordering** tra sub (= ordine call diverso tra TS e MAME)
- **Cycle-accurate timing** (= IRQ4 timing intra-body) influisce su
  letture stateDispatch
- **Slapstic FSM transition** in punto inaspettato del flow

Codex potrebbe avere un approccio diverso (= probabilmente meno
ipotesi-driven, più data-driven). Suggerito drill su
`stateDispatch160F6` come priorità #1, perché è la sub upstream NON
verificata che scrive il cluster 0x0640 = primo punto cascade.

## 16. Setup velocità

Codex CLI suggerito comandi:
```bash
cd /Users/magnus-bot/Code/marble-love
git status # clean state baseline
git log --oneline -10 # ultimi commit
cat STATUS.md | head -100 # storia sessione recente
cat docs/agent-briefing.md # briefing tecnico esteso
```

Buona fortuna 🎲
