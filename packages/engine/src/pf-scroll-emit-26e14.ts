/**
 * pf-scroll-emit-26e14.ts — replica `FUN_00026E14` (298 byte).
 *
 * Emits the sprite list into the "next" buffer during scroll/page flip.
 *
 * Key differences from `FUN_00026D8A`:
 *   - Toggles `*0x4003B0` for double-buffer page flip.
 *   - Initializes the four write cursors (`0x4003F6/3FA/3FE/402`) to the
 *     inactive page.
 *   - Uses the original AV value for the four read pointers. Tile words are
 *     merged with `0x3FE0`-style low-bit adjustment while preserving bits 14..15.
 *
 * Strutture in spriteRam (4 sub-buffer × 0x80 byte = 64 word):
 *   0xA02000+  (A2 in source) — tile linee A
 *   0xA02080+  (D3 in source) — tile linee B (passthrough)
 *   0xA02100+  (A4 in source) — tile linee C (passthrough)
 *   0xA02180+  (A3 in source) — comparison column (loop guard)
 * With AV bit 3 set, bases become +0x200 / +0x280 / +0x300 / +0x380.
 *
 * Each iteration emits four words to the "next" buffers pointed to by the four
 * long cursors; each cursor post-increments by 2. The loop exits as soon as
 * `cmpWord(A3)+ == iterIndex`,
 * with a 60-iteration cap.
 *
 * The caller pushes either `*0x400000` (target Y scroll, sign-extended long) or
 * constant `2` as `arg`.
 */

import { WORK_RAM_BASE, SPRITE_RAM_BASE } from "./bus.js";
import type { GameState } from "./state.js";

// ─── Workram offsets ──────────────────────────────────────────────────────
const AV_CONTROL_OFF = 0x3ae;       // 0x4003AE (read: source AV)
const AV_CONTROL_NEW_OFF = 0x3b0;   // 0x4003B0 (write: toggled AV)
const WPTR_A_OFF = 0x3f6;           // 0x4003F6 — long ptr buffer A (0xA02000+)
const WPTR_B_OFF = 0x3fa;           // 0x4003FA — long ptr buffer B (0xA02080+)
const WPTR_C_OFF = 0x3fe;           // 0x4003FE — long ptr buffer C (0xA02100+)
const WPTR_D_OFF = 0x402;           // 0x400402 — long ptr buffer D (0xA02180+)

// ─── Sprite-RAM bank offsets ──────────────────────────────────────────────
const BANK_A_OFF = 0x000;  // 0xA02000
const BANK_B_OFF = 0x080;  // 0xA02080
const BANK_C_OFF = 0x100;  // 0xA02100
const BANK_D_OFF = 0x180;  // 0xA02180

const TILE_LOW_MASK = 0x3fff;       // bit 0..13 (lower 14 bits)
const TILE_HIGH_MASK = 0xc000;      // bit 14..15 preserved
const MAX_ITER = 60;                // 0x3C

// ─── BE helpers ───────────────────────────────────────────────────────────
function readU16BE(buf: Uint8Array, off: number): number {
  return (((buf[off] ?? 0) << 8) | (buf[off + 1] ?? 0)) & 0xffff;
}
function writeU16BE(buf: Uint8Array, off: number, v: number): void {
  buf[off] = (v >>> 8) & 0xff;
  buf[off + 1] = v & 0xff;
}
function readU32BE(buf: Uint8Array, off: number): number {
  return (
    ((buf[off] ?? 0) * 0x1000000) +
    (((buf[off + 1] ?? 0) << 16) >>> 0) +
    ((buf[off + 2] ?? 0) << 8) +
    (buf[off + 3] ?? 0)
  ) >>> 0;
}
function writeU32BE(buf: Uint8Array, off: number, v: number): void {
  const u = v >>> 0;
  buf[off] = (u >>> 24) & 0xff;
  buf[off + 1] = (u >>> 16) & 0xff;
  buf[off + 2] = (u >>> 8) & 0xff;
  buf[off + 3] = u & 0xff;
}

function spriteOff(absPtr: number): number {
  return (absPtr >>> 0) - SPRITE_RAM_BASE;
}

/**
 *
 * **Side effects** in `workRam`:
 *   - `*0x4003B0` = `*0x4003AE` ^ 8`  (toggled AV)
 *   - `*0x4003F6 / *0x4003FA / *0x4003FE / *0x400402` = base-pointer +
 *     2*(MAX_ITER hit). The four long cursors are initialized to the "next"
 *     page (toggled AV) and post-incremented by 2 for each emitted word.
 *
 * **Side effect** in `spriteRam`: emits up to 60 words for each buffer.
 * `(src + (arg<<5)) & 0x3FFF | (src & 0xC000)`; B/C/D sono passthrough.
 *
 * MAX_ITER = 60.
 *
 * @param state  GameState, mutated in workRam and spriteRam.
 * @param arg    Signed long pushed by the caller (D2). Pass negative values as
 *               signed JS numbers.
 */
export function pfScrollEmit26E14(state: GameState, arg: number): void {
  const r = state.workRam;
  const sp = state.spriteRam;

  // 0x26e1c..0x26e26: AV_new = AV_old ^ 8; *0x4003B0 = AV_new.
  const avOld = readU16BE(r, AV_CONTROL_OFF);
  const avNew = avOld ^ 0x0008;
  writeU16BE(r, AV_CONTROL_NEW_OFF, avNew);

  // 0x26e2c..0x26e3a: D1_new = (AV_new & 8) << 5  (= 0 or 0x100)
  // Note ext.l + and.l #8 + asl.l #5 == (av & 8) << 5 in JS.
  const d1New = (avNew & 0x0008) << 5;
  const offNew = d1New * 2; // == d1New << 1, 0 or 0x200

  // 0x26e3c..0x26e8a: store 4 long-cursor in workRam (toggled AV).
  // SPRITE_RAM_BASE = 0xA02000.
  writeU32BE(r, WPTR_D_OFF, (SPRITE_RAM_BASE + BANK_D_OFF + offNew) >>> 0);
  writeU32BE(r, WPTR_A_OFF, (SPRITE_RAM_BASE + BANK_A_OFF + offNew) >>> 0);
  writeU32BE(r, WPTR_C_OFF, (SPRITE_RAM_BASE + BANK_C_OFF + offNew) >>> 0);
  writeU32BE(r, WPTR_B_OFF, (SPRITE_RAM_BASE + BANK_B_OFF + offNew) >>> 0);

  // 0x26e8c..0x26eda: re-read AV (orig), recompute D1_old, set up 4
  // local read pointers, not saved in workRam.
  const d1Old = (avOld & 0x0008) << 5;
  const offOld = d1Old * 2; // 0 or 0x200
  let a3 = (BANK_D_OFF + offOld) & 0xffff; // sprite-RAM offset
  let a2 = (BANK_A_OFF + offOld) & 0xffff;
  let a4 = (BANK_C_OFF + offOld) & 0xffff;
  let d3 = (BANK_B_OFF + offOld) & 0xffff;

  // 0x26edc: D4w = 0 (loop counter)
  // 0x26ede..0x26ee2: D2_low = (arg << 5) & 0xFFFF
  const lineOffset = ((arg & 0xffffffff) << 5) & 0xffff;

  // 0x26ee4..0x26f36: loop max 60 iter
  for (let d4 = 0; d4 < MAX_ITER; d4++) {
    // Buffer A (0xA02000+, modify): merge line offset into the tile word.
    // Read current write-cursor (long), point in absolute M68k addr.
    {
      const wptr = readU32BE(r, WPTR_A_OFF) >>> 0;
      const wOff = (wptr - SPRITE_RAM_BASE) >>> 0;
      writeU32BE(r, WPTR_A_OFF, (wptr + 2) >>> 0);
      const src = readU16BE(sp, a2);
      const merged = (((src + lineOffset) & TILE_LOW_MASK) | (src & TILE_HIGH_MASK)) & 0xffff;
      writeU16BE(sp, wOff, merged);
      a2 = (a2 + 2) & 0xffff;
    }

    // ── Buffer B (0xA02080+, passthrough da D3 cursor) ──
    {
      const wptr = readU32BE(r, WPTR_B_OFF) >>> 0;
      const wOff = (wptr - SPRITE_RAM_BASE) >>> 0;
      writeU32BE(r, WPTR_B_OFF, (wptr + 2) >>> 0);
      const src = readU16BE(sp, d3);
      writeU16BE(sp, wOff, src);
      d3 = (d3 + 2) & 0xffff;
    }

    // ── Buffer C (0xA02100+, passthrough da A4) ──
    {
      const wptr = readU32BE(r, WPTR_C_OFF) >>> 0;
      const wOff = (wptr - SPRITE_RAM_BASE) >>> 0;
      writeU32BE(r, WPTR_C_OFF, (wptr + 2) >>> 0);
      const src = readU16BE(sp, a4);
      writeU16BE(sp, wOff, src);
      a4 = (a4 + 2) & 0xffff;
    }

    {
      const wptr = readU32BE(r, WPTR_D_OFF) >>> 0;
      const wOff = (wptr - SPRITE_RAM_BASE) >>> 0;
      writeU32BE(r, WPTR_D_OFF, (wptr + 2) >>> 0);
      const src = readU16BE(sp, a3); // (A3) — no post-incr
      writeU16BE(sp, wOff, src);
    }

    // ── Loop guard: cmp.w (A3)+, D0w  (D0 = old D4) → exit if equal ──
    const cmpWord = readU16BE(sp, a3);
    a3 = (a3 + 2) & 0xffff;
    if (cmpWord === d4) return;
    // 0x26f32..0x26f36: while (D4_new < 60) continue.
  }
}

// ─── Constants exports (utility for other modules/tests) ─────────────────
export const PF_SCROLL_EMIT_CONSTANTS = {
  AV_CONTROL_ABS: WORK_RAM_BASE + AV_CONTROL_OFF,
  AV_CONTROL_NEW_ABS: WORK_RAM_BASE + AV_CONTROL_NEW_OFF,
  WPTR_A_ABS: WORK_RAM_BASE + WPTR_A_OFF,
  WPTR_B_ABS: WORK_RAM_BASE + WPTR_B_OFF,
  WPTR_C_ABS: WORK_RAM_BASE + WPTR_C_OFF,
  WPTR_D_ABS: WORK_RAM_BASE + WPTR_D_OFF,
  MAX_ITER,
} as const;

// Silence: spriteOff is unused in production and exposed for debug.
void spriteOff;
