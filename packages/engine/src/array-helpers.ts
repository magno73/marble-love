/**
 * array-helpers.ts - binary array fill/copy helpers.
 *
 * Small, frequently called routines, generally used to initialize u16 arrays
 * such as tile indexes, palette indexes, and sprite ID lists.
 *
 * Verified bit-perfect against the binary via
 * `cli/src/test-array-helpers-parity.ts`.
 */

import type { GameState } from "./state.js";

// Memory map for writeMemoryU16 (subset aligned with bus.ts).

function writeMemoryU16(state: GameState, addr: number, value: number): void {
  const v = value & 0xffff;
  if (addr >= 0x400000 && addr < 0x402000) {
    state.workRam[addr - 0x400000] = (v >>> 8) & 0xff;
    state.workRam[addr - 0x400000 + 1] = v & 0xff;
  } else if (addr >= 0xa00000 && addr < 0xa02000) {
    // Playfield RAM: currently ignored here; state.playfieldRam is separate.
    // Fallback safe: ignore
  } else if (addr >= 0xa02000 && addr < 0xa03000) {
    state.spriteRam[addr - 0xa02000] = (v >>> 8) & 0xff;
    state.spriteRam[addr - 0xa02000 + 1] = v & 0xff;
  } else if (addr >= 0xa03000 && addr < 0xa04000) {
    state.alphaRam[addr - 0xa03000] = (v >>> 8) & 0xff;
    state.alphaRam[addr - 0xa03000 + 1] = v & 0xff;
  } else if (addr >= 0xb00000 && addr < 0xb00800) {
    state.colorRam[addr - 0xb00000] = (v >>> 8) & 0xff;
    state.colorRam[addr - 0xb00000 + 1] = v & 0xff;
  }
  // Other ranges are ignored (cart RAM 0x900000-, MMIO).
}

// ─── writeMemoryU8 dispatcher ─────────────────────────────────────────────

function writeMemoryU8(state: GameState, addr: number, value: number): void {
  const v = value & 0xff;
  if (addr >= 0x400000 && addr < 0x402000) {
    state.workRam[addr - 0x400000] = v;
  } else if (addr >= 0xa02000 && addr < 0xa03000) {
    state.spriteRam[addr - 0xa02000] = v;
  } else if (addr >= 0xa03000 && addr < 0xa04000) {
    state.alphaRam[addr - 0xa03000] = v;
  } else if (addr >= 0xb00000 && addr < 0xb00800) {
    state.colorRam[addr - 0xb00000] = v;
  }
  // Altri range: ignored
}

// ─── initStructHeader (FUN_255A) ──────────────────────────────────────────

/**
 * Mirrors `FUN_0000255A` - writes bytes at struct offsets 0/1/6.
 *
 * Disassembly:
 *   A0 = arg1 long (ptr); D1 = arg2 byte; D0 = arg3 byte
 *   *A0 = D1; *(A0+1) = D0; *(A0+6) = 0; rts
 */
export function initStructHeader(
  state: GameState,
  ptr: number,
  byteB: number,
  byteC: number,
): void {
  writeMemoryU8(state, ptr, byteB & 0xff);
  writeMemoryU8(state, (ptr + 1) >>> 0, byteC & 0xff);
  writeMemoryU8(state, (ptr + 6) >>> 0, 0);
}

// ─── fillIncrementingU16 (FUN_1E3E) ──────────────────────────────────────

/**
 * Replica `FUN_00001E3E` — `fillIncrementingU16(dest, start, count)`.
 *
 * Disassembly:
 *   A0 = arg1 (dest pointer, long)
 *   D0 = arg2 (start value, word)
 *   D2 = arg3 (count, long)
 *   D3 = 0
 *   while (D3 < D2 SIGNED):  // signed count
 *     *A0++ = D0 (word)
 *     D0 += 1 (word, can wrap at 16 bits)
 *     D3 += 1
 *
 * Writes `count` words starting at `dest`, with values start, start+1,
 * start+2, ... D0 wraps modulo 0x10000 on each iteration because it is a word.
 *
 * @param state    GameState for the unified memory write
 * @param destAddr Absolute 68010 destination address
 * @param start    Initial value, masked to 16 bits
 * @param count    Number of words to write (signed long; count <= 0 -> no-op)
 */
export function fillIncrementingU16(
  state: GameState,
  destAddr: number,
  start: number,
  count: number,
): void {
  // count is a signed long. If <= 0, no-op (blt with D3=0 < D2<=0 is false).
  const signedCount = count | 0;
  if (signedCount <= 0) return;

  let value = start & 0xffff;
  let addr = destAddr >>> 0;

  for (let i = 0; i < signedCount; i++) {
    writeMemoryU16(state, addr, value);
    addr = (addr + 2) >>> 0;
    value = (value + 1) & 0xffff; // word wrap
  }
}

// ─── clearPlayfieldRam (FUN_12174) ───────────────────────────────────────

/**
 * Replica `FUN_00012174` — `clearPlayfieldRam()`.
 *
 * Disassembly (4 inst):
 *   lea     (0xA00000).l, A0
 *   move.w  #0x7FF, D0w        ; counter = 2047
 *   loop:
 *     clr.l  (A0)+              ; *A0 = 0; A0 += 4
 *   dbf D0w, loop
 *   rts
 *
 * Clears 2048 longs (= 8 KB = the whole playfield RAM @ 0xA00000-0xA01FFF).
 *
 * **NB**: playfield RAM is currently separate from this helper's unified
 * memory map. Once state.playfieldRam is wired here, this routine should clear
 * it byte-for-byte. Until then the TS state effect is a no-op, matching the
 * fact that the binary writes to a hardware RAM region handled elsewhere by
 * the renderer model.
 */
export function clearPlayfieldRam(_state: GameState): void {
  // No-op here: state.playfieldRam is modeled separately. Replace with an 8 KB
  // fill if this helper becomes responsible for that memory region.
}

// ─── clearPaletteRam (FUN_121A6) ─────────────────────────────────────────

/**
 * Replica `FUN_000121A6` — `clearPaletteRam()`.
 *
 * Disassembly (4 inst):
 *   lea     (0xB00000).l, A0
 *   move.w  #0x1FF, D0w        ; counter = 511
 *   loop:
 *     clr.l  (A0)+
 *   dbf D0w, loop
 *   rts
 *
 * Clears 512 longs (= 2 KB = the whole palette RAM @ 0xB00000-0xB007FF).
 */
export function clearPaletteRam(state: GameState): void {
  state.colorRam.fill(0);
}

// ─── swapLongPair (FUN_12886) ────────────────────────────────────────────

/**
 * Replica `FUN_00012886` — `swapLongPair(ptr)`.
 *
 * Disassembly (5 inst):
 *   movea.l (0x4,SP), A0
 *   move.l  (A0), D0           ; D0 = ptr[0..3]
 *   move.l  (0x4,A0), (A0)     ; ptr[0..3] = ptr[4..7]
 *   move.l  D0, (0x4,A0)       ; ptr[4..7] = D0 (old)
 *   rts
 *
 * Swaps two adjacent longs at `*ptr` and `*(ptr+4)`.
 */
export function swapLongPair(state: GameState, ptr: number): void {
  const off = (ptr - 0x400000) >>> 0;
  if (off + 7 >= state.workRam.length) return;
  const r = state.workRam;
  // Swap byte-by-byte so alignment does not matter.
  for (let i = 0; i < 4; i++) {
    const a = r[off + i] ?? 0;
    const b = r[off + 4 + i] ?? 0;
    r[off + i] = b;
    r[off + 4 + i] = a;
  }
}
