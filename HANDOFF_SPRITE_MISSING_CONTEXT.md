# Handoff: sprite mancanti

Data sessione: 2026-05-18
Branch: `main`
Repo/root scrivibile verificato: `/Users/magnus-bot/Code/marble-love`

## Obiettivo

Risolvere il bug per cui in alcuni livelli non si vedono sprite/oggetti che in MAME sono visibili.
Screenshot utente di riferimento: `sprite1.png` .. `sprite4.png` sul Desktop.

Vincoli importanti:
- Non revertare file sporchi o untracked non nostri.
- Non toccare seed/startLevel/collisioni/terreno/route proof senza proof MAME distinta.
- Non usare `all-banks` come scorciatoia per i Motion Object: i doc storici dicono che MAME usa il bank attivo, non sprite stale da tutti i bank.

## Screenshot letti

File visti:
- `/Users/magnus-bot/Desktop/sprite1.png`: livello rosso/arancio, mancano porte/gate gialli verticali.
- `/Users/magnus-bot/Desktop/sprite2.png`: zona GOAL, mancano bandierina/checker e oggetto arancio tipo wave/flame.
- `/Users/magnus-bot/Desktop/sprite3.png`: stanza gialla con oggetti verdi/viola.
- `/Users/magnus-bot/Desktop/sprite4.png`: livello beige/nero, macchie verdi sul percorso.

Interpretazione corrente: non sembrano solo problemi di bordo-schermo; sono oggetti dinamici/overlay di livello.

## Stato worktree prima delle modifiche mie

Repo gia' sporco. File tracked sporchi non miei includevano:
- `docs/level-intro-banner-prd.md`
- diversi file in `packages/engine/src/*`
- `packages/web/src/main.ts`, `packages/web/src/input.ts`
- test vari

Untracked gia' presenti includevano `HANDOFF_SIX_LEVELS.md`, molti script `oracle/*`, `screenshots/`, ecc.

File modificati da questa sessione:
- `packages/web/src/renderer.ts`
- `packages/web/test/renderer.test.ts`
- `packages/engine/src/late-game-logic-26f3e.ts`
- `packages/engine/test/late-game-logic-26f3e.test.ts`
- questo handoff: `HANDOFF_SPRITE_MISSING_CONTEXT.md`

## Indagine fatta

### Motion Object bank/list

File letti:
- `packages/engine/src/render.ts`
- `packages/web/src/renderer.ts`
- `packages/web/src/main.ts`
- `packages/engine/src/main-loop.ts`
- `packages/engine/src/main-tick.ts`
- `packages/engine/src/late-game-logic-26f3e.ts`
- `docs/hardware-map.md`
- `docs/video-system.md`
- `docs/finding-26f3e-d7-drift.md`

Fatti importanti:
- Renderer web usa `motionObjects = "linked-list"` e start entry da `workRam[0x3ae]`.
- `0x4003AE` e' AV-control latched; bit 3..5 selezionano bank MO.
- `0x4003B0` contiene AV-control toggled/next.
- `mainUpdateScrollSync` latcha `0x3AE <- 0x3B0` quando `0x39A != 0`.
- `lateGameLogic26F3E` emette Motion Object entries e setta `workRam[0x39a] = 1` a fine body come wrapper TS.

Script one-off sui seed true-start:
- L1 `start_level1_intro_practice_f2479`: linked 7, all-banks 20.
- L2 `start_level2_intro_beginner_f2436`: linked 9, all-banks 17.
- L3: linked 7, all-banks 18.
- L4: linked 7, all-banks 16.
- L5: linked 7, all-banks 28.
- L6: linked 10, all-banks 31.

Conclusione: `all-banks` mostra molti entry stale; non e' un fix corretto.

### Parity / D7

`/tmp/mame_100f.json` non esiste in questa sessione, quindi i probe storici `probe-26f3e-d7.ts` non sono usabili direttamente.

Eseguito:
- `npx tsx packages/cli/src/test-late-game-logic-26f3e-parity.ts 100`

Risultato:
- fallisce `0/100`, ma il primo diff e' il noto wrapper artifact `workRam[0x39a]` (`binary=0`, `TS=1`).
- Per i seed L1..L5 la chiamata diretta binaria `FUN_26F3E` e TS produce stessa `spriteRam`; L6 diverge.

Quindi: non ho ancora provato che l'emissione sprite sia la causa degli sprite mancanti. La vecchia nota "MAME 27 vs TS 7" e' storica e va riconfermata con un dump MAME attuale, non assunta.

### Fix provvisorio gia' applicato

Ho trovato una divergenza renderer reale rispetto a MAME:
- MAME calcola le coordinate MO a 9 bit e poi se `x >= bitmap.width()` fa `x -= bitmapwidth`; stesso per y.
- TS faceva solo `x = raw & 0x1ff`, `y = (...) & 0x1ff`.
- Risultato: sprite con coordinate tipo `500` potevano essere scartati invece di apparire parzialmente a `-12`.

Patch applicata in `packages/web/src/renderer.ts`:
- aggiunta `wrapMotionObjectViewportCoordinate(...)`
- esportata `motionObjectScreenPosition(...)`
- ora x/y usano wrap MAME-like su 512px prima del clipping viewport.

Test aggiunti in `packages/web/test/renderer.test.ts`:
- verifica coordinate MO `500 -> -12`
- verifica che `debugLabel: "rom-backed-demo"` resta non wrappato.

Verifiche eseguite:
- `npx vitest run packages/web/test/renderer.test.ts` -> PASS, 6 test.
- `npx tsc -b packages/web/tsconfig.json --pretty false` -> PASS.

Importante: questo fix e' corretto ma probabilmente NON spiega da solo tutti gli screenshot, perche' gli oggetti mancanti sembrano spesso al centro schermata.

### Verifica browser/Vite

Dev server avviato:
- `npm --workspace @marble-love/web run dev -- --host 0.0.0.0`
- Vite ha scelto `http://localhost:5174/` perche' `5173` era gia' occupata.

ROM locali presenti via symlink `packages/web/public/roms`:
- `marble.zip`
- `atarisy1.zip`

Verifiche con Browser plugin:
- `http://localhost:5174/?autoLoad=1&play=1&startLevel=4`
  - log browser stabile dopo ~60fps: `frame.sprites=7` quasi sempre; in pratica solo gruppo marble.
  - screenshot visuale: livello rosso/arancio, marble visibile, ma nessun oggetto livello tipo porte/gate.
- `http://localhost:5174/?autoLoad=1&scenario=level4_early`
  - carica snapshot MAME frame 20150.
  - log f=60: `frame.sprites=11`; visivamente compaiono oggetti extra.
- `http://localhost:5174/?autoLoad=1&scenario=level4_early&play=1`
  - anche avanzando da snapshot MAME mantiene `frame.sprites=11` per molti frame.
- Probe scenari MAME:
  - `level1_obstacle`: f=60 `frame.sprites=9`
  - `level4_early`: f=60 `frame.sprites=11`
  - `level5_early`: f=60 `frame.sprites=6`
  - `level5_spawn`: f=60 `frame.sprites=9`

Conclusione aggiornata:
- Il renderer/ROM graphics non e' completamente cieco agli oggetti: quando `spriteRam`/entity list vengono da snapshot MAME, alcuni oggetti extra appaiono.
- Il bug sembra piu' probabile nel path playable/live da true-start seed o nella sua entity/dispatch state progression: in `startLevel=4` il frame renderizzato resta con solo ~7 sprite anche quando il riferimento MAME mostra oggetti di livello.
- Prossimo debug utile: confrontare entity list `0x4003BC..` e D7/spriteRam tra true-start live TS e un proof MAME/route corrispondente, oppure trovare perche' gli oggetti non-player non entrano nel dispatch durante playable live.

### Prova binario FUN_26F3E su stati live TS

Creato uno script one-off che:
1. carica seed true-start;
2. applica piccole route candidate;
3. prende lo stato TS ottenuto;
4. chiama il binario originale `FUN_26F3E` su quello stesso stato;
5. confronta D7/spriteRam con `lateGameLogic26F3E` TS.

Risultati importanti:
- `L4 f240` da `start_level4_intro_aerial_f2414`, route `DR:60,N:180`:
  - entity list pre-call: `0(type1), 1(type11), 4(type11), 2(type11), 5(type11), 3(type13), 6(type13)`.
  - pre-call TS: `D7=5`, `frameSprites=4`.
  - binario `FUN_26F3E`: `D7=13`.
  - TS `lateGameLogic26F3E`: `D7=5`.
  - primo diff spriteRam: `0x00a` (`bin=0x3a`, `ts=0x86`).
  - Conclusione: bug reale nella replica TS del dispatcher sprite, non solo renderer. Sospetto forte: `dispatchType11_13`/visible bound/direct emits per oggetti Aerial.
- `L5 f120` da `start_level5_intro_silly_f2472`, route `DL:60,N:180`:
  - binario `D7=0`, TS `D7=0`, spriteRam match.
- `L5 f180` stessa route:
  - binario `D7=8`, TS `D7=8`, spriteRam match.
  - Conclusione: il path type7/8/9 di L5 sembra matchare il binario su questi stati; non e' il primo bug da toccare.

### Fix dispatcher visible-band applicato

Proof binario per-entita' sullo stesso stato `L4 f240`:
- entity `idx0 type1`: binario `D7=5`, TS `D7=5`, spriteRam match.
- entity `idx1/4/2/5 type11`: binario emette `D7=2` ciascuna, TS pre-fix `D7=0`.
- entity `idx3/6 type13` a `d4=-68`: binario `D7=0`, TS `D7=0`.
- Quindi il missing L4 era nei quattro accessori `type11`, non nei `type13` fuori schermo.

Sweep binario sui bound `type11/type13`:
- `d4 <= -0x20` cull.
- `d4 == -0x1f` render.
- `d4 == 0xff` render.
- `d4 >= 0x100` cull.
- Questo bound e' indipendente da `struct+0x1f` (`0x09..0x0d` provati). Il vecchio helper `lowerVisibleBoundForStruct(..., 0xe0)` era sbagliato per `dispatchType11_13`.

Patch applicata:
- `dispatchType11_13` ora usa il bound binario specifico `d4baseS <= -0x20 || d4baseS >= 0x100`.
- `dispatchType4` ora usa il bound binario specifico `d4s <= -0x20 || d4s >= 0x100`.
- `dispatchType14` ora usa il bound binario specifico `d4s <= -0x30 || d4s >= 0x120`.
- Il helper catapult `lowerVisibleBoundForStruct` resta per `type10/type12`.
- Test aggiornati: il vecchio test "type 11 non-catapult culla" era una premessa sbagliata; ora copre render indipendente dal subtype byte e lower edge `-0x20`. Aggiunti anche edge test per `type4` e `type14`.

Proof L6 dopo il secondo fix:
- Stato `L6 N:240` da `start_level6_intro_ultimate_f2429`, entity list `[4,2,3,0,1]`.
- Prima del fix: `idx2 type14 d4=-20` binario `D7=3`, TS `D7=0`; `idx0/idx1 type4 d4=-40/-80` binario `D7=0`, TS `D7=2` ciascuno.
- Sweep binario:
  - `type4`: `d4 <= -0x20` cull, `d4 == -0x1f` render, `d4 >= 0x100` cull.
  - `type14`: `d4 <= -0x30` cull, `d4 == -0x2f` render, `d4 >= 0x120` cull.
- Dopo patch: `L6 N:240` `binaryD7=10`, `tsD7=10`, `workDiff=none`, `spriteDiff=none`.

Verifiche dopo patch:
- `npx vitest run packages/engine/test/late-game-logic-26f3e.test.ts packages/web/test/renderer.test.ts` -> PASS, 42 test.
- `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false` -> PASS.
- `npx tsc -b packages/web/tsconfig.json --pretty false` -> PASS.
- Confronto one-off `L4 f+240 DR:60,N:180`: entity list `[0,1,4,2,5,3,6]`, `binaryD7=13`, `tsD7=13`, `workDiff=none`, `spriteDiff=none`.
- Ricontrollo bound sintetico contro binario: per `type11/13`, `d4=-0x20`
  culla e `d4=-0x1f` renderizza, indipendentemente da marker `0x09/0x0a/0x0b/0x0d`.
  Il helper `lowerVisibleBoundForStruct` resta quindi limitato al marker `0x0a`
  per `type10/type12`; il bound speciale e' solo dentro `dispatchType11_13`.
- Matrice one-off 6 livelli x 6 route (`N/R/D/DR/DL/UL`) a 240 frame: `matrix mismatches=0`.
- Browser smoke su `http://localhost:5173/?autoLoad=1&startLevel=4&debugState=1&sound=0`: f240 `frame.sprites=12` (prima era 7 nello smoke iniziale).
- Browser smoke su `http://localhost:5173/?autoLoad=1&startLevel=6&debugState=1&sound=0`: f60/f120/f180/f240 `frame.sprites=10`.
- `npx tsc -p packages/web/tsconfig.json --noEmit --pretty false` -> PASS.
- `npm --workspace @marble-love/web run build` -> PASS (solo warning Vite su chunk >500 kB).
- `git diff --check` -> PASS.

Ricontrollo corrente di fine sessione:
- `npx vitest run packages/engine/test/late-game-logic-26f3e.test.ts packages/web/test/renderer.test.ts`
  -> PASS, 42 test.
- `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false` -> PASS.
- `npx tsc -p packages/web/tsconfig.json --noEmit --pretty false` -> PASS.
- `npm --workspace @marble-love/web run build` -> PASS (warning chunk Vite invariato).
- Matrice one-off 6 livelli x 6 route (`N/R/D/DR/DL/UL`) a 240 frame:
  `matrix mismatches=0`.

Aggiornamento pre-commit del 2026-05-18:
- Sprite: aggiunta replica `postStateChange13966` e wiring default in
  `object-render-update-1365c.ts` / `refresh-frame-10fce.ts`; confermata
  con test `post-state-change-13966.test.ts`.
- Renderer: `motionObjectScreenPosition` ora wrappa le coordinate MO MAME
  a 9 bit nella viewport signed; coperto da `renderer.test.ts`.
- Input tuning: `keyboardStep` e' normalizzato e passato a `initInput`, con
  debug overlay dei delta trackball; coperto da `input.test.ts`.
- L5 surface: rimosso il workaround che saltava `FUN_1CABA` per i player in
  L5, per evitare terreno stale/flat; coperto da
  `l5-silly-race-surface.test.ts`.
- Verifica corrente:
  - `npx vitest run packages/engine/test/late-game-logic-26f3e.test.ts packages/engine/test/post-state-change-13966.test.ts packages/web/test/input.test.ts packages/web/test/renderer.test.ts`
    -> PASS, 50 test.
  - `npx vitest run packages/engine/test/l5-silly-race-surface.test.ts`
    -> PASS, 1 test.
  - `npx tsc -p packages/engine/tsconfig.json --noEmit --pretty false` -> PASS.
  - `npx tsc -p packages/web/tsconfig.json --noEmit --pretty false` -> PASS.
  - `npm --workspace @marble-love/web run build` -> PASS (solo warning Vite chunk size).
  - `git diff --check` sui file candidati -> PASS.

Stato corrente: la causa provata per gli sprite mancanti/errati negli screenshot
e' stata corretta nei bound MO del dispatcher (`type4`, `type11/13`, `type14`)
piu' wrap coordinate renderer. Se l'utente vede ancora un caso mancante, il
prossimo passo non e' cambiare seed/route: serve un nuovo stato riproducibile
e confronto `FUN_26F3E`/`frame.sprites` su quel frame.

## Prossimi passi consigliati

1. Se serve ulteriore conferma visuale, verificare nel browser con ROM reali e
   `?scenario=level*_...` o `?autoLoad=1&play=1&startLevel=N`.
2. Usare Browser plugin se serve screenshot visivo; non usare screenshot Desktop generici oltre a `sprite1..4`.
3. Esaminare i comandi `frame.sprites` in scenari che corrispondono agli screenshot:
   - `level1_obstacle` / `level1_spawn` per porte gialle.
   - `level2_early` o `level5_*` per GOAL/bandierina/wave.
   - `level4_*` per macchie verdi.
4. Capire se gli sprite sono:
   - assenti in `frame.sprites` -> problema emissione/lista MO o entity dispatch.
   - presenti ma trasparenti/errati -> problema decode grafico/palette/pen/priority/merge.
   - presenti ma fuori posizione -> problema coordinate/proiezione/wrap/scroll.
5. Se serve MAME proof, rigenerare dump/tap con gli script `oracle/mame_sprite_writes_tap.lua` o `oracle/mame_playable_route_sprite_writes_tap.lua`, invece di fidarsi del vecchio `/tmp/mame_100f.json`.

## Comandi utili gia' usati

```sh
npx vitest run packages/web/test/renderer.test.ts
npx tsc -b packages/web/tsconfig.json --pretty false
npx tsx packages/cli/src/test-late-game-logic-26f3e-parity.ts 100
```

## Nota L5 fisica

Il problema precedente delle salite/discese invertite in L5 era ROM-exact:
`0x400394 == 4` su L5 attiva il ramo speciale `FUN_25DF6` ADD. Non toccarlo per questo task.
