/**
 * process-all-sprites-189e2.ts — replica `FUN_000189E2` (60 byte).
 *
 * Loop dispatcher che itera la tabella di sprite-record @ `0x40098C`
 * (stride `0xC`, count word @ `0x400396`), gated dal "game mode flag" word
 * @ `0x400394`. Per ogni entry, chiama `FUN_00018A1E`
 * (= `spriteCoords.computeSpriteCoords_v1`) passando il puntatore al record.
 *
 * **Disasm 0x189E2..0x18A1D** (60 byte):
 *
 *   movem.l {D3 D2},-(SP)             ; save callee-saved
 *   tst.w   (0x00400394).l            ; gate flag (word)
 *   bne.w   exit                      ; → se !=0 skip loop
 *   move.l  #0x40098c,D3              ; D3 = base tabella
 *   clr.b   D2b                       ; D2.b = 0 (counter)
 *   bra.b   loop_test
 * loop_body:
 *   move.l  D3,D1                     ; D1 = ptr entry corrente
 *   moveq   #0xC,D0
 *   add.l   D0,D3                     ; D3 += 0xC (next entry)
 *   move.l  D1,-(SP)                  ; push arg
 *   jsr     0x00018a1e.l              ; call computeSpriteCoords_v1(D1)
 *   addq.l  #4,SP                     ; pop arg
 *   addq.b  #1,D2b                    ; counter++
 * loop_test:
 *   move.b  D2b,D0b
 *   ext.w   D0w                       ; sign-extend byte → word
 *   cmp.w   (0x00400396).l,D0w        ; counter == count?
 *   bne.b   loop_body
 * exit:
 *   movem.l (SP)+,{D2 D3}
 *   rts
 *
 * **Magic addresses** (work RAM, base `0x400000`):
 *   - `0x400394` (word) — gate flag. !=0 → skip iterazione (pause/transition?).
 *   - `0x400396` (word) — count delle entry attive.
 *   - `0x40098C`        — base tabella sprite-record (stride `0xC`).
 *
 * **Caller**: `FUN_00010FCE` (terzo jsr nel proprio body, sequenza root tick).
 *
 * **Invarianti notevoli**:
 *   1. Il puntatore passato è quello *prima* dell'incremento (i.e. `base + i*0xC`).
 *      In pratica, anche se `add.l` viene eseguito subito dopo la lettura di D1,
 *      il valore consegnato a `FUN_18A1E` è sempre `0x40098C + counter * 0xC`.
 *   2. Il counter è un byte (8 bit) sign-extended a word per il confronto. Se
 *      `count > 0x7F`, alla 128ª iterazione D2.b diventa 0x80 → ext.w lo rende
 *      0xFF80 (= -128 signed) e cmp.w con il count fallisce → loop infinito.
 *      Il binario stesso contiene questa "trappola"; in pratica `count` reale
 *      resta sotto 0x80 (sprite slot ~16-32). La replica TS qui SCEGLIE di
 *      fermarsi anche in quel caso patologico (vedi nota in `processAllSprites`)
 *      perché non emuliamo loop infiniti — questo non altera la parità nei
 *      casi reali del gioco.
 *   3. La gate word `*0x400394` è 16 bit; tst.w setta Z se tutti i 16 bit sono 0.
 *
 * **Side effects**: solo via la callback (computeSpriteCoords_v1 scrive
 * l'output coord long a `entry+0x6` e aggiorna i globali `0x400690/0x400692`).
 * La funzione stessa non modifica nessun byte di workRam direttamente.
 */

import type { GameState } from "./state.js";
import { computeSpriteCoords_v1 } from "./sprite-coords.js";

/** Base della work RAM (subtractor per offset relativi). */
const WORK_RAM_BASE = 0x400000;

/** Magic addresses — costanti immediate del binario. */
const SPRITE_TABLE_BASE_ABS = 0x40098c;
const SPRITE_TABLE_STRIDE = 0xc;
const GATE_FLAG_OFF = 0x394; // word @ 0x400394
const COUNT_OFF = 0x396; // word @ 0x400396

/** Read big-endian u16 da workRam offset. */
function readU16(state: GameState, off: number): number {
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}

/**
 * Replica `FUN_000189E2` — itera la sprite-record table e chiama
 * `computeSpriteCoords_v1` per ogni entry, gated dal flag `*0x400394`.
 *
 * @param state GameState. Legge `workRam[0x394..0x395]` (gate) e
 *   `workRam[0x396..0x397]` (count). La callback chiamata su ogni entry
 *   (`computeSpriteCoords_v1`) può modificare `workRam` in altri offset.
 *
 * **Comportamento**:
 *   - Se `*(u16) 0x400394 != 0` → ritorno immediato senza side effects.
 *   - Altrimenti: per `i = 0..count-1` chiama `computeSpriteCoords_v1(state,
 *     0x40098C + i * 0xC)`.
 *   - `count` è un word (16 bit), ma il binario itera con un byte counter
 *     sign-extended. Per parità con i dati reali del gioco (count < 0x80)
 *     usiamo un loop standard `for i in [0..count)`. Vedi NOTE in header.
 */
export function processAllSprites(state: GameState): void {
  // tst.w (0x400394).l : se gate != 0, skip.
  const gate = readU16(state, GATE_FLAG_OFF);
  if (gate !== 0) {
    return;
  }

  // Loop body: counter byte → sign-extended word → cmp.w con count word.
  // Per i count < 0x80 (regime normale) il loop equivale a `for i in [0..count)`.
  // Per count >= 0x80, il binario originale incappa in overflow del byte
  // counter; replichiamo il regime "normale" perché count reale del gioco
  // resta sempre nei limiti (sprite slot ~16-32).
  const count = readU16(state, COUNT_OFF);
  for (let i = 0; i < count; i++) {
    const entryAddr = (SPRITE_TABLE_BASE_ABS + i * SPRITE_TABLE_STRIDE) >>> 0;
    computeSpriteCoords_v1(state, entryAddr);
  }
}

/**
 * Variante "iniettabile" della replica: utile per smoke test isolati che
 * vogliono osservare quali entry vengono iterate senza dipendere dal
 * comportamento di `computeSpriteCoords_v1` (e dai suoi prerequisiti su
 * workRam).
 *
 * @param state    GameState (legge gate + count).
 * @param onEntry  Callback chiamata con il puntatore assoluto di ogni entry.
 *                 Equivalente del `jsr 0x18A1E` nel binario.
 */
export function processAllSpritesWith(
  state: GameState,
  onEntry: (state: GameState, entryAddr: number) => void,
): void {
  const gate = readU16(state, GATE_FLAG_OFF);
  if (gate !== 0) {
    return;
  }
  const count = readU16(state, COUNT_OFF);
  for (let i = 0; i < count; i++) {
    const entryAddr = (SPRITE_TABLE_BASE_ABS + i * SPRITE_TABLE_STRIDE) >>> 0;
    onEntry(state, entryAddr);
  }
}

/** Costanti esposte per testing/inspection. */
export const SPRITE_TABLE_BASE = SPRITE_TABLE_BASE_ABS;
export const SPRITE_TABLE_ENTRY_STRIDE = SPRITE_TABLE_STRIDE;
export const GATE_FLAG_ADDR = WORK_RAM_BASE + GATE_FLAG_OFF;
export const COUNT_ADDR = WORK_RAM_BASE + COUNT_OFF;
