/**
 * nearest-neighbor.ts — `FUN_00015D10` (166 byte): nearest entry in obj's list.
 *
 * Walks list at obj+0x72 (entries 6 byte each, terminator byte[0]==-1 OR byte[1]==-1).
 * Reference position: obj+0xC.l >> 19, obj+0x10.l >> 19 (high word).
 * For each entry: dx = ref.x - byte[0] (signed sext), dy = ref.y - byte[1].
 * |dx|*16, |dy|*16 → distance ≈ max + (min >> 3) * 3 (uint word).
 * If distance < current best (init 0x400): update best.
 * Final: write best entry ptr to obj+0x6E.
 */

import type { GameState } from "./state.js";

function readU32S(s: GameState, off: number): number {
  const v =
    (((s.workRam[off] ?? 0) << 24) |
      ((s.workRam[off + 1] ?? 0) << 16) |
      ((s.workRam[off + 2] ?? 0) << 8) |
      (s.workRam[off + 3] ?? 0)) >>> 0;
  return v >= 0x80000000 ? v - 0x100000000 : v;
}
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

/**
 * Replica `FUN_00014DEC` — variante con list ptr da obj+0x4E, stride 4 byte,
 * write a obj+0x4A. Stesso algoritmo di findNearestNeighbor.
 */
export function findNearestNeighborV2(state: GameState, objAddr: number): void {
  const objOff = objAddr - 0x400000;
  const refX = (readU32S(state, objOff + 0xC) >> 19) & 0xffff;
  const refY = (readU32S(state, objOff + 0x10) >> 19) & 0xffff;
  const refXSigned = refX & 0x8000 ? refX - 0x10000 : refX;
  const refYSigned = refY & 0x8000 ? refY - 0x10000 : refY;

  let listAddr = readU32(state, objOff + 0x4E);
  let bestDist = 0x400;
  let bestPtr = 0xffffffff;

  let safety = 256;
  while (safety-- > 0) {
    const listOff = (listAddr - 0x400000) >>> 0;
    const b0 = state.workRam[listOff] ?? 0;
    if (b0 === 0xFF) break;
    const b1 = state.workRam[listOff + 1] ?? 0;
    if (b1 === 0xFF) break;
    const b0S = b0 & 0x80 ? b0 - 0x100 : b0;
    const b1S = b1 & 0x80 ? b1 - 0x100 : b1;
    const dx = (refXSigned - b0S) & 0xffff;
    const dy = (refYSigned - b1S) & 0xffff;
    const dxSigned = dx & 0x8000 ? dx - 0x10000 : dx;
    const dySigned = dy & 0x8000 ? dy - 0x10000 : dy;
    const dxAbsW = (dxSigned < 0 ? -dxSigned : dxSigned) & 0xffff;
    const dyAbsW = (dySigned < 0 ? -dySigned : dySigned) & 0xffff;
    const dxScaled = (dxAbsW << 4) & 0xffff;
    const dyScaled = (dyAbsW << 4) & 0xffff;
    let dist: number;
    if (dxScaled <= dyScaled) {
      const d1 = (dxScaled >>> 3) & 0xffff;
      const d1Mul = (d1 * 3) >>> 0;
      dist = (d1Mul + dyScaled) & 0xffff;
    } else {
      const d1 = (dyScaled >>> 3) & 0xffff;
      const d1Mul = (d1 * 3) >>> 0;
      dist = (d1Mul + dxScaled) & 0xffff;
    }
    if (dist < bestDist) {
      bestDist = dist;
      bestPtr = listAddr;
    }
    listAddr = (listAddr + 4) >>> 0; // stride 4 (different from V1)
  }

  writeU32(state, objOff + 0x4A, bestPtr);
}

export function findNearestNeighbor(state: GameState, objAddr: number): void {
  const objOff = objAddr - 0x400000;
  // ref x/y = high word of long >> 19 → effectively 16-bit signed
  const refX = (readU32S(state, objOff + 0xC) >> 19) & 0xffff;
  const refY = (readU32S(state, objOff + 0x10) >> 19) & 0xffff;
  const refXSigned = refX & 0x8000 ? refX - 0x10000 : refX;
  const refYSigned = refY & 0x8000 ? refY - 0x10000 : refY;

  let listAddr = readU32(state, objOff + 0x72);
  let bestDist = 0x400;
  let bestPtr = 0xffffffff; // D6 starts as part of D3's storage

  let safety = 256;
  while (safety-- > 0) {
    const listOff = (listAddr - 0x400000) >>> 0;
    const b0 = state.workRam[listOff] ?? 0;
    if (b0 === 0xFF) break;
    const b1 = state.workRam[listOff + 1] ?? 0;
    if (b1 === 0xFF) break;

    // dx = refX - b0 (signed)
    const b0S = b0 & 0x80 ? b0 - 0x100 : b0;
    const b1S = b1 & 0x80 ? b1 - 0x100 : b1;
    const dx = (refXSigned - b0S) & 0xffff;
    const dy = (refYSigned - b1S) & 0xffff;
    // abs (word, via tst+neg pattern)
    const dxSigned = dx & 0x8000 ? dx - 0x10000 : dx;
    const dySigned = dy & 0x8000 ? dy - 0x10000 : dy;
    const dxAbsW = (dxSigned < 0 ? -dxSigned : dxSigned) & 0xffff;
    const dyAbsW = (dySigned < 0 ? -dySigned : dySigned) & 0xffff;
    // D2 = dxAbs << 4 (word)
    const dxScaled = (dxAbsW << 4) & 0xffff;
    const dyScaled = (dyAbsW << 4) & 0xffff;
    // cmp dy, dx (D0=dy, D2=dx) → D2 - D0 = dx - dy. bls: branch if dx - dy <= 0 unsigned = dx <= dy.
    let dist: number;
    if (dxScaled <= dyScaled) {
      // dy >= dx: distance = dx*3/8 + dy
      const d1 = (dxScaled >>> 3) & 0xffff;
      // mulu.w #3, D1: D1 long = D1.w * 3
      const d1Mul = (d1 * 3) >>> 0;
      // D1w += dyScaled (word add)
      dist = (d1Mul + dyScaled) & 0xffff;
    } else {
      const d1 = (dyScaled >>> 3) & 0xffff;
      const d1Mul = (d1 * 3) >>> 0;
      dist = (d1Mul + dxScaled) & 0xffff;
    }
    // cmp.l D3, D0 (D0 = dist long): bcc skip if D0 >= D3 (= dist >= bestDist)
    // Don't branch (update) if dist < bestDist
    if (dist < bestDist) {
      bestDist = dist;
      bestPtr = listAddr;
    }
    // Advance: A1 += 6
    listAddr = (listAddr + 6) >>> 0;
  }

  // Write best ptr to obj+0x6E
  writeU32(state, objOff + 0x6E, bestPtr);
}
