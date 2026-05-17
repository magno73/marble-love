# PRD — Fix level-intro banner lifecycle (play=1 + startLevel)

**Owner:** Marco Magnocavallo
**Branch suggerita:** `feature/level-intro-banner-fix`
**Pre-requisito:** familiarità con `main-loop-init-1101e.ts`, `main-loop-init-11452.ts`, `helper-16e8e.ts`, `game-state-banner-26b2a.ts`, e con il flusso warm-state in `packages/web/src/main.ts`. Lettura obbligatoria: `docs/state-convergence-roadmap.md`.
**Vincolo non negoziabile:** il PRD originale impone replica bit-perfect del binario M68010. Nessun fix-up sintetico dei globali workRam dal layer web. Ogni byte di state deve nascere come effetto delle sub replicate, non come patch del loader.

---

## 1. Problema

Nel binario originale Marble Madness, l'inizio di ogni livello mostra un banner a centro schermo (es. `TIME TO FINISH / PRACTICE RACE`, `EXTRA TIME FOR / AERIAL RACE`) per ~5 secondi mentre il timer del livello viene caricato dei secondi disponibili. Il banner poi sparisce automaticamente e la corsa parte.

Nella reimplementazione TypeScript il comportamento è rotto in due modi distinti:

| Modalità di avvio       | Cosa succede ora                                      | Cosa dovrebbe succedere                                      |
|-------------------------|--------------------------------------------------------|--------------------------------------------------------------|
| `?play=1`               | Il banner non compare mai.                            | Banner visibile ~300 frame, poi sparisce.                    |
| `?startLevel=N` (1..6)  | Banner visibile dal frame 0 ma resta congelato per tutto il livello. | Banner visibile per il countdown residuo, poi pulizia automatica. |

## 2. Modello mentale del flusso originale (dal disasm replicato)

Il banner è il risultato della state-machine `*0x00400390` × `*0x00400392` × countdown `*0x0040075a`:

1. **Draw** — `state11452Case2` (`packages/engine/src/main-loop-init-11452.ts:146-164`): `gameStateBanner26B2A(state, rom, 0)` scatter-write 195 word da ROM `0x1FC10` ad alphaRam (righe ~9-10) + altre region; `bannerHelper26B66(0x13)` (palette queue push); `*0x40075a = 0x012c` (300 frame).
2. **Countdown** — `mainLoopInit1101E:case1` (`packages/engine/src/main-loop-init-1101e.ts:197-211`) decrementa il timer ogni frame mentre `*0x400390 == 1`. Quando arriva a 0: `*0x400392 = (mode + 1) > 2 ? 0 : (mode + 1)`; richiama `init11452`.
3. **Clear** — con `mode == 0` e `state == 1`, `state11452Case0` (`packages/engine/src/main-loop-init-11452.ts:112-144`) chiama `mainLoopInit10504` → `helper16E8E(state, 4)` (`packages/engine/src/helper-16e8e.ts:101-`) che azzera le righe `4..0x1E` dell'alpha tilemap.
4. **Trigger di ingresso a state=1 mode=2** — `case1:166-186`: la transizione `mode → 2` parte quando `*0x4003ee == 1 && *0x4003ea >= 0x18` (oppure `*0x4003ee == 0 && *0x4003ea >= 0x0c`) → `*0x40075a = 0xFFFF` → `init11452(case2)` → §2.1.

Il banner è quindi un sintomo emergente: se la state-machine evolve, il binario lo disegna e lo cancella da solo.

## 3. Diagnosi (perché oggi non funziona)

### 3.1 `?play=1` — banner mai disegnato

- Boot: `bootInit({preloadLevel:0, fullScreenInit:true})` seguito da `tick(..., runMainLoopBody:true)` (`packages/web/src/main.ts:1342-1366`).
- Stato osservato: `workRam[0x390] = 1` resta congelato; `workRam[0x3ee]` non viene mai promosso a 1 e `workRam[0x3ea]` non raggiunge `0x18` → la condizione di trigger in `main-loop-init-1101e.ts:167-175` non scatta → `*0x40075a` resta 0 → mode non passa a 2 → `state11452Case2` mai chiamata → banner mai scritto.
- **Questo è il problema già documentato in `docs/state-convergence-roadmap.md` §"Problema 1" (righe 18-26) e §"Step 3: State machine evolution" (righe 50-56).** Il banner ne è uno dei sintomi visivi.

### 3.2 `?startLevel=N` — banner congelato

- I seed playable (`packages/web/public/scenarios/playable/start_level{1..6}_intro_*_f####.seed.json`) sono snapshot MAME catturati al frame in cui il banner è visivamente presente. La scelta è documentata in `STATUS.md` §"2026-05-16 — startLevel intro-banner true starts": *"I sei `startLevel=1..6` sono ora cablati ai frame MAME in cui il gioco originale disegna il banner iniziale del livello. Il marker e' l'alpha overlay originale, non una finestra post-seed piu' tarda"*.
- L'alphaRam dello snapshot contiene i tile del banner, ma i workRam del seed L1 (`start_level1_intro_practice_f2479`) sono: `*0x400390 = 0`, `*0x400392 = 0`, `*0x4003ea = 0`, `*0x4003ee = 0`, `*0x40075a = 0`. In MAME a quel frame state e timer hanno già completato il countdown — il clear di alphaRam avverrebbe nei frame successivi via `mainLoopInit10504 → helper16E8E`. La nostra warm-state injection (`packages/web/src/main.ts:874-883, 986-1002`) carica il workRam così com'è e fa partire il tick loop dal frame +1.
- Tick loop con state=0 entra in `case 0` di `mainLoopInit1101E:111-113` → solo `refreshFrame10FCE`, che non scrive sulle righe 4-29 di alphaRam. Le condizioni per ri-entrare in state=1 mode=2 (§2.4) non sono soddisfatte (stesso problema della §3.1) → `helper16E8E` mai chiamato → banner congelato.

In sintesi: §3.1 e §3.2 sono **lo stesso bug** (state-machine non evolve). §3.2 lo rende visivamente eclatante perché il seed parte con il banner già disegnato; §3.1 lo nasconde perché senza banner pre-disegnato il fallimento è "silent".

## 4. Lavoro già considerato altrove (xref obbligatorio)

Questo fix NON è nuovo terreno. È la convergenza di tre track già aperti:

- **`docs/state-convergence-roadmap.md`** §"Step 3: State machine evolution" (righe 50-56): identificare cosa popola `workRam[0x3ee]` e `workRam[0x3ea]`. Candidati documentati: IRQ4 vblank handler (frame counter increment) o un timer sub specifico (FUN_???). *Stima sforzo lì dichiarata: 4-8 ore.* Questo è il fix di radice per §3.1.
- **`docs/state-convergence-roadmap.md`** §"Direzione strategica" (righe 93-110): opzione **A** = wirare `mainLoopInit117B2` come default (sblocca state-machine evolution end-to-end, allineata col PRD); opzione **C** = identificare le 2-3 sub specifiche minime. Opzione A è quella dichiarata "allineata col PRD".
- **`STATUS.md`** §"2026-05-16 — startLevel intro-banner true starts" (righe 325-342): le proof MAME esistono già in `/private/tmp/marble-true-start-banner-delayed-input-proof-20260516/l{1..6}-*`. La utility `packages/cli/src/detect-level-intro-banners.ts` scansiona seed/scenari per il marker alphaRam del banner — è il detector pronto all'uso per scegliere un nuovo frame di cattura.
- **`STATUS.md`** §"2026-05-16 — Six candidate seed audit" (righe 386+): `packages/cli/src/verify-start-level-candidates.ts` è il gate di promozione non-cablante per nuovi seed; richiede descriptor ROM L1..L6 atteso, frame, `main/mode=0/0`, state0, timer vivo, e le coppie active/neutral proof.

Questo PRD NON aggiunge soluzioni nuove: ordina e prioritizza le tre track esistenti specificamente per chiudere il banner intro.

## 5. Obiettivi (success criteria)

1. Con `?startLevel=N` (N ∈ 1..6) il banner originale del livello compare al boot e sparisce dopo il countdown originale (~300 frame), come effetto della state-machine replicata, senza patch al workRam dal layer web.
2. Con `?play=1` il banner del Livello 1 (`TIME TO FINISH / PRACTICE RACE`) compare al primo level-load e poi sparisce, replicando MAME.
3. Zero regressioni sui parity test (`packages/engine/test/**`, `packages/cli/src/test-*-parity.ts`).
4. `?scenario=intro_overlay` continua a comportarsi come oggi (smoke test indipendente).

## 6. Strategia (in ordine di priorità bit-perfect)

### Track A — Risolvere "state machine bloccata" (fix di radice, copre §3.1 + §3.2)

Eseguire **Step 3 di `docs/state-convergence-roadmap.md`**: identificare e wirare la sub che popola `workRam[0x3ee]` (= flag intro complete) e `workRam[0x3ea]` (= timer threshold).

1. Usare `tools/watch_write.lua` (workflow documentato in `STATUS.md`) per identificare i PC writer di `0x4003ee` e `0x4003ea` in MAME durante il boot del Livello 1 fino al frame 2479.
2. Per ognuna delle sub identificate, verificare in `docs/missing-subs-inventory.md` se è già replicata:
   - Se sì e non wirata → wirarla nel `tick()` (vedere `packages/engine/src/main-tick.ts`) seguendo lo stesso pattern dei sub `game-state-machine.ts` (`docs/missing-subs-inventory.md` §1.3).
   - Se no → replicarla con parity test 500/500 (pattern in `packages/cli/src/test-*-parity.ts`).
3. Verificare con `probe-converge.ts` che `workRam[0x390]` ora evolve attraverso gli stati 1→2→3→0 nei primi 2400 frame.
4. Verificare visualmente: `?play=1` mostra il banner del livello 1 e lo cancella; `?startLevel=N` mostra il banner residuo dal seed (alphaRam pre-disegnato) e lo cancella entro il countdown naturale.

**Track A chiude entrambi i casi senza toccare i seed.** È l'unica opzione coerente col vincolo bit-perfect del §0.

### Track B — Mitigazione lato seed (solo se Track A è bloccata)

Se l'analisi watch_write in A.1 rivela che la sub mancante richiede un porting non banale (stima sforata oltre il budget A), c'è una mitigazione **per il solo caso §3.2** che resta bit-perfect:

1. **Spostare i seed `start_level*` al frame in cui `*0x40075a == 0x012c` è appena stato settato** (cioè subito dopo che `state11452Case2` ha completato il proprio body). In quel frame `*0x400390 == 1`, `*0x400392 == 2`, timer attivo, alphaRam con banner. Il nostro tick loop esegue allora il countdown già replicato (`mainLoopInit1101E:case1`) e la chain `mainLoopInit10504 → helper16E8E` cancella il banner naturalmente — esattamente come nel binario.
2. Le proof MAME locali esistono già (`/private/tmp/marble-true-start-banner-delayed-input-proof-20260516/l{1..6}-*`, cfr `STATUS.md` §"true starts"). Cercare al loro interno un frame leggermente più precoce di quello attualmente promosso, dove `state11452Case2` è appena terminata.
3. Re-export con `packages/cli/src/export-playable-seed.ts` (workflow in `STATUS.md` §"L6 playableSeed export review"). Validare con `packages/cli/src/verify-start-level-candidates.ts --proofs`. Validare con `packages/cli/src/detect-level-intro-banners.ts` che il marker alphaRam è ancora presente al frame promosso.
4. Aggiornare `START_LEVEL_PLAYABLE_SEEDS` in `packages/web/src/practice-level.ts`.
5. Verificare visualmente per N=1..6 che banner compare e sparisce.

Track B **non chiude `?play=1`** (= §3.1). Quel caso resta legato a Track A. Track B è ammissibile solo come *unblock parziale* documentato come tale; nel commit message va citato esplicitamente che `?play=1` resta tracciato in `docs/state-convergence-roadmap.md` §"Step 3".

### Quale ordine seguire

L'agente parte da **Track A**. Se dopo l'investigazione watch_write (passo A.1) lo sforzo stimato per la singola sub mancante eccede 2 giorni-uomo, surface a Marco *prima* di proseguire e chiedere se autorizza Track B come ponte temporaneo per `?startLevel`. Default: proseguire A fino in fondo.

## 7. File da toccare

**Track A:**
- `packages/engine/src/main-tick.ts` (wiring della sub identificata).
- Eventualmente un nuovo file `packages/engine/src/<sub-name>.ts` se la sub non è ancora replicata.
- Eventualmente `packages/cli/src/test-<sub-name>-parity.ts` per il gate 500/500.
- `docs/state-convergence-roadmap.md` (annotare risultato Step 3).
- `docs/missing-subs-inventory.md` (aggiornare lo stato della sub da "missing" a "FULL").

**Track B:**
- Sei file `packages/web/public/scenarios/playable/start_level{1..6}_intro_*.seed.json` (rigenerati via tooling).
- `packages/web/src/practice-level.ts` (eventuale rename del seed in `START_LEVEL_PLAYABLE_SEEDS` se il frame cambia).

NON toccare:
- `packages/engine/src/game-state-banner-26b2a.ts` (replica disasm, parity-tested).
- `packages/engine/src/helper-16e8e.ts` (replica disasm, parity-tested).
- `packages/engine/src/main-loop-init-1101e.ts` / `main-loop-init-11452.ts` (replica disasm, parity-tested).
- **`packages/web/src/main.ts` per fix-up workRam sintetico.** Questo è esplicitamente vietato dal vincolo bit-perfect.

## 8. Test plan

- [ ] Manuale UI: `?startLevel=1..6` mostra il banner del livello e lo cancella entro 5-6 secondi visivi (300 frame @ 60 Hz).
- [ ] Manuale UI: `?play=1` mostra il banner del Livello 1 entro pochi secondi dall'inizio della partita e lo cancella.
- [ ] `npm test --workspace @marble-love/engine` resta verde.
- [ ] `?scenario=intro_overlay` continua a comportarsi come oggi (smoke).
- [ ] Headless: aggiungere uno script in `packages/cli/src/` che decodifica `state.alphaRam` ai frame 30 / 300 / 600 dopo il boot con `?startLevel=1` e verifica che le righe 9-10 contengano il banner al frame 30 e siano vuote al frame 600. Riusare `decodeAlphaLines` da `packages/cli/src/detect-level-intro-banners.ts`.
- [ ] Headless: probe-converge style — verificare che `workRam[0x390]` evolve da 1 → 2 → 3 → 0 entro i primi 2400 frame con `?play=1`.

## 9. Vincoli (CLAUDE.md aware)

- **Surgical Changes** (rule 3): cambi limitati alla sub mancante + wiring + seed re-export. Niente refactor.
- **Read before write** (rule 8): leggere prima `docs/state-convergence-roadmap.md`, `docs/missing-subs-inventory.md` §1, `state11452Case2/0`, `mainLoopInit1101E:case1`, `helper16E8E`, `STATUS.md` §"true starts" e §"export-playable-seed".
- **Surface conflicts** (rule 7): se Track A risulta bloccata, surface PRIMA di passare a Track B.
- **Tests verify intent** (rule 9): il test alphaRam (§8) deve fallire se il banner resta in alphaRam oltre il countdown — non deve solo testare il decremento del timer.
- **Fail loud** (rule 12): se il banner non sparisce ai test in §8, NON committare. Surface il blocker.

## 10. Out of scope

- Generalizzare l'intera state-machine TS oltre `*0x4003ee` / `*0x4003ea` (è il task complessivo di `docs/state-convergence-roadmap.md`, non solo Step 3).
- Audio del banner / cue sonori del countdown.
- Fade-in/fade-out delle lettere del banner (verificare prima in MAME se esiste).
- Refactor del warm-state loader.

## 11. Deliverable

1. Diff su branch `feature/level-intro-banner-fix` con:
   - Nuova sub (o wiring) per Track A;
   - Parity test 500/500 della nuova sub;
   - Aggiornamento `docs/state-convergence-roadmap.md` (Step 3 → DONE);
   - Aggiornamento `docs/missing-subs-inventory.md`.
2. (Se Track B usata) seed rigenerati + aggiornamento `practice-level.ts` + nota nel commit message che `?play=1` resta tracciato in `state-convergence-roadmap.md`.
3. Aggiornamento `STATUS.md` (1-2 righe).
4. Screenshot/gif di verifica (opzionale ma fortemente apprezzato).
