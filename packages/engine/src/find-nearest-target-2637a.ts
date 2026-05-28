/**
 * Replica of `FUN_0002637A`, the nearest reachable target selector.
 *
 * The ROM routine scans four-byte candidate records `{x, y, filter, pad}` until
 * a record starts with `0xFF`. It keeps records whose filter matches
 * `obj[0x1D]`, scores the distance from the object position, calls
 * `FUN_00017CB8` as a line-of-sight test, and writes the best cell center to
 * globals `0x400462`/`0x400466` plus the winning filter at `0x400472`.
 *
 * The original caller is `FUN_000262B2`, which passes the object pointer in A2.
 * Candidate tables are selected by the ROM pointer table at `0x1EF1A`, indexed
 * by `(*0x400394.w << 2)`. This TypeScript entry accepts the selected table
 * address and byte reader directly so tests can inject deterministic records.
 *
 * Important parity details:
 *   - The filter compare uses sign-extension of `obj[0x1D]`, but candidate
 *     filter bytes are zero-extended before the word compare.
 *   - Distance shifts are 16-bit `lsl.w #4`, so overflow wraps to the low word.
 *   - The weighted distance uses long `lsr.l #3`, then 16x16 `mulu.w #3`.
 *   - Best-distance comparison is an unsigned long compare against `0x300`.
 *
 * Verified by `packages/cli/src/test-find-nearest-target-2637a-parity.ts`.
 */

import type { GameState } from "./state.js";
import { stringHelper17CB8 } from "./string-helper-17cb8.js";

/** Absolute base of work RAM on the 68000 bus. */
const WORK_RAM_BASE = 0x400000;
/** Exclusive upper bound of work RAM. */
const WORK_RAM_END = 0x402000;

export const FIND_NEAREST_TARGET_2637A_ADDR = 0x0002637a as const;

export const FIND_NEAREST_TARGET_2637A_GLOBALS = {
  /** Long: best target pixel X. */
  bestPixelX_400462: 0x00400462,
  /** Long: best target pixel Y. */
  bestPixelY_400466: 0x00400466,
  /** Byte: winning filter byte. */
  bestFilter_400472: 0x00400472,
  stateSelector_400394: 0x00400394,
} as const;

export const FIND_NEAREST_TARGET_2637A_FIELDS = {
  /** Byte: object filter category source, sign-extended for the compare. */
  filterFrom1D: 0x1d,
  objPixelX_32: 0x32,
  objPixelY_34: 0x34,
} as const;

export const FIND_NEAREST_TARGET_2637A_CONSTS = {
  /** Candidate-set terminator at the record X byte. */
  recordTerminator: 0xff,
  /** Candidate record stride: X, Y, filter, pad. */
  recordStride: 4,
  initialBestDistance: 0x00000300,
  /** Fourth argument passed to `FUN_00017CB8`. */
  losRange0x180: 0x180,
  dispatchTableRom_1EF1A: 0x0001ef1a,
  fun_17CB8_addr: 0x00017cb8,
} as const;

/** Injectable external subroutine used by `FUN_0002637A`. */
export interface FindNearestTarget2637ASubs {
  /**
   * `FUN_00017CB8(objPtr, pixelX, pixelY, range)`.
   *
   * Return 0 for a reachable target. Any non-zero value rejects the record.
   */
  lineOfSight17CB8?: (
    state: GameState,
    objPtr: number,
    pixelX: number,
    pixelY: number,
    range: number,
  ) => number;
}

// Internal big-endian work-RAM helpers.

function readU8(workRam: Uint8Array, addrAbs: number): number {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_END) return 0;
  return (workRam[a - WORK_RAM_BASE] ?? 0) & 0xff;
}

function writeU8(workRam: Uint8Array, addrAbs: number, value: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_END) return;
  workRam[a - WORK_RAM_BASE] = value & 0xff;
}

function readU16BE(workRam: Uint8Array, addrAbs: number): number {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 1 >= WORK_RAM_END) return 0;
  const off = a - WORK_RAM_BASE;
  return (((workRam[off] ?? 0) << 8) | (workRam[off + 1] ?? 0)) & 0xffff;
}

function writeU32BE(workRam: Uint8Array, addrAbs: number, value: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 3 >= WORK_RAM_END) return;
  const off = a - WORK_RAM_BASE;
  const v = value >>> 0;
  workRam[off] = (v >>> 24) & 0xff;
  workRam[off + 1] = (v >>> 16) & 0xff;
  workRam[off + 2] = (v >>> 8) & 0xff;
  workRam[off + 3] = v & 0xff;
}

/** Sign-extend one byte as the ROM does before the filter word compare. */
function signExt8(byte: number): number {
  const b = byte & 0xff;
  return b >= 0x80 ? b - 0x100 : b;
}

/** Read a candidate record: bytes [x, y, filter, pad]. */
function readCandidateRecord(
  reader: (addr: number) => number,
  recordAddr: number,
): { x: number; y: number; filter: number } {
  return {
    x: reader(recordAddr + 0) & 0xff,
    y: reader(recordAddr + 1) & 0xff,
    filter: reader(recordAddr + 2) & 0xff,
  };
}

/**
 * Replica `FUN_0002637A` — find nearest reachable target.
 *
 * `tableAddr` and `tableReader` represent the ROM candidate table selected by
 * the caller. Records are four bytes each and terminate when the X byte is
 * `0xFF`.
 */
export function findNearestTarget2637A(
  state: GameState,
  objPtr: number,
  tableAddr: number,
  tableReader: (addr: number) => number,
  subs: FindNearestTarget2637ASubs = {},
): void {
  const wr = state.workRam;
  const objAbs = objPtr >>> 0;

  // 0x2639A..0x263A6: prepare `obj[0x1D]` as a sign-extended word.
  const filterByte = readU8(
    wr,
    objAbs + FIND_NEAREST_TARGET_2637A_FIELDS.filterFrom1D,
  );
  const filterWordSE = signExt8(filterByte) & 0xffff;

  // 0x263AA: A4 = 0x300, the initial best distance.
  let bestDist = FIND_NEAREST_TARGET_2637A_CONSTS.initialBestDistance >>> 0;

  const objX = readU16BE(
    wr,
    objAbs + FIND_NEAREST_TARGET_2637A_FIELDS.objPixelX_32,
  );
  const objY = readU16BE(
    wr,
    objAbs + FIND_NEAREST_TARGET_2637A_FIELDS.objPixelY_34,
  );

  // Loop at 0x263AE.
  let recAddr = tableAddr >>> 0;
  const MAX_RECORDS = 256;
  for (let it = 0; it < MAX_RECORDS; it++) {
    // 0x263AE: `cmpi.b #-1,(A3)` terminates when X is 0xFF.
    const x0 = tableReader(recAddr) & 0xff;
    if (x0 === FIND_NEAREST_TARGET_2637A_CONSTS.recordTerminator) break;

    // Candidate filter is zero-extended before comparing to the signed object filter.
    // cmp.w D0w vs filterWordSE: zero-ext byte vs sign-ext byte word.
    const recFilter = tableReader(recAddr + 2) & 0xff;
    const recFilterAsWord = recFilter; // zero-ext byte in word
    if (recFilterAsWord !== filterWordSE) {
      // 0x263C0: non-matching filters skip to the next record.
      recAddr = (recAddr + FIND_NEAREST_TARGET_2637A_CONSTS.recordStride) >>> 0;
      continue;
    }

    // Filter matched.
    const rec = readCandidateRecord(tableReader, recAddr);

    // 0x263CE..0x263E6: `|objX - targetX| << 4` with 16-bit `lsl.w`.
    const diffX = (objX - rec.x) & 0xffff; // sub.w
    const absDiffX = (diffX & 0x8000) !== 0 ? (-(diffX | ~0xffff)) >>> 0 : diffX;
    const d1Shifted = (absDiffX << 4) & 0xffff; // lsl.w #4

    // 0x263E8..0x26400: same transform for Y.
    const diffY = (objY - rec.y) & 0xffff;
    const absDiffY = (diffY & 0x8000) !== 0 ? (-(diffY | ~0xffff)) >>> 0 : diffY;
    const d3Shifted = (absDiffY << 4) & 0xffff;

    // 0x26402..0x26426: weighted distance.
    //   if (d1Shifted > d3Shifted) {  // branch A
    //     d2 = ((d3Shifted >>> 3) * 3) + d1Shifted   (long math)
    //   } else {                       // branch B (d1 <= d3, unsigned word)
    //     d2 = ((d1Shifted >>> 3) * 3) + d3Shifted
    //   }
    let d2: number;
    if (d1Shifted > d3Shifted) {
      // Branch A: |dX| > |dY|.
      // D2 = D3 word, zero-extended to long.
      let acc = d3Shifted >>> 0;
      acc = acc >>> 3; // lsr.l #3
      // `mulu.w #3,D2`: 16x16-to-32 unsigned multiply.
      acc = (acc & 0xffff) * 3;
      // add.l D0,D2 where D0 = zero-ext word(D1)
      acc = (acc + (d1Shifted >>> 0)) >>> 0;
      d2 = acc;
    } else {
      // Branch B: |dX| <= |dY|.
      let acc = d1Shifted >>> 0;
      acc = acc >>> 3;
      acc = (acc & 0xffff) * 3;
      acc = (acc + (d3Shifted >>> 0)) >>> 0;
      d2 = acc;
    }

    // 0x26428..0x2643A: convert grid coordinates to pixel centers.
    const pixelX = (((rec.x << 3) & 0xffff) + 4) & 0xffff;
    const pixelY = (((rec.y << 3) & 0xffff) + 4) & 0xffff;

    // 0x2643C..0x2645A: `FUN_00017CB8(objPtr, pixelX, pixelY, 0x180)`.
    const losResult =
      ((subs.lineOfSight17CB8 ?? stringHelper17CB8)(
        state,
        objAbs,
        pixelX & 0xffff,
        pixelY & 0xffff,
        FIND_NEAREST_TARGET_2637A_CONSTS.losRange0x180,
      )) | 0;
    if (losResult !== 0) {
      // Non-zero means blocked, so the candidate is skipped.
      recAddr = (recAddr + FIND_NEAREST_TARGET_2637A_CONSTS.recordStride) >>> 0;
      continue;
    }

    // 0x2645C..0x2645E: unsigned long compare, skip if `D2 >= best`.
    if ((d2 >>> 0) >= (bestDist >>> 0)) {
      recAddr = (recAddr + FIND_NEAREST_TARGET_2637A_CONSTS.recordStride) >>> 0;
      continue;
    }

    // New best candidate.
    // 0x26460: A4 = D2
    bestDist = d2 >>> 0;
    // 0x26462..0x26466: `*0x400462 = sign-ext-long(D6.w)`.
    writeU32BE(
      wr,
      FIND_NEAREST_TARGET_2637A_GLOBALS.bestPixelX_400462,
      pixelX & 0xffff,
    );
    // 0x2646C..0x26470: `*0x400466 = sign-ext-long(D3.w)`.
    writeU32BE(
      wr,
      FIND_NEAREST_TARGET_2637A_GLOBALS.bestPixelY_400466,
      pixelY & 0xffff,
    );
    // 0x26476: `*0x400472.b = A3[+2].b`.
    writeU8(
      wr,
      FIND_NEAREST_TARGET_2637A_GLOBALS.bestFilter_400472,
      rec.filter,
    );

    // 0x2647E..0x26480: advance to the next record.
    recAddr = (recAddr + FIND_NEAREST_TARGET_2637A_CONSTS.recordStride) >>> 0;
  }

  // 0x26484..0x2648A: epilogue, no return value.
}
