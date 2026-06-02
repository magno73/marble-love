/**
 * script-slot-bbox-test-14e92.ts - replica `FUN_00014E92`.
 *
 * Tests the four script slots (stride `0x60`). It is gated by
 * `*0x400394 in {1, 2, 5}`. For every armed slot, it tests overlap with the
 * marble volume (`*0x400690..0x400695`, expanded +/-3 on X/Y and +0xE on Z)
 * and writes to the slot and entity argument (`A2`) on hit.
 *
 * **Disassembly 0x14E92..0x150D0**: see `/tmp/marble-cand/014E92.txt`.
 *
 *
 * **Early-exit selector (`*0x400394`)**: word; must be 1, 2, or 5.
 *
 *   X range = [worldX - 3, worldX + 3]   (D6, A4)
 *   Y range = [worldY - 3, worldY + 3]   (A1, sp[-2])
 *   Z range = [worldZ,     worldZ + 0xE] (sp[-6], sp[-4])
 *
 * **Slot volume** (for each slot):
 *   - If `*(slot[0x58]).l == -1`, use default bbox `(D0=-4, D3=-4, D2=8, D4=8)`.
 *     D0 = bbox[0].b sext, D3 = bbox[1].b sext, D2 = bbox[2].b sext, D4 = bbox[3].b sext.
 *
 *   Slot ranges are:
 *     X: [slot[0xC] + D0, slot[0xC] + D0 + D2]      (D5, sp[-8])
 *     Y: [slot[0x10] + D3, slot[0x10] + D3 + D4]    (D0, D3)
 *     Z: [slot[0x14], slot[0x14] + 0x10]            (D2, D4)
 *
 * **Test of overlap** (signed word, 16-bit):
 *      marble.minX <= slot.maxX`).
 *   Y: idem.
 *   Z: idem.
 *
 *   - If `slot[0x1A] in {0, 3}`:
 *       slot[0x1A] = 2.
 *       jsr FUN_15460(slot) - direction dispatcher (514 byte, `/tmp/marble-cand/015460.txt`).
 *       slot[0..3]    = entity[0..3]   (long copy)
 *       slot[0x4..0x7]  = entity[0x4..0x7] (long copy)
 *   - "alt-key match": if `slot[0x1A] in {1, 5, 6}` and
 *     `entity[0x19].b sext.w == slot[0x56].w`, then states {1, 6} exit
 *     immediately (D2=1); otherwise execution falls through to 0x15020.
 *     `slot[0x56].w = sext(entity[0x19].b)`.
 *       entity[0xC..0xF]   = *(0x400684).l
 *       entity[0x10..0x13] = *(0x400688).l
 *       entity[0..3]       = 0
 *       entity[0x4..0x7]   = 0
 *   - Branch on `entity[0x1A]`:
 *       == 1: entity[0x5F] = 0; entity[0x60] = 2; entity[0x5A..0x5D] = 0x20FB6
 *       != 1 AND != 5: jsr FUN_158AC(0x39); entity[0x5F] = 0; entity[0x60] = 2;
 *                      entity[0x5A..0x5D] = 0x20FAA
 *   - Final: if `entity[0x1A] != 5 AND entity[0x1A] != 7`:
 *       entity[0x1A] = 5; entity[0x56] = 0x32.
 *   - Exit (D2 = 1).
 *
 * The loop stops at the first hit. Non-armed slots (`slot[0x18] == 0`) are skipped.
 *
 * **Sub-call side effects**:
 *     (long), `slot[0x58..0x5B]` (long), `slot[0x24..0x27]` (4 byte). Solo
 *     stub injection via `subs.fun_15460`. Default = no-op (matching parity
 *     tests that patch FUN_15460 to RTS, or a TS-side mirror thunk).
 *   - `FUN_158AC(0x39)`: sound command (`sound-cmd-send.ts`). Default no-op.
 *
 */

import type { RomImage } from "./bus.js";
import type { GameState } from "./state.js";
import { stateDispatch15460 } from "./state-dispatch-15460.js";

const WORK_RAM_BASE = 0x400000 as const;

// ─── Globals (work RAM offsets relative to 0x400000) ───────────────────────

/** Selector word @ `0x400394`; gate for the loop (must be 1, 2, or 5). */
export const SELECTOR_WORD_OFF = 0x394 as const;
/** Word @ `0x400690` — marble world X. */
export const WORLD_X_WORD_OFF = 0x690 as const;
/** Word @ `0x400692` — marble world Y. */
export const WORLD_Y_WORD_OFF = 0x692 as const;
/** Word @ `0x400694` — marble world Z. */
export const WORLD_Z_WORD_OFF = 0x694 as const;
/** Long @ `0x400684`; copied into `entity[0xC]` on hit. */
export const GLOBAL_684_LONG_OFF = 0x684 as const;
/** Long @ `0x400688`; copied into `entity[0x10]` on hit. */
export const GLOBAL_688_LONG_OFF = 0x688 as const;


export const SLOT_ARRAY_BASE_ADDR = 0x401302 as const;
/** Stride between consecutive slots (`moveq #0x60, D0; adda.l D0, A3`). */
export const SLOT_STRIDE = 0x60 as const;
/** Number of iterated slots (`cmpi.b #4, D1b`). */
export const SLOT_COUNT = 4 as const;

// Field offsets inside a slot.
/** Byte: "armed" gate; skip slot when 0. */
export const SLOT_ARMED_OFF = 0x18 as const;
/** Byte: state controlling bind/dispatch path. */
export const SLOT_STATE_OFF = 0x1a as const;
/** Word BE: slot X position. */
export const SLOT_X_OFF = 0x0c as const;
/** Word BE: slot Y position. */
export const SLOT_Y_OFF = 0x10 as const;
/** Word BE: slot Z position. */
export const SLOT_Z_OFF = 0x14 as const;
/** Long BE: pointer to bbox-extents record (4 signed bytes @ +4..+7). */
export const SLOT_BBOX_PTR_OFF = 0x58 as const;
export const SLOT_KEY_WORD_OFF = 0x56 as const;
export const SLOT_FIELD_0_OFF = 0x00 as const;
export const SLOT_FIELD_1C_OFF = 0x1c as const;
export const SLOT_FIELD_4_OFF = 0x04 as const;
export const SLOT_FIELD_20_OFF = 0x20 as const;

// ─── Entity (A2 arg) field offsets ───────────────────────────────────────

/** Long BE: cleared on hit and copied into slot[0] / slot[0x1C]. */
export const ENTITY_FIELD_0_OFF = 0x00 as const;
/** Long BE: cleared on hit and copied into slot[0x04] / slot[0x20]. */
export const ENTITY_FIELD_4_OFF = 0x04 as const;
/** Long BE: written from global 0x400684 on hit. */
export const ENTITY_FIELD_C_OFF = 0x0c as const;
/** Long BE: written from global 0x400688 on hit. */
export const ENTITY_FIELD_10_OFF = 0x10 as const;
/** Byte: alt-match key (sext.w compared with slot[0x56].w). */
export const ENTITY_KEY_BYTE_OFF = 0x19 as const;
export const ENTITY_STATE_OFF = 0x1a as const;
export const ENTITY_FIELD_56_OFF = 0x56 as const;
/** Long BE: script ptr written on hit (0x20FAA or 0x20FB6). */
export const ENTITY_SCRIPT_PTR_OFF = 0x5a as const;
export const ENTITY_FIELD_5F_OFF = 0x5f as const;
export const ENTITY_FIELD_60_OFF = 0x60 as const;


export const VALID_SELECTORS = [0x0001, 0x0002, 0x0005] as const;

export const SLOT_NEW_STATE = 0x02 as const;

export const SLOT_BIND_STATES = [0x00, 0x03] as const;

export const SLOT_KEY_MATCH_STATES = [0x01, 0x05, 0x06] as const;

export const SLOT_KEY_EARLY_EXIT_STATES = [0x01, 0x06] as const;

/** Sound command id pushed via `pea (0x39).l; jsr FUN_158AC` (state default). */
export const SOUND_CMD_DEFAULT = 0x39 as const;

export const SCRIPT_PTR_STATE_1 = 0x00020fb6 as const;
export const SCRIPT_PTR_DEFAULT = 0x00020faa as const;

export const ENTITY_FINAL_SKIP_STATES = [0x05, 0x07] as const;

export const ENTITY_FINAL_STATE = 0x05 as const;
export const ENTITY_FINAL_FIELD_56 = 0x32 as const;

/** "BBox sentinel": `*(slot[0x58]).l == -1` uses default (-4, -4, 8, 8). */
export const BBOX_SENTINEL = 0xffffffff >>> 0;
export const BBOX_DEFAULT_D0 = -4 as const;
export const BBOX_DEFAULT_D3 = -4 as const;
export const BBOX_DEFAULT_D2 = 8 as const;
export const BBOX_DEFAULT_D4 = 8 as const;

/** Marble bbox half-extent X (`subq.w #3, D6`). */
export const MARBLE_X_DELTA_NEAR = 3 as const;
export const MARBLE_X_DELTA_FAR = 3 as const;
export const MARBLE_Y_DELTA_NEAR = 3 as const;
export const MARBLE_Y_DELTA_FAR = 3 as const;
/** Marble bbox Z near = worldZ + 0 (`*0x400694` directly). */
export const MARBLE_Z_DELTA_NEAR = 0 as const;
/** Marble bbox Z far = worldZ + 0xE. */
export const MARBLE_Z_DELTA_FAR = 0x0e as const;
/** Slot Z extent: `D4 = D2 + 0x10`. */
export const SLOT_Z_EXTENT = 0x10 as const;

// ─── Sub injection ───────────────────────────────────────────────────────

/**
 *
 * - `FUN_00015460(slotPtr)`: direction dispatcher (514 byte).
 *   slot[0x58..0x5B] long, slot[0x24..0x27]). Default no-op (matching
 *   parity tests that patch FUN_15460 with RTS).
 *
 * - `FUN_000158AC(cmd)`: sound command sender (see `sound-cmd-send.ts`).
 *   Default no-op (matching pattern of `bbox-hit-test-19d94.ts` /
 *   `state-sub-186ac.ts`). The caller passes `cmd = 0x39`.
 */
export interface ScriptSlotBboxTest14E92Subs {
  /** FUN_15460(slotPtr, state). Default no-op. */
  fun_15460?: (slotPtr: number, state: GameState) => void;
  /** FUN_158AC(cmd, state). Default no-op. */
  soundCommand?: (cmd: number, state: GameState) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function readByte(state: GameState, off: number): number {
  return (state.workRam[off] ?? 0) & 0xff;
}

function writeByte(state: GameState, off: number, v: number): void {
  state.workRam[off] = v & 0xff;
}

function readWordBE(state: GameState, off: number): number {
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}

function writeWordBE(state: GameState, off: number, v: number): void {
  state.workRam[off] = (v >>> 8) & 0xff;
  state.workRam[off + 1] = v & 0xff;
}

function readLongBE(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 24) |
      ((state.workRam[off + 1] ?? 0) << 16) |
      ((state.workRam[off + 2] ?? 0) << 8) |
      (state.workRam[off + 3] ?? 0)) >>>
    0
  );
}

function writeLongBE(state: GameState, off: number, v: number): void {
  state.workRam[off] = (v >>> 24) & 0xff;
  state.workRam[off + 1] = (v >>> 16) & 0xff;
  state.workRam[off + 2] = (v >>> 8) & 0xff;
  state.workRam[off + 3] = v & 0xff;
}

function canReadAbs(state: GameState, rom: RomImage | undefined, addr: number, length: number): boolean {
  const a = addr >>> 0;
  if (a >= WORK_RAM_BASE && a + length <= WORK_RAM_BASE + state.workRam.length) {
    return true;
  }
  return rom !== undefined && a + length <= rom.program.length;
}

function readByteAbs(state: GameState, rom: RomImage | undefined, addr: number): number {
  const a = addr >>> 0;
  if (a >= WORK_RAM_BASE && a < WORK_RAM_BASE + state.workRam.length) {
    return readByte(state, a - WORK_RAM_BASE);
  }
  if (rom !== undefined && a < rom.program.length) {
    return (rom.program[a] ?? 0) & 0xff;
  }
  return 0;
}

function readLongAbs(state: GameState, rom: RomImage | undefined, addr: number): number {
  const a = addr >>> 0;
  if (a >= WORK_RAM_BASE && a + 4 <= WORK_RAM_BASE + state.workRam.length) {
    return readLongBE(state, a - WORK_RAM_BASE);
  }
  if (rom !== undefined && a + 4 <= rom.program.length) {
    return (
      (((rom.program[a] ?? 0) << 24) |
        ((rom.program[a + 1] ?? 0) << 16) |
        ((rom.program[a + 2] ?? 0) << 8) |
        (rom.program[a + 3] ?? 0)) >>>
      0
    );
  }
  return 0;
}

/** Sign-extend byte to JS signed integer (-128..127). */
function sextByte(v: number): number {
  const b = v & 0xff;
  return b < 0x80 ? b : b - 0x100;
}

/** Sign-extend word to JS signed integer (-32768..32767). */
function sextWord(v: number): number {
  const w = v & 0xffff;
  return w < 0x8000 ? w : w - 0x10000;
}

/** Word arithmetic mod 0x10000, preserving `add.w`/`subq.w` behavior. */
function asWord(v: number): number {
  return v & 0xffff;
}

// ─── Replica ─────────────────────────────────────────────────────────────

/**
 * @ 0x401302 (4 slot stride 0x60).
 *
 * @param state       GameState.
 *                    long pushed by the caller).
 * @param subs        Stub injection for the two JSR calls. Default no-op.
 *
 *
 * **Side effects** in `state.workRam` (at most once; first hit only):
 *   - Slot[i] for i in [0..3]: see the "Hit" section in the file header.
 *     field 56/5F/60.
 */
export function scriptSlotBboxTest14E92(
  state: GameState,
  entityAddr: number,
  subs?: ScriptSlotBboxTest14E92Subs,
  rom?: RomImage,
): void {
  // Selector gate: `*0x400394 == 1 || == 2 || == 5`.
  const selector = readWordBE(state, SELECTOR_WORD_OFF);
  if (selector !== 0x0001 && selector !== 0x0002 && selector !== 0x0005) {
    return;
  }

  const worldX = sextWord(readWordBE(state, WORLD_X_WORD_OFF));
  const worldY = sextWord(readWordBE(state, WORLD_Y_WORD_OFF));
  const worldZ = sextWord(readWordBE(state, WORLD_Z_WORD_OFF));

  // X: [worldX - 3, worldX + 3] (D6, A4)
  // (= worldX + 3). Operations wrap modulo 0x10000.
  const marbleXNear = sextWord(asWord(worldX - 3));
  const marbleXFar = sextWord(asWord(worldX + 3));
  // Y: [worldY - 3, worldY + 3] (A1, sp[-2])
  const marbleYNear = sextWord(asWord(worldY - 3));
  const marbleYFar = sextWord(asWord(worldY + 3));
  // Z: [worldZ, worldZ + 0xE] (sp[-6], sp[-4])
  const marbleZNear = sextWord(asWord(worldZ));
  const marbleZFar = sextWord(asWord(worldZ + 0x0e));

  // Loop over the four slots.
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slotPtr = (SLOT_ARRAY_BASE_ADDR + i * SLOT_STRIDE) >>> 0;
    const slotOff = slotPtr - WORK_RAM_BASE;

    // Test "armed" (`tst.b (0x18,A3); beq next`).
    if (readByte(state, slotOff + SLOT_ARMED_OFF) === 0) continue;

    // Resolve bbox: `A0 = (0x58, A3); A0 = (A0)`.
    const bboxPtrLong = readLongBE(state, slotOff + SLOT_BBOX_PTR_OFF);
    const bboxRecPtr = bboxPtrLong; // pointer m68k absoluto (in workRam o ROM).

    // Dereference bboxRecPtr for the first long sentinel check. Runtime callers
    // pass `rom`; workRam-only parity tests remain supported.
    const derefLong = canReadAbs(state, rom, bboxRecPtr, 4)
      ? readLongAbs(state, rom, bboxRecPtr)
      : 0;

    // Use default extents when the sentinel is present or the record is unreadable.
    let d0: number, d3: number, d2: number, d4: number;
    if (derefLong === BBOX_SENTINEL) {
      d0 = BBOX_DEFAULT_D0;
      d3 = BBOX_DEFAULT_D3;
      d2 = BBOX_DEFAULT_D2;
      d4 = BBOX_DEFAULT_D4;
    } else {
      const recordPtr = derefLong;
      if (canReadAbs(state, rom, recordPtr, 8)) {
        d0 = sextByte(readByteAbs(state, rom, recordPtr + 4));
        d3 = sextByte(readByteAbs(state, rom, recordPtr + 5));
        d2 = sextByte(readByteAbs(state, rom, recordPtr + 6));
        d4 = sextByte(readByteAbs(state, rom, recordPtr + 7));
      } else {
        d0 = BBOX_DEFAULT_D0;
        d3 = BBOX_DEFAULT_D3;
        d2 = BBOX_DEFAULT_D2;
        d4 = BBOX_DEFAULT_D4;
      }
    }

    // Slot bbox (signed word, mod 0x10000).
    const slotX = sextWord(readWordBE(state, slotOff + SLOT_X_OFF));
    const slotY = sextWord(readWordBE(state, slotOff + SLOT_Y_OFF));
    const slotZ = sextWord(readWordBE(state, slotOff + SLOT_Z_OFF));

    // D5 = slotX + D0 (X near)
    const slotXNear = sextWord(asWord(slotX + d0));
    // sp[-8] = slotXNear + D2 (X far)
    const slotXFar = sextWord(asWord(slotXNear + d2));
    // D0 = slotY + D3 (Y near)
    const slotYNear = sextWord(asWord(slotY + d3));
    // D3 = slotYNear + D4 (Y far)
    const slotYFar = sextWord(asWord(slotYNear + d4));
    // D2 = slotZ (Z near)
    const slotZNear = slotZ;
    // D4 = slotZ + 0x10 (Z far)
    const slotZFar = sextWord(asWord(slotZ + SLOT_Z_EXTENT));

    // ─── Z overlap test ────────────────────────────────────────────────
    // (cmp.w sp[-6], D2; bgt 14F64)
    //   else (slotZNear <= marbleZNear): test cmp.w D4, marbleZNear; ble 14F76
    //     if marbleZNear <= slotZFar → pass (overlap)
    //     else: fall through to 14F64
    // 14F64: cmp.w sp[-4], D2; bgt skip
    //   if slotZNear > marbleZFar → skip
    //   cmp.w D4, marbleZFar; bgt skip
    //   if marbleZFar > slotZFar → skip
    let zPass = false;
    if (slotZNear <= marbleZNear && marbleZNear <= slotZFar) {
      zPass = true;
    } else if (slotZNear <= marbleZFar && marbleZFar <= slotZFar) {
      zPass = true;
    }
    if (!zPass) continue;

    // ─── X overlap test ────────────────────────────────────────────────
    // (cmp.w D6, D5; bgt 14F82)
    //   if slotXNear > marbleXNear → 14F82
    //   else: cmp.w sp[-8], D6; ble 14F90
    //     if marbleXNear <= slotXFar → pass
    //     else: 14F82
    // 14F82: cmp.w A4, D5; bgt skip
    //        cmpa.w sp[-8], A4; bgt skip
    let xPass = false;
    if (slotXNear <= marbleXNear && marbleXNear <= slotXFar) {
      xPass = true;
    } else if (slotXNear <= marbleXFar && marbleXFar <= slotXFar) {
      xPass = true;
    }
    if (!xPass) continue;

    // ─── Y overlap test ────────────────────────────────────────────────
    // (cmp.w A1, D0; bgt 14F9A)
    //   if slotYNear > marbleYNear → 14F9A
    //   else: cmpa.w D3, A1; ble 14FAC
    //     if marbleYNear <= slotYFar → pass
    //     else: 14F9A
    // 14F9A: cmp.w sp[-2], D0; bgt skip
    //        move.w sp[-2], D7; cmp.w D3, D7; bgt skip
    let yPass = false;
    if (slotYNear <= marbleYNear && marbleYNear <= slotYFar) {
      yPass = true;
    } else if (slotYNear <= marbleYFar && marbleYFar <= slotYFar) {
      yPass = true;
    }
    if (!yPass) continue;
    state.debug ??= {};
    state.debug.lastScriptSlotCollision = {
      frame: Number(state.clock.frame),
      entityAddr,
      slotIndex: i,
      slotAddr: slotPtr,
      slotState: readByte(state, slotOff + SLOT_STATE_OFF),
      entityState: readByte(state, (entityAddr - WORK_RAM_BASE) + ENTITY_STATE_OFF),
      slotX,
      slotY,
      slotZ,
      bboxX0: slotXNear,
      bboxY0: slotYNear,
      bboxX1: slotXFar,
      bboxY1: slotYFar,
      marbleX0: marbleXNear,
      marbleY0: marbleYNear,
      marbleZ0: marbleZNear,
      marbleX1: marbleXFar,
      marbleY1: marbleYFar,
      marbleZ1: marbleZFar,
    };

    // ─── HIT path (D2 = 1) ──────────────────────────────────────────────
    // tst.b (0x1A, A3) — slot state == 0?
    // cmpi.b #3, (0x1A, A3) — state == 3?
    const slotState0 = readByte(state, slotOff + SLOT_STATE_OFF);
    const entityOff = (entityAddr - WORK_RAM_BASE) >>> 0;

    if (slotState0 === 0x00 || slotState0 === 0x03) {
      writeByte(state, slotOff + SLOT_STATE_OFF, SLOT_NEW_STATE);
      // jsr FUN_15460(slotPtr): direction dispatcher, stub injection.
      if (subs?.fun_15460 !== undefined) {
        subs.fun_15460(slotPtr, state);
      } else if (rom !== undefined) {
        stateDispatch15460(state, slotPtr, rom);
      }
      const entityField0 = readLongBE(state, entityOff + ENTITY_FIELD_0_OFF);
      writeLongBE(state, slotOff + SLOT_FIELD_0_OFF, entityField0);
      writeLongBE(state, slotOff + SLOT_FIELD_1C_OFF, entityField0);
      const entityField4 = readLongBE(state, entityOff + ENTITY_FIELD_4_OFF);
      writeLongBE(state, slotOff + SLOT_FIELD_4_OFF, entityField4);
      writeLongBE(state, slotOff + SLOT_FIELD_20_OFF, entityField4);
    }

    const slotState1 = readByte(state, slotOff + SLOT_STATE_OFF);

    // ─── Branch 14FE2: alt-key match path ──────────────────────────────
    // Disasm flow:
    //   14FE2: if slotState1 in {1, 5, 6} -> goto 14FFE (test key)
    //          else -> goto 1500C
    //   14FFE: if entity[0x19].b sext.w != slot[0x56].w -> goto 15020
    //                                                   (skip 1500C)
    //          if ==                                    -> fall through to 1500C
    //   1500C: if slotState1 in {1, 6} -> exit (150C2, hit consumed)
    //          else -> fall through to 15020
    //   15020: write-key gate (entity[0x1A] == 5 OR slotState1 == 5 -> skip).
    //
    //                     ((slotState1 ∈ {1, 5, 6} AND key match) OR slotState1 ∉ {1, 5, 6})
    //                   = slotState1 ∈ {1, 6} AND
    //                     (key match OR slotState1 ∉ {1, 5, 6})
    {
      let earlyExit = false;
      if (slotState1 === 0x01 || slotState1 === 0x06) {
        const entityKey = sextWord(sextByte(readByte(state, entityOff + ENTITY_KEY_BYTE_OFF)));
        const slotKey = sextWord(readWordBE(state, slotOff + SLOT_KEY_WORD_OFF));
        if (entityKey === slotKey) {
          earlyExit = true;
        }
      }
      if (earlyExit) {
        // Goto 0x150C2: D2 = 1, return.
        return;
      }
    }

    // ─── Block 0x15020: skip-write-key condition ──────────────────────
    // if entity[0x1A] != 5 AND slotState1 != 5 -> write slot[0x56] = sext(entity[0x19]).
    {
      const entityStateAtKeyCheck = readByte(state, entityOff + ENTITY_STATE_OFF);
      if (entityStateAtKeyCheck !== 0x05 && slotState1 !== 0x05) {
        const entityKeyByte = readByte(state, entityOff + ENTITY_KEY_BYTE_OFF);
        const sextKey = sextWord(sextByte(entityKeyByte));
        writeWordBE(state, slotOff + SLOT_KEY_WORD_OFF, sextKey & 0xffff);
      }
    }

    const global684 = readLongBE(state, GLOBAL_684_LONG_OFF);
    const global688 = readLongBE(state, GLOBAL_688_LONG_OFF);
    writeLongBE(state, entityOff + ENTITY_FIELD_C_OFF, global684);
    writeLongBE(state, entityOff + ENTITY_FIELD_10_OFF, global688);
    writeLongBE(state, entityOff + ENTITY_FIELD_4_OFF, 0);
    writeLongBE(state, entityOff + ENTITY_FIELD_0_OFF, 0);

    // ─── Block 0x15052: dispatch on entity[0x1A] ──────────────────────
    const entityState1 = readByte(state, entityOff + ENTITY_STATE_OFF);
    if (entityState1 === 0x01) {
      writeByte(state, entityOff + ENTITY_FIELD_5F_OFF, 0x00);
      writeByte(state, entityOff + ENTITY_FIELD_60_OFF, 0x02);
      writeLongBE(state, entityOff + ENTITY_SCRIPT_PTR_OFF, SCRIPT_PTR_STATE_1);
    } else if (entityState1 === 0x05) {
      // Skip the block entirely (bra 0x15096).
    } else {
      // Default path: sound 0x39 + setup script_ptr_default.
      subs?.soundCommand?.(SOUND_CMD_DEFAULT, state);
      writeByte(state, entityOff + ENTITY_FIELD_5F_OFF, 0x00);
      writeByte(state, entityOff + ENTITY_FIELD_60_OFF, 0x02);
      writeLongBE(state, entityOff + ENTITY_SCRIPT_PTR_OFF, SCRIPT_PTR_DEFAULT);
    }

    // ─── Block 0x15096: final state transition ────────────────────────
    // if entity[0x1A] != 5 AND != 7 -> entity[0x1A] = 5; entity[0x56] = 0x32.
    const entityState2 = readByte(state, entityOff + ENTITY_STATE_OFF);
    if (entityState2 !== 0x05 && entityState2 !== 0x07) {
      writeByte(state, entityOff + ENTITY_STATE_OFF, ENTITY_FINAL_STATE);
      writeByte(state, entityOff + ENTITY_FIELD_56_OFF, ENTITY_FINAL_FIELD_56);
    }

    // Hit consumato → exit (single match per call).
    return;
  }
}
