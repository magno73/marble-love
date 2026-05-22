# STATUS

Questo file descrive solo lo stato operativo corrente. La cronologia completa e
le note di sviluppo estese sono archiviate in:

```text
docs/archive/readme-status-2026-05-18/
```

## Stato Attuale

Marble Love e' giocabile nel browser con ROM locali. Il percorso default
`play=1` ora parte da cold boot ROM-backed, accetta coin/start via runtime,
entra in L1, progredisce livello-per-livello, gestisce high-score initials e
mantiene i contenuti runtime critici confermati in browser. I true-start seed
dei sei livelli originali restano disponibili come diagnostica esplicita. Il
motore resta una reimplementazione TypeScript verificata contro MAME: per le
aree delicate la causa deve essere provata su routine, RAM o trace MAME prima di
modificare comportamento.

Percorso default no-seed:

```text
http://localhost:5173/?autoLoad=1&play=1
```

Alias esplicito:

```text
http://localhost:5173/?autoLoad=1&bootFlow=1&debugState=1&sound=0
```

Con `play=1` il frontend resta su attract/high-score fino a coin e START; dopo
START entra in L1 dal dispatcher runtime senza caricare seed. Usare
`startLevel=1..6`, `playableSeed=NAME` o `coinStart=1` per diagnostica
seed-backed esplicita.

Stato boot-flow 2026-05-21:

- Phase 6.6 runtime content parity era confermata manualmente: L5/Silly mostra i
  mostri `type7/8/9`; L3/Intermediate green blobs sono visibili, uccidono la
  marble, fanno respawn e seguono i waypoint ROM senza drift fuori terreno.
- Follow-up locale in corso su `/Users/magnus-bot/Desktop/onda.png`,
  `/Users/magnus-bot/Desktop/s1.png`, `/Users/magnus-bot/Desktop/s2.png`,
  `/Users/magnus-bot/Desktop/bugnew1.png` e
  `/Users/magnus-bot/Desktop/bugnew2.png`: una fila L3/Intermediate di onde
  verdi ha fisica parziale in TS. La prova ROM corrente dice di non inventare
  una fisica diretta per `tag=06`: la jump table originale manda `tag=05` a
  `0x029f40` (proximity bumper: restore XY, negate vx/vy, sound `0x42`) e
  `tag=06` a `0x02b072` (iter epilog/no-op). Il probe
  `npx tsx packages/cli/src/probe-fun29cce-wave-rom.ts` conferma gli stessi
  side effect eseguendo `FUN_29CCE` dal binario ROM.
- Le patch locali di bumper/hitbox `tag=06` sono state respinte dalla prova ROM
  e rimosse. La patch corrente e' solo diagnostica: overlay `debugState=1` con
  riga `wave terrain`/`last terrain wave candidate` per slot `tag=05/06`; il
  campo `rom05q` mostra il denominatore della formula originale `tag=05` anche
  quando il candidato runtime e' `tag=06`, quindi non implica un hit ROM.
- Il tentativo `FUN_12FD0 -> FUN_11AC2` resta browser-rejected da
  `/Users/magnus-bot/Desktop/bugx.png`: dopo il wiring il primo/left wave perse
  la fisica gia' funzionante. Non riapplicarlo senza una nuova prova MAME/ROM
  sul lifecycle della tabella terrain `0x40076e`.
- High-score initials interattivi gia' implementati e salvati nel percorso
  score-qualified.
- Follow-up onde 2026-05-22: il confronto manuale MAME dell'utente conferma
  che tutte le onde verdi trasportano la marble, non solo la prima. La prova ROM
  ha spostato la causa da `FUN_29CCE/tag=06` a `FUN_1D06A`: la routine originale
  scrive la tabella terrain indiretta `0x40076e`, usata poi da
  `FUN_1CABA/FUN_25DF6` per la spinta conveyor-like. Patch locale: replica TS
  di `FUN_1D06A` e wiring dal frame loop per slot `kind=6`; `FUN_11AC2` resta
  non cablata perche' browser-rejected. Gate automatizzati mirati verdi. Retest
  manuale browser dell'utente verde: ora anche le onde successive spingono e
  trasportano la marble come nel MAME.
- Phase 7 approvata dall'utente: `play=1` e' promosso al percorso no-seed.

## Funziona

- Web app Vite/PixiJS con ROM loader, rendering playfield/sprite/HUD e input
  live.
- `?autoLoad=1&play=1`: cold boot no-seed, coin/start runtime, L1 giocabile,
  progressione livelli e high-score initials.
- `?autoLoad=1&bootFlow=1`: alias esplicito del cold boot no-seed.
- `?autoLoad=1&coinStart=1`: fallback seed-backed del vecchio gate coin/start.
- `?autoLoad=1&startLevel=1..6`: caricamento dei sei true-start seed MAME.
- Banner intro e timer iniziali dei livelli.
- Carryover timer su progressione livelli: residuo precedente + bonus nuovo
  livello.
- Marble nemica nera in L2 visibile sia da `startLevel=2` sia da transizione
  runtime L1->L2.
- Sprite dinamici nel percorso gameplay: pistoni L4/Aerial user-confirmed via
  cull corretto `type0x29`; macchie verdi mobili L3/Intermediate
  user-confirmed via replica `FUN_17346` e string-slot `type0x0e`
  (`0x401482`); ostacoli dinamici Aerial `type12` visibili dopo fix dei bound
  signed `moveq`.
- Level descriptor header dei sei livelli decodato come header fisso `0x2E`
  byte, con campi consumer-backed e doc finale in
  `docs/level-header-format.md`.
- Corpo post-header decodato in `LevelData.postHeader`: terrain row pointer
  table, sub-pattern table, tile-line descriptors, row-build script e RLE row
  offsets.
- Terrain-code format di `FUN_1CABA` decodato (`empty`, `direct`, `indirect`,
  `quad`, `flat`) con helper in `packages/engine/src/level.ts`.
- Parity musashi-wasm 500/500 per i tre consumer header `FUN_16EC6`,
  `FUN_16F6C`, `FUN_259B4`.
- Replay/oracle tooling per confronto MAME, seed audit, route search e probe
  mirati.
- ROM graphics decode e rendering MAME-oriented per warm-state e start-level.

## Livelli Cablate

| Level idx | Nome | Descriptor | Seed | Bonus |
| --- | --- | --- | --- | --- |
| 0 | Practice | `0x2bee2` | `start_level1_intro_practice_f2479` | 60 |
| 1 | Beginner | `0x2c54c` | `start_level2_intro_beginner_f2436` | 60 |
| 2 | Intermediate | `0x2cd9e` | `start_level3_intro_intermediate_f2435` | 35 |
| 3 | Aerial | `0x2d648` | `start_level4_intro_aerial_f2414` | 30 |
| 4 | Silly | `0x2de1e` | `start_level5_intro_silly_f2472` | 20 |
| 5 | Ultimate | `0x2e790` | `start_level6_intro_ultimate_f2429` | 20 |

Regola timer:

```text
timer dopo banner = carryover prima della transizione + bonus del nuovo livello
```

Esempi validati nel runtime engine:

- L1 finito con 31 secondi -> L2 a 91 secondi.
- L2 finito con 42 secondi -> L3 a 77 secondi.

## Stato Web

Modalita' principali:

- `?autoLoad=1&play=1`: flusso default no-seed.
- `?autoLoad=1&bootFlow=1`: flusso no-seed esplicito.
- `?autoLoad=1&coinStart=1`: fallback seed-backed del gate coin/start.
- `?autoLoad=1&startLevel=N`: true-start diretto di un livello.
- `?autoLoad=1&playableSeed=NAME&play=1`: diagnostica seed esplicita.

`manual_level1_start` e' legacy/diagnostico e va caricato solo con
`playableSeed=manual_level1_start`. Non e' il default di `play=1`.

Input live:

- coin: `5` o `C`
- START: `Enter` o spazio
- movimento: mouse, WASD, frecce, gamepad

## Stato Engine

Aree principali disponibili:

- main loop e dispatcher principali in `packages/engine/src/main-tick.ts` e
  `packages/engine/src/main-loop-init-*.ts`.
- start-level banner/timer resume in
  `packages/engine/src/level-intro-banner-resume.ts`.
- draw-list e object-pair scroll spawn in
  `packages/engine/src/scroll-sub-15a12.ts`.
- renderer model in `packages/engine/src/render.ts`.
- ROM/slapstic support in `packages/engine/src/m68k/` e moduli bus correlati.

Le routine replicate non devono essere trattate come API generiche: spesso
modellano side effect MAME-specifici su indirizzi RAM assoluti.

## Level Descriptor Header

Il formato header dei descriptor ROM e' ora separato dal vecchio parser
legacy post-header:

- pointer table ROM: `0x2BE00`, 6 puntatori long BE;
- `LEVEL_HEADER_SIZE = 0x2E`;
- campi consumati documentati in `docs/level-header-format.md`;
- post-header/body decodato in `LevelData.postHeader`;
- terrain-code decode per il path live `FUN_1CABA` -> `0x401c28`;
- MAME tap esteso in `oracle/mame_level_header_tap.lua`;
- probe statico in `packages/cli/src/probe-level-header.ts`;
- parity aggregata in
  `packages/cli/src/test-level-header-decode-parity.ts`.

Il valore storico `LEVEL_HEADER_SIZE = 36` era incompleto: il fixed header
arriva a `+0x2D`, quindi la size corretta e' `0x2E`.

Validazione associata:

```sh
npx tsx packages/cli/src/test-level-header-decode-parity.ts 500
npx tsx packages/cli/src/probe-cluster-histogram.ts
npx tsx packages/cli/src/probe-100f-diff.ts | grep "obj0.x"
```

Baseline drift corrente:

```text
f+99 workRam diff: total=172 | gameplay=0 | stack-residue=172
```

## Gap E Rischi

- Il long-run attract/demo completo non e' il riferimento principale per
  playtest; puo' ancora avere residui sprite/workRam/cache.
- Il parser legacy `HeightRecord` post-header resta compat only: il formato
  verificato e' `LevelData.postHeader` + `terrainCode`. Non usare
  `word1..word3` per correggere salite, collisioni o slope.
- Alcuni script oracle, screenshot, capture e seed `candidate_*` sono scratch o
  diagnostici. Non promuoverli senza proof completa.
- Il sound path ha copertura utile per cue/debug, ma il chip/music path completo
  resta sensibile ai flag di debug e non deve guidare modifiche gameplay.
- Vecchi test o smoke live-route possono rappresentare stati storici. Se un
  diagnostic fallisce, prima ricostruire la proof MAME sottostante.

## Guardrail Seed E Livelli

Non modificare mapping, nomi o contenuto dei seed `startLevel` se manca almeno
uno di questi elementi:

- descriptor ROM corretto e distinto;
- frame giocabile reale, non presentation/demo/high-score;
- active-vs-neutral MAME distinto;
- controllabilita' dopo seed;
- zero death o death behavior spiegato;
- smoke browser stabile;
- audit TS-vs-MAME coerente con lo scenario proof.

Separare sempre:

- cattura/proof MAME;
- export seed web;
- wiring `startLevel`;
- test browser/visual smoke.

## Validazione Consigliata

Per modifiche a timer, start, banner o progressione:

```sh
npx vitest run \
  packages/engine/test/level-intro-banner-resume.test.ts \
  packages/engine/test/main-loop-init-task-a.test.ts \
  packages/engine/test/main-tick.test.ts \
  packages/web/test/practice-level.test.ts \
  packages/web/test/coin-start-flow.test.ts
```

Per modifiche engine:

```sh
npx tsc -p packages/engine/tsconfig.json --noEmit
```

Per modifiche web:

```sh
npx tsc -p packages/web/tsconfig.json --noEmit
npm --workspace @marble-love/web run build
```

Sempre utile prima di consegnare:

```sh
git diff --check
git status --short --branch
```

Per modifiche a descriptor/header o a prove MAME correlate:

```sh
npx tsx packages/cli/src/probe-level-header.ts
npx tsx packages/cli/src/test-level-header-decode-parity.ts 500
npx vitest run packages/engine/test/level.test.ts packages/engine/test/level-header-decode.test.ts
```

## File Di Contesto

Per agenti AI, il cold start corrente e':

- `AGENTS.md`
- `docs/context-map.md`
- il task/goal attivo, se presente

Leggere prima di cambiare descriptor, terrain-code o level header:

- `docs/level-header-format.md`

Gli handoff root sono storici o task-specifici. Leggerli solo quando un task li
nomina o quando serve ricostruire una decisione passata:

- `HANDOFF_CURRENT_CONTEXT.md`
- `HANDOFF_SIX_LEVELS.md`

Leggere gli archivi solo quando serve ricostruire una decisione storica o un
vecchio esperimento:

- `docs/archive/readme-status-2026-05-18/README.full.md`
- `docs/archive/readme-status-2026-05-18/STATUS.full.md`
