# Handoff: testo fine livello secondi/punti

Data sessione: 2026-05-18
Branch: `main`
Repo/root scrivibile verificato: `/Users/magnus-bot/Code/marble-love`

## Obiettivo

Implementare/fixare il comportamento originale di Marble Madness in cui, quando
si completa un livello, compare in alto a sinistra un testo con i secondi
rimasti e i punti assegnati.

Vincoli:
- Non modificare seed, `startLevel`, collisioni, terreno o route proof senza
  nuova proof MAME.
- Non revertare file sporchi/untracked non nostri.
- Aggiornare questo file dopo ogni finding o patch importante.

## Stato iniziale

Letti prima di modificare:
- `HANDOFF_CURRENT_CONTEXT.md`
- `STATUS.md`
- `README.md`
- `HANDOFF_SIX_LEVELS.md`

Repo gia' sporco da sessioni precedenti. File dirty/untracked preesistenti da
preservare includono modifiche timer/banner, sprite, oracle script e screenshot.

## Work plan corrente

1. Individuare nel codice il path di completion livello, scoring e rendering
   alpha/HUD.
2. Capire se esiste gia' una routine replicata per il testo originale o se e'
   da collegare.
3. Patchare solo il ramo runtime necessario, con test mirati.
4. Validare con test engine/web e aggiornare questo handoff.

## Findings 2026-05-18

- Il path piu' aderente alla richiesta "fine livello" e' `FUN_118D2`, chiamata
  da `main-loop-init-1101e.ts` quando `workRam[0x390] == 3`.
- `player-slot-iter-118d2.ts` replica gia' la routine originale: per slot
  player con `obj+0x18 == 3` renderizza il testo P1/P2 (`0x22B82`/`0x22B9A`),
  formatta `obj+0x6A` come punti (`clamp 99 * 100`), aspetta `0x28` vblank,
  poi invia sound/level dispatcher e accumula punti con `FUN_28608`.
- Il runtime precedente chiamava `playerSlotIter118D2` quasi senza sub reali:
  solo `fun_16ec6` era cablata. Quindi testo, numero punti, wait e accumulo
  non erano visibili nel browser.
- `FUN_18A88` e' un secondo riepilogo "end-of-game/final score", non il normale
  cambio livello. Anche quello era chiamato senza renderer (`stateSub18A88(s)`),
  quindi non poteva scrivere testo alpha.

## Patch in corso

- `packages/engine/src/state.ts`: aggiunto `clock.levelEndScoreResumePending`
  per riprendere il cambio livello dopo l'hold del riepilogo.
- `packages/engine/src/main-loop-init-1101e.ts`:
  - cablati renderer reali per score/stringhe (`FUN_2572`, `FUN_3520`,
    `FUN_28E3C`, `FUN_286B0`, `FUN_28EB2`, `FUN_28608`);
  - su `case4` default: render pre-wait del riepilogo fine livello, hold
    main-thread di `0x28` vblank, poi continuazione del vecchio transition path;
  - su `case6` default: `FUN_18A88` ora usa renderer reali e arma un hold
    `0xB4` se trova slot matchati.

Da validare: typecheck, test mirati su `main-loop-init-1101e`, regressioni
`level-intro-banner-resume` e `playable-live-routes`.

## Validazione

- PASS: `npm --workspace @marble-love/engine run typecheck`.
- PASS: `npx vitest run packages/engine/test/main-loop-level-end-score.test.ts packages/engine/test/player-slot-iter-118d2.test.ts packages/engine/test/state-sub-18a88.test.ts packages/engine/test/level-intro-banner-resume.test.ts`
  (`35` test).
- FAIL noto nella working tree: `npx tsc -b --pretty false` si ferma su
  `packages/cli/src/probe-pc-cycles.ts(36,5)` (`bootCycle` unused), fuori dai
  file di questa patch.
- FAIL estesi osservati: `playable-live-routes.test.ts` ha 3 guardrail rossi
  su movimento/completion route; `test-main-loop-init-1101e-parity.ts 50`
  fallisce su `400086`. Non sono stati inseguiti in questa patch perche' il
  repo era gia' dirty su runtime/route/intro e questi failure non isolano il
  nuovo wiring del testo fine livello.
