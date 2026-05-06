/**
 * array-9-clear-and-dispatch.ts — replica `FUN_000190EE` (62 byte).
 *
 * Iteratore "fan-out" sull'array-9 (`0x401890` stride `0x28`, 9 entry —
 * vedi `slot-array-init.ts` per il bulk-init e `proximity-check.ts` per
 * un altro consumer dello stesso layout). Per ogni entry:
 *   1. Azzera il byte a offset `0x18` dell'entry (tipico flag "active/state").
 *   2. Legge come byte sign-extended a long i campi `[entry+0x19]` e
 *      `[entry+0x25]`, li pusha (long) sullo stack e chiama `FUN_00018F46`.
 *   3. Avanza A2 di `0x28` (next entry).
 *
 * **Caller**: `FUN_000144E4` (1 xref @ 0x000145FC). Funzione di "reset +
 * notify" delle 9 entry, presumibilmente al momento di un cambio di livello
 * o di un reset di stato globale.
 *
 * **Disasm 0x190EE..0x1912B** (62 byte):
 *
 *   movem.l {D2,A2},-(SP)            ; salva D2/A2 (8 byte)
 *   movea.l #0x401890,A2             ; A2 = base array-9
 *   clr.b   D2b                      ; D2 = 0 (loop counter, 9 entry)
 *   ; loop @ 0x190FA:
 *   clr.b   (0x18,A2)                ; entry[0x18] = 0
 *   move.b  (0x19,A2),D0b            ; D0.b = entry[0x19]
 *   ext.w   D0w                      ; D0.w = sign-extend
 *   ext.l   D0                       ; D0   = sign-extend
 *   move.l  D0,-(SP)                 ; push arg2 (long)
 *   move.b  (0x25,A2),D0b            ; D0.b = entry[0x25]
 *   ext.w   D0w                      ; D0.w = sign-extend
 *   ext.l   D0                       ; D0   = sign-extend
 *   move.l  D0,-(SP)                 ; push arg1 (long)
 *   jsr     0x00018f46.l             ; FUN_18F46(arg1, arg2)
 *   moveq   #0x28,D0                 ; D0 = stride
 *   adda.l  D0,A2                    ; A2 += 0x28
 *   addq.l  #8,SP                    ; pop 2 long args
 *   addq.b  #1,D2b                   ; D2++
 *   cmpi.b  #9,D2b                   ; cmp D2,#9
 *   bne.b   0x190FA                  ; if D2 != 9 → loop
 *   movem.l (SP)+,{A2,D2}            ; restore
 *   rts
 *
 * **Stack layout della call a FUN_18F46** (dopo i 2 push):
 *   SP+0x00: ret addr (4 byte) — pushed da `jsr`
 *   SP+0x04: arg1 long = sign-extend(entry[0x25])
 *   SP+0x08: arg2 long = sign-extend(entry[0x19])
 * `FUN_18F46` legge `(0x13,SP).b` (= arg1 low byte) e `(0x17,SP).b`
 * (= arg2 low byte) — con `movem.l {A3,A2,D2},-(SP)` in prologo che aggiunge
 * 12 byte → SP+12 = arg1 low byte = entry[0x25]; SP+16 = arg2 low byte =
 * entry[0x19]. Quindi il sign-extend è cosmetico per il callee, ma deve
 * essere replicato per bit-perfect parity dello stack frame.
 *
 * **Side effects** sulla work RAM (escludendo quelli di `FUN_18F46`):
 *   - `workRam[0x1890 + i*0x28 + 0x18] = 0` per i in [0..8].
 *
 * **Ordine di chiamata**: i = 0, 1, 2, ..., 8 (sequenziale, deterministico).
 *
 * **Ritorno**: nessun valore significativo (il binario non setta D0 prima
 * di `rts`; il caller `FUN_144E4` non legge D0 dopo il `jsr`).
 *
 * Verifica bit-perfect via `cli/src/test-array-9-clear-and-dispatch-parity.ts`.
 */

import type { GameState } from "./state.js";

/** Base address dell'array-9 (9 entry × 0x28 byte) in work RAM. */
export const ARRAY_BASE = 0x00401890 as const;
/** Stride fra entry consecutive. */
export const ARRAY_STRIDE = 0x28 as const;
/** Numero di entry iterate. */
export const ARRAY_COUNT = 9 as const;
/** Offset del byte azzerato in ogni entry. */
export const FLAG_OFFSET = 0x18 as const;
/** Offset del byte letto come 1° campo (push come arg2 long). */
export const FIELD_19_OFFSET = 0x19 as const;
/** Offset del byte letto come 2° campo (push come arg1 long). */
export const FIELD_25_OFFSET = 0x25 as const;

/**
 * Stub injection per la JSR a `FUN_00018F46` (callee binario).
 *
 * `fun_18F46(arg1, arg2, state)`: invocata 9 volte, una per ogni entry.
 *   - `arg1`: long sign-extended di `entry[0x25]` (byte → word → long).
 *     Range: [-128, 127] interpretato come long (es. 0xFF → -1 → 0xFFFFFFFF).
 *   - `arg2`: long sign-extended di `entry[0x19]`. Stesso range/semantica.
 *   - `state`: passato per comodità (la callee binaria modifica work RAM).
 *
 * **Nota**: il binario pusha entrambi come `move.l D0,-(SP)` post sign-ext.
 * Per parity dello stack frame i due valori vanno passati come `>>> 0` se la
 * callback usa long unsigned; oppure il caller può ignorare il sign-extend
 * e leggere solo il low byte (è ciò che fa `FUN_18F46` realmente).
 *
 * Default no-op (matching `rts` patch nel parity test).
 */
export interface Array9ClearAndDispatchSubs {
  /** FUN_18F46(arg1Long, arg2Long, state). Default no-op. */
  fun_18f46?: (arg1Long: number, arg2Long: number, state: GameState) => void;
}

/**
 * Replica bit-perfect di `FUN_000190EE` — clear flag 0x18 + dispatch
 * `FUN_18F46(entry[0x25], entry[0x19])` per ognuna delle 9 entry
 * dell'array @ 0x401890 stride 0x28.
 *
 * @param state  GameState. Modifica `workRam[0x1890 + i*0x28 + 0x18] = 0`
 *               per i in [0..8] PRIMA della call corrispondente; legge poi
 *               `workRam[entry+0x19]` e `workRam[entry+0x25]` (signed byte
 *               → long sign-extended).
 * @param subs   Stub injection per la JSR a `FUN_18F46`. Se omessa, le 9
 *               call sono no-op (resta solo l'effetto di clear sui flag).
 *
 * **Ordine**: clr-then-dispatch per entry 0, 1, 2, ..., 8 in sequenza
 * stretta (importante per parity: il binario clear l'entry i e POI chiama
 * la callback con i campi della stessa entry — l'effetto di clear su 0x18
 * è già visibile alla callback, ma 0x19 e 0x25 NON sono toccati dal clear).
 */
export function array9ClearAndDispatch(
  state: GameState,
  subs?: Array9ClearAndDispatchSubs,
): void {
  const cb = subs?.fun_18f46;
  const r = state.workRam;
  let entryAddr = ARRAY_BASE >>> 0;
  for (let i = 0; i < ARRAY_COUNT; i++) {
    const off = (entryAddr - 0x400000) >>> 0;

    // clr.b (0x18, A2)
    r[off + FLAG_OFFSET] = 0;

    // move.b (0x19,A2),D0b ; ext.w D0w ; ext.l D0  → push long sign-ext
    const byte19 = r[off + FIELD_19_OFFSET] ?? 0;
    const arg2Long = byte19 & 0x80 ? (byte19 | 0xffffff00) >>> 0 : byte19;

    // move.b (0x25,A2),D0b ; ext.w D0w ; ext.l D0  → push long sign-ext
    const byte25 = r[off + FIELD_25_OFFSET] ?? 0;
    const arg1Long = byte25 & 0x80 ? (byte25 | 0xffffff00) >>> 0 : byte25;

    // jsr 0x00018F46.l   — order: arg1 (entry[0x25]) pushed second,
    //                       so SP+4=arg1, SP+8=arg2 inside callee.
    cb?.(arg1Long, arg2Long, state);

    // adda.l #0x28, A2
    entryAddr = (entryAddr + ARRAY_STRIDE) >>> 0;
  }
}
