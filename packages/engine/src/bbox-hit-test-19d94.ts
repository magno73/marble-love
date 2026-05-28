/**
 * bbox-hit-test-19d94.ts - mirror of `FUN_00019D94` (174 bytes).
 *
 * "Mode-4 AABB hit-test over the array @ 0x4019F8". It iterates the ten
 * 0x38-byte slots in the array @ `0x4019F8` (see `slotArrayBulkInit`). For
 * each armed slot (`slot[0x18] != 0` && `slot[0x1A] == 0`), it checks whether
 * the marble point `(x, y)` (words @ `0x400690..0x400693`) falls inside a
 * 12x12-word bounding box around the slot coordinates (`slot[0x0C..0x0D]`
 * x-word, `slot[0x10..0x11]` y-word). On collision:
 *   - marks the slot as state `0x02` (`slot[0x1A]=2`);
 *   - binds constant script pointer `0x00022546` in `slot[0x1C..0x1F]`;
 *   - initializes `slot[0x25]=0x04`, `slot[0x24]=0x00`;
 *   - on the entity argument (A2): `entity[0x1A]=0x0B`,
 *     `entity[0x57]=0x66`;
 *   - calls `FUN_000158AC(0x3E)` (sound trigger).
 *
 * **The whole loop body is gated** by the initial `*0x400394 == 4` check. If
 * the "game-mode" word (see `sound-pair-15884.ts`) is not `4`, the routine
 * exits immediately (NOP for mode != 4). This makes it a hit-test tied to the
 * "in-game / mode 4" sub-state.
 *
 * **Disasm 0x19D94..0x19E41** (174 byte):
 *
 *   movem.l {D2,D3,D4,A2,A3},-(SP)            ; save D2/D3/D4/A2/A3 (20 bytes)
 *   movea.l (0x18,SP),A2                      ; A2 = arg long (entity ptr)
 *   moveq   #4,D0                             ; D0 = 4
 *   cmp.w   (0x00400394).l,D0w                ; D0 - mem.w
 *   bne.w   epilogue                          ; if (4 != *0x400394) → exit
 *
 *   movea.l #0x004019F8,A3                    ; A3 = base array (slot 0)
 *   clr.b   D2b                               ; D2.b = 0 (loop index byte)
 *
 * loop:                                       ; @ 0x19DB0
 *   tst.b   (0x18,A3)                         ; slot[0x18] == 0?
 *   beq.w   next_iter                         ; → skip slot
 *   tst.b   (0x1A,A3)                         ; slot[0x1A] != 0?
 *   bne.w   next_iter                         ; → skip slot
 *
 *   ; word arithmetic (16-bit signed; bgt/ble are signed)
 *   lea     (0x10,A3),A0                      ; A0 = &slot[0x10]
 *   move.w  (A0),D1w                          ; D1.w = slot.y (y-word)
 *   subq.w  #4,D1w                            ; D1 = y - 4 (top)
 *   move.w  D1w,D4w                           ; D4 = y - 4
 *   addi.w  #0xC,D4w                          ; D4 = y + 8 (bottom)
 *
 *   lea     (0x0C,A3),A0                      ; A0 = &slot[0x0C]
 *   move.w  (A0),D0w                          ; D0.w = slot.x
 *   subq.w  #6,D0w                            ; D0 = x - 6 (left)
 *   move.w  D0w,D3w                           ; D3 = x - 6
 *   addi.w  #0xC,D3w                          ; D3 = x + 6 (right)
 *
 *   cmp.w   (0x00400690).l,D0w                ; D0 - marble.x
 *   bgt.b   next_iter                         ; left  >  marble.x → miss
 *   cmp.w   (0x00400690).l,D3w                ; D3 - marble.x
 *   ble.b   next_iter                         ; right <= marble.x → miss
 *   cmp.w   (0x00400692).l,D1w                ; D1 - marble.y
 *   bgt.b   next_iter                         ; top  >  marble.y → miss
 *   cmp.w   (0x00400692).l,D4w                ; D4 - marble.y
 *   ble.b   next_iter                         ; bot. <= marble.y → miss
 *
 *   ; HIT - marble bbox-overlap with the slot
 *   move.b  #0x02,(0x1A,A3)                   ; slot[0x1A] = 2 (state busy)
 *   move.l  #0x00022546,(0x1C,A3)             ; slot[0x1C..0x1F] = 0x22546 (script ptr)
 *   move.b  #0x04,(0x25,A3)                   ; slot[0x25] = 4
 *   clr.b   (0x24,A3)                         ; slot[0x24] = 0
 *   move.b  #0x0B,(0x1A,A2)                   ; entity[0x1A] = 0x0B
 *   move.b  #0x66,(0x57,A2)                   ; entity[0x57] = 0x66
 *   pea     (0x3E).l                          ; push 0x3E (long)
 *   jsr     0x000158AC.l                      ; FUN_158AC(0x3E) — sound
 *   addq.l  #4,SP                              ; pop arg
 *
 * next_iter:                                  ; @ 0x19E2E
 *   moveq   #0x38,D0                          ; D0 = stride 0x38
 *   adda.l  D0,A3                             ; A3 += 0x38
 *   addq.b  #1,D2b                            ; D2++
 *   cmpi.b  #0x0A,D2b                         ; D2 == 10 ?
 *   bne.w   loop                              ; iterate
 *
 * epilogue:                                   ; @ 0x19E3C
 *   movem.l (SP)+,{A3,A2,D4,D3,D2}            ; restore
 *   rts
 *
 * **Read globals** (workRam):
 *   - `*0x400394` (word)  = game-mode discriminator (cfr. sound-pair-15884).
 *   - `*0x400690` (word)  = marble world x (cfr. sprite-derive).
 *   - `*0x400692` (word)  = marble world y.
 *
 * **Slot array** @ `0x4019F8`, 10 entries × `0x38` byte
 * (see `slot-array-init.ts` array 1). Touched slot fields:
 *   - `slot[0x18]` byte: gate "armed" (in: read; out: unchanged)
 *   - `slot[0x1A]` byte: gate "free" (in: read; out: written to 2 on hit)
 *   - `slot[0x0C..0x0D]` word BE: x position (signed 16-bit)
 *   - `slot[0x10..0x11]` word BE: y position (signed 16-bit)
 *   - `slot[0x1C..0x1F]` long BE: script ptr (out: written to 0x22546 on hit)
 *   - `slot[0x24]` byte (out: 0 on hit)
 *   - `slot[0x25]` byte (out: 4 on hit)
 *
 * **Entity arg** (A2 = `entityAddr`):
 *   - `entity[0x1A]` byte (out: 0x0B on hit)
 *   - `entity[0x57]` byte (out: 0x66 on hit)
 *
 * **Word semantics**:
 *   - `subq.w #4, D1` wraps modulo 0x10000 (16-bit).
 *   - `addi.w #0xC, D4` wraps modulo 0x10000.
 *   - `cmp.w` + `bgt`/`ble` are **signed** 16-bit comparisons.
 *   Position values may be negative (sign bit 0x8000).
 *
 * **Known caller** (1 xref): `FUN_000121B8` @ 0x1240A, after
 * `jsr FUN_1924E(entity)` and before `cmpi.b #0x0B, (0x1A, A2)`, which checks
 * the value just written on hit (`entity[0x1A] = 0x0B`) for the "marble caught /
 * level transition" branch. This matches the semantics of triggering a marble
 * state transition when it collides with a slot from array 0x4019F8.
 *
 * **Sub injection**:
 *   - `FUN_000158AC` (sound command sender) is not mirrored here; default no-op.
 *     Same pattern as `sound-pair-15884.ts` / `object-update-pair-158cc.ts`.
 *
 * **Side effects** in `state.workRam` (for each hit slot):
 *   - `slot[0x1A], slot[0x1C..0x1F], slot[0x24], slot[0x25]` are rewritten.
 *   - `entity[0x1A], entity[0x57]` are rewritten.
 *   - 1+ calls to `subs.soundCommand(0x3E)`, one per hit slot.
 *
 * **No RNG and no access to colorRam/spriteRam/alphaRam.**
 *
 * Bit-perfect verification:
 * `packages/cli/src/test-bbox-hit-test-19d94-parity.ts` (500 cases).
 */

import type { GameState } from "./state.js";

// Globals (workRam offsets relative to 0x400000).

/** workRam offset of the "game mode" word (absolute = 0x400394). */
export const GAME_MODE_WORD_OFF = 0x394 as const;
/** workRam offset of the marble x-word (absolute = 0x400690). */
export const MARBLE_X_WORD_OFF = 0x690 as const;
/** workRam offset of the marble y-word (absolute = 0x400692). */
export const MARBLE_Y_WORD_OFF = 0x692 as const;

/** "Game mode" value that enables the loop (see `cmp.w; bne.w`). */
export const REQUIRED_GAME_MODE = 0x0004 as const;

// ─── Slot array @ 0x4019F8 ───────────────────────────────────────────────

/** Absolute m68k address of slot 0 (`movea.l #0x4019F8, A3`). */
export const SLOT_ARRAY_BASE_ADDR = 0x004019f8 as const;
/** Stride between consecutive slots (`moveq #0x38, D0; adda.l D0, A3`). */
export const SLOT_STRIDE = 0x38 as const;
/** Number of iterated slots (`cmpi.b #0xA, D2`). */
export const SLOT_COUNT = 10 as const;

// Field offsets inside one slot.
/** Byte: "armed" gate (skip slot if 0). */
export const SLOT_ARMED_OFF = 0x18 as const;
/** Byte: "free" gate (skip slot if != 0). */
export const SLOT_STATE_OFF = 0x1a as const;
/** Word BE: slot x position (signed 16-bit). */
export const SLOT_X_OFF = 0x0c as const;
/** Word BE: slot y position (signed 16-bit). */
export const SLOT_Y_OFF = 0x10 as const;
/** Long BE: slot script ptr written on hit. */
export const SLOT_SCRIPT_PTR_OFF = 0x1c as const;
/** Byte: written to 0 on hit. */
export const SLOT_FLAG_OFF = 0x24 as const;
/** Byte: written to 0x04 on hit (state). */
export const SLOT_NEW_STATE_OFF = 0x25 as const;

// Constants written on hit.

/** Value of `slot[0x1A]` on hit (`move.b #2, (0x1A,A3)`). */
export const HIT_SLOT_STATE = 0x02 as const;
/** Value of `slot[0x25]` on hit (`move.b #4, (0x25,A3)`). */
export const HIT_SLOT_NEW_STATE = 0x04 as const;
/** Script pointer value written to `slot[0x1C..0x1F]` on hit. */
export const HIT_SCRIPT_PTR = 0x00022546 as const;
/** Value of `entity[0x1A]` on hit (`move.b #0x0B, (0x1A,A2)`). */
export const HIT_ENTITY_STATE = 0x0b as const;
/** Value of `entity[0x57]` on hit (`move.b #0x66, (0x57,A2)`). */
export const HIT_ENTITY_FIELD_57 = 0x66 as const;

/** Entity offset (A2): state byte written on hit. */
export const ENTITY_STATE_OFF = 0x1a as const;
/** Entity offset (A2): auxiliary byte written on hit. */
export const ENTITY_FIELD_57_OFF = 0x57 as const;

/** Sound command id pushed via `pea (0x3E).l; jsr FUN_158AC`. */
export const SOUND_HIT_COMMAND = 0x3e as const;

// ─── Bbox half-extents (word) ────────────────────────────────────────────

/** `subq.w #6, D0` (x left  = slot.x - 6). */
export const BBOX_LEFT_DELTA = 6 as const;
/** `addi.w #0xC, D3` after subq.w #6 -> right = slot.x + 6 (effective). */
export const BBOX_RIGHT_DELTA = 6 as const;
/** `subq.w #4, D1` (y top  = slot.y - 4). */
export const BBOX_TOP_DELTA = 4 as const;
/** `addi.w #0xC, D4` after subq.w #4 -> bottom = slot.y + 8 (effective). */
export const BBOX_BOTTOM_DELTA = 8 as const;

// ─── Sub injection ───────────────────────────────────────────────────────

/**
 * Injectable sub-function stubs for `bboxHitTest19D94`.
 *
 * `FUN_000158AC` (sound command sender) is not mirrored here; default no-op.
 * Same pattern as `sound-pair-15884.ts`: the call is `pea (cmd).l;
 * jsr FUN_158AC; addq.l #4, SP`, and FUN_158AC reads only the low byte.
 */
export interface BboxHitTest19D94Subs {
  /**
   * `FUN_000158AC`: sends a sound command. Arg = LSB byte of the long pushed
   * via `pea`. Default no-op; a future caller wires this to the sound chip.
   */
  soundCommand?: (cmd: number) => void;
}

// Result.

/** Scan outcome for one slot. */
export type SlotResult = "skip_armed" | "skip_state" | "miss" | "hit";

export interface BboxHitTest19D94Result {
  /** True if *0x400394 != REQUIRED_GAME_MODE (early exit, no loop). */
  earlyExit: boolean;
  /** Outcome for each of the 10 slots; empty when earlyExit is true. */
  perSlot: SlotResult[];
  /** Number of actual hits (0..10). */
  hitCount: number;
  /** Number of executed `subs.soundCommand(0x3E)` calls (= hitCount). */
  soundTriggers: number;
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

function writeLongBE(state: GameState, off: number, v: number): void {
  state.workRam[off] = (v >>> 24) & 0xff;
  state.workRam[off + 1] = (v >>> 16) & 0xff;
  state.workRam[off + 2] = (v >>> 8) & 0xff;
  state.workRam[off + 3] = v & 0xff;
}

/**
 * Sign-extend 16-bit to JS signed 32-bit. The binary's `bgt`/`ble` branches
 * are **signed** comparisons over D0/D1/D3/D4 after `cmp.w`, so involved
 * values must be treated as signed int16.
 */
function sext16(w: number): number {
  return (w & 0x8000) ? (w - 0x10000) : w;
}

// ─── Replica ─────────────────────────────────────────────────────────────

/**
 * Bit-perfect mirror of `FUN_00019D94`.
 *
 * @param state       GameState. Reads: `workRam[0x394..0x395]`,
 *                    `workRam[0x690..0x693]`, slot array @
 *                    `workRam[0x19F8..0x1B6F]`, entity @ `entityAddr`.
 *                    Writes (for hit slots): `slot[0x1A]`,
 *                    `slot[0x1C..0x1F]`, `slot[0x24]`, `slot[0x25]`,
 *                    `entity[0x1A]`, `entity[0x57]`.
 * @param entityAddr  Absolute m68k address of the entity struct (A2 = long
 *                    arg). Converted to `entityAddr - 0x400000` for workRam.
 * @param subs        Injection. `subs.soundCommand(0x3E)` is called once for
 *                    each hit slot. Default: no-op, matching the binary stubbed
 *                    with RTS in parity.
 *
 * @returns Per-slot detail, early-exit flag, and hit/trigger counts.
 *
 * **Write order** (parity-relevant):
 *   For each slot from 0 to 9, in order, inside the hit branch:
 *     1. `slot[0x1A] = 0x02`
 *     2. `slot[0x1C..0x1F] = 0x00022546`
 *     3. `slot[0x25] = 0x04`
 *     4. `slot[0x24] = 0x00`
 *     5. `entity[0x1A] = 0x0B`
 *     6. `entity[0x57] = 0x66`
 *     7. `subs.soundCommand(0x3E)`
 */
export function bboxHitTest19D94(
  state: GameState,
  entityAddr: number,
  subs?: BboxHitTest19D94Subs,
): BboxHitTest19D94Result {
  const entityOff = (entityAddr - 0x400000) >>> 0;

  // ─── Game-mode gate ────────────────────────────────────────────────────
  // `moveq #4, D0; cmp.w (0x400394).l, D0w; bne.w epilogue`
  //   - cmp.w D0=4 vs mem.w: word comparison.
  //   - branch if not equal -> exit.
  const gameMode = readWordBE(state, GAME_MODE_WORD_OFF);
  if (gameMode !== REQUIRED_GAME_MODE) {
    return { earlyExit: true, perSlot: [], hitCount: 0, soundTriggers: 0 };
  }

  // Marble position words. The binary rereads them every iteration via
  // `cmp.w (0x400690).l, ...`. They are invariant unless a sub writes
  // workRam[0x690], which this module does not do. For the parity setup,
  // injected soundCommand does not write workRam and the binary is stubbed with
  // RTS, so reading once is equivalent.
  const marbleX = sext16(readWordBE(state, MARBLE_X_WORD_OFF));
  const marbleY = sext16(readWordBE(state, MARBLE_Y_WORD_OFF));

  const perSlot: SlotResult[] = [];
  let hitCount = 0;

  // Loop over the 10 slots.
  // A3 = 0x4019F8 + i * 0x38; i in [0..9]
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slotOff = (SLOT_ARRAY_BASE_ADDR - 0x400000 + i * SLOT_STRIDE) >>> 0;

    // tst.b (0x18, A3); beq.w next_iter
    if (readByte(state, slotOff + SLOT_ARMED_OFF) === 0) {
      perSlot.push("skip_armed");
      continue;
    }
    // tst.b (0x1A, A3); bne.w next_iter
    if (readByte(state, slotOff + SLOT_STATE_OFF) !== 0) {
      perSlot.push("skip_state");
      continue;
    }

    // Build bbox (word arithmetic, signed).
    // D1.w = slot.y; D1 -= 4 (top); D4 = D1 + 0xC (= slot.y + 8, bottom)
    const yRaw = readWordBE(state, slotOff + SLOT_Y_OFF);
    const top16 = (yRaw - BBOX_TOP_DELTA) & 0xffff;
    const bottom16 = (top16 + 0xc) & 0xffff;
    const top = sext16(top16);
    const bottom = sext16(bottom16);

    // D0.w = slot.x; D0 -= 6 (left); D3 = D0 + 0xC (= slot.x + 6, right)
    const xRaw = readWordBE(state, slotOff + SLOT_X_OFF);
    const left16 = (xRaw - BBOX_LEFT_DELTA) & 0xffff;
    const right16 = (left16 + 0xc) & 0xffff;
    const left = sext16(left16);
    const right = sext16(right16);

    // cmp.w (0x400690).l, D0w; bgt → miss        if (left  >  marble.x)
    if (left > marbleX) { perSlot.push("miss"); continue; }
    // cmp.w (0x400690).l, D3w; ble → miss        if (right <= marble.x)
    if (right <= marbleX) { perSlot.push("miss"); continue; }
    // cmp.w (0x400692).l, D1w; bgt → miss        if (top   >  marble.y)
    if (top > marbleY) { perSlot.push("miss"); continue; }
    // cmp.w (0x400692).l, D4w; ble → miss        if (bot. <= marble.y)
    if (bottom <= marbleY) { perSlot.push("miss"); continue; }

    // HIT: write all fields in binary order.
    writeByte(state, slotOff + SLOT_STATE_OFF, HIT_SLOT_STATE);
    writeLongBE(state, slotOff + SLOT_SCRIPT_PTR_OFF, HIT_SCRIPT_PTR);
    writeByte(state, slotOff + SLOT_NEW_STATE_OFF, HIT_SLOT_NEW_STATE);
    writeByte(state, slotOff + SLOT_FLAG_OFF, 0);
    writeByte(state, entityOff + ENTITY_STATE_OFF, HIT_ENTITY_STATE);
    writeByte(state, entityOff + ENTITY_FIELD_57_OFF, HIT_ENTITY_FIELD_57);

    subs?.soundCommand?.(SOUND_HIT_COMMAND);

    perSlot.push("hit");
    hitCount++;
  }

  return {
    earlyExit: false,
    perSlot,
    hitCount,
    soundTriggers: hitCount,
  };
}
