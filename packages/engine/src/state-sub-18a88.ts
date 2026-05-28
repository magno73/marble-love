/**
 * state-sub-18a88.ts - port of `FUN_00018A88` (586 bytes).
 *
 * Scans entities at `0x400018` (stride `0xE2`, count `*0x400396`):
 *
 *   1. Initialize decorative particles via `FUN_00018CD2(count=0x1C, mode=-1)`.
 *   2. Increment byte counter `*0x004003F0` (vblank tick; one hit here plus loop hits).
 *   3. For each entity i in [0..count): if `entity[0x18] != 3`, skip.
 *      a. `*0x400658 += 1` (shown summary-screen counter).
 *      b. `FUN_00028C7E(0)` — clear alpha tilemap from row 0.
 *      c. `*0x4003F0 += 1`.
 *      d. Render header strings: two `FUN_2572` (renderStringChain) calls into
 *         the alpha tilemap, with `attr` in {0x1000, 0x1400} swapped by player:
 *           - `0x22B0A` (entry struct ptr, attr = D5 = 0x1400 for p1 else 0x1000)
 *           - `0x22AAA` (entry struct ptr, attr = D6 = 0x1000 for p1 else 0x1400)
 *      e. If `count == 2` (2-player): render "TAG" with
 *         `FUN_000286B0(romPtr=*(0x1EEF0+i*4), col=0xC, tickOff=5,
 *                       attr=0x2000 if i==0 else 0x2400)`.
 *      f. Score formatting through `FUN_00028E3C` (renderStringHelper, 6 args):
 *         - clamp `entity[0x6A].w` to 0x63 (99) -> "minute" or counter A
 *         - clamp `entity[0xD2].w` to 0x14 (20) -> "seconds" or counter B,
 *           with progressive countdown (see step h).
 *         Fixed parameters (four constant argument sets):
 *           - `(D5, 2, 0xF, 0xA, 1, counterA_clamped)`  [score line 1]
 *           - `(D6, 5, 0xF, 0x21, 0, counterA*1000)`     [score line 1, val]
 *           - `(D5, 2, 0x11, 0xC, 0, counterB_clamped)` [score line 2]
 *           - `(D6, 5, 0x11, 0x21, 0, counterB*1000)`    [score line 2, val]
 *           - `(D6, 6, 0x13, 0x20, 0, D4)`              [total - initial]
 *      g. `*0x4003F0 += 1`.
 *      h. Render "BONUS" labels: two `FUN_2572` (renderString) calls into the
 *         alpha tilemap, attr = D5 (player col):
 *           - `0x22AF2` (label "BONUS")
 *           - `0x22AFE` (label "TIME")
 *           - `D4 -= 250`
 *           - `FUN_00028608(entityPtr, 250)` (addToObjectAccumAndFlag —
 *             `(1 << entity[0x19])` in `*0x40039C`).
 *           - `FUN_00028E3C(D6, 6, 0x13, 0x20, 0, D4)` — refresh display.
 *           - `FUN_00028EB2(*entity[0xBC..0xBF], 7, 0x18, 0x17, 0, D5)` —
 *             format and render the new accumulator.
 *           - `FUN_00028DB8(2)` (waitVblankStateGated, count=2).
 *
 * **Disasm 0x18A88..0x18CD1** (586 bytes). Key points:
 *   - 0x18A88: prologue movem (D2..D7,A2..A4) = 9 long = 0x24 byte saved
 *   - 0x18A8C: A3 = 0x28E3C (renderStringHelper, jsr (A3) ×N)
 *   - 0x18A92: A4 = 0x4003F0 (vblank tick counter)
 *   - 0x18A98..0x18AA8: jsr FUN_18CD2, addq counter, A2 = 0x400018, D3=0
 *   - 0x18AB4: bra.w loop_test (D3 vs count word)
 *   - 0x18AB8..0x18CB1: loop body (gated by entity[0x18] == 3)
 *   - 0x18CB2: A2 += 0xE2, D3 += 1 (next entity)
 *   - 0x18CBE: D3.b ext.w; cmp.w (0x400396).l, D0w; bne loop body
 *   - 0x18CCC: epilogue movem
 *
 *   - `FUN_00028C7E` (clearAlphaTilesFromIndex): 1 call per matched entity.
 *   - `FUN_00000200` (= jmp 0x3520, renderStringChain via 0x200): 4 call
 *     per matched entity (2 header + 2 BONUS labels).
 *   - `FUN_00000142` (= jmp 0x2572, renderStringChain via 0x142): 1 call
 *     per matched entity (header strings #2).
 *
 *     ROM trampoline: `0x142 -> FUN_2572` and `0x200 -> FUN_3520` (see
 *     `mo-screen-init-1a286.ts` for details). Both are exposed
 *     as `renderString` callbacks with (strPtr, attr).
 *
 *   - `FUN_000286B0` (renderStringEntry286B0): 0 or 1 call per matched entity
 *     (gated by `count == 2`).
 *   - `FUN_00028E3C` (renderStringHelper, 6-arg): 3 + N call per entity
 *     matched (3 fixed plus N depending on the D4 countdown).
 *   - `FUN_00028608` (addToObjectAccumAndFlag): N call per entity
 *   - `FUN_00028EB2` (formatAndRender28EB2, 6-arg): N call per entity
 *   - `FUN_00028DB8` (waitVblankStateGated): N+1 call per entity
 *     matched (N countdown iterations plus 1 at the end with count=0x5A).
 *
 * **Known caller** (1 xref): `FUN_0001101E` @ 0x11404 (main-loop-init-1101e).
 *
 * **Direct side effects** in `state.workRam`:
 *   - `*0x4003F0` (byte): incremented 1 + 3*N times (N = matched entities).
 *   - `*0x400658` (byte): incremented N times.
 *
 */

import type { GameState } from "./state.js";

// ─── Address constants (workRam offsets relative to 0x400000) ─────────────

/** Absolute WORK RAM base. */
export const WORK_RAM_BASE = 0x00400000 as const;

export const OBJ_BASE_ADDR = 0x00400018 as const;
/** Stride object struct. */
export const OBJ_STRIDE = 0xe2 as const;

/** Word: `*0x400396` object count. */
export const OBJ_COUNT_ADDR = 0x00400396 as const;
/** Offset of OBJ_COUNT_ADDR in `state.workRam`. */
export const OBJ_COUNT_OFF = 0x396 as const;

/** Byte: `*0x4003F0` vblank tick counter, incremented at several points. */
export const VBLANK_TICK_COUNTER_ADDR = 0x004003f0 as const;
/** Offset of VBLANK_TICK_COUNTER_ADDR in `state.workRam`. */
export const VBLANK_TICK_COUNTER_OFF = 0x3f0 as const;

/** Byte: `*0x400658` summary-shown counter, incremented per matched entity. */
export const SUMMARY_COUNTER_ADDR = 0x00400658 as const;
/** Offset of SUMMARY_COUNTER_ADDR in `state.workRam`. */
export const SUMMARY_COUNTER_OFF = 0x658 as const;

/** Object field: `(0x18,A2)` branch selector (3 means render). */
export const OBJ_STATE_OFF = 0x18 as const;
/** Object field: `(0x19,A2)` player id (0/1), selects D5/D6 palettes. */
export const OBJ_PLAYER_ID_OFF = 0x19 as const;
/** Object field: `(0x6A,A2)` word "counter A" (clamp 99). */
export const OBJ_COUNTER_A_OFF = 0x6a as const;
/** Object field: `(0xD2,A2)` word "counter B" (clamp 20). */
export const OBJ_COUNTER_B_OFF = 0xd2 as const;
/** Object field: `(0xBC,A2)` long accumulator, passed to FUN_28EB2. */
export const OBJ_ACCUM_LONG_OFF = 0xbc as const;

export const OBJ_TRIGGER_STATE = 0x03 as const;

// ─── Render constants ────────────────────────────────────────────────────

export const ROM_HEADER_STRING_1 = 0x00022b0a as const;
export const ROM_HEADER_STRING_2 = 0x00022aaa as const;
export const ROM_LABEL_BONUS = 0x00022af2 as const;
export const ROM_LABEL_TIME = 0x00022afe as const;
/** ROM string-pointer table for 2-player "TAG" (`0x1EEF0 + i*4`). */
export const ROM_TAG_TABLE = 0x0001eef0 as const;

/** Palette attr word for player 1 / "primary". */
export const ATTR_PRIMARY = 0x1400 as const;
/** Palette attr word for player 2 / "secondary". */
export const ATTR_SECONDARY = 0x1000 as const;
/** Tag attr "primary" (count==2 path, i==0). */
export const TAG_ATTR_PRIMARY = 0x2000 as const;
/** Tag attr "secondary" (count==2 path, i>0). */
export const TAG_ATTR_SECONDARY = 0x2400 as const;

/** Clamp limit for counterA (`(0x6A,A2)` -> 99 max). */
export const COUNTER_A_CLAMP = 0x63 as const;
/** Clamp limit for counterB (`(0xD2,A2)` -> 20 max). */
export const COUNTER_B_CLAMP = 0x14 as const;

export const D4_INIT = 0x4e20 as const;
/** Countdown decrement step (= 250 = 0xFA). */
export const D4_STEP = 0xfa as const;
/** Signed multiplier for D4 (counter * 1000). */
export const SCORE_MULTIPLIER = 0x3e8 as const;

export const PARTICLE_INIT_COUNT = 0x1c as const;
export const PARTICLE_INIT_MODE = 0xff as const;

export const COUNTDOWN_WAIT_TICKS = 0x02 as const;
export const POSTSCREEN_WAIT_TICKS = 0x5a as const;

// ─── Sub injection ───────────────────────────────────────────────────────

/**
 * Bag of the eight sub-JSRs orchestrated by `FUN_00018A88`.
 * All callbacks are optional and default to no-op.
 */
export interface StateSub18A88Subs {
  /**
   *
   * Default: no-op.
   */
  particleInit?: (state: GameState, count: number, mode: number) => void;

  /**
   * `FUN_00028C7E` (clearAlphaTilesFromIndex). Args (1 long):
   *   - `startRow`: 0 (clear from row 0).
   *
   * Default: no-op.
   */
  clearAlphaTiles?: (state: GameState, startRow: number) => void;

  /**
   * `FUN_2572` via trampoline `0x142` (renderStringChain). Args (2 long):
   *
   * Default: no-op.
   */
  renderStringVia142?: (
    state: GameState,
    entryPtr: number,
    attrLong: number,
  ) => void;

  /**
   * `FUN_3520` via trampoline `0x200` (renderString variant). Args (2 long):
   *
   * Default: no-op.
   */
  renderStringVia200?: (
    state: GameState,
    entryPtr: number,
    attrLong: number,
  ) => void;

  /**
   * `FUN_000286B0` (renderStringEntry286B0). Args (4 long):
   *   - `arg1Long`: ROM ptr-to-ptr (lookup table @ 0x1EEF0 + i*4).
   *   - `arg2Long`: col (0xC).
   *   - `arg3Long`: tickOff (5).
   *   - `arg4Long`: attr (0x2000 o 0x2400).
   *
   * Default: no-op. Called only when `count == 2`.
   */
  renderTag?: (
    state: GameState,
    arg1Long: number,
    arg2Long: number,
    arg3Long: number,
    arg4Long: number,
  ) => void;

  /**
   * `FUN_00028E3C` (renderStringHelper, 6-arg). Args (6 long):
   *
   * Default: no-op. Called 3 + N times per matched entity.
   */
  renderStringHelper?: (
    state: GameState,
    arg1Long: number,
    arg2Long: number,
    arg3Long: number,
    arg4Long: number,
    arg5Long: number,
    arg6Long: number,
  ) => void;

  /**
   * `FUN_00028608` (addToObjectAccumAndFlag). Args (2 long):
   *
   * Default: no-op. Called N times during the countdown.
   */
  addToObjectAccum?: (state: GameState, objPtr: number, value: number) => void;

  /**
   * `FUN_00028EB2` (formatAndRender28EB2, 6-arg). Args (6 long).
   *   Default: no-op. Called N times during the countdown.
   */
  formatAndRender?: (
    state: GameState,
    arg1Long: number,
    arg2Long: number,
    arg3Long: number,
    arg4Long: number,
    arg5Long: number,
    arg6Long: number,
  ) => void;

  /**
   *   - `countWord`: 2 (countdown) or 0x5A (post-screen).
   *
   */
  waitVblankStateGated?: (state: GameState, countWord: number) => void;
}


/** Per-entity run details. */
export interface StateSub18A88EntityDetail {
  index: number;
  entityAddr: number;
  triggered: boolean;
  playerId: number;
  /** D5 (palette for the "primary" line). */
  attrD5: number;
  /** D6 (palette for the "secondary" line). */
  attrD6: number;
  /** counter A clamp result (`min(entity[0x6A], 99)`). */
  counterA: number;
  /** counter B clamp result (`min(entity[0xD2], 20)`). */
  counterB: number;
  d4Initial: number;
  countdownIterations: number;
  renderTagCalls: number;
}

export interface StateSub18A88Result {
  /** Number of entities processed by the loop (= count word). */
  entityCount: number;
  /** Number of entities with `entity[0x18] == 3` (summary rendered). */
  matchedCount: number;
  matched: StateSub18A88EntityDetail[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function readByte(state: GameState, off: number): number {
  return (state.workRam[off] ?? 0) & 0xff;
}

function writeByte(state: GameState, off: number, v: number): void {
  state.workRam[off] = v & 0xff;
}

function readWordBE(state: GameState, off: number): number {
  return (
    (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff
  );
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

/** Sign-extend a signed 16-bit word into an unsigned-representation 32-bit long. */
function extLowWordToLong(value: number): number {
  const w = value & 0xffff;
  return (w & 0x8000) !== 0 ? (w | 0xffff0000) >>> 0 : w >>> 0;
}

/** Convert an unsigned 32-bit long to a signed JS number. */
function asSignedLong(v: number): number {
  const u = v >>> 0;
  return u >= 0x80000000 ? u - 0x100000000 : u;
}

/** Port of `muls.w #0x3E8, D2`: D2.l = sext_w(D2.lo) * 1000 (signed). */
function mulsW1000(wordValue: number): number {
  const w = wordValue & 0xffff;
  const signed = w & 0x8000 ? w - 0x10000 : w;
  return (signed * SCORE_MULTIPLIER) | 0; // signed 32-bit
}

// ─── Port ────────────────────────────────────────────────────────────────

/**
 *
 * @param state  GameState; directly mutates `workRam[0x3F0]` and summary fields.
 * @param subs   Sub injection callbacks; all default to no-op.
 *
 *
 *   1. `subs.particleInit(state, 0x1C, 0xFF)`.
 *   2. `workRam[0x3F0] += 1`.
 *   3. For i in [0..count):
 *      If entity[0x18] != 3, go to next_iteration.
 *        a. `workRam[0x658] += 1`
 *        b. `subs.clearAlphaTiles(state, 0)`
 *        c. `workRam[0x3F0] += 1`
 *        d. Determine (D5,D6) from entity[0x19]:
 *           - if entity[0x19] != 0: D5 = 0x1400, D6 = 0x1000.
 *           - if entity[0x19] == 0: D5 = 0x1000, D6 = 0x1400.
 *        e. `subs.renderStringVia200(state, 0x22B0A, ext_l(D5))`.
 *        f. `subs.renderStringVia142(state, 0x22AAA, ext_l(D6))`.
 *        g. If count == 2:
 *             tagAttr = i == 0 ? 0x2000 : 0x2400
 *             romPtr = ROM_TAG_TABLE + i*4 (long ptr in ROM)
 *             `subs.renderTag(state, romPtr, 0xC, 5, tagAttr)`.
 *        h. counterA = min(entity[0x6A].w (signed), 99); if
 *           entity[0x6A].w (signed) >= 99 (D0w bge.w D2w fails), keep it.
 *        i. `subs.renderStringHelper(state, ext_l(D5), 2, 0xF, 0xA, 1, ext_l(counterA))`
 *        j. `subs.renderStringHelper(state, ext_l(D6), 5, 0xF, 0x21, 0, sext_l(counterA)*1000)`
 *        k. D4 = 20000 + counterA * 1000
 *        l. `workRam[0x3F0] += 1`
 *        m. counterB = min(entity[0xD2].w, 20)
 *        n. `subs.renderStringHelper(state, ext_l(D5), 2, 0x11, 0xC, 0, ext_l(counterB))`
 *        o. `subs.renderStringHelper(state, ext_l(D6), 5, 0x11, 0x21, 0, sext_l(counterB)*1000)`
 *        p. D4 -= counterB * 1000
 *        q. `subs.renderStringHelper(state, ext_l(D6), 6, 0x13, 0x20, 0, D4)` (display total)
 *        r. `workRam[0x3F0] += 1`
 *        s. `subs.renderStringVia200(state, 0x22AF2, ext_l(D5))`
 *        t. `subs.renderStringVia200(state, 0x22AFE, ext_l(D5))`
 *        u. **Count-down loop**: while D4 > 0 (signed):
 *             D4 -= 250
 *             `subs.addToObjectAccum(state, entityAddr, 250)`
 *             `subs.renderStringHelper(state, ext_l(D6), 6, 0x13, 0x20, 0, D4)`
 *             `subs.formatAndRender(state, entity[0xBC..0xBF],
 *                                   7, 0x18, 0x17, 0, ext_l(D5))`
 *             `subs.waitVblankStateGated(state, 2)`
 *        v. `subs.waitVblankStateGated(state, 0x5A)` (post-screen wait).
 */
export function stateSub18A88(
  state: GameState,
  subs: StateSub18A88Subs = {},
): StateSub18A88Result {
  // ─── Step 1: particleInit(0x1C, 0xFF) ─────────────────────────────────
  subs.particleInit?.(state, PARTICLE_INIT_COUNT, PARTICLE_INIT_MODE);

  // ─── Step 2: workRam[0x3F0] += 1 ──────────────────────────────────────
  writeByte(
    state,
    VBLANK_TICK_COUNTER_OFF,
    (readByte(state, VBLANK_TICK_COUNTER_OFF) + 1) & 0xff,
  );

  // ─── Step 3: per-entity loop ──────────────────────────────────────────
  const count = readWordBE(state, OBJ_COUNT_OFF);
  const result: StateSub18A88Result = {
    entityCount: count,
    matchedCount: 0,
    matched: [],
  };

  let entityAddr = OBJ_BASE_ADDR >>> 0;
  for (let i = 0; i < count; i++, entityAddr = (entityAddr + OBJ_STRIDE) >>> 0) {
    const entityOff = entityAddr - WORK_RAM_BASE;
    const stateByte = readByte(state, entityOff + OBJ_STATE_OFF);
    if (stateByte !== OBJ_TRIGGER_STATE) continue;

    // a. workRam[0x658] += 1
    writeByte(
      state,
      SUMMARY_COUNTER_OFF,
      (readByte(state, SUMMARY_COUNTER_OFF) + 1) & 0xff,
    );

    // b. clearAlphaTiles(0)
    subs.clearAlphaTiles?.(state, 0);

    // c. workRam[0x3F0] += 1
    writeByte(
      state,
      VBLANK_TICK_COUNTER_OFF,
      (readByte(state, VBLANK_TICK_COUNTER_OFF) + 1) & 0xff,
    );

    // d. determine D5 / D6 da entity[0x19]
    // Disasm:
    //   tst.b (0x19,A2)  → beq.b 0x18ae2 ⇒ D0=0x1000   (zero)
    //   move D0,D5
    //   tst.b (0x19,A2)  → beq.b 0x18af8 ⇒ D0=0x1400   (zero)
    //   move D0,D6
    const playerByte = readByte(state, entityOff + OBJ_PLAYER_ID_OFF);
    const isP1 = playerByte === 0;
    const d5 = isP1 ? ATTR_SECONDARY : ATTR_PRIMARY; // 0x1000 if p1 else 0x1400
    const d6 = isP1 ? ATTR_PRIMARY : ATTR_SECONDARY; // 0x1400 if p1 else 0x1000

    // e. renderStringVia200(0x22B0A, ext_l(D5))
    subs.renderStringVia200?.(state, ROM_HEADER_STRING_1, extLowWordToLong(d5));

    // f. renderStringVia142(0x22AAA, ext_l(D6))
    subs.renderStringVia142?.(state, ROM_HEADER_STRING_2, extLowWordToLong(d6));

    // g. Se count == 2: render TAG
    let renderTagCalls = 0;
    if (count === 2) {
      const tagAttr = i === 0 ? TAG_ATTR_PRIMARY : TAG_ATTR_SECONDARY;
      const romPtrSlot = (ROM_TAG_TABLE + i * 4) >>> 0;
      // arg1 = romPtrSlot (long), arg2 = col (0xC), arg3 = tickOff (5),
      // arg4 = tagAttr (low word)
      //   move.l D0,-(SP)            ; D0 = 0x2000 o 0x2400 (tagAttr)
      //   pea (0x5).w                ; tickOff
      //   pea (0xc).w                ; col
      //   move.l (0,A0,D0*1),-(SP)   ; romPtrSlot
      //   jsr 0x286b0
      // FUN_286B0 firma: (arg1=ptr-to-ptr, arg2=col, arg3=tickOff, arg4=attr).
      subs.renderTag?.(
        state,
        romPtrSlot,
        0x0c,
        0x05,
        extLowWordToLong(tagAttr),
      );
      renderTagCalls = 1;
    }

    // h. counterA = clamp(entity[0x6A].w signed, max 99)
    // Disasm:
    //   move.w (0x6A,A2),D2w
    //   moveq #0x63,D0
    //   cmp.w D2w,D0w
    //   bge.b 0x18b7c    ; if D0 (=99) >= D2 → keep D2
    //   moveq #0x63,D2   ; else D2 = 99
    const counterARawW = readWordBE(state, entityOff + OBJ_COUNTER_A_OFF);
    const counterARawSigned = counterARawW & 0x8000 ? counterARawW - 0x10000 : counterARawW;
    const counterA =
      counterARawSigned > COUNTER_A_CLAMP ? COUNTER_A_CLAMP : counterARawSigned;

    // i. renderStringHelper(D5, 2, 0xF, 0xA, 1, ext_l(counterA))
    subs.renderStringHelper?.(
      state,
      extLowWordToLong(d5),
      0x02,
      0x0f,
      0x0a,
      0x01,
      extLowWordToLong(counterA & 0xffff),
    );

    // j. counterA * 1000 (signed, replicating muls.w #0x3E8 then push as long)
    const counterAScaled = mulsW1000(counterA & 0xffff);
    subs.renderStringHelper?.(
      state,
      extLowWordToLong(d6),
      0x05,
      0x0f,
      0x21,
      0x00,
      counterAScaled >>> 0,
    );

    // k. D4 = 20000 + counterA * 1000 (signed 32-bit)
    let d4 = (D4_INIT + counterAScaled) | 0;

    // l. workRam[0x3F0] += 1
    writeByte(
      state,
      VBLANK_TICK_COUNTER_OFF,
      (readByte(state, VBLANK_TICK_COUNTER_OFF) + 1) & 0xff,
    );

    // m. counterB = clamp(entity[0xD2].w signed, max 20)
    const counterBRawW = readWordBE(state, entityOff + OBJ_COUNTER_B_OFF);
    const counterBRawSigned = counterBRawW & 0x8000 ? counterBRawW - 0x10000 : counterBRawW;
    const counterB =
      counterBRawSigned > COUNTER_B_CLAMP ? COUNTER_B_CLAMP : counterBRawSigned;

    // n. renderStringHelper(D5, 2, 0x11, 0xC, 0, ext_l(counterB))
    subs.renderStringHelper?.(
      state,
      extLowWordToLong(d5),
      0x02,
      0x11,
      0x0c,
      0x00,
      extLowWordToLong(counterB & 0xffff),
    );

    // o. counterB * 1000
    const counterBScaled = mulsW1000(counterB & 0xffff);
    subs.renderStringHelper?.(
      state,
      extLowWordToLong(d6),
      0x05,
      0x11,
      0x21,
      0x00,
      counterBScaled >>> 0,
    );

    // p. D4 -= counterB * 1000
    d4 = (d4 - counterBScaled) | 0;

    // q. renderStringHelper(D6, 6, 0x13, 0x20, 0, D4)
    subs.renderStringHelper?.(
      state,
      extLowWordToLong(d6),
      0x06,
      0x13,
      0x20,
      0x00,
      d4 >>> 0,
    );

    // r. workRam[0x3F0] += 1
    writeByte(
      state,
      VBLANK_TICK_COUNTER_OFF,
      (readByte(state, VBLANK_TICK_COUNTER_OFF) + 1) & 0xff,
    );

    // s. renderStringVia200(0x22AF2, ext_l(D5))
    subs.renderStringVia200?.(state, ROM_LABEL_BONUS, extLowWordToLong(d5));
    // t. renderStringVia200(0x22AFE, ext_l(D5))
    subs.renderStringVia200?.(state, ROM_LABEL_TIME, extLowWordToLong(d5));

    const d4Initial = d4;

    // u. count-down loop: while D4 > 0 (signed): decrement by 250 and render
    let countdownIterations = 0;
    while (asSignedLong(d4 >>> 0) > 0) {
      d4 = (d4 - D4_STEP) | 0;
      countdownIterations++;

      // FUN_28608(entityAddr, 250) → addToObjectAccumAndFlag
      subs.addToObjectAccum?.(state, entityAddr, D4_STEP);

      // FUN_28E3C(D6, 6, 0x13, 0x20, 0, D4) — refresh display total
      subs.renderStringHelper?.(
        state,
        extLowWordToLong(d6),
        0x06,
        0x13,
        0x20,
        0x00,
        d4 >>> 0,
      );

      // FUN_28EB2(*entity[0xBC..0xBF], 7, 0x18, 0x17, 0, ext_l(D5))
      const accumLong = readLongBE(state, entityOff + OBJ_ACCUM_LONG_OFF);
      subs.formatAndRender?.(
        state,
        accumLong >>> 0,
        0x07,
        0x18,
        0x17,
        0x00,
        extLowWordToLong(d5),
      );

      // FUN_28DB8(2)
      subs.waitVblankStateGated?.(state, COUNTDOWN_WAIT_TICKS);
    }

    // v. waitVblankStateGated(0x5A) — post-screen pause
    subs.waitVblankStateGated?.(state, POSTSCREEN_WAIT_TICKS);

    result.matched.push({
      index: i,
      entityAddr,
      triggered: true,
      playerId: playerByte,
      attrD5: d5,
      attrD6: d6,
      counterA,
      counterB,
      d4Initial,
      countdownIterations,
      renderTagCalls,
    });
    result.matchedCount++;
  }

  return result;
}

/** Re-export the symbol as "FUN_00018A88" for cross-references. */
export { stateSub18A88 as FUN_00018A88 };
