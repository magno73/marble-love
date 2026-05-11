# Agent briefing — Marble Love

**Repo**: `/Users/magnus-bot/Code/marble-love/` — replica TypeScript bit-perfect di Marble Madness (Atari System 1, 1984, M68010 @ 7.16 MHz + 6502 audio). Ground truth = **MAME** via differential testing 100 frame.

Questo documento e' il **briefing pack** per agent invocati su task complessi. Leggilo INTEGRALMENTE prima di procedere. Aderisci alle Rule 12 (sezione 2). Non re-investigare ipotesi gia' falsificate (sezione 3).

---

## 1. Stack tecnico

- **Linguaggio**: TypeScript 5.x strict, branded types `u8/u16/u32/i8/i16/i32` in `packages/engine/src/wrap.ts`. ESLint rule `marble-love/no-raw-arith-on-branded` blocca `+/-/*/>>>` su branded — usa sempre helper `u32_add`, `u32_shr`, `as_u32`, `s_ext_16_32`.
- **Package**: monorepo npm workspaces — `packages/engine` (puro), `packages/cli` (probes + parity tests), `packages/web` (Pixi v8), `packages/mobile`.
- **Runner**: Bun preferito ma `tsx` usato in CLI. Test: `vitest` (1982 test pass).
- **Oracle**: MAME 0.286 via Lua plugin in `oracle/`. Ground truth JSONL in `/tmp/mame_100f.json` (100 snapshot work-RAM + sprite-RAM + playfield-RAM + alpha-RAM + color-RAM da frame 12000 a 12099 attract).
- **Disassembly**: Ghidra project in `ghidra_project/` (M68K decompiled).

## 2. CLAUDE.md — 12-rule template (sintesi)

**Rule 1** Think Before — stato assumptions, push back if simpler approach exists.
**Rule 2** Simplicity First — no abstractions for single-use.
**Rule 3** Surgical Changes — solo cio' che serve.
**Rule 4** Goal-Driven — definisci success criteria, loop.
**Rule 5** Model only for judgment — code answers if deterministico.
**Rule 6** Token budgets non advisory.
**Rule 7** Surface conflicts — non blendi pattern contraddittori.
**Rule 8** Read before write.
**Rule 9** Tests verify intent, not behavior.
**Rule 10** Checkpoint after every step.
**Rule 11** Match codebase conventions.
**Rule 12** **FAIL LOUD** — "completed" e' sbagliato se qualcosa e' skippato silently. Se ipotesi e' sbagliata, dichiaralo esplicitamente.

## 3. Ipotesi gia' falsificate (NON ripetere)

7 Rule 12 fail-loud in serie hanno reorientato la roadmap. Non perdere tempo su:

1. **Consumer `*0x400006` mancante** — falsificato. E' byte boolean self-contained in `FUN_13EE6` (setter/gate/resetter tutti replicati e wired). `FUN_2548 consumeEventFlag` esiste ma NON viene chiamato in window attract.

2. **Drift P2.slot0 inizia f+68 su x_long** — falsificato. Inizia a **f+8 su vx** (`0x400A20 + 0x00`).

3. **Secondo callsite ROM di `FUN_158CC` o `FUN_158F6`** — falsificato. UN solo callsite ciascuno, entrambi gia' wired in `refresh-frame-10fce.ts:318` + `object-update-pair-158cc.ts`.

4. **Cadenza dinamica MAME 30/60Hz** — falsificato. MAME e' **30Hz puro** in attract 12000-12099: 49 bodies in 100 frame, gap=2 sempre, body cycles range [111512..157176], **0/49 sopra 2 vblank**. Misurato via `oracle/mame_body_cycles.lua`.

5. **Wire 30 sub stack-heavy chiude cluster 0x1D40** — falsificato. Cluster scritto da **430 PC distinte**, top-1 PC = 6%, helper121B8 prologue = 1%. **Cluster escluso da invariante parita'**.

6. **SUB_CYCLE_ESTIMATE calibration chiude cadenza** — falsificato. Stime sono sotto-magnitude (32K vs 123K real) ma **behavior-correct** (30Hz coerente). Calibrare farebbe scattare false-positive 60Hz.

7. **obj2 cluster phase-flip body** — falsificato. "obj2" e' misnomer: zona `0x01DC..0x02BC` e' **scene-obj rect-list** (32 slot × 14B). Phase-flip tentato e rolled back: drift 387→442, obj0.x diverge f+99.

## 4. Layout work-RAM 8KB ($400000-$401FFF)

```
0x000..0x017  globals header (frame counter, vblank mailbox, ecc.)
0x018..0x0F9  obj0 = P1 marble player (stride 0xE2 = 226 byte)
0x0FA..0x1DB  obj1 = P2 marble player
0x1DC..0x2BC  scene-obj rect-list (32 slot × 14 byte: [type,sub,xMin,yMin,zMin,xMax,yMax,zMax])
0x390..0x3FF  AV/scroll control globals
0x400..0x4FF  state machine + level state (esclude 0x440-0x447 stack water)
0x600..0x7FF  decode buffers + velocity globals
0x800..0x9A3  sprite slot misc
0x9A4..0xA1F  slot pair P1 (124 byte)
0xA20..0xA9B  slot pair P2
0xA9C..0x1305 script slot table (25 slot × 0x56)
0x1D40..0x1E7F STACK SCRATCH 68K (escluso da invariante)
0x1EE0..0x1EFF stack low water + sentinel bsr (escluso)
0x1F00..0x1FFF stack top (SP parte da 0x1F00)
```

**Obj struct (stride 0xE2)**:
- `+0x00..0x03` x_long, `+0x04..0x07` y_long, `+0x08..0x0B` z_long
- `+0x0C..0x0F` vx, `+0x10..0x13` vy, `+0x14..0x17` vz
- `+0x18` sprite code, `+0x19` type, `+0x1A..0x1B` state flag
- `+0x70` anim frame, `+0xD8` end-flag

## 5. Sub TS bit-perfect verificate (parity test 100%)

NON re-indagare queste come "candidate buggate":

- `decodeBitstream1A668` (522 righe) — bit-perfect, wired in `refreshHelper13EE6`
- `helper121B8` (1634 byte ROM) — bit-perfect (assorbe phase shift via obj-step substride)
- `helper182BA` — bit-perfect
- `helper253BC` — bit-perfect
- `vectorScale FUN_25E7C` — bit-perfect (test in repo)
- `positionUpdate FUN_1706C` — bit-perfect
- `spritePosUpdate1BAB2` — bit-perfect
- `spriteBracketLerp1C676` — bit-perfect
- `deriveSpriteFields` — bit-perfect
- `objectUpdatePair158CC` + `fun158F6` — wired, replicati
- `objectRenderUpdate13334` — bit-perfect
- `spriteCoordsJsr150D0` — bit-perfect
- `lateGameLogic26F3E` — bit-perfect 100/100 (esclude wrapper artifact 0x39a)
- `bufferFill1B12A` — bit-perfect (test parity in repo)
- `sceneObjInit28CA6` — boot-time
- 6 sub NO_IMPL → ora bit-perfect: sub-1bb08, sub-14dec, sub-1d242, sub-19692, sub-19976, sub-1937c
- `mainLoopInit117B2` — replica corretta (ma NON usata in produzione, solo per parity test)
- `mainLoopInit1101E` — wired
- `gameMainGate` — wired

## 6. Sub TS non bit-perfect (impatto noto = ZERO)

- `sub1CABATileRedraw` — NON wired, 0/100 match in isolamento, MA impact ZERO sul drift attract (MAME ha struct costante `3fdc` che TS preserva via warm-state, `probe-struct-1c28.ts` conferma 99/99 OK)
- `fun_29cce` — NO_IMPL stub (tentativi wire rolled back per regressione obj0.x)
- `fun_1cc62` — stub `→ obj.z` (workaround per FUN_1CABA non wired)

## 7. Esclusioni invariante parita'

In `packages/engine/src/trace.ts` `workRamHash` + `workRamRegionalHashes` (regioni 4, 29, 30) e `oracle/mame_dumper.lua`:

- `0x440-0x447` (8B) stack low water debug
- `0x1D40-0x1E7F` (320B) stack scratch chain attiva, 430 PC distinte
- `0x1EE0-0x1EFF` (32B) stack low water + sentinel bsr

`probe-cluster-histogram.ts` mostra split `total=387 | gameplay=215 | stack-residue=172 (excluded)`.

## 8. Cluster drift gameplay residuo 215B

Top-5 cluster (top contributor per fix candidato):
```
1. 0x0700..0x073F  58B  decodeBitstream1A668 output (first f+2)
2. 0x0740..0x077F  16B  decodeBitstream1A668 continuation (first f+1)
3. 0x0680..0x06BF  15B  stateDispatch160F6 cascade P2 (first f+4)
4. 0x0A00..0x0A3F  15B  fun158F6 P2 (first f+8)
5. 0x0640..0x067F  12B  stateDispatch160F6 cascade P2 (first f+4)
```
Plus 19B rect-slot list `0x01DC..0x02BC` + ~80B sparsi.

Mappa completa per-byte in `docs/gameplay-drift-byte-map.md`.

## 9. MAME measurement reali (verificati)

- **Body cadence**: 30Hz puro nella window attract f12000-12099. 49 bodies in 100 frame, gap=2 sempre.
- **Body cycles**: range 111512..157176, p50 122546, p95 146206. CYCLES_PER_VBLANK = 119316 (= 7.16 MHz / 60Hz). Bodies > 1 vblank = 36/49 (73%), > 2 vblank = 0/49.
- **Body entry**: PC 0x10FCE (FUN_10FCE = refreshFrame10FCE). Exit RTS @ 0x1101C.
- **obj0.x cadence**: cambia ogni 2 frame (f12002, 12004, ...). Bit-perfect 99/99 vs TS gia' raggiunto.
- **rect-slot cadence**: cambia ogni frame dispari (f0→f1, f2→f3, f4→f5). MAME ha sub di "tipi diversi" che aggiornano in frame diversi — NON e' phase mismatch, e' artefatto di quando MAME prende snapshot intra-frame.

## 10. Convenzioni dev

- **NO commit** dagli agent: lasciali untracked, l'utente committa
- **Drift invariato a fine task**: `npx tsx packages/cli/src/probe-cluster-histogram.ts | head -1` deve mostrare `total=387` se non hai applicato fix intenzionale
- **obj0.x 99/99 MAME** = invariante: `npx tsx packages/cli/src/probe-100f-diff.ts` deve mostrare `obj0.x TS=... MAME=... ✓` su tutti i 99 frame
- **1982/1982 vitest verdi**: `npm run test --silent` deve mostrare 1982 pass
- **Typecheck pulito**: `npx tsc -b` exit 0
- **ESLint clean**: `no-raw-arith-on-branded` rispettata
- **Files puliti a fine**: rimuovi probe-temp in `/tmp/` se non riusabili. Lascia probe-* in `packages/cli/src/` se valgono per future analisi

## 11. Tooling esistente riusabile

**Probe diagnostici** (in `packages/cli/src/`):
- `probe-cluster-histogram.ts` — drift workRam per cluster 64B, split total/gameplay/stack-residue
- `probe-100f-diff.ts` — obj0.x parity check 99 frame
- `probe-gameplay-byte-map.ts` — per-byte drift map con first-diverge e candidate writer
- `probe-cadence.ts` — log cadenza body 30Hz
- `probe-p2-slot0-writers.ts` — Proxy-tap su workRam 0x400A20..0x400A3F

**MAME Lua taps** (in `oracle/`):
- `mame_dumper.lua` — snapshot 100 frame
- `mame_body_cycles.lua` — cycle measurement body
- `mame_p2_slot0_tap.lua` — write tap su slot pair P2
- `mame_cluster_0640_writers.lua`, `mame_cluster_0706_trace.lua`, ecc. — tap per cluster specifici
- Template `oracle/run-mame.sh` per sintassi MAME launch

**Cycle counter infrastructure** (in `packages/engine/src/m68k/`):
- `cycle-table.ts` (630 righe, 21/21 vitest) — cycle counts M68010 da Musashi MIT
- `sub-cycle-costs.ts` (538 righe) — stime cicli per sub body
- `regfile.ts` (345 righe) — register file M68010 con 8 istruzioni stack ABI, validato Tom Harte 2879/2879
- `clock.ts` — addCpuCycles/resetCpuCycles helper

**Validation dataset**:
- `oracle/tom_harte_m68000/` (22MB MIT) — 5923 test case M68000 ABI per validation register file

## 12. File chiave per indagini

- `packages/engine/src/refresh-frame-10fce.ts` — orchestrator body M68K (FUN_10FCE)
- `packages/engine/src/main-tick.ts` — gate 30Hz cadence + mailbox vblank
- `packages/engine/src/state.ts` — interfaccia GameState
- `packages/engine/src/late-game-logic-26f3e.ts` — post-body FUN_26F3E
- `STATUS.md` — storia commit-by-commit con highlights sessione
- `docs/missing-subs-inventory.md` — inventario sub TS
- `docs/gameplay-drift-byte-map.md` — mappa per-byte 215B drift
- `docs/drift-cluster-analysis.md` — analisi cluster precedenti

## 13. Stato corrente sintesi

```
Drift @ f+99 = 387 byte
├─ 172B stack-residue (escluso da invariante)
└─ 215B gameplay (target residuo)
   ├─ 74B  cluster 0x0700  (decode buffer)
   ├─ 27B  cluster 0x0640  (velocity globals)
   ├─ 19B  rect-slot list  (scene-obj rect-list)
   ├─ 15B  cluster 0x0a00  (P2 region cascade)
   └─ ~80B sparsi
```

obj0.x bit-perfect 99/99. 1982/1982 vitest. Tutta l'infrastruttura M68K (cycle-table + sub-cycle-costs + regfile + Tom Harte validation) e' committata e funzionante ma per il momento il cycle counter non triggera (= behavior corretto, MAME 30Hz puro).

---

## Come usare questo briefing in un agent

Apri il prompt con:
> "Leggi PRIMA `/Users/magnus-bot/Code/marble-love/docs/agent-briefing.md` integralmente. Poi rispondi al task qui sotto. Non re-investigare ipotesi gia' falsificate (sezione 3 del briefing). Non re-testare sub gia' verificate bit-perfect (sezione 5). Aderisci alle 12-rule (sezione 2), in particolare Rule 12 fail-loud."

Poi specifica il task con dati misurati, non ipotesi.
