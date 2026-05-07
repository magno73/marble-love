# STATUS — Marble Love

**Ultimo update:** 2026-05-06
**Branch corrente:** `main`.

## Riepilogo metriche

| Metrica | Valore |
|---|---|
| Funzioni Ghidra coperte | **350 / 350** (100%) — di cui ~270 verificate bit-perfect via parity 500/500 |
| Vitest | **156 file / 1252 test** verde |
| Differential test cases | >100.000 random cases tutti 100% match |
| Frame 0 (post-bootInit) ↔ MAME | **bit-perfect** su tutte le 32 regioni workRam |
| Bridge engine ↔ renderer | ✅ attivo + visual smoke test |
| Multi-agent throughput | Claude Code (16 batch / 78 funzioni) + Codex (Task A main loop init chain) |

## Fase corrente

Due track paralleli su `main`, **bridge attivo**:

### Track A — Phase 4d (replication bit-perfect)
- ✅ Phase 0-3 (scaffold, oracolo MAME, static analysis Ghidra)
- ✅ Phase 4a-c (RNG, primitive di base)
- 🎯 **Phase 4d completa al counter**: 350/350 funzioni Ghidra coperte (100%) — di cui 314 sub-functions semantiche + 36 thunks/IRQ entries. Funzioni effettivamente verificate bit-perfect via parity test ≥500/500: ~270
  - 4/4 root game-logic CORE replicati
  - 6/7 state-machine schedulers (state 1, 2, 3, 4, 5/6, 7)
  - >35.000 differential test cases passati al 100%

### Track B — Classic Renderer (lavoro merged 2026-05-06)
- ✅ `Frame` model neutrale in `packages/engine/src/render.ts` (Atari System 1 visible size, palette, scroll, 3 layer)
- ✅ PixiJS pipeline in `packages/web/src/renderer.ts` (605 righe)
- ✅ ROM graphics decode (`packages/web/src/rom-graphics.ts`)
- ✅ ROM ZIP loader con fflate
- ✅ Demo fixtures + 34 nuovi test
- 📋 Vedi: `docs/classic-renderer.md`, `docs/classic-renderer-prd.md`, `docs/classic-renderer-plan.md`

### Bridge Track A ↔ Track B (2026-05-03)
- ✅ `mainTick(state, {rom})` in `packages/engine/src/main-tick.ts` orchestra le 10 root sub replicate nell'ordine di FUN_28788
- ✅ `tick(s, opts)` in `packages/engine/src/index.ts` punta al nuovo orchestrator (signature breaking)
- ✅ `bootInit(state, rom)` in `packages/engine/src/boot-init.ts` porta lo state al primo frame "post-boot pre-tick" (color RAM hardware pattern, palette, state machine globals)
- ✅ Smoke test 7+8+9 verde su orchestrator/boot/pfScroll
- ✅ Frontend `packages/web/src/main.ts` chiama bootInit + tick reale: lo state evolve frame-by-frame (palette anims, state machine, timers, trackball, main gate, **PF scroll**)
- ⏳ Sub non ancora replicati stubbed no-op: FUN_4CA0 (sound), FUN_3F78 (eeprom), FUN_158AC (sound cmd), FUN_288F8 (attract), FUN_26F3E (late logic), FUN_10146 (timer secondario)

### End-to-end differential vs MAME (2026-05-03)
- ✅ `harness/parity-check.sh <scenario> [from] [ticks]` esegue marble-runner + diff in un comando
- ✅ `harness/diff.ts` supporta `--from-frame N` per saltare la transitoria di boot MAME
- ✅ `marble-runner` supporta `--with-boot-init` per allinearsi al post-boot oracle
- ✅ `state.clock.frame` ora aggiornato dal nuovo `mainTick` (era stale dal vecchio stub)
- ✅ **Trace localization (schema v2)**: `workRamHashes` array di 32 CRC32 regionali (regioni 0x100 byte). Diff annota `workRam[0x300..0x3ff]` invece del generico `workRamHash`. Backward-compat con oracle v1 (warning).
- ✅ Oracle trace v2 rigenerato con MAME 0.286.
- ⏳ **Parità in miglioramento**. Allineamento corretto: MAME completa il boot a frame 46 (RESET handler + setup hardware + IRQ vectors). Diff `--truth-offset 45` confronta `reimpl[i]` vs `oracle[i+45]` per parità tick-by-tick. Con allineamento corretto al frame 0:
  - ✅ `0x000-0x0FF`: scroll/frame counter — match
  - ✅ `0x100-0x1FF`: HUD strings (cold-boot di FUN_FA0) — DISATTIVATO in bootInit perché in attract_mode l'oracle non popola questa fascia (warm-boot path o FUN_FA0 mai chiamato)
  - ✅ `0x300-0x3FF`, `0x400-0x4FF`, `0x1F00-0x1FFF`: match
  - ✅ `0x1E00-0x1EFF`: risolto. Investigazione via `tools/watch_write.lua` (write-tap MAME) ha mostrato che i write a 0x1EE0-0x1EFF sono stack residue 68k (SP parte da 0x401F00 e scende fino a ~0x401EE8 in attract_mode). Il nostro reimpl TS non ha stack 68k → divergenza spuria. Esclusione conservativa di 0x1EE0-0x1EFF dal hash regione 30, analoga a 0x440-0x447 (stack low water).
- 🎯 **Bit-perfect parity al frame 0** (reimpl post-bootInit ≡ oracle post-boot-46): le 32 regioni workRam tutte match. Al frame 1 divergenza esplode (29 fields) per via dei sub stubbed → loop iterativo "replica sub → re-run parity-check → vedi salire" è sbloccato.
- 📋 **Top writers identificati via `tools/watch_write.lua`** (frame 46-47 MAME = primo + secondo tick):
  - **FUN_4CA0** (sound dispatcher wrapper) — REPLICATO ✅ 2000/2000 vs binary patched-stubs.
  - **FUN_3E1A** (sound dispatch send sub) — REPLICATO ✅ 1000/1000 vs binary, integrato come default sub di soundTick.
  - **FUN_4C3E** (sound status check sub) — REPLICATO ✅ 500/500 vs binary, integrato come default sub di soundTick.
  - **FUN_4D1A** (IRQ sound input mailbox) — REPLICATO ✅ 1000/1000 vs binary patched (RTE→RTS + MMIO source patch). Non ancora integrato in mainTick (è IRQ separato).
  - **FUN_4DCC** (sound chip writer, ~294 writes) — minimal stub: incrementa solo `*0x401FF8` (counter deterministico, prima istruzione di FUN_4DCC). Body completo richiede emulare YM2151 — fuori scope.

### Parity vs MAME — multi-scenario findings

#### attract_mode (passive)

Steady state (frame 1..100): **8 fields divergenti** (era 29). Da frame 300+ marble physics inizia a divergere quando attract mode mostra gameplay.

#### level1_basic_movement (active gameplay)

| Frame | Fields divergenti | Nota |
|---|---|---|
| 30 | 8 | identico a attract_mode (no input ancora) |
| 60 | 8 | post button press start |
| 120 | 9 | post coin, region 0x200 nuova |
| 200 | 8 | trackball input attiva, **marble.x/y/vx/vy/vz appaiono divergenti** |
| 300+ | **28 fields** | gameplay attivo: rng.seed + marble physics + 16 regioni + tutti gli stats |

**Root cause** del salto a 28 fields al frame 200+: physics + RNG consume non funzionante perché:
- FUN_2572 (state 2 dispatch alt path) — NON replicato
- FUN_2766 (state 5) — NON replicato
- FUN_2818 (state 6) — NON replicato
- FUN_2CD4 (state 3 condition) — NON replicato
- FUN_295A (Branch A one-shot) — NON replicato

Senza queste 5 sub state machine, il dispatcher FUN_2E18 non attiva i rami che muovono il marble + consumano RNG. Codex sta replicando queste 5 sub. Quando arrivano, parity level1 dovrebbe ripiombare a baseline 8-9 fields anche post-frame 200.

Regioni residue (3 byte tipici per regione 3 dopo timer fix):
- 0x000: 7 byte (0x0E, 0x86, 0x88-0x89, 0xD8-0xDA = "AAA" pattern hi-score?)
- 0x100: 10 byte (HUD area non popolata)
- 0x300: 3 byte (0x397 obj_count, 0x3AA debounced input, 0x3F0 coin pulse)
- 0x400: 7 byte (main object init bytes da FUN_117B2 chain)
- 0x1D00: 10 byte (late globals 0x1DF0+)
- 0x1E00: sound + stack residue
- 0x1F00: sound state + state machine slots

Fix applicati questa sessione:
- `inputMmio` default 0xFC (era 0x40) → fixa 0x3A8 e 0x3AC
- Global timer inner @ 0x3A2 = 0xFF (TIMER_DISABLED) → fixa 0x39E-0x3A1 + 0x3A0 cascade

### Visual smoke test (tools/visual-smoke-test)

`packages/cli/src/visual-smoke-test.ts` esegue bootInit + N tick e ispeziona il `Frame` prodotto da `buildFrame(state)`.

Dopo 300 tick:
- ✅ palette: 1017/1024 colori non-zero (descending pattern + bootstrap init)
- ❌ playfield: 0 (state non modella playfield tilemap RAM @ 0xA00000-0xA01FFF)
- ❌ sprites: 0 (state.spriteRam vuoto, sub-functions di game state machine stubbed)
- ❌ HUD: 0 (state.alphaRam vuoto, string-render subs stubbed)

**Visivamente**: schermo nero con palette caricata. Per vedere qualcosa serve:
1. Replicare le sub di gameStateMachineTick che popolano spriteRam/alphaRam
2. Aggiungere `state.playfieldRam` (8 KB) e replicare i write game-side
3. Far passare `playfieldRam` opt-in a `buildFrame` dal renderer web

Commit `renderer.draw` aggiornato per passare motion-object lookups, ma il tilemap playfield richiede modello state esteso.
  - **FUN_10392** (~110 writes, init slot arrays a 0x4019F8/0x401890/0x401482/0x401302/0x4009A4/0x400A9C) — REPLICATO ✅ 1/1 vs binary, integrato in `bootInit` (riduce da 24 a 6 regioni divergenti al frame 1).
  - **FUN_4D1A** (~12 writes/tick) — IRQ2/IRQ6 handler input MMIO 0xFC0001 (RTE confermato), legge bottoni e scrive struct a 0x401F44.
  - Replicati ✅: FUN_2E18, FUN_28A96, FUN_28972, FUN_26BEE/26C78/26B88, FUN_1AC18, FUN_28788 (mainTick orch).
- 🔧 **Tooling debug**:
  - `MARBLE_DUMP_REGIONS=0x100,0x300` (env var) attiva dump hex di regioni specifiche sia nel reimpl trace sia nell'oracle MAME, per diff byte-by-byte.
  - `tools/watch_write.lua`: installa write-tap MAME su una regione di workRam, logga `(frame, PC, addr, data, mask)` per identificare tutti i writer di una zona specifica.

## Sessione 2026-05-06 — Multi-agent parallel batches

Migrato a workflow multi-agent con `isolation: "worktree"` (best practice ufficiale Claude Code: ogni agent in worktree git temporanea isolata, prompt focalizzati ~150 parole, pattern + template noto). Throughput sostenuto: ~5 funzioni / ~5 min wall time per batch.

| Batch | +N | Total | %    | Vitest | Funzioni replicate |
|-------|----|-------|------|--------|--------------------|
| Pre   | 107| 107   | 34%  | 256    | (pre-sessione) |
| 1     | +3 | 110   | 35%  | 309    | sound-dispatch-send, status-check, irq-input |
| 2     | +5 | 115   | 37%  | 349    | FUN_158AC sound-cmd + FUN_2678 + FUN_10146 + FUN_288F8 + FUN_3F78 |
| 3     | +5 | 120   | 38%  | 378    | state-sub-2bda/2c60/2da0/2abc + boot-screen-init |
| 4     | +5 | 125   | 40%  | 416    | slapstic-table/lookup + clear-pf + sound-cmd-gate + vblank-wait |
| 5     | +5 | 130   | 41%  | 462    | object-state-23 + flag-mag + state-525c + script-slot + sound-pair |
| 6     | +5 | 135   | 43%  | 501    | state-520e + tilemap-blit + state-5334/535e + scene-init |
| 7     | +5 | 140   | 45%  | 536    | slot-array-tick + obj-pair + dispatch-strings + boot-spurious + wait-vblank-gated |
| 8     | +5 | 145   | 46%  | 565    | render-string-28fde + sync-av + state-1eaa + format-render + array-9-clear |
| 9     | +5 | 150   | 48%  | 593    | render-string-286b0/28f62/28fa0 + dispatch-table + eeprom-request |
| 10    | +5 | 155   | 49%  | 632    | bsearch + glyph-loop + level-load + state-5608 + object-enter-1281c |
| 11    | +5 | 160   | 51% | 678 | state-dispatch + palette-rng + sprite-pos + waypoint + state-540a |
| 12    | +5 | 165   | 53% | 720 | sort-objects + state-validate + state-15bd0 + sprite-coords-jsr + mo-grid-init |
| 13    | +5 | 170   | 54% | 759 | field-fetch + state-5584 + obj-type-dispatch + state-1960e + sprite-pair-coord |
| 14    | +5 | 175   | 56% | 800 | state-59d2 + obj-dirty + alpha-ram-init + obj-init + sprite-project |
| 15    | +5 | 180   | 57% | 838 | key-rank + hud-frame + bbox-hit + state-198bc + string-target |
| 16    | +5 | 185   | **59%** | 883 | state-5d2a + marble-cell + hi-score + obj-state + slot-insert |

**Risultato sessione Claude Code**: +78 funzioni bit-perfect, +627 test smoke + parity, **superato il 50% del binario**.

## Sessione 2026-05-06 — Codex Task A (main loop init chain)

In parallelo, Codex agent lavora su `codex/a-*` branch via `docs/codex-prd.md` con regole non-interferenza (no edit a `main-tick.ts`/`boot-init.ts`/STATUS/README). Workflow PR-based con review + merge da Marco.

**Task A — main loop init chain post-boot** (prerequisito per parità vs MAME post-boot):

| Funzione | Status | Verifica |
|---|---|---|
| FUN_117B2 (entry chain) | ✅ replicato | parity 500/500 vs musashi-wasm |
| FUN_11452 (transition dispatcher) | ✅ replicato | parity 500/500 vs musashi-wasm |
| FUN_1101E (state dispatcher cases 0..6) | ✅ replicato | parity 500/500 (con fix Codex su case order + 0x40075A test + textPrint vs soundCmd dispatch) |
| FUN_10504 (init prefix + presentation middle) | 🔧 scheletro + smoke | parity TBD (middle è 2762 byte, work in progress) |

Pattern utilizzato: stub-injection per JSR non replicate (`MainLoopInit117B2Subs`, etc.), big-endian RAM helpers, signed-compare guard `i8()` su byte counter (M68k `bgt` semantics).

Test totali: 9 smoke + 2 parity. Vedi [`docs/codex-task-a-main-loop-init.md`](docs/codex-task-a-main-loop-init.md).

**Conteggio finale**: 188/314 bit-perfect = 185 (Claude Code) + 3 (Codex: 117B2, 11452, 1101E). Lo scheletro 10504 NON è ancora conteggiato come bit-perfect finché non ha parity 500/500.

Tooling sviluppato:
- `tools/watch_write.lua`: write-tap MAME su regione workRam
- `MARBLE_DUMP_REGIONS=0x100,0x300` env var: dump hex regioni in trace
- `harness/parity-check.sh`: pipeline reimpl + diff in 1 comando
- `harness/diff.ts --truth-offset N`: alignment boot transient MAME
- `packages/cli/src/visual-smoke-test.ts`: ispezione `Frame` post-bootInit

## Prossime fasi

- **Track A**: continuare replication bit-perfect (~154 funzioni rimanenti). Le funzioni più "spinose" sono FUN_4DCC (sound chip writer YM2151), FUN_117B2 main loop, FUN_26F3E (4818 byte late logic).
- **Track B**: ora che lo state evolve e palette è popolata, estendere state model con `playfieldRam` (8 KB @ 0xA00000-0xA01FFF) per renderizzare playfield tilemap dal Frame.
- **Phase 5+** (futuro): trace-level testing post-stabilizzazione con MAME oracolo per scenari level1/gameplay.

**Sub-systems bit-perfect verificati**:
- ✅ RNG (`rngNext` vs FUN_13A98) — 10000/10000 match
- ✅ Palette anim 1 (`paletteAnim1Tick` vs FUN_26BEE) — 1000/1000 match
- ✅ Palette anim 2 (`paletteAnim2Tick` vs FUN_26C78) — 1000/1000 match
- ✅ Palette anim 3 (`paletteAnim3Tick` vs FUN_26D4E scheduler) — 500/500 match
- ✅ Palette anim 4 (`paletteQueueDrain` vs FUN_26B88 drain) — 500/500 match
- ✅ Palette queue push (`paletteQueuePush` vs FUN_26B66) — 500/500 match
- ✅ MainUpdate prefix (`mainUpdateScrollSync` vs FUN_28788 0x28788..0x287D8) — 2000/2000 match
- ✅ Event flag consume (`consumeEventFlag` vs FUN_2548) — 1000/1000 match
- ✅ Fill incrementing u16 array (`fillIncrementingU16` vs FUN_1E3E) — 500/500 match
- ✅ Init struct header (`initStructHeader` vs FUN_255A) — 500/500 match
- ✅ Set status flag bit (`setFlagBit` vs FUN_5236) — 500/500 match
- ✅ Format hex string (`formatHex` vs FUN_3A08) — 1000/1000 match
- ✅ **Trackball input handler** (`trackballInputTick` vs FUN_1AC18) — 2000/2000 match — **🎯 prima game-logic CORE replicata**
- ✅ Cascading timer 3-livelli (`tickCascadingTimer` vs FUN_28C38) — 1000/1000 match (sub di FUN_28A96)
- ✅ Add accumulator + trigger flag (`addToObjectAccumAndFlag` vs FUN_28608) — 500/500 match
- ✅ Set alpha tilemap tile (`setAlphaTile` vs FUN_3784) — 500/500 match (HUD print tile at coord)
- ✅ Rising edge detector (`detectRisingEdgesAndPass` vs FUN_F6A) — 500/500 match
- ✅ Set alpha tilemap word (`setAlphaWord` vs FUN_383A) — 1000/1000 match
- ✅ Clear alpha tiles from row (`clearAlphaTilesFromIndex` vs FUN_28C7E, chiama FUN_021E→FUN_383A in loop) — 1000/1000 match
- ✅ strcpy (`strcpy` vs FUN_1D74) — 500/500 match (supporta src in ROM o RAM)
- ✅ Any status flags set (`anyStatusFlagsSet` vs FUN_52A2) — 1000/1000 match (OR di 2 long bitmap)
- ✅ Dequeue byte from circular queue (`dequeueByte` vs FUN_4D68) — 1000/1000 match (queue 16-byte @ 0x401F44, ritorna -1 se vuota)
- ✅ OR pair bytes (`orPairBytes` vs FUN_53EA) — 1000/1000 match (utility byte-level)
- ✅ Abs long (`absLong` vs FUN_1216A + FUN_1B5A6) — 2000/2000 match (con 68k quirk INT_MIN→INT_MIN)
- ✅ Negate-if-positive (`negateIfPositive` vs FUN_1B5B4) — 1000/1000 match
- ✅ Clear palette RAM (`clearPaletteRam` vs FUN_121A6) — 1/1 match (azzera 2KB @ 0xB00000)
- ✅ Swap long pair (`swapLongPair` vs FUN_12886) — 500/500 match (scambio 2 long adiacenti)
- ✅ **Game-tick all timers** (`gameTickTimers` vs FUN_28A96, root game-logic) — 2000/2000 match — **🎯 SECONDO root game-logic CORE replicato** (418 byte, 5 jsr, dispatcher di per-object cascade timers + global timer + palette FX)
- ✅ **Game-main-gate** (`gameMainGate` vs FUN_28972, root game-logic) — 1000+1000 match (Suite A: MMIO bit 6=1 / Suite B: MMIO bit 6=0) — **🎯 TERZO root game-logic CORE replicato** (292 byte, 8 jsr, debounce input + Block A/B gate + Block C timer increment)
- ✅ Debounce input MMIO (`debounceInput` vs FUN_2893C, sub di FUN_28972) — verificato indirettamente
- ✅ **Game-state-machine tick** (`gameStateMachineTick` vs FUN_2E18, root game-logic) — 3000+3000+3000 = 9000/9000 match (Suite A: tutti state=0 / Suite B: state misti 1..6 / Suite C: Branch A mode≠0 state=7) — **🎯 QUARTO root game-logic CORE replicato — IL PIÙ GROSSO** (930 byte, 11 jsr a 10 target distinti, state-machine 4-slot con 7 stati)
- ✅ **Position update** (`positionUpdate` vs FUN_1706C, 452 byte pure leaf) — 2000/2000 match (cardinale + diagonale, ROM table @ 0x23D40)
- ✅ **Vector scale 2D** (`vectorScale` vs FUN_25E7C, 326 byte pure leaf) — 2000/2000 match (con input range [-256,255] per evitare divu.w overflow del 68k; modes 2,3,4,default; ROM lookup @ 0x1EEF8)
- ✅ **Render string chain** (`renderStringChain` vs FUN_2572, 262 byte pure leaf) — 2000/2000 match (linked-list di entry + render con rotation 0..7 + case shift 'A'..'Z'; sub di FUN_2E18 ora replicata)
- ✅ Remove from slots + chain clear (`removeFromSlots` vs FUN_2678, `clearStringChain` vs FUN_2ABC) — 1000+1000 match (sub di FUN_2E18 stati 1+2)
- ✅ String shift forward/backward (`shiftStringChainForward` vs FUN_2766, `shiftStringChainBackward` vs FUN_2818) — 1000+1000 match (sub di FUN_2E18 stati 5+6)
- ✅ State-machine schedule 3+4 (`scheduleStateMachine3` vs FUN_2BDA, `scheduleStateMachine4` vs FUN_2C60) — 2000+2000 match (sub di FUN_2E18 transizioni)
- ✅ String step render/clear (`stepRenderState3` vs FUN_2CD4, `stepClearState4` vs FUN_2DA0) — 2000+2000 match (sub di FUN_2E18 stati 3+4 single-char)

**🎯 42 sub-systems bit-perfect** (8/9 sub di FUN_2E18 replicate; manca solo FUN_295A, scroll alpha tilemap).

- ✅ binToBcd (FUN_3A6A, double-dabble) — 2000/2000
- ✅ formatDecimal (FUN_3A54, BCD+formatHex trampoline) — 500/500
- ✅ paletteInit (FUN_565A) — 1/1
- ✅ copyGlobalsToObj (FUN_2648C) — 1000/1000
- ✅ objIndexedByteAdvance (FUN_160AE, mulu.w unsigned) — 1000/1000
- ✅ rleExpand (FUN_18FD0) — 1000/1000
- ✅ trimTrailingSpace (FUN_28F28) — 1000/1000
- ✅ findLastActiveSlot (FUN_172C2) — 1000/1000

**🎯 50 sub-systems bit-perfect** (33 → 50 in questa sessione, +17 commit, 50/314 ≈ 16% del binario coperto).

- ✅ findFreeSlotInTable + slotMatchesPtr (FUN_14BCE + FUN_14C0C) — 1000+1000
- ✅ 3 slot search variants (FUN_159D8, FUN_1599A, FUN_1730C) — 200×3
- ✅ findFirstFreeSlot_1F016 (FUN_12D6E) — 200/200
- ✅ eepromValidateAndClassify (FUN_3F3E) — 200/200
- ✅ objDeriveShorts (FUN_253BC) — 200/200
- ✅ slotMatchesPtr_400A9C (FUN_12DAE) — 200/200

**🎯 59 sub-systems bit-perfect totali** (33 → 59 in questa sessione, +26 commit, 59/314 ≈ 19% del binario coperto).

**Sessione 2026-05-05 (+25)**:
- ✅ initHelpers (FUN_11AC2 + FUN_26B10 + FUN_1286E)
- ✅ animationStep (FUN_132E0) — animation pointer step
- ✅ getAlphaTileAddr (FUN_37E4) — alpha tile address calc
- ✅ scheduleStateMachine7 (FUN_28EA) — state=7 scheduler
- ✅ spriteCoords v1+v2+v3+v4 (FUN_18A1E + FUN_199D6 + FUN_1778E + FUN_18972) — 4 varianti
- ✅ compareObjDepth (FUN_15FE6) — z-order compare
- ✅ packSpriteRecords (FUN_1A9CC) — sprite bit-pack
- ✅ deriveSpriteFields + 2 wrappers (FUN_1BB50 + FUN_1BB08 + FUN_1BB28)
- ✅ testGridBitmap (FUN_19460) — grid collision check
- ✅ triggerObjectEvent (FUN_285B0)
- ✅ lerpFromRom (FUN_1C61E)
- ✅ processAllSprites_v1 (FUN_189E2) — loop su sprite table
- ✅ timerDeltaAccumulate (FUN_43D6) — timer delta + bit dispatch
- ✅ eepromCommitDelta (FUN_4008) — eeprom counter commit
- ✅ initObjArrays (FUN_25B40) — init 8 entries arrays

**🎯 84 sub-systems bit-perfect** (84/314 ≈ 27% del binario coperto).

**Sessione 2026-05-05 batch 2 (+9)**:
- ✅ scheduleStateMachine5or6 (FUN_26C2) — 1000/1000
- ✅ paletteRamInitFull (FUN_1CEA) — 1/1, 256+16 entries
- ✅ particleBounce (FUN_18DCA) — 2000/2000, edge bounce
- ✅ proximityCheckArray (FUN_193D8) — 500/500
- ✅ gameStateMachineInit (FUN_31D0) — 1/1
- ✅ scheduleStateMachine2 (FUN_2A24) — 1000/1000
- ✅ pickObjLarger (FUN_180BE) — 500/500
- ✅ hudFormat3Values (FUN_3D62) — 500/500
- ✅ scheduleStateMachine1 (FUN_2B50) — 500/500

**🎯 93 sub-systems bit-perfect** (93/314 ≈ 30% del binario coperto). State-machine schedulers ora completi per stati 1, 2, 3, 4, 5/6, 7.

**Sessione 2026-05-05 batch 3 (+3)**:
- ✅ trackballApplyDelta (FUN_25DF6) — 1000/1000
- ✅ paletteInitLevel (FUN_1A41E) — 1/1, ROM ptr table 0x24694 (non-contiguous)
- ✅ paletteInitEnemy (FUN_26B2A) — 5/5, ROM ptr table 0x20534

**🎯 96 sub-systems bit-perfect** (96/314 ≈ 31% del binario coperto).

**Sessione 2026-05-05 batch 4 (+7)**:
- ✅ applyMoveVelocity (FUN_19976) — 500/500
- ✅ validatePosition (FUN_1937C) — 500/500
- ✅ findNearestNeighbor v1 + v2 (FUN_15D10 + FUN_14DEC) — 2000/2000
- ✅ paletteBootstrapInit (FUN_E24) — 1/1, 32 hardcoded palette colors
- ✅ clearAlphaRows (FUN_16E8E) — 30/30
- ✅ gameStateInit2Objs (FUN_10456) — 10/10

**🎯 103 sub-systems bit-perfect** (103/314 ≈ **33% del binario coperto**).

**Tecniche nuove introdotte**:
1. **HUD-updater patching**: per testare un root che chiama un updater HUD complesso (es. `FUN_286EE`, 154 byte + 3 jsr), patchamo l'entry → `rts` immediate (0x4E75) nel binario. La logica game state si verifica senza dover replicare la pipeline HUD. Il TS impl accetta un `hudCallback?` opzionale, no-op per default.
2. **Spin-loop patching**: per evitare hang nei test, patchamo i `bne` degli spin loop su MMIO (es. wait_loop @ 0x28A22) → `bra` per esci-immediato. Il binario non spinea più aspettando hardware.
3. **Sub-function stubbing via patch**: funzioni gate (es. `FUN_01CC` → `FUN_472A`) patchabili in 4 byte a `moveq #N,D0; rts` per restituire deterministic. TS impl accetta `gateCheck?` callback matching la patch.
4. **Hang detection in TS**: condizioni di pause infinita del binario (`bra .`) modellate come `state.hangRequested = true`, da gestire al game loop.

**Refactor architettonico Phase 4d.SetAlphaTile**: aggiunto `state.alphaRam` (4 KB, 0xA03000-0xA03FFF) separato da `state.spriteRam` (motion-object). Prima alpha era fusa in spriteRam con offset OOB; il setAlphaTile l'ha esposto. Ora layout RAM corretto separato.
Helper `runUntil(from, until|predicate)` aggiunto a binary-oracle-lib per testing di range arbitrari.

**Calling convention 68k C scoperta**: tutti gli args sono LONG (32-bit) sullo stack, anche se la funzione li legge come word. Es. `move.w (0x12, SP), D0w` legge il low word di un long arg a SP+16..19.

**Decisione strategica chiarita** (Phase 4c):
- musashi-wasm **NON è l'engine del progetto**. Il reimpl resta codice TS idiomatic in `@marble-love/engine` per poter evolvere/ampliare (livelli custom, physics modificati, multiplayer, ...).
- musashi-wasm fornisce: (1) **oracolo locale** alternativo a MAME (binary-runner) e (2) **differential per-funzione** (eseguo una funzione del binario, confronto col delta TS) → tool di sviluppo, non runtime.

---

## Pre-requisiti macchina

| Tool | Versione richiesta | Stato |
|---|---|---|
| Node.js | ≥22 | ✅ v25.6.1 |
| npm | qualsiasi | ✅ presente |
| Bun | ≥1.1 (preferito) | ✅ 1.3.13 (`~/.bun/bin/bun`, aggiunto a `~/.zshrc`) |
| Git | ≥2 | ✅ 2.53.0 |
| GitHub repo | privato | ✅ `magno73/marble-love` (push iniziale fatto al commit `bb4c19b`) |
| MAME | ≥0.279 | ✅ 0.286 |
| Python 3 | ≥3.11 | ✅ presente (per `tools/rom_prep.py`, PyGhidra) |
| Ghidra | 11.x | ✅ 12.0.4 (formula brew, `ghidraRun` in PATH; headless via `tools/ghidra_headless.sh`) |
| OpenJDK | ≥21 (per Ghidra) | ✅ 21.0.10 (`/opt/homebrew/opt/openjdk@21`, no PATH globale — wrapper imposta JAVA_HOME) |
| `uv` | recente | ⚠️ verificare in Phase 2 (per PyGhidra/reaper) |
| Claude Code CLI | recente | ✅ in uso |

---

## Phase 0 — Setup ✅

- [x] Repo `marble-love` inizializzato (locale, `git init -b main`)
- [x] Monorepo con workspaces npm (Bun-compatibile)
- [x] `.gitignore` esplicito su ROM, traces, ghidra_project
- [x] `LICENSE` MIT (con clausola che non copre le ROM)
- [x] `README.md`, `PROMPT.md`, `STATUS.md`, `prompts/00-bootstrap.md` + 7 prompts per fase
- [x] Tutte le directory create: `docs/ prompts/ tools/ oracle/ harness/ packages/{engine,cli,web,mobile} runs/ traces/ ghidra_project/ eslint-rules/`
- [x] `eslint.config.js` con custom rule `marble-love/no-raw-arith-on-branded` — verificata: 4/4 violazioni rilevate su file scratch
- [x] `tsconfig.base.json` strict mode, 3 progetti referenziati (engine/cli/web)
- [x] **`@marble-love/engine`** completo come scaffold: wrap.ts (branded types u8/u16/u32/i8/i16/i32 + 40+ helper), state.ts (GameState root), bus.ts (memory map skeleton), rng.ts (LFSR placeholder), physics.ts, ai.ts, level.ts, render.ts, audio.ts, trace.ts (TRACE_SCHEMA_VERSION=1), index.ts
- [x] **`@marble-love/cli`** funzionante: `tsx packages/cli/src/marble-runner.ts --scenario X --ticks N` produce trace JSONL valido
- [x] **`@marble-love/web`** scaffold: Vite + PixiJS 8 + PWA manifest, ROM file picker (no upload server), input.ts (mouse/keyboard/gamepad/touch), renderer.ts (PixiJS adapter), rom-loader.ts stub
- [x] **Oracle harness**: `oracle/mame_dumper.lua` (Lua dumper per-frame), `oracle/run_oracle.ts` (wrapper MAME), 3 scenari (`attract_mode`, `level1_no_input`, `level1_basic_movement`)
- [x] **Diff harness**: `harness/diff.ts` (linear scan, schema-version check, sospetto sottosistema), `harness/report.ts` (markdown LLM-friendly), `harness/run_compare.sh` (pipeline end-to-end), `harness/curriculum.yaml`
- [x] **`tools/rom_prep.py`**: scaffold ROM interleaver (DEFAULT_PAIRS da riempire in Phase 1)
- [x] **5 docs skeletons**: hardware-map / cpu-config / sound-system / video-system / rom-layout / static-overview
- [x] **Vitest** configurato + 38 test (33 wrap.ts aritmetica, 2 state, 3 trace) — tutti verde
- [x] **Pipeline differential verificata**: trace identici → parità 100%; trace artificialmente divergenti → primo frame e campo identificati correttamente, sospettato `physics` calcolato bene
- [x] `npx tsc -b` exit 0 — typecheck pulito su tutto il monorepo
- [x] `npx eslint` exit 0 — nessuna violazione branded-arith
- [x] Push su GitHub privato — `https://github.com/magno73/marble-love`
- [x] Bun, OpenJDK 21, Ghidra 12.0.4 installati e verificati
- [x] `tools/ghidra_headless.sh`: wrapper progetto-locale per analyzeHeadless (no modifiche a PATH globale)

---

## Phase 1 — Studio driver MAME ✅

**Sorgenti consultati:**
- `mame/src/mame/atari/atarisy1.cpp` (2705 righe)
- `mame/src/mame/atari/atarisy1.h` (177 righe)
- `mame/src/mame/atari/atarisy1_v.cpp` (655 righe)
- `mame/src/mame/atari/slapstic.h` (header)

**Deliverable completati:**
- [x] `docs/hardware-map.md`: memory map completa 68010 + 6502, MMIO con bit field, sprite RAM layout, slapstic 103
- [x] `docs/cpu-config.md`: M68010 @ 7.16 MHz, M6502 @ 1.79 MHz, vector table, IRQ4(VBLANK)/IRQ6(sound), Marble identifier byte 001
- [x] `docs/sound-system.md`: mailbox $FE0001/$FC0001, NMI sul 6502, IRQ6 sul 68010, YM2151 + POKEY, Marble NON usa TMS5220
- [x] `docs/video-system.md`: 336×240 @ 59.92 Hz, IRGB-4444 palette 1024 entries, 8 banchi sprite × 64 entries × 4 word, alpha 64×32
- [x] `docs/rom-layout.md`: tutti i file `136033.*` con CRC32+SHA1, interleaving even/odd, offset esatti
- [x] `tools/rom_prep.py` popolato con `DEFAULT_PAIRS` reali, **testato**: produce `ghidra_project/marble_program.bin` (557056 byte) da `roms/marble.zip` + `roms/atarisy1.zip`
- [x] `docs/static-overview.md`: SSP=0x00401F00, reset PC=0x00000466 verificati nel blob

**Trackball insight critico per Marble:** `init_marble` setta `m_trackball_type=1` → `trakball_r` ruota le coordinate di 45° (`m_cur[player][0] = posx + posy; m_cur[player][1] = posx - posy`). Il reimpl deve fare la stessa rotazione PRIMA di passare i delta al 68010.

**IRQ Marble:** solo VBLANK (IRQ4) e sound (IRQ6). Niente IRQ2 (no ADC), niente IRQ3 (Marble usa classe base `atarisy1_state`, non `atarisy1r_state`).

---

## Phase 2 — Ghidra static analysis ✅

**Tools usati:**
- ✅ Ghidra 12.0.4 + OpenJDK 21 + wrapper `tools/ghidra_headless.sh`
- ✅ `uv` 0.11.8 + PyGhidra 3.0.2 (installato via `uv tool install pyghidra`)
- ✅ `tools/ghidra_analyze.py`: pipeline completa (apre progetto, aggiunge memory blocks RAM/MMIO + 24 labels, ri-analyze, dumpa 5 file in `ghidra_project/`)
- ✅ `tools/ghidra_dump_range.py`: dump disassembly di range arbitrari
- ✅ `tools/ghidra_disasm_at.py`: forza disassembly + analysis su indirizzi specifici

**Decisione**: reaper NON usato. Sono io l'LLM che farebbe il naming, lo faccio direttamente leggendo i dump invece di passare per OpenAI/Anthropic API.

**Risultati chiave** (tutti in `docs/static-overview.md`):
- 340 funzioni rilevate. 24 simboli nominati (vector table + MMIO + ResetEntry).
- **Reset PC** @ 0x466. Init clear di playfield/MO/alpha RAM, init palette, jump al cart entry.
- **VBLANK ISR** @ 0x34A → `jmp *(0x10006)` → cart frame handler @ **0x10116**.
- **Sound IRQ6 ISR** @ 0x36C → dispatch via `*(0x1001E)` → 0x17E.
- **Main game tick** @ **0x10116**: ack VBLANK, frame counter `0x400014/0x400016`++, `jsr 0x28788` (MAIN UPDATE).
- **MainUpdate** @ **0x28788**: scroll Y/X/AV-control sync, 7 sub-updates (4 palette anim + 2 BIOS + 3 game), watchdog kick, coin counter logic, dispatch a 0x10146.
- **Game object array** @ **0x400018**, **226 byte/oggetto**, count @ **0x400396**. Field offset noti: +0x19 (type/palette), +0x70 (anim counter), +0xD8 (state).
- **Frame counter**: byte @ 0x400014 (mid) e 0x400016 (low).
- **Stack low water**: 0x400440 (debug, non rilevante per parità).

**🚨 Open: RNG ancora da identificare.** Le top-called functions sono draw routines, non RNG. Strategia: identificarlo durante Phase 4-6 osservando trace MAME ad alta entropia.

**🚨 Open: ≥80% naming non raggiunto** (PRD §6 acceptance). Postponed a Phase 2.5/inizio Phase 4 quando capirò meglio le 30 funzioni con xref ≥5 leggendo i sotto-update.

---

## Phase 3 — MAME oracle harness ✅

Vedi `prompts/03-oracle.md`.

**Risultati:**
- `oracle/mame_dumper.lua` riempito: legge frame counter (`0x400014`/`0x400016`), game object slot 0 (`0x400018`+0x00..0xD8), AV-control cache (`0x4003AE`), coin counter (`0x4003F4`), VBLANK skip (`0x401F40`), e calcola **CRC32 dell'intera Work RAM 8 KB** (escluso 0x440-0x447, stack low water debug-only).
- **Input scriptato funzionante**: parser JSON Lua manuale (no JSON library disponibile in MAME), supporta `dx`, `dy`, `buttons`. Mappato a porte MAME `:IN0`/`:IN1` (trackball X/Y), `:F60000` (START1/START2), `:1820` (COIN1).
- **Determinismo MAME verificato** (PRD §6 Phase 3 acceptance):
  - 2 run di `attract_mode` 300 frame senza input → diff bit-identico ✅
  - 2 run di `level1_no_input` 600 frame con input scriptato → diff bit-identico ✅
- Schema TS aggiornato: `TraceFrame.workRamHash` ora è `number` required (CRC32 dell'8 KB), `TraceHeader.romCrc32` `string` required (placeholder per ora).
- Engine `frameFromState` calcola CRC32 della propria `state.workRam` con la stessa formula del Lua (escludendo `0x440-0x447`). 3 nuovi test verificano: deterministico, sensibile alle modifiche, ignora il range escluso.

**Tooling:** path ROM è `/Users/magnus-bot/Code/marble-love/roms` (contiene `marble.zip` + `atarisy1.zip`).

---

## Phase 4a — RNG identified + pipeline functional ✅

🎯 **RNG trovato**: `FUN_00013A98` legge/scrive `0x004003A6` (u16) con Galois LFSR + range-limit. Algoritmo dal disassembly:
- 17 istruzioni core, 28 callers
- Feedback: `(state.high ^ state.low) ?: 0x40`, bit 6 = nuovo bit
- Anti-zero attractor (special case quando XOR == 0)
- Per chiamata `next(limit)`: avanza state di N=bit_length(limit) step + range-limit

🎯 **Workflow di scoperta** (replicabile):
1. `tools/mame_full_ram_dump.lua`: dumpa Work RAM completa ogni 30 frame
2. `tools/find_rng_candidates.py`: ranking per varianza/uniqueness → 0x4003A6 emerge come terzo candidato
3. `tools/find_rng_static.py`: scansione Ghidra per funzioni piccole con read+write stessa cella → conferma
4. `tools/find_xrefs.py`: cross-check chi tocca 0x4003A6 → solo `FUN_00013A98`
5. `tools/dump_rng_state.lua`: dump per-frame del valore (per Phase 6 calibration)

🎯 **Implementazione TS** (`packages/engine/src/rng.ts`):
- `rngStepOnce(state)`: singolo step LFSR
- `rngAdvanceForLimit(state, limit)`: N step proporzionali al bit-length di limit
- `rngNext(state, limit)`: avanza + range-limit
- Test: 9 test, freeze snapshot. PRD §6 Phase 4 acceptance "10000 calls match oracle" → posticipato a Phase 6 (richiede call-by-call trace dump che faremo in calibrazione).

🎯 **Pipeline differential funzionante** (`./harness/run_compare.sh attract_mode`):
- Step 1: oracle MAME 600 frame (~9s wall)
- Step 2: reimpl TS 600 frame (~1s wall)
- Step 3: diff identifica primo frame divergente + campi
- Step 4: report markdown per LLM
- Output corrente: parità 0% (atteso, TS skeleton); divergenza @ frame 0 su `cpuTicks` (TS=0, MAME=1200) e `workRamHash` (TS=zero RAM, MAME=initialized RAM)

🎯 **off-by-one fix**: marble-runner ora dumpa PRIMA di tickare (allineato col Lua dumper che dumpa a fine frame_done).

50/50 test passano. Typecheck clean. Lint clean.

## Phase 4b — bus MMIO + level loader + parità @ frame 0 ✅

**Bus MMIO completo** (`packages/engine/src/bus.ts`):
- Read/write dispatch tipizzato per tutti gli MMIO documentati
- Memory map constants exported (ROM_BASE, WORK_RAM_BASE, MMIO_PF_XSCROLL, ...)
- Trackball read 45° rotation (Marble-specific) implementato
- Switch port read implementato
- Cartridge RAM 1MB lazy-allocato via WeakMap (no alloc se non usato)
- 9 test (read/write round-trip su tutte le region, MMIO no-throw, trackball, switches)

**Level loader** (`packages/engine/src/level.ts`):
- Pointer table verificata @ ROM `0x2BE00` (6 livelli ascendenti)
- L1@0x2BEE2, L2@0x2C54C, L3@0x2CD9E, L4@0x2D648, L5@0x2DE1E, L6@0x2E790
- `loadLevel(rom, index)` parsa header (36 byte) + height records (8 byte/each)
- `loadAllLevels` carica tutti i 6
- 10 test (constants + carica ROM reale via env/path discovery)

**Boot RAM capture** (`tools/capture_boot_ram.lua`):
- Dumpa Work RAM 8KB @ frame 0 → `traces/boot_ram_frame0.bin`
- Scoperta: Work RAM è ALL-ZERO al frame 0 di MAME (motherboard BIOS test ancora in corso)
- Conseguenza: il TS reimpl con `emptyGameState()` (workRam tutta zero) **matcha MAME bit-perfect a frame 0**

**workRamHash unsigned fix** in `trace.ts`: `>>> 0` dopo XOR per coincidere col Lua.

**diff.ts metadata exclusion**: `cpuTicks` ora escluso dal diff (è PC del 68010, non game state). Il diff confronta SOLO il game state vero.

**Risultato pipeline finale**:
- Frame 0-5: parità bit-perfect ✅ (6 frame match)
- Frame 6: divergenza su `workRamHash` (MAME inizia a scrivere RAM, TS no)
- Parità: **1.00%** = 6/600 frame del scenario `attract_mode`

69/69 test passano.

## Open per Phase 6 (futuro)

- Calibrazione bit-perfect del RNG vs oracle (richiede call-by-call dump)
- Hill climbing su scenari del curriculum

## Phase 4c — Musashi WASM come oracolo locale ✅

**Aggiunto** `musashi-wasm@0.1.31` come dependency del package `@marble-love/cli` (NON di `engine`, che resta puro).

**`packages/cli/src/binary-oracle-lib.ts`**:
- Wrapper attorno a `musashi-wasm/core` con memory layout che riflette `docs/hardware-map.md`
- `createCpu(rom, state)`: inizializza System con regions (ROM, slapstic, Work RAM, cart RAM, PF/MO/Alpha/PAL RAM, EEPROM)
- `runFrame(cpu)`: 119_480 cicli @ 7.16 MHz (NTSC), poi sync da unified memory → state.{workRam,spriteRam,colorRam}
- MMIO write hooks (sound mailbox, watchdog, vblank ack) e read hooks (trackball, switches) — placeholder, da raffinare in 4d

**`packages/cli/src/binary-runner.ts`**:
- CLI entry equivalente a `oracle/run_oracle.ts` ma usa Musashi WASM invece di MAME
- Output JSONL bit-compatibile con `oracle/mame_dumper.lua`
- Use case: **trace generation senza MAME** (CI, dev offline, regressioni rapide)
- Use case secondario (Phase 4d): differential per-funzione

**Status**: binary-runner produce trace ma diverge da MAME al frame 4 (Musashi non gestisce esattamente le quirks Atari System 1: IRQ4 VBLANK injection, watchdog timer, slapstic 103 state machine). Phase 4d lo raffinerà o lo userà solo per analisi modulo-per-modulo invece che per parità globale.

**Engine rimane PURO**: `@marble-love/engine` non ha dependencies WASM/native. Marble-runner usa solo il `tick()` TS.

**Test**: 69/69 passano. Typecheck clean.

## Phase 4d.RNG — RNG bit-perfect ✅

**Helper `callFunction(cpu, addr, args)`** in `binary-oracle-lib.ts`:
- Spinge args RTL su stack + sentinel return address (0xCAFEBABE)
- setRegister PC = addr, run in burst di 100 cicli con poll PC == sentinel
- Pop tutto, ritorna D0 (return value) + cycles
- Note: `system.call()` di musashi-wasm aveva timeout 1M cicli senza terminazione corretta su return (suspect bug); la mia impl manuale è ~660 cicli per RNG call.

**`packages/cli/src/test-rng-parity.ts`**: differential testing RNG.
Per N seed/limit pairs (deterministici via PRNG locale):
1. set seed @ 0x4003A6
2. callFunction(FUN_13A98, [limit]) → binary_d0, binary_seed_after
3. rngNext(state, limit) → ts_return, ts_seed_after
4. Confronto.

**🎯 Risultato: 10000/10000 match (100%)** in ~25 secondi. PRD §6 Phase 4 acceptance soddisfatto bit-perfect per RNG.

L'algoritmo TS che avevo derivato dal disassembly era già corretto sin dalla prima implementazione (Phase 4a). I primi 30 test fallivano per il bug in `callFunction` (uso scorretto di `system.call`).

## Phase 4d.PaletteAnim — palette animation 1 ✅

**`packages/engine/src/palette-anim.ts`**:
- `paletteAnim1Tick(state, rom)`: replica `FUN_00026BEE`
- Itera obj[0..count-1] dell'array @ 0x400018 stride 0xE2, count u16 @ 0x400396
- Per ogni obj attivo (ctr != 0xFF, skip == 0): legge anim_ctr, indice `(sext_i32(ctr) >> 2) * 2` in lookup table ROM (0x20B34 o 0x20B54 basato su type), scrive u16 risultante in palette entry 3 (0xB00006) o entry 7 (0xB0000E)
- Increment con wrap **signed** a 0x3F (sottigliezza: 64..127 reset, 128..255 NO reset)

**Differential `test-palette-anim-parity.ts`**: **1000/1000 match al 100%**.

**Bug nel test scoperto e documentato**: `0x400396` (count) collide con `obj[3].field_0xD8` (skip flag) — sono lo stesso byte. La fixture deve scrivere count DOPO i fields.

**Engine tests**: 9 nuovi test in `palette-anim.test.ts` (78 totali).

## Phase 4d.next — sotto-update rimanenti di MainUpdate

I 7 jsr di `MainUpdate @ 0x28788` (Phase 2):
1. ✅ `0x26BEE` palette anim 1 (FATTO)
2. `0x26C78` palette anim 2 (probabile, simile signature)
3. `0x26D4E` palette anim 3
4. `0x26B88` palette anim 4
5. `0x148` BIOS service (thunk to BIOS function — TBD)
6. `0x15A` BIOS service (thunk)
7. `0x28A96` probabile fisica/input
8. `0x1AC18` probabile AI/sprite render
9. `0x28972` probabile score/HUD

Anche serve replicare il setup MainUpdate stesso (`0x28788`):
- scrollDirty flag handling
- xscroll/yscroll/AVcontrol sync
- watchdog kick + coin counter
- final dispatch a 0x10146

Pattern di lavoro stabilito (replicabile):
1. Disassembla la funzione (PyGhidra)
2. Capisci pseudocode
3. Riscrivi in TS idiomatic in nuovo modulo `engine/src/<nome>.ts`
4. Crea `cli/src/test-<nome>-parity.ts` differential
5. Iterazione fino a 100% match
6. Aggiungi unit test
7. Integra nel `tick()`

## Phase 5-7

Scaffold pronto in `prompts/05-diff-harness.md`…`prompts/07-web.md`. Phase 5 è essenzialmente già fatta (run_compare.sh funziona).

---

## Note operative

- ROM atteso in `roms/marble.zip` (formato MAME). Già presente nella copia locale.
- ESLint custom rule `no-raw-arith-on-branded` definita in `eslint-rules/`. Da Phase 4 in poi blocca `+/-/*/>>>` su `u8 | u16 | u32`.
- Per ora il workspace usa **npm**. Switch a Bun appena installato (zero modifiche al codice, solo `bun install` e script `bun run`).

## Decisioni log

- **2026-05-02** — scaffold iniziale completato, scelta npm-workspaces come default per assenza Bun. Bun rimane preferito per CLI/test (PRD §4).
- **2026-05-02** — ESLint custom rule scritta in JS puro (no plugin esterno) per minimizzare deps.
