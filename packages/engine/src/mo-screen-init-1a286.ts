/**
 * Port of ROM routine `FUN_0001A286`.
 *
 * This screen-init helper clears alpha tiles, initializes the level palette,
 * renders two text strings through the `FUN_142` trampoline, resets two
 * interrupt-write pointer targets, initializes four motion-object header banks,
 * and writes four playfield register words. Hardware wait loops and MMIO
 * synchronization are modeled as no-ops; RAM/sprite/PF side effects are kept.
 *
 * Notable quirk: bank D writes `1,2,3,4,5,6,7,7`, so the last entry is
 * intentionally `0x0007`, not `0x0008`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

/** WorkRam offset for the first interrupt-write pointer target (= *0x1D8). */
const ISR_WRITE_DST_A_OFF = 0x08 as const;
/** WorkRam offset for the second target (= *0x1DC). */
const ISR_WRITE_DST_B_OFF = 0x0a as const;

const MO_ENTRY_COUNT = 8 as const;

/** Offsets of the four MO banks, relative to sprite RAM base 0xA02000. */
const MO_BANK_A_OFF = 0x000 as const;
const MO_BANK_B_OFF = 0x080 as const; // header word 1 — index/flag
const MO_BANK_C_OFF = 0x100 as const; // header word 2 — counter (× 0x200)
const MO_BANK_D_OFF = 0x180 as const; // header word 3 — small index

/** Base offset in pfRam[] for the four PF register writes. */
const PF_REG_BASE_OFF = 0xa20 as const;

/**
 * Callback bag for the subroutine calls:
 *   clearAlphaTiles -> paletteInitLevel -> renderString(0x22A9E)
 *                                      -> renderString(0x22906)
 */
export interface MoScreenInit1A286Subs {
  /** FUN_28C7E: clearAlphaTilesFromIndex(0). */
  clearAlphaTiles?: (state: GameState) => void;
  paletteInitLevel?: (state: GameState, rom: RomImage) => void;
  /**
   * FUN_142 (= JMP.L FUN_2572): renderString(strPtr, slot).
   */
  renderString?: (state: GameState, strPtr: number, slot: number) => void;
}

function writeWordBE(dst: Uint8Array, off: number, word: number): void {
  dst[off] = (word >>> 8) & 0xff;
  dst[off + 1] = word & 0xff;
}

/**
 * Runs `FUN_0001A286`, the motion-object/text screen init helper.
 *
 *   - `state.workRam[0x08..0x0B]` (two zero words)
 *   - `state.spriteRam[0..0x18F]` (32 words, 4 banks x 8 entries)
 *   - `pfRam[0xA20..0xA39]`       (4 word PF register init)
 *
 * @param state GameState, mutated in place.
 * @param rom   ROM image passed to paletteInitLevel.
 * @param pfRam Playfield RAM buffer (size >= 0x2000), indexed from 0=0xA00000.
 *              If null/undefined, the four PF writes are skipped.
 * @param subs  Callback bag for subroutine calls. Defaults are no-ops.
 */
export function moScreenInit1A286(
  state: GameState,
  rom: RomImage,
  pfRam: Uint8Array | null = null,
  subs: MoScreenInit1A286Subs = {},
): void {
  // 0x1A28E..0x1A296: spin-wait on *0xF60001 bit 0, modeled as MMIO no-op.

  // 0x1A298..0x1A29A: clr.l -(SP) ; jsr 0x28C7E.l
  subs.clearAlphaTiles?.(state);

  // 0x1A2A0: jsr 0x1A41E.l → paletteInitLevel(rom)
  subs.paletteInitLevel?.(state, rom);

  // 0x1A2A6..0x1A2B0: pea #0x2000 ; pea #0x22A9E ; jsr 0x142.l
  // → renderString(strPtr=0x22A9E, slot=0x2000)
  subs.renderString?.(state, 0x22a9e, 0x2000);

  // 0x1A2B6..0x1A2C0: pea #0x2000 ; pea #0x22906 ; jsr 0x142.l
  // → renderString(strPtr=0x22906, slot=0x2000)
  subs.renderString?.(state, 0x22906, 0x2000);

  // 0x1A2C6..0x1A2D6: A1 = *0x1D8 (= 0x400008), A0 = *0x1DC (= 0x40000A)
  // D0 = 0; *A0 = D0w ; *A1 = D0w (both words).
  writeWordBE(state.workRam, ISR_WRITE_DST_A_OFF, 0x0000);
  writeWordBE(state.workRam, ISR_WRITE_DST_B_OFF, 0x0000);

  // 0x1A2D8..0x1A2E0: lea cleanup + spin-wait on *A2, modeled as MMIO no-op.

  // 0x1A2E2: clr.w (0x860000).l — AV control = 0 (MMIO write, no-op).

  for (let i = 0; i < MO_ENTRY_COUNT; i++) {
    const o = i * 2;
    // Bank C (0xA02100 + i*2): 0x0400 + i*0x0200
    writeWordBE(state.spriteRam, MO_BANK_C_OFF + o, (0x0400 + i * 0x0200) & 0xffff);
    writeWordBE(state.spriteRam, MO_BANK_A_OFF + o, 0x1401);
    // Bank B (0xA02080 + i*2): 0x0001 + i*0x0800
    writeWordBE(state.spriteRam, MO_BANK_B_OFF + o, (0x0001 + i * 0x0800) & 0xffff);
    const bankDValue = i === 7 ? 7 : i + 1;
    writeWordBE(state.spriteRam, MO_BANK_D_OFF + o, bankDValue & 0xffff);
  }

  // 0x1A3E8..0x1A406: 4 word writes in PF RAM @ 0xA00A20/A28/A30/A38.
  if (pfRam !== null) {
    for (let i = 0; i < 4; i++) {
      writeWordBE(pfRam, PF_REG_BASE_OFF + i * 8, (0x0010 + i * 0x1000) & 0xffff);
    }
  }

  // 0x1A41A: movea.l (SP)+, A2 ; rts -> return.
}


export const MO_SCREEN_INIT_1A286_ADDR = 0x0001a286 as const;

export const MO_SCREEN_INIT_1A286_SUB_ADDRS = [
  0x00028c7e, // clearAlphaTilesFromIndex(0)
  0x0001a41e, // paletteInitLevel
  0x00000142,
  0x00000142,
] as const;

export const MO_SCREEN_INIT_1A286_RENDER_STRING_TARGET = 0x00002572 as const;

export const MO_SCREEN_INIT_1A286_ISR_DST_A_ADDR = 0x00400008 as const;
export const MO_SCREEN_INIT_1A286_ISR_DST_B_ADDR = 0x0040000a as const;

export const MO_SCREEN_INIT_1A286_RENDER_STRING_ARGS = [
  { strPtr: 0x00022a9e, slot: 0x00002000 },
  { strPtr: 0x00022906, slot: 0x00002000 },
] as const;

export const MO_SCREEN_INIT_1A286_MO_ENTRY_COUNT = MO_ENTRY_COUNT;
