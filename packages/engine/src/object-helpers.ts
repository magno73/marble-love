/**
 * object-helpers.ts — piccole utility che operano su object struct.
 *
 * - **FUN_2648C — `copyGlobalsToObj(objAddr)`**: copia 3 long da globals
 *   @ 0x400684/0x400688/0x40068C a obj+0xC/0x10/0x14.
 *
 * - **FUN_160AE — `objIndexedByteAdvance(objAddr, idxWord)`**:
 *   *A0+0x6E = byte_at(*(A0+0x6E)+2 + idxWord) * 6 + *(A0+0x72)
 */

import type { GameState } from "./state.js";

function readU32(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>> 0
  );
}
function writeU32(state: GameState, off: number, v: number): void {
  const x = v >>> 0;
  state.workRam[off] = (x >>> 24) & 0xff;
  state.workRam[off + 1] = (x >>> 16) & 0xff;
  state.workRam[off + 2] = (x >>> 8) & 0xff;
  state.workRam[off + 3] = x & 0xff;
}

export function copyGlobalsToObj(state: GameState, objAddr: number): void {
  const objOff = objAddr - 0x400000;
  writeU32(state, objOff + 0x0C, readU32(state, 0x684));
  writeU32(state, objOff + 0x10, readU32(state, 0x688));
  writeU32(state, objOff + 0x14, readU32(state, 0x68c));
}

export function objIndexedByteAdvance(state: GameState, objAddr: number, idxWord: number): void {
  const objOff = objAddr - 0x400000;
  const ptr = readU32(state, objOff + 0x6e);
  const ptrPlus2 = (ptr + 2) >>> 0;
  const ptrOff = ptrPlus2 - 0x400000;
  // Read byte at ptr+2+idxWord
  const idxByte = idxWord & 0xffff; // word arg
  // Word arg sext to long for index... no, the disasm uses D0w (word) directly:
  //   move.w (0xa,SP), D0w; movea.l (A0+0x6E), A1; lea (2,A1), A1;
  //   move.b (0,A1,D0w*1), D0b
  // D0w*1 is sign-extended word as index. So:
  const idxSigned = idxByte & 0x8000 ? idxByte - 0x10000 : idxByte;
  const byteVal = state.workRam[(ptrOff + idxSigned) >>> 0] ?? 0;
  // ext.w + ext.l → sext to long, BUT mulu.w uses LOW WORD unsigned.
  // For byte=0xFF: ext_l = 0xFFFFFFFF, low word = 0xFFFF, mulu.w *6 = 0x5FFFA.
  const byteSigned = byteVal & 0x80 ? byteVal - 0x100 : byteVal;
  const sextLong = byteSigned >>> 0; // unsigned representation
  const lowWord = sextLong & 0xffff;
  const product = (lowWord * 6) >>> 0;
  // Add *(A0+0x72)
  const addend = readU32(state, objOff + 0x72);
  // Note: addend is unsigned long, but add.l is the same bit pattern
  const newVal = (product + addend) >>> 0;
  writeU32(state, objOff + 0x6e, newVal);
}
