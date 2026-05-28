/**
 * Bit-faithful port of ROM routine `FUN_00019E42`.
 *
 * The routine copies an entity's X/Y words into the global position scratch,
 * derives a packed screen-space long at entity offset `0x20`, then dispatches
 * on an 8x8 cell test. Cells X `{0x29, 0x31, 0x39}` with signed cellY >= 0x34
 * call `FUN_264AA(entity, 3)`; every other cell clears three entity words at
 * `0x26 + i*6`.
 *
 * Known callers:
 *   - `FUN_00019A40` @ 0x19B56
 *   - `FUN_00019BAA` @ 0x19D46
 *
 * `FUN_264AA` is injected through `Inner264AA` so parity tests can replace the
 * ROM call with a stub while the production path wires the real helper.
 */

import type { GameState } from "./state.js";

/** M68K work RAM base. */
const WORK_RAM_BASE = 0x400000;

// ─── Globals (workRam offsets relative to 0x400000) ──────────────────────

/** POS_X workRam offset (absolute 0x400690), big-endian word. */
export const POS_X_WORD_OFF = 0x690 as const;
/** POS_Y workRam offset (absolute 0x400692), big-endian word. */
export const POS_Y_WORD_OFF = 0x692 as const;
/** HUD_OFFSET workRam offset (absolute 0x40097E), big-endian word. */
export const HUD_OFFSET_WORD_OFF = 0x97e as const;

// ─── Entity offsets (A1) ─────────────────────────────────────────────────

export const ENTITY_X_OFF = 0x0c as const;
export const ENTITY_Y_OFF = 0x10 as const;
export const ENTITY_W4_OFF = 0x14 as const;
export const ENTITY_PACKED_OFF = 0x20 as const;
/** Entity base offset for the clear loop: three words at `0x26 + i*6`. */
export const ENTITY_CLEAR_BASE_OFF = 0x26 as const;
/** Clear-loop stride in bytes. */
export const CLEAR_STRIDE = 6 as const;
/** Number of words cleared on the MISS branch. */
export const CLEAR_COUNT = 3 as const;

// ─── Algorithm constants ─────────────────────────────────────────────────

/** Bias for `D3w = posY - posX + 0x88`. */
export const YMINUSX_BIAS = 0x88 as const;
/** Bias for `D2w = HUD + w4 + 0x54`. */
export const HUD_BIAS = 0x54 as const;
export const CELL_SHIFT = 3 as const;

/** Hard-coded mode passed as the second long argument to `FUN_264AA`. */
export const INNER_MODE = 3 as const;

export const HIT_CELLX_SET: readonly number[] = [0x29, 0x31, 0x39] as const;
export const HIT_CELLY_THRESHOLD = 0x34 as const;

// ─── Sub injection ───────────────────────────────────────────────────────

/**
 * Callback that models `FUN_000264AA`. Receives `(structPtr, mode)` as long
 * arguments, matching the ROM stack convention.
 *
 * @param structPtr  `A1`, verbatim and not normalized.
 * @param mode       Hard-coded to `INNER_MODE = 3`.
 */
export type Inner264AA = (structPtr: number, mode: number) => number;

/** Injection point for the `jsr FUN_264AA` call. */
export interface MarbleCellDispatch19E42Subs {
  inner264AA?: Inner264AA;
}


export type DispatchBranch = "hit" | "miss";

export interface MarbleCellDispatch19E42Result {
  branch: DispatchBranch;
  /** Low byte of `cellX = entity.x_word >> 3`; signedness is irrelevant here. */
  cellX: number;
  /** `cellY = (entity.y_word >> 3)` low byte. */
  cellY: number;
  /** Packed long written to `entity[0x20..0x23]`. */
  packed: number;
  innerCalls: number;
  innerReturn: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function readU16(state: GameState, off: number): number {
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}

function writeU16(state: GameState, off: number, v: number): void {
  state.workRam[off] = (v >>> 8) & 0xff;
  state.workRam[off + 1] = v & 0xff;
}

function writeU32(state: GameState, off: number, v: number): void {
  const u = v >>> 0;
  state.workRam[off] = (u >>> 24) & 0xff;
  state.workRam[off + 1] = (u >>> 16) & 0xff;
  state.workRam[off + 2] = (u >>> 8) & 0xff;
  state.workRam[off + 3] = u & 0xff;
}

function sext16(w: number): number {
  return (w & 0x8000) !== 0 ? w - 0x10000 : w;
}

function sext8(b: number): number {
  return (b & 0x80) !== 0 ? b - 0x100 : b;
}

// ─── Port ────────────────────────────────────────────────────────────────

/**
 * Runs `FUN_00019E42` against one entity.
 *
 * Side effects:
 *   1. `workRam[0x690..0x691]` = entity[0xC..0xD]
 *   2. `workRam[0x692..0x693]` = entity[0x10..0x11]
 *   3. `entity[0x20..0x23]` = packed long
 *   4. HIT:  `subs.inner264AA(entity, 3)`
 *      MISS: clear `entity[0x26]`, `entity[0x2C]`, and `entity[0x32]` as words.
 */
export function marbleCellDispatch19E42(
  state: GameState,
  entityAddr: number,
  subs?: MarbleCellDispatch19E42Subs,
): MarbleCellDispatch19E42Result {
  const a1 = entityAddr >>> 0;
  const argOff = (a1 - WORK_RAM_BASE) >>> 0;

  // `lea (0xC,A1),A0; move.w (A0),(A2)` → *0x400690 = entity[0xC..0xD]
  // `lea (0x10,A1),A0; move.w (A0),(A3)` → *0x400692 = entity[0x10..0x11]
  const w0 = readU16(state, argOff + ENTITY_X_OFF);
  const w2 = readU16(state, argOff + ENTITY_Y_OFF);
  const w4 = readU16(state, argOff + ENTITY_W4_OFF);

  writeU16(state, POS_X_WORD_OFF, w0);
  writeU16(state, POS_Y_WORD_OFF, w2);

  // D3.w = (posY - posX + 0x88) (word arithmetic).
  const yMinusX = ((w2 - w0) + YMINUSX_BIAS) & 0xffff;

  // D2.w = HUD + w4 + 0x54  (word arithmetic).
  const hudOff = readU16(state, HUD_OFFSET_WORD_OFF);
  let d2w = (hudOff + w4 + HUD_BIAS) & 0xffff;

  // D0 (long) = sext_l(posY) + sext_l(posX); D0 >>= 1 (asr.l #1, signed).
  const yS = sext16(w2);
  const xS = sext16(w0);
  const avgLong = (yS + xS) >> 1;
  d2w = (d2w - (avgLong & 0xffff)) & 0xffff;

  // D2 (long) = D2w (zero-extended)
  const d2Long = d2w & 0xffff;

  const d3Signed = sext16(yMinusX);
  const d1Long = ((d3Signed << 16) | 0) >>> 0;

  // packed = D1 + D2 (add.l D1,D2)
  const packed = (d1Long + d2Long) >>> 0;

  writeU32(state, argOff + ENTITY_PACKED_OFF, packed);

  // ─── Step 4: derive cellX / cellY (asr.w #3 = signed shift right) ─────
  //   cellX_word = sext16(entity.x) >> 3
  //   cellY_word = sext16(entity.y) >> 3
  //   cellX = low byte di cellX_word
  //   cellY = low byte di cellY_word
  const cellXWord = xS >> CELL_SHIFT;
  const cellYWord = yS >> CELL_SHIFT;
  const cellX = cellXWord & 0xff;
  const cellY = cellYWord & 0xff;

  // ─── Step 5: dispatch HIT / MISS ──────────────────────────────────────
  // HIT: cellX ∈ {0x39, 0x31, 0x29}  AND  cellY (signed) >= 0x34
  // (cmpi.b #0x34, D0b; blt → MISS  ⇔  cellY < 0x34 signed)
  const cellXMatch =
    cellX === 0x39 || cellX === 0x31 || cellX === 0x29;
  const cellYOk = sext8(cellY) >= HIT_CELLY_THRESHOLD;

  if (cellXMatch && cellYOk) {
    // HIT branch: jsr FUN_264AA(entity, 3)
    const innerReturn =
      subs?.inner264AA !== undefined
        ? subs.inner264AA(a1, INNER_MODE) >>> 0
        : 0;
    return {
      branch: "hit",
      cellX,
      cellY,
      packed,
      innerCalls: subs?.inner264AA !== undefined ? 1 : 0,
      innerReturn,
    };
  }

  // MISS branch: clear three words at `entity[0x26 + i*6]`.
  for (let i = 0; i < CLEAR_COUNT; i++) {
    writeU16(state, argOff + ENTITY_CLEAR_BASE_OFF + i * CLEAR_STRIDE, 0);
  }

  return {
    branch: "miss",
    cellX,
    cellY,
    packed,
    innerCalls: 0,
    innerReturn: 0,
  };
}
