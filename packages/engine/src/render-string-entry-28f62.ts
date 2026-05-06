/**
 * render-string-entry-28f62.ts — replica `FUN_00028F62` (62 byte).
 *
 * Variante a **3 argomenti** della helper `FUN_00028FDE` (`render-string-entry-28fde.ts`):
 * stessa entry fissa @ `0x40041C` (NB: address differente da FUN_28FDE che usa
 * `0x400434`), stessa sequenza FUN_255A + FUN_2572, ma l'`attr` passato a
 * `renderStringChain` non è cabled a `0x3400` — viene letto dal **terzo** arg
 * del caller.
 *
 * **Layout entry @ `0x40041C`** (workRam off `0x41C`, identico in struttura
 * a quello a `0x400434`):
 *
 *   +0  byte  : col (colonna in tile units)
 *   +1  byte  : tick offset
 *   +2  long  : pointer alla stringa (NON modificato qui)
 *   +6  byte  : marker (per chain end check) — viene azzerato qui
 *   +8  long  : pointer alla next entry (NON modificato qui)
 *
 * **Disasm 0x28F62..0x28FA0** (62 byte):
 *
 *   move.l D2,-(SP)            ; salva D2 (scratch per arg3.w)
 *   move.w (0xa,SP),D1w        ; D1.w = arg1.low_word  (col)
 *   move.w (0xe,SP),D0w        ; D0.w = arg2.low_word  (tickOff)
 *   move.w (0x12,SP),D2w       ; D2.w = arg3.low_word  (attr)
 *   ext.l  D0
 *   move.l D0,-(SP)            ; push ext_l(arg2.w)
 *   move.w D1w,D0w
 *   ext.l  D0
 *   move.l D0,-(SP)            ; push ext_l(arg1.w)
 *   pea    (0x40041C).l        ; push entry pointer
 *   jsr    0x13C.l             ; → FUN_255A: byte writes (col, tickOff, marker=0)
 *     ; (vedi render-string-entry-28fde.ts per il disasm di FUN_255A,
 *     ;  inline-replicato come 3 byte writes deterministici)
 *   move.w D2w,D0w
 *   ext.l  D0
 *   move.l D0,-(SP)            ; push ext_l(arg3.w)  ← attr dinamico
 *   pea    (0x40041C).l        ; push entry pointer
 *   jsr    0x142.l             ; → FUN_2572 (renderStringChain)
 *   lea    (0x14,SP),SP        ; pop 20 byte (5 long)
 *   move.l (SP)+,D2            ; ripristina D2
 *   rts
 *
 * **Differenze rilevanti vs FUN_28FDE**:
 *   - struct address: `0x40041C` (vs `0x400434`)
 *   - 3 args invece di 2: il terzo è l'`attr` per `renderStringChain` (vs
 *     l'attr cabled a `0x3400`)
 *   - usa D2 come callee-saved scratch (vs nessuno scratch in FUN_28FDE)
 *
 * **Note sullo stack** (identico pattern di FUN_28FDE):
 *   - dopo la prima `pea + jsr` lo stack contiene 12 byte residui
 *     (FUN_255A non li pop-pa).
 *   - la seconda `pea + push arg3L + pea` aggiunge 8 byte → 20 byte totali
 *     pre-`jsr 0x142`.
 *   - `lea (0x14,SP),SP` libera tutti e 20.
 *
 * **Args**:
 *   - `arg1Long`: low word → ext.l → push → byte read da `(0xb,SP)` in FUN_255A
 *     ⇒ effettivo `arg1Long & 0xff` finisce in `entry[0]` (col).
 *   - `arg2Long`: come sopra, `arg2Long & 0xff` → `entry[1]` (tickOff).
 *   - `arg3Long`: low word → ext.l → push come long → `attr` arg di
 *     `renderStringChain`. Il binario in pratica usa solo i 16 bit bassi
 *     (sext-extended). Per simmetria col formato "low word usata come
 *     argomento" passiamo `arg3Long & 0xffff` come attr word.
 *
 * **Effetti**:
 *   1. `state.workRam[0x41C] = arg1Long & 0xff`   (col)
 *   2. `state.workRam[0x41D] = arg2Long & 0xff`   (tickOff)
 *   3. `state.workRam[0x422] = 0`                 (marker)
 *   4. invoca `renderStringChain(0x40041C, arg3Long & 0xffff)` (via stub).
 *
 * **JSR sub injection**: `FUN_255A` è inline-replicato (3 byte writes
 * deterministici). `FUN_2572` (renderStringChain) è sub-call esterna, esposta
 * via `RenderStringEntry28F62Subs.renderStringChain` (default no-op).
 *
 * **Callers** (xref):
 *   - `FUN_00028E3C` @ 0x28EA2 — chiamato con (col=arg3L, tickOff=arg2L,
 *     attr=arg4.w) come terzo step della pipeline `format-and-render-28e00`.
 *   - `FUN_00011FF8` @ 0x12130 — chiamato con (col=0xd, tickOff=ext_l(D4),
 *     attr=0x1000).
 */

import type { GameState } from "./state.js";

/** Indirizzo assoluto della string-chain entry fissa cabled in FUN_28F62. */
const ENTRY_ABS_ADDR = 0x0040041c as const;

/** Offset entry in `state.workRam` (= ENTRY_ABS_ADDR - 0x400000). */
export const ENTRY_OFF = 0x41c as const;

/** Sub-offset campi entry (rispetto a ENTRY_OFF). */
export const COL_BYTE_OFF = 0 as const;
export const TICKOFF_BYTE_OFF = 1 as const;
export const MARKER_BYTE_OFF = 6 as const;

/** Indirizzo entry usato come arg1 di renderStringChain. */
export const RENDER_STRUCT_ADDR = ENTRY_ABS_ADDR;

/**
 * Stub injection per la JSR a `FUN_2572` (renderStringChain). `FUN_255A` è
 * inline-replicato (deterministico, niente da iniettare).
 */
export interface RenderStringEntry28F62Subs {
  /**
   * `FUN_2572` — render string chain. Default no-op.
   *
   * Args (matching binario): `(structAddr, attrWord)`. Il caller futuro
   * dovrebbe wirare a `string-render.renderStringChain(state, rom, ...)`.
   */
  renderStringChain?: (structAddr: number, attrWord: number) => void;
}

/**
 * Replica bit-perfect di `FUN_00028F62`.
 *
 * Aggiorna 3 byte della string-chain entry fissa @ `0x40041C` (col, tickOff,
 * marker=0), poi invoca `renderStringChain(0x40041C, attr)` via stub. L'`attr`
 * è dinamico (terzo argomento), a differenza di FUN_28FDE dove è cabled a
 * `0x3400`.
 *
 * @param state     GameState (modifica `workRam[0x41C]`, `[0x41D]`, `[0x422]`).
 * @param arg1Long  long arg1; solo `& 0xff` usato → `entry[0]` (col).
 * @param arg2Long  long arg2; solo `& 0xff` usato → `entry[1]` (tickOff).
 * @param arg3Long  long arg3; solo `& 0xffff` usato → `attr` per renderStringChain.
 * @param subs      stub injection per `renderStringChain` (default no-op).
 *
 * **Side effects** in `state.workRam`:
 *   - `[ENTRY_OFF + 0]   = arg1Long & 0xff`   (col byte)
 *   - `[ENTRY_OFF + 1]   = arg2Long & 0xff`   (tickOff byte)
 *   - `[ENTRY_OFF + 6]   = 0`                 (marker clear)
 *   - chiamata a `subs.renderStringChain(0x40041C, arg3Long & 0xffff)`.
 */
export function renderStringEntry28F62(
  state: GameState,
  arg1Long: number,
  arg2Long: number,
  arg3Long: number,
  subs?: RenderStringEntry28F62Subs,
): void {
  const r = state.workRam;

  // FUN_255A inline: 3 byte writes deterministici sull'entry @ 0x40041C.
  // - entry[0] = LSB di arg1 ext_l = arg1Long & 0xff
  // - entry[1] = LSB di arg2 ext_l = arg2Long & 0xff
  // - entry[6] = 0 (clr.b)
  r[ENTRY_OFF + COL_BYTE_OFF] = arg1Long & 0xff;
  r[ENTRY_OFF + TICKOFF_BYTE_OFF] = arg2Long & 0xff;
  r[ENTRY_OFF + MARKER_BYTE_OFF] = 0;

  // FUN_2572 (renderStringChain): chiamata via stub injection.
  // Args: (structAddr=0x40041C, attrWord=arg3Long & 0xffff).
  // Il binario push-a ext_l(arg3.w) come long, ma la sub legge solo la low
  // word (cfr. disasm FUN_2572: `move.w (0x1e,SP),D2w` su attr).
  subs?.renderStringChain?.(RENDER_STRUCT_ADDR, arg3Long & 0xffff);
}
