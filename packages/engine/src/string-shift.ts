/**
 * string-shift.ts — replica `FUN_00002766` (178 byte) e `FUN_00002818` (210 byte).
 *
 * - **FUN_2766 — `shiftStringChainForward(structAddr)`**: shifta i tile alpha
 *   nella chain di 1 posizione "in avanti" (cell[i] = cell[i+1]). L'ultima
 *   cella riceve il valore originale della prima.
 *
 * - **FUN_2818 — `shiftStringChainBackward(structAddr)`**: shifta i tile
 *   alpha "indietro" (cell[i+1] = cell[i]). La prima cella riceve l'ultimo.
 *
 * Entrambe walkano la stessa linked-list di FUN_2572/2ABC e usano la stessa
 * marker check per chain end.
 *
 * **Nuova ROM table**: 0x7298 (count limit per rotation, parallela a 0x7294).
 *
 * **Verificato bit-perfect** vs binary tramite `cli/src/test-string-shift-parity.ts`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

const VAL_F00_OFF = 0x1f00 as const;
const ROTATION_OFF = 0x1f42 as const;
const ALPHA_BASE = 0xa03000 as const;
const ROM_COUNT_LIMIT = 0x7298 as const;
const ROM_STRIDE_TABLE = 0x72a0 as const;
const ROM_SHIFT_TABLE = 0x72a4 as const;

function readU16(state: GameState, off: number): number {
  return ((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0);
}
function readU16Signed(state: GameState, off: number): number {
  const w = readU16(state, off);
  return w & 0x8000 ? w - 0x10000 : w;
}
function readByteAbs(state: GameState, rom: RomImage, addr: number): number {
  const a = addr >>> 0;
  if (a < 0x80000) return rom.program[a] ?? 0;
  if (a >= 0x400000 && a < 0x402000) return state.workRam[a - 0x400000] ?? 0;
  if (a >= 0xa02000 && a < 0xa03000) return state.spriteRam[a - 0xa02000] ?? 0;
  if (a >= 0xa03000 && a < 0xa04000) return state.alphaRam[a - 0xa03000] ?? 0;
  if (a >= 0xb00000 && a < 0xb00800) return state.colorRam[a - 0xb00000] ?? 0;
  return 0;
}
function readLongAbs(state: GameState, rom: RomImage, addr: number): number {
  return (
    ((readByteAbs(state, rom, addr) << 24) |
      (readByteAbs(state, rom, (addr + 1) >>> 0) << 16) |
      (readByteAbs(state, rom, (addr + 2) >>> 0) << 8) |
      readByteAbs(state, rom, (addr + 3) >>> 0)) >>> 0
  );
}
function readRomWordSigned(rom: RomImage, romAddr: number): number {
  const w = ((rom.program[romAddr] ?? 0) << 8) | (rom.program[romAddr + 1] ?? 0);
  return w & 0x8000 ? w - 0x10000 : w;
}
function readAlphaWord(state: GameState, addr: number): number {
  const a = addr >>> 0;
  if (a >= 0xa03000 && a < 0xa04000) {
    const off = a - 0xa03000;
    return ((state.alphaRam[off] ?? 0) << 8) | (state.alphaRam[off + 1] ?? 0);
  }
  return 0;
}
function writeAlphaWord(state: GameState, addr: number, value: number): void {
  const a = addr >>> 0;
  if (a >= 0xa03000 && a < 0xa04000) {
    const off = a - 0xa03000;
    const v = value & 0xffff;
    state.alphaRam[off] = (v >>> 8) & 0xff;
    state.alphaRam[off + 1] = v & 0xff;
  }
}

function chainAdvance(state: GameState, rom: RomImage, a1: number): number | null {
  const marker = readByteAbs(state, rom, (a1 + 6) >>> 0);
  const markerSigned = marker & 0x80 ? marker - 0x100 : marker;
  const valF00Signed = readU16Signed(state, VAL_F00_OFF);
  const sum = (markerSigned + valF00Signed) | 0;
  if (sum <= 1) return null;
  return readLongAbs(state, rom, (a1 + 8) >>> 0);
}

/**
 * Replica `FUN_00002766` — shift forward.
 *
 * Per ogni entry della chain: legge limit dal ROM, A3 = ALPHA + d3*2 (NO
 * col offset). Salva first cell. Loop fino a limit-1: cell[i] = cell[i+1].
 * Alla fine scrive saved value alla posizione finale.
 */
export function shiftStringChainForward(state: GameState, rom: RomImage, structAddr: number): void {
  let a1 = structAddr >>> 0;
  let chainSafety = 1024;

  while (chainSafety-- > 0) {
    const rotation = readU16(state, ROTATION_OFF);
    const rotSigned = rotation & 0x8000 ? rotation - 0x10000 : rotation;

    let d1: number;
    if (rotation !== 0) {
      const tickOff = readByteAbs(state, rom, (a1 + 1) >>> 0);
      const tickOffSigned = tickOff & 0x80 ? tickOff - 0x100 : tickOff;
      d1 = (0x29 - tickOffSigned) | 0;
    } else {
      const tickOff = readByteAbs(state, rom, (a1 + 1) >>> 0);
      const tickOffSigned = tickOff & 0x80 ? tickOff - 0x100 : tickOff;
      d1 = (tickOffSigned << 6) | 0;
    }
    let a3 = (ALPHA_BASE + d1 * 2) >>> 0;

    const savedFirst = readAlphaWord(state, a3);
    const limit = readRomWordSigned(rom, ROM_COUNT_LIMIT + rotSigned * 2);
    const stride = readRomWordSigned(rom, ROM_STRIDE_TABLE + rotSigned * 2);

    let d2 = 0;
    while (true) {
      // Loop check: if d2 >= limit - 1: exit, write saved
      if (d2 >= limit - 1) break;
      // Read next cell
      const nextAddr = (a3 + stride * 2) >>> 0;
      const nextVal = readAlphaWord(state, nextAddr);
      writeAlphaWord(state, a3, nextVal);
      a3 = nextAddr;
      d2++;
    }
    // Write saved at final position
    writeAlphaWord(state, a3, savedFirst);

    const next = chainAdvance(state, rom, a1);
    if (next === null) return;
    a1 = next;
  }
}

/**
 * Replica `FUN_00002818` — shift backward.
 *
 * D3 = ROM[0x7298 + rot*2] - 1 (limit). A3 = ALPHA + col*shift + d2*2 (col
 * USED here). Saves D2 = current cell. Loop while D3 > 0:
 * cell[i+1] = cell[i] (in reverse), advancing A3 BACKWARD by stride.
 */
export function shiftStringChainBackward(state: GameState, rom: RomImage, structAddr: number): void {
  let a1 = structAddr >>> 0;
  let chainSafety = 1024;

  while (chainSafety-- > 0) {
    const rotation = readU16(state, ROTATION_OFF);
    const rotSigned = rotation & 0x8000 ? rotation - 0x10000 : rotation;

    const initialLimit = readRomWordSigned(rom, ROM_COUNT_LIMIT + rotSigned * 2);
    let d3 = (initialLimit - 1) & 0xffff;

    let d2: number;
    if (rotation !== 0) {
      const tickOff = readByteAbs(state, rom, (a1 + 1) >>> 0);
      const tickOffSigned = tickOff & 0x80 ? tickOff - 0x100 : tickOff;
      d2 = (0x29 - tickOffSigned) | 0;
    } else {
      const tickOff = readByteAbs(state, rom, (a1 + 1) >>> 0);
      const tickOffSigned = tickOff & 0x80 ? tickOff - 0x100 : tickOff;
      d2 = (tickOffSigned << 6) | 0;
    }

    // a3 = ALPHA + (limit << shift + d2) * 2
    // BUT wait, looking at disasm: `move.w (A2), D0w; ... add.l D0, D0;
    // movea.l #0x7298, A0; move.w (0,A0,D0*1), D0w` — this reads limit AGAIN,
    // not col!
    // Then `asl.l D1, D0` where D1 = shift count → D0 = limit << shift
    // Then `add.l D2, D0; add.l D0, D0; adda.l D0, A3` → A3 += 2 * (limit<<shift + d2)
    const limit = readRomWordSigned(rom, ROM_COUNT_LIMIT + rotSigned * 2);
    const shiftIdx = rotSigned * 2 + 1;
    const shiftByte = rom.program[(ROM_SHIFT_TABLE + shiftIdx) >>> 0] ?? 0;
    const shiftCount = shiftByte & 0x80 ? shiftByte - 0x100 : shiftByte;
    let d0 = limit;
    if (shiftCount >= 32 || shiftCount < 0) {
      d0 = shiftCount < 0 ? d0 : 0;
    } else {
      d0 = (d0 << shiftCount) | 0;
    }
    d0 = ((d0 + d2) * 2) | 0;
    let a3 = (ALPHA_BASE + d0) >>> 0;

    const savedCurrent = readAlphaWord(state, a3);
    const stride = readRomWordSigned(rom, ROM_STRIDE_TABLE + rotSigned * 2);

    // Loop: while D3 (= d3 word) != 0
    while (true) {
      // dbf-like check: copy D3 (saved as d0), then D3 -= 1, test if old == 0
      const oldD3 = d3;
      d3 = (d3 - 1) & 0xffff;
      if ((oldD3 & 0xffff) === 0) break;

      // A4 = A3 - stride * 2; *A3 = *A4
      const prevAddr = (a3 - stride * 2) >>> 0;
      const prevVal = readAlphaWord(state, prevAddr);
      writeAlphaWord(state, a3, prevVal);
      a3 = (a3 - stride * 2) >>> 0;
    }
    writeAlphaWord(state, a3, savedCurrent);

    const next = chainAdvance(state, rom, a1);
    if (next === null) return;
    a1 = next;
  }
}
