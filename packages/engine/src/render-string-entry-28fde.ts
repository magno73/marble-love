/**
 * render-string-entry-28fde.ts — replica `FUN_00028FDE` (52 byte).
 *
 * Helper "set-string-entry-and-render": aggiorna i due byte testa di un
 * string-chain entry fisso @ `0x400434` (col + tickOff), azzera il marker
 * @ `+6`, poi chiama `renderStringChain` (`FUN_2572`) con `attr = 0x3400`.
 *
 * **Layout entry @ `0x400434`** (workRam off `0x434`, vedi `string-render.ts`):
 *
 *   +0  byte  : col (colonna in tile units)
 *   +1  byte  : tick offset
 *   +2  long  : pointer alla stringa (NON modificato qui — persistente)
 *   +6  byte  : marker (per chain end check) — viene azzerato qui
 *   +8  long  : pointer alla next entry (NON modificato qui)
 *
 * **Disasm 0x28FDE..0x29010** (52 byte):
 *
 *   move.w (0x6,SP),D1w        ; D1.w = arg1 low word
 *   move.w (0xa,SP),D0w        ; D0.w = arg2 low word
 *   ext.l  D0
 *   move.l D0,-(SP)            ; push arg2 ext_l
 *   move.w D1w,D0w
 *   ext.l  D0
 *   move.l D0,-(SP)            ; push arg1 ext_l
 *   pea    (0x400434).l        ; push entry pointer
 *   jsr    0x13C.l             ; → FUN_255A: byte writes (col, tickOff, clr marker)
 *     ; FUN_255A:
 *     ;   movea.l (0x4,SP),A0  ; A0 = 0x400434
 *     ;   move.b  (0xb,SP),D1b ; D1.b = arg1 ext_l low byte = arg1.w & 0xff
 *     ;   move.b  (0xf,SP),D0b ; D0.b = arg2 ext_l low byte = arg2.w & 0xff
 *     ;   move.b  D1b,(A0)     ; entry[0] = col
 *     ;   move.b  D0b,(0x1,A0) ; entry[1] = tickOff
 *     ;   clr.b   (0x6,A0)     ; entry[6] = 0
 *     ;   rts
 *   pea    (0x3400).w          ; push attr 0x3400 (long)
 *   pea    (0x400434).l        ; push entry pointer
 *   jsr    0x142.l             ; → FUN_2572 (renderStringChain)
 *   lea    (0x14,SP),SP        ; pop 20 byte (5 long)
 *   rts
 *
 * **Note sullo stack** (fra le due jsr):
 *   - dopo `pea 0x400434; jsr 0x13C` lo stack contiene 12 byte residui
 *     (ptr + arg1L + arg2L) perché `FUN_255A` non li pop-pa.
 *   - `pea 0x3400; pea 0x400434` aggiunge 8 byte → 20 byte totali pre-`jsr 0x142`.
 *   - `lea (0x14,SP),SP` (0x14 = 20) li libera tutti dopo il return finale.
 *
 * **Args**:
 *   - `arg1Long`: long pushato dal caller; solo `arg1.w & 0xff` (LSB del byte
 *     basso della low word) finisce in `entry[0]` (col).
 *   - `arg2Long`: long pushato dal caller; solo `arg2.w & 0xff` finisce in
 *     `entry[1]` (tickOff).
 *   Il path del binario: word → ext.l → push long → byte read di SP+0xb/0xf
 *   estrae il low byte. Equivalente a `arg1Long & 0xff` se `arg1Long & 0xffff`
 *   è la low word (le ext.l preservano il low byte). Per simmetria col formato
 *   "low word usata come argomento" (vedi `state-sub-2c60.ts`), accettiamo
 *   `argLong` e usiamo `argLong & 0xff` come byte effettivo.
 *
 * **Effetti**:
 *   1. `state.workRam[0x434] = arg1Long & 0xff`   (col)
 *   2. `state.workRam[0x435] = arg2Long & 0xff`   (tickOff)
 *   3. `state.workRam[0x43A] = 0`                 (marker)
 *   4. invoca `renderStringChain(state, rom, 0x400434, 0x3400)` (via stub).
 *
 * **JSR sub injection**: `FUN_255A` è inline-replicato (3 byte writes, totalmente
 * deterministico — niente da iniettare). `FUN_2572` (renderStringChain) è
 * sub-call esterna, esposta via `RenderStringEntry28FDESubs.renderStringChain`
 * (default no-op). In smoke test si lascia no-op, in parity test si patcha la
 * sub binaria a `rts` e si confronta solo lo state pre-render (i 3 byte di
 * entry @ 0x434/0x435/0x43A).
 */

import type { GameState } from "./state.js";

/** Indirizzo assoluto della string-chain entry fissa cabled in FUN_28FDE. */
const ENTRY_ABS_ADDR = 0x00400434 as const;

/** Offset entry in `state.workRam` (= ENTRY_ABS_ADDR - 0x400000). */
export const ENTRY_OFF = 0x434 as const;

/** Sub-offset campi entry (rispetto a ENTRY_OFF). */
export const COL_BYTE_OFF = 0 as const;
export const TICKOFF_BYTE_OFF = 1 as const;
export const MARKER_BYTE_OFF = 6 as const;

/** Attr cabled in FUN_28FDE per la chiamata a renderStringChain. */
export const RENDER_ATTR = 0x3400 as const;

/** Indirizzo entry usato come arg1 di renderStringChain. */
export const RENDER_STRUCT_ADDR = ENTRY_ABS_ADDR;

/**
 * Stub injection per la JSR a `FUN_2572` (renderStringChain). `FUN_255A` è
 * inline-replicato (deterministico, niente da iniettare).
 */
export interface RenderStringEntry28FDESubs {
  /**
   * `FUN_2572` — render string chain. Default no-op.
   *
   * Args (matching binario): `(structAddr, attrWord)`. Il caller futuro
   * dovrebbe wirare a `string-render.renderStringChain(state, rom, ...)`.
   */
  renderStringChain?: (structAddr: number, attrWord: number) => void;
}

/**
 * Replica bit-perfect di `FUN_00028FDE`.
 *
 * Aggiorna 3 byte della string-chain entry fissa @ `0x400434` (col, tickOff,
 * marker=0), poi invoca `renderStringChain(0x400434, 0x3400)` via stub.
 *
 * @param state     GameState (modifica `workRam[0x434]`, `[0x435]`, `[0x43A]`).
 * @param arg1Long  long arg1 (caller stack); solo `& 0xff` usato → `entry[0]` (col).
 * @param arg2Long  long arg2 (caller stack); solo `& 0xff` usato → `entry[1]` (tickOff).
 * @param subs      stub injection per `renderStringChain` (default no-op).
 *
 * **Side effects** in `state.workRam`:
 *   - `[ENTRY_OFF + 0]   = arg1Long & 0xff`   (col byte)
 *   - `[ENTRY_OFF + 1]   = arg2Long & 0xff`   (tickOff byte)
 *   - `[ENTRY_OFF + 6]   = 0`                 (marker clear)
 *   - chiamata a `subs.renderStringChain(0x400434, 0x3400)` dopo i tre write.
 *
 * **Nessun return value rilevante**: il binario fa `rts` senza valorizzare D0
 * (lascia D0 = quanto restituito da `renderStringChain` = 1, ma la firma TS
 * è `void` perché il caller `FUN_28E00` ignora il return).
 */
export function renderStringEntry28FDE(
  state: GameState,
  arg1Long: number,
  arg2Long: number,
  subs?: RenderStringEntry28FDESubs,
): void {
  const r = state.workRam;

  // FUN_255A inline: 3 byte writes deterministici sull'entry @ 0x400434.
  // - `move.b D1b,(A0)`     : entry[0] = LSB di arg1 ext_l = arg1Long & 0xff
  // - `move.b D0b,(0x1,A0)` : entry[1] = LSB di arg2 ext_l = arg2Long & 0xff
  // - `clr.b  (0x6,A0)`     : entry[6] = 0
  r[ENTRY_OFF + COL_BYTE_OFF] = arg1Long & 0xff;
  r[ENTRY_OFF + TICKOFF_BYTE_OFF] = arg2Long & 0xff;
  r[ENTRY_OFF + MARKER_BYTE_OFF] = 0;

  // FUN_2572 (renderStringChain): chiamata via stub injection.
  // Args: (structAddr=0x400434, attrWord=0x3400).
  subs?.renderStringChain?.(RENDER_STRUCT_ADDR, RENDER_ATTR);
}
