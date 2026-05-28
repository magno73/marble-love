/**
 * Port of ROM routine `FUN_0001A8D2`.
 *
 * This helper expands a header-pointed motion-object block into four parallel
 * word streams. The stream cursors live in work RAM at `0x4003F6`, `0x4003FA`,
 * `0x4003FE`, and `0x400402`; they usually point into sprite RAM and are
 * written back at exit along with the D7 counter at `0x400406`.
 *
 * Calling convention:
 *   - `arg0Ptr`: absolute M68K header pointer, or `0xFFFFFFFF` for early exit.
 *   - `arg1`: X bias word.
 *   - `arg2`: Y bias word.
 *   - `arg3`: OR mask applied to A1 output words.
 *
 * Header bytes at `arg0Ptr + 0/1` bias X/Y. The long at `arg0Ptr + 8` points to
 * the body; its low bit selects the initial high-bit flag and whether X steps by
 * `+0x0100` or `-0x0100`. Body byte `0xFF` selects the short triple-stream
 * format; other values select the long word-stream format.
 *
 * Subtle emulation points:
 *   - All word arithmetic is masked to 16 bits after each ROM-equivalent step.
 *   - `bclr.l #0,D0` clears the body pointer low bit but tests the previous bit.
 *   - `D4w &= 0x8000` keeps only bit 15; the low byte does not accumulate.
 *   - Absolute reads/writes can target ROM, work RAM, sprite RAM, alpha RAM, or
 *     palette RAM, so this module routes every access by address.
 */

import type { GameState } from "./state.js";

// ─── Region constants ────────────────────────────────────────────────────────

/** Absolute M68K work RAM base. */
const WORK_RAM_BASE = 0x400000;
const WORK_RAM_END = 0x402000;
const PF_RAM_BASE = 0xa00000;
const PF_RAM_END = 0xa02000;
const SPRITE_RAM_BASE = 0xa02000;
const SPRITE_RAM_END = 0xa03000;
const ALPHA_RAM_BASE = 0xa03000;
const ALPHA_RAM_END = 0xa04000;
const PAL_RAM_BASE = 0xb00000;
const PAL_RAM_END = 0xb00800;

// ─── Cursor / state addresses ────────────────────────────────────────────────

/** Output cursor "A1" (first buffer, target of `*(A1)+ = word`) as a long. */
export const CURSOR_A1_ADDR = 0x004003fa as const;
/** Output cursor "A2" (second buffer) as a long. */
export const CURSOR_A2_ADDR = 0x004003fe as const;
/** Output cursor "A3" (third buffer) as a long. */
export const CURSOR_A3_ADDR = 0x004003f6 as const;
/** Output cursor "A4" (fourth buffer) as a long. */
export const CURSOR_A4_ADDR = 0x00400402 as const;
/** D7 counter, incremented once per body-loop iteration, as a word. */
export const COUNTER_D7_ADDR = 0x00400406 as const;

export const ARG0_SENTINEL = 0xffffffff as const;

// ─── Helpers — cross-region reads/writes ────────────────────────────────────

/**
 * (ROM via subs.romRead, workRam, spriteRam, alphaRam, colorRam).
 */
function readByteAbs(
  state: GameState,
  abs: number,
  romRead: (off: number) => number,
): number {
  const a = abs >>> 0;
  // ROM: assume 0..ROM_SIZE handled by romRead (caller sets program length).
  if (a < 0x080000) {
    return romRead(a) & 0xff;
  }
  if (a >= WORK_RAM_BASE && a < WORK_RAM_END) {
    return (state.workRam[a - WORK_RAM_BASE] ?? 0) & 0xff;
  }
  if (a >= PF_RAM_BASE && a < PF_RAM_END) {
    // PF tilemap RAM (placeholder shares workRam in current model).
    return (state.workRam[a - PF_RAM_BASE] ?? 0) & 0xff;
  }
  if (a >= SPRITE_RAM_BASE && a < SPRITE_RAM_END) {
    return (state.spriteRam[a - SPRITE_RAM_BASE] ?? 0) & 0xff;
  }
  if (a >= ALPHA_RAM_BASE && a < ALPHA_RAM_END) {
    // Alpha RAM placeholder shares spriteRam.
    return (state.spriteRam[a - ALPHA_RAM_BASE] ?? 0) & 0xff;
  }
  if (a >= PAL_RAM_BASE && a < PAL_RAM_END) {
    return (state.colorRam[a - PAL_RAM_BASE] ?? 0) & 0xff;
  }
  return 0;
}

function readWordAbs(
  state: GameState,
  abs: number,
  romRead: (off: number) => number,
): number {
  const hi = readByteAbs(state, abs, romRead);
  const lo = readByteAbs(state, abs + 1, romRead);
  return ((hi << 8) | lo) & 0xffff;
}

function readLongAbs(
  state: GameState,
  abs: number,
  romRead: (off: number) => number,
): number {
  const w0 = readWordAbs(state, abs, romRead);
  const w1 = readWordAbs(state, abs + 2, romRead);
  return ((w0 << 16) | w1) >>> 0;
}

/**
 */
function writeByteAbs(state: GameState, abs: number, value: number): void {
  const a = abs >>> 0;
  const v = value & 0xff;
  if (a < 0x080000) {
    return; // ROM: readonly
  }
  if (a >= WORK_RAM_BASE && a < WORK_RAM_END) {
    state.workRam[a - WORK_RAM_BASE] = v;
    return;
  }
  if (a >= PF_RAM_BASE && a < PF_RAM_END) {
    state.workRam[a - PF_RAM_BASE] = v;
    return;
  }
  if (a >= SPRITE_RAM_BASE && a < SPRITE_RAM_END) {
    state.spriteRam[a - SPRITE_RAM_BASE] = v;
    return;
  }
  if (a >= ALPHA_RAM_BASE && a < ALPHA_RAM_END) {
    state.spriteRam[a - ALPHA_RAM_BASE] = v;
    return;
  }
  if (a >= PAL_RAM_BASE && a < PAL_RAM_END) {
    state.colorRam[a - PAL_RAM_BASE] = v;
    return;
  }
  // Out of mapped regions: no-op.
}

function writeWordAbs(state: GameState, abs: number, value: number): void {
  const v = value & 0xffff;
  writeByteAbs(state, abs, (v >>> 8) & 0xff);
  writeByteAbs(state, abs + 1, v & 0xff);
}

function writeLongAbs(state: GameState, abs: number, value: number): void {
  const v = value >>> 0;
  writeWordAbs(state, abs, (v >>> 16) & 0xffff);
  writeWordAbs(state, abs + 2, v & 0xffff);
}

/** Sign-extend an 8-bit byte to a JS signed integer. */
function s8(b: number): number {
  const x = b & 0xff;
  return x & 0x80 ? x - 0x100 : x;
}


/** Callback bag used to decouple production ROM reads from test stubs. */
export interface MoBlockEmit1A8D2Subs {
  /**
   * @returns Unsigned 8-bit byte (0..0xFF).
   */
  romRead?: (off: number) => number;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Runs `FUN_0001A8D2`, the header-pointed sprite/MO block emitter.
 *
 * Mutates the four buffers addressed by workRam cursors 0x3F6/0x3FA/0x3FE/0x402
 * and writes back the D7 counter at 0x406.
 *
 * @param arg0Ptr  Absolute M68K pointer to the header struct, or `0xFFFFFFFF`
 *                 (-1 long) for early exit.
 * @param arg1     Word arg1 (X bias). Only the low 16 bits are used.
 * @param arg2     Word arg2 (Y bias). Only the low 16 bits are used.
 * @param arg3     Word arg3 (OR mask applied to A1 output).
 * @param subs     Callback bag; default ROM reads return 0.
 */
export function moBlockEmit1A8D2(
  state: GameState,
  arg0Ptr: number,
  arg1: number,
  arg2: number,
  arg3: number,
  subs: MoBlockEmit1A8D2Subs = {},
): void {
  const romRead = subs.romRead ?? ((_o: number): number => 0);

  // 0x1A8DA..0x1A8E2: load arg words (low 16 bit).
  let D1 = arg1 & 0xffff;
  let D2 = arg2 & 0xffff;
  const D3 = arg3 & 0xffff;

  // 0x1A8E6..0x1A8FE: load cursor pointers + counter from workRam.
  let A1 = readLongAbs(state, CURSOR_A1_ADDR, romRead) >>> 0;
  let A2 = readLongAbs(state, CURSOR_A2_ADDR, romRead) >>> 0;
  let A3 = readLongAbs(state, CURSOR_A3_ADDR, romRead) >>> 0;
  let A4 = readLongAbs(state, CURSOR_A4_ADDR, romRead) >>> 0;
  let D7 = readWordAbs(state, COUNTER_D7_ADDR, romRead) & 0xffff;

  const ptr = arg0Ptr >>> 0;

  // 0x1A904..0x1A908: if (arg0_ptr == -1) early-exit (only writeback).
  if (ptr !== ARG0_SENTINEL) {
    // 0x1A90C: D1w += sign_ext_byte(*(A0+0))
    const xBiasByte = readByteAbs(state, ptr, romRead);
    D1 = (D1 + s8(xBiasByte)) & 0xffff;

    // 0x1A912: D2w += sign_ext_byte(*(A0+1))
    const yBiasByte = readByteAbs(state, ptr + 1, romRead);
    D2 = (D2 + s8(yBiasByte)) & 0xffff;

    // 0x1A91A: D0 = *long(A0+8); flag = D0 & 1; D0 = D0 & ~1
    const headerLong = readLongAbs(state, ptr + 8, romRead) >>> 0;
    const flagBit0 = headerLong & 1;
    const bodyPtr = (headerLong & ~1) >>> 0;

    // 0x1A922..0x1A930: branch on flag.
    let D4: number;
    let D5: number;
    if (flagBit0 !== 0) {
      // bit0 was 1: D4w = 0x8000, D5w = 0xFF00 (decrement step).
      D4 = 0x8000;
      D5 = 0xff00;
    } else {
      // bit0 was 0: D4w = 0, D5w = 0x0100.
      D4 = 0x0000;
      D5 = 0x0100;
    }

    // 0x1A934: A0 = body_ptr.
    let A0 = bodyPtr;

    // 0x1A936: D6b = *(A0)+
    let D6 = readByteAbs(state, A0, romRead) & 0xff;
    A0 = (A0 + 1) >>> 0;

    // 0x1A938..0x1A93C: if (D6b == 0xFF) → SHORT_BRANCH.
    if (D6 === 0xff) {
      // ─── SHORT BRANCH (triple-stream) ────────────────────────────────────

      // 0x1A970: A0 += 1 (skip 1 byte).
      A0 = (A0 + 1) >>> 0;

      // 0x1A972: D6b = *(A0)+   (real count).
      D6 = readByteAbs(state, A0, romRead) & 0xff;
      A0 = (A0 + 1) >>> 0;

      // 0x1A974: D1w += sign_ext_byte(*(A0)+); D1w = (D1w << 5) & 0x3FE0
      const dxByte = readByteAbs(state, A0, romRead);
      A0 = (A0 + 1) >>> 0;
      D1 = (D1 + s8(dxByte)) & 0xffff;
      D1 = ((D1 << 5) & 0x3fe0) & 0xffff;

      // SHORT_LOOP @ 0x1A980 — `subq.b/bne` ⇒ do/while
      do {
        // 0x1A980: *(A2)+ = D1w
        writeWordAbs(state, A2, D1);
        A2 = (A2 + 2) >>> 0;

        // 0x1A982: D4w &= 0x8000   (clear low byte, KEEP high bit-15).
        D4 = D4 & 0x8000;

        // 0x1A986: D4b |= *(A0)+
        const d4Byte = readByteAbs(state, A0, romRead);
        A0 = (A0 + 1) >>> 0;
        D4 = (D4 & 0xff00) | ((D4 | d4Byte) & 0xff);

        // 0x1A988: D0w = D2w + sign_ext_byte(*(A0)+); D0w = (D0w << 5) & 0x3FE0;
        // D0w |= D4w
        const dyByte = readByteAbs(state, A0, romRead);
        A0 = (A0 + 1) >>> 0;
        let D0 = (D2 + s8(dyByte)) & 0xffff;
        D0 = ((D0 << 5) & 0x3fe0) & 0xffff;
        D0 = (D0 | D4) & 0xffff;

        // 0x1A996: *(A3)+ = D0w
        writeWordAbs(state, A3, D0);
        A3 = (A3 + 2) >>> 0;

        // 0x1A998..0x1A99C: D0w = *(A0)+ word; D0w |= D3w; *(A1)+ = D0w
        const wordVal = readWordAbs(state, A0, romRead);
        A0 = (A0 + 2) >>> 0;
        const a1Out = (wordVal | D3) & 0xffff;
        writeWordAbs(state, A1, a1Out);
        A1 = (A1 + 2) >>> 0;

        // 0x1A99E: *(A4)+ = D7w
        writeWordAbs(state, A4, D7);
        A4 = (A4 + 2) >>> 0;

        // 0x1A9A0: D7w += 1
        D7 = (D7 + 1) & 0xffff;

        // 0x1A9A2: D1w += D5w
        D1 = (D1 + D5) & 0xffff;

        // 0x1A9A4: D6b -= 1
        D6 = (D6 - 1) & 0xff;
      } while (D6 !== 0);
    } else {
      // ─── LONG BRANCH (word-stream) ────────────────────────────────────────

      // 0x1A93E: D1w += sign_ext_byte(*(A0)+); D1w = (D1w << 5) & 0x3FE0
      const dxByte = readByteAbs(state, A0, romRead);
      A0 = (A0 + 1) >>> 0;
      D1 = (D1 + s8(dxByte)) & 0xffff;
      D1 = ((D1 << 5) & 0x3fe0) & 0xffff;

      // 0x1A94A: D4b |= *(A0)+
      const d4Byte = readByteAbs(state, A0, romRead);
      A0 = (A0 + 1) >>> 0;
      D4 = (D4 & 0xff00) | ((D4 | d4Byte) & 0xff);

      // 0x1A94C: D2w += sign_ext_byte(*(A0)+); D2w = (D2w << 5) & 0x3FE0;
      // D2w |= D4w
      const dyByte = readByteAbs(state, A0, romRead);
      A0 = (A0 + 1) >>> 0;
      D2 = (D2 + s8(dyByte)) & 0xffff;
      D2 = ((D2 << 5) & 0x3fe0) & 0xffff;
      D2 = (D2 | D4) & 0xffff;

      // LONG_LOOP @ 0x1A95A — `subq.b/bne` ⇒ do/while
      do {
        // 0x1A95A..0x1A95E: D0w = *(A0)+ word; D0w |= D3w; *(A1)+ = D0w
        const wordVal = readWordAbs(state, A0, romRead);
        A0 = (A0 + 2) >>> 0;
        const a1Out = (wordVal | D3) & 0xffff;
        writeWordAbs(state, A1, a1Out);
        A1 = (A1 + 2) >>> 0;

        // 0x1A960: *(A2)+ = D1w
        writeWordAbs(state, A2, D1);
        A2 = (A2 + 2) >>> 0;

        // 0x1A962: *(A3)+ = D2w
        writeWordAbs(state, A3, D2);
        A3 = (A3 + 2) >>> 0;

        // 0x1A964: *(A4)+ = D7w
        writeWordAbs(state, A4, D7);
        A4 = (A4 + 2) >>> 0;

        // 0x1A966: D7w += 1
        D7 = (D7 + 1) & 0xffff;

        // 0x1A968: D1w += D5w
        D1 = (D1 + D5) & 0xffff;

        // 0x1A96A: D6b -= 1
        D6 = (D6 - 1) & 0xff;
      } while (D6 !== 0);
    }
  }

  // 0x1A9A8..0x1A9C0: writeback A1, A2, A3, A4 (long), D7 (word).
  writeLongAbs(state, CURSOR_A1_ADDR, A1);
  writeLongAbs(state, CURSOR_A2_ADDR, A2);
  writeLongAbs(state, CURSOR_A3_ADDR, A3);
  writeLongAbs(state, CURSOR_A4_ADDR, A4);
  writeWordAbs(state, COUNTER_D7_ADDR, D7);
}
