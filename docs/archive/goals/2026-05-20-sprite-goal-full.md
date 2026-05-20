# GOAL — Active Objective

> Goal file root-level. Tutti gli agent e i developer che lavorano nella
> repo leggano questo file PRIMA di iniziare. Sopprime/aggiorna le scelte
> tattiche in conflitto con l'obiettivo dichiarato.

## Active goal

**Risolvere le regressioni sprite documentate da**
`/Users/magnus-bot/Desktop/sprite1.png` .. `sprite4.png` seguendo
`docs/codex-task-sprite-visibility-physics.md`.

Owner sessione corrente: Codex su `main`.

Reference video/storyboard ora ancorato: sorgente
`https://youtu.be/m2k1WCmkHBM` ("Marble Madness (MAME) - level 1-5",
recorded from MAME 2015-01-27), HTML salvato in
`/tmp/marble-sprite-goal/video-ref/youtube_m2k1WCmkHBM.html`, storyboard e
tile reference in `/tmp/marble-sprite-goal/video-ref/`. Frame utili:
`sprite1` Aerial red gates idx63/idx64 t126/t128s timer 42/39 circa,
`sprite2` Aerial GOAL idx76 t152s timer 15, `sprite3` Silly colored objects
idx107 t214s timer 17, `sprite4` Intermediate green blobs idx42 t84s timer
46. Questo rende verde l'ancora visuale MAME/reference, non la proof
active-vs-neutral/collisione.

Stato: active; D1/D2/D3/D4 ancora aperti. D4 ha un fix parziale solido
per `sprite3` (`type7/8/9` cull L5). Il probe corrente su
`/tmp/marble-sprite-goal/l5_type79_d4_199_after_fix.seed.json` mostra
oggetti `type7/8/9` binary-visible che il vecchio cull TS avrebbe escluso,
e il browser frozen capture
`/tmp/marble-sprite-goal/current-run/browser_l5_sprite3_type79_after_fix_clean.png`
mostra gli oggetti colorati sulla board giallo/nera L5. Resta pero' grigio
l'aggancio alla route MAME/frame esatto dello screenshot `sprite3` (timer
17), quindi non chiudere D4 su questo solo segnale. Nuovo avanzamento D4:
`packages/cli/src/search-l5-sprite3-visibility.ts` ha trovato un candidato TS
zero-death a timer `17` con `stepPixels=8`, seed
`/tmp/marble-sprite-goal/current-run/l5-sprite3-visibility-search-step8-20260519/01_l5_sprite3_f3261_timer17.seed.json`.
Il probe
`/tmp/marble-sprite-goal/current-run/l5_sprite3_timer17_step8_probe.json`
conferma descriptor `0x02de1e`, main/mode `0/0`, player state `0`, nove
righe `type7/8/9` visibili e tutte old-TS-dropped; il browser frozen capture
`/tmp/marble-sprite-goal/current-run/browser_l5_sprite3_timer17_step8.png`
mostra gli oggetti sul livello L5 al timer `17`. Questo rafforza molto
`sprite3`, ma resta candidato TS: manca ancora route/capture MAME live o
equivalente reference attach, quindi D4 e il goal restano aperti. Nuovi
tentativi MAME per `sprite3` hanno separato bene i casi: il prefix f2472
ricostruito non raggiunge L5 (resta L2/state5); bootstrap L5 f1747 raggiunge
descriptor L5 ma non state0; una base MAME corrente f3520 e' viva
(`0x02de1e`, state0, timer58) e la route step6 produce una proof
active/neutral responsive/stabile/no-death, ma il proof window f5965..f5985
non contiene type7/8/9 visibili (`visible789=0`). Evidence principale:
`/tmp/marble-sprite-goal/current-run/mame-l5-sprite3-current-f3520-step6-cand01-20260519/`.
Sweep MAME nativo da f3520 conferma il negativo: direzioni semplici step6
(`D/DL/DR/L/N/R/U/UL/UR`) e `DL` step `8/10/12/16` restano vive in vari casi
ma tengono i type7/8/9 sotto il viewport (`d4=324..370`, `visible789=0`).
Evidence:
`/tmp/marble-sprite-goal/current-run/mame-l5-f3520-direction-sweep-step6-20260519/`
e
`/tmp/marble-sprite-goal/current-run/mame-l5-f3520-dl-step-sweep-20260519/`.
Nuovo sweep MAME a due segmenti da f3520 (`DL` seguito da `R/DR/D`, varie
durate, piu' `R:900,DL:1552`) resta player state0/timer17 ma converge a
`x=932`, `y=844/916`, con `visible789=0` e `d4=322..370`; evidence
`/tmp/marble-sprite-goal/current-run/mame-l5-f3520-two-seg-sweep-20260519/`.
Anche tutti gli 8 candidati TS f3520/step6 sono stati replayati in MAME:
candidati 1..7 restano state0 e candidato 8 state4, tutti timer17, ma MAME
rimane nell'area `x=960..1037`, `y=978..1059` invece dell'area TS visibile
`x=713..824`, `y=710..895`; `visible789=0`, `d4=322..370`. Evidence:
`/tmp/marble-sprite-goal/current-run/mame-l5-f3520-step6-top8-ts-candidates-20260519/`.
Quindi `sprite3` resta grigio: TS visibility e' forte, MAME route attach
ancora no. `sprite4` e' ora ricondotto a
Intermediate/L3 (`0x2cd9e`) con oggetti `type4`: la vecchia pista
`0x2c54c/type0x2c` resta rigettata perche' punta a stati high-score non
corrispondenti, mentre una nuova route TS zero-death a frame `2400`, timer
`48`, prova due `type4` binary-visible e quattro MO linked-list a palette
`294`. Frozen browser capture su quella seed conferma la board L3 beige e un
oggetto verde visibile. Il seed L3 f2435 e' byte-exact con la vecchia proof
MAME delayed-input, ma il route attach MAME resta grigio: la cfg locale forza
service mode, con cfg pulita il bootstrap/current-MAME route non raggiunge
la stessa regione `type4`, e un loader warm-seed RAM-only conserva il frame
iniziale ma non abbastanza stato CPU/slapstic/dispatcher per far proseguire
MAME lungo la route TS. D4 quindi resta aperto. D3 ora copre i branch fisici
originali `FUN_29CCE` tag `0x05`, `0x0b`, `0x0c`, `0x0d`: `0x05` e' il
proximity bumper ROM con restore flags + sound `0x42`, mentre `0x0b/0x0d`
restano gate/bumper Aerial con guardie originali su `slot+0x46`. Il probe
corrente classifica gli slot L4 campionati con `base46=0x020c14` come
guard-miss/no-op originali. La scansione corpus salvata in
`/tmp/marble-sprite-goal/current-run/l4_gate_base46_corpus_scan.json` ha
controllato `88195` snapshot JSON: `16950` righe `tag 0x0b/0x0d`, tutte con
`base46=0x020c14`, zero righe con `0x22016/0x220a6`. Nuova route TS
diagnostica L4 verso timer 43, salvata in
`/tmp/marble-sprite-goal/current-run/l4-goal-route-search-20260519/manifest.json`
e
`/tmp/marble-sprite-goal/current-run/l4_sprite1_timer43_death_route_timeline.json`,
trova pero' finestre eligible: slot 2 `tag0b/base46=0x022016` a
routeFrame 1800 timer 53 e slot 4 `tag0d/base46=0x0220a6` a routeFrame 2100
timer 48. La route ha `deathEvents=2` e i delta non sono in contatto, quindi
non e' proof finale; usare questa pista per cercare contatto active-vs-neutral,
non per allargare guardie o cablare collisioni. Il candidato migliore per
`sprite2` e' ora la
famiglia visibile `type5` sub11/sub12 in
`oracle/scenarios/gameplay/level4_early.json`, mappata a slot collisione
11/12 tag `0x05`; il test `sub-29cce` usa la RAM reale di quello scenario e
prova slot 12 a `d6=0,a0=0` con restore flags, velocita' negata e sound
`0x42`. Pero' la scansione
`/tmp/marble-sprite-goal/current-run/l4_entity_type_scan.json` trova `0`
entity `type5` tra `5912` snapshot L4/Aerial `0x02d648`, quindi questo
candidato non e' ancora owner dello screenshot Aerial/GOAL. Resta da
agganciare `sprite2` allo screenshot/contatto esatto con proof
active-vs-neutral. Nuova ripresa del PRD ha corretto una falsa pista L4: il
candidato
`/tmp/marble-sprite-goal/current-run/l4-gate-contact-zero-death-20260519`
usava delta post-frame e sembrava `d6/a0=0/0`, ma il debug runtime di
`FUN_29CCE` mostra che durante la branch reale era un guard/range miss. La
ricerca aggiornata ora usa solo `lastTerrainGateProbe` runtime e ha trovato
un candidato TS zero-death vero:
`/tmp/marble-sprite-goal/current-run/l4-gate-runtime-contact-20260519/manifest.json`.
La route `D:90,UR:30,DR:30,UR:30,DR:30,D:60,L:30,R:30` colpisce slot 2
`tag0b/base46=0x022016` a routeFrame `321`, timer `78`, con
`runtime-inner-impulse`; il replay active-vs-neutral TS mostra
`inner-impulse` contro `outer-range-x-miss`. Questo e' un passo D3 solido lato
TS, ma `sprite1/2` non sono ancora chiudibili: manca ancora MAME
active-vs-neutral e l'aggancio allo screenshot esatto. Tentativi MAME
successivi hanno reso questo candidato sospetto come proof: cold bootstrap L4
cfg/nvram pulita
`/tmp/marble-sprite-goal/current-run/mame-l4-runtime-contact-20260519/` e
variante Y-flip
`/tmp/marble-sprite-goal/current-run/mame-l4-runtime-contact-yflip-20260519/`
restano su `state1` e su slot `tag17/tag18`, senza agganciare il gate TS;
warm-seed RAM-only
`/tmp/marble-sprite-goal/current-run/mame-l4-runtime-contact-warm-20260519/`
parte dal seed esatto ma a f2735 finisce in `state4` e mostra i gate L4 solo
come `base46=0x020c14`. Quindi non promuovere questa route: per D3 serve una
nuova route MAME-live/manuale sullo screenshot esatto oppure prova MAME/disasm
che i gate visibili `0x020c14` sono volutamente visual/no-op e che il contatto
mancante appartiene a un'altra famiglia oggetto.

Nuovo screenshot utente
`/Users/magnus-bot/Desktop/Screenshot 2026-05-19 alle 16.28.13.png` ha
spostato il `sprite1` bug da "nonphysical" a "post-hit stuck": overlay TS su
L4/Aerial mostra un contatto reale `tag0b` con slot `2@0x400b48`,
`base46=0x022016`, `d6/a0=(14,-15)`, e player in `state1a=0x0a`,
`f57=0x20`, `f58=0x02`. Quindi `FUN_29CCE` entra correttamente nel ramo
inner-hit; mancava invece il ramo `FUN_253EC` jump-table `JT[10]`
(`0x2563e`) che nel binario esegue `FUN_1B9CC`, `FUN_13D38`, reindirizza lo
script slot con `0x1d752/0x1d798`, chiama `FUN_12896`, passa il player a
`state1a=4`, incrementa `obj+d2`, azzera `obj+5a`, e mette `obj+57=0x65`.
Implementato in `packages/engine/src/refresh-frame-10fce.ts` con test mirati
in `packages/engine/test/refresh-frame-10fce.test.ts`. Validazione:
`npx vitest run packages/engine/test/refresh-frame-10fce.test.ts --silent`
PASS (`17` tests), focused sprite/refresh pack PASS (`58` tests), engine
typecheck PASS. Questo dovrebbe sbloccare il respawn dopo aspirazione nel
primo URL, ma il goal resta aperto: gli altri casi sprite e la proof
MAME/reference complessiva non sono ancora tutti verdi.

Nuova proof TS replayabile per lo stesso bug: esteso
`packages/cli/src/search-l4-gate-contact.ts` con `--target-contact` e cercato
esplicitamente `inner-hit-state`. Manifest:
`/tmp/marble-sprite-goal/current-run/l4-gate-state10-search-20260519/manifest.json`.
Route zero-death:
`D:90,UR:30,DR:30,UR:30,DR:30,D:60,L:30,U:30`, `stepPixels=32`.
La route entra in `runtime-inner-hit-state` a routeFrame `327`, timer `78`,
slot `2`, `tag0b/base46=0x022016`, `d6/a0=(5,-14)`, e player
`state1a=10`, `f57=0x20`, `f58=0x02`. Replay con coda neutrale salvato in
`/tmp/marble-sprite-goal/current-run/l4_gate_state10_exit_timeline_after_fix.json`
mostra `state10` da routeFrame `327..390` e uscita a `state4` da frame `391`;
a routeFrame `430` il player e' in `state4`, non bloccato. Aggiunto test
ROM+seed+route in `packages/engine/test/l4-gate-state10-route.test.ts`;
validazione: test nuovo PASS, engine typecheck PASS, cli typecheck PASS.
Tentato anche route attach MAME per la nuova route `inner-hit-state`:
`/tmp/marble-sprite-goal/current-run/mame-l4-state10-route-20260519/`.
Active/neutral sono responsive, ma l'audit
`/tmp/marble-sprite-goal/current-run/mame-l4-state10-route-20260519/audit-route-proof.json`
resta `diagnostic-only`: la finestra MAME parte gia' con player `state4`, non
`state0`, e i gate campionati sono ancora `base46=0x020c14`
(`tag0b/tag0d-guard-miss-original-noop`) invece del contatto TS
`0x022016`. Quindi questa e' una buona proof TS/regression, ma non ancora
MAME active-vs-neutral promuovibile per chiudere `sprite1`.

Nuovo checkpoint `sprite3`: l'URL confermato dall'utente come corretto e'
`http://192.168.85.200:5173/?autoLoad=1&startLevel=5&debugState=1&sound=0&loopReset=0`.
Manual TS: tutti gli sprite L5 si vedono e la marble reagisce correttamente.
Questo rafforza il caso TS, ma non chiude D4 perche' manca ancora la proof
MAME/reference attachment richiesta dal PRD.

Nuovo checkpoint `sprite2`: la pista `type5`/tag `0x05` non va piu' trattata
come owner dello screenshot GOAL. Il route/probe aggiornato
`/tmp/marble-sprite-goal/current-run/l4_sprite2_goal_route_probe_type10.json`
mostra che l'oggetto arancio/bruno e' `type10/sub0`, struct `0x400a9c`,
marker `0x0a`, cel list `0x0210ca`, active MO block `0x02108e`, linked
sprites `147/149/152/145` palette `305`. Questo stesso object mapppa allo
slot collisione `0@0x400a9c`, `tag1f=0x0a`, cioe' la branch originale
catapulta. La route TS da
`/tmp/marble-sprite-goal/current-run/l4-sprite2-goal-route-search-20260519/`
colpisce la branch a routeFrame `1309` con `d6/a0=(7,1)` e mette il player in
`state1a=3`, `obj+0x58=0x0a`, snap `x/y=(504,560)`, launch velocity
`vx=3370`, `vy=-163336`. Aggiunto confronto TS active-vs-neutral nello stesso
test route L4: active lancia la marble, neutral no. Validazione:
`npx vitest run packages/engine/test/l4-gate-state10-route.test.ts --silent`
PASS (`2` tests), engine/cli typecheck PASS. Anche qui: proof TS forte, ma non
ancora MAME active-vs-neutral promuovibile, quindi goal aperto.

## Done when

Il goal e' concluso solo quando il PRD sprite ha evidenza verde per tutti e 4
i casi:

1. `sprite1` e `sprite2`: oggetti visibili e interazione fisica MAME-like
   provata con confronto active-vs-neutral o contatto-vs-no-contatto.
2. `sprite3` e `sprite4`: oggetti visibili nel livello/location corretti,
   palette/layer plausibili e pipeline object -> MO -> renderer tracciata.
3. Ogni caso ha owner classification aggiornata: slot oggetto, emissione
   sprite RAM, `render.buildFrame`, web renderer, collisione, oppure blocker.
4. Test/probe mirati verdi e regression gates D5 eseguiti.
5. Il checkpoint finale separa chiaramente fixed, blocked e grey. Per Rule 12,
   nessun caso grey puo' chiudere il goal.

## Current PRD And Checkpoint File

- `docs/codex-task-sprite-visibility-physics.md`
- Aggiornare il checkpoint log dopo ogni deliverable o finding importante.
- Non revertare scratch/dirty/untracked non collegati al task.
- Non cablare seed, route proof, terreno o fisica con workaround visivi.

## Hard rules for this goal

- Usare MAME/disasm/RAM/probe come fonte di verita', non somiglianze visive.
- Non fingere sprite mancanti nel renderer se manca emissione object/MO a
  monte.
- Non aggiungere hitbox screen-space ad hoc per gli sprite visibili ma
  non fisici.
- Rule 12 fail-loud: semantica unknown resta unknown; non inventare.

---

## Completed previous goal — Level Descriptor Header

**Concludere il reverse engineering del Level Descriptor Header** seguendo
integralmente `docs/level-header-decode-prd.md`.

Owner sessione corrente: Codex su `main`.

Stato: done; post-header-terrain-decode-done.

## Done when (archive)

Il goal e' concluso quando tutti e 7 i success criteria del PRD
(`docs/level-header-decode-prd.md` sezione "Success criteria") sono
soddisfatti:

1. Disasm verificato per ogni offset documentato (citation file:line).
2. MAME tap verificato per ogni offset consumato (run scriptata 6 livelli).
3. Parity test dei 3 consumer esistenti (`FUN_16EC6`, `FUN_16F6C`,
   `FUN_259B4`) restano 500/500.
4. `docs/level-header-format.md` esiste, completo, linkato.
5. `packages/engine/test/level-header-decode.test.ts` + `packages/cli/src/probe-level-header.ts` verdi.
6. `npm test` 1982+N pass, `obj0.x 99/99` invariato, drift workRam @ f+99 invariato.
7. Byte UNKNOWN documentati onestamente (no semantica inventata).

## Coordinamento con Codex

Codex sta lavorando in parallelo sulla codebase (worktree separato, branch
`codex/*` o equivalente). Per evitare merge conflict e proof regression:

### File che questa sessione (level-header-decode) puo' toccare

| Path                                                | Note |
| --------------------------------------------------- | ---- |
| `packages/engine/src/level.ts`                      | Target principale: refactor `LevelHeader` + `HeightRecord`, fix `LEVEL_HEADER_SIZE`. |
| `packages/engine/src/index.ts`                      | **Una sola riga** di export in fondo. Rebase prima del merge. |
| `packages/engine/test/level-header-decode.test.ts`  | File nuovo. |
| `packages/cli/src/probe-level-header.ts`            | File nuovo. |
| `docs/level-header-format.md`                       | File nuovo (deliverable). |
| `docs/level-header-decode-prd.md`                   | Aggiornabile solo per checkpoint (`Status:` + section "Findings"). |
| `oracle/mame_level_header_tap.lua` (se serve)       | File nuovo. |
| `GOAL.md`                                           | Solo per chiudere il goal (`Status: done`). |
| `STATUS.md`                                         | NO. Lo aggiorna Marco al merge. |

### File OFF-LIMITS per questa sessione (territorio Codex / runtime core)

Allineato con `docs/codex-prd.md` regole di non-interferenza:

| Path                                                | Perche' |
| --------------------------------------------------- | ------- |
| `packages/engine/src/main-tick.ts`                  | Runtime orchestrator, modificato da Codex su gate cadence. |
| `packages/engine/src/boot-init.ts`                  | Cold-boot path. Off-limits convenzionale. |
| `packages/engine/src/refresh-frame-10fce.ts`        | Body M68K dispatcher. Tocca lo Codex per chain JSR. |
| `packages/engine/src/state.ts`                      | Interfaccia `GameState`. Modifiche structural rompono Codex. |
| `packages/engine/src/render.ts`                     | Engine->renderer boundary. Modifiche rompono frontend. |
| `packages/engine/src/level-dispatcher-16ec6.ts`     | Consumer bit-perfect del header. **Read-only** per questo task. Se la mia decode contraddice questo consumer, e' la decode sbagliata. |
| `packages/engine/src/level-init-16f6c.ts`           | Idem. |
| `packages/engine/src/object-init-259b4.ts`          | Idem. |
| `packages/engine/src/main-loop-init-*.ts`           | Codex Task A area. |
| `packages/web/src/main.ts`                          | Frontend entry. |
| `STATUS.md`, `README.md`, `HANDOFF_*.md`            | Gestiti da Marco. |

### Regola di conflict resolution

Se questa sessione deve toccare un file off-limits per chiudere il goal:
**stop e flag a Marco**, non procedere. Il goal puo' attendere; un merge
conflict su `main-tick.ts` o `state.ts` no.

## Validation gate (sempre verdi durante e a fine task)

Eseguire prima di ogni commit e prima di chiudere il goal:

```sh
npm run typecheck
npm run test --silent
npx tsc -b
```

Probe non-regressione (vedi `docs/agent-briefing.md` sezione 10):

```sh
npx tsx packages/cli/src/probe-cluster-histogram.ts | head -1
# atteso baseline corrente: total=172 | gameplay=0 | stack-residue=172

npx tsx packages/cli/src/probe-100f-diff.ts | grep "obj0.x"
# atteso: obj0.x bit-perfect 99/99
```

Se uno regredisce: rollback immediato, non avanzare.

## Hard rules (estratto da `CLAUDE.md`)

Per ricordo durante il task:

- **Rule 1 — Think before coding.** State assumptions. Se incerto, ask, non guess.
- **Rule 5 — Use model only for judgment.** Reverse engineering deterministico: usa il disasm + tap MAME, non interpretazione semantica del modello.
- **Rule 8 — Read before write.** Prima di decodare un offset, leggi *tutti* i consumer in TS e ROM.
- **Rule 9 — Tests verify intent.** Un test deve poter fallire se la semantica del campo cambia, non solo se i bit cambiano.
- **Rule 12 — Fail loud.** Un campo UNKNOWN onestamente documentato e' un deliverable valido. Una semantica inventata e' un bug.

## Riferimenti

- PRD del task: `docs/level-header-decode-prd.md`
- Briefing per agent: `docs/agent-briefing.md`
- Coordinamento Codex: `docs/codex-prd.md` (regole non-interferenza)
- Rule template: `CLAUDE.md`
- Context durable: `HANDOFF_CURRENT_CONTEXT.md`

## Chiusura del goal

Quando i 7 success criteria del PRD sono soddisfatti:

1. Marca `Status: done` in cima a questo file (no delete: serve audit trail).
2. Linka il `docs/level-header-format.md` finale da `docs/findings/README.md` se sale a livello di finding, altrimenti da `STATUS.md` come task chiuso.
3. Apri PR (o flag Marco per merge) dal branch della sessione.
4. NON chiudere il goal se anche un solo criterio e' grigio. Vedi Rule 12.

---

Status: **phase-1-static-done** — started 2026-05-18 on branch `claude/marble-1984-analysis-I0AJ0`.

Status: **phase-2-probe-done** — 2026-05-19 on branch `codex/level-header-decode`.

Status: **phase-2-decode-partial** — 2026-05-19 on branch `codex/level-header-decode`.

Status: **phase-2-parity-done** — 2026-05-19 on branch `codex/level-header-decode`.

Status: **phase-2-validation-blocked** — 2026-05-19 on branch `codex/level-header-decode`.

Status: **phase-2-validation-done** — 2026-05-19 on branch `codex/level-header-decode`.

Status: **post-header-terrain-decode-done** — 2026-05-19 on `main`.

## Follow-up — post-header / terrain-code decode

User request: decodificare il residuo rimasto dopo la spiegazione del
level descriptor header. Scope attuale:

- chiudere il falso residuo `HeightRecord.word1..word3` senza inventare
  semantica;
- decodare il corpo post-header reale;
- decodare il `terrainCode` consumato da `FUN_1CABA`, per collegare il
  descriptor alla projection struct `0x401c28`;
- aggiornare parser, probe, test e docs.

Risultato implementato:

- `LevelData.postHeader` espone terrain row pointers, sub-pattern pointers,
  tile-line descriptors, row-build script e RLE row offsets.
- `decodeTerrainCode`, `decodeDirectTerrainByteRecord` e
  `resolveTerrainCodeHeights` modellano i 5 range del consumer `FUN_1CABA`:
  `empty`, `direct`, `indirect`, `quad`, `flat`.
- `packages/cli/src/probe-level-header.ts` stampa il nuovo layout e la
  distribuzione dei terrain-code per livello.
- `packages/engine/test/level.test.ts` copre i conteggi reali dei 6 livelli.

Validazione finale:

- `npx tsc -p packages/engine/tsconfig.json --noEmit` -> PASS.
- `npx vitest run packages/engine/test/level.test.ts packages/engine/test/level-header-decode.test.ts packages/engine/test/sub-1caba-tile-redraw.test.ts packages/engine/test/sprite-project-1cc62.test.ts --silent`
  -> PASS, 53 tests.
- `npx tsx packages/cli/src/probe-level-header.ts` -> PASS.
- `npm run typecheck` -> PASS.
- `npm run lint` -> PASS.
- `npx tsc -b` -> PASS.
- `npm run test --silent` -> PASS, 255 test files passed, 2214 tests
  passed, 17 skipped.
- `npx tsx packages/cli/src/probe-cluster-histogram.ts | head -1` ->
  `f+99 workRam diff: total=172 | gameplay=0 | stack-residue=172`.
- `npx tsx packages/cli/src/probe-100f-diff.ts | grep "obj0.x"` -> PASS,
  TS and MAME `obj0.x` match through `f+99`.
- `git diff --check` -> PASS.

## Phase 2 Deliverable 5 — validation done

D5 was resumed after the blocked checkpoint below. The prior red failures
were confirmed against `origin/main` (`0edb629`) where applicable, then fixed
or updated to current baseline semantics:

- `slapsticLookup` now skips FSM bank application for synthetic/legacy ROM
  fixtures with no loaded `slapsticBanks`, preserving flat test writes while
  keeping real loaded-ROM behavior.
- Audio fallback tests now match the product behavior: fallback beeps/media
  cues are silent by default and only play with `?soundCueForce=1`.
- Warm-state boot tests now assert legacy replay ticks only for the recognized
  attract snapshot shape.
- Engine diagnostic sprite palette expectation now matches normal MO palette
  normalization.
- Playable route smoke expectations were updated from stale exact-ish bounds
  to current guardrail invariants: controllability remains distinct from
  neutral input, the manually rearmed finish-line seed is not counted as
  completion proof, and the transient state-1 tumble remains bounded.
- `integration-playfield-chain.test.ts` now loads the ROM through
  `loadRomBlob`; direct `rom.program.set(...)` left slapstic banks empty and
  could hang the level dispatcher.

Validation commands:

- `npm run typecheck` -> PASS.
- `npm run test --silent` -> PASS, `255 passed | 3 skipped` test files,
  `2206 passed | 17 skipped` tests.
- `npx tsc -b` -> PASS.
- `npm run lint` -> PASS.
- `npx eslint packages/` -> PASS.
- `npx tsx packages/cli/src/test-level-header-decode-parity.ts 500` ->
  PASS for `16ec6`, `16f6c`, `259b4`.
- Regenerated `/tmp/mame_100f.json` with
  `oracle/mame_state_multidump.lua` for frames `12000..12099`.
- `npx tsx packages/cli/src/probe-cluster-histogram.ts` ->
  `f+99 workRam diff: total=172 | gameplay=0 | stack-residue=172`.
  This same value was verified on `origin/main` (`0edb629`), so the older
  `total=387/gameplay=215` expectation in the briefing is stale relative to
  the current baseline.
- `npx tsx packages/cli/src/probe-100f-diff.ts | grep "obj0.x"` prints
  matching `TS == MAME` checkpoints through `f+99`.
- `git diff --check` -> PASS.

`docs/level-header-format.md` is linked from `docs/findings/README.md`.
The legacy post-header `HeightRecord` premise remains handled via Rule 12:
no semantic meaning is invented for `word1..word3` without direct consumer
proof.

## Phase 2 Deliverable 5 — validation blocked

D5 was started in PRD order and stopped fail-loud because the first full gate
is red. After rebasing `codex/level-header-decode` on `origin/main`
(`0edb629`) and re-running the targeted D4/engine gates successfully,
`npm test` still failed:

- `npm test` was run and showed failures before completion; after more than
  two minutes and with failures already recorded, the Vitest process was
  stopped manually.
- Observed failures included:
  - `packages/web/test/sound-renderer.test.ts`: 2 failures.
  - `packages/engine/test/boot-init.test.ts`: 1 failure.
  - `packages/engine/test/slapstic-lookup.test.ts`: 8 failures.
  - `packages/engine/test/level-helper-2ffb8.test.ts`: 1 failure.
  - `packages/web/test/engine-diagnostic-frame.test.ts`: 1 failure.
  - `packages/engine/test/playable-live-routes.test.ts`: 3 failures.
- A focused rerun of
  `npx vitest run packages/engine/test/level-helper-2ffb8.test.ts packages/engine/test/slapstic-lookup.test.ts`
  reproduced 9 failures in files untouched by this task.

D5 follow-up commands (`probe-cluster-histogram`, `probe-100f-diff`,
`npx tsc -b`, `npx eslint packages/`) were not advanced after the red
`npm test` gate. The goal remains open and must not be marked done.

## Phase 2 Deliverable 4 — parity done

Implemented `packages/cli/src/test-level-header-decode-parity.ts` as the
aggregated D4 gate. It runs direct musashi-wasm parity for the three header
consumers without modifying the historical per-consumer scripts:

- `FUN_16EC6`: patches `FUN_2FFB8`, `FUN_2FF28`, `FUN_18FD0`, and
  `FUN_1A444` to RTS; compares observable workRam writes and validates decoded
  `binsearchBasePtr` / y-scroll output from the real six headers.
- `FUN_16F6C`: patches `FUN_2FFB8`, `FUN_2FF40`, and `FUN_1A668` to sentinel
  stubs; compares sentinel side effects and validates decoded ctrl/ext/y-range
  first-row args from the real six headers.
- `FUN_259B4`: patches heavy sprite/object JSRs and checks the historical
  stable player-object coverage (`objCount` 0..2, slots 0..1). Attempts to
  extend synthetic parity to slot 2+ were rejected because object stride
  enters scene/global memory; slot 4+ can overwrite `0x400474`.

Result artifacts:

- `runs/level-header-parity-16ec6.txt` -> `Match: 500/500 = 100.0%`.
- `runs/level-header-parity-16f6c.txt` -> `Match: 500/500 = 100.0%`.
- `runs/level-header-parity-259b4.txt` -> `Match: 500/500 = 100.0%`.

D4 is closed. The goal remains open: final D5 validation is still pending and
the legacy `HeightRecord` premise remains Rule-12 gray (documented below).

## Phase 2 Deliverable 3 — decode partial, Rule 12 gray items remain

Closed with proof:

- `+0x08` is not padding: `FUN_1A444` reads it as
  `rowBuildBitListPtr` (MAME PC `0x01A462`) and consumes it as a bit-list
  for `FUN_1AD54`.
- `+0x24` is not padding: `FUN_1A444` reads it as `binsearchEndIndex`
  (MAME PC `0x01A470`) and writes `0x40065e = binsearchBasePtr + value*2 - 2`.
- `+0x1A` is `rowBuildEntryCount` (MAME PC `0x01A45A`) and overlaps
  `entityInitPositions[3]`.
- `+0x1C` is `tileLineDescriptorPtr` (MAME PC `0x01A4D0`) and overlaps
  `entityInitPositions[4..5]`.

Files updated in D3:

- `oracle/mame_level_header_tap.lua`
- `packages/engine/src/level.ts`
- `packages/engine/test/level-header-decode.test.ts`
- `docs/level-header-format.md`
- `docs/level-header-decode-prd.md`

Evidence generated:

- MAME logs: `/tmp/marble-level-header-tap-phase2-L1.log` ...
  `/tmp/marble-level-header-tap-phase2-L6.log`.
- Extra entity diagnostic: `/tmp/marble-level-header-tap-L1-entities6.log`
  forced `MARBLE_LEVEL_TAP_FORCE_ENTITY_INIT_COUNT=6`; ROM still read only
  `entityInitPos_0..3` at `FUN_259B4`.
- Ghidra disasm: `/tmp/ghidra-1a444.txt`, plus checked physics targets
  `/tmp/ghidra-121b8.txt`, `/tmp/ghidra-1cd00.txt`, `/tmp/ghidra-19d94.txt`.
- Tap-vs-ROM comparison: `/tmp/marble-headers-vs-tap-phase2.diff`,
  `checked=2943 mismatches=0`.

Validation for D3 edits:

- `npx vitest run packages/engine/test/level-header-decode.test.ts` -> PASS,
  26 tests.
- `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false` -> PASS.

Rule 12 status:

- Entity-init slots 4..5 are UNKNOWN-verified as entity semantics in the
  tested paths. Their bytes are consumed naturally as `tileLineDescriptorPtr`,
  and even a count=6 diagnostic did not make `FUN_259B4` read them stably.
- Legacy `HeightRecord.word1..word3` remains UNKNOWN. Ghidra checks of
  `FUN_121B8`, `FUN_1CD00`, and `FUN_19D94` did not show direct reads of
  the post-header block; Phase 2 found that the parser's "records" naming is
  legacy and the post-header data is a mix of column table and row-builder
  structures.

D3 is still **not** `phase-2-decode-done` until the legacy `HeightRecord`
premise is closed as decoded or UNKNOWN-verified against the PRD criteria.

## Phase 2 Deliverable 1 — tap done

Worktree isolato creato da commit `9bde37e` su branch
`codex/level-header-decode`. Baseline Phase 1 verificata:

- `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false` -> PASS.
- `npx vitest run packages/engine/test/level-header-decode.test.ts` -> PASS, 20 test.
- `npx vitest run packages/engine/test/level.test.ts` -> PASS, 4 pass + 6 skip.

Prerequisiti locali verificati:

- ROMs disponibili via symlink ignored in `roms/`.
- MAME `0.286`.
- `ghidra_project/marble_program.bin` disponibile.
- `node_modules/musashi-wasm/` presente dopo `npm install`.
- `uv tool list` mostra `pyghidra v3.0.2`.

Mismatches documentali/ambiente gestiti fail-loud:

- `docs/codex-task-level-header-phase2.md` cita `oracle/run-mame.sh`, ma
  quel wrapper non esiste su questo branch. Le run sono state eseguite con
  comando MAME esplicito equivalente.
- Il comando PRD `python3 tools/rom_prep.py` e' incompleto per lo script
  corrente: serve `--out`. Il blob e' stato verificato/generato con
  `python3 tools/rom_prep.py --rom-zip roms/marble.zip --bios-zip roms/atarisy1.zip --out ghidra_project/marble_program.bin`.
- Il tap address-based originale su ROM produceva valori parziali/rumorosi.
  `oracle/mame_level_header_tap.lua` e' stato esteso con consumer PC-taps
  M68K e composizione opzionale con `mame_playable_input_capture.lua`.

Log generati:

- `/tmp/marble-level-header-tap-L1.log`
- `/tmp/marble-level-header-tap-L2.log`
- `/tmp/marble-level-header-tap-L3.log`
- `/tmp/marble-level-header-tap-L4.log`
- `/tmp/marble-level-header-tap-L5.log`
- `/tmp/marble-level-header-tap-L6.log`
- `/tmp/marble-level-header-tap-L1-entities.log`
- `/tmp/marble-level-header-tap-L2-entities.log`
- `/tmp/marble-level-header-tap-L3-entities.log`
- `/tmp/marble-level-header-tap-L4-entities.log`
- `/tmp/marble-level-header-tap-L5-entities.log`
- `/tmp/marble-level-header-tap-L6-entities.log`

Copertura D1:

- Le run normali coprono sui 6 livelli:
  `directTerrainPtr`, `tileWordTablePtr`, `rleSourcePtr`, `yScrollBase`,
  `entityInitPos_0`, `maxTileBound`, `subPatternTablePtr`,
  `binsearchBasePtr`, `extByteTablePtr`.
- Le run diagnostiche `*-entities.log` forzano solo RAM di bootstrap
  (`objCount` e `obj[i]+0x18=3`) e fanno leggere al consumer ROM originale
  `FUN_259B4` anche `entityInitPos_1`, `entityInitPos_2` e
  `entityInitPos_3`.
- `yScrollRange` e' osservato nel solo path ROM che lo consuma col
  bootstrap corrente: `levelIndex==4` / descriptor L5. Non viene forzato
  sugli altri livelli per non inventare un path non-ROM.
- `UNKNOWN_08`, `UNKNOWN_24`, `entityInitPos_4..5` restano nel perimetro
  del Deliverable 3: vanno chiusi con xref/tap estesi o marcati
  UNKNOWN-verified.

## Phase 2 Deliverable 2 — probe done

File generati:

- Probe ROM dump: `/tmp/marble-headers.txt`.
- Comparazione tap-vs-probe: `/tmp/marble-headers-vs-tap.diff`.

Risultato comparazione:

- `checked=3496 mismatches=0` sui `SOURCE=pc-tap` osservati combinando
  log normali e log diagnostici entity.
- Ogni VALUE letto dai PC consumer MAME coincide col byte/word/long ROM
  decodato dal probe TS per quel livello e offset.

Decisione Rule 12: D1 e D2 sono chiusi per i field consumati/osservabili.
Il goal complessivo resta aperto: i byte UNKNOWN e gli entity-init slot
non osservati naturalmente sono ancora da chiudere nel Deliverable 3.

## Phase 1 static — done

Deliverable Phase 1 (verifica statica via re-reading dei consumer engine
gia' bit-perfect contro il binario originale):

- `docs/level-header-format.md` — doc completo dei field verificati, con
  citation file:line per ogni offset noto e lista esplicita degli
  UNKNOWN restanti.
- `packages/engine/src/level.ts` — `LEVEL_HEADER_SIZE` corretto da
  `36` a `0x2E`. `LevelHeader` typed con 10 field decoded:
  `directTerrainPtr`, `tileWordTablePtr`, `rleSourcePtr`, `yScrollBase`,
  `yScrollRange`, `entityInitPositions[6]`, `maxTileBound`,
  `subPatternTablePtr`, `binsearchBasePtr`, `extByteTablePtr`. Field
  UNKNOWN (`+0x08`, `+0x24..0x25`, `+0x1A..0x1F` se entity 3..5 non
  attive) restano accessibili via `header.raw`.
- `packages/engine/test/level-header-decode.test.ts` — 20/20 unit test
  verdi, ROM-free, verificano mapping offset→field, signedness,
  lunghezza minima del raw.
- `packages/cli/src/probe-level-header.ts` — probe ready-to-run su ROM
  blob, stampa tabella decoded + heuristics record + hex dump per i 6
  header reali. Esegue solo con `MARBLE_LOVE_ROM_BLOB=...` impostato
  oppure `ghidra_project/marble_program.bin` in path.
- `oracle/mame_level_header_tap.lua` — script Lua ready-to-run che
  installa read taps su tutti i field noti dei 6 header. Output formato
  `FRAME PC OFFSET LEVEL FIELD VALUE SIZE`. Richiede MAME + ROMs.

Validation post-Phase-1 (eseguita in container):

- `npx tsc -p packages/engine/tsconfig.json --noEmit`: 0 errori.
- `npx tsc -p packages/cli/tsconfig.json --noEmit`: solo errore
  pre-esistente in `probe-pc-cycles.ts` (non causato da Phase 1).
- `npx vitest run packages/engine/test/level.test.ts`: 4 pass + 6 skip
  (ROM-side skipped, atteso).
- `npx vitest run packages/engine/test/level-header-decode.test.ts`:
  20 pass.

## Aperture residue (richiedono ROM + MAME + Ghidra)

Bloccanti per i success criteria 2, 3, 5 del PRD. Vedi
`docs/level-header-format.md` "Aperture residue" per dettaglio:

1. MAME tap su 6 livelli (script `oracle/mame_level_header_tap.lua`
   ready, da lanciare con ROMs locali).
2. Probe ROM dump (probe `packages/cli/src/probe-level-header.ts` ready,
   da lanciare con ROMs locali).
3. Decode UNKNOWN restanti: `+0x08` (long), `+0x24..0x25` (word).
4. Decode word 1-3 dei height records.
5. Parity test musashi-wasm di `decodeLevelHeader` come componente
   nuovo (500/500 random ROM-region inputs).
6. Link finale del doc da `docs/findings/README.md` o `STATUS.md`.

Conflict resolution rule del goal resta attiva durante Phase 2:
**stop e flag a Marco** se un file off-limits diventa necessario.

## Sprite visibility/physics goal checkpoint — 2026-05-19 user retest

Goal status in Codex app: paused. Do not mark complete yet.

Updated user-facing scope:

- `sprite1`: user retest says OK; no active follow-up unless regression
  evidence appears.
- `sprite2`: catapult is OK. Active bug is pistons: they physically repel the
  marble, but do not visually rise/animate. New reference screenshot:
  `/Users/magnus-bot/Desktop/pistoncini.png`.
- `sprite3`: user retest says OK; no active follow-up unless regression
  evidence appears.
- `sprite4`: still open. New reference screenshot:
  `/Users/magnus-bot/Desktop/verdi.png`; green/enemy sprites are invisible
  while physical pushes seem present.

Next investigation pass:

1. L4 pistons: inspect object-pair slot `0x400a20`, type2 dispatch, and MO
   emission/animation state around the collision seen in `pistoncini.png`.
2. L3 green/enemy sprites: inspect type4 object dispatch and web renderer
   visibility/layering against the linked sprites present in `mame_state.json`.

## Sprite visibility/physics checkpoint — 2026-05-19 pistons/greens pass

Goal status in Codex app: still paused/open. Do not mark complete yet.

Updated findings:

- L4 pistons (`sprite2` remaining scope): root-cause candidate found in the
  object-pair update path. `refreshFrame10FCE` default wiring for
  `FUN_158F6` state-2 slots used `helper25FC2`/`objectEnter1281C` without the
  full object-state and animation callbacks already present in the normal
  object dispatcher. This explains the split symptom: physical response
  present, but visual animation transitions incomplete.
- Patch applied in `packages/engine/src/refresh-frame-10fce.ts`: object-pair
  state-2 now enters `helper25FC2` through the same `objectStateEntry25BAE`,
  `objectInit2591A`, sprite projection, sound, and `FUN_1281C -> FUN_264AA`
  wiring used by the full dispatcher.
- Regression test added in `packages/engine/test/refresh-frame-10fce.test.ts`:
  `wires object-pair state-2 animation transitions through FUN_25FC2`.
- Route probe:
  `/tmp/marble-sprite-goal/current-run/l4_pistoncini_route_probe_after_pair_anim_wiring.json`
  reaches the L4 piston area near the user screenshot. The type2 object is
  visible (`type=2/sub=1`, struct `0x400a20`), emits linked MO sprites, and its
  screen coords move across the route. This is good TS evidence, but the user
  still needs to retest the exact live visual rise/animation.
- L3 greens (`sprite4`): current frozen `packages/web/public/mame_state.json`
  probe has two type4 objects with `visibleBinary=true`, active cel pointers
  `0x021b96` and `0x021abe`, and 5 linked sprites. Browser capture with
  `mameDump=1&debugState=0` shows the green objects visible:
  `/tmp/marble-sprite-goal/current-run/browser_l3_verdi_mamedump_debugoff_20260519.png`.
  The user screenshot `verdi.png` was taken with the debug overlay covering
  the top half of the board, where those sprites are located. Treat this as
  "likely overlay/test-mode issue", not as a renderer patch, until the user
  confirms with debug off.

Validation:

- `npx vitest run packages/engine/test/refresh-frame-10fce.test.ts --silent`
  PASS (`18` tests).
- `npx vitest run packages/engine/test/refresh-frame-10fce.test.ts packages/engine/test/sub-158f6.test.ts packages/engine/test/late-game-logic-26f3e.test.ts packages/engine/test/l4-gate-state10-route.test.ts --silent`
  PASS (`66` tests).
- `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false` PASS.
- `npx tsc -p packages/cli/tsconfig.json --noEmit --pretty false` PASS.

Next:

1. Ask user to retest L4 pistons live after reload.
2. Ask user to retest L3 greens with `debugState=0` or `mameDump=1`.
3. Keep goal open until both user-visible cases are confirmed.

## Sprite visibility/physics checkpoint — 2026-05-19 pistons code-only follow-up

Goal status in Codex app: still paused/open. Do not mark complete yet.

User follow-up: no assistant video/browser testing; investigate from code and
existing evidence. User reports pistons still are not visible at the first
test point, but after moving farther into the level the first pistons appear.

Updated findings:

- Replayed the existing L4 piston route with text probes only. Evidence:
  `/tmp/marble-sprite-goal/current-run/l4_pistoncini_route_probe_after_1281c_else_wiring.json`.
- Spawn and render are distinct here. Before the scroll descriptor crossing,
  object-pair slot `0x400a20` has stale-looking object data but `active18=0`,
  so original type2 rendering skips it. At routeFrame `1110`, scroll
  activation arms the slot (`active18=1`, `state1a=0x20`, `kind1b=0x04`).
  Its type2 projection is initially outside/at the top edge (`d4=-43`,
  `-36`, `-27`, `-17`) and enters the visible band by routeFrame `1150`
  (`d4=-6`). This matches "they appear after moving forward".
- The physics hit and type2 render owner are the same object-pair slot. Around
  routeFrame `1780..1790`, type2 is in the visible band (`d5/d4` around
  `70/139`) and `lastObjectPairCollision` records the hit at frame `1783`
  against `selfAddr=0x400a20`, `targetAddr=0x400018`.
- Added a narrow ROM-correct callback wire in
  `packages/engine/src/refresh-frame-10fce.ts`:
  `helper121B8Subs.fun_1281c -> objectEnter1281C/FUN_264AA` for the
  object-pair ELSE branch. This is correctness wiring, not a fake visual fix.
- The tempting "missing `obj+0x38` inner sprite" hypothesis is not supported:
  TS probe and local Musashi comparison both leave the type2 inner records
  empty for this piston state. Do not force `active18=2` or invent inner
  sprites.
- A code-only render build with real ROM motion-object lookup tables at the
  routeFrame `1780` state emits nonblank piston-family commands, including
  vertical type11/type13 direct-overlay commands and type2 commands
  (`spriteIndex=2049/2051`) with nonzero decoded opaque pixels. No assistant
  browser/video verification was run.

Current interpretation:

- The live symptom is now most likely an exact-position/scroll-window issue
  or a still-unmatched user state, not an obvious missing renderer command in
  the inspected route.
- If the user still sees physical response without sprites after reload, the
  next useful artifact is the exact debug state at that moment; do not change
  seeds, force `startLevel`, relax collision guards, or fabricate renderer
  sprites from this evidence alone.

Validation:

- `npx vitest run packages/engine/test/refresh-frame-10fce.test.ts --silent`
  PASS (`18` tests).
- `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false` PASS.

## Sprite visibility/physics checkpoint — 2026-05-19 Aerial piston slot-loop wiring

Goal status: still open. Do not mark complete until the user confirms the live
L4 piston groups after reload.

Latest user clarification:

- The symptom is group-lag, not a generic missing renderer command: the first
  pistons are static/passable; near the second static pistons the first group
  starts moving; second and third groups never move.
- No assistant video/browser testing per user request; investigation was code
  and text-probe only.

Code finding and patch:

- `FUN_1365C` (`object-render-update-1365c.ts`) contains the ROM branch for
  Aerial mode-3 state `A2+0x1b == 4`: it iterates the 25 script slots, calls
  `FUN_12F44(slot, mode=1, 0)` for active `state1a=4` slots, and calls
  `FUN_12896` for active `state1a=2` gate slots (`kind 0x0b/0x0d`).
- In TS those callees were still optional no-ops when `FUN_1365C` ran through
  normal gameplay defaults. That left stale state-4 piston slots visible/static
  instead of letting the ROM slot-loop free/advance them.
- Patch applied in `packages/engine/src/object-render-update-1365c.ts`:
  default `FUN_1365C` now delegates replicated callees to the real
  `helper12F44`, `helper12896`, `postStateChange13966`,
  `helper285B0`, and `soundCmdSend158AC`.
- Parity harness updated in
  `packages/cli/src/test-object-render-update-1365c-parity.ts` to pass
  explicit no-op callbacks, because that harness patches those ROM callees to
  `rts`.

Evidence:

- New text probe:
  `/tmp/marble-sprite-goal/current-run/l4_pistoncini_route_probe_after_1365c_sub_wiring_v2.json`.
- The route shows player tile-state transitions `30 -> 32 -> 3 -> 20 -> 4`.
  Slots `2/3/4` leave static `base46=0x020c14` and enter animated gate records
  (`0x021fc2`, `0x022016`, `0x022052`, `0x0220a6`, etc.).
- At routeFrame `1700`, when player state becomes `4`, the fixed `FUN_1365C`
  slot-loop frees the stale state-4 piston slots; before this patch those
  stale slots could remain/reappear as static visual records.
- Direct code probe confirms the later slots are triggerable: setting player
  `obj+0x1b` to `33`, `34`, or `35` triggers exactly one matching slot among
  `5/6/7` and moves it from `state1a=4/base46=0x020c14` into the expected
  animated records. The current route simply does not cross those tile-state
  edges, so this is not yet a live proof that the user's second/third groups
  animate in his exact path.

Validation:

- `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false` PASS.
- `npx tsc -p packages/cli/tsconfig.json --noEmit --pretty false` PASS.
- `npx vitest run packages/engine/test/post-state-change-13966.test.ts packages/engine/test/refresh-frame-10fce.test.ts packages/engine/test/sub-29cce.test.ts --silent`
  PASS (`55` tests).
- `npx vitest run packages/engine/test/helper-12f44.test.ts packages/engine/test/helper-121b8.test.ts --silent`
  PASS (`48` tests).
- `npx tsx packages/cli/src/test-object-render-update-1365c-parity.ts 40`
  PASS (`40/40`).

Next:

1. User retest L4 pistons after reload. Expected changed behavior: stale
   state-4 static piston records should no longer persist after the mode-3
   slot-loop fires.
2. If second/third groups still never animate, capture or probe the exact
   player `obj+0x1b` transitions around them; do not force slots `5/6/7`
   active without proving MAME crosses states `33/34/35` there.

## Sprite visibility/physics checkpoint — 2026-05-20 piston compact-debug pass

Goal status in Codex app: paused/open. Do not mark complete yet.

Latest user artifact:

- Mobile screenshot `Foto 1.jpg` shows L4/Aerial pistons still physically
  repelling the marble while the visible rise is not obvious. Overlay state:
  frame `3565`, timer `24`, runtime `level=3`, scroll near `(0,363)`,
  player `k=5`, `f36=02`, and `last obj-pair collision f=2845 loop=3`.

Text/code-only findings:

- Replayed a TS route to the same timer/frame band without opening a browser.
  At `frame=3565/timer=24`, the object-pair slot around `0x400a20` remains
  active and the linked motion-object list still contains piston-family sprite
  commands in the upper half of the viewport.
- The 25 terrain/script piston slots `2..7` are inactive by that point in the
  tested route, while the object-pair slot still owns physical collision. This
  matches the split symptom and means the next proof needs exact post-collision
  state for `0x400a20`, not a renderer-only fake sprite.
- The screenshot was taken with the debug overlay at `max-height:44vh`; the
  emitted motion objects for this sampled state sit in the same upper viewport
  band. Overlay occlusion is now a plausible explanation for "not visible with
  debug on", so the next retest should use compact debug or debug off.

Patch applied:

- `packages/engine/src/helper-1bc88.ts` and `packages/engine/src/state.ts` now
  record post-collision object-pair fields: active/state/k/f36 after the full
  z-depth branch, plus whether the path armed the target as `active18=2`, hit a
  player target, or skipped on z/f36 guards.
- `packages/web/src/main.ts` now supports `debugCompact=1`. Compact debug keeps
  only the high-signal player, last object-pair, pair-slot, and piston-slot
  lines and limits the overlay to `28vh`, so it is much less likely to cover
  the sprites under investigation.
- No gameplay/physics/collision/render behavior was changed in this pass.

Validation:

- `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false` PASS.
- `npx tsc -b packages/engine --pretty false` PASS.
- `npx tsc -p packages/web/tsconfig.json --noEmit --pretty false` PASS.
- `npx vitest run packages/engine/test/refresh-frame-10fce.test.ts packages/engine/test/helper-121b8.test.ts --silent`
  PASS (`48` tests).

Next retest URL:

- `http://192.168.85.200:5173/?autoLoad=1&play=1&startLevel=4&debugState=1&debugCompact=1&sound=0&loopReset=0`
- If compact-debug still looks wrong, retest the same spot with
  `debugState=0` to separate "sprite hidden by overlay" from an actual emitter
  or state-machine bug.

## Sprite visibility/physics checkpoint — 2026-05-20 piston handoff focus

Goal status in Codex app: paused/open. Do not mark complete yet.

User clarified that debug overlay coverage is not the cause. The pistons are
visible enough to judge: they remain stationary when the physics already repels
the marble, and they begin moving only after the marble goes much farther
forward in the level.

Created focused continuity file:

- `docs/codex-task-l4-pistons-current-context.md`

Next work must start there. The central task is now to find the first frame when
the piston physics arms, then explain why the matching terrain/script visual
slot is still static and why the animation trigger fires late. Update that file
after every new finding.
