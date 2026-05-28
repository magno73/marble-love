/**
 *
 * script in work RAM @ `0x400A9C`, stride `0x56`, 25 entries (`0x19`).
 *
 * Compared with the `slotMatchesPtr_*` family in `slot-search.ts`, occupied
 * slots with `byte+0x1F == 0x0C` likely represent script "type=0xC", probably
 * the starting main script.
 *
 * **Disasm 0x12DAE..0x12DF8** (76 byte):
 *
 *   move.l  D2,-(SP)                   ; save D2
 *   movea.l (0x8,SP),A0                ; A0 = arg (script header ptr)
 *   clr.b   D2b                        ; D2 = 0 (return value, default no-match)
 *   movea.l #0x400a9c,A1               ; A1 = slot table base
 *   clr.b   D1b                        ; D1 = 0 (loop counter)
 * loop:
 *   cmpi.b  #0x1,(0x18,A1)             ; slot+0x18 == 1 (occupied)?
 *   bne.b   next
 *   move.l  (0x2,A0),D0                ; D0 = *(arg+2).l
 *   cmp.l   (0x3a,A1),D0               ; slot+0x3A == D0 ?
 *   beq.w   match
 *   tst.l   (0x2,A0)                   ; *(arg+2).l == 0 ?
 *   bne.b   next
 *   cmpi.b  #0xc,(0x1f,A1)             ; slot+0x1F == 0xC ?
 *   bne.b   next
 * match:
 *   moveq   #0x1,D2                    ; D2 = 1, exit loop
 *   bra.b   done
 * next:
 *   moveq   #0x56,D0
 *   adda.l  D0,A1                      ; A1 += 0x56 (stride)
 *   addq.b  #0x1,D1b
 *   cmpi.b  #0x19,D1b                  ; loop 25 times
 *   bne.b   loop
 * done:
 *   move.b  D2b,D0b                    ; D0 = D2 (byte)
 *   ext.w   D0w                        ; sign-extend (D2 in {0,1} -> D0 = 0 or 1)
 *   ext.l   D0
 *   move.l  (SP)+,D2                   ; restore D2
 *   rts
 *
 * alternative matching path via `slot+0x1F == 0xC`.
 *
 *   - 1 = at least one slot matches (returns on the first match).
 *
 *
 * `slotMatchesPtr_400A9C` in `slot-search.ts`, but that lives in another module.
 */

import type { GameState } from "./state.js";

const WORK_RAM_BASE = 0x400000 as const;

const SLOT_TABLE_BASE = 0x400a9c as const;

/** Slot record stride. */
const SLOT_STRIDE = 0x56 as const;

/** Number of scanned slots. */
const SLOT_COUNT = 0x19 as const; // 25

const SLOT_OCCUPIED_BYTE_OFF = 0x18 as const;

const SLOT_TYPE_BYTE_OFF = 0x1f as const;

const SLOT_SCRIPT_LONG_OFF = 0x3a as const;

const OCCUPIED_VALUE = 0x01 as const;

/** Alternative matching type byte on the arg-zero path. */
const ALT_MATCH_TYPE = 0x0c as const;

/**
 * big-endian.
 */
function readU32WorkRam(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>>
    0
  );
}

/**
 *
 *                only the long at `*(argPtr+2)` (see disasm: `move.l (0x2,A0),D0`).
 *                By default `argPtr` points into work RAM (0x4xxxxx); if it points
 */
export function slotMatch12DAE(state: GameState, argPtr: number): number {
  const argOff = (argPtr - WORK_RAM_BASE) >>> 0;
  const target = readU32WorkRam(state, argOff + 2);

  // D2 = 0 (default no-match).
  let d2 = 0;

  // Scan 25 entries, stride 0x56, starting from 0x400A9C.
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slotOff = (SLOT_TABLE_BASE + i * SLOT_STRIDE) - WORK_RAM_BASE;

    // cmpi.b #0x1,(0x18,A1)
    const occupied = state.workRam[slotOff + SLOT_OCCUPIED_BYTE_OFF] ?? 0;
    if (occupied !== OCCUPIED_VALUE) continue;

    // cmp.l (0x3a,A1),D0 with D0 = *(arg+2).l.
    const scriptLong = readU32WorkRam(state, slotOff + SLOT_SCRIPT_LONG_OFF);
    if (scriptLong === target) {
      d2 = 1;
      break;
    }

    // tst.l (0x2,A0): if target != 0, go to the next slot.
    if (target !== 0) continue;

    // cmpi.b #0xC,(0x1f,A1): if slot+0x1F == 0xC, match.
    const typeByte = state.workRam[slotOff + SLOT_TYPE_BYTE_OFF] ?? 0;
    if (typeByte === ALT_MATCH_TYPE) {
      d2 = 1;
      break;
    }
  }

  // move.b D2b,D0b; ext.w; ext.l -> D2 in {0,1}, so D0 = 0 or 1 (no sign issues).
  return d2;
}
