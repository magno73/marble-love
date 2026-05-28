/**
 * sub-158f6.ts - port of `FUN_000158F6` (46 instructions, range 0x158F6..0x15999).
 *
 * **Caller**: `FUN_000158CC` (`objectUpdatePair158CC`) calls FUN_158F6 twice,
 * once per pair slot @ 0x4009A4 / 0x400A20 (stride 0x7C).
 *
 * **Disasm 0x158F6..0x15999** (46 instructions, one long arg on stack = `slotPtr`):
 *
 *   move.l   A2,-(SP)
 *   movea.l  (0x8,SP),A2                  ; A2 = slotPtr
 *   tst.b    (0x18,A2)
 *   beq.w    0x15996                      ; if 0 -> epilogue
 *   ; --- timer @ +0x6C ---
 *   tst.w    (0x6c,A2)
 *   ble.b    0x15930                      ; <= 0 → skip
 *   subq.w   #1, (0x6c,A2)
 *   tst.w    (0x6c,A2)
 *   cmpi.b   #0x21, (0x1a,A2)
 *   beq.w    0x15926
 *   cmpi.b   #0x22, (0x1a,A2)
 *   bne.b    0x15930                      ; not 0x21/0x22 -> skip
 *   move.l   A2,-(SP); jsr 0x160D4.l; addq.l #4,SP    ; -> enter state 0x23
 *   ; --- 0x15930: state 0x24 timer @ +0x56 ---
 *   cmpi.b   #0x24, (0x1a,A2)
 *   bne.b    0x15954                      ; not 0x24 -> goto state-2 dispatch
 *   tst.b    (0x56,A2)
 *   beq.b    0x15942                      ; == 0 -> skip subq, go to tst
 *   subq.b   #1, (0x56,A2)
 *   tst.b    (0x56,A2)
 *   bne.b    0x1597a                      ; != 0 -> ELSE branch
 *   move.l   A2,-(SP); jsr 0x160D4.l; addq.l #4,SP    ; -> enter state 0x23
 *   bra.b    0x1597a                      ; ELSE branch
 *   ; --- 0x15954: dispatch su (0x18,A2) ---
 *   cmpi.b   #2, (0x18,A2)
 *   bne.b    0x1597a                      ; != 2 -> ELSE branch
 *   ; --- 0x1595c: branch state-2 (s18==2) ---
 *   move.l   A2,-(SP); jsr 0x25FC2.l       ; helper25FC2
 *   move.l   A2,-(SP); jsr 0x1B9CC.l       ; spriteHelper1B9CC
 *   move.l   A2,-(SP); jsr 0x1281C.l       ; objectEnter1281C
 *   lea      (0xc,SP),SP
 *   bra.b    0x15996                      ; -> epilogue
 *   ; --- 0x1597a: ELSE branch ---
 *   move.l   A2,-(SP); jsr 0x253BC.l       ; helper253BC
 *   move.l   A2,-(SP); jsr 0x182BA.l       ; helper182BA
 *   move.l   A2,-(SP); jsr 0x121B8.l       ; helper121B8
 *   lea      (0xc,SP),SP
 *   ; --- 0x15996: epilog ---
 *   movea.l  (SP)+, A2
 *   rts
 *
 *   - `FUN_160D4` → `objectEnterState23` (object-enter-state-23.ts)
 *   - `FUN_25FC2` → `helper25FC2` (helper-25fc2.ts)
 *   - `FUN_1B9CC` → `spriteHelper1B9CC` (sprite-helper-1b9cc.ts)
 *   - `FUN_1281C` → `objectEnter1281C` (object-enter-1281c.ts)
 *   - `FUN_253BC` → `helper253BC` (helper-253bc.ts)
 *   - `FUN_182BA` → `helper182BA` (helper-182ba.ts)
 *   - `FUN_121B8` → `helper121B8` (helper-121b8.ts)
 *
 *   - decrement word @ +0x6C if initially > 0
 *   - decrement byte @ +0x56 if state==0x24 and non-zero
 *     long @ +0x68 = 0x70000
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";
import { objectEnterState23 } from "./object-enter-state-23.js";
import { helper25FC2 } from "./helper-25fc2.js";
import type { Helper25FC2Subs } from "./helper-25fc2.js";
import { spriteHelper1B9CC } from "./sprite-helper-1b9cc.js";
import type { SpriteHelper1B9CCSubs } from "./sprite-helper-1b9cc.js";
import { objectEnter1281C } from "./object-enter-1281c.js";
import { helper253BC } from "./helper-253bc.js";
import { helper182BA } from "./helper-182ba.js";
import type { Helper182BASubs } from "./helper-182ba.js";
import { helper121B8 } from "./helper-121b8.js";
import type { Helper121B8Subs } from "./helper-121b8.js";
import { findNearestNeighbor } from "./nearest-neighbor.js";

// ─── Costanti ────────────────────────────────────────────────────────────────

export const SUB_158F6_ADDR = 0x000158f6 as const;

const WORK_RAM_BASE = 0x00400000 as const;

// Slot field offsets touched directly by FUN_158F6.
const F_S18 = 0x18; // active flag (byte)
const F_S1A = 0x1a; // state byte
const F_S56 = 0x56; // sub-timer byte
const F_S6C = 0x6c; // main timer word

// ─── Helpers locali ──────────────────────────────────────────────────────────

function rB(state: GameState, off: number): number {
  return (state.workRam[off] ?? 0) & 0xff;
}
function wB(state: GameState, off: number, v: number): void {
  state.workRam[off] = v & 0xff;
}
function rW(state: GameState, off: number): number {
  return (((state.workRam[off] ?? 0) << 8) | (state.workRam[off + 1] ?? 0)) & 0xffff;
}
function wW(state: GameState, off: number, v: number): void {
  const u = v & 0xffff;
  state.workRam[off] = (u >>> 8) & 0xff;
  state.workRam[off + 1] = u & 0xff;
}
function sextW(w: number): number {
  return ((w & 0xffff) << 16) >> 16;
}

function enterState23Default(state: GameState, slotPtr: number, rom: RomImage): void {
  objectEnterState23(state, slotPtr, {
    fun_15d10: (st, ptr) => { findNearestNeighbor(st, ptr, rom); },
  });
}

// ─── Sub-injection interface ─────────────────────────────────────────────────

/**
 * opzionali; i default usano le replice TS importate.
 */
export interface Sub158F6Subs {
  /**
   * `FUN_160D4` — `objectEnterState23(state, slotPtr)`.
   * Invoked on 2 paths: state 0x21/0x22 with timer @ +0x6C expired,
   * and state 0x24 with sub-timer @ +0x56 expired.
   */
  objectEnterState23?: (state: GameState, slotPtr: number) => void;

  /**
   * `FUN_25FC2` — `helper25FC2(state, rom, slotPtr, subs)`.
   * Invocata nel branch state-2 (s18==2). Default: import TS.
   */
  helper25FC2?: (state: GameState, rom: RomImage, slotPtr: number) => void;

  /** Pass-through subs per `helper25FC2`. */
  helper25FC2Subs?: Helper25FC2Subs;

  /**
   * `FUN_1B9CC` — `spriteHelper1B9CC(state, slotPtr, flagLong, subs)`.
   * Invocata nel branch state-2. Il caller pusha `A2` come long → flagLong
   * Default: import TS.
   */
  spriteHelper1B9CC?: (state: GameState, slotPtr: number, flagLong: number) => void;

  /** Pass-through subs per `spriteHelper1B9CC`. */
  spriteHelper1B9CCSubs?: SpriteHelper1B9CCSubs;

  /**
   * `FUN_1281C` — `objectEnter1281C(state, slotPtr, inner)`.
   * Invoked in the state-2 branch. Default: TS import with no-op inner (=> 0).
   * NB: FUN_1281C requires an `inner` callback (`FUN_264AA`); default no-op.
   */
  objectEnter1281C?: (state: GameState, slotPtr: number) => void;

  /**
   * `FUN_253BC` — `helper253BC(state, slotPtr)`. Invocata nel branch ELSE.
   * Default: import TS.
   */
  helper253BC?: (state: GameState, slotPtr: number) => void;

  /**
   * `FUN_182BA` — `helper182BA(state, slotPtr, rom, subs)`. Invocata nel
   * branch ELSE. Default: import TS.
   */
  helper182BA?: (state: GameState, slotPtr: number, rom: RomImage) => void;

  /** Pass-through subs per `helper182BA`. */
  helper182BASubs?: Helper182BASubs;

  /**
   * `FUN_121B8` — `helper121B8(state, rom, slotPtr, subs)`. Invocata nel
   * branch ELSE. Default: import TS.
   */
  helper121B8?: (state: GameState, rom: RomImage, slotPtr: number) => void;

  /** Pass-through subs for `helper121B8`. */
  helper121B8Subs?: Helper121B8Subs;
}


/**
 *
 * Decrements slot timers and dispatches the appropriate update branch.
 *
 *                 `0x400A20`). Must fall inside work RAM.
 */
export function fun158F6(
  state: GameState,
  slotPtr: number,
  rom: RomImage,
  subs: Sub158F6Subs = {},
): void {
  const a2 = slotPtr >>> 0;
  const a2Off = (a2 - WORK_RAM_BASE) >>> 0;

  // 0x158FC: tst.b (0x18,A2); beq.w → 0x15996 (epilog)
  if (rB(state, a2Off + F_S18) === 0) return;

  // ── BLOCCO 1: timer word @ +0x6C ────────────────────────────────────────
  // 0x15904: tst.w (0x6c,A2); ble.b → 0x15930
  // ble (signed) = branch if D <= 0 → tratta word come signed
  const t6c = sextW(rW(state, a2Off + F_S6C));
  if (t6c > 0) {
    // 0x1590A: subq.w #1, (0x6c,A2)
    wW(state, a2Off + F_S6C, (t6c - 1) & 0xffff);
    // 0x1590E: tst.w (0x6c,A2); bne.b → 0x15930
    if ((t6c - 1) === 0) {
      // 0x15914: cmpi.b #0x21, (0x1a,A2); beq.w → 0x15926
      // 0x1591E: cmpi.b #0x22, (0x1a,A2); bne.b → 0x15930
      const s1a = rB(state, a2Off + F_S1A);
      if (s1a === 0x21 || s1a === 0x22) {
        // 0x15926: jsr FUN_160D4(A2)
        (subs.objectEnterState23 ?? ((st, ptr) => { enterState23Default(st, ptr, rom); }))(state, a2);
      }
    }
  }

  // ── BLOCCO 2: state 0x24 timer @ +0x56 ──────────────────────────────────
  // 0x15930: cmpi.b #0x24, (0x1a,A2); bne.b → 0x15954 (skip a state-2 dispatch)
  const s1aAfter = rB(state, a2Off + F_S1A);
  if (s1aAfter === 0x24) {
    // 0x15938: tst.b (0x56,A2); beq.b → 0x15942 (skip subq)
    const t56 = rB(state, a2Off + F_S56);
    if (t56 !== 0) {
      // 0x1593E: subq.b #1, (0x56,A2)
      wB(state, a2Off + F_S56, (t56 - 1) & 0xff);
    }
    // 0x15942: tst.b (0x56,A2); bne.b → 0x1597A (ELSE branch)
    const t56New = rB(state, a2Off + F_S56);
    if (t56New === 0) {
      // 0x15948: jsr FUN_160D4(A2)
      (subs.objectEnterState23 ?? ((st, ptr) => { enterState23Default(st, ptr, rom); }))(state, a2);
    }
    // 0x15952: bra.b → 0x1597A (ELSE branch always, regardless of subq path)
    elseBranch(state, a2, rom, subs);
    return;
  }

  // ── BLOCCO 3: dispatch su (0x18,A2) ─────────────────────────────────────
  // 0x15954: cmpi.b #2, (0x18,A2); bne.b → 0x1597A (ELSE)
  const s18Now = rB(state, a2Off + F_S18);
  if (s18Now === 0x02) {
    // 0x1595C: branch state-2
    // jsr FUN_25FC2(A2)
    if (subs.helper25FC2) {
      subs.helper25FC2(state, rom, a2);
    } else {
      helper25FC2(state, rom, a2, subs.helper25FC2Subs);
    }
    // jsr FUN_1B9CC(A2) — caller pusha A2 long; FUN_1B9CC interpreta come
    if (subs.spriteHelper1B9CC) {
      subs.spriteHelper1B9CC(state, a2, a2);
    } else {
      spriteHelper1B9CC(state, a2, a2, subs.spriteHelper1B9CCSubs);
    }
    // jsr FUN_1281C(A2)
    if (subs.objectEnter1281C) {
      subs.objectEnter1281C(state, a2);
    } else {
      // FUN_1281C requires an inner callback (FUN_264AA). Default no-op (→ 0).
      objectEnter1281C(state, a2, () => 0);
    }
    // 0x15974: lea (0xc,SP),SP — pop 3 args (no-op in TS)
    return;
  }

  // 0x1597A: ELSE branch
  elseBranch(state, a2, rom, subs);
}

/** ELSE branch (0x1597A..0x15994): jsr 253BC + 182BA + 121B8. */
function elseBranch(
  state: GameState,
  slotPtr: number,
  rom: RomImage,
  subs: Sub158F6Subs,
): void {
  // jsr FUN_253BC(A2)
  (subs.helper253BC ?? helper253BC)(state, slotPtr);
  // jsr FUN_182BA(A2)
  if (subs.helper182BA) {
    subs.helper182BA(state, slotPtr, rom);
  } else {
    helper182BA(state, slotPtr, rom, subs.helper182BASubs);
  }
  // jsr FUN_121B8(A2)
  if (subs.helper121B8) {
    subs.helper121B8(state, rom, slotPtr);
  } else {
    helper121B8(state, rom, slotPtr, subs.helper121B8Subs);
  }
  // 0x15992: lea (0xc,SP),SP — pop 3 args (no-op in TS)
}
