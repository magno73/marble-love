/**
 * slot-insert-sorted-18e6c.ts — replica `FUN_00018E6C` (218 byte).
 *
 * Insert a new rect entry into the ordered draw-list at `0x004003BC`
 * (32 bytes, sentinel `0xFF`). Uses the same ROM lookup table and comparator
 * `FUN_0001A80A` (rect z-order/overlap -> 0/1).
 *
 * **Calling convention**: two long args pushed RTL by the caller.
 *   - `arg1` (LSB byte -> D2): type code for the new entry
 *     `(0xF, A6)`. (D2/D3 sono SOLO i low byte; il modello accetta byte.)
 *
 * **Disasm 0x18E6C..0x18F46** (218 byte):
 *
 *   0x18E6C: link.w  A6,-0xE                ; alloca local 14-byte rect
 *   0x18E70: movem.l {A4,A3,A2,D3,D2},-(SP) ; preserve
 *   0x18E74: move.b  (0xB,A6),D2b           ; D2 = arg1 LSB (type code)
 *   0x18E78: move.b  (0xF,A6),D3b           ; D3 = arg2 LSB (subindex)
 *   0x18E82: movea.l #0x4001DC,A4           ; A4 = rect-slot base (16×14)
 *   0x18E88: move.b  D2b,(-0xE,A6)          ; local[0] = D2
 *   0x18E8C: move.b  D3b,(-0xD,A6)          ; local[1] = D3
 *   0x18E90: pea     (-0xE,A6)              ; push ptr to local
 *   0x18E94: jsr     0x0001B12A.l           ; FUN_1B12A(local) — fills
 *                                            ; local[2..0xD] (rect fields)
 *   0x18E9A: movea.l A2,A3                  ; A3 = A2 (walk pointer)
 *   0x18E9C: addq.l  #4,SP                  ; pop arg
 *
 *   0x18E9E: cmpi.b  #-1,(A3)               ; if byte == 0xFF (sentinel)
 *   0x18EA2: beq.b   0x18ED4                ;   → exit-loop1 (insert here)
 *   0x18EA4: lea     (0x1F,A2),A0           ; A0 = A2 + 0x1F (last index)
 *   0x18EA8: cmpa.l  A0,A3
 *   0x18EAA: bcc.b   0x18ED4                ; if A3 >= A2+0x1F → exit-loop1
 *   0x18EAC: pea     (-0xE,A6)              ; push local ptr (arg2 of 1A80A)
 *   0x18EB0: move.b  (A3),D0b               ; D0.b = byte[A3] (slot index)
 *   0x18EB2: ext.w   D0w
 *   0x18EB4: ext.l   D0
 *   0x18EB6: asl.l   #2,D0                  ; D0 = idx * 4
 *   0x18EB8: movea.l #0x1F0E2,A0
 *   0x18EBE: move.l  (0,A0,D0*1),-(SP)      ; push lookup[byte] (arg1)
 *   0x18EC2: jsr     0x0001A80A.l           ; D0 = compare(lookup[idx], local)
 *   0x18EC8: tst.l   D0
 *   0x18ECA: addq.l  #8,SP                  ; pop 2 args
 *   0x18ECC: bne.w   0x18ED4                ; if cmp != 0 → exit-loop1
 *                                            ;   (insert here, BEFORE A3)
 *   0x18ED0: addq.l  #1,A3                  ; A3++
 *   0x18ED2: bra.b   0x18E9E
 *
 *   ; --- Loop 2: find first free 14-byte rect slot ---------------------
 *   0x18ED4: lea     (0x1F,A2),A0
 *   0x18ED8: cmpa.l  A0,A3
 *   0x18EDA: bcc.w   0x18F3E                ; if A3 >= A2+0x1F → exit (no slot)
 *   0x18EDE: movea.l A4,A1                  ; A1 = A4 (slot walker)
 *   0x18EE0: clr.b   D1b                    ; D1 = 0 (slot index counter)
 *   0x18EE2: tst.b   (A1)                   ; (A1) == 0 → empty slot
 *   0x18EE4: beq.b   0x18EF6
 *   0x18EE6: lea     (0x1B2,A4),A0          ; A0 = A4 + 0x1B2 (slot-end)
 *   0x18EEA: cmpa.l  A0,A1
 *   0x18EEC: bcc.b   0x18EF6                ; if A1 >= end → exit-loop2
 *   0x18EEE: moveq   #0xE,D0                ; stride = 14 byte/slot
 *   0x18EF0: adda.l  D0,A1
 *   0x18EF2: addq.b  #1,D1b
 *   0x18EF4: bra.b   0x18EE2
 *
 *   0x18EF6: lea     (0x1B2,A4),A0
 *   0x18EFA: cmpa.l  A0,A1
 *   0x18EFC: bcc.w   0x18F3E                ; if A1 >= end → exit (no slot)
 *
 *   ; --- Slot found: write [D2, D3] in slot ----------------------------
 *   0x18F00: move.b  D2b,(A1)               ; slot[0] = D2 (type)
 *   0x18F02: move.b  D3b,(0x1,A1)           ; slot[1] = D3 (subindex)
 *
 *   0x18F06: cmpi.b  #-1,(A3)               ; if byte[A3] == 0xFF
 *   0x18F0A: beq.b   0x18F3C                ;   → skip shift, write D1 at A3
 *
 *   ; Find end of byte-list (first 0xFF or A2+0x1F)
 *   0x18F0C: movea.l A3,A0
 *   0x18F0E: addq.l  #1,A0
 *   0x18F10: movea.l A0,A1                  ; A1 = A3 + 1
 *   0x18F12: cmpi.b  #-1,(A1)
 *   0x18F16: beq.b   0x18F24
 *   0x18F18: lea     (0x1F,A2),A0
 *   0x18F1C: cmpa.l  A0,A1
 *   0x18F1E: bcc.b   0x18F24
 *   0x18F20: addq.l  #1,A1
 *   0x18F22: bra.b   0x18F12
 *
 *   0x18F24: subq.l  #1,A1                  ; A1 = last byte to shift
 *   0x18F26: cmpa.l  A3,A1
 *   0x18F28: bcs.b   0x18F3C                ; if A1 < A3 → done
 *   0x18F2A: lea     (0x1E,A2),A0           ; clamp dest at A2+0x1E
 *   0x18F2E: cmpa.l  A0,A1
 *   0x18F30: bcc.b   0x18F38                ; if A1 >= A2+0x1E → skip move
 *   0x18F32: movea.l A1,A0
 *   0x18F34: addq.l  #1,A0
 *   0x18F36: move.b  (A1),(A0)              ; byte[A1+1] = byte[A1]
 *   0x18F38: subq.l  #1,A1
 *   0x18F3A: bra.b   0x18F26
 *
 *   0x18F3C: move.b  D1b,(A3)               ; byte[insert] = slot index
 *
 *   0x18F3E: movem.l (SP)+,{D2,D3,A2,A3,A4} ; restore
 *   0x18F42: unlk    A6
 *   0x18F44: rts
 *
 * **Semantics** (high level):
 *   1. Builds the new entry rect from (typeCode, subIdx) via
 *      `FUN_1B12A` (sub-injection).
 *      == 0`). Slot index = D1 in [0..30].
 *      byte[0x1F]`; the clamp `if A1 >= A2+0x1E skip` prevents that.
 *
 * **Edge cases**:
 *   - Loop 1 stops at the first `0xFF`, so insertPos points to that byte.
 *     non-zero): insertPos al limite ⇒ exit a 0x18F3E (no insert).
 *   - Loop 2 esaurisce the slot (D1 == 31, A1 >= A2+0x1B2): no insert.
 *   - The shift does not touch byte[0x1F], preserving the sentinel.
 *
 *   - Bytes shifted-right in `byteArray[A3..0x1E]` (1 byte → 2 byte → ...).
 *
 * **Known callers** (14 xrefs): `FUN_14C46`, `FUN_15A12`, `FUN_17346` (x2),
 * `FUN_18FFA`, `FUN_259B4`, `FUN_18CD2`, `FUN_121B8` (×3), `FUN_1844A`,
 * `FUN_19A40`, `FUN_12896`. Tipico pattern call: `pea (typeCode).w; move.l
 * D0,-(SP); jsr 0x18E6C; addq.l #8, SP`.
 *
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { fun1A80A, lookupRectPtr } from "./sort-adjacent-objects-1a7a8.js";

// ─── Constants ───────────────────────────────────────────────────────────

/** Absolute M68k work RAM base. */
const WORK_RAM_BASE = 0x00400000;

export const BYTE_ARRAY_ABS = 0x004003bc as const;
export const BYTE_ARRAY_LEN = 0x20 as const;
/** Sentinel byte: ends the walk and flags "skip shift". */
export const SENTINEL_BYTE = 0xff as const;

export const RECT_SLOT_ABS = 0x004001dc as const;
/** Stride per slot (14 bytes). */
export const RECT_SLOT_STRIDE = 0x0e as const;
/** Exclusive slot-area limit: A4 + 0x1B2 = 31 slots indexed 0..30.
  */
export const RECT_SLOT_END_OFF = 0x1b2 as const;

// ─── Sub injection ───────────────────────────────────────────────────────

/**
 * Stub injection for `FUN_0001B12A` (rect-builder).
 *
 * The caller seeds `local[0]` (type code) and `local[1]` (subindex), then the
 * subroutine fills `local[2..0xD]` (six words).
 *
 */
export interface SlotInsertSorted18E6CSubs {
  /**
   * Replica of `FUN_0001B12A`. Receives `state` for work RAM side effects.
   *
   * @param state     GameState, potentially mutated for side effects.
   * @param typeCode  byte = `local[0]` (D2 LSB of first arg).
   * @param subIdx    byte = `local[1]` (D3 LSB of second arg).
   * @param localRect Logical 14-byte buffer. Default-initialized to zero.
   */
  fun_1b12a?: (
    state: GameState,
    typeCode: number,
    subIdx: number,
    localRect: Uint8Array,
  ) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Read byte from work RAM offset (0 if OOB). */
function r8(state: GameState, off: number): number {
  return (state.workRam[off] ?? 0) & 0xff;
}

/** Write byte to work RAM offset. */
function w8(state: GameState, off: number, v: number): void {
  state.workRam[off] = v & 0xff;
}

/**
 *
 * Mirror `jsr 0x0001A80A` with stack frame:
 *   pea  (-0xE,A6)            -> arg2 = local ptr (A0 in 1A80A)
 *   move.l lookup[byte],-(SP) -> arg1 = slot ptr (A1 in 1A80A)
 *
 *
 * directly from the in-memory `localRect` Uint8Array, not work RAM.
 */
function compareWithSlot(
  state: GameState,
  rom: RomImage,
  localRect: Uint8Array,
  byteIdx: number,
): number {
  // Resolve slot pointer via ROM lookup table (same table as FUN_1A7A8).
  const slotPtr = lookupRectPtr(rom, byteIdx);


  // Word reads from slot (A1) via work RAM.
  const slotReadWord = (off: number): number => {
    const abs = (slotPtr + off) >>> 0;
    if (abs < WORK_RAM_BASE || abs + 1 >= WORK_RAM_BASE + 0x2000) return 0;
    const o = abs - WORK_RAM_BASE;
    return (((state.workRam[o] ?? 0) << 8) | (state.workRam[o + 1] ?? 0)) & 0xffff;
  };

  // Word reads from local (A0) via Uint8Array.
  const localReadWord = (off: number): number => {
    const b0 = (localRect[off] ?? 0) & 0xff;
    const b1 = (localRect[off + 1] ?? 0) & 0xff;
    return ((b0 << 8) | b1) & 0xffff;
  };

  const s16 = (w: number): number => {
    const x = w & 0xffff;
    return x & 0x8000 ? x - 0x10000 : x;
  };

  const a1_2 = slotReadWord(2);
  const a1_4 = slotReadWord(4);
  const a1_6 = slotReadWord(6);
  const a1_8 = slotReadWord(8);
  const a1_a = slotReadWord(0xa);
  const a1_c = slotReadWord(0xc);

  const a0_2 = localReadWord(2);
  const a0_4 = localReadWord(4);
  const a0_6 = localReadWord(6);
  const a0_8 = localReadWord(8);
  const a0_a = localReadWord(0xa);
  const a0_c = localReadWord(0xc);

  // Same algoritmo of fun1A80A.
  const D4 = s16(a1_6) + s16(a1_4) + s16(a1_2);
  const D3 = s16(a1_c) + s16(a1_a) + s16(a1_8);
  const D2 = s16(a0_6) + s16(a0_4) + s16(a0_2);
  const D5 = s16(a0_c) + s16(a0_a) + s16(a0_8);

  if (D3 <= D2) return 0;
  if (D5 <= D4) return 1;
  if (s16(a0_4) >= s16(a1_a)) return 0;
  if (s16(a1_4) >= s16(a0_a)) return 1;
  if (s16(a0_2) >= s16(a1_8)) return 0;
  if (s16(a1_2) >= s16(a0_8)) return 1;
  if (s16(a0_6) >= s16(a1_c)) return 0;
  return 1;
}

void fun1A80A;

// ─── Replica ─────────────────────────────────────────────────────────────

/**
 */
export interface SlotInsertSorted18E6CResult {
  /**
    */
  insertPos: number | null;
  slotIdx: number | null;
  inserted: boolean;
  insertOnSentinel: boolean;
}

/**
 * Insert an entry into the ordered draw-list.
 *
 * @param typeCode  Byte (0..255). LSB of the first caller-pushed arg.
 * @param subIdx    Byte (0..255). LSB of the second caller-pushed arg.
 * @param subs      Sub injection for `FUN_1B12A` (rect-builder).
 * @returns         Insert details (insertPos, slotIdx, inserted).
 *
 * `workRam[0x1DC + slot*0xE..+0xE]` (slot; only the first 2 bytes).
 *
 *     to populate it. The TS replica allocates `localRect = new Uint8Array(14)`
 *     and invokes `subs.fun_1b12a` (default: zero-filled local[2..0xD]).
 *   - The first `cmpa.l A0,A3` with `A3 = A2 + 0x20 - 1 = A2 + 0x1F` uses
 *     `bcc` (branch carry clear = unsigned >=). Modello: `>=`.
 *   - The right shift ends with `byte[0x1F]` unchanged (clamp).
 */
export function slotInsertSorted18E6C(
  state: GameState,
  rom: RomImage,
  typeCode: number,
  subIdx: number,
  subs: SlotInsertSorted18E6CSubs = {},
): SlotInsertSorted18E6CResult {
  const d2 = typeCode & 0xff;
  const d3 = subIdx & 0xff;

  // 0x18E88..0x18E8C: local[0] = D2, local[1] = D3
  const localRect = new Uint8Array(14);
  localRect[0] = d2;
  localRect[1] = d3;

  // 0x18E90..0x18E94: jsr FUN_1B12A(local), filling local[2..0xD].
  subs.fun_1b12a?.(state, d2, d3, localRect);

  const a2Off = BYTE_ARRAY_ABS - WORK_RAM_BASE; // 0x3BC
  let a3Off = a2Off; // start at A2
  const a2EndExclusiveOff = a2Off + (BYTE_ARRAY_LEN - 1); // A2 + 0x1F

  let insertPos: number | null = null;

  // Safety cap (the loop is bounded by A3 reaching A2+0x1F).
  for (let safety = BYTE_ARRAY_LEN + 1; safety > 0; safety--) {
    // 0x18E9E: cmpi.b #-1,(A3); beq exit-loop1
    if (r8(state, a3Off) === SENTINEL_BYTE) {
      insertPos = a3Off;
      break;
    }
    // 0x18EA4..0x18EAA: cmpa.l (A2+0x1F),A3; bcc exit-loop1
    if (a3Off >= a2EndExclusiveOff) {
      // No insertion possible (loop exhausted).
      insertPos = null;
      break;
    }
    // 0x18EAC..0x18EC2: pea local; push lookup[byte]; jsr 1A80A
    const byteIdx = r8(state, a3Off);
    const cmp = compareWithSlot(state, rom, localRect, byteIdx) | 0;
    // 0x18EC8..0x18ECC: tst.l D0; bne exit-loop1 (insert here, BEFORE A3)
    if (cmp !== 0) {
      insertPos = a3Off;
      break;
    }
    // 0x18ED0: addq.l #1,A3
    a3Off = (a3Off + 1) | 0;
  }

  // 0x18ED4..0x18EDA: lea (0x1F,A2),A0; cmpa.l A0,A3; bcc exit (no insert).
  if (insertPos === null) {
    return {
      insertPos: null,
      slotIdx: null,
      inserted: false,
      insertOnSentinel: false,
    };
  }
  if (insertPos >= a2EndExclusiveOff) {
    return {
      insertPos: null,
      slotIdx: null,
      inserted: false,
      insertOnSentinel: false,
    };
  }

  // ─── Loop 2: find first free 14-byte rect slot ───────────────────────
  // A4 = RECT_SLOT_ABS, A1 walker, D1 counter.
  const a4Off = RECT_SLOT_ABS - WORK_RAM_BASE; // 0x1DC
  const a4EndOff = a4Off + RECT_SLOT_END_OFF; // 0x38E
  let a1Off = a4Off;
  let d1 = 0;

  while (true) {
    // 0x18EE2: tst.b (A1); beq → exit-loop2 (slot found)
    if (r8(state, a1Off) === 0) break;
    // 0x18EE6..0x18EEC: cmpa.l (A4+0x1B2),A1; bcc → exit-loop2
    if (a1Off >= a4EndOff) break;
    // 0x18EEE..0x18EF4: A1 += 14, D1++, loop
    a1Off = (a1Off + RECT_SLOT_STRIDE) | 0;
    d1 = (d1 + 1) & 0xff;
  }

  // 0x18EF6..0x18EFC: cmpa.l (A4+0x1B2),A1; bcc → exit (no slot)
  if (a1Off >= a4EndOff) {
    return {
      insertPos: null,
      slotIdx: null,
      inserted: false,
      insertOnSentinel: false,
    };
  }

  // 0x18F00..0x18F02: write [D2, D3] into slot
  w8(state, a1Off, d2);
  w8(state, a1Off + 1, d3);

  // 0x18F06: cmpi.b #-1,(A3); beq → write D1 at A3 (skip shift)
  if (r8(state, insertPos) === SENTINEL_BYTE) {
    // Skip shift, just write D1 at A3.
    w8(state, insertPos, d1);
    return {
      insertPos,
      slotIdx: d1,
      inserted: true,
      insertOnSentinel: true,
    };
  }

  // 0x18F0C..0x18F22: walk A1 from A3+1 until 0xFF or A2+0x1F (end-find).
  let walkOff = (insertPos + 1) | 0;
  while (true) {
    if (r8(state, walkOff) === SENTINEL_BYTE) break;
    if (walkOff >= a2EndExclusiveOff) break;
    walkOff = (walkOff + 1) | 0;
  }

  // 0x18F24: subq.l #1,A1 → walk back by 1 (last byte to potentially shift).
  let shiftOff = (walkOff - 1) | 0;

  // 0x18F26..0x18F3A: shift right loop (from shiftOff down to insertPos).
  while (shiftOff >= insertPos) {
    // 0x18F26: cmpa.l A3,A1; bcs → done. (cmpa.l + bcs = unsigned A1 < A3.)
    if (shiftOff < insertPos) break;
    // 0x18F2A..0x18F30: cmpa.l (A2+0x1E),A1; bcc → skip move.
    // (A2+0x1E = a2Off + 0x1E. If A1 >= a2Off+0x1E → don't write.)
    if (shiftOff < a2Off + (BYTE_ARRAY_LEN - 2)) {
      // 0x18F32..0x18F36: byte[A1+1] = byte[A1]
      const v = r8(state, shiftOff);
      w8(state, shiftOff + 1, v);
    }
    // 0x18F38: A1--
    shiftOff = (shiftOff - 1) | 0;
    // Safety guard for negative wrap.
    if (shiftOff < 0) break;
  }

  // 0x18F3C: byte[A3] = D1 (slot index)
  w8(state, insertPos, d1);

  return {
    insertPos,
    slotIdx: d1,
    inserted: true,
    insertOnSentinel: false,
  };
}
