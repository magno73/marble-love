# Codex briefing — Marble Love drift residuo (round 2)

> Brief per agent ChatGPT Codex CLI. Stato sessione 2026-05-12 post-fix #1.
> Obiettivo: ridurre drift gameplay workRam da **107B** verso 0B.

## 1. Repo

```
/Users/magnus-bot/Code/marble-love/
git branch: feature/visual-pixel-match
git remote: github.com/magno73/marble-love (push abilitato)
ultimo commit: 1ebf208 fix(refresh): wire real z projection for obj0
```

Stack: TypeScript 5.x strict, monorepo npm workspaces (`packages/engine`,
`packages/cli`, `packages/web`, `packages/mobile`), vitest, MAME 0.286 come
oracolo, Ghidra 11.x per disasm M68K.

## 2. Tuo fix precedente (1ebf208) — funzionante ✓

Hai rimosso lo stub `fun_1cc62 → obj.z` in `refresh-frame-10fce.ts:135`,
lasciando `helper121B8` usare la replica reale `spriteProject1CC62`. Plus
mantenuto wire `fun_1bab2 → sub1CABATileRedraw`. Risultato:

```
Drift @ f+99:
  Pre-fix:  total=376 | gameplay=204 | stack=172
  Post-fix: total=279 | gameplay=107 | stack=172   (-47.5% gameplay)

obj0.z evolution:
  Pre-fix:  f+99=0x3f97 stuck, f+500=0x3f97 stuck, f+1000=0 crashed
  Post-fix: f+99=0x3f88 bit-perfect MAME, f+500=0x3f88, f+1000=0
```

obj0.x ancora 99/99 ✓. Marble runtime stabile fino ~500 frame invece di ~100.

## 3. Stato attuale drift residuo

```
total          = 279 byte
├─ 172B stack-residue (escluso da invariante)
└─ 107B gameplay (target residuo)
```

Cluster gameplay top (post-fix):
```
1. 0x0a00..0x0a3f  15B  P2 slot pair (fun158F6 P2 chain)        ← TOP candidate
2. 0x0680..0x06bf  15B  stateDispatch160F6 cascade (cluster B)
3. 0x0640..0x067f  12B  velocity globals (stateDispatch160F6)   ← TOP candidate
4. 0x0a40..0x0a7f  12B  P2 slot pair continuation
5. 0x0700..0x073f  ~10B residuo decoder (era 49B pre-fix)        ← chiude da solo se 0x0a00+0x0640 fixati
6. ~43B sparsi (cluster <10B ciascuno)
```

## 4. Comandi essenziali

```bash
# Drift attuale
npx tsx packages/cli/src/probe-cluster-histogram.ts | head -10

# obj0.x parity (= deve restare 99/99)
npx tsx packages/cli/src/probe-100f-diff.ts | tail -3

# Test suite (= 1 fail pre-esistente in level-helper-2ffb8, OK ignorare)
npx vitest run --reporter=basic

# Typecheck
npx tsc -b

# Long-run degradation test
npx tsx packages/cli/src/probe-long-run.ts

# MAME tap (sintassi base)
MARBLE_TRACE_FROM=11998 MARBLE_TRACE_TO=12010 \
  mame marble -window -nothrottle -skip_gameinfo -seconds_to_run 220 \
  -rompath roms -autoboot_script oracle/<tap>.lua -autoboot_delay 0
```

## 5. CLAUDE.md 12-rule (= aderire sempre)

Rule 1 Think before. Rule 2 Simplicity. Rule 3 Surgical. Rule 4
Goal-driven. Rule 5 Model only for judgment. Rule 6 Token budget non
advisory. Rule 7 Surface conflicts. Rule 8 Read before write. Rule 9
Tests verify intent. Rule 10 Checkpoint after step. Rule 11 Match
conventions. **Rule 12 FAIL LOUD** — se ipotesi sbagliata, dichiaralo.

## 6. Cascade chain verificata + ipotesi target

```
[NOT identified upstream]
   → cluster 0x0a00 (P2 slot pair) +15B
      → cluster 0x0640 velocity globals +12B
         → cluster 0x0680 cascade +15B
            → eventuali cascade minori
               → drift gameplay 107B
```

**Fix UNA sub upstream → cascade chiude ~42B + cascade minor**.

## 7. Ipotesi gia' FALSIFICATE (Rule 12, NON ripetere)

13 Rule 12 fail-loud in sessione precedente. **NON ri-investigare**:

1. Consumer di `*0x400006` mancante → byte boolean self-contained
2. Drift P2.slot0 inizia f+68 x_long → inizia tick 2 lock_flag
3. Secondo callsite JSR 158F6 → unico callsite
4. Cadenza dinamica 30/60Hz MAME → MAME 30Hz puro (49 bodies/100 frame)
5. Wire 30 sub stack-heavy chiude 0x1D40 → 430 PC distinti
6. SUB_CYCLE_ESTIMATE calibration → behavior-correct
7. "obj2" misnomer → scene-obj rect-list
8. Phase-flip body 30Hz → drift sale
9. Stack residue cascade → escluso da invariante
10. obj0.z stuck → screenX cascade → FIXATO da te (1ebf208)
11. Wire helper121B8 per tutti obj → canonical applicato (no-op)
12. Cluster 0x0700 intrinseco decoder → e' cascade da srtgt
13. `sub1CABA` produce STRUCT=0 runtime → bit-perfect con bank=1

## 8. Sub TS verificate bit-perfect (NON re-investigare)

Parity test 100% O probe runtime conferma:

- `decodeBitstream1A668` (parity 500/500 + runtime body 1)
- `sub1CABATileRedraw` (3/3 attract con `SLAPSTIC_BANK=1`)
- `spriteProject1CC62` (formula verified, ora wirato in produzione)
- `spritePosUpdate1BAB2` (wirato con sub1CABA injection)
- `spriteHelper1B9CC` (writes obj+0x1e/+0x22/+0x26 packed)
- `helper121B8` (chain canonical wired post-fix)
- `objectScanDispatch251DE` (= FUN_251DE wired)
- `objectUpdatePair158CC` + `fun158F6` (P1/P2 dispatcher)
- `lateGameLogic26F3E` (100/100 escluso wrapper 0x39a)
- `bufferFill1B12A` (parity in repo)
- `regfile.ts` 8 istruzioni stack ABI (Tom Harte 2879/2879)
- `slapstic 137412-103 FSM` (11/11 vitest)

## 9. Sub TS NON verificate direttamente (= candidate per drill)

**Tutte queste mai testate bit-perfect RUNTIME** (= sub interna chiamata
dentro un body reale tick 2+):

- **`stateDispatch160F6`** — `packages/engine/src/state-dispatch-160f6.ts`
  (508 righe). Scrive velocity globals @ 0x400640..0x4006BF. **TOP CANDIDATE.**
  Cluster 0x0640 drift +12B inizia tick 2.
- **`helper182BA`** — invocata in chain `fun158F6` ELSE branch (= P2 path).
- **`helper25C74`** — invocata in path specifico.
- **`helper253BC`** — wired in path C ma non testato bit-perfect runtime.
- **Chain `fun158F6(P2_slot)` completa** — gestisce slot pair P2 update.
  Scrive cluster 0x0a00 (= P2 slot pair). **TOP CANDIDATE.**

## 10. File chiave per drill

```
packages/engine/src/state-dispatch-160f6.ts (508 righe — TOP CANDIDATE)
packages/engine/src/helper-182ba.ts
packages/engine/src/helper-25c74.ts
packages/engine/src/sub-158f6.ts (P2 dispatcher)
packages/engine/src/object-update-pair-158cc.ts (caller P1/P2)
packages/engine/src/helper-121b8.ts (chain caller)
packages/engine/src/refresh-frame-10fce.ts (orchestrator, fix tuo applicato)

oracle/mame_p2_slot0_tap.lua (template tap P2)
oracle/mame_z_long_tap.lua, mame_struct_1c28_tap.lua (12+ tap esistenti)
oracle/run-mame.sh (sintassi)

docs/agent-briefing.md (briefing pack 205 righe — referenza tecnica estesa)
docs/gameplay-drift-byte-map.md (per-byte drift map storico)
STATUS.md (aggiornato post tuo fix)
```

## 11. Probe diagnostici riusabili

```
packages/cli/src/probe-cluster-histogram.ts (drift per-cluster)
packages/cli/src/probe-100f-diff.ts (obj0.x parity invariant)
packages/cli/src/probe-gameplay-byte-map.ts (per-byte first-diverge)
packages/cli/src/probe-srtgt-evolution.ts (srtgt drift)
packages/cli/src/probe-speed-accum.ts (OFF_SPEED + ACCUM)
packages/cli/src/probe-w20-writer.ts (Proxy tap obj0.W20)
packages/cli/src/probe-p2-slot0-writers.ts (Proxy tap P2 slot pair)
packages/cli/src/probe-long-run.ts (1000 tick cumulativo — mostra degrado)
packages/cli/src/probe-1caba-runtime-state.ts (= ultimo, full state pre/post)
packages/cli/src/test-sub-1caba-attract-parity.ts (con SLAPSTIC_BANK=1: 3/3 ✓)
```

## 12. Strategia suggerita

**Path 1 — Cluster 0x0a00 (P2 slot pair, 15B)** [TOP PRIORITY]

Cluster scrive da `fun158F6` (P2 dispatcher). MAME chiama fun158F6 per
P1 e P2 (via objectUpdatePair158CC). TS replica esistente, mai testata
bit-perfect runtime.

Drill:
- Tap MAME su writes a `0x400A20..0x400A9B` durante body tick 2
- Confronta con TS runtime Proxy
- Primo byte divergente → identifica writer sub responsabile
- Fix bit-by-bit

**Path 2 — Cluster 0x0640 (velocity globals, 12B)**

Cluster scrive `stateDispatch160F6` chain. Chiamata dentro helper121B8
chain runtime.

Drill:
- Tap MAME su writes a `0x400640..0x4006BF` durante body tick 2
- Confronta con TS runtime
- Identifica path branch divergente in stateDispatch160F6

**Path 3 — Drill srtgt @ f+56 esplosione**

Probe esistente `probe-srtgt-evolution.ts` mostra srtgt diverge -1 unit
a f+56. Cosa causa quella divergenza precisa?

## 13. Vincoli inviolabili

- **obj0.x 99/99 MAME** non deve regredire — verifica con probe-100f-diff
- **Drift totale non deve aumentare** rispetto baseline 279
- **Test mirati** verdi (= refresh-frame-10fce, sub-1caba, sprite-project,
  helper-121b8)
- **Branded types**: `u8/u16/u32/i8/i16/i32` da `wrap.ts`. ESLint
  `no-raw-arith-on-branded` blocca `+/-/*/>>>` su branded
- **No git push -f, no reset hard**

## 14. Cosa NON fare

- NON re-investigare ipotesi falsificate (sezione 7)
- NON re-testare sub bit-perfect (sezione 8)
- NON modificare `decode-bitstream-1a668.ts`, `sub-1caba-tile-redraw.ts`,
  `sprite-project-1cc62.ts`, `m68k/regfile.ts`, `m68k/slapstic-103.ts`
- NON modificare `trace.ts` esclusioni
- NON usare `git push -f` o reset hard

## 15. Note dalla sessione precedente

Il pattern Claude Opus "ipotesi → falsifica" ha fallito 13 volte a localizzare
il root cause obj0.z. **Il tuo fix è stato la mossa giusta**: rimuovere
stub `fun_1cc62`, lasciare default `spriteProject1CC62` reale. Sottile:
i nostri experiment wiravano `fun_1cc62` esplicitamente, che invocava
sub1CABA ricorsivamente → STRUCT rotta.

Approccio data-driven (= mostrare il comportamento reale invece di
teorizzare) probabilmente funziona meglio per i 107B residui.

## 16. Setup velocità

```bash
cd /Users/magnus-bot/Code/marble-love
git log --oneline -5 # ultimi commit
cat STATUS.md | head -100 # storia
cat docs/agent-briefing.md # tecnico esteso
npx tsx packages/cli/src/probe-cluster-histogram.ts | head -10 # drift attuale
```

Buona fortuna 🎲 — il tuo fix #1 è stato eccellente. Stesso approccio
data-driven dovrebbe chiudere altri ~42-65B.
