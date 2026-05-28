/**
 * Port of ROM routine `FUN_0001BBAA`.
 *
 * This is a gated object charcode broadcast. It exits early when the gate flag
 * at `0x40076C` is clear, or when the ROM threshold for the current level is
 * <= progress byte `0x400444`. Otherwise it scans active objects; when an object
 * has state 1, filter flag 0, signed field `+0x6A` in `[3,6]`, and charcode
 * `+0x1B` found in the level's 0xFF-terminated ROM list, it clears the gate flag
 * and sets `+0xCB = 1` on every active inner object.
 *
 * Important parity points:
 *   - The char-list scan continues to the terminator even after a match.
 *   - Outer/inner loop counters are byte registers sign-extended for cmp.w.
 *   - The object stride is kept local at 0xE2 to mirror the ROM routine.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── Address constants ───────────────────────────────────────────────────

/** ROM base for the pointer table indexed by `*0x400394 << 2`. */
export const ROM_PTR_TABLE_BASE = 0x00024aae as const;
/** ROM base for the byte table indexed by `*0x400394` (threshold). */
export const ROM_BYTE_TABLE_BASE = 0x00024a94 as const;

/** WorkRam absolute address: word "level index". */
export const LEVEL_IDX_ADDR = 0x00400394 as const;
/** WorkRam absolute address: byte "gate flag" (cleared on match). */
export const GATE_FLAG_ADDR = 0x0040076c as const;
/** WorkRam absolute address: byte progress compared with the ROM threshold. */
export const PROGRESS_ADDR = 0x00400444 as const;
/** WorkRam absolute address: word "object count" (loop limit). */
export const OBJ_COUNT_ADDR = 0x00400396 as const;

export const OBJ_BASE_ADDR = 0x00400018 as const;
/** Stride between adjacent object structs. */
export const OBJ_STRIDE = 0xe2 as const;

/** Object field offsets (relative to obj base). */
export const OBJ_STATE_OFF = 0x18 as const;
export const OBJ_FILTER_FLAG_OFF = 0x1a as const;
export const OBJ_CHARCODE_OFF = 0x1b as const;
export const OBJ_SIGNED_RANGE_OFF = 0x6a as const;
export const OBJ_BROADCAST_FLAG_OFF = 0xcb as const;

/** Char-list terminator byte. */
const TERMINATOR = 0xff;

/** Absolute M68K work RAM base. */
const WORK_RAM_BASE = 0x00400000;
/** WorkRam size (8 KB). */
const WORK_RAM_SIZE = 0x2000;

// ─── Implementation ──────────────────────────────────────────────────────

/**
 * Runs `FUN_0001BBAA`.
 *
 * @param state  GameState. Mutates `workRam` by clearing the gate flag on the
 *               first outer match and setting `obj+0xCB = 1` for active inner
 *               objects. Repeated writes are idempotent.
 * @param rom    ROM image used for the threshold byte and char-list pointer.
 */
export function objectCharcodeBroadcast1BBAA(
  state: GameState,
  rom: RomImage,
): void {
  const r = state.workRam;
  const prog = rom.program;

  // ─── Step 1: load idx, listPtr ──────────────────────────────────────
  const idxOff = LEVEL_IDX_ADDR - WORK_RAM_BASE;
  // word @ 0x400394 (big-endian). Signedness is irrelevant for the ROM's
  // small indices; shift left two for long-aligned pointer-table access.
  const idxWord =
    (((r[idxOff] ?? 0) << 8) | (r[idxOff + 1] ?? 0)) & 0xffff;
  // asl.w #2 on the low word. Values used by the game fit this index range.
  const idxShifted = (idxWord << 2) & 0xffff;
  const idxShiftedSigned =
    idxShifted & 0x8000 ? idxShifted - 0x10000 : idxShifted;
  const ptrAddr = (ROM_PTR_TABLE_BASE + idxShiftedSigned) >>> 0;
  // long big-endian @ ptrAddr
  const listPtr =
    (((prog[ptrAddr] ?? 0) << 24) |
      ((prog[ptrAddr + 1] ?? 0) << 16) |
      ((prog[ptrAddr + 2] ?? 0) << 8) |
      (prog[ptrAddr + 3] ?? 0)) >>>
    0;

  // ─── Step 2: gate flag ──────────────────────────────────────────────
  const gateOff = GATE_FLAG_ADDR - WORK_RAM_BASE;
  if ((r[gateOff] ?? 0) === 0) return;

  // ─── Step 3: threshold cmp ──────────────────────────────────────────
  // For byte-table indexing with `(0,A0,D0w*1)`, M68k uses
  const idxSignedW = idxWord & 0x8000 ? idxWord - 0x10000 : idxWord;
  const thresholdAddr = (ROM_BYTE_TABLE_BASE + idxSignedW) >>> 0;
  const thresholdByte = (prog[thresholdAddr] ?? 0) & 0xff;
  const progressByte = (r[PROGRESS_ADDR - WORK_RAM_BASE] ?? 0) & 0xff;
  // bls = unsigned <= → exit
  if (thresholdByte <= progressByte) return;

  // ─── Step 4: char-list non-empty ────────────────────────────────────
  // Same source as the binary (ROM) via a helper.
  const firstByte = readByteAbs(state, rom, listPtr);
  if (firstByte === TERMINATOR) return;

  // ─── Step 5: outer loop ─────────────────────────────────────────────
  const countOff = OBJ_COUNT_ADDR - WORK_RAM_BASE;
  const count =
    (((r[countOff] ?? 0) << 8) | (r[countOff + 1] ?? 0)) & 0xffff;

  let outerObjAddr = OBJ_BASE_ADDR >>> 0;
  for (let i = 0; i < count; i++) {
    let matchFlag = false;
    const charcode =
      r[(outerObjAddr + OBJ_CHARCODE_OFF - WORK_RAM_BASE) >>> 0] ?? 0;
    let scanPtr = listPtr >>> 0;
    while (true) {
      const lb = readByteAbs(state, rom, scanPtr);
      if (lb === TERMINATOR) break;
      if (lb === charcode) {
        matchFlag = true;
      }
      scanPtr = (scanPtr + 1) >>> 0;
    }

    const stateByte =
      r[(outerObjAddr + OBJ_STATE_OFF - WORK_RAM_BASE) >>> 0] ?? 0;
    if (stateByte !== 1) {
      outerObjAddr = (outerObjAddr + OBJ_STRIDE) >>> 0;
      continue;
    }
    const filterByte =
      r[(outerObjAddr + OBJ_FILTER_FLAG_OFF - WORK_RAM_BASE) >>> 0] ?? 0;
    if (filterByte !== 0) {
      outerObjAddr = (outerObjAddr + OBJ_STRIDE) >>> 0;
      continue;
    }
    // signed-word @ +0x6A. Big-endian.
    const wOff = (outerObjAddr + OBJ_SIGNED_RANGE_OFF - WORK_RAM_BASE) >>> 0;
    const wU = (((r[wOff] ?? 0) << 8) | (r[wOff + 1] ?? 0)) & 0xffff;
    const wS = wU & 0x8000 ? wU - 0x10000 : wU;
    // moveq #7,D0; cmp.w (0x6a,A0),D0w; ble → 7 ≤ wS → skip
    if (7 <= wS) {
      outerObjAddr = (outerObjAddr + OBJ_STRIDE) >>> 0;
      continue;
    }
    // moveq #2,D0; cmp.w (0x6a,A0),D0w; bge → 2 ≥ wS → skip
    if (2 >= wS) {
      outerObjAddr = (outerObjAddr + OBJ_STRIDE) >>> 0;
      continue;
    }
    // tst.b D1; beq → match_flag == 0 → skip
    if (!matchFlag) {
      outerObjAddr = (outerObjAddr + OBJ_STRIDE) >>> 0;
      continue;
    }

    // 5c. Broadcast block.
    r[gateOff] = 0;
    let innerObjAddr = OBJ_BASE_ADDR >>> 0;
    for (let j = 0; j < count; j++) {
      const innerStateByte =
        r[(innerObjAddr + OBJ_STATE_OFF - WORK_RAM_BASE) >>> 0] ?? 0;
      if (innerStateByte === 1) {
        const flagOff =
          (innerObjAddr + OBJ_BROADCAST_FLAG_OFF - WORK_RAM_BASE) >>> 0;
        if (flagOff < WORK_RAM_SIZE) {
          r[flagOff] = 1;
        }
      }
      innerObjAddr = (innerObjAddr + OBJ_STRIDE) >>> 0;
    }

    outerObjAddr = (outerObjAddr + OBJ_STRIDE) >>> 0;
  }
}

/**
 *   - 0x400000..0x401FFF → workRam (recent updates are visible).
 *   - 0x000000..0x087FFF → rom.program (program ROM + slapstic bank 0).
 *     still from zero-initialized bus regions, equivalent behavior).
 *
 * (0x024a9a..0x024aaa in known call sites), but for robustness we support
 * both ROM and workRam as scan sources.
 */
function readByteAbs(state: GameState, rom: RomImage, abs: number): number {
  const a = abs >>> 0;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_BASE + WORK_RAM_SIZE) {
    return state.workRam[a - WORK_RAM_BASE] ?? 0;
  }
  if (a < rom.program.length) {
    return rom.program[a] ?? 0;
  }
  return 0;
}
