# Marble Love

Reimplementazione TypeScript di **Marble Madness** (Atari, 1984) con verifica
differenziale contro MAME. Il repository contiene motore, frontend web,
strumenti CLI e script oracle per confrontare stato, rendering, input e routine
replicate.

Le ROM non sono incluse e non vengono distribuite. Il codice originale del repo
e' MIT; l'utente deve fornire dump ROM propri in formato MAME.

Le versioni storiche complete di `README.md` e `STATUS.md` sono archiviate in:

```text
docs/archive/readme-status-2026-05-18/
```

## Stato In Breve

- Motore TypeScript con molte routine M68010 replicate e testate contro MAME o
  musashi-wasm.
- Rendering web basato su PixiJS 8 con ROM graphics decode, tilemap, sprite/MO,
  HUD alpha e warm-state MAME.
- Browser giocabile con ROM locali, input live e flusso coin/start.
- `startLevel=1..6` mappa ai sei true-start seed MAME con banner intro e timer.
- Il timer di livello mantiene i secondi residui e aggiunge il bonus del livello
  successivo.
- Il level descriptor header dei 6 livelli e' decodato e documentato in
  `docs/level-header-format.md`; i consumer `FUN_16EC6`, `FUN_16F6C` e
  `FUN_259B4` restano parity-locked 500/500.
- Il corpo post-header e i terrain codes del path `FUN_1CABA` sono decodati:
  usare `LevelData.postHeader` e `decodeTerrainCode`, non il vecchio
  `HeightRecord` compat.
- La modalita' demo/attract lunga resta area di lavoro: il percorso warm
  giocabile e i true-start level sono il riferimento operativo per il playtest.

## Quick Start

Installa dipendenze:

```sh
npm install
```

Avvia il frontend:

```sh
npm --workspace @marble-love/web run dev -- --host 0.0.0.0
```

Apri:

```text
http://localhost:5173/?autoLoad=1&play=1
```

Controlli principali:

- `5` o `C`: coin
- `Enter` o spazio: START
- mouse, WASD, frecce o gamepad: controllo marble
- bottone audio nel browser: abilita AudioContext

Per `autoLoad=1`, le ROM devono essere disponibili al frontend sotto
`packages/web/public/roms/` oppure attraverso la configurazione locale gia'
presente nel workspace.

## URL Utili

```text
?autoLoad=1&play=1
```

Flusso live normale: attract/high-score, coin, START, true-start L1.

```text
?autoLoad=1&coinStart=1
```

Gate coin/start esplicito.

```text
?autoLoad=1&startLevel=N
```

Carica il true-start seed del livello `N`, con `N` da 1 a 6.

```text
?autoLoad=1&playableSeed=manual_level1_start&play=1
```

Seed legacy esplicito per diagnostica. Non e' il default di `play=1`.

Parametri diagnostici frequenti:

- `debugObjects=1`
- `preserveDispatcher=1`
- `levelTime=180`
- `sound=0`
- `soundChip=1`

## Livelli E Timer

| Level | Nome ROM | Seed web | Bonus |
| --- | --- | --- | --- |
| 1 | Practice | `start_level1_intro_practice_f2479` | 60 |
| 2 | Beginner | `start_level2_intro_beginner_f2436` | 60 |
| 3 | Intermediate | `start_level3_intro_intermediate_f2435` | 35 |
| 4 | Aerial | `start_level4_intro_aerial_f2414` | 30 |
| 5 | Silly | `start_level5_intro_silly_f2472` | 20 |
| 6 | Ultimate | `start_level6_intro_ultimate_f2429` | 20 |

Quando un livello viene completato, il timer successivo e':

```text
secondi residui + bonus del nuovo livello
```

Esempio: finire L2 con 42 secondi porta L3 a 77 secondi dopo il banner intro.

## Layout Repo

| Percorso | Contenuto |
| --- | --- |
| `packages/engine` | Core engine, state, main loop, renderer model, audio model, test unitari |
| `packages/web` | Frontend Vite/PixiJS, ROM loader, input live, renderer browser |
| `packages/cli` | Probe, audit, route search, confronto seed/scenari |
| `oracle` | Script Lua MAME e scenari oracle |
| `harness` | Diff/report tooling |
| `tools` | Utility Ghidra, ROM prep e support scripts |
| `docs` | PRD, note tecniche e archivio documentazione storica |

## Comandi Di Validazione

Suite generale:

```sh
npm test
npm run typecheck
```

Stato post-merge corrente validato:

```text
Test Files 255 passed | 3 skipped
Tests      2206 passed | 17 skipped
```

Build web:

```sh
npm --workspace @marble-love/web run build
```

Controlli mirati usati spesso durante lavoro su play/start/timer:

```sh
npx vitest run \
  packages/engine/test/level-intro-banner-resume.test.ts \
  packages/engine/test/main-loop-init-task-a.test.ts \
  packages/engine/test/main-tick.test.ts \
  packages/web/test/practice-level.test.ts \
  packages/web/test/coin-start-flow.test.ts
```

Typecheck mirati:

```sh
npx tsc -p packages/engine/tsconfig.json --noEmit
npx tsc -p packages/web/tsconfig.json --noEmit
```

Reverse engineering del level header:

```sh
npx tsx packages/cli/src/probe-level-header.ts
npx tsx packages/cli/src/test-level-header-decode-parity.ts 500
npx vitest run packages/engine/test/level.test.ts packages/engine/test/level-header-decode.test.ts
npx tsx packages/cli/src/probe-cluster-histogram.ts
npx tsx packages/cli/src/probe-100f-diff.ts | grep "obj0.x"
```

Baseline attuale del drift f+99:

```text
total=172 | gameplay=0 | stack-residue=172
```

Whitespace/diff sanity:

```sh
git diff --check
```

## Regole Di Lavoro

- Lavora da `/Users/magnus-bot/Code/marble-love` come root scrivibile.
- Non revertare file sporchi o untracked non tuoi.
- Non cablare o rinominare seed `startLevel` senza proof MAME
  active-vs-neutral distinta, giocabile e controllabile.
- Non correggere collisioni, terreno, renderer o route proof con workaround
  visivi: prima identifica la routine o la lettura memoria divergente.
- I vecchi smoke live-route possono essere diagnostici storici. Non aggiornare
  aspettative solo per farli diventare verdi.
- I file `candidate_*.seed.json`, screenshot, capture e script oracle scratch
  possono essere lasciati da indagini precedenti.

## Documenti Da Leggere

Prima di modifiche runtime o seed:

- `STATUS.md`
- `HANDOFF_CURRENT_CONTEXT.md`
- `HANDOFF_SIX_LEVELS.md`

Prima di modifiche a descriptor, terreno, collisioni o custom level:

- `docs/level-header-format.md`
- `docs/level-header-decode-prd.md`
- `docs/findings/README.md`

Per cronologia dettagliata e vecchie note operative:

- `docs/archive/readme-status-2026-05-18/README.full.md`
- `docs/archive/readme-status-2026-05-18/STATUS.full.md`
