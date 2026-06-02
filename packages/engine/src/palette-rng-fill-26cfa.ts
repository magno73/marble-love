/**
 * Port of ROM routine `FUN_00026CFA`.
 *
 * Fills eight palette entries starting at `0xB00202` with 32-byte stride. For
 * each entry, RNG `FUN_13A98(2)` selects one of two 6-byte variants (3 words)
 * from the ROM table at `0x20BB4` (8 entries x 12 bytes).
 *
 * Layout per entry i (i=0..7):
 *   - dest    = 0xB00202 + i*32
 *   - tableI  = 0x20BB4 + i*12
 *   - rnd     = rngNext(state.rng, 2)         ; 0 or 1
 *   - srcOff  = (rnd != 0) ? 6 : 0
 *   - src     = tableI + srcOff               ; 6 bytes / 3 words
 *   - palette[dest + 0..1]  = 0xAFFF          ; (-0x5001 sext signed → u16)
 *   - palette[dest + 2..3]  = 0xCFC0          ; (-0x3040 sext signed → u16)
 *   - palette[dest + 4..5]  = ROM_BE_u16(src + 0)
 *   - palette[dest + 6..7]  = ROM_BE_u16(src + 2)
 *   - palette[dest + 8..9]  = ROM_BE_u16(src + 4)
 *
 *
 * Dependency: `rngNext` from `rng.ts`, the `FUN_00013A98` port.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { rngNext } from "./rng.js";
import { as_u16 } from "./wrap.js";

// ─── Constants ────────────────────────────────────────────────────────────

/** Palette RAM destination base (entry 0). */
export const PAL_DEST_BASE = 0xb00202 as const;
/** Palette RAM stride between consecutive entries. */
export const PAL_DEST_STRIDE = 0x20 as const;
/** Number of generated entries. */
export const ENTRY_COUNT = 8 as const;
/** ROM table base (8 entries × 12 bytes). */
export const ROM_TABLE_BASE = 0x20bb4 as const;
/** ROM table entry stride (two 6-byte sub-entries). */
export const ROM_TABLE_STRIDE = 12 as const;
export const ROM_SUBENTRY_ALT_OFFSET = 6 as const;

/** Header word 1 — `move.w #-0x5001, (A2)+`. */
export const HEADER_WORD_1 = 0xafff as const; // sext(-0x5001) & 0xffff
/** Header word 2 — `move.w #-0x3040, (A2)+`. */
export const HEADER_WORD_2 = 0xcfc0 as const; // sext(-0x3040) & 0xffff

export const RNG_LIMIT = 2 as const;

/** Palette RAM base, used to map absolute offsets to `colorRam` byte indices. */
const PAL_RAM_BASE = 0xb00000 as const;

// ─── Helpers ──────────────────────────────────────────────────────────────

function romReadU16BE(rom: RomImage, offset: number): number {
  return (((rom.program[offset] ?? 0) << 8) | (rom.program[offset + 1] ?? 0)) & 0xffff;
}

function colorRamWriteU16BE(state: GameState, offset: number, value: number): void {
  state.colorRam[offset] = (value >>> 8) & 0xff;
  state.colorRam[offset + 1] = value & 0xff;
}

// ─── Tick ─────────────────────────────────────────────────────────────────

/**
   * Writes 8 x 5 words in palette RAM starting at `0xB00202`.
 *
 */
export function paletteRngFill26CFATick(
  state: GameState,
  rom: RomImage,
): void {
  let palOff = PAL_DEST_BASE - PAL_RAM_BASE;

  for (let i = 0; i < ENTRY_COUNT; i++) {
    const tableEntry = ROM_TABLE_BASE + i * ROM_TABLE_STRIDE;

    //
    // Caveat: `rngNext` mirrors the ROM loop; normalize to modulo here.
    let rnd = rngNext(state.rng, as_u16(RNG_LIMIT)) as unknown as number;
    while (rnd >= RNG_LIMIT) rnd -= RNG_LIMIT;
    const src = tableEntry + (rnd !== 0 ? ROM_SUBENTRY_ALT_OFFSET : 0);

    // Constant header words.
    colorRamWriteU16BE(state, palOff, HEADER_WORD_1);
    palOff += 2;
    colorRamWriteU16BE(state, palOff, HEADER_WORD_2);
    palOff += 2;

    // Three words from the selected ROM-table sub-entry.
    colorRamWriteU16BE(state, palOff, romReadU16BE(rom, src + 0));
    palOff += 2;
    colorRamWriteU16BE(state, palOff, romReadU16BE(rom, src + 2));
    palOff += 2;
    colorRamWriteU16BE(state, palOff, romReadU16BE(rom, src + 4));
    palOff += 2;

    // Skip 22 bytes (11 words) to reach the 32-byte stride.
    palOff += 0x16;
  }
}
