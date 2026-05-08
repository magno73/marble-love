/**
 * helper-2548.ts — replica `FUN_00002548` (10 byte, 0x002548-0x002558).
 *
 * **Disasm 0x2548..0x2558** (10 byte, leaf, 11 callers):
 *
 *   00002548    lsr    (0x00400006).l   ; word @ 0x400006 >>= 1; carry = old bit 0
 *   0000254e    bcc.w  0x00002556       ; branch if carry clear → return 0
 *   00002552    moveq  0x1,D0           ; carry set → D0 = 1
 *   00002554    rts
 *   00002556    clr.l  D0              ; carry clear → D0 = 0
 *   00002558    rts
 *
 * **Semantica**: estrae il bit 0 del word a `0x400006` (workRam offset `0x0006`),
 * shifta il word di 1 a destra (LSR.W) scrivendo il risultato in memoria, e
 * ritorna 1 se il bit estratto era 1, 0 altrimenti.
 *
 * Tutti i callers lo usano come spin-wait su flag:
 *   ```
 *   jsr   0x00002548.l
 *   tst.l D0
 *   beq   <loop back>
 *   ```
 * ovvero: "aspetta finché bit 0 di *0x400006 è 1, poi consuma quel bit".
 *
 * **Callers** (11):
 *   - 0x0010c6, 0x0011bc, 0x0012fc, 0x00156c, 0x00165e, 0x00166e,
 *     0x0019c4, 0x001e12, 0x001e22, 0x002314, e altri
 *
 * In TS è modellato come pure function: nessuno stato nascosto, side-effect
 * esclusivamente su `state.workRam[0x0006..0x0007]`.
 */

import type { GameState } from "./state.js";

/** workRam base address del word LSR flag @ 0x400006. */
export const HELPER_2548_ADDR = 0x00002548 as const;

/** Offset workRam del word LSR flag (0x400006 - 0x400000). */
export const LSR_FLAG_OFF = 0x0006 as const;

/**
 * Replica `FUN_00002548` — LSR.W su *0x400006, ritorna bit estratto (0 o 1).
 *
 * Legge il word big-endian a `workRam[0x0006..0x0007]`, shifta destra di 1
 * (logicamente, 16 bit), riscrive il risultato, e ritorna il bit 0 estratto.
 *
 * @param state  GameState: `state.workRam[0x0006..0x0007]` mutato.
 * @returns      1 se il bit 0 era set (carry), 0 altrimenti. Corrisponde a D0
 *               nel 68010 al momento dell'RTS.
 */
export function helper2548(state: GameState): number {
  const r = state.workRam;

  // Leggi word BE a offset 0x0006
  const hi = r[LSR_FLAG_OFF] ?? 0;
  const lo = r[LSR_FLAG_OFF + 1] ?? 0;
  const word = ((hi << 8) | lo) & 0xffff;

  // LSR.W 1: shift right logicamente di 1 posizione; carry = vecchio bit 0
  const carry = word & 1;
  const shifted = (word >>> 1) & 0xffff;

  // Riscrivi word BE
  r[LSR_FLAG_OFF] = (shifted >>> 8) & 0xff;
  r[LSR_FLAG_OFF + 1] = shifted & 0xff;

  // Ritorna 1 (non-zero → carry era set) o 0 (carry era clear)
  return carry !== 0 ? 1 : 0;
}

export { helper2548 as FUN_00002548 };
