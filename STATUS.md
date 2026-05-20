# STATUS

Questo file descrive solo lo stato operativo corrente. La cronologia completa e
le note di sviluppo estese sono archiviate in:

```text
docs/archive/readme-status-2026-05-18/
```

## Stato Attuale

Marble Love e' giocabile nel browser con ROM locali, true-start seed per i sei
livelli originali e flusso coin/start compatibile con il percorso live. Il
motore resta una reimplementazione TypeScript verificata contro MAME: per le
aree delicate la causa deve essere provata su routine, RAM o trace MAME prima di
modificare comportamento.

Il percorso piu' affidabile per playtest e regressioni e':

```text
http://localhost:5173/?autoLoad=1&play=1
```

Con `play=1` il frontend resta su attract/high-score fino a coin e START; dopo
START carica il true-start L1 `start_level1_intro_practice_f2479`.

Stato post-merge 2026-05-19:

- `main` include il merge del branch `codex/level-header-decode`.
- Il level descriptor header e' documentato in
  `docs/level-header-format.md`.
- Gate post-merge verdi: `npm run typecheck`, `npm run lint`,
  `npm run test --silent`.
- Suite corrente: `255 passed | 3 skipped` test files,
  `2206 passed | 17 skipped` tests.

## Funziona

- Web app Vite/PixiJS con ROM loader, rendering playfield/sprite/HUD e input
  live.
- `?autoLoad=1&play=1`: gate attract, coin, START, L1 true-start.
- `?autoLoad=1&startLevel=1..6`: caricamento dei sei true-start seed MAME.
- Banner intro e timer iniziali dei livelli.
- Carryover timer su progressione livelli: residuo precedente + bonus nuovo
  livello.
- Marble nemica nera in L2 visibile sia da `startLevel=2` sia da transizione
  runtime L1->L2.
- Sprite dinamici nel percorso gameplay: pistoni L4/Aerial user-confirmed via
  cull corretto `type0x29`; macchie verdi mobili L3/Intermediate agganciate
  via replica `FUN_17346` e string-slot `type0x0e` (`0x401482`), in attesa di
  retest visivo finale.
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

- `?autoLoad=1&play=1`: flusso live normale.
- `?autoLoad=1&coinStart=1`: gate coin/start esplicito.
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

Leggere prima di cambiare comportamento runtime:

- `HANDOFF_CURRENT_CONTEXT.md`
- `HANDOFF_SIX_LEVELS.md`
- `docs/level-header-format.md`

Leggere gli archivi solo quando serve ricostruire una decisione storica o un
vecchio esperimento:

- `docs/archive/readme-status-2026-05-18/README.full.md`
- `docs/archive/readme-status-2026-05-18/STATUS.full.md`
