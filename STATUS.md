# STATUS — Marble Love

**Ultimo update:** 2026-05-02
**Fase corrente:** Phase 0 ✅ + Phase 1 ✅ + Phase 2 ✅ (Ghidra static analysis)
**Prossima fase:** Phase 3 (MAME oracle harness — popolare RAM addresses noti)
**Branch corrente:** `main`. Tutte le fasi inline finora.

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

## Phase 3 — MAME oracle harness

Vedi `prompts/03-oracle.md`.

Lo scaffold (`oracle/mame_dumper.lua`, `oracle/run_oracle.ts`, `oracle/scenarios/`) è già in piedi come stub. Phase 3 lo riempie e verifica determinismo.

---

## Phase 4-7

Scaffold pronto, prompt scritti in `prompts/04-typescript-skeleton.md`…`prompts/07-web.md`.

---

## Note operative

- ROM atteso in `roms/marble.zip` (formato MAME). Già presente nella copia locale.
- ESLint custom rule `no-raw-arith-on-branded` definita in `eslint-rules/`. Da Phase 4 in poi blocca `+/-/*/>>>` su `u8 | u16 | u32`.
- Per ora il workspace usa **npm**. Switch a Bun appena installato (zero modifiche al codice, solo `bun install` e script `bun run`).

## Decisioni log

- **2026-05-02** — scaffold iniziale completato, scelta npm-workspaces come default per assenza Bun. Bun rimane preferito per CLI/test (PRD §4).
- **2026-05-02** — ESLint custom rule scritta in JS puro (no plugin esterno) per minimizzare deps.
