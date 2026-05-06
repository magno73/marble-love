/**
 * sync-av-toggle-1e08.ts — replica `FUN_00001E08` (54 byte).
 *
 * Spin-loop di sincronizzazione "AV-control toggle on event-flag pair, gated
 * da rising-edge bit 0 di `*0x400000.w`". Chiamato 3 volte da `FUN_00000FA0`
 * (3 xref @ 0x16DA, 0x1720, 0x1768) — sequenza di boot/scene-init che
 * sincronizza il chip video col bus eventi.
 *
 * **Disasm 0x1E08..0x1E3D** (54 byte):
 *
 *   00001e08    move.l  D2,-(SP)             ; salva D2
 * loop_top:
 *   00001e0a    jsr     FUN_00000F6A         ; D0.l = detectRisingEdgesAndPass()
 *   00001e10    move.w  D0w,D2w              ; D2.w = D0 low word (high nibble | rising)
 *   00001e12    jsr     FUN_00002548         ; D0 = consumeEventFlag()
 *   00001e18    tst.l   D0
 *   00001e1a    beq.b   0x00001e12           ; while D0 == 0: pop next bit
 *   00001e1c    clr.w   (0x00860000).l       ; MMIO AV-control = 0x0000
 *   00001e22    jsr     FUN_00002548         ; D0 = consumeEventFlag()
 *   00001e28    tst.l   D0
 *   00001e2a    beq.b   0x00001e22           ; while D0 == 0: pop next bit
 *   00001e2c    move.w  #0x80,(0x00860000).l ; MMIO AV-control = 0x0080
 *   00001e34    btst.l  #0,D2                ; bit 0 of D2 (= bit 0 of rising)
 *   00001e38    beq.b   0x00001e0a           ; if NOT set → restart outer loop
 *   00001e3a    move.l  (SP)+,D2             ; restore D2
 *   00001e3c    rts
 *
 * **Semantica**: ad ogni iterazione esterna,
 *   1. chiama `detectRisingEdgesAndPass` (FUN_F6A): legge `*0x400000.w`,
 *      isola low-2 bits e calcola "bit cambiati a 1" rispetto a `*0x40017C.w`.
 *      D2.w prende high-nibble | rising-bits del long ritornato.
 *   2. spin-pop event flag word `*0x400006.w` (FUN_2548) finché non esce 1.
 *   3. scrive `0x0000` a MMIO AV-control (`0x860000`).
 *   4. spin-pop event flag word ancora finché non esce 1.
 *   5. scrive `0x0080` a MMIO AV-control.
 *   6. se bit 0 di D2 (= bit 0 del rising-edge low-2) NON è set, ricomincia
 *      dal punto 1.
 *
 * **Termina** quando bit 0 di rising-edges è settato — cioè quando bit 0 di
 * `*0x400000.w` è passato da 0 a 1 rispetto al precedente snapshot in
 * `*0x40017C.w`. Dato che FUN_F6A aggiorna `*0x40017C` con `low2(*0x400000)`
 * dopo la prima call, e qui dentro `*0x400000` non viene modificato, la
 * funzione **finisce alla prima iterazione** se e solo se
 * `bit0(*0x400000) == 1` e `bit0(*0x40017C) == 0`. Altrimenti loop infinito
 * (sull'hardware reale `*0x400000` viene aggiornato da IRQ/MMIO esterni —
 * qui usiamo `iterations` come safety cap).
 *
 * Per ogni iterazione consuma 2 "1-bit" dalla queue eventi (`*0x400006`),
 * pop-and-discard di tutti gli "0-bit" prima di ognuno. Ogni iterazione
 * scrive due volte a MMIO 0x860000 (toggle 0 → 0x80).
 *
 * **JSR esterne** (2): FUN_F6A (`detectRisingEdgesAndPass` in
 * `event-flags.ts`) e FUN_2548 (`consumeEventFlag`). Entrambe già replicate
 * bit-perfect nel codebase: la replica TS le richiama direttamente per
 * garantire side-effect coerenti su `*0x40017C` e `*0x400006`.
 *
 * **MMIO writes** (no workRam): 0x860000 (word) — scritte 2N volte per N
 * iterazioni. Tracciate via callback `subs.onMmioWrite` opzionale.
 *
 * **Cap iterazioni**: il binario reale può loopare indefinitamente in attesa
 * di un IRQ/I/O esterno. La replica TS richiede un `maxIterations` esplicito;
 * se raggiunto senza bit 0 set in rising, ritorna con `terminated: false` —
 * stato workRam coerente con quel numero di iterazioni eseguite. Per parità
 * bit-perfect con il binario, il caller dello smoke / parity test setta
 * inputState in modo che la prima iterazione termini correttamente.
 *
 * Verifica bit-perfect via `cli/src/test-sync-av-toggle-1e08-parity.ts`.
 */

import type { GameState } from "./state.js";
import {
  consumeEventFlag,
  detectRisingEdgesAndPass,
} from "./event-flags.js";

/** MMIO assoluto AV-control (`*0x860000.w`). */
export const MMIO_AV_CONTROL_ADDR = 0x00860000 as const;

/** Default cap per `maxIterations` (sufficiente per qualunque smoke). */
export const DEFAULT_MAX_ITERATIONS = 256 as const;

/**
 * Stub injection per le scritture MMIO 0x860000 (non riflesse in workRam).
 *
 * - `onMmioWrite(addr, valueWord)`: chiamata ad ogni scrittura word a
 *   0x860000 (2 volte per iterazione: 0x0000 poi 0x0080).
 *
 * Non c'è injection per le JSR (FUN_F6A, FUN_2548) perché sono già replicate
 * bit-perfect in `event-flags.ts` e vengono chiamate direttamente.
 */
export interface SyncAvToggle1E08Subs {
  /** Hook MMIO write @ 0x860000. Default: no-op. */
  onMmioWrite?: (addr: number, valueWord: number) => void;
  /**
   * Cap iterazioni (loop esterno). Default `DEFAULT_MAX_ITERATIONS`.
   * Se raggiunto senza bit 0 di rising set, la funzione esce comunque.
   */
  maxIterations?: number;
  /**
   * Cap totali pop di event-flag bit (interno). Difensivo: se la queue
   * è tutta zero, ogni `inner` loop loopa per sempre. Default `100_000`.
   */
  maxFlagPops?: number;
}

/**
 * Risultato della replica.
 *
 * - `iterations`: numero di iterazioni del loop esterno completate
 *   (= quante volte D2 è stato letto e MMIO scritto due volte).
 * - `terminated`: `true` se è uscita per `bit 0 di D2 == 1` (matching binario),
 *   `false` se ha raggiunto `maxIterations` o `maxFlagPops` cap.
 * - `flagPops`: pop totali di `consumeEventFlag` (per debugging / parity).
 */
export interface SyncAvToggle1E08Result {
  iterations: number;
  terminated: boolean;
  flagPops: number;
}

/**
 * Replica bit-perfect di `FUN_00001E08`.
 *
 * @param state         GameState. Mutati: `*0x40017C` (via FUN_F6A) e
 *                      `*0x400006` (via FUN_2548).
 * @param subs          stub injection opzionali (vedi {@link SyncAvToggle1E08Subs}).
 *
 * @returns `{ iterations, terminated, flagPops }` — vedi
 *          {@link SyncAvToggle1E08Result}.
 *
 * **Side effects** in `state.workRam`:
 *   - `*0x40017C..D` (word, big-endian): aggiornato da `detectRisingEdgesAndPass`
 *     ad ogni iterazione → `low2(*0x400000.w)`.
 *   - `*0x400006..7` (word, big-endian): shifted right una volta per ogni
 *     `consumeEventFlag` (vedi `flagPops`).
 *
 * **MMIO writes** (no workRam, segnalate via `subs.onMmioWrite`):
 *   - `*0x860000.w = 0x0000` (clr.w) — 1× per iterazione
 *   - `*0x860000.w = 0x0080` (move.w #0x80) — 1× per iterazione
 */
export function syncAvToggle1E08(
  state: GameState,
  subs: SyncAvToggle1E08Subs = {},
): SyncAvToggle1E08Result {
  const maxIter = subs.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const maxPops = subs.maxFlagPops ?? 100_000;
  const onMmio = subs.onMmioWrite;

  let iterations = 0;
  let flagPops = 0;
  let terminated = false;

  // do { ... } while (bit0(D2) == 0): emula `bne fall-through, beq loop_top`.
  // L'iterazione viene SEMPRE eseguita almeno una volta (matching `move.l`
  // poi salto al `jsr FUN_F6A`).
  while (iterations < maxIter) {
    iterations++;

    // 1. jsr FUN_F6A → D0.l, D2.w = D0.w
    const d0Long = detectRisingEdgesAndPass(state) >>> 0;
    // move.w D0w, D2w → D2 low word = D0 low word.
    // btst.l #0, D2 testa bit 0 di D2 long. D2 alto è preserved (irrilevante:
    // dipende dal valore precedente di D2, ma `move.l D2,-(SP)` lo ha salvato
    // e qui non viene sovrascritto sopra il bit 0). Bit 0 di D2 = bit 0 di
    // (D2 saved upper, D0w lower) = bit 0 di D0w = bit 0 di rising-bits.
    // Il high-nibble passa nei bit 12..15, non interferisce con bit 0.
    const d2Word = d0Long & 0xffff;
    const bit0 = d2Word & 1;

    // 2. inner loop 1: pop fino a ottenere D0 == 1
    while (true) {
      if (flagPops >= maxPops) {
        return { iterations, terminated: false, flagPops };
      }
      const popped = consumeEventFlag(state);
      flagPops++;
      if (popped !== 0) break;
    }

    // 3. clr.w (0x00860000).l
    onMmio?.(MMIO_AV_CONTROL_ADDR, 0x0000);

    // 4. inner loop 2: pop fino a ottenere D0 == 1
    while (true) {
      if (flagPops >= maxPops) {
        return { iterations, terminated: false, flagPops };
      }
      const popped = consumeEventFlag(state);
      flagPops++;
      if (popped !== 0) break;
    }

    // 5. move.w #0x80, (0x00860000).l
    onMmio?.(MMIO_AV_CONTROL_ADDR, 0x0080);

    // 6. btst.l #0, D2 — se bit set: rts (terminated). Altrimenti loop_top.
    if (bit0 !== 0) {
      terminated = true;
      break;
    }
  }

  return { iterations, terminated, flagPops };
}
