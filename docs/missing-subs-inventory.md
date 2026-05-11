# Missing / Stubbed Subs Inventory — Marble Love TS Engine

**Data:** 2026-05-11
**Stato attuale:** 99/99 frame `obj0.x` bit-perfect vs MAME, drift workRam @100f = 466 byte, spriteRam @100f = 248 byte. Obiettivo: identificare le sub MAME ancora mancanti o stubbed che contribuiscono al drift residuo (specie `obj0.z` non integrato → marble galleggia).

Metodologia: regex `fun_[0-9a-f]+\?:` su `packages/engine/src/*.ts` (151 hit) + scan dei file `sub-*.ts` con header "STUB"/"NOT YET IMPLEMENTED" + parity test inventory (253 file `test-*-parity.ts`) + diff per-byte vs `/tmp/mame_100f.json`.

---

## 1. Stub Inventory

Tabella delle subs **injectable** via `Subs.fun_XXXXX?:` con stato del default. La colonna *Default* indica cosa succede quando il caller passa `{}` (= il caso pratico in `mainTick` / `lateGameLogic` / `refreshFrame`).

Convenzioni:
- **NOOP** = `if (subs.fun_X) {...}` senza `else` → invocazione silenziosa skip.
- **REAL** = `} else { realImplementation(...) }` → call alla replica reale (bit-perfect o partial).
- **PARTIAL** = file esiste ma con header `STUB`/`TODO` (replica solo prologo / casi limitati).
- **NO_IMPL** = nessun file `XXXXX.ts` esiste, solo l'interfaccia injectable.

### 1.1 helper-121b8.ts — `Helper121B8Subs` (chain principale obj-update)

| Sub | ROM addr | Default | Replica file | Stato replica |
|---|---|---|---|---|
| fun_1bab2 | 0x1BAB2 | REAL | sprite-pos-update-1bab2.ts | FULL |
| fun_1cc62 | 0x1CC62 | REAL | sprite-project-1cc62.ts | FULL (chiama `fun_1CABA` interno) |
| fun_1c676 | 0x1C676 | REAL | sprite-bracket-lerp-1c676.ts | FULL |
| fun_12886 | 0x12886 | REAL | (mini-helpers/object-helpers) | FULL |
| fun_1b5c2 | 0x1B5C2 | REAL | state-sub-1b5c2.ts | FULL |
| **fun_29cce** | **0x29CCE** | **NOOP** | sub-29cce.ts | **PARTIAL** (PROLOGO + LOOP outer + dispatch JT; BLOCK complessi fallthrough) |
| fun_1bc88 | 0x1BC88 | REAL | helper-1bc88.ts | FULL |
| fun_14e92 | 0x14E92 | REAL | script-slot-bbox-test-14e92.ts | FULL |
| fun_175c8 | 0x175C8 | REAL | string-viewport-hit-175c8.ts | FULL |
| fun_1881c | 0x1881C | REAL | state-sub-1881c.ts | FULL |
| **fun_1924e** | **0x1924E** | **REAL** | helper-1924e.ts | FULL (no parity test) |
| fun_19d94 | 0x19D94 | REAL | bbox-hit-test-19d94.ts | FULL |
| fun_1365c | 0x1365C | REAL | object-render-update-1365c.ts | FULL |
| fun_160f6 | 0x160F6 | REAL | state-dispatch-160f6.ts | FULL |
| fun_1b9cc | 0x1B9CC | REAL | sprite-helper-1b9cc.ts | FULL |
| fun_1c014 | 0x1C014 | REAL | sprite-rotate-1c014.ts | FULL |
| fun_1281c | 0x1281C | REAL | object-enter-1281c.ts | FULL |
| fun_1706c | 0x1706C | REAL | position-update.ts | FULL |
| **fun_25c74** | **0x25C74** | **REAL** | helper-25c74.ts | FULL |
| fun_18a1e | 0x18A1E | REAL | sprite-coords.ts | FULL |
| fun_18e6c | 0x18E6C | REAL | slot-insert-sorted-18e6c.ts | FULL |
| fun_25bae | 0x25BAE | REAL | object-state-entry-25bae.ts | FULL |
| fun_15884 | 0x15884 | REAL | sound-pair-15884.ts | FULL |
| fun_158ac | 0x158AC | REAL | sound-cmd-send-158ac.ts | FULL |
| fun_15bd0 | 0x15BD0 | REAL | state-sub-15bd0.ts | FULL |
| fun_25df6 | 0x25DF6 | REAL | trackball-apply.ts | FULL |
| fun_25e7c | 0x25E7C | REAL | vector-scale.ts | FULL |
| fun_285b0 | 0x285B0 | REAL | helper-285b0.ts | FULL |

**Critical**: `helper121B8` è invocato da `fun253ECDispatch` (refresh-frame) PER OBJ0 con un solo override (`fun_bab2` → wire `fun_1CABA` real), e da `fun158F6` (slot-pair) SENZA override → in entrambi i casi `subs.fun_29cce === undefined` → BLOCK 29CCE no-op anche se la replica `sub-29cce.ts` esiste.

### 1.2 helper-15148.ts — `Helper15148Subs`

| Sub | ROM addr | Default | Replica | Stato |
|---|---|---|---|---|
| fun_15460 | 0x15460 | REAL | state-dispatch-15460.ts | FULL |
| fun_15670 | 0x15670 | REAL | state-sub-15670.ts | FULL |
| fun_158ac | 0x158AC | REAL | sound-cmd-send-158ac.ts | FULL |
| fun_15884 | 0x15884 | REAL | sound-pair-15884.ts | FULL |
| fun_1bb08 | 0x1BB08 | NOOP | (nessuno) | NO_IMPL |
| fun_1cc62 | 0x1CC62 | REAL | sprite-project-1cc62.ts | FULL |
| fun_25bae | 0x25BAE | REAL | object-state-entry-25bae.ts | FULL |
| fun_25e7c | 0x25E7C | REAL | vector-scale.ts | FULL |
| fun_14dec | 0x14DEC | NOOP | (nessuno) | NO_IMPL |

### 1.3 game-state-machine.ts — `GameStateMachineSubs`

Tutte e 10 wirate da `mainTick`. State = FULL (parity 500/500).

### 1.4 sound-tick.ts — `SoundTickSubs`

| Sub | ROM addr | Default | Stato |
|---|---|---|---|
| fun_3e1a | 0x3E1A | REAL (soundDispatchSend) | FULL |
| **fun_4dcc** | **0x4DCC** | **NOOP** (mini-stub counter) | **NO_IMPL** (richiede YM2151) |
| fun_4c3e | 0x4C3E | REAL (soundStatusCheck) | FULL |

### 1.5 Altri injectable rilevanti

| File | Sub | Stato |
|---|---|---|
| sprite-pos-update-1bab2.ts | fun_1CABA | FULL (sub-1caba-tile-redraw.ts replicato). Wirato SOLO in fun253ECDispatch NORMAL-path, NON in fun158F6 path. |
| sprite-project-1cc62.ts | fun_1CABA | FULL ma path no-op (argByte == 0 sempre) |
| slot-array-tick.ts | fun_14966 | **PARTIAL** (sub-14966-stub.ts head-only; skip slot 3 @ 0x401422) |
| sub-158f6.ts | helper121B8Subs | wirato come `undefined` da refresh-frame → tutte le subs NOOP di helper-121b8 saltano (incluso fun_29cce) |
| state-sub-19baa.ts | fun_19a40, fun_18f46, fun_1bb08, fun_1cc62, fun_19e42, fun_158ac | REAL (chain wirata da default-import) |
| particle-init-18cd2.ts | fun_26cfa, fun_18e6c | REAL |
| scroll-range-144e4.ts | fun_15a12, fun_14c46, fun_17346, fun_18ffa, fun_190ee | REAL |

### 1.6 NO_IMPL absoluti (subs senza file di replica)

| Nome | Addr | Caller | Note |
|---|---|---|---|
| fun_1bb08 | 0x1BB08 | helper-15148, state-sub-19baa | Mai chiamata in attract; probabilmente AI/gameplay. |
| fun_14dec | 0x14DEC | helper-15148 | id |
| fun_1d242 | 0x1D242 | entity-waypoint-step-1d1ec | id |
| fun_19692 | 0x19692 | state-sub-1960e | id |
| fun_19976 | 0x198BC | state-sub-198bc | id |
| fun_1937c | 0x1937C | state-sub-198bc | id |
| fun_4f38 | 0x4F38 | state-sub-5284 | sound (NO_IMPL) |
| fun_4dcc | 0x4DCC | sound-tick, state-sub-5284 | YM2151 (NO_IMPL) |
| fun_2ff28 | 0x2FF28 | level-dispatcher-16ec6 | level data |
| fun_2ff40 | 0x2FF40 | level-init-16f6c | level data |
| fun_2ffb8 | 0x2FFB8 | level-init-16f6c, slapstic-dispatcher, tilemap-row-build, level-dispatcher-16ec6 | slapstic / level decode |

---

## 2. Sub Callgraph Essential — `mainTick` (depth ≤ 5)

```
mainTick (FUN_28788) [0x28788]
├─ mainUpdateScrollSync                 FULL  (in-file)
├─ pfScrollUpdate (FUN_26D8A) cond      FULL  pf-scroll.ts
├─ paletteAnim1Tick (FUN_26BEE)         FULL  palette-anim.ts
├─ paletteAnim2Tick (FUN_26C78)         FULL
├─ paletteAnim3Tick (FUN_26D4E)         FULL  palette-queue.ts
├─ paletteQueueDrain (FUN_26B88)        FULL
├─ gameStateMachineTick (FUN_2E18)      FULL  10/10 subs wirate
│   ├─ stateSub2ABC (FUN_2ABC)            FULL
│   ├─ stateSub2678 (FUN_2678)            FULL
│   ├─ stateSub2BDA (FUN_2BDA)            FULL
│   ├─ stateSub2DA0 (FUN_2DA0)            FULL
│   ├─ stateSub2C60 (FUN_2C60)            FULL
│   ├─ stateSub295A (FUN_295A)            FULL
│   ├─ stateSub2572 (FUN_2572)            FULL
│   ├─ stateSub2CD4 (FUN_2CD4)            FULL
│   ├─ stateSub2766 (FUN_2766)            FULL
│   └─ stateSub2818 (FUN_2818)            FULL
├─ soundTick (FUN_4CA0)                 PARTIAL
│   ├─ soundDispatchSend (FUN_3E1A)       FULL
│   ├─ fun_4dcc (FUN_4DCC)                NO_IMPL (YM2151 minimal stub)
│   └─ soundStatusCheck (FUN_4C3E)        FULL
├─ gameTickTimers (FUN_28A96)           FULL
├─ trackballInputTick (FUN_1AC18)       FULL
├─ gameMainGate (FUN_28972)             FULL
├─ auxTimer (FUN_10146)                 FULL
├─ eepromCommit (FUN_3F78)              FULL
├─ specialAttract (FUN_288F8)           FULL
├─ particleBounce (FUN_18DCA) cond      FULL
└─ if runMainLoopBody (& 1 == 0):
    ├─ mainLoopInit1101E (FUN_1101E)    FULL
    │   ├─ refreshFrame10FCE (FUN_10FCE)             FULL orchestrator
    │   │   ├─ objectScanDispatch251DE → fun_253EC   FULL (dispatcher)
    │   │   │   └─ fun253ECDispatch (s1a=0 NORMAL):
    │   │   │       ├─ helper253BC (FUN_253BC)        FULL
    │   │   │       ├─ objectStep17F66 (FUN_17F66)    FULL  (callees fun1815A/180BE/26196)
    │   │   │       │   ├─ waypointListStep1815A     FULL
    │   │   │       │   ├─ fun180BE                  NOOP (no-op default)
    │   │   │       │   └─ fun26196                  NOOP
    │   │   │       └─ helper121B8 (FUN_121B8)        FULL chain ma:
    │   │   │           ├─ subs.fun_29cce            **NOOP** (sub-29cce.ts PARTIAL non wirato qui)
    │   │   │           ├─ subs.fun_1bc88 → helper1BC88  FULL
    │   │   │           ├─ subs.fun_1924e → helper1924E  FULL
    │   │   │           ├─ subs.fun_1cc62 → spriteProject1CC62  FULL
    │   │   │           │   └─ fun_1CABA → sub1CABATileRedraw   FULL  (wirato solo qui)
    │   │   │           ├─ subs.fun_25c74 → helper25C74         FULL
    │   │   │           └─ ... (tutti gli altri REAL)
    │   │   ├─ processAllSprites189E2                FULL
    │   │   ├─ objectUpdatePair158CC (FUN_158CC)     FULL
    │   │   │   └─ fun158F6 (FUN_158F6)              FULL
    │   │   │       ├─ helper253BC                   FULL
    │   │   │       ├─ helper182BA                   FULL
    │   │   │       │   └─ subs.fun_261bc → sub261bc FULL
    │   │   │       └─ helper121B8 (chain)           **PARTIAL**
    │   │   │           └─ helper121B8Subs == undefined → fun_29cce NOOP
    │   │   ├─ slotArrayTick (FUN_1493C)             FULL
    │   │   │   └─ fun_14966 → fun14966Stub          **PARTIAL** (head-only, skip slot 3)
    │   │   ├─ dispatchStrings17230                  FULL
    │   │   ├─ refreshHelper1912C                    FULL
    │   │   ├─ stateSub19BAA (FUN_19BAA)             FULL
    │   │   ├─ stateSub1844A (FUN_1844A)             FULL
    │   │   └─ stateDispatch12FD0 (FUN_12FD0)        FULL
    │   └─ ...
    └─ lateGameLogic26F3E (FUN_26F3E)               FULL bit-perfect
        ├─ bufferFill1B12A                          FULL
        ├─ sortAdjacentObjects1A7A8                 FULL
        └─ moBlockEmit1A8D2 per entity              FULL
```

### Conteggio chain critica per obj0
- Sub chiamate in path `fun253ECDispatch(obj0, s1a=0)`: **22 sub** invocate.
- Sub stubbed / NOOP in chain: **2** (`fun_29cce` NOOP, `fun_14966` head-stub via diversa chain).
- Sub PARTIAL: **2** (`fun_29cce` come PARTIAL non-wirato, `fun_14966` head-only).

---

## 3. Priority Sort per Drift Impact

Diff bytes vs MAME @ `/tmp/mame_100f.json` f+50 (frame 12050):

| workRam range | bytes | Region | Owner sospetto | Priority |
|---|---|---|---|---|
| 0x0039..0x0043 | 11 | obj0 offset 0x21..0x2B (state fields, timer chain) | helper121B8 BLOCK epilog / fun_29cce | **HIGH** |
| 0x00C1..0x00DD | 29 | obj0 offset 0xA9..0xC5 (sprite-pair / 0xA8 status) | sub-158f6 chain (helper121B8 via helper158F6) | **HIGH** |
| 0x01EF..0x021F | 49 | obj1 tail (0xF5..0xE1) + obj2 head (0..0x43) | object iter (slot 1/2 driven by helper158F6 via helper121B8) | **HIGH** |
| 0x03A6..0x03AF | 10 | globals 0x3A6..0x3AF (AV-toggle / scratch latch) | sync logic main-thread (FUN_FA0 main-loop snapshot non replicato bit-perfect) | MEDIUM |
| 0x03F0..0x0407 | 24 | globals 0x3F0..0x407 (frame counters, cursors emit late-game) | lateGameLogic26F3E cursor emit (sprite count drift) | MEDIUM |
| 0x0674..0x0683 | 16 | globals 0x674..0x683 (tile X/Y, X_RESTORE/Y_RESTORE) | fun_29cce epilog (writes globals 0x684/0x688), sub-158f6 chain | **HIGH** |
| 0x0691..0x0693 | 3 | globals 0x690..0x693 (snapshot X) | fun_29cce prologo snapshot | **HIGH** |
| 0x0706..0x074D | 72 | workRam[0x706..0x74D] (slot table 0x400706..) | sub-29cce loop outer (slot iter @ 0x400a9c stride 0x56) o state-machine table | **HIGH** |
| 0x098B | 1 | global 0x98B | minor | LOW |
| 0x136F..0x1373 | 5 | string slot @ 0x401300+ region | string-step-1725a / dispatch-strings-17230 | MEDIUM |
| 0x1386..0x138B | 6 | string slot region | id | MEDIUM |
| 0x13BD..0x13D3 | 23 | string slot region | id | MEDIUM |
| 0x13E6..0x13F3 | 14 | string slot region | id | MEDIUM |
| 0x141D..0x1421 | 5 | slot table @ 0x401422 (slot 3 anomaly!) | **fun_14966** head-stub skip | MEDIUM |
| 0x142F..0x1433 | 5 | slot table 0x401422+ | id | MEDIUM |
| 0x1446..0x144D | 8 | slot table | string slot 4/5 | MEDIUM |
| 0x147D | 1 | slot table | id | LOW |
| 0x1F56..0x1F57 | 2 | M68K stack tail (sopra il filtro 0x1d22..0x1eff) | M68K register push state residuo | LOW |

| spriteRam range | bytes | Region | Owner sospetto | Priority |
|---|---|---|---|---|
| 0x0000..0x001F | 32 | MO bank A entry 0..3 (Y) | lateGameLogic26F3E emit (slot/obj projection ≠ cache obj+0x1e/+0x20) | **MEDIUM** |
| 0x0080..0x009F | 32 | MO bank A entry 0..3 (code) | id | MEDIUM |
| 0x0100..0x011F | 32 | MO bank A entry 0..3 (X) | id | MEDIUM |
| 0x0195..0x0199 | 5 | MO bank A (counter / D7) | id | MEDIUM |
| 0x0200..0x021F | 32 | MO bank B entry 0..3 (Y) | id | MEDIUM |
| 0x0285..0x029F | 27 | MO bank B (code / chain) | id | MEDIUM |
| 0x0300..0x031F | 32 | MO bank B (X) | id | MEDIUM |
| 0x038D..0x0393 | 7 | tail | id | MEDIUM |

**SpriteRam drift cause primaria**: `obj0+0x1e` (= `Y_high - X_high + 0x88`) e `obj0+0x20` (= `HUD_OFFSET + Z_high + 0x54 - (X+Y)/2`) sono cache che il binario aggiorna via `spriteProject1CC62 → fun_1CABA` chain durante `helper121B8`. Dato che `helper121B8` per obj0 (path NORMAL) wira correttamente `fun_1CABA` ma il valore output non è scritto in `obj+0x1e/+0x20` perché manca un caller intermedio che fa il move-back. Vedi `late-game-logic-26f3e.ts` linee 162-218 (workaround `loadCoordsIsoPlayer`).

### Riepilogo offset → owner

- **fun_29cce (NOOP)** ⇒ workRam 0x691..0x693, 0x674..0x683 (epilog snapshots), 0x706..0x74D (loop outer su slot table @ 0x400a9c), parte di 0x39..0x43 (BLOCK tag writes 0x58/0x59 di slot).
- **sub-158f6 chain con helper121B8 senza fun_29cce wired** ⇒ obj0 0xC1..0xDD, obj1+obj2 a 0x1EF..0x21F.
- **fun_14966 (PARTIAL)** ⇒ slot table 0x141D..0x1421 (slot 3 skipped), 0x142F..0x1433.
- **fun_1CABA-related (workRam[0x1c28] STRUCT) write-back missing al obj+0x1e/+0x20** ⇒ spriteRam coords drift (vedi `loadCoordsIsoPlayer` come workaround).
- **obj0.z non integrato** ⇒ marble "galleggia": helper121B8 INTEGRATE_VEL non aggiorna obj+0x14..0x17 (z_long) perché path OUT_OF_RANGE non triggera (vz=0 quando z_proj==obj.z stub).

---

## 4. Roadmap Consigliata — TOP 10 Next

Ordine per impatto stimato sul drift workRam/spriteRam @100f:

### 4.1 [HIGH] Wire `fun_29cce` in helper121B8 caller chains
- **File**: `refresh-frame-10fce.ts` linea 122-128 + `sub-158f6.ts` linea 308 (passa helper121B8Subs={ fun_29cce: (s, a) => sub29CCE(s, rom, a) })
- **Risolve**: 72 byte @ 0x706..0x74D (slot table iter), 16 byte @ 0x674..0x683 (epilog globals), 3 byte @ 0x691..0x693 (snapshot prologo). Stimato ~90 byte di drift workRam.
- **Status**: replica PARTIAL in `sub-29cce.ts` già esiste; basta wire. Trade-off: i BLOCK complessi (bounce, respawn, sound 0x43/0x44) sono fallthrough no-op nel partial — per obj0 attract questo è dimostrato bit-perfect (vedi commento sub-29cce.ts l. 36-58).
- **Test**: `test-sub-29cce-parity.ts` da creare se non esiste; verificare drift @ f+50.

### 4.2 [HIGH] Replica completa `FUN_1BC88` chain side-effect su slot 1/2
- **File**: `helper-1bc88.ts` (FULL bit-perfect su single-slot pair). Verificare side-effect cross-slot.
- **Risolve**: 49 byte @ 0x1EF..0x21F (slot 1+2 tail/head), 29 byte @ 0xC1..0xDD (obj0 0xA9..0xC5).
- **Status**: helper-1bc88 ha parity test passing su isolated calls; ma quando invocato da fun158F6 senza wire di fun_29cce le iter su obj1/2 divergono.

### 4.3 [HIGH] Completare `sub-14966` (slot ticker tick branch)
- **File**: `sub-14966-stub.ts` → replica full `FUN_00014966` (188 istr) + sub-callee `FUN_150D0`.
- **Risolve**: 5 byte @ 0x141D..0x1421 (slot 3 anomaly), 5 byte @ 0x142F..0x1433, 8 byte @ 0x1446..0x144D. Stima ~20 byte workRam.
- **Status**: solo head replicato; quando ticker raggiunge limit serve full body (long-counter increment + clear +0x2c + chain).

### 4.4 [HIGH] obj.z integration in helper121B8 (root cause "marble galleggia")
- **File**: `helper-121b8.ts` linea 480 — il path `D0 - obj.z` con stub `fun_1cc62 → obj.z` produce `D0=0` → INTEGRATE_VEL eseguito con vz preservato ma **vz è sempre 0** in attract gameplay (no input). Verificare che `lateGameLogic26F3E.loadCoordsIsoPlayer` legga il `z` corretto e scriva back a obj+0x14.
- **Risolve**: drift visivo marble (Z non scende verso terrain), parte del drift spriteRam.
- **Status**: workaround `loadCoordsIsoPlayer` calcola y_screen on-the-fly bit-perfect, ma il caching obj+0x1e/+0x20 resta divergente. Fix bit-perfect richiede write-back nel path helper121B8 oppure cache invalidation sync.

### 4.5 [MEDIUM] Write-back obj+0x1e / obj+0x20 da spriteProject1CC62
- **File**: identificare il chiamante che scrive `obj+0x1e` (= D3w da loadCoordsIsoPlayer formula) e `obj+0x20`. Cercare in disasm chiamanti di `FUN_1CC62` + `FUN_1CABA` chain (probabile `FUN_19E42` marble-cell-dispatch).
- **Risolve**: spriteRam drift ~80% (bank A+B entry 0..3 X/Y/code).
- **Status**: replica FUN_19E42 esiste in `marble-cell-dispatch-19e42.ts` — verificare wiring nel refresh path.

### 4.6 [MEDIUM] Replica `FUN_1BB08` (helper-15148 + state-sub-19baa caller)
- **File**: NO_IMPL — creare `helper-1bb08.ts`.
- **Risolve**: drift latente quando entity attivi (al momento mai chiamato in attract, ma serve per gameplay → ROM 0x1BB08).

### 4.7 [MEDIUM] String slot drift (workRam 0x136F..0x13F3)
- **File**: `string-step-1725a.ts`, `dispatch-strings-17230.ts` — analizzare quale string-slot field manca.
- **Risolve**: 68 byte di drift workRam (4 ranges in zona 0x1360..0x1400).
- **Status**: probabile mismatch frame-counter o cursor in string slot. Servirà differential probe più mirato.

### 4.8 [MEDIUM] FUN_FA0 main-loop snapshot completion
- **File**: `main-tick.ts` linea 285 — l'epilog `r[0x14] = r[0x11]` è stub minimo del main-thread loop (FUN_FA0). Workram[0x3A6..0x3AF] drift (10 byte) probabile causato da side-effect mancanti in questa zona.
- **Risolve**: 10 byte @ 0x3A6..0x3AF + correzioni minori a 0x12..0x14.

### 4.9 [LOW] FUN_4DCC YM2151 emulation
- **File**: `state-sub-5284.ts`, `sound-tick.ts` — emulazione completa di chip YM2151. Drift impatto visivo nullo, solo sound.

### 4.10 [LOW] Catch-all NO_IMPL: `fun_14dec`, `fun_1d242`, `fun_19692`, `fun_19976`, `fun_1937c`
- Tutte mai chiamate in attract steady-state (gated da entity state). Diventeranno HIGH in level-load / gameplay attivo.

---

## Riepilogo Numerico

- **Sub injectable totali** (via `fun_X?:` regex): 151 in 60+ file.
- **Sub effettivamente NO-OP quando chiamate da `mainTick({runMainLoopBody:true})`**: ~6 (fun_29cce, fun_4dcc, fun_1bb08, fun_14dec, e altre rare).
- **Sub PARTIAL (stub-only header)**: 2 (sub-29cce.ts, sub-14966-stub.ts).
- **Sub NO_IMPL (file inesistente)**: ~10 (4dcc, 4f38, 1bb08, 14dec, 1d242, 19692, 19976, 1937c, 2ff28, 2ff40, 2ffb8).
- **Sub FULL parity-tested**: ~253 (cli `test-*-parity.ts` files).

Drift residuo @ f+50: 155 byte workRam + 160 byte spriteRam. Top owner stimati:
1. `fun_29cce` NOOP (~90 byte workRam).
2. `helper121B8` su slot 1/2 senza fun_29cce wire (~80 byte workRam @ obj1/2 + 29 byte obj0).
3. `obj+0x1e/+0x20` cache stale (~150 byte spriteRam su bank A+B).
4. `fun_14966` head-only + slot-3 skip (~25 byte workRam).
5. Stringa slot + frame cursor (~70 byte workRam @ 0x136F..0x13F3 + 0x3F0..0x407).
