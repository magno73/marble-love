/**
 * helper-18f46.ts — `FUN_00018F46` replica (51 instr, ~137 bytes).
 *
 * (`workRam[lookup_table[slot_idx]]`) has `struct[0] == typeCode` and
 * `struct[1] == subIdx`. If found, it shifts entries up to the last valid
 * byte, clearing the found position.
 *
 * (`slot-insert-sorted-18e6c.ts`).
 *
 *
 *   Tipico pattern caller:
 *   ```
 *     move.l  <val1>,-(SP)   ; arg2 = subIdx long
 *     pea     <val2>.w       ; arg1 = typeCode long (LSB = val2 & 0xFF)
 *     jsr     0x00018F46.l
 *     addq.l  #8,SP
 *   ```
 *   Oppure:
 *   ```
 *     ext.l   D0             ; arg2
 *     move.l  D0,-(SP)
 *     ext.l   D1             ; arg1
 *     move.l  D1,-(SP)
 *     jsr     0x00018F46.l
 *     addq.l  #8,SP
 *   ```
 *
 * **Disasm FUN_00018F46** (51 instructions, 0x88 bytes: 0x18F46–0x18FCF):
 *
 *   00018f46  movem.l {A3 A2 D2},-(SP)       ; save 3 regs (12 byte push)
 *   00018f4a  move.b  (0x13,SP),D1b          ; D1b = arg1[LSB] = typeCode
 *   00018f4e  move.b  (0x17,SP),D2b          ; D2b = arg2[LSB] = subIdx
 *   00018f58  movea.l A2,A1                  ; A1 = walk ptr = A2
 *
 *   ; ── Phase 1: search loop ─────────────────────────────────────────────
 *   00018f5a  cmpi.b  #-1,(A1)               ; (A1) == 0xFF ? → exit-search
 *   00018f5e  beq.b   0x18F8A
 *   00018f60  lea     (0x1F,A2),A0           ; A0 = A2 + 0x1F (last slot excl.)
 *   00018f64  cmpa.l  A0,A1                  ; A1 >= A2+0x1F ? → exit-search
 *   00018f66  bcc.b   0x18F8A
 *   00018f68  move.b  (A1),D0b               ; D0 = byte at A1 (slot index)
 *   00018f6a  ext.w   D0w
 *   00018f6c  ext.l   D0                     ; D0 = zero-ext (ext.w+ext.l on
 *                                            ;   byte from 0..255 → 0..255 long
 *                                            ;   UNLESS the byte has bit7 set,
 *                                            ;   in which case ext.w sign-extends
 *                                            ;   to 0xFFFFFF80..0xFFFFFFFF — but
 *                                            ;   slot indices 0..30 which are all
 *                                            ;   < 0x80, so D0 is effectively
 *                                            ;   unsigned 0..30.)
 *   00018f6e  asl.l   #2,D0                  ; D0 *= 4 (offset into lookup table)
 *   00018f70  movea.l #0x1F0E2,A0            ; A0 = ROM lookup table base
 *   00018f76  movea.l (0,A0,D0*1),A3         ; A3 = rom_lookup[D0/4] = rect ptr
 *   00018f7a  cmp.b   (A3),D1b               ; struct[0] == typeCode?
 *   00018f7c  bne.b   0x18F86                ; no → advance A1
 *   00018f7e  cmp.b   (0x1,A3),D2b           ; struct[1] == subIdx?
 *   00018f82  beq.w   0x18F8A                ; yes → found! exit-search
 *   00018f86  addq.l  #1,A1                  ; A1++
 *   00018f88  bra.b   0x18F5A                ; loop
 *
 *   ; ── Phase 2: guard ───────────────────────────────────────────────────
 *   00018f8a  lea     (0x1F,A2),A0           ; A0 = A2+0x1F
 *   00018f8e  cmpa.l  A0,A1                  ; A1 >= A2+0x1F? → return
 *   00018f90  bcc.w   0x18FCA
 *   00018f94  cmpi.b  #-1,(A1)               ; (A1) == 0xFF? → return (sentinel)
 *   00018f98  beq.w   0x18FCA
 *
 *   ; ── Phase 3: remove ──────────────────────────────────────────────────
 *   00018f9c  clr.b   (A3)                   ; rect struct[0] = 0 (free slot)
 *   00018f9e  movea.l A1,A0                  ; A0 = A1 (found pos)
 *   00018fa0  addq.l  #1,A0                  ; A0 = A1+1
 *   00018fa2  movea.l A0,A3                  ; A3 = A1+1 (end-scanner)
 *
 *   ; Find end of remaining bytes (first 0xFF or A2+0x1F):
 *   00018fa4  cmpi.b  #-1,(A3)               ; (A3) == 0xFF? → exit end-scan
 *   00018fa8  beq.b   0x18FB6
 *   00018faa  lea     (0x1F,A2),A0           ; A0 = A2+0x1F
 *   00018fae  cmpa.l  A0,A3                  ; A3 >= A2+0x1F? → exit end-scan
 *   00018fb0  bcc.b   0x18FB6
 *   00018fb2  addq.l  #1,A3                  ; A3++
 *   00018fb4  bra.b   0x18FA4                ; loop
 *
 *   ; A3 now points past last valid byte. Back up by 1:
 *   00018fb6  subq.l  #1,A3                  ; A3 = last valid position (before
 *                                            ;   sentinel or bound)
 *
 *   ; Shift-left loop: copy (A1+1) → (A1) while A1 < A3:
 *   00018fb8  cmpa.l  A3,A1                  ; A1 >= A3? (unsigned bcc) → done
 *   00018fba  bcc.b   0x18FC6
 *   00018fbc  movea.l A1,A0                  ; A0 = A1
 *   00018fbe  addq.l  #1,A0                  ; A0 = A1+1
 *   00018fc0  move.b  (A0),(A1)              ; byte[A1] = byte[A1+1]
 *   00018fc2  addq.l  #1,A1                  ; A1++
 *   00018fc4  bra.b   0x18FB8                ; loop
 *
 *   ; Write sentinel at A1 (last position after shift):
 *   00018fc6  move.b  #0xFF,(A1)             ; byte[A1] = 0xFF
 *
 *   00018fca  movem.l (SP)+,{D2 A2 A3}       ; restore
 *   00018fce  rts
 *
 * **Memory layout** (shared with `slot-insert-sorted-18e6c.ts`):
 *     Elemento i: byte = "rect slot index" (0..30) indicizzando la
 *     lookup-table ROM @ `0x1F0E2`.
 *   - Rect-slot i: `workRam[0x4001DC + i * 0xE]` (14 byte ciascuno).
 *     `slot[0]` = type-code / "occupato flag". Se 0 → slot libero.
 *     `slot[1]` = sub-index.
 *   - ROM lookup-table @ `0x1F0E2` (32 x 4 bytes): absolute M68k pointers to
 *     rect-slot in workRam. Entry i → `workRam[lookup[i]]`.
 *
 * **Callers noti** (10 + 1 entry-point):
 *   - `FUN_00014C46` @ 0x14DD2
 *   - `FUN_00017346` @ 0x175AE
 *   - `FUN_000186AC` @ 0x187EC
 *   - `FUN_0001844A` @ 0x18522
 *   - `FUN_00015BD0` @ 0x15BF6
 *   - `FUN_00012F44` @ 0x12FC6
 *   - `FUN_000190EE` @ 0x19112
 *   - `FUN_00016A20` @ 0x16E68
 *   - `FUN_00025FC2` @ 0x2615C
 *   - `FUN_00019BAA` @ 0x19CEA
 *
 *   1. Se trovata la entry: `workRam[structOff]` = 0 (free-slot mark su rect).
 *      di 1 (compattati).
 *   3. `workRam[0x3BC + endPos - 1]` = 0xFF (nuovo terminatore).
 *
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Base assoluta workRam M68k. */
const WORK_RAM_BASE = 0x00400000 as const;

export const BYTE_ARRAY_ABS = 0x004003bc as const;

export const BYTE_ARRAY_LEN = 0x20 as const;

/** Sentinel byte (0xFF) — stops the search and marks the end of the list. */
export const SENTINEL_BYTE = 0xff as const;

/** ROM offset of the lookup table (absolute M68k pointers to rect slots). */
export const ROM_LOOKUP_OFF = 0x1f0e2 as const;

export const HELPER_18F46_ADDR = 0x00018f46 as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function r8(state: GameState, off: number): number {
  return (state.workRam[off] ?? 0) & 0xff;
}

function w8(state: GameState, off: number, v: number): void {
  state.workRam[off] = v & 0xff;
}

/**
 * Difensivo: byte assenti contano 0.
 */
function readU32BE(rom: RomImage, absOff: number): number {
  const o = absOff | 0;
  const b0 = (rom.program[o] ?? 0) & 0xff;
  const b1 = (rom.program[o + 1] ?? 0) & 0xff;
  const b2 = (rom.program[o + 2] ?? 0) & 0xff;
  const b3 = (rom.program[o + 3] ?? 0) & 0xff;
  return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
}


/**
 *
 */
export interface Helper18F46Result {
  removed: boolean;
  /**
   * removed entry. `null` if not found.
   */
  foundPos: number | null;
  /**
   * removed. `null` if not found.
   */
  slotIdx: number | null;
}

// ─── Replica ─────────────────────────────────────────────────────────────────

/**
 *
 * @param state     GameState (workRam mutated if an entry is found).
 * @param typeCode  Byte (0..255). LSB of the first caller-pushed arg.
 * @param subIdx    Byte (0..255). LSB of the second caller-pushed arg.
 * @returns         Removal details.
 *
 * **Mutation** (only if an entry is found):
 *   - `workRam[structOff]` = 0 (rect slot marcato libero).
 *   - `workRam[0x3BC + foundPos .. 0x3BC + endPos - 1]` compattati.
 *   - `workRam[0x3BC + endPos - 1]` = 0xFF (nuovo sentinel).
 */
export function helper18F46(
  state: GameState,
  rom: RomImage,
  typeCode: number,
  subIdx: number,
): Helper18F46Result {
  const d1 = typeCode & 0xff;
  const d2 = subIdx & 0xff;

  const a2Off = BYTE_ARRAY_ABS - WORK_RAM_BASE; // 0x3BC
  const a2EndExclOff = a2Off + (BYTE_ARRAY_LEN - 1); // a2Off + 0x1F

  // ─── Phase 1: search loop ─────────────────────────────────────────────────
  // A1 = walk pointer, starts at A2.
  let a1Off = a2Off;
  let a3StructAbsPtr = 0; // A3 = rect struct ptr (absolute M68k addr)

  let found = false;
  for (let safety = BYTE_ARRAY_LEN; safety > 0; safety--) {
    // 0x18F5A: cmpi.b #-1,(A1); beq exit-search
    if (r8(state, a1Off) === SENTINEL_BYTE) break;
    // 0x18F60..0x18F66: lea (0x1F,A2),A0; cmpa.l A0,A1; bcc exit-search
    if (a1Off >= a2EndExclOff) break;

    // 0x18F68..0x18F76: load slot index, lookup rect ptr.
    const slotByte = r8(state, a1Off); // D0.b = byte[A1]
    // ext.w + ext.l: byte is sign-extended to long, but slot indices are
    // 0..30 (all < 0x80), so effectively D0 = slotByte (0..30).
    // asl.l #2,D0 → D0 = slotByte * 4
    const d0Long = (slotByte & 0x7f) === slotByte
      ? slotByte * 4
      : (((slotByte << 24) >> 24) * 4) | 0; // sign-ext path (unused in practice)
    const romLookupIdx = ROM_LOOKUP_OFF + d0Long;
    a3StructAbsPtr = readU32BE(rom, romLookupIdx); // A3 = lookup_table[slotByte]

    // 0x18F7A..0x18F82: compare struct[0] with D1b; struct[1] with D2b.
    const structOff = (a3StructAbsPtr - WORK_RAM_BASE) | 0;
    const s0 = r8(state, structOff);
    if (s0 === d1) {
      const s1 = r8(state, structOff + 1);
      if (s1 === d2) {
        found = true;
        break; // match found
      }
    }

    // 0x18F86: addq.l #1,A1
    a1Off = (a1Off + 1) | 0;
  }

  // ─── Phase 2: guard ───────────────────────────────────────────────────────
  // 0x18F8A..0x18F98: if A1 >= A2+0x1F or (A1)==0xFF → return
  if (!found) {
    return { removed: false, foundPos: null, slotIdx: null };
  }
  // Re-check guards (binary checks again after loop exit).
  if (a1Off >= a2EndExclOff) {
    return { removed: false, foundPos: null, slotIdx: null };
  }
  if (r8(state, a1Off) === SENTINEL_BYTE) {
    return { removed: false, foundPos: null, slotIdx: null };
  }

  const foundSlotIdx = r8(state, a1Off);
  const foundPos = a1Off;

  // ─── Phase 3: remove ──────────────────────────────────────────────────────

  // 0x18F9C: clr.b (A3) — mark rect slot as free (struct[0] = 0).
  const structOff = (a3StructAbsPtr - WORK_RAM_BASE) | 0;
  w8(state, structOff, 0);

  // 0x18F9E..0x18FA2: A3 = A1+1 (end-scanner).
  let a3ScanOff = (a1Off + 1) | 0;

  // 0x18FA4..0x18FB4: find end (first 0xFF or A2+0x1F).
  for (let safety = BYTE_ARRAY_LEN; safety > 0; safety--) {
    // 0x18FA4: cmpi.b #-1,(A3); beq exit-end-scan
    if (r8(state, a3ScanOff) === SENTINEL_BYTE) break;
    // 0x18FAA..0x18FB0: lea (0x1F,A2),A0; cmpa.l A0,A3; bcc exit-end-scan
    if (a3ScanOff >= a2EndExclOff) break;
    // 0x18FB2: addq.l #1,A3
    a3ScanOff = (a3ScanOff + 1) | 0;
  }

  // 0x18FB6: subq.l #1,A3 — back up to last valid position.
  a3ScanOff = (a3ScanOff - 1) | 0;

  // 0x18FB8..0x18FC4: shift-left loop.
  // While A1 < A3 (unsigned): byte[A1] = byte[A1+1]; A1++.
  while (a1Off < a3ScanOff) {
    // 0x18FB8: cmpa.l A3,A1; bcc → 0x18FC6 (if A1 >= A3 → done).
    if ((a1Off >>> 0) >= (a3ScanOff >>> 0)) break;
    // 0x18FBC..0x18FC2: A0 = A1+1; byte[A1] = byte[A0]; A1++
    const src = r8(state, a1Off + 1);
    w8(state, a1Off, src);
    a1Off = (a1Off + 1) | 0;
  }

  // 0x18FC6: move.b #0xFF,(A1) — write sentinel at new end position.
  w8(state, a1Off, SENTINEL_BYTE);

  return {
    removed: true,
    foundPos,
    slotIdx: foundSlotIdx,
  };
}
