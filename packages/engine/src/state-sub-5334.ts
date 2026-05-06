/**
 * state-sub-5334.ts — replica `FUN_00005334` (42 byte).
 *
 * Trampoline a 1 long argomento. Legge due byte da work RAM (`0x00401F98` e
 * `0x00401F99`), li sign-extend a long (32 bit), e li passa — INSIEME al long
 * argomento ricevuto dal caller — come 3 argomenti a `FUN_000052DA`.
 *
 * Layout chiamata interna (RTL push, M68k stack-args ABI):
 *   FUN_52DA( signExt32(byte @ 0x401F98),    // arg1 (long)
 *             signExt32(byte @ 0x401F99),    // arg2 (long)
 *             argLong )                      // arg3 (long, pass-through)
 *
 * Il `D0` ritornato è pass-through del valore che `FUN_52DA` lascia in `D0`
 * (la `lea (0xC,SP),SP` non tocca D0; nessun `movem`/`unlk` qui — `FUN_5334`
 * non ha link-frame proprio).
 *
 * **Disasm 0x5334..0x535D** (42 byte = 0x2A):
 *
 *   move.l (0x4,SP),D0           ; D0 = argLong (caller ha pushed long arg)
 *   move.l D0,-(SP)              ; push arg3 (argLong)
 *   move.b (0x00401F99).l,D0b    ; D0b = byte @ 0x401F99
 *   ext.w  D0w                   ; sign-extend byte→word
 *   ext.l  D0                    ; sign-extend word→long
 *   move.l D0,-(SP)              ; push arg2 (signExt32 byte 0x401F99)
 *   move.b (0x00401F98).l,D0b    ; D0b = byte @ 0x401F98
 *   ext.w  D0w
 *   ext.l  D0
 *   move.l D0,-(SP)              ; push arg1 (signExt32 byte 0x401F98)
 *   jsr    0x000052DA.l          ; chiama FUN_52DA(arg1, arg2, arg3)
 *   lea    (0xC,SP),SP           ; pop 3 long arg (12 byte) — NON tocca D0
 *   rts                          ; ritorna D0 = ret di FUN_52DA
 *
 * **Sign-extension**: `ext.w` su byte signed (-128..127) → word con stesso
 * valore signed; `ext.l` da word → long. In TS replicato come
 * `(byte << 24) >> 24` (sign-extend a int32) → indi unsigned-cast (`>>> 0`).
 *
 * **JSR target `FUN_000052DA`** (39 byte): non replicata in questo modulo.
 * Esposta come callback `inner` (default `() => 0`) per:
 *   - test della sola logica di lettura/sign-extend/forward,
 *   - integrazione futura con la replica TS di FUN_52DA quando porteremo
 *     quel sub-system (al momento il differential test usa la versione
 *     binaria via Musashi).
 *
 * **Side effects**:
 *   - In QUESTO modulo: nessuno. Il wrapper non scrive workRam, non tocca
 *     MMIO, non altera RNG.
 *   - Tutti gli effetti reali (incluse scritture a `0x401F98`/`0x401F99`,
 *     work RAM @ `+0x80..` e similari) sono dentro `FUN_52DA` e vengono
 *     gestiti separatamente dalla sua replica futura.
 *
 * **Convenzione caller** (osservabile sui callsite reali — non rilevato in
 * questa fase per via di project lock di Ghidra; documentazione futura):
 *   - argLong è tipicamente un puntatore o long handle. La firma esatta di
 *     FUN_52DA suggerisce due "small int" + un long → potrebbe essere un
 *     dispatch per slot/indice composto, ma la conferma richiede analisi
 *     dei callsite: trasparente per la parità di QUESTO wrapper, che la
 *     replica esattamente.
 *
 * Verifica bit-perfect via `cli/src/test-state-sub-5334-parity.ts` con
 * `inner` stub che cattura i 3 argomenti che il binario passa a FUN_52DA.
 */

import type { GameState } from "./state.js";

// ─── Indirizzi MMIO/work RAM ─────────────────────────────────────────────

/** Base assoluta della work RAM (M68k: 0x400000..0x401FFF, 8 KB). */
const WORK_RAM_BASE = 0x00400000;

/** Indirizzo assoluto del primo byte letto: arg1 di FUN_52DA. */
export const ARG1_BYTE_ADDR = 0x00401f98 as const;

/** Indirizzo assoluto del secondo byte letto: arg2 di FUN_52DA. */
export const ARG2_BYTE_ADDR = 0x00401f99 as const;

// ─── Tipi ────────────────────────────────────────────────────────────────

/**
 * Signature del callee `FUN_000052DA`. Riceve 3 long unsigned (0..0xFFFFFFFF):
 *   - `arg1` = signExt32 del byte @ 0x401F98
 *   - `arg2` = signExt32 del byte @ 0x401F99
 *   - `arg3` = argLong pass-through dal caller di FUN_5334
 *
 * Ritorna un long che diventa il D0 di ritorno di FUN_5334.
 */
export type Sub5334Inner = (
  arg1: number,
  arg2: number,
  arg3: number,
) => number;

// ─── Utility: sign-extend byte → int32 ───────────────────────────────────

/**
 * Sign-extend un byte (0..0xFF) al long M68k (int32 a 32 bit), ritornato
 * come unsigned 32-bit (0..0xFFFFFFFF).
 *
 * Sequenza M68k:
 *   `move.b ...,D0b`        → D0 lower-byte = byte (D0 high preserved? No: in
 *                              realtà M68k `move.b` to data reg lascia gli
 *                              altri 24 bit invariati — ma qui il caller fa
 *                              SUBITO `ext.w` che rigenera D0w da D0b
 *                              sign-extending, quindi il valore high prima
 *                              non conta).
 *   `ext.w D0w`             → D0w = signExt(D0b)  (word, 16 bit)
 *   `ext.l D0`              → D0  = signExt(D0w)  (long, 32 bit)
 *
 * Risultato netto: byte signed → int32 signed → unsigned32.
 *   byte 0x00 → 0x00000000
 *   byte 0x01 → 0x00000001
 *   byte 0x7F → 0x0000007F
 *   byte 0x80 → 0xFFFFFF80
 *   byte 0xFF → 0xFFFFFFFF
 */
function signExtByteToU32(b: number): number {
  // `(x << 24) >> 24` sign-extends il byte basso a int32; `>>> 0` lo cast
  // a unsigned32 senza alterare la rappresentazione bit-perfect.
  return (((b & 0xff) << 24) >> 24) >>> 0;
}

// ─── Replica ──────────────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00005334` — trampoline 1-arg → FUN_52DA.
 *
 * @param state    GameState (legge i due byte @ 0x401F98 / 0x401F99 da workRam).
 * @param argLong  Long argomento del caller (qualunque uint32). Pass-through
 *                 come arg3 a `inner`.
 * @param inner    Callback che modella `FUN_00005334`'s callee `FUN_000052DA`.
 *                 Default `() => 0` (no-op compatibile col ritorno tipico
 *                 quando il sub-system non è inizializzato).
 *                 Riceve `(arg1, arg2, arg3)` tutti come uint32.
 * @returns        D0 unsigned32 = pass-through del valore ritornato da `inner`.
 *
 * Note di low-level fidelity:
 *   - I due byte sono letti CON sign-extension: byte 0x80..0xFF diventano
 *     0xFFFFFF80..0xFFFFFFFF (NON 0x00000080..0x000000FF). È il comportamento
 *     dell'`ext.w`/`ext.l` M68k.
 *   - L'ordine di lettura nel binario è: prima `0x401F99` (push come arg2),
 *     poi `0x401F98` (push come arg1). Modelliamo la stessa sequenza per
 *     riferimento — anche se sull'osservabile (i 3 valori passati a `inner`)
 *     l'ordine di lettura non importa, dato che le due locazioni sono
 *     indipendenti.
 *   - La `lea (0xC,SP),SP` post-jsr NON tocca D0 → il valore di ritorno è
 *     esattamente quello di `inner` (clamped a uint32).
 *   - Il wrapper non ha frame `link/unlk` né salvataggio registri (non usa
 *     D2..D7 / A2..A6 oltre a quelli del callee).
 */
export function stateSub5334(
  state: GameState,
  argLong: number,
  inner: Sub5334Inner = () => 0,
): number {
  // Legge byte @ 0x401F99 (arg2) e @ 0x401F98 (arg1) dal workRam.
  const off98 = (ARG1_BYTE_ADDR - WORK_RAM_BASE) >>> 0; // 0x1F98
  const off99 = (ARG2_BYTE_ADDR - WORK_RAM_BASE) >>> 0; // 0x1F99

  const byte98 = state.workRam[off98] ?? 0;
  const byte99 = state.workRam[off99] ?? 0;

  // Sign-extend byte → unsigned32 (rispetta `ext.w`/`ext.l` M68k).
  const arg1 = signExtByteToU32(byte98);
  const arg2 = signExtByteToU32(byte99);
  const arg3 = argLong >>> 0;

  // Tail-call al callee con i 3 long preparati.
  return inner(arg1, arg2, arg3) >>> 0;
}
