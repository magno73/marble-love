/**
 *
 *
 *      entity (not self, status != 0, kind != 2) with |dx| < 0xC and |dy| < 0xC.
 *
 *
 *
 *
 * **Disasm 0x1937C..0x193D8** (90 byte):
 *
 *   movem.l  {D4,D3,D2},-(SP)               ; save D2..D4
 *   movea.l  (0x10,SP),A1                   ; A1 = arg (entity ptr)
 *   lea      (0xc,A1),A0
 *   move.w   (A0),D3w                       ; D3w = entity[0xC..0xD] (x word)
 *   lea      (0x10,A1),A0
 *   move.w   (A0),D4w                       ; D4w = entity[0x10..0x11] (y word)
 *   moveq    #0x1,D2                        ; D2 = 1 (default "valid")
 *
 *   ; first: FUN_193D8(entity, x_long, y_long)
 *   move.w   D4w,D0w
 *   ext.l    D0
 *   move.l   D0,-(SP)                       ; push y as long (sext)
 *   move.w   D3w,D0w
 *   ext.l    D0
 *   move.l   D0,-(SP)                       ; push x as long (sext)
 *   move.l   A1,-(SP)                       ; push entity ptr
 *   jsr      0x000193d8.l
 *   tst.l    D0
 *   lea      (0xc,SP),SP                    ; pop 3 long args
 *
 *   ; second: FUN_19460(x_long, y_long)
 *   move.w   D4w,D0w
 *   ext.l    D0
 *   move.l   D0,-(SP)
 *   move.w   D3w,D0w
 *   ext.l    D0
 *   move.l   D0,-(SP)
 *   jsr      0x00019460.l
 *   tst.l    D0
 *   addq.l   #8,SP
 *   bne.w    0x193cc                        ; if D0 != 0 → invalid
 *
 *   clr.b    D2b                            ; valid: D2 = 0… invertito!
 * 0x193cc:
 *   move.b   D2b,D0b
 *   ext.w    D0w
 *   ext.l    D0                             ; D0 = D2 sign-extended
 *   movem.l  (SP)+,{D2,D3,D4}
 *   rts
 *
 *   - D2 starts at 1 (default).
 *   - only if both return 0 → `clr.b D2b` → return 0.
 *
 *   - D0 != 0 (occupied) → fall-through (apply move anyway)
 *
 * "0 = free position → restore (entity does not move)", "1 = occupied position →
 *
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── Costanti ────────────────────────────────────────────────────────────

export const ROM_GRID_BASE = 0x24496 as const;
export const PROX_ARRAY_BASE = 0x401890 as const;
export const PROX_ARRAY_COUNT = 9 as const;
export const PROX_ARRAY_STRIDE = 0x28 as const;
/** Distanza massima (esclusa) per match proximity. */
export const PROX_THRESHOLD = 0x0c as const;
/** Offset entity[0xC] (x word). */
export const ENTITY_POS_X_OFFSET = 0x0c as const;
/** Offset entity[0x10] (y word). */
export const ENTITY_POS_Y_OFFSET = 0x10 as const;
/** Offset entity[0x18] (status byte: 0 = libero/skip). */
export const ENTITY_STATUS_OFFSET = 0x18 as const;
/** Offset entity[0x1A] (kind byte: 2 = skip). */
export const ENTITY_KIND_OFFSET = 0x1a as const;
/** Kind skipped in proximity checks (`kind == 2`). */
export const KIND_SKIP = 0x02 as const;
/** Soglia di shift per il grid bitmap (`x >> 3`). */
export const GRID_SHIFT = 0x03 as const;
/** Offset del primo asse nel grid bitmap (`x_byte - 0x59`). */
export const GRID_X_BIAS = 0x59 as const;
/** Offset del secondo asse nel grid bitmap (`y_byte - 0x5A`). */
export const GRID_Y_BIAS = 0x5a as const;
/** Range valido per ciascun asse nel grid bitmap (`[0, 0xF]`). */
export const GRID_RANGE_MAX = 0x0f as const;

// ─── Helpers ─────────────────────────────────────────────────────────────

function readWord(s: GameState, off: number): number {
  return (((s.workRam[off] ?? 0) << 8) | (s.workRam[off + 1] ?? 0)) & 0xffff;
}

function sextWord(w: number): number {
  return w & 0x8000 ? w - 0x10000 : w;
}

function absSigned(v: number): number {
  return v < 0 ? -v : v;
}

// ─── FUN_193D8: proximity check ──────────────────────────────────────────

/**
 *
 *
 * checks `tst.w D5w; bge ... neg.l D0` to obtain the word magnitude.
 */
export function sub193D8ProximityCheck(
  state: GameState,
  excludePtr: number,
  xWord: number,
  yWord: number,
): number {
  const xSigned = sextWord(xWord & 0xffff);
  const ySigned = sextWord(yWord & 0xffff);
  for (let i = 0; i < PROX_ARRAY_COUNT; i++) {
    const entryAddr = (PROX_ARRAY_BASE + i * PROX_ARRAY_STRIDE) >>> 0;
    if (excludePtr === entryAddr) continue;
    const off = entryAddr - 0x400000;
    if (((state.workRam[off + ENTITY_STATUS_OFFSET] ?? 0) & 0xff) === 0) continue;
    if (((state.workRam[off + ENTITY_KIND_OFFSET] ?? 0) & 0xff) === KIND_SKIP) continue;
    const xPos = sextWord(readWord(state, off + ENTITY_POS_X_OFFSET));
    const yPos = sextWord(readWord(state, off + ENTITY_POS_Y_OFFSET));
    const dx = absSigned(xPos - xSigned);
    const dy = absSigned(yPos - ySigned);
    if (dx >= PROX_THRESHOLD) continue;
    if (dy >= PROX_THRESHOLD) continue;
    return 1;
  }
  return 0;
}

// ─── FUN_19460: grid bitmap test ─────────────────────────────────────────

/**
 * Replica `FUN_00019460`: test bit nel grid bitmap ROM @ 0x24496.
 *
 * Computa `x_idx = (x_word >> 3) - 0x59` (byte) e `y_idx = (y_word >> 3) - 0x5A`
 * `(word_val & (1 << x_idx)) != 0 ? 1 : 0`.
 *
 * Per matchare i flag M68K l'address mode `(0,A0,D0w*1)` usa D0 come word,
 */
export function sub19460GridBitmap(
  rom: RomImage,
  xWord: number,
  yWord: number,
): number {
  const xSigned = sextWord(xWord & 0xffff);
  const ySigned = sextWord(yWord & 0xffff);
  // x_byte = (xSigned >> 3) & 0xff; D2.b = x_byte - 0x59 (signed byte arithmetic)
  const xShifted = (xSigned >> 3) & 0xff;
  const yShifted = (ySigned >> 3) & 0xff;
  const xRaw = (xShifted - GRID_X_BIAS) & 0xff;
  const yRaw = (yShifted - GRID_Y_BIAS) & 0xff;
  const xIdxSigned = xRaw & 0x80 ? xRaw - 0x100 : xRaw;
  const yIdxSigned = yRaw & 0x80 ? yRaw - 0x100 : yRaw;
  if (xIdxSigned < 0 || xIdxSigned > GRID_RANGE_MAX) return 1;
  if (yIdxSigned < 0 || yIdxSigned > GRID_RANGE_MAX) return 1;

  // D0 = sext_word(y_idx) * 2 (word index in ROM table).
  const romIdx = (ROM_GRID_BASE + yIdxSigned * 2) >>> 0;
  const hi = rom.program[romIdx] ?? 0;
  const lo = rom.program[romIdx + 1] ?? 0;
  const rawWord = (hi << 8) | lo;
  const wordSigned = rawWord & 0x8000 ? rawWord - 0x10000 : rawWord;

  // mask = 1 << x_raw_byte. Per x_idxSigned in [0..0xF] → mask in [0x1..0x8000].
  const mask = (1 << (xRaw & 0x3f)) >>> 0;
  return (wordSigned & mask) !== 0 ? 1 : 0;
}

// ─── FUN_1937C: validate position (orchestrator) ─────────────────────────

/**
 *
 * @param rom         RomImage per `FUN_19460` (grid bitmap @ ROM[0x24496]).
 *
 *          "libera". NB: il caller `FUN_19692`/`FUN_198BC` usa `tst.l D0;
 */
export function sub1937C(
  state: GameState,
  rom: RomImage,
  entityAddr: number,
): number {
  const off = (entityAddr - 0x400000) >>> 0;
  const xWord = readWord(state, off + ENTITY_POS_X_OFFSET);
  const yWord = readWord(state, off + ENTITY_POS_Y_OFFSET);

  // FUN_193D8: if returns != 0 → return 1 (D2 stays 1).
  if (sub193D8ProximityCheck(state, entityAddr, xWord, yWord) !== 0) return 1;
  // FUN_19460: if returns != 0 → return 1.
  if (sub19460GridBitmap(rom, xWord, yWord) !== 0) return 1;
  // Both 0 → D2 cleared → return 0.
  return 0;
}

/**
 * (`StateSub198BCSubs.fun_1937c`, `Sub19692Subs.fun_1937c`).
 *
 * @param rom  RomImage da iniettare (catturato in closure).
 * @returns    closure `(state, entityAddr) => number`.
 */
export function sub1937CAsInjection(
  rom: RomImage,
): (state: GameState, entityAddr: number) => number {
  return (state: GameState, entityAddr: number): number => {
    return sub1937C(state, rom, entityAddr);
  };
}
