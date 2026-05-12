# Codex briefing — Marble Love drift residuo (round 4)

> Brief per agent ChatGPT Codex CLI. Stato sessione 2026-05-12 post-fix #3.
> Obiettivo: ridurre drift gameplay workRam da **57B** verso 0B.

## 0. Fix Claude round 3 (commit cc30f76, -11B gameplay)

Drift 240/68 → 229/57. Portato FUN_14966 full body (`sub-14966.ts`,
sostituisce `sub-14966-stub.ts`). Path C body reset ticker, advance pc58
+= sext(step)*4, pos+=vel quando state ∈ {0,3}, jsr FUN_15148 + jsr
FUN_150D0 conditional state dispatch.

Risultato: slot1/slot2 `+0x24` (ticker) ora bit-perfect MAME. Cluster
0x13c0 11B → 7B, 0x0200 10B → 3B (cascade chiuso).

Residual cluster top:
```
0x1400..0x143f   8B  slot3 vx/vy (helper12896 PC cascade)
0x13c0..0x13ff   7B  slot2 tail (slot[0x58]/0x5c phase)
0x03c0..0x03ff   6B  g_frame_counter timing cascade
0x0400..0x043f   6B  stateSub cascade
0x1440..0x147f   5B  slot3 cascade
0x0380..0x03bf   4B
0x1380..0x13bf   4B  slot1 minor cascade
0x0200..0x023f   3B
0x1340..0x137f   3B
```

## Finding sospeso: slot3 ticker phase off-by-one

`probe-slot3-tick-ts.ts` mostra:
- TS body fires a frame 2,4,6,...,98 (49 bodies, gate even/odd corretto).
- MAME slot1/2 ticker pattern matcha TS perfettamente.
- MAME slot3 ticker pattern off-by-one: a f=1 MAME slot3 tick=1 (body fired),
  ma slot1/2 tick=1 (warm, no fire). Impossibile se body è sincrono per
  tutti e 4 gli slot.

Hypothesis (NON verified): `helper15148` case 0/3 (waypoint reached) fa
`clr.b (0x24,A2)` + `move.b #2,(0x25,A2)` + reset altri campi. Se slot1
hit waypoint più frequentemente, ticker viene resettato extra.

Drill: tap MAME write @ 0x401386 e 0x401446 (slot1/3 ticker bytes), vedi
se MAME fa write extra non visibili come addq.b normale.

## 1. Repo

```
/Users/magnus-bot/Code/marble-love/
git branch: feature/visual-pixel-match
git remote: github.com/magno73/marble-love (push abilitato)
ultimo commit locale: fix(helper182ba): wire 15e24 ROM target dispatch
```

Stack: TypeScript 5.x strict, monorepo npm workspaces (`packages/engine`,
`packages/cli`, `packages/web`, `packages/mobile`), vitest, MAME 0.286 come
oracolo, Ghidra 11.x per disasm M68K.

## 2. Fix precedenti — funzionanti ✓

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

Secondo fix Codex (round 2): P2 slot `0x400A20` non avanzava il target pointer
ROM-backed via `FUN_15E24 -> FUN_1605C -> FUN_160AE`. Ora f+68 matcha MAME:

```
P2 slot0:
  f+66 TS/MAME +0=fffef875 +4=0000b0fd +68=70000 +6e=2278c
  f+68 TS/MAME +0=ffff3a2a +4=00009ce6 +68=70000 +6e=2277a
  f+70 TS/MAME +0=ffff7780 +4=00008978 +68=70000 +6e=2277a

Drift @ f+99:
  Pre-fix2:  total=279 | gameplay=107 | stack=172
  Post-fix2: total=240 | gameplay=68  | stack=172
```

## 3. Stato attuale drift residuo

```
total          = 240 byte
├─ 172B stack-residue (escluso da invariante)
└─ 68B gameplay (target residuo)
```

Cluster gameplay top (post-fix2):
```
1. 0x13c0..0x13ff  11B
2. 0x0200..0x023f  10B
3. 0x03c0..0x03ff   6B
4. 0x0400..0x043f   6B
5. 0x1340..0x137f   5B
6. 0x1380..0x13bf   5B
7. 0x1400..0x143f   5B
8. 0x1440..0x147f   4B
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

## 6. Cascade chain chiusa + target corrente

```
FIXED:
  stateValidateGrid15DB6 ROM byte read
    → stateSub15E24 conditional dispatch
      → stateDispatch1605C
        → FUN_160AE ROM-backed target stride
          → P2 slot @ 0x400A20 f+68 bit-perfect
            → drift gameplay 107B → 68B
```

Il vecchio path P2 `0x0a00` non e' piu' il top cluster. Usare la nuova top-30:
`0x13c0`, `0x0200`, `0x03c0/0x0400`, `0x1340..0x147f`.

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
- `helper182BA` P2 f+66..f+70 runtime per slot `0x400A20` (target pointer e
  posizione bit-perfect dopo fix `FUN_15E24`)

## 9. Sub TS NON verificate direttamente (= candidate per drill)

**Tutte queste mai testate bit-perfect RUNTIME** (= sub interna chiamata
dentro un body reale tick 2+):

- **`stateDispatch160F6`** — `packages/engine/src/state-dispatch-160f6.ts`
  (508 righe). Storicamente scrive velocity globals @ 0x400640..0x4006BF.
  Dopo fix P2 non e' piu' in top-8, ma resta candidato se riemerge nella
  byte-map.
- **`helper182BA`** — P2 f+68 target-pointer path risolto. Restano possibili
  altri rami, ma non ripartire dal vecchio `+0x6e=0x2278c` bug.
- **`helper25C74`** — invocata in path specifico.
- **`helper253BC`** — wired in path C ma non testato bit-perfect runtime.
- **Chain `fun158F6(P2_slot)` completa** — vecchio cluster P2 risolto per
  f+68; controllare solo se i nuovi probe la riportano in top cluster.

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

**Path 1 — Cluster 0x13c0..0x147f (slot/script array, 30B cumulativi)**

Nuovo top cumulativo dopo fix P2. Prima mossa: `probe-gameplay-byte-map.ts`
per first-diverge e mapping writer/struct, poi tap MAME mirato sul range
`0x4013C0..0x40147F`.

Drill:
- Tap MAME su writes a `0x4013C0..0x40147F` nel primo frame divergente
- Confronta con TS runtime Proxy
- Primo byte divergente → identifica writer sub responsabile
- Fix bit-by-bit

**Path 2 — Cluster 0x0200..0x023f (10B)**

Probabile lista/rect/object scratch. Usare `probe-cluster-diff.ts` e
`probe-rect-list-diff.ts` prima di teorizzare.

Drill:
- Tap MAME sul sottorange esatto individuato dalla byte-map
- Confronta con TS runtime
- Identifica writer sub responsabile

**Path 3 — Cluster 0x03c0/0x0400 (6B + 6B)**

Piccoli global/scratch clusters. Dopo i due target maggiori, usare la stessa
procedura writer-first.

## 13. Vincoli inviolabili

- **obj0.x 99/99 MAME** non deve regredire — verifica con probe-100f-diff
- **Drift totale non deve aumentare** rispetto baseline 240
- **Test mirati** verdi (= helper-182ba, state-validate-grid-15db6,
  state-dispatch-1605c, sub-158f6; piu' refresh/sub1CABA/sprite-project se
  tocchi il render path)
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
teorizzare) probabilmente funziona meglio per i 68B residui.

## 16. Setup velocità

```bash
cd /Users/magnus-bot/Code/marble-love
git log --oneline -5 # ultimi commit
cat STATUS.md | head -100 # storia
cat docs/agent-briefing.md # tecnico esteso
npx tsx packages/cli/src/probe-cluster-histogram.ts | head -10 # drift attuale
```

Buona fortuna — i fix #1 e #2 hanno tolto 136B gameplay cumulativi. Stesso
approccio data-driven dovrebbe chiudere il residuo.
