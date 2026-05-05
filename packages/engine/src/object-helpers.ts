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

/**
 * Replica `FUN_00003F3E` — eepromValidateAndClassify.
 * Reads byte pair @ *0x401FFC + 0xA/0xB. If complementary (a == ~b),
 * keep a; else clear a. If a >= 0xE0 unsigned: return 0. Else return (a & 3) + 1.
 */
export function eepromValidateAndClassify(state: GameState): number {
  const ptr = readU32(state, 0x1ffc);
  const ptrOff = (ptr - 0x400000) >>> 0;
  const byteA = state.workRam[ptrOff + 0xA] ?? 0;
  const byteB = state.workRam[ptrOff + 0xB] ?? 0;
  const notB = (~byteB) & 0xff;
  let d2 = (byteA === notB) ? byteA : 0;
  // cmpi.b #-0x20 (= 0xE0), D2; bcs ok
  // bcs = D2 < 0xE0 unsigned. If D2 >= 0xE0 unsigned: return 0.
  if (d2 >= 0xE0) return 0;
  // Else: return ((d2 & 3) + 1)
  return ((d2 & 3) + 1) >>> 0;
}

/**
 * Replica `FUN_000253BC` — derive shorts from longs in obj struct.
 * If byte+0x36 != 0: no-op. Else:
 *   *(A0+0x32).w = (*(A0+0xC).l >> 19) (signed asr)
 *   *(A0+0x34).w = (*(A0+0x10).l >> 19) (signed asr)
 *   *(A0+0x2A).l = *(A0+0x14).l
 *   *(A0+0x1D).b = *(A0+0x1B).b
 */
export function objDeriveShorts(state: GameState, objAddr: number): void {
  const objOff = objAddr - 0x400000;
  const r = state.workRam;
  if ((r[objOff + 0x36] ?? 0) !== 0) return;
  // Read longs as signed
  const longC = readU32(state, objOff + 0xC);
  const longCSigned = longC >= 0x80000000 ? longC - 0x100000000 : longC;
  const long10 = readU32(state, objOff + 0x10);
  const long10Signed = long10 >= 0x80000000 ? long10 - 0x100000000 : long10;
  // asr.l #19 then store .w
  const w32 = (longCSigned >> 19) & 0xffff;
  const w34 = (long10Signed >> 19) & 0xffff;
  r[objOff + 0x32] = (w32 >>> 8) & 0xff;
  r[objOff + 0x33] = w32 & 0xff;
  r[objOff + 0x34] = (w34 >>> 8) & 0xff;
  r[objOff + 0x35] = w34 & 0xff;
  // Copy long *(A0+0x14) → *(A0+0x2A)
  const long14 = readU32(state, objOff + 0x14);
  writeU32(state, objOff + 0x2A, long14);
  // Copy byte
  r[objOff + 0x1D] = r[objOff + 0x1B] ?? 0;
}

/**
 * Replica `FUN_000285B0` — `triggerObjectEvent(objAddr, eventByte)`.
 * Calls FUN_28608 (addToObjectAccumAndFlag) with ROM lookup, then sets
 * obj fields at +0xD4 (long), +0x70 (=0), +0x68 (=0), +0x69 (=-1), +0xD8 (=1).
 */
export function triggerObjectEvent(state: GameState, rom: import("./bus.js").RomImage, objAddr: number, eventByte: number): void {
  const objOff = objAddr - 0x400000;
  const r = state.workRam;
  const eb = eventByte & 0xff;
  // ROM 0x23CD4 + eb*2 → word, sext_l
  const idx = 0x23cd4 + eb * 2;
  const w = ((rom.program[idx] ?? 0) << 8) | (rom.program[idx + 1] ?? 0);
  const wSigned = w & 0x8000 ? w - 0x10000 : w;
  // Inline FUN_28608: *(obj+0xBC) += value (long), then OR bit (1<<obj.+0x19) into *0x40039C
  const accumOff = objOff + 0xBC;
  const oldAccum = readU32(state, accumOff);
  const newAccum = (oldAccum + wSigned) >>> 0;
  writeU32(state, accumOff, newAccum);
  const type = r[objOff + 0x19] ?? 0;
  let mask = 0;
  if (type < 32) mask = (1 << type) >>> 0;
  const cur = r[0x39c] ?? 0;
  r[0x39c] = (cur | (mask & 0xff)) & 0xff;

  // ROM 0x23CF6 + eb*4 → long, store at obj+0xD4
  const idx2 = 0x23cf6 + eb * 4;
  const longVal =
    (((rom.program[idx2] ?? 0) << 24) |
      ((rom.program[idx2 + 1] ?? 0) << 16) |
      ((rom.program[idx2 + 2] ?? 0) << 8) |
      (rom.program[idx2 + 3] ?? 0)) >>> 0;
  writeU32(state, objOff + 0xD4, longVal);
  // Other fields
  r[objOff + 0x70] = 0;
  r[objOff + 0x68] = 0;
  r[objOff + 0x69] = 0xff;
  r[objOff + 0xD8] = 1;
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
