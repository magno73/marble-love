# STATUS — Marble Love

**Ultimo update:** 2026-05-02
**Fase corrente:** Phase 0-3 ✅ + Phase 4a-c ✅ + Phase 4d.RNG ✅ + **Phase 4d.PaletteAnim ✅** (1° sotto-update di MainUpdate bit-perfect)
**Prossima fase:** Phase 4d.next — sotto-update rimanenti di MainUpdate (3 palette anim, 2 BIOS calls, 3 game logic)
**Branch corrente:** `main`.

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

**🎯 21 sub-systems bit-perfect.**

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
