/**
 * tilemap-blit-17044.ts — replica `FUN_00017044` (40 byte).
 *
 * playfield RAM (0xA00000-0xA01FFF), starting from 0xA00116, with stride 128
 *
 * **Disasm 0x17044..0x1706A** (40 byte, 0 args, 0 ret):
 *
 *   movea.l #0x19F04, A1        ; A1 = ROM source pointer (table @ 0x19F04)
 *   movea.l #0xA00116, A0       ; A0 = PF RAM dest pointer (offset +0x116)
 *   clr.b   D1b                 ; D1 outer counter = 0
 *   outer:
 *     clr.b   D0b               ; D0 inner counter = 0
 *     inner:
 *       move.w  (A1)+, (A0)+    ; *(word *)A0++ = *(word *)A1++ (BE)
 *       addq.b  #1, D0b
 *       cmpi.b  #0x14, D0b
 *       bne.b   inner           ; ripete 20 times (D0 da 1..0x14, exit a 0x14)
 *     moveq   #0x58, D0         ; D0 = 0x58 = 88
 *     adda.l  D0, A0            ; A0 += 88  (skip 44 word = 88 byte)
 *     addq.b  #1, D1b
 *     cmpi.b  #0x6, D1b
 *     bne.b   outer             ; ripete 6 times (D1 da 1..6, exit a 6)
 *   rts
 *
 * **Geometria**:
 *   - ROM source: 240 byte contigui @ 0x19F04..0x19FF3 (6 × 20 word)
 *       offset PF = 0x116 + i*0x80 .. 0x116 + i*0x80 + 39  (40 byte = 20 word)
 *
 *
 *
 * with `clear-pf-stride.ts`. The module works on a `Uint8Array` buffer
 * `RomImage.program[]`.
 *
 * `cli/src/test-tilemap-blit-17044-parity.ts` (500/500 cases).
 */

import type { RomImage } from "./bus.js";

export const ROM_SOURCE_ADDR = 0x19f04 as const;
export const PF_RAM_BASE_ADDR = 0xa00000 as const;
export const PF_DEST_ADDR = 0xa00116 as const;
export const ROW_COUNT = 6 as const;
export const WORDS_PER_ROW = 0x14 as const;
export const BYTES_PER_ROW = WORDS_PER_ROW * 2; // 40
export const ROW_SKIP_BYTES = 0x58 as const; // 88
export const ROW_STRIDE_BYTES = BYTES_PER_ROW + ROW_SKIP_BYTES; // 128
export const TOTAL_BYTES_COPIED = ROW_COUNT * BYTES_PER_ROW; // 240

/**
 * `FUN_00017044` replica — `tilemapBlit17044(rom, pfRam)`.
 *
 *
 *              `program[0x19F04..0x19FF3]`).
 * @param pfRam PF RAM buffer indexed from 0 = `0xA00000`. Minimum length
 *              `0x116 + 5*0x80 + 40 = 0x3BE` to cover all writes; writes are
 *              truncated at the buffer limit (no
 *              out-of-bounds writes).
 *
 *   - Even/odd host bytes correspond 1:1 to ROM bytes
 *     `move.w (A1)+, (A0)+` of the 68k).
 *   - Le 5 finestre "skip" (88 byte ciascuna a 0xA0013E..0xA00195,
 *     0xA001BE..0xA00215, …, 0xA0033E..0xA00395) restano intatte.
 */
export function tilemapBlit17044(rom: RomImage, pfRam: Uint8Array): void {
  const program = rom.program;
  const pfLen = pfRam.length;
  let srcOff = ROM_SOURCE_ADDR;
  let dstOff = PF_DEST_ADDR - PF_RAM_BASE_ADDR; // 0x116

  for (let row = 0; row < ROW_COUNT; row++) {
    for (let w = 0; w < WORDS_PER_ROW; w++) {
      const hi = program[srcOff] ?? 0;
      const lo = program[srcOff + 1] ?? 0;
      srcOff += 2;
      // bound-safe write
      if (dstOff < pfLen) pfRam[dstOff] = hi;
      if (dstOff + 1 < pfLen) pfRam[dstOff + 1] = lo;
      dstOff += 2;
    }
    dstOff += ROW_SKIP_BYTES;
  }
}
