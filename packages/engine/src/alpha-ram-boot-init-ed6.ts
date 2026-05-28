/**
 * Replica of `FUN_00000ED6`, the cold-boot alpha RAM fill routine.
 *
 * The routine copies three 42-word ROM rows from `0x6928` into 30 alpha RAM
 * rows: each source row is repeated for ten destination rows. It then overwrites
 * the center span of the first and last affected rows with blank tile word
 * `0x2000`.
 *
 * Geometry:
 *   - Three outer bands, ten rows per band, 42 copied words per row.
 *   - Destination row stride is 0x80 bytes.
 *   - Loop 2 writes `0x2000` to alpha RAM offsets 0x008..0x04B.
 *   - Loop 3 writes `0x2000` to alpha RAM offsets 0xE88..0xECB.
 *
 * Verified by `packages/cli/src/test-alpha-ram-boot-init-ed6-parity.ts`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

export const ALPHA_RAM_BOOT_INIT_ED6_ADDR = 0x00000ed6 as const;

/** Alpha RAM base address; offset 0 in `state.alphaRam`. */
export const ALPHA_RAM_BASE_ADDR = 0x00a03000 as const;

export const SOURCE_TABLE_ROM_ADDR = 0x00006928 as const;

/** Number of outer bands. */
export const QUADRANT_COUNT = 3 as const;

/** Rows per outer band. */
export const ROW_PER_QUADRANT = 10 as const;

/** Words copied per row. */
export const WORDS_PER_ROW = 42 as const;

/** Byte stride between consecutive alpha RAM rows. */
export const ROW_STRIDE_BYTES = 0x80 as const;

export const SOURCE_QUADRANT_STRIDE_BYTES = 0x54 as const;

export const BLANK_TILE_WORD = 0x2000 as const;

export const FILL_LOOP_D2_START = 4 as const;

export const FILL_LOOP_D2_END = 0x26 as const;

export const FILL_LOOP_COUNT = FILL_LOOP_D2_END - FILL_LOOP_D2_START;

/** Starting alpha RAM offset for loop 2; the first write is at `D2*2 == 0x08`. */
export const FILL_LOOP_2_BASE_OFFSET = 0x000 as const;

/** Starting alpha RAM offset for loop 3: `0xA03E80 - 0xA03000`. */
export const FILL_LOOP_3_BASE_OFFSET = 0xe80 as const;

/**
 * Copies the ROM boot pattern into `state.alphaRam`, matching the ROM row and
 * fill-loop geometry described above.
 */
export function alphaRamBootInitED6(state: GameState, rom: RomImage): void {
  const alpha = state.alphaRam;
  const prog = rom.program;

  // Loop 1: 3 bands x 10 rows x 42 words.
  let rowOffset = 0; // Offset in alphaRam, equivalent to D3 - 0xA03000.
  for (let d4 = 0; d4 < QUADRANT_COUNT; d4++) {
    const srcBase = SOURCE_TABLE_ROM_ADDR + d4 * SOURCE_QUADRANT_STRIDE_BYTES;
    for (let d5 = 0; d5 < ROW_PER_QUADRANT; d5++) {
      // Inner: 42 word writes a rowOffset + D2*2.
      for (let d2 = 0; d2 < WORDS_PER_ROW; d2++) {
        const dst = rowOffset + d2 * 2;
        const src = srcBase + d2 * 2;
        // BE word copy (M68K big-endian).
        alpha[dst] = prog[src] ?? 0;
        alpha[dst + 1] = prog[src + 1] ?? 0;
      }
      rowOffset += ROW_STRIDE_BYTES;
    }
  }

  // Loop 2: write 34 blank words to alphaRam[0x008..0x04B].
  for (let d2 = FILL_LOOP_D2_START; d2 < FILL_LOOP_D2_END; d2++) {
    const off = FILL_LOOP_2_BASE_OFFSET + d2 * 2;
    alpha[off] = (BLANK_TILE_WORD >>> 8) & 0xff;
    alpha[off + 1] = BLANK_TILE_WORD & 0xff;
  }

  // Loop 3: write 34 blank words to alphaRam[0xE88..0xECB].
  for (let d2 = FILL_LOOP_D2_START; d2 < FILL_LOOP_D2_END; d2++) {
    const off = FILL_LOOP_3_BASE_OFFSET + d2 * 2;
    alpha[off] = (BLANK_TILE_WORD >>> 8) & 0xff;
    alpha[off + 1] = BLANK_TILE_WORD & 0xff;
  }
}
