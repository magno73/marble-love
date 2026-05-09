# State Convergence Roadmap

**Branch:** `feature/visual-pixel-match`
**Obiettivo:** far convergere `bootInit + tick(N)` dell'engine TS allo stesso state RAM che MAME ha @ frame 2400.

## Diagnostica iniziale

Test eseguito: `bootInit({preloadLevel:0, fullScreenInit:true}) + tick(2400, runMainLoopBody:true)`.

| Region | TS match vs MAME |
|---|---|
| workRam | 81-82% |
| **playfieldRam** | **24%** ← problema principale |
| spriteRam | 64-66% |
| alphaRam | 91% |
| colorRam | 90% |

## Problema 1: state machine bloccata

L'analisi mostra che `workRam[0x390] = 1` (state 1 attract) per tutti i 2400 tick. La state machine TS non evolve attraverso gli stati 1→2→...→5 che farebbero scattare le sub di rendering completo.

`mainLoopInit1101E` `case 1` (= state 1) non avanza perché manca:
- `workRam[0x3ee]` non viene popolato a 1 (= flag intro complete)
- `workRam[0x3ea]` non raggiunge 0x18 (= timer threshold)

Queste workRam sono popolate da sub che attualmente non sono wirate o sono stubbed.

## Problema 2: playfieldRam scritto solo 2620/5731 byte

MAME scrive playfieldRam durante boot (frame 0..200). Mio TS chiama `levelDispatcher16EC6` UNA volta a bootInit, ma MAME chiama probabilmente molteplici sub durante boot:
- `clearPlayfieldRam12174` (PC 0x012180 al frame 108) ✅ replicato
- `levelDispatcher16EC6` ✅ replicato
- **Altre sub che scrivono ~3000 byte di tile ❌ identifying...**

Watch_write su 0xA00000-0xA01FFF tra frame 0..200 mostra solo PC 0x0004ae (= boot init early). Servirebbe trace più granulare per identificare i 3000 byte mancanti.

## Roadmap proposta

### Step 1: Identificare la sub mancante (= popolazione restante 3000 byte playfield)

Approccio: usare `tools/watch_write.lua` con range più granulare (es. 256 byte per region) e identificare PC writers per ognuno.

### Step 2: Verificare wireup

Per ogni sub identificata:
1. Cercare in TS se è già replicata
2. Se sì: verificare che sia wired (= chiamata da bootInit o tick)
3. Se no: replicare + parity test

### Step 3: State machine evolution

Investigare cosa popola `workRam[0x3ee]` e `workRam[0x3ea]`. Probabile che siano:
- IRQ4 vblank handler (frame counter incremento)
- Un timer sub specifico (FUN_???)

Una volta identificato, wirate i hook necessari nel `tick()`.

### Step 4: Verifica iterativa

Dopo ogni fix, re-run `probe-converge.ts` e verificare miglioramento di:
- workRam match
- playfieldRam match
- state machine evolution (workRam[0x390] progressing through states)

## Stima sforzo

- Step 1+2 (sub mancanti playfield): 4-8 ore (richiede MAME debugging deep)
- Step 3 (state machine evolution): 4-8 ore
- Step 4 (iterazione finale): 2-4 ore

Totale: **1-2 giorni di lavoro continuativo** per convergenza state TS ≡ MAME state.

