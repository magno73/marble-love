/**
 * sprite-pair-coord-add-1d82.ts — replica `FUN_00001D82` (134 byte).
 *
 * Extracts the signed 9-bit coordinate (bits 5..13) from two adjacent words in
 * Motion-Object RAM (banks `0xA02000` and `0xA02100`, separated by 0x100),
 * adds two independent deltas, and repacks the words while preserving the low
 * nibble.
 *
 * **Disasm 0x1D82..0x1E07** (134 byte):
 *
 *   00001d82    movem.l {D3 D2},-(SP)         ; save D2,D3 (8 byte)
 *   00001d86    move.w  (0xe,SP),D1w          ; D1 = arg1.lo (with the index)
 *   00001d8a    move.w  (0x12,SP),D2w         ; D2 = arg2.lo (bank index)
 *   00001d8e    move.w  (0x16,SP),D3w         ; D3 = arg3.lo (delta A1)
 *   00001d92    movea.l #0xa02000,A1          ; A1 base = sprite-bank A
 *   00001d98    movea.l #0xa02100,A0          ; A0 base = sprite-bank B
 *   00001d9e    moveq   0x0,D0
 *   00001da0    move.w  D2w,D0w               ; D0 = D2 (zero-extended)
 *   00001da2    lsl.l   #0x8,D0
 *   00001da4    add.l   D0,D0                 ; D0 = D2 << 9
 *   00001da6    add.l   A1,D0
 *   00001da8    movea.l D0,A1                 ; A1 = 0xA02000 + D2*0x200
 *   00001daa..1db8  (idem per A0)             ; A0 = 0xA02100 + D2*0x200
 *   00001db6    moveq   0x0,D0
 *   00001db8    move.w  D1w,D0w
 *   00001dba    add.l   D0,D0                 ; D0 = D1 << 1
 *   00001dbc    add.l   A1,D0
 *   00001dbe    movea.l D0,A1                 ; A1 += D1*2
 *   00001dc0..1dc8  (idem per A0)             ; A0 += D1*2
 *   00001dca    move.w  (A1),D0w              ; D0 = *A1
 *   00001dcc    asr.w   #0x5,D0w              ; arithmetic >> 5 (signed)
 *   00001dce    andi.w  #0x1ff,D0w            ; mask low 9 bit
 *   00001dd2    move.w  (A0),D2w              ; D2 = *A0
 *   00001dd4    asr.w   #0x5,D2w
 *   00001dd6    andi.w  #0x1ff,D2w
 *   00001dda    add.w   D3w,D0w               ; D0 += deltaA (arg3)
 *   00001ddc    add.w   (0x1a,SP),D2w         ; D2 += deltaB (arg4)
 *   00001de0    move.w  (A1),D1w              ; D1 = *A1
 *   00001de2    andi.w  #0xf,D1w              ; preserve bits 0..3
 *   00001de6    asl.w   #0x5,D0w              ; new coord << 5 -> bits 5..13
 *   00001de8    or.w    D0w,D1w
 *   00001dea    andi.w  #0x3fff,D1w           ; clear bit 14,15
 *   00001dee    move.w  D1w,(A1)              ; *A1 = repacked
 *   00001df0..1e00  (idem per A0)             ; *A0 = repacked
 *   00001e02    movem.l (SP)+,{D2 D3}
 *   00001e06    rts
 *
 * **Semantics**: the two banks (A=0xA02000, B=0xA02100) are the same 0x200-byte
 * bank offset by 0x100 (= 128 words = 64 entries at 4 bytes each). Each word
 * has this layout:
 *
 *   bit 13..5   : signed 9-bit "coord" (mask 0x1FF, asr per estrarre)
 *
 *
 * **Args** (4 longwords on the stack, 68k cdecl):
 *   - arg2 (long): bank index. Only low word (D2.w). Typical range [0..7].
 *   - arg3 (long): deltaA. Only low word (D3.w). Added word-wise to the coord
 *                  estratta da `*A1` (sprite-ram bank A).
 *   - arg4 (long): deltaB. Only low word (`(0x1A,SP)`). Added word-wise to the
 *                  coord extracted from `*A0` (sprite-ram bank B).
 *
 * **Side effects**:
 *   - `state.spriteRam[(bank*0x200)+(with the*2)..+1]`     (word, BE) — bank A
 *   - `state.spriteRam[0x100+(bank*0x200)+(with the*2)..]` (word, BE) — bank B
 *
 * Used by scenes with precomputed delta-x and delta-y tables.
 *
 * sprite-ram.
 *
 */

import type { GameState } from "./state.js";

/** SPRITE-RAM bank A base (`0xA02000`). */
export const SPRITE_RAM_BANK_A_ADDR = 0x00a02000 as const;

/** SPRITE-RAM bank B base (`0xA02100` = bank A + 0x100). */
export const SPRITE_RAM_BANK_B_ADDR = 0x00a02100 as const;

/** Bank stride: each arg2 bank advances by 0x200 bytes (= 256 words). */
export const BANK_STRIDE_BYTES = 0x200 as const;

export const COORD_PACK_MASK = 0x3fff as const;

/** Mask 0xF preserves the low nibble (bits 0..3) of the original word. */
export const COORD_LOW_NIBBLE_MASK = 0x000f as const;

/** Mask 0x1FF = signed 9-bit coordinate field. */
export const COORD_FIELD_MASK = 0x01ff as const;

/** Coordinate shift in pack/unpack (bits 5..13). */
export const COORD_SHIFT = 5 as const;

// ─── Internal helpers ────────────────────────────────────────────────────

function readU16BE(ram: Uint8Array, off: number): number {
  return (((ram[off] ?? 0) << 8) | (ram[off + 1] ?? 0)) & 0xffff;
}

function writeU16BE(ram: Uint8Array, off: number, value: number): void {
  ram[off] = (value >>> 8) & 0xff;
  ram[off + 1] = value & 0xff;
}

/**
 * Replica of the "extract -> add -> repack" step for one sprite-RAM word.
 *
 * Equivalent to block 0x1DCA..0x1DEE (and 0x1DF0..0x1E00 for A0).
 *
 * @param delta    16-bit delta word to add to the coordinate
 * @returns        repacked word (14 valid bits, bits 14 and 15 clear)
 */
function repackCoord(oldWord: number, delta: number): number {
  // Cast to sign-extended int16, shift right by 5, then mask to 0x1FF.
  const signed16 = (oldWord & 0x8000) ? oldWord - 0x10000 : oldWord;
  const coord = (signed16 >> COORD_SHIFT) & COORD_FIELD_MASK;
  // add.w D3w,D0w: 16-bit word addition modulo 2^16.
  const added = (coord + (delta & 0xffff)) & 0xffff;
  const shifted = (added << COORD_SHIFT) & 0xffff;
  // OR with the low nibble from the original word.
  const lowNibble = oldWord & COORD_LOW_NIBBLE_MASK;
  // andi.w #0x3FFF: clear bit 14,15.
  return (shifted | lowNibble) & COORD_PACK_MASK;
}

// Public API.

/**
 *
 * Applies `deltaA` to the 9-bit coordinate at bank A and `deltaB` to the
 * 9-bit coordinate at bank B for the given `bank` and `with the`.
 *
 *                offset bytes = `with the * 2`. Callers typically use 0..0x37.
 *                offset bytes = `bank * 0x200`. Callers typically use 0..7.
 * @param deltaA  Delta word (`arg3 & 0xFFFF`) added to the 9-bit coordinate of
 *                bank A (`*0xA02000 + bank*0x200 + with the*2`).
 * @param deltaB  Delta word (`arg4 & 0xFFFF`) added to the 9-bit coordinate of
 *                bank B (`*0xA02100 + bank*0x200 + with the*2`).
 *
 * parity tests use only valid input).
 */
export function spritePairCoordAdd1D82(
  state: GameState,
  col: number,
  bank: number,
  deltaA: number,
  deltaB: number,
): void {
  // Only the low word of each arg is used, matching `move.w (offs,SP),Dxw`.
  const colW = col & 0xffff;
  const bankW = bank & 0xffff;
  const dA = deltaA & 0xffff;
  const dB = deltaB & 0xffff;

  // A1 = 0xA02000 + (bank << 9) + (with the << 1) — long add wrapping a 32 bit.
  const baseOff = (((bankW << 9) >>> 0) + ((colW << 1) >>> 0)) >>> 0;
  // bank A: spriteRam offset 0 + baseOff
  const offA = baseOff;
  // bank B: spriteRam offset 0x100 + baseOff
  const offB = (baseOff + 0x100) >>> 0;

  // Kept explicit for clarity.
  const oldA = readU16BE(state.spriteRam, offA);
  const oldB = readU16BE(state.spriteRam, offB);

  writeU16BE(state.spriteRam, offA, repackCoord(oldA, dA));
  writeU16BE(state.spriteRam, offB, repackCoord(oldB, dB));
}
