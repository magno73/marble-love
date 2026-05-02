# PRD — Marble Love

**Codename:** `marble-love`
**Owner:** Marco Magnocavallo
**Versione:** 0.2 — stack switch a TypeScript, decisioni open questions chiuse
**Data:** 1 maggio 2026
**Macchina target:** Mac Mini M4 (24 GB RAM consigliati)
**Repo:** privato su GitHub
**Licenza:** MIT
**Budget token:** illimitato (nessun cap)

---

## 1. Obiettivo

Reverse-engineerare il binario originale di **Marble Madness** (Atari, 1984, hardware Atari System 1, CPU principale Motorola 68010, sound CPU MOS 6502) e produrre una **reimplementazione in TypeScript**, verificata frame-by-frame contro l'emulazione MAME come oracolo.

Output finale atteso:
- Web app giocabile (`marblelove.<dominio>`) con parità comportamentale all'originale
- Build mobile via PWA / Capacitor (iOS + Android)
- Documentazione tecnica del game engine (fisica, level format, AI, scoring)
- Test harness riusabile per altri titoli Atari System 1

## 2. Non-obiettivo

- Non si distribuiscono ROM (utente fornisce le proprie)
- Non si replica la pixel art o gli asset audio (caricati a runtime dalle ROM dell'utente, come fa MAME)
- Non si fa porting funzione-per-funzione del binario (clean-ish, non clean-room rigoroso — vedi §10)
- Non è un porting commerciale: distribuzione tra amici/community, non vendita

## 3. Background tecnico

Tre paper/post di riferimento da leggere **prima** di iniziare:

1. https://phulin.me/blog/simtower — Patrick Hulin su SimTower con reaper + Unicorn oracle
2. https://garryslist.org/posts/ai-just-ported-simcity-in-4-days-without-reading-the-code — Christopher Ehrlich su SimCity port via differential testing
3. https://banteg.xyz/posts/crimsonland/ — banteg su Crimsonland via WinDbg

Lezione chiave da SimTower: la sola static analysis con LLM **non basta**. Serve un oracolo che fornisca verità tick-by-tick e un loop di hill-climbing su differential testing.

Vantaggio specifico di Marble Madness vs SimTower: **MAME è già l'oracolo**, accurato e aperto. Niente bisogno di costruire un emulatore con Unicorn + 195 mock di API Win16 come ha dovuto fare Hulin.

## 4. Stack tecnico

| Componente | Scelta | Motivazione |
|---|---|---|
| Linguaggio reimpl | **TypeScript 5.x strict** | Web/mobile native deploy, ecosystem JS, condivisibile con Alessandro |
| Runtime headless | **Bun** (preferito) o Node.js 22+ | Bun più veloce per CLI/test, più semplice per single-binary |
| Engine grafico | **PixiJS 8.x** | 2D mature, WebGL/WebGPU, fit perfetto per sprite/tilemap |
| Build web | **Vite** | Standard, HMR rapido |
| Mobile packaging | **Capacitor** (V2) | Web app → native iOS/Android. PWA come fallback V1 |
| Static analysis | Ghidra 11.x + PyGhidra | Standard, supporta M68010 nativo |
| Static harness | `reaper` (https://github.com/phulin/reaper) | Già pronto, agente-ready |
| Oracolo dinamico | **MAME 0.279+ con scripting Lua** | Emulazione Atari System 1 accurata |
| Loop autonomo | Claude Code | Patrick ha confermato che $20/mese non basta, valuta piano $200 |
| Test framework | **Vitest** | Standard TS, snapshot testing supportato |
| Bit-perfect arithmetic | helper `u8/u16/u32` con wrapping espliciti + `Uint*Array` | Soluzione standard emulator-in-JS |
| Versioning | Git, repo privato GitHub | Commit autonomi da Claude Code |

### Nota su aritmetica bit-perfect in TypeScript

Marble Love DEVE replicare aritmetica 16/32-bit del 68010 esattamente. TypeScript usa float64 di default → trappola classica. Soluzione standard:
- Tutte le RAM regions sono `Uint8Array` / `Uint16Array` / `Uint32Array`
- Helper espliciti tipo `u16_add(a, b)` che ritornano `(a + b) & 0xFFFF`
- Per moltiplicazioni 32-bit usare `Math.imul()`
- Bitwise: usare `>>>` (zero-fill) invece di `>>` quando si trattano valori unsigned
- Lint rule custom (eslint plugin) per vietare `+/-/*` diretti su valori dichiarati come `u8/u16/u32` (branded types)

## 5. Architettura

```
┌─────────────────────────────────────────────────────────┐
│                  ORACOLO (MAME + Lua hook)               │
│  ┌──────────────┐  ┌──────────────────────────────────┐  │
│  │  MAME core   │──│ Lua dumper: stato/frame → JSONL  │  │
│  │ (atarisys1)  │  └──────────────────────────────────┘  │
│  └──────────────┘                                        │
│         │ ROM marble (utente fornisce)                   │
└─────────│───────────────────────────────────────────────┘
          │ trace.jsonl (stato target)
          ▼
┌─────────────────────────────────────────────────────────┐
│           DIFFERENTIAL HARNESS (TypeScript / Bun)        │
│  - replay degli stessi input al reimpl                   │
│  - confronto field-by-field stato vs trace.jsonl         │
│  - report divergenze (primo bit che rompe parità)        │
└─────────────────────────────────────────────────────────┘
          │ divergence_report.json
          ▼
┌─────────────────────────────────────────────────────────┐
│         REIMPLEMENTAZIONE (pkg `@marble-love/engine`)    │
│  - bus.ts (memory map, MMIO)                             │
│  - physics.ts (biglia, gravità, collisioni)              │
│  - ai.ts (mostri, marble eater, slinky, acidpool)        │
│  - rng.ts (clone esatto dell'RNG originale)              │
│  - level.ts (parser livelli da ROM)                      │
│  - render.ts (sprite, tilemap → PixiJS adapter)          │
│  - audio.ts (POKEY + YM2151 stub poi sostituito)         │
│  - state.ts (GameState root, snapshot/restore)           │
│  Pure logic, no DOM, no PixiJS direct deps               │
└─────────────────────────────────────────────────────────┘
          │
          ├──► pkg `@marble-love/web` (Vite + PixiJS frontend)
          ├──► pkg `@marble-love/cli` (Bun CLI runner per trace/test)
          └──► pkg `@marble-love/mobile` (Capacitor wrapper) — V2
          
┌─────────────────────────────────────────────────────────┐
│          STATIC ANALYSIS (parallelo, supporto)           │
│  Ghidra DB con annotazioni reaper-driven                 │
│  → scopre funzioni/strutture difficili da inferire      │
│  → feedback al reimpl quando il diff non si chiude      │
└─────────────────────────────────────────────────────────┘
```

**Loop di hill-climbing:**

```
while parity < 100%:
    run MAME with scripted input → produce trace_ground_truth.jsonl
    run TS reimpl with same input → produce trace_reimpl.jsonl
    diff → first divergence at frame N, field F
    Claude Code: analyze divergence, fix TS code, commit
    repeat
```

## 6. Fasi & deliverable

### Phase 0 — Setup (giornata 1)

**Owner:** Marco (manuale) + Claude Code per scaffold
**Deliverable:**
- [x] ROM `marble` ottenuta legalmente (PCB di proprietà — confermato)
- [ ] Repo `marble-love` su GitHub (privato, MIT)
- [ ] Mac Mini M4 con: MAME 0.279+, Ghidra 11.x, Bun, Node 22, `uv` (per Ghidra/PyGhidra), Claude Code CLI
- [ ] Verifica: cercare disassembly o decomp pubblici di Marble Madness (forum AtariAge, ecc.). Se esistono → leggerli come reference, non copiare
- [ ] Monorepo TS scaffold con `pnpm workspaces` o `bun workspaces`: `engine/`, `web/`, `cli/`, eventualmente `mobile/`
- [ ] `.gitignore` esplicito su `*.rom`, `roms/`, `traces/`, `ghidra_project/`
- [ ] `STATUS.md` alla root inizializzato

### Phase 1 — Studio del driver MAME (1-2 giorni)

**Owner:** Claude Code (autonomo, supervisionato)
**Deliverable:**
- [ ] `docs/hardware-map.md`: mappa di memoria completa di Atari System 1 per Marble Madness, estratta da `mame/src/mame/atari/atarisy1.cpp` e header relativi
- [ ] `docs/cpu-config.md`: clock speeds esatti, vector table layout, IRQ sources
- [ ] `docs/sound-system.md`: comunicazione 68010 ↔ 6502 (mailbox/shared RAM)
- [ ] `docs/video-system.md`: tile/sprite hardware, palette, scrolling
- [ ] `docs/rom-layout.md`: ROM file → contenuto, interleaving even/odd byte per bus 16-bit del 68010

**Criterio di accettazione:** la documentazione permette di capire ogni accesso a indirizzo nel codice 68010 senza riaprire MAME.

### Phase 2 — ROM extraction & static foundation (2-3 giorni)

**Owner:** Claude Code
**Deliverable:**
- [ ] `tools/rom_prep.py`: prende le ROM dumpate, le interleava (even/odd), produce blob unico per Ghidra
- [ ] Progetto Ghidra con:
  - Processor: `68000:BE:32:default`
  - Memory map riflesso da `hardware-map.md` (RAM regions, MMIO regions con label)
  - Vector table parsato (entry function = reset vector)
  - Initial auto-analysis completata
- [ ] Setup `reaper` puntato al progetto Ghidra
- [ ] Run iniziale di reaper: prima passata di naming su top 50 funzioni più chiamate
- [ ] `docs/static-overview.md`: 1 pagina con sospetti su main loop, ISR, RNG, level loader

**Criterio di accettazione:** main loop del 68010 identificato; ≥80% delle funzioni called >5 volte hanno un nome non-default.

### Phase 3 — MAME oracle harness (2-3 giorni)

**Owner:** Claude Code
**Deliverable:**
- [ ] `oracle/mame_dumper.lua`: script Lua per MAME via `-autoboot_script`. A ogni frame (o ogni N tick CPU configurabile) dumpa:
  - Stato CPU 68010: PC, registri D0-D7/A0-A7, SR
  - Stato CPU 6502: PC, A, X, Y, SP, P
  - RAM regions critiche (game state, sprite table, oggetti) — definite in `hardware-map.md`
  - Frame number, tick CPU
- [ ] `oracle/run_oracle.ts`: wrapper Bun che lancia MAME con: ROM target, input scriptati, Lua dumper attivo, output `trace.jsonl`
- [ ] `oracle/scenarios/`: scenari di input (`attract_mode.json`, `level1_no_input.json`, `level1_basic_movement.json`, ...)
- [ ] `oracle/replay_trace.ts`: utility che rilegge un `trace.jsonl` in formato human-readable

**Criterio di accettazione:** lanciando lo stesso scenario due volte si ottengono trace **bit-identiche**. Determinismo MAME è non-negoziabile.

### Phase 4 — TypeScript skeleton (3-5 giorni)

**Owner:** Claude Code
**Deliverable:**
- [ ] Package `@marble-love/engine` con moduli stub: `bus`, `physics`, `ai`, `rng`, `level`, `render`, `audio`, `state`
- [ ] Branded types: `u8`, `u16`, `u32` + helper `wrap.ts` con `u16_add`, `u32_mul`, ecc.
- [ ] Tipi base: `GameState`, `Marble`, `Enemy`, `LevelTile`, `Sprite`. Layout pensato per **rispecchiare** il game state RAM dell'originale (diff 1:1 più semplice)
- [ ] Package `@marble-love/cli` con binary `marble-runner`: prende uno scenario di input, esegue N tick, dumpa trace nello **stesso formato JSONL** dell'oracolo MAME
- [ ] Implementazione iniziale di:
  - **RNG (replicato esattamente — è la cosa più importante per parity)**
  - Loader livelli da ROM
  - Tick principale (anche solo no-op, ma con timing corretto)
- [ ] ESLint custom rule per vietare aritmetica diretta su branded numeric types
- [ ] Test snapshot iniziali su `attract_mode` (anche se il diff fallirà — serve per stabilire la pipeline)

**Criterio di accettazione:** `bun run marble-runner --scenario attract_mode --ticks 100` produce un `trace.jsonl` valido (anche se diverso dall'oracolo).

### Phase 5 — Differential testing harness (2 giorni)

**Owner:** Claude Code
**Deliverable:**
- [ ] `harness/diff.ts`: confronta due `trace.jsonl` field-by-field, identifica **primo frame e primo campo** che divergono
- [ ] `harness/report.ts`: produce `divergence_report.json` strutturato per consumo LLM:
  ```json
  {
    "first_divergence_frame": 47,
    "diverged_fields": ["marble.position.x", "rng.state"],
    "ground_truth": {...},
    "reimpl": {...},
    "context_frames_before": [...],
    "suspected_subsystem": "physics"
  }
  ```
- [ ] `harness/run_compare.sh`: pipeline completa (run MAME → run TS → diff → report)
- [ ] Justfile o `package.json` script: `bun run compare <scenario>`

**Criterio di accettazione:** un singolo comando produce un report che dice **dove** e **perché** divergono i due binari.

### Phase 6 — Autonomous hill-climbing (settimane)

**Owner:** Claude Code in loop autonomo, supervisione Marco serale
**Deliverable:**
- [ ] Loop che:
  1. Sceglie il prossimo scenario (curriculum: dal più semplice al più complesso)
  2. Lancia diff
  3. Legge `divergence_report.json`
  4. Decide: (a) sistemare codice TS (b) chiedere a reaper più info su funzione 68010 (c) escalation a Marco
  5. Implementa fix
  6. Ri-lancia diff
  7. Se parità raggiunta: commit, prossimo scenario
  8. Se 3 fix senza progresso: stop, escalation
- [ ] Curriculum scenari (`harness/curriculum.yaml`):
  - L1: attract mode senza input
  - L2: attract mode con input scripted
  - L3: livello 1 senza input (biglia rotola da sola fino a perdere)
  - L4: livello 1 con input semplici
  - L5: livello 1 completato
  - L6-Lx: livelli successivi
  - LN: gameplay full con tutti i nemici, scoring, transizioni
- [ ] Logging strutturato di ogni run autonomo: token spent, tempo, fix applicati, commit hash → `runs/YYYY-MM-DD-HHMM.md`

**Criterio di accettazione:** parità bit-identica frame-by-frame su tutti gli scenari del curriculum.

### Phase 7 — Web playable (1 settimana)

**Owner:** Claude Code + Marco
**Deliverable:**
- [ ] Package `@marble-love/web`:
  - Vite + PixiJS shell
  - Importa `@marble-love/engine` e collega `state` → render PixiJS
  - Input mapping: mouse (movimento → trackball delta), keyboard (frecce/WASD), gamepad
  - UI minimale: load ROM (file picker locale, mai server-side), start, pause, score
  - PWA manifest + service worker (installabile)
- [ ] Audio: prima versione semplice (Web Audio API + sample synthesis basic). POKEY/YM2151 chip-perfect rimandato a V2
- [ ] Build deploy: scelta tra Vercel/Netlify/Cloudflare Pages (Cloudflare consigliato per costi e edge)
- [ ] Dominio: da decidere (vuoi `marblelove.app`? `marblelove.io`?)

**Criterio di accettazione:** dal browser di Mac/iPhone/Android si carica la pagina, si seleziona il file ROM locale, si gioca al livello 1 con parità all'originale.

### Phase 8 — Mobile native (V2, opzionale)

**Owner:** Claude Code
**Deliverable:**
- [ ] Capacitor wrapper della web app → app iOS + Android
- [ ] Touch controls (analog virtuale + accelerometer come opzione)
- [ ] Build TestFlight (iOS) e APK side-load (Android)
- [ ] Eventuale store submission valutata caso per caso

**Trigger:** Phase 7 chiusa e funziona. Fino ad allora, PWA basta.

## 7. Struttura repo (monorepo Bun/pnpm workspaces)

```
marble-love/
├── .gitignore                    # esclude ROM, trace, dist/, node_modules/
├── README.md                     # privato, no ROM, MIT
├── PROMPT.md                     # entry-point per Claude Code (stile reaper)
├── STATUS.md                     # fase corrente, ultimo deliverable, prossimo task
├── LICENSE                       # MIT
├── package.json                  # workspaces root
├── tsconfig.base.json
├── bun.lockb
├── docs/
│   ├── hardware-map.md
│   ├── cpu-config.md
│   ├── sound-system.md
│   ├── video-system.md
│   ├── rom-layout.md
│   └── static-overview.md
├── prompts/                      # Claude Code popola questa cartella
├── tools/
│   └── rom_prep.py
├── oracle/
│   ├── mame_dumper.lua
│   ├── run_oracle.ts
│   ├── replay_trace.ts
│   └── scenarios/
├── harness/
│   ├── diff.ts
│   ├── report.ts
│   ├── run_compare.sh
│   └── curriculum.yaml
├── packages/
│   ├── engine/                   # @marble-love/engine — core logic
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── bus.ts
│   │       ├── physics.ts
│   │       ├── ai.ts
│   │       ├── rng.ts
│   │       ├── level.ts
│   │       ├── render.ts
│   │       ├── audio.ts
│   │       ├── state.ts
│   │       └── wrap.ts            # u8/u16/u32 helpers
│   ├── cli/                       # @marble-love/cli — runner per trace
│   │   └── src/marble-runner.ts
│   ├── web/                       # @marble-love/web — Vite + PixiJS
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── src/
│   └── mobile/                    # @marble-love/mobile — Capacitor (V2)
├── runs/                          # log run autonomi Claude Code
├── ghidra_project/                # gitignored
├── roms/                          # gitignored
└── traces/                        # gitignored
```

## 8. Convenzioni di prompt per Claude Code

Claude Code popola `prompts/` autonomamente seguendo il pattern di `reaper`:
- `PROMPT.md` alla root è entry point: dice "leggi PRD, identifica fase corrente da `STATUS.md`, esegui, aggiorna `STATUS.md`"
- Per ogni fase, Claude Code crea `prompts/0X-<nome>.md` con: contesto, obiettivo, input, output atteso, vincoli, test di accettazione
- Aggiornamento `STATUS.md` a ogni step

## 9. Criteri di successo (globali)

- **Parità bit-identica** su tutti gli scenari del curriculum (Phase 6 chiusa)
- **≥95%** delle funzioni 68010 in Ghidra hanno un nome semantico
- Web app **giocabile** end-to-end con input desktop e mobile (Phase 7)
- PWA installabile su iOS/Android
- Tempo wall-clock target: **6-8 settimane** part-time

## 10. Risk register

| Rischio | Probabilità | Impatto | Mitigazione |
|---|---|---|---|
| ROM non procurabili legalmente | — | — | Risolto: PCB di proprietà confermato |
| Determinismo MAME non sufficiente | Media | Alto | Verificare in Phase 3, fallback su pinning seed e `-throttle 0` |
| Token cost esplode | Media | Medio | Senza cap, ma logging granulare per non perdere il polso |
| RNG non replicabile | Bassa | Alto | Identificare RNG presto in Phase 2, prima cosa da chiudere |
| Bit-perfect arithmetic in TS introduce bug subdoli | Media | Alto | Branded types + ESLint rule + test unitari aggressivi su `wrap.ts` |
| Static analysis blocca su funzione critica | Media | Medio | Escalation manuale; reaper come supporto, non unico tool |
| Copyright sul porting funzione-per-funzione | Media | Medio | Code style TS-idiomatic, no copia layout binario; uso personale e amici |
| Audio chip emulation troppo complessa | Alta | Basso | Stub silenzioso/semplice in V1; chip-perfect in V2 |
| PixiJS performance su mobile vecchi | Bassa | Basso | Marble Madness è 1984, anche un iPhone 8 lo regge |

## 11. Timeline (stima)

- **Phase 0-2 (foundation):** 1 settimana
- **Phase 3-5 (oracle + harness):** 1-2 settimane
- **Phase 6 (hill-climbing):** 2-4 settimane (run notturni autonomi)
- **Phase 7 (web playable):** 1 settimana
- **Phase 8 (mobile):** opzionale, +1 settimana

**Totale realistico:** 6-8 settimane part-time, possibilmente meno con Claude Code in loop notturno aggressivo.

## 12. Out of scope (per V1)

- Multiplayer online / coop (interessante ma futuro)
- Editor di livelli custom
- POKEY/YM2151 chip-perfect (stub OK in V1)
- Pubblicazione store mobile
- Hosting condiviso/cloud save (web app sta tutto client-side; ROM mai sul server)
- Localizzazione (gioco originale è già minimale)

## 13. Decisioni chiuse

- ✅ Codename: **Marble Love**
- ✅ Repo: privato GitHub
- ✅ Stack: TypeScript (era Rust nella v0.1)
- ✅ Engine grafico: PixiJS
- ✅ License: MIT
- ✅ Budget token: nessun cap, logging dettagliato
- ✅ Files in `prompts/`: Claude Code li crea
- ✅ ROM: PCB di proprietà confermato

---

## Appendice A — Note operative per Claude Code

- Lavora sempre in branch separati per ogni fase (`phase-1-mame`, `phase-2-static`, ...)
- Commit atomici, messaggi descrittivi
- Aggiorna `STATUS.md` alla root a ogni step
- Per ogni run autonomo lungo, scrivi `runs/YYYY-MM-DD-HHMM.md` con: durata, token, fix applicati, commit
- Se loop di hill-climbing si blocca per >3 iterazioni senza progresso, stop e scrivi `BLOCKED.md` con domanda specifica
- Cita sempre la sorgente (file/linea Ghidra, file/linea MAME) quando giustifichi una scelta di implementazione
- Mai usare `Math.random()` o `Date.now()` in `@marble-love/engine`: il core deve essere puro e deterministico
- Branded numeric types: definiti in `engine/src/wrap.ts`. Qualsiasi aritmetica fuori da quei helper deve fallire ESLint

## Appendice B — Letture obbligatorie prima di iniziare

1. https://phulin.me/blog/simtower
2. README di https://github.com/phulin/reaper
3. https://garryslist.org/posts/ai-just-ported-simcity-in-4-days-without-reading-the-code
4. https://banteg.xyz/posts/crimsonland/
5. MAME source: `src/mame/atari/atarisy1.cpp` e file correlati
6. Datasheet Motorola 68010
7. Per pattern emulator-in-JS: https://github.com/bfirsh/jsnes (NES in JS, codice di riferimento per bit-perfect arithmetic)

