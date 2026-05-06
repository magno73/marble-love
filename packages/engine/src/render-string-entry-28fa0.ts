/**
 * render-string-entry-28fa0.ts — replica `FUN_00028FA0` (62 byte).
 *
 * Helper "set-string-entry-and-render2": aggiorna i due byte testa di un
 * string-chain entry fisso @ `0x40041C` (col + tickOff), azzera il marker
 * @ `+6`, poi chiama una seconda routine di rendering (`jsr 0x200` →
 * `FUN_3520`) con `(entryPtr, arg3Long)`.
 *
 * Stesso *shape* di `FUN_28FDE` (vedi `render-string-entry-28fde.ts`), ma:
 *   - entry @ `0x40041C` (workRam off `0x41C`), non `0x400434`.
 *   - 3 args long invece di 2: arg1/arg2 → byte writes, arg3 → seconda jsr.
 *   - seconda jsr passa `arg3Long` (no constant `0x3400`).
 *   - seconda jsr a `0x200.l` → `FUN_3520` (non `FUN_2572`).
 *
 * **Layout entry @ `0x40041C`** (workRam off `0x41C`, stessa struttura della
 * string-chain entry definita in `string-render.ts`):
 *
 *   +0  byte  : col (colonna in tile units)
 *   +1  byte  : tick offset
 *   +2  long  : pointer alla stringa (NON modificato qui — persistente)
 *   +6  byte  : marker (per chain end check) — viene azzerato qui
 *   +8  long  : pointer alla next entry (NON modificato qui)
 *
 * **Disasm 0x28FA0..0x28FDE** (62 byte):
 *
 *   move.l D2,-(SP)            ; salva D2 (callee-save)
 *   move.w (0xa,SP),D1w        ; D1.w = arg1 low word (long arg @ SP+8 → low word @ SP+0xA)
 *   move.w (0xe,SP),D0w        ; D0.w = arg2 low word (long arg @ SP+0xC → +0xE)
 *   move.w (0x12,SP),D2w       ; D2.w = arg3 low word (long arg @ SP+0x10 → +0x12)
 *   ext.l  D0                  ; sign-extend arg2.w → arg2.l
 *   move.l D0,-(SP)            ; push arg2_ext.l
 *   move.w D1w,D0w
 *   ext.l  D0                  ; sign-extend arg1.w → arg1.l
 *   move.l D0,-(SP)            ; push arg1_ext.l
 *   pea    (0x40041C).l        ; push entry pointer
 *   jsr    0x0000013c.l        ; → FUN_255A: byte writes (col, tickOff, clr marker)
 *     ; FUN_255A:
 *     ;   movea.l (0x4,SP),A0  ; A0 = 0x40041C
 *     ;   move.b  (0xb,SP),D1b ; D1.b = arg1_ext_l & 0xff = arg1Long & 0xff
 *     ;   move.b  (0xf,SP),D0b ; D0.b = arg2_ext_l & 0xff = arg2Long & 0xff
 *     ;   move.b  D1b,(A0)     ; entry[0] = col
 *     ;   move.b  D0b,(0x1,A0) ; entry[1] = tickOff
 *     ;   clr.b   (0x6,A0)     ; entry[6] = 0
 *     ;   rts
 *   move.w D2w,D0w
 *   ext.l  D0
 *   move.l D0,-(SP)            ; push arg3_ext.l
 *   pea    (0x40041C).l        ; push entry pointer
 *   jsr    0x00000200.l        ; → FUN_3520 (render variant)
 *   lea    (0x14,SP),SP        ; pop 20 byte (5 long: 3 push tra le jsr + 2 dopo)
 *   move.l (SP)+,D2            ; ripristina D2
 *   rts
 *
 * **Note sullo stack**:
 *   - dopo `pea 0x40041C; jsr 0x13C` lo stack contiene 12 byte residui
 *     (entryPtr + arg1L + arg2L) perché `FUN_255A` non li pop-pa.
 *   - la seconda `jsr 0x200` aggiunge `pea 0x40041C; pea arg3` → 8 byte
 *     in più → 20 byte totali pre-`jsr 0x200`.
 *   - `lea (0x14,SP),SP` (0x14 = 20) li libera tutti dopo il return finale.
 *
 * **Args**:
 *   - `arg1Long`: long pushato dal caller; solo `arg1Long & 0xff` finisce in
 *     `entry[0]` (col). Path bin: word → ext.l → push long → byte read di
 *     SP+0xb estrae il low byte. ext.l preserva il low byte → equivalente a
 *     `arg1Long & 0xff` quando `arg1Long & 0xffff` è la low word del long
 *     pushato dal caller (vedi `state-sub-2c60.ts` per la stessa convenzione).
 *   - `arg2Long`: idem → `entry[1]` (tickOff).
 *   - `arg3Long`: long pushato dal caller; il binario fa `move.w (SP+0x12),D2w;
 *     ext.l D2; push D2.l`. La routine target `FUN_3520` legge poi
 *     `move.w (0x2a,SP),D2w` → solo la low word è semanticamente usata. Per
 *     simmetria con la convenzione "arg long con low word effettiva",
 *     accettiamo `arg3Long` e propaghiamo `arg3Long_ext_l` allo stub
 *     (sign-extend della low word, equivalente a quel che farebbe il binario).
 *
 * **Effetti**:
 *   1. `state.workRam[0x41C] = arg1Long & 0xff`   (col)
 *   2. `state.workRam[0x41D] = arg2Long & 0xff`   (tickOff)
 *   3. `state.workRam[0x422] = 0`                 (marker)
 *   4. invoca `subs.renderStringChain2(state, 0x40041C, arg3LongExtL)` (via stub).
 *
 * **JSR sub injection**: `FUN_255A` è inline-replicato (3 byte writes,
 * deterministico — niente da iniettare). `FUN_3520` è sub-call esterna,
 * esposta via `RenderStringEntry28FA0Subs.renderStringChain2` (default
 * no-op). In smoke test si lascia no-op, in parity test si patcha la sub
 * binaria a `rts` e si confronta solo lo state pre-render (i 3 byte di
 * entry @ 0x41C/0x41D/0x422).
 *
 * **Differenza rispetto a FUN_28FDE**:
 *   - FUN_28FDE: 2 args, entry @ 0x434, seconda jsr a FUN_2572 con const 0x3400.
 *   - FUN_28FA0: 3 args, entry @ 0x41C, seconda jsr a FUN_3520 con arg3.
 */

import type { GameState } from "./state.js";

/** Indirizzo assoluto della string-chain entry fissa cabled in FUN_28FA0. */
const ENTRY_ABS_ADDR = 0x0040041c as const;

/** Offset entry in `state.workRam` (= ENTRY_ABS_ADDR - 0x400000). */
export const ENTRY_OFF = 0x41c as const;

/** Sub-offset campi entry (rispetto a ENTRY_OFF). */
export const COL_BYTE_OFF = 0 as const;
export const TICKOFF_BYTE_OFF = 1 as const;
export const MARKER_BYTE_OFF = 6 as const;

/** Indirizzo entry usato come arg1 della render call. */
export const RENDER_STRUCT_ADDR = ENTRY_ABS_ADDR;

/**
 * Sign-extend di una word (16 bit, signed) in long (32 bit, signed) — replica
 * dell'istruzione M68k `ext.l` su un valore già "low word" (D0w → D0.l).
 *
 * Equivale a: `(value << 16) >> 16` (ma con normalizzazione esplicita unsigned).
 *
 * Per `arg3Long`: il binario fa `move.w (...,SP),D2w` (low word) poi `ext.l D2`,
 * quindi pusha il long sign-extended. La low word del long pushato è la stessa
 * di `arg3Long & 0xffff`, e il bit alto è replicato dal bit 15. Il chiamato
 * (`FUN_3520`) legge poi `move.w (0x2a,SP),D2w` cioè la low word del long → di
 * nuovo `arg3Long & 0xffff`. Quindi *semanticamente* solo la low word conta;
 * questa funzione esiste per documentare la propagazione binaria esatta del
 * valore long allo stub di renderStringChain2.
 */
function extLowWordToLong(value: number): number {
  const w = value & 0xffff;
  // Sign-extend bit 15.
  return (w & 0x8000) !== 0 ? (w | 0xffff0000) >>> 0 : w >>> 0;
}

/**
 * Stub injection per la JSR a `FUN_3520`. `FUN_255A` è inline-replicato
 * (deterministico, niente da iniettare).
 */
export interface RenderStringEntry28FA0Subs {
  /**
   * `FUN_3520` — render string chain (variante 2). Default no-op.
   *
   * Args (matching binario): `(structAddr, arg3LongExtL)`. Il caller futuro
   * dovrebbe wirare a una `string-render`-like routine.
   *
   * `arg3LongExtL` è il sign-extend della low word di `arg3Long` originale —
   * esattamente il long che il binario pusha a SP+0x28 prima della jsr.
   */
  renderStringChain2?: (structAddr: number, arg3LongExtL: number) => void;
}

/**
 * Replica bit-perfect di `FUN_00028FA0`.
 *
 * Aggiorna 3 byte della string-chain entry fissa @ `0x40041C` (col, tickOff,
 * marker=0), poi invoca `renderStringChain2(0x40041C, arg3LongExtL)` via stub.
 *
 * @param state     GameState (modifica `workRam[0x41C]`, `[0x41D]`, `[0x422]`).
 * @param arg1Long  long arg1 (caller stack); solo `& 0xff` usato → `entry[0]` (col).
 * @param arg2Long  long arg2 (caller stack); solo `& 0xff` usato → `entry[1]` (tickOff).
 * @param arg3Long  long arg3 (caller stack); low word sign-extended → secondo
 *                  arg di `renderStringChain2`.
 * @param subs      stub injection per `renderStringChain2` (default no-op).
 *
 * **Side effects** in `state.workRam`:
 *   - `[ENTRY_OFF + 0]   = arg1Long & 0xff`   (col byte)
 *   - `[ENTRY_OFF + 1]   = arg2Long & 0xff`   (tickOff byte)
 *   - `[ENTRY_OFF + 6]   = 0`                 (marker clear)
 *   - chiamata a `subs.renderStringChain2(0x40041C, ext.l(arg3Long.w))` dopo
 *     i tre byte write.
 *
 * **Nessun return value rilevante**: il binario fa `rts` lasciando D0 = quanto
 * restituito da `FUN_3520`, ma il caller `FUN_28EB2` ignora il return. Firma
 * TS è `void`.
 */
export function renderStringEntry28FA0(
  state: GameState,
  arg1Long: number,
  arg2Long: number,
  arg3Long: number,
  subs?: RenderStringEntry28FA0Subs,
): void {
  const r = state.workRam;

  // FUN_255A inline: 3 byte writes deterministici sull'entry @ 0x40041C.
  // - `move.b D1b,(A0)`     : entry[0] = LSB di arg1 ext_l = arg1Long & 0xff
  // - `move.b D0b,(0x1,A0)` : entry[1] = LSB di arg2 ext_l = arg2Long & 0xff
  // - `clr.b  (0x6,A0)`     : entry[6] = 0
  r[ENTRY_OFF + COL_BYTE_OFF] = arg1Long & 0xff;
  r[ENTRY_OFF + TICKOFF_BYTE_OFF] = arg2Long & 0xff;
  r[ENTRY_OFF + MARKER_BYTE_OFF] = 0;

  // FUN_3520 (renderStringChain2): chiamata via stub injection.
  // Args: (structAddr=0x40041C, arg3LongExtL=ext.l(arg3Long & 0xffff)).
  const arg3ExtL = extLowWordToLong(arg3Long);
  subs?.renderStringChain2?.(RENDER_STRUCT_ADDR, arg3ExtL);
}
