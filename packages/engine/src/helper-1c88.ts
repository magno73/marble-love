/**
 * Bit-perfect port of `FUN_00001C88`.
 *
 * Clears alpha RAM, fills playfield RAM with either zero or the ROM fill word
 * at `0x10060` depending on the work RAM vblank flag, clears two sprite RAM
 * slots, and clears one palette/color entry.
 *
 *
 * Disassembly sketch:
 *
 *   1C88  move.l   D2,-(A7)
 *   1C8A  movea.l  #$A03000,A0
 *   1C90  exg.l    D2,A0            ; D2 = ptr, A0 = old-D2
 *   1C92  cmpi.l   #$A03FFE,D2
 *   1C98  exg.l    D2,A0            ; restore
 *   1C9A  bhi.b    $1CA0            ; if ptr > $A03FFE → exit loop
 *   1C9C  clr.w    (A0)+
 *   1C9E  bra.b    $1C90
 *
 *   1CA0  movea.l  #$A00000,A0
 *   1CA6  exg.l    D2,A0
 *   1CA8  cmpi.l   #$A01FFE,D2
 *   1CAE  exg.l    D2,A0
 *   1CB0  bhi.b    $1CCA
 *   1CB2  tst.w    $400016.l
 *   1CB8  bne.b    $1CC4
 *   1CBA  move.w   $10060.l,D0
 *   1CC0  ext.l    D0
 *   1CC2  bra.b    $1CC6
 *   1CC4  moveq    #$0,D0
 *   1CC6  move.w   D0,(A0)+
 *   1CC8  bra.b    $1CA6
 *
 *   1CCA  movea.l  #$A02000,A0
 *   1CD0  clr.w    (A0)
 *   1CD2  movea.l  #$A02180,A0
 *   1CD8  clr.w    (A0)
 *   1CDA  clr.w    $860000.l
 *   1CE0  clr.w    $B00400.l
 *   1CE6  move.l   (A7)+,D2
 *   1CE8  rts
 *
 * **Caller** (10):
 *   0x1022, 0x1268, 0x1384, 0x14BC, 0x161A, 0x1EF2, 0x2182, 0x222E, 0x3B30
 *   (+ 0x1122 for a total of 10 JSR $1C88)
 *
 *
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// Constants.

export const HELPER_1C88_ADDR = 0x00001c88 as const;

const ROM_FILL_WORD_OFF = 0x10060 as const;

/** Work RAM offset of the vblank flag word at `0x400016`. */
const VBLANK_FLAG_OFF      = 0x16 as const;        // word @ workRam[0x16..0x17]

/** Sprite RAM offsets for the two cleared slots. */
const SPRITE_OFF_0000      = 0x0000 as const;      // 0xA02000
const SPRITE_OFF_0180      = 0x0180 as const;      // 0xA02180

/** Palette RAM offset of the cleared entry (`0xB00400 - 0xB00000`). */
const COLOR_OFF_0400       = 0x0400 as const;      // 0xB00400

// ─── Sub-callback interface ───────────────────────────────────────────────────

export interface Helper1C88Subs {
  /**
   * Default: no-op.
   */
  onAvControl?: (state: GameState) => void;
}

// Internal helpers.

function romR16(rom: RomImage, off: number): number {
  const o = off | 0;
  return (((rom.program[o] ?? 0) & 0xff) << 8) | ((rom.program[o + 1] ?? 0) & 0xff);
}

function s16(v: number): number {
  const w = v & 0xffff;
  return w & 0x8000 ? w - 0x10000 : w;
}

function wrR16(state: GameState, off: number): number {
  const o = off | 0;
  return (((state.workRam[o] ?? 0) & 0xff) << 8) | ((state.workRam[o + 1] ?? 0) & 0xff);
}

function alphaW16(state: GameState, off: number, v: number): void {
  const w = v & 0xffff;
  state.alphaRam[off]     = (w >>> 8) & 0xff;
  state.alphaRam[off + 1] = w & 0xff;
}

function pfW16(state: GameState, off: number, v: number): void {
  const w = v & 0xffff;
  state.playfieldRam[off]     = (w >>> 8) & 0xff;
  state.playfieldRam[off + 1] = w & 0xff;
}

function spW16(state: GameState, off: number, v: number): void {
  const w = v & 0xffff;
  state.spriteRam[off]     = (w >>> 8) & 0xff;
  state.spriteRam[off + 1] = w & 0xff;
}

function colW16(state: GameState, off: number, v: number): void {
  const w = v & 0xffff;
  state.colorRam[off]     = (w >>> 8) & 0xff;
  state.colorRam[off + 1] = w & 0xff;
}


/**
 * Replica `FUN_00001C88`.
 *
 *
 * @param subs   Optional hooks (MMIO write AV-control).
 */
export function helper1C88(
  state: GameState,
  rom: RomImage | undefined,
  subs?: Helper1C88Subs,
): void {
  //   - if a0 > 0xA03FFE -> exit (first check with a0=0xA03000 does not exit)
  //   - clr.w (a0)+; loop
  // In TS: offset in alphaRam = (M68kAddr - 0xA03000)
  for (let off = 0; off + 1 < state.alphaRam.length && off <= 0x0ffe; off += 2) {
    alphaW16(state, off, 0);
  }

  // ── Loop 2: fill Playfield RAM 0xA00000..0xA01FFE (4096 words, 8192 bytes) ─
  const vblankFlag = wrR16(state, VBLANK_FLAG_OFF);
  const romFillRaw = (rom !== undefined) ? romR16(rom, ROM_FILL_WORD_OFF) : 0;
  const fillWord   = (vblankFlag !== 0) ? 0 : (s16(romFillRaw) & 0xffff);

  for (let off = 0; off + 1 < state.playfieldRam.length && off <= 0x1ffe; off += 2) {
    pfW16(state, off, fillWord);
  }

  // clr.w (0xA02000) → spriteRam[0x000]
  spW16(state, SPRITE_OFF_0000, 0);
  // clr.w (0xA02180) → spriteRam[0x180]
  spW16(state, SPRITE_OFF_0180, 0);
  // clr.w $860000.l → MMIO AV-control (no-op in RAM; notified via hook)
  (subs?.onAvControl ?? ((_s) => {}))(state);
  // clr.w $B00400.l → colorRam[0x400]
  colW16(state, COLOR_OFF_0400, 0);
}
