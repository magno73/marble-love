/**
 * game-state-banner-26b2a.ts — replica `FUN_00026B10` + `FUN_00026B2A`.
 *
 * Banner display setup. Chiamato da scenarios di transition (case 4 in
 * 1101e, case 2/3 in 11452, etc.). Carica 195 word di banner data dalla
 * ROM via scatter-write (i.e. ogni word va a destinazione differente
 * controllata da una table di pointer in ROM).
 *
 * **`FUN_26B2A` disasm** (26 instr):
 *
 *   D0 = arg (mode), * 0x186 (= 0xC3 word entry × 2 byte)
 *   A1 = ROM[0x1FC10 + D0 * 0x186]   ; src banner table (195 word per mode)
 *   A2 = A1                            ; mutable src
 *   D1 = 0x20534                       ; ROM dest-pointer table base
 *   D0 = 0 (counter)
 *   loop:
 *     A1 = D1                          ; A1 = current table entry addr
 *     D1 += 4                          ; advance to next entry
 *     A0 = *(A1)                       ; deref → dest pointer (long)
 *     *(A0) = (A2)+                    ; write word from src to dest
 *     D0++
 *     while D0 < 0xC3
 *   jsr FUN_26B10
 *   rts
 *
 * **`FUN_26B10` disasm** (8 instr):
 *
 *   A1 = 0xB00000   ; colorRam base
 *   A0 = 0x1FBD0    ; ROM source
 *   D0 = 0
 *   loop: *(A1)+ = (A0)+ ; copy word
 *         D0++
 *         while D0 < 0x20  ; 32 word = 64 byte
 *   rts
 *
 * Le 195 dest pointer in ROM @ 0x20534 puntano in regions varie:
 * workRam, alphaRam, palette/colorRam, spriteRam. La replica usa un
 * dispatcher `writeAbsU16` che switcha in base al range dell'address.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

export const GAME_STATE_BANNER_26B2A_ADDR = 0x00026b2a as const;
export const PALETTE_COPY_26B10_ADDR = 0x00026b10 as const;

/** ROM table of banner mode entries. Each entry = 195 word = 0x186 byte. */
const BANNER_ROM_BASE = 0x0001fc10 as const;
/** ROM table of 195 destination pointers (long). */
const DEST_PTR_TABLE = 0x00020534 as const;
/** ROM source for FUN_26B10 (32 word color values). */
const PALETTE_COPY_SRC = 0x0001fbd0 as const;
/** Number of word entries per banner. */
const BANNER_WORD_COUNT = 0xc3 as const; // 195
/** Number of word entries copied by FUN_26B10. */
const PALETTE_COPY_WORD_COUNT = 0x20 as const; // 32

const WORK_RAM_BASE = 0x00400000;
const WORK_RAM_END = 0x00402000;
const PLAYFIELD_RAM_BASE = 0x00a00000;
const PLAYFIELD_RAM_END = 0x00a02000;
const SPRITE_RAM_BASE = 0x00a02000;
const SPRITE_RAM_END = 0x00a03000;
const ALPHA_RAM_BASE = 0x00a03000;
const ALPHA_RAM_END = 0x00a04000;
const COLOR_RAM_BASE = 0x00b00000;
const COLOR_RAM_END = 0x00b00800;

function readRomU16(rom: RomImage, addr: number): number {
  return (((rom.program[addr] ?? 0) << 8) | (rom.program[addr + 1] ?? 0)) & 0xffff;
}

function readRomU32(rom: RomImage, addr: number): number {
  return (
    (((rom.program[addr] ?? 0) << 24) |
      ((rom.program[addr + 1] ?? 0) << 16) |
      ((rom.program[addr + 2] ?? 0) << 8) |
      (rom.program[addr + 3] ?? 0)) >>>
    0
  );
}

/**
 * Scrive un word (16 bit big-endian) all'indirizzo absolute M68k. Switcha
 * la regione in base al range. Out-of-range → no-op (graceful).
 */
function writeAbsU16(state: GameState, addr: number, value: number): void {
  const a = addr >>> 0;
  const v = value & 0xffff;
  const hi = (v >>> 8) & 0xff;
  const lo = v & 0xff;

  if (a >= WORK_RAM_BASE && a < WORK_RAM_END) {
    const off = a - WORK_RAM_BASE;
    state.workRam[off] = hi;
    state.workRam[off + 1] = lo;
  } else if (a >= PLAYFIELD_RAM_BASE && a < PLAYFIELD_RAM_END) {
    const off = a - PLAYFIELD_RAM_BASE;
    state.playfieldRam[off] = hi;
    state.playfieldRam[off + 1] = lo;
  } else if (a >= SPRITE_RAM_BASE && a < SPRITE_RAM_END) {
    const off = a - SPRITE_RAM_BASE;
    state.spriteRam[off] = hi;
    state.spriteRam[off + 1] = lo;
  } else if (a >= ALPHA_RAM_BASE && a < ALPHA_RAM_END) {
    const off = a - ALPHA_RAM_BASE;
    state.alphaRam[off] = hi;
    state.alphaRam[off + 1] = lo;
  } else if (a >= COLOR_RAM_BASE && a < COLOR_RAM_END) {
    const off = a - COLOR_RAM_BASE;
    state.colorRam[off] = hi;
    state.colorRam[off + 1] = lo;
  }
  // else: ignore (MMIO out of model)
}

/**
 * Replica `FUN_00026B10` — copia 32 word (64 byte) da ROM[0x1FBD0]
 * a colorRam[0..0x3F] (= MMIO 0xB00000..0xB003F).
 */
export function paletteCopy26B10(state: GameState, rom: RomImage): void {
  for (let i = 0; i < PALETTE_COPY_WORD_COUNT; i++) {
    const word = readRomU16(rom, PALETTE_COPY_SRC + i * 2);
    const dstOff = i * 2;
    state.colorRam[dstOff] = (word >>> 8) & 0xff;
    state.colorRam[dstOff + 1] = word & 0xff;
  }
}

/**
 * Replica `FUN_00026B2A` — banner display setup per il `mode` indicato.
 *
 * Side effects:
 *  - 195 word scatter-write da ROM[BANNER_ROM_BASE + mode*0x186] verso
 *    195 destinazioni differenti (workRam, alphaRam, etc.) controllate
 *    da `ROM[DEST_PTR_TABLE + i*4]` per i in 0..194
 *  - Chiamata a `paletteCopy26B10` (32 word in colorRam)
 */
export function gameStateBanner26B2A(
  state: GameState,
  rom: RomImage,
  mode: number,
): void {
  // mulu.w #0xC3,D0 + add.l D0,D0 = mode * 0x186
  const srcBase = (BANNER_ROM_BASE + ((mode & 0xffff) * BANNER_WORD_COUNT * 2)) >>> 0;

  for (let i = 0; i < BANNER_WORD_COUNT; i++) {
    const destPtr = readRomU32(rom, DEST_PTR_TABLE + i * 4);
    const srcWord = readRomU16(rom, srcBase + i * 2);
    writeAbsU16(state, destPtr, srcWord);
  }

  paletteCopy26B10(state, rom);
}
