/**
 * sprite-pack.ts — `FUN_0001A9CC` (88 byte): pack 6 sprite records.
 *
 * Loops 6 times. For each record (40 bytes from `src`), packs the fields into:
 *   - 1 long (always written)
 *   - 1 long + 1 word (skipped on last iter D2==5)
 * Output to the `dst` ptr (post-incrementing).
 *
 * The `ror.l` rotations mix nibbles cross-word, so it must be replicated
 * carefully.
 */

import type { GameState } from "./state.js";

function readU16(state: GameState, off: number): number {
  return ((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0);
}
function readU8(state: GameState, off: number): number {
  return state.workRam[off] ?? 0;
}
function rorL(v: number, count: number): number {
  v = v >>> 0;
  count = count & 31;
  return ((v >>> count) | (v << (32 - count))) >>> 0;
}

export function packSpriteRecords(state: GameState, dstAddr: number, srcAddr: number): void {
  const r = state.workRam;
  let dstOff = dstAddr - 0x400000;
  let srcOff = srcAddr - 0x400000;

  for (let d2 = 0; d2 < 6; d2++) {
    // D1w = *(A1+0).w; D1w <<= 6
    const d1_0 = (readU16(state, srcOff + 0) << 6) & 0xffff;
    // D0w = *(A1+8).w; D0 = ror.l #4 D0
    const d0_8 = readU16(state, srcOff + 8); // D0 = 0x0000xxxx
    let d0 = rorL(d0_8, 4);
    // D0w |= D1w
    d0 = (d0 & 0xffff0000) | ((d0 & 0xffff) | d1_0);
    // swap D0
    d0 = ((d0 >>> 16) | (d0 << 16)) >>> 0;
    // D1w = *(A1+0x10).w << 2; D0w |= D1w
    const d1_10 = (readU16(state, srcOff + 0x10) << 2) & 0xffff;
    d0 = (d0 & 0xffff0000) | ((d0 & 0xffff) | d1_10);
    // D0b |= *(A1+0x18).b
    const b18 = readU8(state, srcOff + 0x18);
    d0 = (d0 & 0xffffff00) | ((d0 & 0xff) | b18);
    // *(A0)+ = D0
    r[dstOff] = (d0 >>> 24) & 0xff;
    r[dstOff + 1] = (d0 >>> 16) & 0xff;
    r[dstOff + 2] = (d0 >>> 8) & 0xff;
    r[dstOff + 3] = d0 & 0xff;
    dstOff += 4;

    if (d2 === 5) {
      // Skip second long+word write
      break;
    }

    // D1w = *(A1+0x18).w << 8
    const d1_18 = (readU16(state, srcOff + 0x18) << 8) & 0xffff;
    // D0w = *(A1+0x20).w; D0 = ror.l #2 D0
    const d0_20 = readU16(state, srcOff + 0x20);
    let d0_2 = rorL(d0_20, 2);
    d0_2 = (d0_2 & 0xffff0000) | ((d0_2 & 0xffff) | d1_18);
    d0_2 = ((d0_2 >>> 16) | (d0_2 << 16)) >>> 0;
    // D1w = *(A1+0x28).w << 4; D0w |= D1w
    const d1_28 = (readU16(state, srcOff + 0x28) << 4) & 0xffff;
    d0_2 = (d0_2 & 0xffff0000) | ((d0_2 & 0xffff) | d1_28);
    // D1w = *(A1+0x30).w; D1 = ror.l #6 D1
    const d1_30 = readU16(state, srcOff + 0x30);
    let d1L = rorL(d1_30, 6);
    // D0w |= D1w (low word of D1 after ror)
    d0_2 = (d0_2 & 0xffff0000) | ((d0_2 & 0xffff) | (d1L & 0xffff));
    // *(A0)+ = D0
    r[dstOff] = (d0_2 >>> 24) & 0xff;
    r[dstOff + 1] = (d0_2 >>> 16) & 0xff;
    r[dstOff + 2] = (d0_2 >>> 8) & 0xff;
    r[dstOff + 3] = d0_2 & 0xff;
    dstOff += 4;
    // swap D1
    d1L = ((d1L >>> 16) | (d1L << 16)) >>> 0;
    // D1w |= *(A1+0x38).w
    const w38 = readU16(state, srcOff + 0x38);
    d1L = (d1L & 0xffff0000) | ((d1L & 0xffff) | w38);
    // *(A0)+ = D1.w (low word)
    r[dstOff] = (d1L >>> 8) & 0xff;
    r[dstOff + 1] = d1L & 0xff;
    dstOff += 2;
    srcOff += 0x40;
  }
}
