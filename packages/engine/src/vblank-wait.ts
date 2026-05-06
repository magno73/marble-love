/**
 * vblank-wait.ts — replica `FUN_000052B8` (34 byte): "wait N vblanks".
 *
 * Sub chiamata da `FUN_00005BB8` (jsr 0x5D06) e `FUN_00005E00` (jsr 0x5F58).
 * Convenzione caller: il count (word) viene pushato sullo stack e
 * letto via `move.w (0xa,SP),D0w` (0xA = 4 byte D2 saved + 4 byte return PC
 * + 2 byte argomento).
 *
 * **Disasm 0x52B8..0x52D9** (34 byte):
 *
 *   move.l  D2,-(SP)                ; preserva D2 (clobber-free)
 *   move.w  (0xa,SP),D0w            ; D0w = count (signed word)
 *   bra.b   test
 * loop:
 *   move.l  (0x00401FF8).l,D2       ; D2 = vblank counter
 * inner:
 *   move.l  (0x00401FF8).l,D1       ; D1 = vblank counter
 *   cmp.l   D2,D1
 *   beq.b   inner                   ; spin finché counter non cambia (1 vblank)
 *   subq.w  #1,D0w                  ; D0w--
 * test:
 *   tst.w   D0w
 *   bgt.b   loop                    ; while D0w > 0
 *   move.l  (SP)+,D2                ; restore D2
 *   rts
 *
 * **Semantica**: busy-wait di `count` vblank tick. Il "vblank tick" è
 * modellato dal long counter @ `0x401FF8` (ramRam offset 0x1FF8) che il
 * binario originale incrementa nella ISR di sound/vblank — vedere
 * `sound-tick.ts` e `timer-delta.ts` che lo trattano già come fonte di
 * tempo.
 *
 * **Side effects**: nessun side effect su workRam. La funzione legge
 * solo `0x401FF8`, e preserva D2 (push/pop). Il valore di ritorno in D0
 * è puramente derivato da `count`:
 *   - `count <= 0` (interpretazione signed word): la `bgt` non scatta
 *     mai → D0w resta = `count`, nessuna lettura del counter.
 *   - `count > 0`: il loop esegue `count` iterazioni, decrementando
 *     D0w fino a 0; D0w finale = 0.
 *
 * **Bit-perfect parity**: poiché non c'è memoria modificata, la parità
 * è verificata su (D0 word, workRam unchanged). La high word di D0
 * viene preservata dal binario (nessuna istruzione la tocca).
 *
 * In TypeScript la chiamata è non-bloccante: ritorna immediatamente
 * il valore di D0 atteso. La "attesa reale" è gestita ad un livello
 * più alto dal main loop (60 Hz) — nel browser il game loop a
 * `requestAnimationFrame` schedulerebbe il tick successivo.
 */

import type { GameState } from "./state.js";

/** WORK RAM base address (per coerenza con altri moduli del progetto). */
const WORK_RAM_BASE = 0x400000;
/** Offset del long counter vblank in workRam (== `0x401FF8 - WORK_RAM_BASE`). */
export const VBLANK_COUNTER_OFF = 0x1ff8;

/**
 * Replica `FUN_000052B8` — busy-wait di `count` vblank tick.
 *
 * @param _state    GameState (unused, ma firma coerente col resto dei moduli;
 *                  il binario legge `0x401FF8` ma la nostra TS non blocca).
 * @param countWord Argomento word (signed). Viene mascherato a 16 bit e
 *                  reinterpretato signed per replicare `tst.w + bgt`.
 * @returns         Il valore di D0w al rientro dal `rts`, esteso al low word
 *                  di un long (high word = 0). Bit-perfect:
 *                    - count signed > 0  → 0
 *                    - count signed <= 0 → count masked a 16 bit (low word)
 */
export function waitVblank(_state: GameState, countWord: number): number {
  // Tronca a 16 bit (D0w) e reinterpreta signed (tst.w + bgt usano flags signed).
  const w = countWord & 0xffff;
  const signed = w & 0x8000 ? w - 0x10000 : w;

  if (signed > 0) {
    // Loop esegue `signed` iterazioni e D0w finisce a 0.
    return 0;
  }
  // count <= 0: il loop non esegue, D0w resta = count (low word).
  return w >>> 0;
}

/**
 * Re-export del simbolo come "FUN_000052B8" per mappatura esplicita
 * binario→TS (utile in test di parity / disasm cross-reference).
 */
export { waitVblank as FUN_000052B8 };
export { WORK_RAM_BASE };
