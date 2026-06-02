/**
 * Bit-faithful port of ROM routine `FUN_00017F66`.
 *
 * Steps one object/entity struct pointed to by A2. The routine has three major
 * paths:
 *   - Skip when `state18` is 2 or 3; no side effects and no calls.
 *   - Special dispatch when global `0x400390` low word is 1; calls
 *     `FUN_1815A(A2)` and returns without `FUN_26196`.
 *   - Movement/stuck handling for command byte `A2+0x58`, ending with
 *     `FUN_26196(A2)`.
 *
 * Movement is selected by command whitelist `{0x00, 0x2D..0x31, 0x38..0x3B}`
 * unless `state36 == 2`. It copies command bytes to globals `0x4006AA/0x4006A8`
 * unless global `0x400396` low word is 1, computes signed dx/dy using
 * `muls.w #0x160`, optionally scales in modes 1 and 5, and adds the results to
 * object longs at +0 and +4.
 *
 * Stuck handling subtracts `0x6000` from long +8 when `state36 != 0` and clamps
 * the signed value to `-0x50000`. All long writes are big-endian and wrap at
 * 32 bits. Parity is covered by `test-object-step-17f66-parity.ts`.
 */

import type { GameState } from "./state.js";

/** WorkRam base (M68k absolute address). */
const WORK_RAM_BASE = 0x400000;

/** Globals (WorkRam). */
const G_390 = 0x0390;
const G_396 = 0x0396;
const G_6A8 = 0x06a8;
const G_6AA = 0x06aa;

/** Struct field offsets (from A2). */
const F_POS_X = 0x00; // long
const F_POS_Y = 0x04; // long
const F_STUCK_Z = 0x08; // long
const F_STATE18 = 0x18; // byte
const F_MODE = 0x1a; // byte
const F_STATE36 = 0x36; // byte
const F_DEPTH = 0x56; // byte
const F_CMD = 0x58; // byte
const F_CMD_X = 0xc6; // byte (mapped to G_6AA)
const F_CMD_Y = 0xc7; // byte (mapped to G_6A8)

/**
 * Command-byte whitelist at 0x58(A2) that selects the movement path.
 * Order matches the binary's sequential `beq.w` tests.
 */
export const COMMAND_WHITELIST: ReadonlySet<number> = new Set<number>([
  0x00, 0x3b, 0x2d, 0x2e, 0x38, 0x39, 0x3a, 0x2f, 0x30, 0x31,
]);

/** Long literals from the binary, kept immutable. */
export const STUCK_DELTA = -0x6000; // addi.l #-0x6000
export const STUCK_CLAMP = -0x50000 >>> 0; // 0xFFFB0000 (move.l #-0x50000)
/** Signed minimum threshold for the post-add clamp (`cmpi.l #-0x50000`). */
export const STUCK_DELTA_MIN = -0x50000; // signed i32
export const VEL_SCALE = 0x160; // muls.w #0x160
export const DEPTH_BASE = 0x1f; // moveq #0x1F, D1
export const MODE_5_FLOOR = 4; // clamp D1 a min 4 in the mode==5

/**
 * Callbacks invoked by this module.
 *   - `fun1815A(a2)`: called in special dispatch (`*0x400390 == 1`).
 *   - `fun180BE()`: called in movement path when `*0x400396 == 1`.
 *   - `fun26196(a2)`: called after movement or stuck handling.
 */
export interface ObjectStepCallees {
  fun1815A: (a2Addr: number) => void;
  fun180BE: () => void;
  fun26196: (a2Addr: number) => void;
}

/**
 * Executed path for debug/test introspection. The binary does not expose this.
 */
export type StepPath = "skip" | "special" | "movement" | "stuck";

/** Optional module return value used by tests. */
export interface StepResult {
  path: StepPath;
  /** Callee invocation counts, ordered as 1815a, 180be, 26196. */
  calls: { fun1815A: number; fun180BE: number; fun26196: number };
}

// ─── Big-endian long read/write helpers for Uint8Array ──────────────────

function readU32BE(buf: Uint8Array, off: number): number {
  return (
    (((buf[off] ?? 0) << 24) |
      ((buf[off + 1] ?? 0) << 16) |
      ((buf[off + 2] ?? 0) << 8) |
      (buf[off + 3] ?? 0)) >>>
    0
  );
}

function writeU32BE(buf: Uint8Array, off: number, v: number): void {
  const u = v >>> 0;
  buf[off] = (u >>> 24) & 0xff;
  buf[off + 1] = (u >>> 16) & 0xff;
  buf[off + 2] = (u >>> 8) & 0xff;
  buf[off + 3] = u & 0xff;
}

/** sign-extend byte → i32. */
function sextB(b: number): number {
  return ((b & 0xff) << 24) >> 24;
}

/** sign-extend word (16 bit signed) → i32. */
function sextW(w: number): number {
  return ((w & 0xffff) << 16) >> 16;
}

/** Read 16-bit word (BE) at workRam offset. */
function readWordBE(buf: Uint8Array, off: number): number {
  return (((buf[off] ?? 0) << 8) | (buf[off + 1] ?? 0)) & 0xffff;
}

/**
 * Bit-faithful port of `FUN_00017F66`, the object step routine.
 *
 * @param state    GameState. Reads globals at 0x400390/0x400396 and bytes at
 *                 0x4006A8/0x4006AA. The standard movement path mutates those
 *                 two global bytes; object changes are long adds at +0/+4/+8.
 *
 * @param a2Addr   M68K struct address. Must be inside work RAM; this module
 *                 indexes `state.workRam[a2Addr - 0x400000 + offset]`.
 *
 * @param callees  Callbacks for the three internal subroutines. `fun1815A` and
 *                 `fun26196` receive the M68K struct address, not the workRam
 *                 offset, matching the ROM push convention.
 *
 * @returns        `StepResult` with executed path and callee counts for tests.
 *                 The ROM routine itself returns no value.
 */
export function objectStep17F66(
  state: GameState,
  a2Addr: number,
  callees: ObjectStepCallees,
): StepResult {
  const r = state.workRam;
  const a2Off = (a2Addr - WORK_RAM_BASE) >>> 0;

  const calls = { fun1815A: 0, fun180BE: 0, fun26196: 0 };

  // ── 0x17F6E..0x17F7E: skip path ──────────────────────────────────────
  const state18 = (r[a2Off + F_STATE18] ?? 0) & 0xff;
  if (state18 === 2 || state18 === 3) {
    return { path: "skip", calls };
  }

  // ── 0x17F82..0x17F96: special-dispatch path ─────────────────────────
  // cmp.w (0x400390).l, D0w with D0=1 -> comparison on WORD read at 0x400390.
  const g390W = readWordBE(r, G_390);
  if (g390W === 1) {
    callees.fun1815A(a2Addr >>> 0);
    calls.fun1815A++;
    return { path: "special", calls };
  }

  // ── 0x17F9A..0x17FF2: whitelist test ────────────────────────────────
  const cmd = (r[a2Off + F_CMD] ?? 0) & 0xff;
  const state36 = (r[a2Off + F_STATE36] ?? 0) & 0xff;
  // beq.w 0x1808E if state36 == 2 -> stuck path.
  // Otherwise, whitelist test on cmd.
  const goStuck = state36 === 2 || !COMMAND_WHITELIST.has(cmd);

  if (!goStuck) {
    // ── 0x17FF6..0x18018: movement path ────────────────────────────────
    const g396W = readWordBE(r, G_396);
    if (g396W === 1) {
      callees.fun180BE();
      calls.fun180BE++;
      // bra.b 0x18018: skip the two-byte store.
    } else {
      // 0x18008: write 0x4006AA from (0xC6,A2), 0x4006A8 from (0xC7,A2).
      r[G_6AA] = (r[a2Off + F_CMD_X] ?? 0) & 0xff;
      r[G_6A8] = (r[a2Off + F_CMD_Y] ?? 0) & 0xff;
    }

    // 0x18018..0x18040: read the two global bytes and compute dx/dy longs.
    const byA8 = (r[G_6A8] ?? 0) & 0xff;
    const byAA = (r[G_6AA] ?? 0) & 0xff;
    const d3_0 = sextB(byA8); // sign-ext byte -> long
    const d2_0 = -sextB(byAA) | 0; // neg.l after sign-ext

    // muls.w #0x160 uses only D0's low word (sign-extended from the byte above).
    // Math.imul produces a 32-bit signed multiply, equivalent for word*0x160.
    let d3 = Math.imul(sextW(d3_0 & 0xffff), VEL_SCALE) | 0;
    let d2 = Math.imul(sextW(d2_0 & 0xffff), VEL_SCALE) | 0;

    // ── 0x18042..0x18080: scaling block (mode ∈ {1, 5}) ────────────────
    const mode = (r[a2Off + F_MODE] ?? 0) & 0xff;
    if (mode === 1 || mode === 5) {
      // moveq #0x1F, D1; D1.w -= sext.w(byte 0x56(A2)).
      const depthB = (r[a2Off + F_DEPTH] ?? 0) & 0xff;
      const depthW = sextW(sextB(depthB) & 0xffff); // sext byte → word (signed)
      let d1 = sextW((DEPTH_BASE - depthW) & 0xffff);

      // Only in mode == 5: clamp D1 = max(D1, 4).
      // cmp.w D1w, D0w with D0w = 4 -> ble = D0 <= D1 signed.
      // If 4 <= D1: skip. Otherwise (D1 < 4): D1 = 4.
      if (mode === 5) {
        if (4 > d1) {
          d1 = 4;
        }
      }

      // asr.l #8; muls.w D1w; asl.l #3.
      // asr.l: arithmetic right shift by 8 (signed shift in JS via i32).
      // muls.w: low word of D0 (post-shift) × low word of D1.
      const d3sh = (d3 >> 8) | 0;
      const d2sh = (d2 >> 8) | 0;
      d3 = (Math.imul(sextW(d3sh & 0xffff), sextW(d1 & 0xffff)) << 3) | 0;
      d2 = (Math.imul(sextW(d2sh & 0xffff), sextW(d1 & 0xffff)) << 3) | 0;
    }

    // ── 0x18082..0x1808A: (A2) += d3 (long), (4,A2) += d2 (long) ───────
    const px = readU32BE(r, a2Off + F_POS_X);
    const py = readU32BE(r, a2Off + F_POS_Y);
    writeU32BE(r, a2Off + F_POS_X, (px + d3) >>> 0);
    writeU32BE(r, a2Off + F_POS_Y, (py + d2) >>> 0);

    // ── 0x180AE: jsr FUN_26196 ─────────────────────────────────────────
    callees.fun26196(a2Addr >>> 0);
    calls.fun26196++;
    return { path: "movement", calls };
  }

  // ── 0x1808E..0x180AC: stuck path ────────────────────────────────────
  // tst.b (0x36,A2); beq 0x180AE -> if state36 == 0, skip both modifiers.
  if (state36 !== 0) {
    // addi.l #-0x6000, (0x8,A2) — long modulo 2^32.
    const sz = readU32BE(r, a2Off + F_STUCK_Z);
    const szPost = (sz + STUCK_DELTA) >>> 0;
    writeU32BE(r, a2Off + F_STUCK_Z, szPost);

    // cmpi.l #-0x50000, (0x8,A2); bge 0x180AE.
    // bge ≡ (0x8,A2) >= -0x50000 signed → skip clamp.
    // Else (signed < -0x50000): clamp a -0x50000.
    const szPostSigned = szPost | 0; // i32 view
    if (szPostSigned < (STUCK_DELTA_MIN | 0)) {
      writeU32BE(r, a2Off + F_STUCK_Z, STUCK_CLAMP);
    }
  }

  // ── 0x180AE: jsr FUN_26196 ──────────────────────────────────────────
  callees.fun26196(a2Addr >>> 0);
  calls.fun26196++;
  return { path: "stuck", calls };
}
