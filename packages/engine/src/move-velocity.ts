/**
 * move-velocity.ts — `FUN_00019976` (96 byte): apply velocity to obj.
 *
 * Reads byte+0x26 (direction index 0..N), computes delta x/y from ROM tables
 * 0x244B6 and 0x244D6 (word entries, scaled << 8). Adds delta to position
 * (long+0xC, long+0x10). If type byte+0x25 == 7: scale velocity /= 4 before
 * storing to *A0 and *(A0+4).
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

const ROM_DX_TABLE = 0x244b6;
const ROM_DY_TABLE = 0x244d6;

function readU32(s: GameState, off: number): number {
  return (
    (((s.workRam[off] ?? 0) << 24) |
      ((s.workRam[off + 1] ?? 0) << 16) |
      ((s.workRam[off + 2] ?? 0) << 8) |
      (s.workRam[off + 3] ?? 0)) >>> 0
  );
}
function writeU32(s: GameState, off: number, v: number): void {
  const x = v >>> 0;
  s.workRam[off] = (x >>> 24) & 0xff;
  s.workRam[off + 1] = (x >>> 16) & 0xff;
  s.workRam[off + 2] = (x >>> 8) & 0xff;
  s.workRam[off + 3] = x & 0xff;
}

export function applyMoveVelocity(state: GameState, rom: RomImage, objAddr: number): void {
  const objOff = objAddr - 0x400000;
  const r = state.workRam;
  const dirByte = r[objOff + 0x26] ?? 0;
  const dirSigned = dirByte & 0x80 ? dirByte - 0x100 : dirByte;
  // ROM word at table + dirSigned*2 (sext to long)
  const dxIdx = (ROM_DX_TABLE + dirSigned * 2) >>> 0;
  const dxRaw = ((rom.program[dxIdx] ?? 0) << 8) | (rom.program[dxIdx + 1] ?? 0);
  const dxSigned = dxRaw & 0x8000 ? dxRaw - 0x10000 : dxRaw;
  let d2 = (dxSigned << 8) | 0;

  const dyIdx = (ROM_DY_TABLE + dirSigned * 2) >>> 0;
  const dyRaw = ((rom.program[dyIdx] ?? 0) << 8) | (rom.program[dyIdx + 1] ?? 0);
  const dySigned = dyRaw & 0x8000 ? dyRaw - 0x10000 : dyRaw;
  let d1 = (dySigned << 8) | 0;

  // *(A0+0xC) += D2 (long)
  writeU32(state, objOff + 0xC, ((readU32(state, objOff + 0xC) + d2) >>> 0));
  // *(A0+0x10) += D1
  writeU32(state, objOff + 0x10, ((readU32(state, objOff + 0x10) + d1) >>> 0));

  // if *(A0+0x25) == 7: scale d2/d1 by /4 (asr 2)
  if ((r[objOff + 0x25] ?? 0) === 7) {
    d2 = d2 >> 2;
    d1 = d1 >> 2;
  }
  // *A0 = D2 (long), *(A0+4) = D1
  writeU32(state, objOff, d2 >>> 0);
  writeU32(state, objOff + 4, d1 >>> 0);
}
