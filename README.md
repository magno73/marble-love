# Marble Love

> Reimplementazione TypeScript di **Marble Madness** (Atari, 1984, hardware Atari System 1, M68010 + 6502), verificata frame-by-frame contro MAME come oracolo.

**Status:** **🎯 366+ funzioni replicate bit-perfect** via parity 100/100 o 500/500. Rendering MAME-faithful con **indirect bitmap_ind16 path** (cfr atarisy1_v.cpp screen_update): marble cromata + ombra **rotola sul livello bit-perfect** in demo gameplay warm (warmstate f12000+, `?play=1`), terreno isometric 3D, HUD score, 3 spike triangolari. **`obj0.x` bit-perfect MAME su 99/99 frame** del ground truth `/tmp/mame_100f.json`; **`obj0.z_long` ora matcha MAME f12000..12099** nel path canonico slapstic. Drift workRam @ 100 frame demo: **172 byte** (solo stack-residue escluso da invariante + **0 gameplay residuo**). **Long demo-mode ancora WIP:** il raw long-run ora supera i freeze iniziali e attraversa path di morte/HUD/reset; il rebuild playfield resta bit-perfect fino a f13200 dopo i side-effect slapstic `FUN_1AD54 -> FUN_2BC5C -> FUN_2FF40`, il fix A3/A4 di `FUN_160F6`, il wiring HUD/banner di `FUN_10504`, il ramo eaten-orbit `FUN_253EC` JT[4], il side-wall bounce `FUN_29CCE` tag `0x1f`, il ponte mode0→mode1→mode2, i checkpoint special sprite/particle e state-6 sprite cadence, il fix scroll-range spawn di `FUN_10504` che riallinea gli script slot 0..12 del secondo cycle, il packer `FUN_1A9CC` ora mappato sull'intera finestra video `0xA00000` (playfield/sprite/alpha), e `FUN_15A12` ora inizializza lo slot object-pair `0x400A20` nel secondo attract segment; f13920 resta PF exact con total diff **117** sul dump storico e il bounce f14858 allinea `obj0`/`0x400A20` fino a f14900. Ultimo checkpoint long-run: mode0 rebuild staged per segmenti 3/5, niente falso reset `3e4=0` nel dwell post-mode2, PF exact anche su f14600/f16000/f17680/f18000, `FUN_28232`/`hudFrameInit283C2` reinseriti nel path async, `FUN_286EE -> FUN_3520` + timer presentation `obj0+0x6A` cablati, scratch/phase `FUN_1A444` descriptor-backed nei segmenti 3/4/5, ultimo rotate `FUN_1C014` del bridge segment-3 allineato, chunk7 scratch-only del segmento 5, side-effect `FUN_2FFB8` ripristinati nelle phase staged (`157172 -> 150186 -> 146650 -> 145902 -> 141790` di somma campionata), e rebuild segment-5 spostato a stage91 sul fresh bank-aware (fresh tail `58208 -> 57365 -> 55914`); restano sprite/workRam scratch/cache e pochi byte alpha tardivi (vedi STATUS.md). I dump MAME ora serializzano/inferiscono `slapsticBank`, così probe e frontend non forzano più bank errati sui warm seed intermedi; resta da chiudere il drift sprite/workRam residuo del demo completo (vedi STATUS.md). **Infrastruttura M68K**: register file TS (D0-D7/A0-A7, 8 istruzioni stack ABI, 2879/2879 Tom Harte pass) + cycle-table M68010 da Musashi MIT + 22MB validation dataset Tom Harte SingleStepTests + **slapstic 137412-103 state machine** (4 bank × 8KB con FSM bit-perfect MAME, 12/12 vitest). Sessione 2026-05-12/13/14: fix `obj0.z_long`, P2 `FUN_15E24`, warm slot-array interleaving, residual async bridge, renderer MO RAM banked, texture update Pixi v8, warm demo guardrail e checkpoint long demo; warm drift gameplay **204B → 107B → 68B → 40B → 0B**.

Apri `?autoLoad=1&mameLive=1&play=1` per vedere il marble rotolare in tempo reale dal warm bootstrap MAME. La demo warm puo' ancora ciclare il segmento stabile per uso visuale; usa `loopReset=0` per ispezionare il raw long-run incompleto mentre prosegue il lavoro sul demo mode completo.

Vedi [`STATUS.md`](./STATUS.md). **PRD:** [`marble-love-prd-v0.2.md`](./marble-love-prd-v0.2.md).
**License:** MIT (codice originale). Le ROM **non** sono incluse né distribuite — l'utente fornisce le proprie.

## Metriche progetto

| Metrica | Valore |
|---|---|
| Funzioni Ghidra coperte | **350 / 350** (100%, ~358 con parity 500/500) |
| Differential test cases | >100.000 random cases tutti 100% match vs musashi-wasm |
| Vitest | Full suite con fail preesistenti in `slapstic-lookup` e `level-helper-2ffb8`; typecheck e test/probe mirati usati come checkpoint |
| **Drift workRam @ f+99** | **172B = 172B stack (escluso) + 0B gameplay** dopo warm slot-array replay + residual async bridge (era 376B / 204B gameplay) |
| **Register file M68K TS** | ✅ 8 istruzioni stack ABI bit-perfect vs Tom Harte SingleStepTests (2879/2879 considerati pass al 100%, 22MB dataset MIT) |
| **Cycle-table M68010** | ✅ Estratta da Musashi MIT (21/21 vitest, CYCLES_PER_VBLANK=119316, sanity FUN_158CC +3.7%) |
| Frame 0 (post-bootInit) ↔ MAME | **bit-perfect** su tutte le 32 regioni workRam |
| **`obj0.x` evolution vs MAME** | **bit-perfect su 99/99 frame** del ground truth (warm f12000 + tick 99×) |
| **Demo gameplay marble visivo** | 🟡 warm demo stabile e animato con `?mameLive=1&play=1`; raw long-run `loopReset=0` avanza oltre i primi secondi ma resta WIP |
| **Long demo oracle f12000..18000** | 🟡 checkpoint 2026-05-14: `npx tsc -b` PASS; playfield exact fino a f18000 nelle finestre chiave storiche dopo `FUN_1AD54 -> FUN_2BC5C -> FUN_2FF40` slapstic prefetch side-effect, fix A3/A4 `FUN_160F6`, wiring HUD/banner di `FUN_10504`, `FUN_253EC` JT[4] eaten-orbit e `FUN_29CCE` tag `0x1f` side-wall bounce; rebuild chunk cadence staged e mode0 `FUN_10504` ritardato per segmenti 3/5 (f14600/f17680 PF/alpha/color non piu' anticipati); mode0→mode1→mode2 handoff riallineato anche nel secondo cycle f15367..f15379; dwell `390=1/392=2/3e4=3` protegge `gameTickTimers` dal falso reset; il refresh body del segmento 5 ora parte a stage 91, mantenendo fermo l'oggetto presentation pre-handoff; `FUN_15A12` object-pair spawn + `FUN_1BC88 -> FUN_160D4` allineano il bounce f14858 (`obj0` e `0x400A20` exact fino a f14900); `FUN_286EE -> FUN_3520` e timer presentation riducono alpha HUD a 0 nei campioni f12950/f13200/f13400/f13920/f14620; scratch/phase `FUN_1A444` descriptor-backed migliora la somma campionata `157172 -> 150186`, l'ultimo rotate `FUN_1C014` del bridge segment-3 la porta a `146650`, chunk7 scratch-only segment-5 la porta a `145902`, i side-effect `FUN_2FFB8` nelle phase staged la portano a `141790`, e il rebuild segment-5 stage91 riduce il fresh bank-aware tail `58208 -> 57365 -> 55914` con PF exact da f17710 a f18000; residuo principale: workRam scratch/cache e sprite emission |
| Chain playfield end-to-end | ✅ `bootInit({preloadLevel: 0..5})` → state.playfieldRam popolato (1500-2900 byte/livello) |
| State machine evolution | ✅ `tick({runMainLoopBody})` → spriteRam ~110 byte, workRam attivo |
| HUD attivato | ✅ alphaRam popolato — "SCORE _____" decoded ASCII via renderString286EE |
| **Frame Level 1 reale** | ✅ 1375/4096 tile, 1 sprite, 10 alpha chars (rampa diagonale visibile in ASCII map) |
| **Web frontend real rendering** | ✅ default con ROM caricata; `?demo=1`/`?engine=1`/`?real=1` per modalità debug |
| Multi-agent workflow | Claude Code (~150 funzioni / 35+ batch) + Codex (chain playfield 1A9CC/1A444/16EC6 + helpers 2FFB8/1AA38/18FD0/26B66/28C7E/28580/100E0/16F6C/259B4/11B18/1344C + batch grosso F6A/52DA/40D8/1B9CC/17CB8/28E3C + state-machine subs) |

## Track A — Phase 4d (replication bit-perfect)

| Categoria | Status |
|---|---|
| **Root game-logic CORE** | ✅ 4/4 (`trackballInputTick`, `gameTickTimers`, `gameMainGate`, `gameStateMachineTick`) |
| **State machine schedulers** | ✅ Stati 1, 2, 3, 4, 5/6, 7 + state-sub 2572/2766/2818/295A/2CD4/2BDA/2C60/2DA0/2ABC/2678/520E/525C/5334/535E/540A/5608/1EAA |
| **Boot init** | ✅ `bootInit` orchestrator + slot-array bulk init + boot screen + spurious handler |
| **Sound subsystem** | ✅ Wrapper FUN_4CA0 + sub FUN_3E1A/4C3E/4D1A/158AC/15884/4420 (chip writer FUN_4DCC ancora minimal-stub: richiede YM2151) |
| **Palette / video** | ✅ paletteAnim 1/2/3, paletteQueue, paletteRngFill, palette init, pfScroll, tilemap blit, clear-pf, tilemap entry pack 1A9CC, row build 1A444, span builder 1AA38, level dispatcher 16EC6, helpers 2FFB8/18FD0 |
| **String / HUD render** | ✅ render-string-entry-286B0/28F62/28FA0/28FDE, format-and-render, render-glyph-loop, dispatch-strings |
| **EEPROM / pacing** | ✅ eepromCommit, eepromCommitRequest |
| **Slapstic** | ✅ lookup + table store |
| **Boot/main loop init chain** | ✅ FUN_117B2 + FUN_11452 + FUN_1101E + FUN_10504 (Codex) replicati bit-perfect |
| **Funzioni totali** | 314 (escludendo 29 thunks) |
| **Replicate bit-perfect** | **~270+** via parity 500/500 (resto metadata thunks) |
| **Differential test cases** | >100.000 random cases tutti 100% match |

## Track B — Classic Renderer (MAME-faithful pipeline)

| Componente | Status |
|---|---|
| **Engine `Frame` model** | ✅ `packages/engine/src/render.ts` — neutral data model (palette, scroll, 3 layer: playfield/MO/alpha) |
| **PixiJS pipeline** | ✅ `packages/web/src/renderer.ts` — translate Frame → containers, integer scaling, no AA |
| **ROM graphics decode** | ✅ `packages/web/src/rom-graphics.ts` — alpha glyphs + object tiles MSB-first MAME-compliant |
| **ROM ZIP loader** | ✅ `packages/web/src/rom-loader.ts` con fflate + ROMREGION_INVERT |
| **Demo fixtures** | ✅ classic-demo-frame, engine-diagnostic-frame |
| **MAME oracle dump** | ✅ `oracle/mame_state_dump.lua` — full state RAM + screenshot @ frame target |
| **MAME state fixture** | ✅ `packages/web/public/mame_state.json` — frame 2400 Beginner level |
| **`?mameDump=1` query param** | ✅ bypass bootInit+tick, popola state TS dal MAME dump |
| **`?autoLoad=1` query param** | ✅ DEV-only auto-fetch ROMs dal symlink `public/roms/` |
| **Bit-perfect tile decode** | ✅ planes[0]=MSB pen, MSB-first readbit, ROMREGION_INVERT, set_granularity(8) |
| **Palette regions MAME** | ✅ Alpha 0x000-0x0FF / MO 0x100-0x1FF / Playfield **0x200-0x2FF** / Translucency 0x300-0x3FF |
| **Pixel match vs MAME oracle** | Marble bit-perfect MAME @ (107, 152). Terreno match. HUD/footer ✅ |
| **Indirect renderer (`?indirect=1`)** | ✅ bitmap_ind16 PF + MO scratch + screen merge MAME-correct |
| **`MO_YSCROLL=243` empirico** | ✅ marble screen_y = 243 - yRaw bit-perfect MAME |
| **Pen cap 7** (3-bit effective MOB) | ✅ sphere blu shading visivo |
| **Docs** | 📋 [`docs/classic-renderer.md`](./docs/classic-renderer.md), [`docs/classic-renderer-prd.md`](./docs/classic-renderer-prd.md), [`docs/classic-renderer-plan.md`](./docs/classic-renderer-plan.md) |

## Bridge Track A ↔ Track B

| Componente | Stato |
|---|---|
| `mainTick(state, {rom})` | ✅ `packages/engine/src/main-tick.ts` orchestra le root sub replicate nell'ordine esatto di FUN_28788 |
| `bootInit(state, rom)` | ✅ porta lo state al primo frame "post-boot pre-tick" |
| Frontend integrato | ✅ `packages/web/src/main.ts` chiama bootInit + tick reale |
| Visual smoke test | ✅ `packages/cli/src/visual-smoke-test.ts` — palette evolve, sprite/HUD richiedono altre sub |

## Tecniche differential testing

- ROM-blob caricato in **musashi-wasm** (M68k emulator) come oracolo per-funzione
- Random input setup → `callFunction(addr)` sul binario + chiamata TS reimpl in parallelo
- Compare bit-perfect su workRam / colorRam / spriteRam / alphaRam regions
- Patch ROM (es. `rts` immediate = 0x4E75) per stubbare sub-functions non ancora replicate
- Spin-loop patching (`bne` → `bra`) per evitare hang in test deterministici
- MMIO-source patching (es. 0xFC0001 → 0x00400440) per controllare letture MMIO via `pokeMem`
- RTE → RTS patching per testare IRQ handlers via callFunction sentinel-based

## End-to-end vs MAME (schema v2)

- `oracle/run_oracle.ts` lancia MAME con dumper Lua → `traces/oracle_<scenario>.jsonl`
- `packages/cli/src/marble-runner.ts` esegue il reimpl → `traces/reimpl_<scenario>.jsonl`
- `harness/diff.ts` confronta con `--truth-offset N` (allinea boot transient) e `--from-frame N`
- **Trace localization v2**: 32 CRC32 regionali (regioni 0x100 byte) → diff annota "workRam[0x300..0x3ff]" invece del generico "workRamHash mismatch"
- `tools/watch_write.lua` (write-tap MAME): logga `(frame, PC, addr, data, mask)` per identificare writer di una zona specifica
- `MARBLE_DUMP_REGIONS=0x100,0x300` env var: dump hex byte-per-byte di regioni specifiche per debug

```bash
# Pipeline completa: reimpl trace + diff vs oracle
harness/parity-check.sh attract_mode 45 600 1
```

## Workflow multi-agent

Due flussi paralleli operativi:

**1. Claude Code in-process** (5 agent paralleli con `isolation: "worktree"`, best practice Claude Code documentata):
- Ogni agent lavora in worktree git temporaneo isolato
- Prompt focalizzato (~150 parole) con template + pattern noto
- Tutti i risultati 500/500 bit-perfect vs binary
- ~5 min wall time per batch da 5 funzioni

**2. Codex (OpenAI) in clone separato** via [`docs/codex-prd.md`](./docs/codex-prd.md):
- Branch `codex/<task>` su GitHub, PR-based merge su main
- Regole non-interferenza: branch/PR dedicati, niente write su aree possedute da altri agent
- Task completati: main loop init chain, 5 state-machine subs, tilemap entry pack FUN_1A9CC, row build FUN_1A444, level dispatcher FUN_16EC6, playfield helper batch FUN_2FFB8/FUN_1AA38/FUN_18FD0 + ROM pointer fix
- Marco fa review + integration finale al merge

Vedi `STATUS.md` per il diario dei batch e `docs/codex-task-a-main-loop-init.md` per il progress Codex.

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
| `@marble-love/engine` | Core logic puro: bus, physics, AI, RNG, level, render-adapter, audio-stub, state. No DOM. Moduli replicati bit-perfect in crescita continua via parity. |
| `@marble-love/cli`    | Bun/Node runner (`marble-runner`) per produrre trace JSONL + ~95 parity test vs binary. |
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

# 5. Web dev server
npm run dev --workspace @marble-love/web
```

## Differential testing per-funzione

Per ogni sub-system replicato, `packages/cli/src/test-*-parity.ts` esegue:
1. Setup random workRam state in entrambi (musashi-wasm + TS state)
2. Chiama la funzione binaria + la TS reimpl
3. Confronta byte-by-byte le regioni di memoria modificate

```bash
# Esempi (200/500/1000+ casi random per ogni test)
npx tsx packages/cli/src/test-game-tick-timers-parity.ts 2000
npx tsx packages/cli/src/test-game-state-machine-parity.ts 3000
npx tsx packages/cli/src/test-trackball-input-parity.ts 2000
npx tsx packages/cli/src/test-sound-tick-parity.ts 2000
# ...e ~85 altri test parity
```

## ROM

Le ROM **non sono fornite**. L'utente deve possederle legalmente (PCB di proprietà, dump personale ecc.) e metterle in `roms/` (gitignored). Vedi [`docs/rom-layout.md`](./docs/rom-layout.md).

## Riferimenti

1. https://phulin.me/blog/simtower
2. https://github.com/phulin/reaper
3. https://garryslist.org/posts/ai-just-ported-simcity-in-4-days-without-reading-the-code
4. https://banteg.xyz/posts/crimsonland/
5. MAME source `src/mame/atari/atarisy1.cpp`
