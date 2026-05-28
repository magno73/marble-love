/**
 * Port of ROM routine `FUN_0002591A`.
 *
 * Initializes an object struct, calls the injected helper chain, and writes two
 * global tile sentinels. Direct object writes include zeroing position/velocity
 * fields, copying the shifted globals at `0x400462` and `0x400466`, storing the
 * `FUN_1CC62(0)` return at `A2+0x14`, copying byte `0x400472` to `A2+0x1B`,
 * and clearing control bytes at `0x36`, `0x56`, and `0x58`.
 *
 * Stack parity matters here: the ROM pushes seven long arguments across helper
 * calls and performs one cumulative `lea (0x1C,SP),SP` cleanup. The helper calls
 * are exposed through `ObjectInit2591ASubs` so tests can patch them to RTS or
 * deterministic return stubs while preserving the surrounding write order.
 */

import type { GameState } from "./state.js";
import { spriteHelper1B9CC } from "./sprite-helper-1b9cc.js";

/** Absolute work RAM base (`0x400000` on the M68K bus). */
const WORK_RAM_BASE = 0x400000;
/** Exclusive workRam upper bound (`0x400000 + 0x2000`). */
const WORK_RAM_END = 0x402000;

const GLOBAL_400462_OFF = 0x462;
const GLOBAL_400466_OFF = 0x466;
const GLOBAL_400472_OFF = 0x472;
const GLOBAL_400696_OFF = 0x696; // word, scritto = 0xFFFF
const GLOBAL_400698_OFF = 0x698; // word, scritto = 0xFFFF

export const OBJECT_INIT_2591A_ADDR = 0x0002591a as const;

/** Offsets for direct writes through A2, used by tests and diagnostics. */
export const OBJECT_INIT_2591A_FIELDS = {
  /** Long ← 0. */
  zeroLongAt00: 0x00,
  /** Long ← 0. */
  zeroLongAt04: 0x04,
  /** Long ← 0. */
  zeroLongAt08: 0x08,
  /** Long ← (*0x400462) << 16. */
  shiftXAt0C: 0x0c,
  /** Long ← (*0x400466) << 16. */
  shiftYAt10: 0x10,
  /** Long ← FUN_1CC62(0) return value. */
  fun1CC62RetAt14: 0x14,
  /** Byte ← (*0x400472).b. */
  byteFrom472At1B: 0x1b,
  /** Long ← 0. */
  zeroLongAt22: 0x22,
  /** Long ← 0. */
  zeroLongAt26: 0x26,
  /** Byte ← 0. */
  zeroByteAt36: 0x36,
  /** Byte ← 0. */
  zeroByteAt56: 0x56,
  /** Byte ← 0. */
  zeroByteAt58: 0x58,
} as const;

export const OBJECT_INIT_2591A_SUB_ADDRS = [
  0x000262b2, // FUN_262B2(A2) — heavy init helper
  0x0001bab2, // FUN_1BAB2(A2) — spritePosUpdate1BAB2
  0x0001cc62, // FUN_1CC62(0)  — returns long in D0 (→ A2[0x14])
  0x00025b40, // FUN_25B40(A2) — clears A2+0x74..0xA3 (24 word + 1 byte @ +0xCA)
  0x0001b9cc, // FUN_1B9CC(A2, 0)
  0x00013966, // FUN_13966(A2)
] as const;

/**
 */
export interface ObjectInit2591ASubs {
  /**
   * altrove). Default no-op.
   */
  fun_262B2?: (state: GameState, objPtr: number) => void;
  /**
   * `FUN_1BAB2(objPtr)` — sprite-position-update + redraw-on-tile-change
   *
   */
  fun_1BAB2?: (state: GameState, objPtr: number) => void;
  /**
   */
  fun_1CC62?: (state: GameState, argZero: number) => number;
  /**
   *   - A2[+0xCA]      byte ← 0
   *   - A2[+0x74+i*2]  word ← (tableA[i] << 11), i = 0..7
   *   - A2[+0x84+i*2]  word ← (tableB[i] << 11), i = 0..7
   *   - A2[+0x94+i*2]  word ← 0,                  i = 0..7
   * where `tableA` @ ROM 0x1D3F4 and `tableB` @ ROM 0x1D3FC. Default no-op
   */
  fun_25B40?: (state: GameState, objPtr: number) => void;
  /**
   * Non modellato: default no-op.
   */
  fun_1B9CC?: (state: GameState, objPtr: number, flagLong: number) => void;
  /**
   */
  fun_13966?: (state: GameState, objPtr: number) => void;
}

// ─── Helper interno: read/write namespace su workRam (BE M68k) ────────────

function readU32BE(workRam: Uint8Array, addrAbs: number): number {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 3 >= WORK_RAM_END) return 0;
  const off = a - WORK_RAM_BASE;
  return (
    (((workRam[off] ?? 0) << 24) |
      ((workRam[off + 1] ?? 0) << 16) |
      ((workRam[off + 2] ?? 0) << 8) |
      (workRam[off + 3] ?? 0)) >>>
    0
  );
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

function writeU16BE(workRam: Uint8Array, addrAbs: number, value: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 1 >= WORK_RAM_END) return;
  const off = a - WORK_RAM_BASE;
  const v = value & 0xffff;
  workRam[off] = (v >>> 8) & 0xff;
  workRam[off + 1] = v & 0xff;
}

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

/**
 * Runs `FUN_0002591A`, the object initializer.
 *
 * The six helper calls are exposed through `subs`; defaults are no-op except
 * where the caller wires the real helper. `objPtr` must point into work RAM.
 *
 * @param subs    Callback bag for the six helper calls.
 */
export function objectInit2591A(
  state: GameState,
  objPtr: number,
  subs: ObjectInit2591ASubs = {},
): void {
  const wr = state.workRam;
  const objAbs = objPtr >>> 0;
  const objOff = (objAbs - WORK_RAM_BASE) >>> 0;

  // writeU8/U16/U32). Sub injections still receive the original objAbs.

  // 0x25920..0x25922: FUN_262B2(A2)
  subs.fun_262B2?.(state, objAbs);

  // 0x25928..0x25932: A2[+0xC] = (*0x400462) << 16
  const g462 = readU32BE(wr, WORK_RAM_BASE + GLOBAL_400462_OFF);
  // asl.l #16: low word → high word, low word zero. Wrap @ 32 bit unsigned.
  const shifted462 = (g462 << 16) >>> 0;
  // Big-endian write a A2+0xC.
  if (
    objAbs >= WORK_RAM_BASE &&
    objAbs + 0x0c + 3 < WORK_RAM_END
  ) {
    wr[objOff + 0x0c + 0] = (shifted462 >>> 24) & 0xff;
    wr[objOff + 0x0c + 1] = (shifted462 >>> 16) & 0xff;
    wr[objOff + 0x0c + 2] = (shifted462 >>> 8) & 0xff;
    wr[objOff + 0x0c + 3] = shifted462 & 0xff;
  }

  // 0x25936..0x25940: A2[+0x10] = (*0x400466) << 16
  const g466 = readU32BE(wr, WORK_RAM_BASE + GLOBAL_400466_OFF);
  const shifted466 = (g466 << 16) >>> 0;
  if (
    objAbs >= WORK_RAM_BASE &&
    objAbs + 0x10 + 3 < WORK_RAM_END
  ) {
    wr[objOff + 0x10 + 0] = (shifted466 >>> 24) & 0xff;
    wr[objOff + 0x10 + 1] = (shifted466 >>> 16) & 0xff;
    wr[objOff + 0x10 + 2] = (shifted466 >>> 8) & 0xff;
    wr[objOff + 0x10 + 3] = shifted466 & 0xff;
  }

  // 0x25944..0x2594C: globals @ 0x400696 e 0x400698 ← 0xFFFF (word).
  // moveq #-1, D0 → D0=0xFFFFFFFF; move.w D0w → low word = 0xFFFF.
  writeU16BE(wr, WORK_RAM_BASE + GLOBAL_400698_OFF, 0xffff);
  writeU16BE(wr, WORK_RAM_BASE + GLOBAL_400696_OFF, 0xffff);

  // 0x25952..0x25954: FUN_1BAB2(A2)
  subs.fun_1BAB2?.(state, objAbs);

  // 0x2595A..0x25962: A2[+0x14] = FUN_1CC62(0)
  const fun1CC62Ret = (subs.fun_1CC62?.(state, 0) ?? 0) >>> 0;
  if (
    objAbs >= WORK_RAM_BASE &&
    objAbs + 0x14 + 3 < WORK_RAM_END
  ) {
    wr[objOff + 0x14 + 0] = (fun1CC62Ret >>> 24) & 0xff;
    wr[objOff + 0x14 + 1] = (fun1CC62Ret >>> 16) & 0xff;
    wr[objOff + 0x14 + 2] = (fun1CC62Ret >>> 8) & 0xff;
    wr[objOff + 0x14 + 3] = fun1CC62Ret & 0xff;
  }

  // 0x25966: A2[+0x1B] = (*0x400472).b
  const g472 = readU8(wr, WORK_RAM_BASE + GLOBAL_400472_OFF);
  writeU8(wr, objAbs + 0x1b, g472);

  // 0x2596E..0x2597A: A2[+0x8], A2[+0x4], A2[+0x0] ← 0 (long)
  writeU32BE(wr, objAbs + 0x08, 0);
  writeU32BE(wr, objAbs + 0x04, 0);
  writeU32BE(wr, objAbs + 0x00, 0);

  // 0x2597C..0x25984: bytes @ +0x56, +0x36, +0x58 ← 0
  writeU8(wr, objAbs + 0x56, 0);
  writeU8(wr, objAbs + 0x36, 0);
  writeU8(wr, objAbs + 0x58, 0);

  // 0x25988..0x2598E: A2[+0x26], A2[+0x22] ← 0 (long)
  writeU32BE(wr, objAbs + 0x26, 0);
  writeU32BE(wr, objAbs + 0x22, 0);

  // 0x25992..0x25994: FUN_25B40(A2)
  subs.fun_25B40?.(state, objAbs);

  // 0x2599A..0x2599E: FUN_1B9CC(A2, 0)
  (subs.fun_1B9CC ?? spriteHelper1B9CC)(state, objAbs, 0);

  // 0x259A4..0x259A6: FUN_13966(A2)
  subs.fun_13966?.(state, objAbs);

  // 0x259AC..0x259B2: lea +0x1C, SP; movea.l (SP)+, A2; rts → no return value.
}
