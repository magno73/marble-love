/**
 * helper-28c38.ts — replica `FUN_00028C38` (23 istr, 0x44 byte).
 *
 * "Cascading timer tick": decrements a 3-level nested counter struct and
 * returns flag bits indicating which cascade levels fired.
 *
 * Struct layout (5 byte at `timerPtr`):
 *   +0..1: outerCounter  (u16 big-endian)
 *   +2:    mediumCounter (u8)
 *   +3:    (unused / padding byte, not touched)
 *   +4:    innerCounter  (u8)  — 0xFF = disabled
 *
 * **Disasm 0x28C38..0x28C7C** (23 istr):
 *
 *   00028c38  movea.l (0x4,SP),A0         ; A0 = timerPtr (stack arg)
 *   00028c3c  clr.b   D1b                 ; D1.b = 0 (result flags)
 *   00028c3e  cmpi.b  #-0x1,(0x4,A0)      ; inner == 0xFF ?
 *   00028c44  beq.b   0x00028c76          ; yes → disabled, skip all
 *   00028c46  subq.b  0x1,(0x4,A0)        ; inner -= 1
 *   00028c4a  tst.b   (0x4,A0)            ; inner signed
 *   00028c4e  bge.b   0x00028c76          ; inner >= 0 → no cascade
 *   00028c50  move.b  #0x5,(0x4,A0)       ; reset inner = 5
 *   00028c56  subq.b  0x1,(0x2,A0)        ; medium -= 1
 *   00028c5a  tst.b   (0x2,A0)            ; medium signed
 *   00028c5e  bge.b   0x00028c76          ; medium >= 0 → no outer cascade
 *   00028c60  move.b  #0x9,(0x2,A0)       ; reset medium = 9
 *   00028c66  subq.w  0x1,(A0)            ; outer word -= 1
 *   00028c68  moveq   -0x1,D0             ; D0 = 0xFFFFFFFF
 *   00028c6a  cmp.w   (A0),D0w            ; outer == 0xFFFF ?
 *   00028c6c  bne.b   0x00028c72          ; no → skip bit-0 flag
 *   00028c6e  ori.b   #0x1,D1b            ; D1 |= 1 (outer wrapped to −1)
 *   00028c72  ori.b   #0x2,D1b            ; D1 |= 2 (full cascade triggered)
 *   00028c76  move.b  D1b,D0b             ; return D1.b
 *   00028c78  ext.w   D0w                 ; sign-extend to word
 *   00028c7a  ext.l   D0                  ; sign-extend to long
 *   00028c7c  rts
 *
 * Return value (sign-extended to i32, but always 0..3 in practice):
 *   bit 0: outerCounter wrapped to 0xFFFF this call (decremented from 0)
 *   bit 1: full cascade fired (medium also wrapped, outer decremented)
 *   0:     no cascade (inner not expired, OR timer disabled)
 *
 * **Callers** (2):
 *   FUN_00028A96 @ 0x00028BF8  (main game-state update loop)
 *
 * Bit-perfect verificato 500/500 vs MAME/musashi-wasm.
 * (Parity: packages/cli/src/test-helper-28c38-parity.ts)
 */

import type { GameState } from "./state.js";
import {
  tickCascadingTimer,
  TIMER_OFFSET_OUTER,
  TIMER_OFFSET_MEDIUM,
  TIMER_OFFSET_INNER,
} from "./timer-cascade.js";

// ─── Address constant ──────────────────────────────────────────────────────

/** ROM address of `FUN_00028C38`. */
export const HELPER_28C38_ADDR = 0x00028c38 as const;

// ─── Re-export timer struct offsets for callers ────────────────────────────

/** Byte offset of the outer (u16 BE) counter within the timer struct. */
export { TIMER_OFFSET_OUTER as HELPER_28C38_OFFSET_OUTER };
/** Byte offset of the medium (u8) counter within the timer struct. */
export { TIMER_OFFSET_MEDIUM as HELPER_28C38_OFFSET_MEDIUM };
/** Byte offset of the inner (u8) counter within the timer struct. 0xFF = disabled. */
export { TIMER_OFFSET_INNER as HELPER_28C38_OFFSET_INNER };

// ─── Main function ─────────────────────────────────────────────────────────

/**
 * Replica bit-perfect di `FUN_00028C38`.
 *
 * Tick di un timer cascading a 3 livelli. La struct puntata da `timerPtr`
 * (5 byte in workRam o spriteRam) viene modificata in-place.
 *
 * Sequenza logica:
 *   1. Se `inner == 0xFF` (disabled): no-op, ritorna 0.
 *   2. `inner -= 1`; se `inner >= 0` (signed): ritorna 0.
 *   3. `inner = 5` (reset); `medium -= 1`; se `medium >= 0` (signed): ritorna 0.
 *   4. `medium = 9` (reset); `outer -= 1` (word).
 *   5. Se `outer == 0xFFFF` (wrapped from 0): imposta bit 0 nel risultato.
 *   6. Imposta bit 1 nel risultato (cascade fired).
 *   7. Ritorna i flag sign-extended a i32.
 *
 * @param state     GameState corrente (workRam / spriteRam mutati in-place).
 * @param timerPtr  Indirizzo assoluto della struct timer (5 byte).
 *                  Supporta workRam (0x400000..0x401FFF), spriteRam
 *                  (0xA02000..0xA02FFF), alphaRam (0xA03000..0xA03FFF),
 *                  colorRam (0xB00000..0xB007FF).
 * @returns         Flag i32 sign-extended: bit 0 = outer wrapped, bit 1 = cascade.
 */
export function helper28C38(state: GameState, timerPtr: number): number {
  return tickCascadingTimer(state, timerPtr);
}
