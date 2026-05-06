/**
 * format-and-render-28e00.ts — replica `FUN_00028E00` (60 byte).
 *
 * Wrapper "format value as hex + render as alpha-tilemap string" composto
 * da due chiamate sequenziali:
 *
 *   1. `formatHex(value, bufEnd, numDigits, showSpaces)`
 *      = `FUN_00003A08` (via trampoline `jmp 0x3A08` @ 0x10C). Scrive
 *      `value` come stringa ASCII hex backward in memoria a partire da
 *      `bufEnd + numDigits`, con null terminator.
 *      - `value`      = `arg1Long` (long)
 *      - `bufEnd`     = `*0x400436` (long, **letto dalla workRam come
 *                        struct-string-pointer field**)
 *      - `numDigits`  = `sext_l(arg2Word)` (low word di arg2)
 *      - `showSpaces` = stack garbage @ FUN_3A08's `(0x16,SP)` =
 *                        **low word di D2 saved al prologo di FUN_28E00**
 *                        = low word del registro D2 del CALLER al momento
 *                        della call (caller-saved!).
 *
 *   2. `FUN_00028FDE(arg3Word, arg4Word)`, che internamente:
 *      a. `initStructHeader(0x400434, arg3.lowByte, arg4.lowByte)`
 *         (`FUN_0000255A`): scrive byte a workRam[0x434], workRam[0x435],
 *         e azzera workRam[0x43A].
 *      b. `renderStringChain(rom, structAddr=0x400434, attrWord=0x3400)`
 *         (`FUN_00002572`): renderizza la string chain a partire dalla
 *         entry @ 0x400434 nell'alpha tilemap @ 0xA03000, usando i ROM
 *         tables a 0x7294/0x72A0/0x72A4/0x72A8 e i globals workRam
 *         (0x401F00, 0x401F3A, 0x401F42).
 *
 * **Disasm 0x28E00..0x28E3B** (60 byte):
 *
 *   00028E00  move.l   D2,-(SP)              ; salva D2 (4 byte)
 *   00028E02  move.l   (0x8,SP),D1           ; D1 = arg1Long (long, ptr value)
 *   00028E06  move.w   (0xE,SP),D0w          ; D0w = arg2.lo word (numDigits)
 *   00028E0A  move.w   (0x12,SP),D2w         ; D2w = arg3.lo word (col byte)
 *   00028E0E  ext.l    D0                    ; D0 = sext_l(numDigits)
 *   00028E10  move.l   D0,-(SP)              ; push numDigits long
 *   00028E12  move.l   (0x00400436).l,-(SP)  ; push *0x400436 (bufEnd ptr long)
 *   00028E18  move.l   D1,-(SP)              ; push arg1Long (value)
 *   00028E1A  jsr      0x0000010C.l          ; → jmp 0x3A08 = formatHex
 *   00028E20  move.w   (0x22,SP),D0w         ; D0w = arg4.lo word (tickOff byte)
 *                                              ; (SP+0x22 con 3 long ancora pushed
 *                                              ;  = orig SP+0x16 = arg4 lo word)
 *   00028E24  ext.l    D0
 *   00028E26  move.l   D0,-(SP)              ; push sext(arg4.lo) long
 *   00028E28  move.w   D2w,D0w
 *   00028E2A  ext.l    D0
 *   00028E2C  move.l   D0,-(SP)              ; push sext(arg3.lo) long
 *   00028E2E  jsr      0x00028FDE.l          ; FUN_28FDE
 *   00028E34  lea      (0x14,SP),SP          ; cleanup 20 byte = 5 long:
 *                                              ;   3 long arg per jsr 0x10C
 *                                              ; + 2 long arg per jsr 0x28FDE
 *   00028E38  move.l   (SP)+,D2              ; restore D2
 *   00028E3A  rts
 *
 * **NB sull'arg "showSpaces"**: FUN_28E00 NON pusha un quarto long sullo stack
 * prima del jsr 0x10C. Quindi `formatHex` legge `(0x16,SP)` (dopo il proprio
 * `move.l D2,-(SP)`) che corrisponde a un offset di **2 byte all'interno della
 * D2 saved da FUN_28E00**. La D2 saved è il valore di D2 **al momento
 * dell'ingresso di FUN_28E00**, ovvero il **D2 del caller**. La low word del
 * D2 caller diventa quindi `showSpaces`. Per parity testing va settato
 * esplicitamente prima della jsr 0x28E00.
 *
 * **Caller del binario**: nessuno. La funzione è dead code (zero cross
 * references nel ROM blob). Replicata per completezza catalog.
 *
 * **Side effects** (assumendo memoria valida):
 *   1. `*(*0x400436)..*(*0x400436 + numDigits)` = ASCII hex digits + null
 *   2. workRam[0x434] = arg3 low byte
 *   3. workRam[0x435] = arg4 low byte
 *   4. workRam[0x43A] = 0
 *   5. alpha tilemap @ 0xA03000 mutato da renderStringChain (dipende da
 *      rotation @ workRam[0x1F42], tick @ workRam[0x1F3A], val_f00 @
 *      workRam[0x1F00], e dal contenuto della string chain)
 *
 * Verifica bit-perfect via `packages/cli/src/test-format-and-render-28e00-parity.ts`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { formatHex } from "./string-format.js";
import { renderStringEntry28FDE } from "./render-string-entry-28fde.js";
import { renderStringChain } from "./string-render.js";

/** Workram offset del puntatore "string buffer" usato da formatHex. */
export const BUFEND_PTR_OFF = 0x436 as const;
/** Workram offset della struct passata a renderStringChain. */
export const STRUCT_BASE_OFF = 0x434 as const;
/** Constante hard-coded: attr word per renderStringChain. */
export const ATTR_WORD = 0x3400 as const;

/**
 * Sub injection — solo formatHex non ha leaf-deps interni; tutti i tre
 * helper (formatHex, initStructHeader, renderStringChain) sono già verificati
 * bit-perfect via i loro parity test. Questo wrapper non ha sub esterne
 * "stub-able" oltre a quelle tre.
 *
 * Reserved for symmetry; nessuna sub override attualmente.
 */
export interface FormatAndRender28E00Subs {
  // Reserved.
}

/**
 * Replica bit-perfect di `FUN_00028E00`.
 *
 * @param state         GameState (mutato in-place: workRam, alphaRam).
 * @param rom           RomImage (per ROM tables di renderStringChain e per
 *                       leggere puntatori cross-region).
 * @param arg1Long      `value` long (byte 0..3) da formattare come hex.
 * @param arg2Word      Low word usata come `numDigits` (sign-extended).
 * @param arg3Word      Low word; low byte usato come `col` della struct.
 * @param arg4Word      Low word; low byte usato come `tickOff` della struct.
 * @param callerD2Word  Low word del registro D2 del caller al momento della
 *                       call (= showSpaces per formatHex). Default 0.
 * @param _subs         Reserved.
 *
 * **Side effects**:
 *   - `*((*0x400436))..*((*0x400436) + sext(arg2Word))` ← hex digits + null
 *   - `workRam[0x434]` ← arg3.lowByte
 *   - `workRam[0x435]` ← arg4.lowByte
 *   - `workRam[0x43A]` ← 0
 *   - `alphaRam` mutato da renderStringChain (vedi `string-render.ts`)
 */
export function formatAndRender28E00(
  state: GameState,
  rom: RomImage,
  arg1Long: number,
  arg2Word: number,
  arg3Word: number,
  arg4Word: number,
  callerD2Word: number = 0,
  _subs?: FormatAndRender28E00Subs,
): void {
  const r = state.workRam;

  // sext_l(arg2Word) — low word sign-extended a long.
  const w2 = arg2Word & 0xffff;
  const numDigits = w2 & 0x8000 ? w2 - 0x10000 : w2;

  // Read *0x400436 (long, big-endian) — bufEnd ptr.
  const bufEnd =
    (((r[BUFEND_PTR_OFF] ?? 0) << 24) |
      ((r[BUFEND_PTR_OFF + 1] ?? 0) << 16) |
      ((r[BUFEND_PTR_OFF + 2] ?? 0) << 8) |
      (r[BUFEND_PTR_OFF + 3] ?? 0)) >>>
    0;

  // showSpaces = low word del D2 caller (saved da FUN_28E00 prologue, letto
  // come stack-garbage da formatHex come (0x16,SP) word).
  const showSpaces = callerD2Word & 0xffff;

  // Step 1: formatHex(arg1Long, bufEnd, numDigits, showSpaces).
  formatHex(state, arg1Long >>> 0, bufEnd, numDigits, showSpaces);

  // Step 2: FUN_28FDE — write byte fields a workRam[0x434/0x435/0x43A] e
  // chiama renderStringChain. Usiamo il modulo dedicato `renderStringEntry28FDE`
  // (FUN_28FDE) con sub injection wirata a `renderStringChain` reale.
  // Nota: il binario passa arg3 e arg4 come word sign-extended a long, ma
  // la funzione legge solo il LOW BYTE → `argLong & 0xff` è esatto.
  renderStringEntry28FDE(state, arg3Word, arg4Word, {
    renderStringChain: (structAddr, attrWord) =>
      renderStringChain(state, rom, structAddr, attrWord),
  });
}

/**
 * Re-export del simbolo come "FUN_00028E00" per mappatura esplicita
 * binario→TS.
 */
export { formatAndRender28E00 as FUN_00028E00 };
