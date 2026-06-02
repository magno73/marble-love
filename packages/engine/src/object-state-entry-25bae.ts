/**
 * Port of ROM routine `FUN_00025BAE`.
 *
 * Handles object state-entry setup for sub-state codes 2, 9, and 4. It clears
 * two leading object longs, conditionally writes state byte `+0x18`, dispatches
 * by the sub-state byte, and exposes the two external calls through callbacks:
 * `FUN_158AC` for sound commands and `FUN_2591A` for full object init.
 *
 * Case highlights:
 *   - state 2 sends sound 0x38 and sets sprite/control fields.
 *   - state 9 sets an alternate sprite/control block without sound.
 *   - state 4 calls object init, sends sound 0x3C or 0x3D, clears `+0x5A`, and
 *     increments word `+0xD2` with 16-bit wrap.
 */

import type { GameState } from "./state.js";

/** Absolute work RAM base (`0x400000` on the M68K bus). */
const WORK_RAM_BASE = 0x400000;
/** Exclusive workRam upper bound (`0x400000 + 0x2000`). */
const WORK_RAM_END = 0x402000;

export const OBJECT_STATE_ENTRY_25BAE_ADDR = 0x00025bae as const;

/** Addresses of the two external subroutine calls used by FUN_25BAE. */
export const OBJECT_STATE_ENTRY_25BAE_SUB_ADDRS = {
  /** `FUN_158AC`: sound command sender (byte LSB of the pushed long). */
  fun_158AC: 0x000158ac,
  /** `FUN_2591A` — object full initializer (`objectInit2591A`). */
  fun_2591A: 0x0002591a,
} as const;

export const OBJECT_STATE_ENTRY_25BAE_CODES = {
  /** Case 2: set up state 2 sprite fields + sound 0x38. */
  state2: 0x02,
  /** Case 9: set up state 9 sprite fields (no sound). */
  state9: 0x09,
  /** Case 4: full init via FUN_2591A + sound 0x3C/0x3D + counter inc. */
  state4: 0x04,
} as const;

/** Sound command IDs hardcoded in FUN_25BAE via `pea (imm).l; jsr FUN_158AC`. */
export const OBJECT_STATE_ENTRY_25BAE_SOUND_IDS = {
  /** Case 2 sound. */
  case2: 0x38,
  /** Case 4 sound if A2[+0x57] == 0x65. */
  case4_match65: 0x3c,
  /** Case 4 sound if A2[+0x57] != 0x65. */
  case4_otherwise: 0x3d,
} as const;

/** Sprite-descriptor pointer ROM (case 2). */
export const SPRITE_PTR_CASE2 = 0x00020fde as const;
/** Sprite-descriptor pointer ROM (case 9). */
export const SPRITE_PTR_CASE9 = 0x00021062 as const;

export const FIELD_57_MATCH_VALUE = 0x65 as const;

/**
 */
export interface ObjectStateEntry25BAESubs {
  /**
   * `FUN_158AC(cmd)` — sound command sender. Invoked once in case 2;
   * we pass the byte directly.
   */
  soundCommand?: (cmd: number) => void;
  /**
   * `FUN_2591A(objPtr)` — `objectInit2591A`, full object initializer.
   * Invoked only in case 4. Default no-op (the parity test patches
   * `FUN_2591A` with `rts` to isolate the direct writes from FUN_25BAE).
   *
   * Called internally to allow stub injection in tests.
   */
  fun_2591A?: (state: GameState, objPtr: number) => void;
  /**
   * **MAME-NET integration flag** (NOT part of the raw disasm):
   *
   * In MAME demo gameplay f12000+, obj0 invariantly has s1a=0, s58=0,
   * s36=0 — the chain `helper121B8 → OUT_OF_RANGE | BOUNCE_BELOW_TARGET`
   * flag from the caller (refresh-frame / helper121B8) allows preserving
   *
   * with MAME guaranteed by the test).
   */
  preserveVelocity?: boolean;
}

// ─── Internal helpers: read/write byte/word/long on workRam (BE M68k) ──────

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

function writeU16BE(workRam: Uint8Array, addrAbs: number, value: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 1 >= WORK_RAM_END) return;
  const off = a - WORK_RAM_BASE;
  const v = value & 0xffff;
  workRam[off] = (v >>> 8) & 0xff;
  workRam[off + 1] = v & 0xff;
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

/**
 * Runs `FUN_00025BAE`, the object state-transition entry.
 *
 * The two subroutine calls are exposed through `subs` and default to no-op.
 * `objPtr` must point inside work RAM and cover the fields touched by each case.
 *
 * @param subStateCode   Byte selector (LSB of the second pushed long).
 * @param subs           Callback bag for the two external subroutine calls.
 */
export function objectStateEntry25BAE(
  state: GameState,
  objPtr: number,
  subStateCode: number,
  subs: ObjectStateEntry25BAESubs = {},
): void {
  const wr = state.workRam;
  const objAbs = objPtr >>> 0;
  const code = subStateCode & 0xff;


  // 0x25BB8..0x25BBE: A2[+0x4] = 0 (long); A2[+0x0] = 0 (long).
  // cross-platform determinism (even though equivalent for pure workRam).
  // `preserveVelocity` flag (MAME-net integration override, see the
  // `ObjectStateEntry25BAESubs.preserveVelocity` interface for rationale):
  if (subs.preserveVelocity !== true) {
    writeU32BE(wr, objAbs + 0x04, 0);
    writeU32BE(wr, objAbs + 0x00, 0);
  }

  // 0x25BC0..0x25BCC: cmpi.b #6,(0x1A,A2); bne skip; move.b #3,(0x18,A2)
  if (readU8(wr, objAbs + 0x1a) === 0x06) {
    writeU8(wr, objAbs + 0x18, 0x03);
  }

  // ── Dispatch on subStateCode (byte) ──────────────────────────────────

  if (code === 0x02) {
    // 0x25BD4..0x25BDA: dead-load `move.w (0x20,A2),D0w; andi.w #-1,D0w`.
    // Not modeled: caller-saved D0 + CCR flags are not consumed. Skip.

    // 0x25BDC..0x25BE6: pea 0x38; jsr FUN_158AC; addq.l #4,SP
    subs.soundCommand?.(OBJECT_STATE_ENTRY_25BAE_SOUND_IDS.case2);

    // 0x25BE8..0x25C04: direct writes
    writeU8(wr, objAbs + 0x5f, 0); // clr.b (0x5F,A2)
    writeU8(wr, objAbs + 0x60, 0x02); // move.b #2,(0x60,A2)
    writeU32BE(wr, objAbs + 0x5a, SPRITE_PTR_CASE2); // move.l #0x20FDE,(0x5A,A2)
    writeU8(wr, objAbs + 0x56, 0x02); // move.b #2,(0x56,A2)
    writeU8(wr, objAbs + 0x1a, 0x02); // move.b #2,(0x1A,A2)
    return;
  }

  if (code === 0x09) {
    writeU8(wr, objAbs + 0x5f, 0); // clr.b (0x5F,A2)
    writeU8(wr, objAbs + 0x60, 0x04); // move.b #4,(0x60,A2)
    writeU32BE(wr, objAbs + 0x5a, SPRITE_PTR_CASE9); // move.l #0x21062,(0x5A,A2)
    writeU8(wr, objAbs + 0x1a, 0x09); // move.b #9,(0x1A,A2)
    return;
  }

  if (code === 0x04) {
    // 0x25C32..0x25C40: jsr FUN_2591A(A2)
    subs.fun_2591A?.(state, objAbs);

    // 0x25C3A..0x25C42: cmpi.b #0x65,(0x57,A2); bne 0x25C54
    const v57 = readU8(wr, objAbs + 0x57);
    if (v57 === FIELD_57_MATCH_VALUE) {
      // 0x25C44..0x25C50: pea 0x3C; jsr FUN_158AC; addq.l #4,SP
      subs.soundCommand?.(OBJECT_STATE_ENTRY_25BAE_SOUND_IDS.case4_match65);
    } else {
      // 0x25C54..0x25C60: pea 0x3D; jsr FUN_158AC; addq.l #4,SP
      subs.soundCommand?.(OBJECT_STATE_ENTRY_25BAE_SOUND_IDS.case4_otherwise);
    }

    // 0x25C62..0x25C66: clr.l (0x5A,A2); move.b #4,(0x1A,A2)
    writeU32BE(wr, objAbs + 0x5a, 0);
    writeU8(wr, objAbs + 0x1a, 0x04);

    // 0x25C6C: addq.w #1,(0xD2,A2) — word increment with 16-bit wrap.
    const cur = readU16BE(wr, objAbs + 0xd2);
    writeU16BE(wr, objAbs + 0xd2, (cur + 1) & 0xffff);
    return;
  }

}
