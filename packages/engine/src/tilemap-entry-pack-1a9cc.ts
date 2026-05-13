/**
 * tilemap-entry-pack-1a9cc.ts — `FUN_0001A9CC` playfield-facing wrapper.
 *
 * Packs six 0x40-byte descriptors into the compact tilemap record stream used
 * by Atari System 1 video RAM. The destination is expressed as an offset from
 * `0xA00000`, matching the original caller's `0xA00000 + rowOffset` pointer.
 *
 * Binary note: the routine enters the sixth iteration with D2 == 5, writes the
 * first long, then exits before the second long+word block. Observable writes
 * are therefore 54 bytes; parity keeps a 60-byte comparison window so the final
 * six bytes are verified unchanged.
 */

import type { GameState } from "./state.js";

export const TILEMAP_ENTRY_PACK_1A9CC_ADDR = 0x0001a9cc as const;
export const TILEMAP_ENTRY_PACK_DESCRIPTOR_STRIDE = 0x40 as const;
export const TILEMAP_ENTRY_PACK_ITERATIONS = 6 as const;
export const TILEMAP_ENTRY_PACK_OBSERVED_WRITE_BYTES = 54 as const;
export const TILEMAP_ENTRY_PACK_WINDOW_BYTES = 60 as const;

function readU8(state: GameState, sourceAddr: number): number {
  const a = sourceAddr >>> 0;
  if (a >= 0x00400000 && a < 0x00402000) return state.workRam[a - 0x00400000] ?? 0;
  return 0;
}

function readU16(state: GameState, sourceAddr: number): number {
  return ((readU8(state, sourceAddr) << 8) | readU8(state, (sourceAddr + 1) >>> 0)) & 0xffff;
}

function rorL(value: number, count: number): number {
  const v = value >>> 0;
  const c = count & 31;
  return ((v >>> c) | (v << (32 - c))) >>> 0;
}

function writeVideoByte(state: GameState, off: number, value: number): void {
  if (off >= 0 && off < state.playfieldRam.length) {
    state.playfieldRam[off] = value & 0xff;
    return;
  }

  const spriteOff = off - state.playfieldRam.length;
  if (spriteOff >= 0 && spriteOff < state.spriteRam.length) {
    state.spriteRam[spriteOff] = value & 0xff;
    return;
  }

  const alphaOff = spriteOff - state.spriteRam.length;
  if (alphaOff >= 0 && alphaOff < state.alphaRam.length) {
    state.alphaRam[alphaOff] = value & 0xff;
  }
}

function writeVideoWord(state: GameState, off: number, value: number): void {
  const v = value & 0xffff;
  writeVideoByte(state, off, (v >>> 8) & 0xff);
  writeVideoByte(state, off + 1, v & 0xff);
}

function writeVideoLong(state: GameState, off: number, value: number): void {
  const v = value >>> 0;
  writeVideoByte(state, off, (v >>> 24) & 0xff);
  writeVideoByte(state, off + 1, (v >>> 16) & 0xff);
  writeVideoByte(state, off + 2, (v >>> 8) & 0xff);
  writeVideoByte(state, off + 3, v & 0xff);
}

export function packTilemapEntries1A9CC(
  state: GameState,
  destOffsetFromVideoBase: number,
  sourceAddr: number,
): void {
  let dstOff = destOffsetFromVideoBase | 0;
  let src = sourceAddr >>> 0;

  for (let d2 = 0; d2 < TILEMAP_ENTRY_PACK_ITERATIONS; d2++) {
    const d1_0 = (readU16(state, src + 0x00) << 6) & 0xffff;
    let d0 = rorL(readU16(state, src + 0x08), 4);
    d0 = (d0 & 0xffff0000) | ((d0 & 0xffff) | d1_0);
    d0 = ((d0 >>> 16) | (d0 << 16)) >>> 0;
    const d1_10 = (readU16(state, src + 0x10) << 2) & 0xffff;
    d0 = (d0 & 0xffff0000) | ((d0 & 0xffff) | d1_10);
    d0 = (d0 & 0xffffff00) | ((d0 & 0xff) | readU8(state, src + 0x18));
    writeVideoLong(state, dstOff, d0);
    dstOff += 4;

    if (d2 === 5) break;

    const d1_18 = (readU16(state, src + 0x18) << 8) & 0xffff;
    let d0_20 = rorL(readU16(state, src + 0x20), 2);
    d0_20 = (d0_20 & 0xffff0000) | ((d0_20 & 0xffff) | d1_18);
    d0_20 = ((d0_20 >>> 16) | (d0_20 << 16)) >>> 0;
    const d1_28 = (readU16(state, src + 0x28) << 4) & 0xffff;
    d0_20 = (d0_20 & 0xffff0000) | ((d0_20 & 0xffff) | d1_28);
    let d1_30 = rorL(readU16(state, src + 0x30), 6);
    d0_20 = (d0_20 & 0xffff0000) | ((d0_20 & 0xffff) | (d1_30 & 0xffff));
    writeVideoLong(state, dstOff, d0_20);
    dstOff += 4;

    d1_30 = ((d1_30 >>> 16) | (d1_30 << 16)) >>> 0;
    writeVideoWord(state, dstOff, (d1_30 & 0xffff) | readU16(state, src + 0x38));
    dstOff += 2;

    src = (src + TILEMAP_ENTRY_PACK_DESCRIPTOR_STRIDE) >>> 0;
  }
}
