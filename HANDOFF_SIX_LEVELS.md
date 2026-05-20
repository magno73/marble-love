# HANDOFF — Six Real Level Identification

> Legacy note: this file records the investigation that led to the six
> true-start levels. It is not current startup context, and several early
> "do not wire startLevel=2..6" statements were later superseded. Current
> start-level status lives in `STATUS.md`; current agent routing lives in
> `AGENTS.md` and `docs/context-map.md`.

Data: 2026-05-16
Repo target: `/Users/magnus-bot/Code/marble-love`
Branch target: `main`

## Goal attivo

Identificare in modo robusto i 6 livelli reali di Marble Madness/Marble Love e produrre seed di start verificati per ciascuno. Non cablare `startLevel=2..6` finche' un seed non e':

- distinto come terreno/fingerprint;
- in stato giocabile reale, non presentation/demo/high-score;
- controllabile con input active-vs-neutral;
- supportato da cattura MAME/manuale o route proof equivalente;
- stabile in browser con timer/camera/terreno sani.

## Addendum 2026-05-16 — post-seed proof gate

Nuova utility repo: `packages/cli/src/audit-post-seed-mame-proof.ts`.
Serve per il gate piu' severo: active e neutral MAME devono essere
byte-identici al primo snapshot seed, poi l'input active parte solo dai frame
successivi (`MARBLE_PLAYABLE_TRACKBALL_START=seedFrame+1`). Il tool misura
divergenza MAME post-seed, deaths e stabilita' sulla tail. Questo sostituisce
il vecchio ragionamento ambiguo in cui la route poteva gia' aver contaminato il
seed.

Aggiornato anche `packages/cli/src/search-playable-route.ts`: stable-playable
ora usa `main/mode=0|1/0` e la soglia PF descriptor-aware derivata dal ROM,
non piu' `main=1` e `pf > 4000`.

Proof MAME L4 nuova:

- active descriptor-tapped:
  `/private/tmp/marble-post-seed-proof-l4-f3200/DR-proof/active/scenarios/f3200.json`
- neutral descriptor-tapped:
  `/private/tmp/marble-post-seed-proof-l4-f3200/DR-proof/neutral/scenarios/f3200.json`
- bootstrap target L4 f2300, seed f3200, route `DR:60,N:180`, step 4,
  trackball start f3201.
- Audit post-seed: `post-seed-candidate`, L4 `0x2d648`,
  `seedExact=true`, `maxDiffXY=2967501/0@3379`, deaths `0/0`, stable.
- Export non cablato:
  `packages/web/public/scenarios/playable/candidate_level4_postseed_dr_f3200.seed.json`.
- Visual smoke ROM-backed: state0, timer `96 -> 94`, frame nonblank
  (`/private/tmp/marble-l4-postseed-f3320-smoke.ppm`). Non cablare finche'
  non si decide esplicitamente la promozione startLevel.

Proof MAME L5 nuova:

- active descriptor-tapped:
  `/private/tmp/marble-post-seed-proof-l5-f3520/DL-proof/active/scenarios/f3520.json`
- neutral:
  `/private/tmp/marble-post-seed-proof-l5-f3520/neutral/scenarios/f3520.json`
- bootstrap target L5 f2300, seed f3520, route `DL:60,N:180`, step 4,
  trackball start f3521.
- Audit post-seed: `post-seed-candidate`, L5 `0x2de1e`,
  `seedExact=true`, `maxDiffXY=0/2967501@3699`, deaths `0/0`, stable.
- Export non cablato:
  `packages/web/public/scenarios/playable/candidate_level5_postseed_dl_f3520.seed.json`.
- Blocco: visual smoke TS/browser dal seed entra in `state=4` dopo 120 tick.
  Quindi L5 e' MAME-proof ma non browser-stable; non promuovere.

Proof MAME L6 nuova:

- active descriptor-tapped:
  `/private/tmp/marble-post-seed-proof-l6-f3600/UL180-proof/scenarios/f3600.json`
- neutral:
  `/private/tmp/marble-post-seed-proof-l6-f3600/neutral/scenarios/f3600.json`
- bootstrap target L6 f2300, seed f3600, route `UL:180`, step 4,
  trackball start f3601.
- Audit post-seed: `post-seed-candidate`, L6 `0x2e790`,
  `seedExact=true`, `maxDiffXY=1022747/0@3780`, deaths `0/0`, stable.
- Export non cablato:
  `packages/web/public/scenarios/playable/candidate_level6_postseed_ul_f3600.seed.json`.
- Visual smoke ROM-backed: state0, timer `78 -> 76`, frame nonblank
  (`/private/tmp/marble-l6-postseed-f3720-smoke.ppm`). Ancora non cablato:
  serve review finale/wiring esplicito.

## Addendum 2026-05-16 — target descriptor route proof

La utility repo `packages/cli/src/inspect-level-descriptors.ts` e il tap
`oracle/mame_level_descriptor_tap.lua` sono ora presenti. In piu',
`packages/cli/src/search-playable-route.ts` supporta `--target-descriptor N` e
`--target-segment N`, registrando `workRam[0x474]` nei log/manifest.
Ha anche supporto successivo per `--diversity-prefix-chunks`,
`--max-deaths` e `--step-pixels`; il replay MAME accetta
`MARBLE_PLAYABLE_ROUTE_STEP`.

Proof MAME nuovo:

- route continua dal seed playable level 1: `MARBLE_PLAYABLE_ROUTE='D:7200'`,
  `MARBLE_PLAYABLE_TRACKBALL_START=2046`, cfg pulita, trace in
  `/private/tmp/marble-d7200-mame-active/trace.json`.
- Risultato: `seenLevelCount=2`; pointer windows solo L1/L2
  (`0x2bee2`/`0x2c54c`) fino a f9000, nessun frame L3-L6.
- La route raggiunge snapshot stable-playable segmenti 3/5/6, ma sono ancora
  warm/runtime lontani dai descriptor ROM; nessuna finestra snapshot
  byte-exact descriptor nel `transition-summary`.

Proof TS nuovo:

- `search-playable-route.ts --preserve-dispatcher --target-descriptor 3
--frames 3600 --chunk 30 --beam-width 96` in
  `/private/tmp/marble-target-l3-search-3600b`.
- Nessun `targetDesc` L3 `0x2cd9e`; top route resta famiglia `D:*`, finale
  `segment=4`, descriptor L2, con death/recovery. Non e' seed.

Prossimo passo consigliato: serve ancora una movie/manual route reale o un
planner piu' fisico che completi i livelli senza death/attract cycling e faccia
comparire descriptor L3-L6 in MAME. Non cablare `startLevel=2..6`.

Addendum object/endgame gate:

- `oracle/mame_level_descriptor_tap.lua` traccia ora anche `FUN_10FCE`,
  `FUN_251DE`, `FUN_253EC`, i PC `0x253A4`/`0x253B2`, i write a `0x400390`,
  `objCount` e i campi obj0 `+0x18`, `+0x1A`, `+0x20`, `+0x36`.
- Smoke: `/private/tmp/marble-descriptor-object-smoke2/trace.json`.
- Forced-manual MAME step4:
  `/private/tmp/marble-l1end-forced-object-step4/trace.json`, route
  `L:180,DL:1200`, rearm f15800, cfg pulita.
- Risultato: `seenLevelCount=1`, solo L2 `0x2c54c` f15780..f17200;
  `FUN_251DE_object_scan_dispatch=700`, `FUN_253EC_object_step=1384`, ma zero
  hit su `0x253A4`/`0x253B2`; unico write `0x400390` = rearm forzato a f15800.
  I sample restano `objCount=1`, `obj0State18=1`, niente `main=3`,
  `levelIndex>=2` o L3-L6. Quindi il forced-manual e' responsive ma non
  esercita il vero detector di completamento livello. Non promuovere seed.

Addendum detector-gate breakthrough:

- La leva corretta non e' rearmare a f15800, ma rearmare appena prima di una
  finestra naturale `obj0State18==3` che il detector `FUN_251DE` conta come
  completion. Nel coin/start trace succede intorno a f1747.
- Run `/private/tmp/marble-detector-rearm-f1746/trace.json`, con
  `MARBLE_PLAYABLE_FORCE_MANUAL_FRAME=1746`: MAME colpisce
  `FUN_251DE_endgame_set_flag` e `FUN_251DE_write_main3`, scrive
  `0x400390=3` da PC `0x253B6`, poi `FUN_16EC6` carica L3 `0x2cd9e` a f1872.
- Long active `/private/tmp/marble-detector-rearm-f1746-long/trace.json` e
  neutral `/private/tmp/marble-detector-rearm-f1746-neutral/trace.json` restano
  su L3. Frame f2300/f2500/f3000/f3600 hanno `main/mode=0/0`, `idx=2`,
  state0, timer vivo e active-vs-neutral divergente in MAME.
- `audit-playable-seed.ts` li lascia `diagnostic-only` perche' non soddisfano
  ancora il gate seed (`main/mode=1/0`, PF/stabilita' da rivedere). Non cablare
  ancora, ma usare questa strada per costruire un rearm detector-gate
  automatico e scalare L3-L6.

Addendum planner detector-gate:

- Aggiunta utility `packages/cli/src/plan-detector-gate-rearm.ts`: legge un
  trace descriptor, trova finestre `obj0+0x18==3`, propone rearm e stampa
  comandi MAME active/neutral/audit. Sul trace coin/start trova f1747 -> rearm
  f1746 -> target L3.
- `oracle/mame_playable_input_capture.lua` supporta ora
  `MARBLE_PLAYABLE_FORCE_MANUAL_FRAMES=1746,1872,...` per clear ripetuti di
  `0x400390`.
- Chained probe L4:
  `/private/tmp/marble-detector-gate-rearm/01_L3_idx2_to_L4_f1873/active/trace.json`
  usa frames `1746,1872`; il secondo clear viene applicato ma non genera un
  secondo hit `FUN_251DE_write_main3`. Pointer windows solo L2/L3, nessun L4.
- Interpretazione: i sample RAM `obj0+0x18==3` durante init/main=3 non sono
  automaticamente gate detector ripetibili. Per L4-L6 bisogna cercare finestre
  in cui `FUN_251DE_object_scan_dispatch` passa realmente su uno stato
  completion, oppure generarle con una route/playback MAME reale.
- Probe TS dal candidato L3 f2300:
  `/private/tmp/marble-l3diag-target-l4-nodeath-2400/manifest.json` si ferma al
  primo chunk con `--max-deaths 0`; senza cap
  `/private/tmp/marble-l3diag-target-l4-anydeath-600/manifest.json` resta su L3
  con death/recovery. Non usare f2300 come base seed/route L4.

Addendum auto detector-ready:

- `oracle/mame_playable_input_capture.lua` supporta
  `MARBLE_PLAYABLE_FORCE_MANUAL_ON_DETECTOR_READY=1`: cancella `0x400390` solo
  quando MAME vede `main=1`, `mode=0`, `obj0+0x18=3`, `obj0+0x1A=6`.
  Default start = `MARBLE_PLAYABLE_START_FRAME`, per evitare il falso gate boot
  visto a f114 durante il primo esperimento.
- Proof breve `/private/tmp/marble-detector-auto/trace.json`: senza frame
  hardcoded, auto-clear f1747, hit `FUN_251DE_write_main3` f1830, L3
  `0x2cd9e` f1872/f1873.
- Proof lunga `/private/tmp/marble-detector-auto-long/trace.json`: L3 resta
  caricato fino a f6500; solo completion-ready PC event a f1830, nessun gate
  naturale successivo verso L4-L6.

Addendum descriptor-aware audit + ROM dispatcher bootstrap:

- `audit-playable-seed.ts` e' ora descriptor-aware: legge `workRam[0x474]`,
  associa il seed a L1..L6, stampa descriptor pointer/PF e usa soglie PF
  proporzionali ai descrittori ROM invece del vecchio `pf > 4000`. Accetta
  anche `main/mode=0/0` come practice-compatible, coerente con il browser che
  cancella `0x400390` per `startLevel`. La route TS ora e' anche
  death-aware (`--max-route-deaths`, default 3).
- Con questo gate corretto, L3 detector f2300/f2500 restano proof causali
  MAME-responsive ma tornano `diagnostic-only`: la route TS entra in 9
  death/recovery, quindi non sono seed. f3000/f3600 restano diagnostic per gli
  altri gate reali mancanti.
- `mame_playable_input_capture.lua` supporta ora
  `MARBLE_PLAYABLE_BOOTSTRAP_TARGET_LEVEL=2..6` e
  `MARBLE_PLAYABLE_BOOTSTRAP_FRAME=N`: scrive il minimo stato di completion
  (`obj0+0x18=3`, `obj0+0x1A=6`, indice precedente, `main=3`) e lascia che il
  ROM MAME esegua `FUN_118D2`/`FUN_16EC6`. Non copia il playfield a mano.
- L4 proof diagnostico:
  `/private/tmp/marble-l3-bootstrap-l4-v2-active/trace.json` vede
  L1->L2->L3->L4 e L4 `0x2d648` da f2341; player slot torna attivo, ma la
  coppia MAME non passa ancora active-vs-neutral e il replay TS non diverge dai
  frame stabilizzati. Non seed.
- L5 proof:
  `/private/tmp/marble-l3-bootstrap-l5-v2-active/trace.json` +
  `/private/tmp/marble-l3-bootstrap-l5-v2-neutral/trace.json`; f3400 e'
  descriptor L5 `0x2de1e`, MAME pair responsive (`diffXY=3071443/2102582`) e
  audit TS `candidate-needs-route-proof`.
- L6 proof:
  `/private/tmp/marble-l3-bootstrap-l6-v2-active/trace.json` +
  `/private/tmp/marble-l3-bootstrap-l6-v2-neutral/trace.json`; L6 `0x2e790`
  viene caricato e MAME f3000 e' responsive, ma il replay TS/browser non
  diverge ancora, quindi resta diagnostic-only.
- Route sweep successivo:
  `/private/tmp/marble-bootstrap-route-sweep/l4/*` e
  `/private/tmp/marble-bootstrap-route-sweep/l6/*`, con step 4 e route
  `U/N/L/R/UL/DR:900`. L4 resta senza candidati anche col piano audit
  `R:200,D:200,L:200,U:200,N:200 --max-route-deaths 0`; debug su L4 `DR`
  f3200 mostra MAME pair forte ma replay TS con state1/death, e piani mirati
  `DR:300,N:700`, `U/R/L:300,N:700` e varianti con delay restano senza
  candidati. L6 `UL` produce il
  miglior candidato nuovo:
  `/private/tmp/marble-bootstrap-route-sweep/l6/UL/scenarios/f3600.json`,
  descriptor L6 `0x2e790`, MAME pair `diffXY=5556111/0`, audit TS intermedio
  zero-death `candidate-needs-route-proof` (`diffXY=1146474/70440`,
  deaths `0/0`). Non promuovere senza browser/parity review.
- Aggiunta utility `packages/cli/src/plan-bootstrap-route-sweep.ts`, planner
  per stampare comandi MAME neutral/active e audit degli sweep bootstrap. Esempio:
  `node --import tsx packages/cli/src/plan-bootstrap-route-sweep.ts --levels 6 --routes UL:900`.
- Prossimo passo: usare il planner bootstrap per cercare L4 con route/frame
  meno death-prone, e fare browser/parity review sui candidati L5/L6. Non
  cablare `startLevel=2..6`.

Addendum successivo:

- `/private/tmp/marble-target-l3-search-diverse-3600/manifest.json`: la beam
  diversificata mantiene prefissi non identici, ma tutti convergono ancora a
  descriptor L2 e `deathEvents=2`; nessun L3.
- `/private/tmp/marble-target-l3-nodeath-3600/manifest.json`: con
  `--max-deaths 0` il search si ferma a f570; tutte le espansioni successive
  richiedono morte.
- `/private/tmp/marble-target-l3-nodeath-step4-3600/manifest.json`: anche
  `--step-pixels 4` si ferma a f570.
- `/private/tmp/marble-ladder-mame-descriptor/trace.json`: route ladder MAME
  fino a f15000, `seenLevelCount=2`, solo L1/L2; L2 exact a f8000 ma in
  `state=6`, non seed.

## Stato repo prima del handoff

Ultimo commit/push fatto: `80d6b33 feat(gameplay): plan manual level captures`.

Il worktree aveva solo dirty/untracked preesistenti da preservare:

- `packages/web/public/mame_state.json`
- vari probe Lua/TS non tracciati
- `packages/web/public/icons/`

Non ho modificato file repo dopo quel commit, perche' la sessione e' tornata in sandbox `workspace-write` con repo fuori dalle writable roots. Le analisi nuove sono state fatte in `/private/tmp`.

## Finding principale

Il gioco ha davvero 6 descrittori ROM distinti. La fonte autorevole e' la pointer table dei livelli a `0x2BE00`, gia' presente in `packages/engine/src/level.ts`.

Descrittori identificati:

| Livello | ROM pointer | Size | PF nonzero | PF hash            | Coarse hash        |   Checksum |
| ------- | ----------: | ---: | ---------: | ------------------ | ------------------ | ---------: |
| L1      |   `0x2bee2` | 1642 |       2555 | `86e682e9f7ac1aa7` | `7da6b7fb8424a073` |  875060973 |
| L2      |   `0x2c54c` | 2130 |       2657 | `7eade065cc22ab2f` | `7a502464fb02e069` | 1639037088 |
| L3      |   `0x2cd9e` | 2218 |       2164 | `771510b00efbed2e` | `9d220249507ab080` | 1105173528 |
| L4      |   `0x2d648` | 2006 |       1550 | `96d71a7d71989ae8` | `acad6b9269ff6930` |  989902162 |
| L5      |   `0x2de1e` | 2418 |       2896 | `368dcba7f9065c79` | `717f1596acdc21a1` | 1679956928 |
| L6      |   `0x2e790` | 2560 |       1743 | `6abd748c52908138` | `4cbef509436e9e1f` | 1114663330 |

Pairwise PF diffs tra descrittori ROM:

- L1-L2 `3096`, L1-L3 `3026`, L1-L4 `2812`, L1-L5 `3285`, L1-L6 `2906`
- L2-L3 `3031`, L2-L4 `2831`, L2-L5 `3231`, L2-L6 `2811`
- L3-L4 `2565`, L3-L5 `3181`, L3-L6 `2712`
- L4-L5 `3054`, L4-L6 `2272`
- L5-L6 `2956`

Interpretazione: i sei livelli esistono e sono distinti. Il problema e' che i vecchi snapshot `levelN_spawn` non sono veri start level.

## Evidence sugli snapshot esistenti

Ho confrontato i descrittori ROM con gli snapshot checked-in:

- `oracle/scenarios/gameplay/level1_spawn.json`
- `level1_early`, `level1_midmap`, `level1_obstacle`, `level1_end`
- `level2_spawn`, `level2_early`
- `level3_spawn`, `level3_early`, `level3_end`
- `level4_spawn`, `level4_early`
- `level5_spawn`, `level5_early`
- `packages/web/public/scenarios/playable/manual_level1_start.seed.json`

Risultato: nessuno e' un match pulito con i sei descriptor-start surfaces. I nearest match restano lontani, per esempio:

- L1 nearest: `level1_spawn`, `level2_spawn`, `level4_spawn`, tutti `pfDiff=1819`
- L2 nearest: `manual_level1_start`, `level1_obstacle`, `level3_spawn`, `level5_spawn`, tutti `pfDiff=1517`
- L3/L4/L5/L6 nearest: spesso gli stessi `level1_early`/`level1_midmap`/`level1_end`/`level3_early`

Quindi quei file sono finestre demo/presentation/transition o superfici riciclate, non start reali per `startLevel`.

## MAME no-coin attract scan

Ho fatto una cattura MAME headless no-coin fino a frame `60000` usando `SDL_VIDEODRIVER=dummy`.

Comando usato:

```sh
SDL_VIDEODRIVER=dummy \
MARBLE_PLAYABLE_OUT_DIR=/private/tmp/marble-attract-level-scan/scenarios \
MARBLE_PLAYABLE_INPUT_OUT=/private/tmp/marble-attract-level-scan/input.json \
MARBLE_PLAYABLE_COIN_START=0 \
MARBLE_PLAYABLE_FRAME_LIST='f3000:3000,f6000:6000,f9000:9000,f12000:12000,f15000:15000,f18000:18000,f21000:21000,f24000:24000,f27000:27000,f30000:30000,f33000:33000,f36000:36000,f39000:39000,f42000:42000,f45000:45000,f48000:48000,f51000:51000,f54000:54000,f57000:57000,f60000:60000' \
MARBLE_PLAYABLE_CAPTURE_FRAMES=0 \
mame marble -rompath roms -autoboot_script oracle/mame_playable_input_capture.lua -nothrottle -video none -sound none -nonvram_save
```

`-video none` da solo falliva con SDL display error; `SDL_VIDEODRIVER=dummy` ha risolto.

Summary stable-playable dal no-coin scan:

- `f12000`: stable, segment `1`, timer `52`, scroll `149`, pfHash `0dd9e862a4be1192`
- `f15000`: stable, segment `3`, timer `54`, scroll `56`, pfHash `11a18266e816c9bd`
- `f18000`: stable, segment `5`, timer `56`, scroll `0`, pfHash `fe66bf77699cb9b0`
- `f21000`: stable, segment `7`, timer `57`, scroll `0`, pfHash `fe66bf77699cb9b0`
- `f36000`: stable, segment `2`, timer `51`, scroll `178`, pfHash `ff0ea3512d878bec`
- `f39000`: stable, segment `4`, timer `52`, scroll `126`, pfHash `61bf68f6c93286e2`
- `f42000`: stable, segment `6`, timer `54`, scroll `54`, pfHash `c3a6175c4c0c685d`
- `f57000`: stable, segment `1`, timer `51`, scroll `228`, pfHash `6aa1eaed8b0d2fbe`
- `f60000`: stable, segment `3`, timer `53`, scroll `136`, pfHash `dd33577191b87f2c`

Interpretazione importante: `workRam[0x3e4]` / segment non e' un semplice level number 1..6. Nell'attract no-coin passa da `1,3,5,7` e poi `2,4,6`. Questo spiega perche' mappare `segment` direttamente a `startLevel` ha prodotto livelli sbagliati.

## Candidate export/audit attract

Comando usato:

```sh
node --import tsx packages/cli/src/scan-playable-terrain-hashes.ts \
  --summary-only \
  --emit-loaded-candidates-dir /private/tmp/marble-attract-level-candidates \
  --min-cluster-samples 1 \
  /private/tmp/marble-attract-level-scan/scenarios/*.json
```

Ha scritto 8 candidati in:

`/private/tmp/marble-attract-level-candidates/manifest.json`

Audit:

```sh
node --import tsx packages/cli/src/audit-playable-seed.ts \
  --only-candidates \
  --distinct-from packages/web/public/scenarios/playable/manual_level1_start.seed.json \
  /private/tmp/marble-attract-level-candidates/*.seed.json
```

Output non-diagnostic: 3 candidati `candidate-needs-route-proof`:

- `f39000 seg4`: manual rearm responsive/stable, preserved dispatcher active == neutral.
- `f36000 seg2`: manual rearm responsive/stable, preserved dispatcher active == neutral.
- `f12000 seg1`: manual rearm responsive/stable, preserved dispatcher active == neutral.

Questi NON vanno cablati a `startLevel`: sono utili come probe/falsification, ma serve route proof MAME/manuale.

## Script temporaneo usato

Ho creato solo in `/private/tmp`:

- `/private/tmp/inspect-level-descriptors.mjs`
- output `/private/tmp/marble-six-level-descriptors/manifest.json`

Lo script:

- carica `ghidra_project/marble_program.bin`;
- legge i 6 descrittori con `level.loadAllLevels`;
- esegue `levelDispatcher16EC6` TS per indici `0..5`;
- calcola hash/diff playfield;
- confronta con snapshot oracle/playable checked-in e con `/private/tmp/marble-attract-level-scan/scenarios`.

Se si vuole committarlo, trasformarlo in:

`packages/cli/src/inspect-level-descriptors.ts`

e aggiornare README/STATUS con i finding sopra.

## Prossimo passo consigliato

1. Committare una utility repo `inspect-level-descriptors.ts` basata sullo script temporaneo.
2. Farla produrre un manifest stabile in `/private/tmp/marble-six-level-descriptors`.
3. Aggiornare STATUS/README: i 6 descrittori ROM sono identificati; `levelN_spawn` non sono start level; `segment` non e' level number.
4. Poi creare il vero finder seed:
   - cattura MAME manuale/playback con `plan-mame-manual-level-capture.ts`;
   - clusterizza stable-playable windows;
   - associa ogni finestra al descrittore ROM piu' vicino;
   - audita active-vs-neutral;
   - solo dopo cabla `startLevel=N`.
5. Non cablare seed descriptor-only: i descrittori ROM inizializzano terreno ma non contengono necessariamente stato player/camera/dispatcher completo da practice start.

## Nota operativa

La sessione precedente era tornata in sandbox `workspace-write` con repo fuori dalle writable roots, quindi le patch nel repo venivano respinte. Se la prossima sessione ha accesso completo, copiare/committare lo script in `packages/cli/src` e aggiornare docs.

## Addendum 2026-05-16 — state-diverse route proof negativo

Lo script temporaneo e' stato promosso in repo come
`packages/cli/src/inspect-level-descriptors.ts` e i sei descrittori ROM reali
sono ora documentati anche in README/STATUS. Il gate resta invariato: non
cablare `startLevel=2..6` finche' non esistono seed distinti, giocabili,
controllabili active-vs-neutral e supportati da proof MAME/manuale.

Nuovi risultati negativi:

- `/private/tmp/marble-target-l3-nodeath-state-diverse-3600/manifest.json`:
  `--preserve-dispatcher --target-descriptor 3 --max-deaths 0` resta bloccato a
  f570 anche con `--diversity-state-bucket`. Tutte le espansioni successive
  richiedono una morte; i candidati finali sono ancora segment 2, descriptor L2
  `0x2c54c`, timer 51.
- `/private/tmp/marble-target-l3-manual-nodeath-state-2400/manifest.json`:
  senza `--preserve-dispatcher` la route e' controllabile e no-death fino a
  f2400, ma resta `main/mode=0/0`, segment 2, descriptor L2. Serve come
  diagnostica browser, non come proof ROM/MAME per L3-L6.
- `/private/tmp/marble-index-write-trace/trace.json`: il trace MAME no-coin
  vede ancora solo L1/L2. I sample `levelIndex` alternano solo 0/1 in sync con
  i pointer L1/L2; nessun sample idx2..idx5 raggiunge i descriptor L3-L6.
- `/private/tmp/marble-index-write-trace-handles/trace.json`: dopo aver
  conservato gli handle dei read/write taps in `oracle/mame_level_descriptor_tap.lua`,
  il trace registra 146 eventi. I write ricorrenti a `0x400394` sono a
  `PC=0x011524`, dentro `FUN_11452` mode0, e alternano XOR 0/1 prima di
  `FUN_16EC6`; i write a `0x400474` caricano solo L1/L2. Nessun evento entra in
  `FUN_1101E case4` (`main=3`) o vede idx2..idx5.
- `/private/tmp/marble-coinstart-index-handles/trace.json`: stesso tap corretto
  con coin/start scriptati fino a f30000. L'input trace mostra i pulse coin f1200
  e START1 f1500 letti dai port, ma il descriptor trace resta `seenLevelCount=2`;
  nessun sample idx2..idx5 o `main=3`.

Interpretazione aggiornata: il problema non e' solo distinguere meglio le
superfici PF. Nei path automatici osservati la ROM non arriva proprio a tenere
un level index 2..5 davanti al dispatcher `FUN_16EC6`. Il prossimo passo utile
e' trovare una movie/manual route reale che superi il ciclo attract L1/L2 ed
entri nel branch di progressione (`0x400390=3`), o analizzare il codice di
progresso livello/credit/start per capire quale stato abilita i pointer L3-L6.

## Addendum 2026-05-16 — TS completion now dispatches L3, but no seed yet

Finding nuovo nel runtime TS: il fallback integrato di `FUN_1101E case4` passava
da `playerSlotIter118D2`, ma non forniva la callback `FUN_16EC6`. Di conseguenza
`workRam[0x394]` poteva avanzare a `2` dopo il completamento, ma il pointer
runtime restava L2 `0x2c54c` invece di caricare il descrittore successivo.

Fix locale in `packages/engine/src/main-loop-init-1101e.ts`: `helper118D2` ora
chiama `playerSlotIter118D2(s, rom, { fun_16ec6: ...levelDispatcher16EC6... })`.
Il test `packages/engine/test/playable-live-routes.test.ts` e' stato esteso per
fermare la route appena dopo il completamento e verificare che il runtime carichi
L3 `0x2cd9e`.

Proof TS diagnostico: partendo da `oracle/scenarios/gameplay/level1_end.json`
snapshot 0, riarmando manualmente il dispatcher (`0x400390=0`) e replayando
`L:180,DL:900`, il runtime vede `main=3` a f941/f942 e poi a f943 torna a
`main=0`, `mode=2`, `levelIndex=2`, segment `3`, player state `0`, pointer
`0x2cd9e`. Questo dimostra che il path di progressione TS ora puo' arrivare al
descrittore L3.

Limite: non e' ancora una route MAME/manuale da boot e non e' un seed
promuovibile. La ricerca aggiornata da `manual_level1_start` dopo la fix
(`/private/tmp/marble-target-l3-manual-after-118d2-wire-3600/manifest.json`,
`--target-descriptor 3`, f3600) non trova L3 ne' `main=3`: il top candidate
resta su `main/mode=0/0`, segment `2`, timer `0`, descriptor L2 `0x2c54c`,
senza death. Il gate resta invariato: non cablare `startLevel=2..6`.

## Addendum 2026-05-16 — search CLI can replay scenario snapshots

Nuovo commit da fare/durable change: `packages/cli/src/search-playable-route.ts`
ora accetta anche scenario JSON in `--seed` e `--snapshot-index N` per scegliere
uno snapshot. Questo evita gli script inline per riprodurre proof warm.

Comando proof:

```sh
node --import tsx packages/cli/src/search-playable-route.ts \
  --seed oracle/scenarios/gameplay/level1_end.json \
  --snapshot-index 0 \
  --route-prefix L:180,DL:763 \
  --target-descriptor 3 \
  --frames 943 \
  --chunk 30 \
  --beam-width 16 \
  --max-candidates 1 \
  --out-dir /private/tmp/marble-level1-end-scenario-l3-proof-f943
```

Risultato nel manifest:
`firstState6Frame=881`, `firstMain3Frame=941`,
`firstTargetDescriptorFrame=943`; finale f943 `main/mode=0/2`, segment `3`,
player state `0`, timer `48`, descriptor L3 `0x2cd9e`, PF nonzero `3428`.

Controprova utile: ho creato fuori repo
`/private/tmp/manual_level1_start_timer180.seed.json` modificando solo il timer
del seed `manual_level1_start` a `180`, poi ho rerun L3 target fino a f3600 in
`/private/tmp/marble-target-l3-timer180-3600/manifest.json`. Resta su L2
(`0x2c54c`), `main/mode=0/0`, segment `2`, timer `120`, x/y circa `307/272`,
nessun `main=3` o L3. Quindi il blocco dal seed practice reale non era solo
timer; serve ancora route manuale/MAME o planner migliore.

## Addendum 2026-05-16 — MAME forced-manual does not reproduce TS L3 proof

Tooling fix: in `oracle/mame_playable_input_capture.lua`, quando gira composto
con `mame_level_descriptor_tap.lua`
(`MARBLE_DESCRIPTOR_TRACE_PLAYABLE_CAPTURE=1`), il capture ora estende
`last_frame` fino a `MARBLE_DESCRIPTOR_TRACE_TO`. Prima poteva uscire al frame
dell'ultima snapshot e impedire al descriptor tap di scrivere il trace.

Proof/falsification MAME da boot/attract:

- active step8:
  `/private/tmp/marble-l1end-forced-l3-active/trace.json`,
  `MARBLE_PLAYABLE_FORCE_MANUAL_FRAME=15800`,
  `MARBLE_PLAYABLE_TRACKBALL_START=15801`,
  `MARBLE_PLAYABLE_ROUTE='L:180,DL:763'`.
- neutral:
  `/private/tmp/marble-l1end-forced-l3-neutral/trace.json`,
  route `N:943`.
- active step4:
  `/private/tmp/marble-l1end-forced-l3-active-step4/trace.json`,
  `MARBLE_PLAYABLE_ROUTE_STEP=4`,
  `MARBLE_PLAYABLE_ROUTE='L:180,DL:1200'`.

Risultato: tutti i trace restano `seenLevelCount=1` nella finestra analizzata,
con pointer window unica L2 `0x2c54c`. Nessun sample vede `main=3`,
`levelIndex=2` o L3 `0x2cd9e`. L'input e' responsive in MAME forced-manual
(a f16743 active step8 circa `x=9.9 y=-122.5` vs neutral `x=444 y=444`;
step4 active circa `x=217.2 y=84.7`), ma non produce progressione descriptor.
`inspect-level-descriptors --transition-summary` sulle snapshot active/neutral
non trova finestre byte-exact.

Interpretazione: la route TS da `level1_end` prova solo il wiring engine; non e'
una proof MAME sufficiente e non va usata per seed. Serve ancora una route
manuale/playback MAME naturale o un planner che raggiunga `main=3` in un path
MAME-live controllabile.
