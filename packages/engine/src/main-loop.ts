/**
 * main-loop.ts - Marble Madness game-tick orchestrator.
 *
 * Progressively mirrors `FUN_00028788` (MainUpdate, called by `0x10116`
 * MainGameTick -> IRQ4 VBLANK).
 *
 * **Status Phase 4d**: implementati i blocchi:
 *   - `mainUpdateScrollSync`: prefix of MainUpdate (scroll/AV-control sync)
 *
 * Open:
 *   - conditional demo-update block (FUN_26D8A)
 *   - palette animation sub-updates already live in palette-anim/palette-queue
 *   - BIOS services FUN_2E18 and FUN_4CA0
 *   - game logic FUN_28A96 input, FUN_1AC18 AI/sprite, FUN_28972 state
 *   - watchdog kick and coin counter logic
 */

import type { GameState } from "./state.js";

// ─── Constants (offsets in workRam, base 0x400000) ────────────────────────

const SCROLL_DIRTY_FLAG_OFF = 0x39a;        // 0x40039A: u8 flag
const FRAME_TICK_LONG_OFF = 0x10;           // 0x400010: u32 incrementer
const SCROLL_Y_TARGET_OFF = 0x00;           // 0x400000: u16 source
const SCROLL_Y_LATCHED_OFF = 0x02;          // 0x400002: u16 dest, written to $820000
const AV_CONTROL_CACHE_OFF = 0x3ae;         // 0x4003AE: u16 dest, written to $860000
const AV_CONTROL_NEW_OFF = 0x3b0;           // 0x4003B0: u16 source

// ─── Helpers ──────────────────────────────────────────────────────────────

function readU32BE(buf: Uint8Array, off: number): number {
  return (
    ((buf[off] ?? 0) << 24) |
    ((buf[off + 1] ?? 0) << 16) |
    ((buf[off + 2] ?? 0) << 8) |
    (buf[off + 3] ?? 0)
  ) >>> 0;
}

function writeU32BE(buf: Uint8Array, off: number, v: number): void {
  buf[off] = (v >>> 24) & 0xff;
  buf[off + 1] = (v >>> 16) & 0xff;
  buf[off + 2] = (v >>> 8) & 0xff;
  buf[off + 3] = v & 0xff;
}

// ─── mainUpdateScrollSync (prefix of FUN_28788) ───────────────────────────

/**
 * Mirrors MainUpdate lines 0x28788..0x287D8:
 *
 *   if (*0x40039A != 0):
 *     *0x400010 += 1                   ; long incrementer
 *     *0x400002 = *0x400000             ; latch Y target
 *     *0x4003AE = *0x4003B0             ; latch AV-control
 *     *0x40039A = 0                     ; clear flag
 *   *0x820000 = *0x400002               ; MMIO Y scroll  (ALWAYS, outside the if)
 *   *0x800000 = 0                       ; MMIO X scroll  (ALWAYS)
 *   *0x860000 = *0x4003AE               ; MMIO AV-control (ALWAYS)
 *
 * The three MMIO writes are outside the if. videoScrollX/Y are updated on every
 * call, even when the dirty flag was 0. The rendering layer reads
 * `state.videoScrollX/Y` and applies them to `Frame.scrollX/Y`.
 */
export function mainUpdateScrollSync(state: GameState): void {
  const flag = state.workRam[SCROLL_DIRTY_FLAG_OFF] ?? 0;

  if (flag !== 0) {
    // *0x400010 += 1 (long, addq.l #1)
    let ctr = readU32BE(state.workRam, FRAME_TICK_LONG_OFF);
    ctr = (ctr + 1) >>> 0;
    writeU32BE(state.workRam, FRAME_TICK_LONG_OFF, ctr);

    // *0x400002 = *0x400000 (word)
    state.workRam[SCROLL_Y_LATCHED_OFF] = state.workRam[SCROLL_Y_TARGET_OFF] ?? 0;
    state.workRam[SCROLL_Y_LATCHED_OFF + 1] = state.workRam[SCROLL_Y_TARGET_OFF + 1] ?? 0;

    // *0x4003AE = *0x4003B0 (word)
    state.workRam[AV_CONTROL_CACHE_OFF] = state.workRam[AV_CONTROL_NEW_OFF] ?? 0;
    state.workRam[AV_CONTROL_CACHE_OFF + 1] = state.workRam[AV_CONTROL_NEW_OFF + 1] ?? 0;

    // Clear flag
    state.workRam[SCROLL_DIRTY_FLAG_OFF] = 0;
  }

  // Three MMIO writes always executed outside the 0x40039A branch.
  // *0x820000 = *0x400002 (Y scroll MMIO, 9-bit)
  const yScrollWord =
    (((state.workRam[SCROLL_Y_LATCHED_OFF] ?? 0) << 8) |
      (state.workRam[SCROLL_Y_LATCHED_OFF + 1] ?? 0)) & 0xffff;
  state.videoScrollY = yScrollWord & 0x1ff;
  // *0x800000 = 0 (X scroll MMIO)
  state.videoScrollX = 0;
  // *0x860000 = *0x4003AE. AV control has no dedicated field; the renderer can
  // read workRam directly when bank selection needs it.
}
