/**
 * obj-dirty-dispatch-28624.ts — replica `FUN_00028624` (140 byte, 0 args, 0 ret).
 *
 * Helper "object-dirty HUD dispatcher": itera tutti gli object struct attivi
 * (count = `*0x400396` word), per ogni indice testa il bit corrispondente
 * della bitmap `*0x40039c` (byte) e — se il bit è set — chiama il render-string
 * helper `FUN_00028E3C` con un pacchetto di 6 long arg derivati dall'object
 * struct corrente, dall'indice e da una piccola ROM table @ 0x23D3A. A
 * iterazione completata, la bitmap viene azzerata.
 *
 * **Caller** (xref):
 *   - `FUN_00010504` @ 0x000106E2 — boot/init di un game-state.
 *   - `FUN_00010FCE` @ 0x00011016 — secondo init/refresh.
 *   In entrambi i caller `FUN_28624` è invocata SENZA argomenti, come tail
 *   chiamata "flush dirty HUD slots" prima del rts.
 *
 * **Disasm 0x28624..0x286B0** (140 byte):
 *
 *   00028624  movem.l {A2 D3 D2},-(SP)        ; salva 12 byte
 *   00028628  movea.l #0x400018,A2             ; A2 = base obj struct array
 *   0002862E  clr.b   D2                       ; D2 = 0 (loop counter byte)
 *   00028630  bra.w   0x28698                  ; salta a check loop
 *
 *   ; ── corpo loop (entry @ 0x28634, eseguito se bit set) ──────────────
 *   00028634  moveq   #1,D0                    ; D0 = 1
 *   00028636  move.b  D2,D1                    ; D1 = D2
 *   00028638  asl.l   D1,D0                    ; D0 = 1 << D2
 *   0002863A  move.b  (0x40039C).l,D1          ; D1.b = bitmap byte
 *   00028640  ext.w   D1
 *   00028642  ext.l   D1                       ; D1 = sext(bitmap)
 *   00028644  and.l   D1,D0                    ; D0 = (1<<D2) & bitmap
 *   00028646  beq.b   0x2868C                  ; bit non set → skip jsr
 *
 *   00028648  tst.b   D2
 *   0002864A  beq.b   0x28654                  ; D2 == 0 → arg = 0x2000
 *   0002864C  move.l  #0x2400,D0               ; D2 != 0 → arg = 0x2400
 *   00028652  bra.b   0x2865A
 *   00028654  move.l  #0x2000,D0               ; arg6
 *   0002865A  move.l  D0,-(SP)                 ; push arg6 long
 *   0002865C  pea     7.w                      ; push 7 (arg5)
 *   00028660  pea     2.w                      ; push 2 (arg4)
 *
 *   00028664  move.b  D2,D0                    ; D0 = D2
 *   00028666  ext.w   D0
 *   00028668  ext.l   D0
 *   0002866A  movea.l #0x23D3A,A0              ; A0 = ROM table base
 *   00028670  move.b  (0,A0,D0.l*1),D0         ; D0.b = ROM[0x23D3A + D2]
 *   00028674  ext.w   D0
 *   00028676  ext.l   D0
 *   00028678  move.l  D0,-(SP)                 ; push arg3 long (ROM lookup)
 *   0002867A  pea     2.w                      ; push 2 (arg2)
 *   0002867E  move.l  (0xBC,A2),-(SP)          ; push arg1: *(A2+0xBC) long
 *   00028682  jsr     0x28E3C.l                ; render-string helper
 *   00028688  lea     (0x18,SP),SP             ; cleanup 24 byte = 6 long
 *
 *   ; ── tail iterazione (eseguito anche se bit non set, target di beq) ─
 *   0002868C  move.l  A2,D3
 *   0002868E  addi.l  #0xE2,D3                 ; D3 = A2 + 0xE2 (next obj)
 *   00028694  movea.l D3,A2                    ; A2 = next obj
 *   00028696  addq.b  #1,D2                    ; ++D2
 *
 *   ; ── condizione di loop ─────────────────────────────────────────────
 *   00028698  move.b  D2,D0
 *   0002869A  ext.w   D0
 *   0002869C  cmp.w   (0x400396).l,D0          ; D0w == count?
 *   000286A2  bne.b   0x28634                  ; D2 != count → continua
 *
 *   ; ── epilogo ────────────────────────────────────────────────────────
 *   000286A4  clr.b   (0x40039C).l             ; bitmap → 0
 *   000286AA  movem.l (SP)+,{A2 D3 D2}         ; restore 12 byte
 *   000286AE  rts
 *
 * **Stride / convenzioni**:
 *   - A2 base = 0x400018 (= work RAM offset 0x18, OBJECTS_BASE_OFF in
 *     `game-tick-timers.ts`) e stride 0xE2 (OBJECT_STRIDE). Identico al
 *     loop di `FUN_28A96` → stesso array di object struct.
 *   - count = word @ 0x400396 (OBJECT_COUNT_OFF). cmp.w D0w → confronto
 *     signed; con count piccolo (< 128) D2 byte sext.w è semplice cast.
 *   - bitmap byte @ 0x40039C: contiene fino a 8 bit di "dirty slot",
 *     uno per indice obj 0..7. Più di 8 obj → i bit > 7 non possono
 *     mai matchare (1<<D2 in long ha 0 nei 24 bit alti, ma asl.l con
 *     D2>=32 wrap → byte zero esteso, bit alti non set in `bitmap`).
 *     Il binario è coerente: count effettivo > 8 → solo i primi 8 obj
 *     possono avere bit in bitmap.
 *   - ROM table @ 0x23D3A: byte table indexed by D2 (sign-extended).
 *     Primi 6 byte: 0x03 0x20 0x13 0x0D 0x19 0x13. Il payload viene
 *     passato come long sign-extended a `FUN_28E3C`.
 *
 * **JSR sub injection**: `FUN_28E3C` è una sub-call esterna pesante (chiama
 * `FUN_112` → trampoline a 0x3874 + cond. `FUN_28F28` + `FUN_28F62` → render
 * string chain). La replicheremo come callback iniettabile, default no-op.
 *
 * **Effetti diretti del modulo**:
 *   1. `state.workRam[0x39c] = 0` (clear unconditionale alla fine)
 *   2. invocazioni di `renderStringHelper` (FUN_28E3C) per ogni bit set in
 *      bitmap[0..count-1], in ordine D2 = 0..count-1.
 *
 * **Verifica bit-perfect** via `packages/cli/src/test-obj-dirty-dispatch-28624-parity.ts`
 * patcha FUN_28E3C con `addq.b #1, sentinel.l ; rts` e conta hit (popcount
 * della bitmap mascherata su `[0..min(count, 8)-1]`).
 */

import type { GameState } from "./state.js";

// ─── Address constants (workRam offsets) ────────────────────────────────

/** Base byte degli object struct (assoluto 0x400018). Identico a OBJECTS_BASE_OFF
 *  di `game-tick-timers.ts`. */
export const OBJECTS_BASE_OFF = 0x18 as const;
/** Stride byte tra object struct adiacenti (= OBJECT_STRIDE). */
export const OBJECT_STRIDE = 0xe2 as const;
/** Word count obj attivi (assoluto 0x400396). */
export const OBJECT_COUNT_OFF = 0x396 as const;
/** Byte bitmap "dirty slot" (assoluto 0x40039C). */
export const DIRTY_BITMAP_OFF = 0x39c as const;
/** Offset all'interno dello struct dell'obj per il long passato come arg1. */
export const OBJ_ARG1_OFF = 0xbc as const;
/** Indirizzo ROM della byte table indexed by D2. */
export const ROM_TABLE_ADDR = 0x00023d3a as const;
/** Offset entry binario per cross-reference. */
export const FUN_28624_ADDR = 0x00028624 as const;

// ─── Sub injection ──────────────────────────────────────────────────────

/**
 * Callback per la sub-jsr `FUN_28E3C`. Riceve i 6 long arg nello stesso ordine
 * del binario (push-order rovesciato: arg1 è l'ultimo pushed, primo letto in
 * `(4,SP)` da FUN_28E3C dopo il movem.l di prologo).
 *
 * Args (matching binario):
 *   1. `arg1Long`  = `*(A2 + 0xBC)` long big-endian (struct field).
 *   2. `arg2Long`  = 2 (costante).
 *   3. `arg3Long`  = `sext_l(ROM[0x23D3A + D2])` (byte → long).
 *   4. `arg4Long`  = 2 (costante).
 *   5. `arg5Long`  = 7 (costante).
 *   6. `arg6Long`  = (D2 == 0) ? 0x2000 : 0x2400.
 */
export type RenderStringHelperFn = (
  state: GameState,
  arg1Long: number,
  arg2Long: number,
  arg3Long: number,
  arg4Long: number,
  arg5Long: number,
  arg6Long: number,
) => void;

/**
 * Bag delle sub injettabili. `FUN_28E3C` è l'unica jsr esterna del corpo.
 */
export interface ObjDirtyDispatch28624Subs {
  /** `FUN_00028E3C` — render-string helper. Default: no-op. */
  renderStringHelper?: RenderStringHelperFn;
}

// ─── Helpers ────────────────────────────────────────────────────────────

/** Legge il count word big-endian da `state.workRam[0x396..0x397]`. */
function readObjectCount(state: GameState): number {
  const r = state.workRam;
  return (((r[OBJECT_COUNT_OFF] ?? 0) << 8) | (r[OBJECT_COUNT_OFF + 1] ?? 0)) &
    0xffff;
}

/** Legge il long big-endian a `state.workRam[off..off+3]`. */
function readWorkLongBE(state: GameState, off: number): number {
  const r = state.workRam;
  return (
    (((r[off] ?? 0) << 24) |
      ((r[off + 1] ?? 0) << 16) |
      ((r[off + 2] ?? 0) << 8) |
      (r[off + 3] ?? 0)) >>>
    0
  );
}

/**
 * ROM table @ 0x23D3A — byte values indexed by D2 (sign-extended a long
 * dal binario). Esposta come `Uint8Array` opzionale (default: i 16 byte
 * letti dal ROM blob, 0x03 0x20 0x13 0x0D 0x19 0x13 0x30 0x00 0x2C 0x00
 * 0x28 0x00 0x24 0x00 0x20 0x00). Per testing useremo i byte letti
 * dinamicamente dal ROM image.
 *
 * Default safe: 16 byte zero (il chiamante deve fornire i byte reali se
 * lo `renderStringHelper` callback ne dipende).
 */
export type Rom23D3ATable = Uint8Array | readonly number[];

// ─── Funzione principale ────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00028624`.
 *
 * Itera D2 = 0..count-1 (count = word @ 0x400396). Per ogni indice testa il
 * bit `1<<D2` nella bitmap byte @ 0x40039C: se set, chiama
 * `renderStringHelper` con i 6 long arg derivati. A loop completato, azzera
 * la bitmap.
 *
 * **Side effects**:
 *   - `state.workRam[0x39C] = 0` (clear finale).
 *   - Ogni iter con bit set invoca la callback (ordine D2 = 0..count-1).
 *
 * **NB sull'asl.l con D2 >= 32**: il M68k mascherasta lo shift count a 6 bit
 * (asl.l con conteggio 32..63 produce 0). In pratica `count` è sempre
 * piccolo e `D2` non raggiunge mai 32; replichiamo comunque il
 * comportamento logico (`(1 << (D2 & 31)) >>> 0` su 32 bit).
 *
 * @param state   GameState (work RAM mutata).
 * @param romTab  Byte table @ ROM 0x23D3A indexed by D2. Lettura solo
 *                degli indici 0..count-1.
 * @param subs    Bag callback. Default: no-op.
 */
export function objDirtyDispatch28624(
  state: GameState,
  romTab: Rom23D3ATable,
  subs: ObjDirtyDispatch28624Subs = {},
): void {
  const r = state.workRam;
  const count = readObjectCount(state);
  const bitmap = r[DIRTY_BITMAP_OFF] ?? 0;
  // sext.b → long. In TS basta zero-extend perché useremo solo low bits via &.
  // Equivalente al pattern del binario: `move.b → ext.w → ext.l`. Il segno
  // serve all'AND a 32 bit, ma `1<<D2` è positivo (per D2<31), quindi
  // l'AND su 8 bit basta per i bit utili.
  const bitmap32 = ((bitmap & 0x80) !== 0
    ? bitmap | 0xffffff00
    : bitmap) >>> 0;

  // Loop D2 = 0..count-1.
  for (let d2 = 0; d2 < count; d2++) {
    // mask = 1 << (d2 & 31), zero-extended a 32 bit (= asl.l).
    const mask = ((1 << (d2 & 31)) >>> 0) & 0xffffffff;
    const hit = (mask & bitmap32) >>> 0;
    if (hit !== 0) {
      // arg6 = (D2 == 0) ? 0x2000 : 0x2400.
      const arg6 = d2 === 0 ? 0x2000 : 0x2400;
      // arg3 = sext_l(byte ROM[0x23D3A + D2]).
      const tabByte =
        romTab instanceof Uint8Array
          ? (romTab[d2] ?? 0)
          : (romTab[d2] ?? 0) & 0xff;
      const arg3 = (tabByte & 0x80 ? tabByte | 0xffffff00 : tabByte) | 0;
      // arg1 = *(A2 + 0xBC) long BE. A2 = 0x400018 + d2 * 0xE2.
      const objOff = OBJECTS_BASE_OFF + d2 * OBJECT_STRIDE;
      const arg1 = readWorkLongBE(state, objOff + OBJ_ARG1_OFF);

      subs.renderStringHelper?.(state, arg1, 2, arg3, 2, 7, arg6);
    }
  }

  // Epilogo: clr.b *0x40039C (incondizionato).
  r[DIRTY_BITMAP_OFF] = 0;
}

/**
 * Re-export del simbolo come "FUN_00028624" per mappatura esplicita
 * binario→TS.
 */
export { objDirtyDispatch28624 as FUN_00028624 };
