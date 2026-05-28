/**
 * Replica of `FUN_00025FC2`, an animation-sequence stepper for paired objects.
 *
 * The routine advances an object's primary animation pointer, handles the
 * secondary overlay pointer for state 2, detects ROM sentinel `0xFFFFFFFF`, and
 * dispatches follow-up state transitions or sound commands through injectable
 * subroutines.
 *
 * Important object fields relative to `objPtr`:
 *   - 0x18: secondary state.
 *   - 0x19: sub-index passed to `FUN_00018F46`.
 *   - 0x1A: primary state byte.
 *   - 0x56: sentinel step counter.
 *   - 0x57: object type byte set to 0x65 on special transitions.
 *   - 0x5A: primary animation ROM pointer.
 *   - 0x5F/0x60: frame counter and frames per step.
 *   - 0x62/0x66: secondary animation pointer and sub-frame counter.
 *   - 0x67: state-2 wrap flag.
 *
 * Hardcoded ROM/work-RAM anchors:
 *   - A1 = 0x20FDE, the primary animation table base.
 *   - A3 = 0x400018, the first object in the pair.
 *   - A3 + 0xE2 = 0x4000FA, the second object in the pair.
 *
 * Verified by `packages/cli/src/test-helper-25fc2-parity.ts`.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// Public constants.

export const HELPER_25FC2_ADDR = 0x00025fc2 as const;

export const ANIM_BASE_ROM = 0x00020fde as const;

/** Base of the paired object structs in work RAM. */
export const OBJECT_PAIR_BASE = 0x00400018 as const;

export const OBJECT_PAIR_SECOND_OFFSET = 0xe2 as const;

export const ANIM_PTRS = {
  highCount: 0x00020fb6,
  lowCount: 0x00020fd2,
  secondary: 0x000215f6,
} as const;

/** Sound command sent when state 2 wraps to animation index 9. */
export const SOUND_WRAP_INDEX9 = 0x5f as const;

/** External subroutine addresses, kept for parity references and tests. */
export const HELPER_25FC2_SUB_ADDRS = {
  /** `FUN_000158AC`, the sound command sender. */
  fun_158AC: 0x000158ac,
  /** `FUN_00015884`, the paired sound trigger. */
  fun_15884: 0x00015884,
  /** `FUN_00025BAE`, the object state-transition entry. */
  fun_25BAE: 0x00025bae,
  /** `FUN_00018F46`, the remove-from-draw-list helper. */
  fun_18F46: 0x00018f46,
} as const;

// Work-RAM bounds on the 68000 bus.

const WORK_RAM_BASE = 0x00400000 as const;
const WORK_RAM_END = 0x00402000 as const;

// External subroutine injection.

/**
 * Injectable external subroutines orchestrated by `FUN_00025FC2`.
 */
export interface Helper25FC2Subs {
  /**
   * `FUN_158AC(cmd)` — sound command sender.
   */
  soundCommand?: (cmd: number) => void;

  /**
   * `FUN_00015884()` — paired sound trigger.
   */
  soundPair15884?: (state: GameState) => void;

  /**
   * `FUN_00025BAE(objPtr, subStateCode)`, the object state-transition entry.
   */
  objectStateEntry25BAE?: (
    state: GameState,
    objPtr: number,
    subStateCode: number,
  ) => void;

  /**
   * `FUN_00018F46(typeCode, subIdx)`, the remove-from-draw-list helper.
   */
  helper18F46?: (
    state: GameState,
    rom: RomImage,
    typeCode: number,
    subIdx: number,
  ) => void;
}

// Internal RAM and ROM helpers.

function readU8(wr: Uint8Array, addrAbs: number): number {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_END) return 0;
  return (wr[a - WORK_RAM_BASE] ?? 0) & 0xff;
}

function writeU8(wr: Uint8Array, addrAbs: number, value: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a >= WORK_RAM_END) return;
  wr[a - WORK_RAM_BASE] = value & 0xff;
}

function writeU16BE(wr: Uint8Array, addrAbs: number, value: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 1 >= WORK_RAM_END) return;
  const o = a - WORK_RAM_BASE;
  const v = value & 0xffff;
  wr[o] = (v >>> 8) & 0xff;
  wr[o + 1] = v & 0xff;
}

function readU32BE_wr(wr: Uint8Array, addrAbs: number): number {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 3 >= WORK_RAM_END) return 0;
  const o = a - WORK_RAM_BASE;
  return (
    (((wr[o] ?? 0) << 24) |
      ((wr[o + 1] ?? 0) << 16) |
      ((wr[o + 2] ?? 0) << 8) |
      (wr[o + 3] ?? 0)) >>>
    0
  );
}

function writeU32BE_wr(wr: Uint8Array, addrAbs: number, value: number): void {
  const a = addrAbs >>> 0;
  if (a < WORK_RAM_BASE || a + 3 >= WORK_RAM_END) return;
  const o = a - WORK_RAM_BASE;
  const v = value >>> 0;
  wr[o] = (v >>> 24) & 0xff;
  wr[o + 1] = (v >>> 16) & 0xff;
  wr[o + 2] = (v >>> 8) & 0xff;
  wr[o + 3] = v & 0xff;
}

function readU32BE_rom(rom: RomImage, absOff: number): number {
  const o = absOff >>> 0;
  const b0 = (rom.program[o] ?? 0) & 0xff;
  const b1 = (rom.program[o + 1] ?? 0) & 0xff;
  const b2 = (rom.program[o + 2] ?? 0) & 0xff;
  const b3 = (rom.program[o + 3] ?? 0) & 0xff;
  return ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
}


/** Runs one `FUN_00025FC2` animation step for an object pointer. */
export function helper25FC2(
  state: GameState,
  rom: RomImage,
  objPtr: number,
  subs: Helper25FC2Subs = {},
): void {
  const wr = state.workRam;
  const obj = objPtr >>> 0;

  // Local ROM registers A1 and A3 from the original routine.
  const A1 = ANIM_BASE_ROM;          // 0x20FDE
  const A3 = OBJECT_PAIR_BASE;       // 0x400018
  const A3_SECOND = (A3 + OBJECT_PAIR_SECOND_OFFSET) >>> 0; // 0x4000FA

  // Block 1: secondary sub-frame advance for state 2 within the animation range.
  // cmpi.b #2, 0x1A(a2)  / bne.b → 0x2601A
  const state1A = readU8(wr, obj + 0x1a);
  if (state1A === 0x02) {
    const animPtr = readU32BE_wr(wr, obj + 0x5a);

    // `bcc` skips unless `animPtr > A1` in unsigned space.
    const continueSubFrame =
      animPtr > A1 &&
      animPtr < (A1 + 0x80) >>> 0 &&
      (((animPtr - A1) >>> 2) & 0xffff) > 9;

    if (continueSubFrame) {
      // `addq.b #1,0x66(a2)` wraps at 0xFF.
      const subFrameCtr = (readU8(wr, obj + 0x66) + 1) & 0xff;
      writeU8(wr, obj + 0x66, subFrameCtr);

      // cmpi.b #1, 0x66(a2) / bne.b → 0x2601A
      if (subFrameCtr === 1) {
        // clr.b 0x66(a2)
        writeU8(wr, obj + 0x66, 0);
        // Advance the secondary pointer with 32-bit wraparound.
        const secPtr = readU32BE_wr(wr, obj + 0x62);
        writeU32BE_wr(wr, obj + 0x62, (secPtr + 4) >>> 0);
      }
    }
  }

  // Block 2: main frame advance.
  // addq.b #1, 0x5F(a2)
  const frameCtr = (readU8(wr, obj + 0x5f) + 1) & 0xff;
  writeU8(wr, obj + 0x5f, frameCtr);

  // move.b 0x60(a2), d0 / cmp.b 0x5F(a2), d0 / bgt.w → 0x26190
  // `bgt` after `cmp.b` is a signed byte compare.
  // D0 = frames_per_step, src = frame_ctr
  // bgt = branch if frames_per_step > frame_ctr -> return early
  const framesPerStep = readU8(wr, obj + 0x60);
  // Interpret both operands as signed bytes, matching the condition codes.
  const fpsSigned = framesPerStep >= 0x80 ? framesPerStep - 0x100 : framesPerStep;
  const fcSigned = frameCtr >= 0x80 ? frameCtr - 0x100 : frameCtr;
  if (fpsSigned > fcSigned) {
    return; // bgt.w → 0x26190 (epilog)
  }

  // Frame counter expired: reset and advance.
  writeU8(wr, obj + 0x5f, 0);           // clr.b 0x5F(a2)
  const animPtrOld = readU32BE_wr(wr, obj + 0x5a);
  writeU32BE_wr(wr, obj + 0x5a, (animPtrOld + 4) >>> 0); // addq.l #4, 0x5A(a2)

  // Block 3: state-2 wrap detection at new animation index 9.
  // cmpi.b #2, 0x1A(a2) / bne.b → 0x26070
  if (state1A === 0x02) {
    const newAnimPtr = readU32BE_wr(wr, obj + 0x5a);
    // Compute index = (newAnimPtr - A1) / 4 in the low word.
    const offsetW = ((newAnimPtr - A1) >>> 0) & 0xffffffff;
    const index = ((offsetW >>> 2) & 0xffff); // .w (low 16 bit)
    if (index === 9) {
      // Dead load: `move.w 0x20(a2),D0`; no consumed flags or side effects.

      // move.l #0x215F6, 0x62(a2)
      writeU32BE_wr(wr, obj + 0x62, ANIM_PTRS.secondary);
      // clr.b 0x66(a2)
      writeU8(wr, obj + 0x66, 0);
      // move.b #1, 0x67(a2)
      writeU8(wr, obj + 0x67, 1);
      // pea 0x5F.l / jsr 0x158AC / addq.l #4, a7
      subs.soundCommand?.(SOUND_WRAP_INDEX9);
    }
  }

  // Block 4: sentinel check.
  // movea.l 0x5A(a2), A0 / moveq #-1, D0 / cmp.l (A0), D0
  // Non-sentinel entries leave the animation running.
  const finalAnimPtr = readU32BE_wr(wr, obj + 0x5a);
  const sentinel = readU32BE_rom(rom, finalAnimPtr);
  if (sentinel !== 0xffffffff) {
    return; // bne.w → 0x26190
  }

  // Animation ended: dispatch by state.
  const stateNow = readU8(wr, obj + 0x1a);

  // cmpi.b #1, 0x1A(a2) / beq.w → 0x2608E
  // cmpi.b #5, 0x1A(a2) / bne.b → 0x260C2
  if (stateNow === 0x01 || stateNow === 0x05) {
    // States 1 and 5 reset to one of two animation tables.
    const step56 = readU8(wr, obj + 0x56);
    // `ble` is signed; values <= 6 use the low-count table.
    const step56Signed = step56 >= 0x80 ? step56 - 0x100 : step56;
    writeU8(wr, obj + 0x5f, 0);   // clr.b 0x5F(a2)
    writeU8(wr, obj + 0x60, 2);   // move.b #2, 0x60(a2)
    if (step56Signed > 6) {
      writeU32BE_wr(wr, obj + 0x5a, ANIM_PTRS.highCount); // 0x20FB6
    } else {
      writeU32BE_wr(wr, obj + 0x5a, ANIM_PTRS.lowCount); // 0x20FD2
    }
    return;
  }

  if (stateNow !== 0x02) {
    // Other states dispatch to sub-state 4.
    // 0x2617C:
    writeU8(wr, obj + 0x57, 0x65);  // move.b #0x65, 0x57(a2)
    subs.objectStateEntry25BAE?.(state, obj, 0x04);
    return;
  }

  // State-2 sentinel handler.
  const step56 = readU8(wr, obj + 0x56);

  // Step 0 resets the primary animation and marks step 1.
  if (step56 === 0) {
    writeU8(wr, obj + 0x5f, 0);               // clr.b 0x5F(a2)
    writeU8(wr, obj + 0x60, 2);               // move.b #2, 0x60(a2)
    writeU32BE_wr(wr, obj + 0x5a, ANIM_PTRS.lowCount); // move.l #0x20FD2, 0x5A(a2)
    writeU8(wr, obj + 0x56, 1);               // move.b #1, 0x56(a2)
    return;
  }

  // Step 1 emits the paired sound and enters sub-state 2.
  if (step56 === 1) {
    subs.soundPair15884?.(state);
    subs.objectStateEntry25BAE?.(state, obj, 0x02);
    return;
  }

  // 0x2610E:
  writeU8(wr, obj + 0x67, 0); // clr.b 0x67(a2)

  if (obj === A3 || obj === A3_SECOND) {
    writeU16BE(wr, obj + 0xa4, 0); // clr.w 0xA4(a2)
  }

  // 0x26126: cmpi.b #2, 0x18(a2) / bne.b → 0x26166
  const secondaryState = readU8(wr, obj + 0x18);
  if (secondaryState === 0x02) {
    // clr.b 0x18(a2)
    writeU8(wr, obj + 0x18, 0);

    let typeCode: number;
    if (obj === A3) {
      typeCode = 1;
    } else {
      // The second paired object uses type code 1; other objects use 2.
      typeCode = obj === A3_SECOND ? 1 : 2;
    }

    // The ROM sign-extends `obj[0x19]`; the callee masks it back to a byte.
    const subIdx = readU8(wr, obj + 0x19);
    // jsr 0x18F46.l — helper18F46(typeCode, subIdx)
    subs.helper18F46?.(state, rom, typeCode, subIdx);
    return;
  }

  // 0x26166: secondary state is not 2, so mark type 0x65 and dispatch state 4.
  writeU8(wr, obj + 0x57, 0x65);  // move.b #0x65, 0x57(a2)
  subs.objectStateEntry25BAE?.(state, obj, 0x04);
}
