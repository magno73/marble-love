/**
 * state-sub-1960e.ts - port of `FUN_0001960E` (132 bytes).
 *
 * "Entity RNG-driven animation/state-byte resampler". Receives an entity-struct
 * pointer on the stack (A2 = arg long) and, based on state byte `entity[0x25]`,
 * resamples counter `entity[0x26]` through the PRNG before calling
 * `FUN_00019692` (heavy update) with the same entity.
 *
 * **Disasm 0x1960E..0x19691** (132 byte):
 *
 *   movem.l {A3,A2},-(SP)              ; save A2,A3
 *   movea.l (0xc,SP),A2                ; A2 = arg (entity ptr)
 *   movea.l #0x13a98,A3                ; A3 = &FUN_13A98 (RNG)
 *   cmpi.b  #0x7,(0x25,A2)
 *   bne.b   not_state7                 ; if state != 7 → not_state7
 *   ; ─── state == 7 branch (jitter ±2) ──────────────────────────────────
 *   pea     (0x5).w                    ; push 5 (long sext)
 *   jsr     (A3)                       ; D0 = rng(5) ∈ [0..4]
 *   add.b   (0x26,A2),D0b              ; D0.b += entity[0x26]
 *   subq.b  #2,D0b                     ; D0.b -= 2
 *   andi.b  #0xf,D0b                   ; D0.b &= 0x0F
 *   move.b  D0b,(0x26,A2)              ; entity[0x26] = D0
 *   addq.l  #4,SP                      ; pop arg
 *   bra.b   call_19692
 * not_state7:
 *   tst.l   (A2)
 *   bne.b   long0_nonzero
 *   ; ─── (state != 7) AND entity[0..3] == 0 ─────────────────────────────
 *   pea     (0x2).w                    ; push 2
 *   jsr     (A3)                       ; D0 = rng(2) ∈ [0..1]
 *   asl.l   #3,D0                      ; D0 <<= 3 → 0 or 8
 *   move.b  D0b,(0x26,A2)              ; entity[0x26] = D0.b (0 or 8)
 *   addq.l  #4,SP
 *   bra.b   middle
 * long0_nonzero:
 *   ; ─── (state != 7) AND entity[0..3] != 0 ─────────────────────────────
 *   pea     (0x2).w                    ; push 2
 *   jsr     (A3)                       ; D0 = rng(2)
 *   asl.l   #3,D0                      ; D0 <<= 3
 *   addq.b  #4,D0b                     ; D0.b += 4 → 4 or 12
 *   move.b  D0b,(0x26,A2)
 *   addq.l  #4,SP
 *   ; fall through
 * middle:                              ; @ 0x19660
 *   pea     (0x4).w                    ; push 4
 *   jsr     (A3)                       ; D0 = rng(4) ∈ [0..3]
 *   tst.l   D0
 *   addq.l  #4,SP
 *   bne.b   call_19692                 ; if D0 != 0 → skip clear-block
 *   cmpi.b  #0x9,(0x25,A2)
 *   bne.b   call_19692                 ; if state != 9 → skip
 *   ; ─── clear-block (rng==0 && state==9) ───────────────────────────────
 *   move.b  #0x10,(0x26,A2)            ; entity[0x26] = 0x10
 *   moveq   #0,D0
 *   move.l  D0,(0x4,A2)                ; entity[0x4..0x7] = 0
 *   move.l  D0,(A2)                    ; entity[0x0..0x3] = 0
 * call_19692:                          ; @ 0x19682
 *   move.l  A2,-(SP)                   ; push entity ptr
 *   jsr     0x00019692.l               ; heavy update
 *   addq.l  #4,SP
 *   movem.l (SP)+,{A2,A3}
 *   rts
 *
 * **Semantics** (summary):
 *   - state == 7  → entity[0x26] = (entity[0x26] + rng(5) - 2) & 0x0F
 *                   (random walk ±2, wrapped 4-bit)
 *   - state != 7  ->
 *       entity[0x26] = rng(2) << 3                           if entity[0..3] == 0
 *       then, if rng(4) == 0 AND state == 9:
 *            entity[0x26] = 0x10; entity[0..7] = 0;
 *
 * **External JSRs**:
 *   - `FUN_00013A98` = PRNG 16-bit Galois LFSR (rng.ts:`rngNext`) is replicated.
 *     (`stateSub1960ESubs.fun_19692`); default no-op.
 *
 * **Known caller** (1 xref): `FUN_000194BA` @ 0x000194E8 - root dispatcher
 *
 * **Side effects** in `state.workRam` (entity @ argAddr):
 *   - `entity[0x0..0x7]`: cleared only in the (state==9 && rng(4)==0) branch.
 *   - `state.rng.seed` advanced by 1 or 2 LFSR steps.
 *
 */

import type { GameState } from "./state.js";
import { rngNext } from "./rng.js";
import { as_u16 } from "./wrap.js";

// ─── Entity offsets ──────────────────────────────────────────────────────

export const ENTITY_LONG0_OFFSET = 0x00 as const;
export const ENTITY_LONG1_OFFSET = 0x04 as const;
/** Byte: entity state byte (main branch selector). */
export const ENTITY_STATE_OFFSET = 0x25 as const;
export const ENTITY_COUNTER_OFFSET = 0x26 as const;

// ─── RNG limits ──────────────────────────────────────────────────────────

/** Limit per state==7 (jitter ±2). */
export const RNG_LIMIT_STATE7 = 5 as const;
/** Limit per branch entity[0..3] == 0 / != 0. */
export const RNG_LIMIT_LONG0 = 2 as const;
export const RNG_LIMIT_FINAL = 4 as const;

export const CLEAR_COUNTER_VALUE = 0x10 as const;
export const STATE_CLEAR_TRIGGER = 0x09 as const;
/** State byte for the +/-2 jitter branch. */
export const STATE_JITTER = 0x07 as const;

// ─── Sub injection ───────────────────────────────────────────────────────

/**
 * Stub injection for `FUN_00019692` (heavy entity update). Default: no-op.
 *
 * Tests can either inject a live implementation or leave it as a parity no-op.
 */
export interface StateSub1960ESubs {
  /** Callback for `FUN_00019692`. Default: no-op. */
  fun_19692?: (state: GameState, entityAddr: number) => void;
}


export type Branch = "state7" | "long0_zero" | "long0_nonzero";

export interface StateSub1960EResult {
  /** Branch executed for the first entity[0x26] resample. */
  branch: Branch;
  firstRng: number;
  /**
   */
  finalRng: number | null;
  clearBlockExecuted: boolean;
  newCounter: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function readByte(state: GameState, off: number): number {
  return (state.workRam[off] ?? 0) & 0xff;
}

function writeByte(state: GameState, off: number, v: number): void {
  state.workRam[off] = v & 0xff;
}

function readLongBE(state: GameState, off: number): number {
  return (
    ((state.workRam[off] ?? 0) << 24) |
    ((state.workRam[off + 1] ?? 0) << 16) |
    ((state.workRam[off + 2] ?? 0) << 8) |
    (state.workRam[off + 3] ?? 0)
  ) >>> 0;
}

function writeLongBE(state: GameState, off: number, v: number): void {
  state.workRam[off] = (v >>> 24) & 0xff;
  state.workRam[off + 1] = (v >>> 16) & 0xff;
  state.workRam[off + 2] = (v >>> 8) & 0xff;
  state.workRam[off + 3] = v & 0xff;
}

/**
 * Wrapper around `rngNext` with `r mod limit` normalization.
 *
 * The ROM helper (`FUN_13A98`) produces `[0, limit)`. Our `rngNext` can produce
 * limit`, as in `palette-rng-fill-26cfa.ts`.
 */
function rng(state: GameState, limit: number): number {
  let r = rngNext(state.rng, as_u16(limit)) as unknown as number;
  if (limit > 0) {
    while (r >= limit) r -= limit;
  }
  return r & 0xffff;
}

// ─── Port ────────────────────────────────────────────────────────────────

/**
 *
 * @param state       GameState. Mutates `state.workRam[entity..entity+0x27]`
 *                    and `state.rng.seed`.
 *                    Converts `entityAddr - 0x400000` to access `workRam`.
 *                    Default: no-op.
 *
 * @returns Executed branch, RNG samples, and the new counter.
 *
 *   1. `entity[0x26]` is rewritten by the main branch (state7 / long0).
 *      `tst.l D0`).
 *   3. `entity[0x26] = 0x10`, `entity[0..7] = 0` only when rng(4)==0 && state==9.
 */
export function stateSub1960E(
  state: GameState,
  entityAddr: number,
  subs?: StateSub1960ESubs,
): StateSub1960EResult {
  const off = (entityAddr - 0x400000) >>> 0;

  const stateByte = readByte(state, off + ENTITY_STATE_OFFSET);

  let branch: Branch;
  let firstRng: number;
  let finalRng: number | null = null;
  let clearBlockExecuted = false;

  if (stateByte === STATE_JITTER) {
    // ─── state == 7: jitter +/-2 ────────────────────────────────────────
    branch = "state7";
    firstRng = rng(state, RNG_LIMIT_STATE7); // [0..4]
    const oldCounter = readByte(state, off + ENTITY_COUNTER_OFFSET);
    // add.b counter, D0 -> subq.b #2, D0 -> andi.b #0xF, D0
    // 68010 byte arithmetic: add mod 256, subtract mod 256, mask to 4 bits.
    const sum = (oldCounter + firstRng - 2) & 0xff;
    const newCounter = sum & 0x0f;
    writeByte(state, off + ENTITY_COUNTER_OFFSET, newCounter);
    // bra -> call_19692 (skip middle/RNG(4)).
  } else {
    const long0 = readLongBE(state, off + ENTITY_LONG0_OFFSET);
    if (long0 === 0) {
      // ─── (state != 7) AND entity[0..3] == 0 ───────────────────────────
      branch = "long0_zero";
      firstRng = rng(state, RNG_LIMIT_LONG0); // [0..1]
      // Produces 0 or 8.
      const counter = (firstRng << 3) & 0xff;
      writeByte(state, off + ENTITY_COUNTER_OFFSET, counter);
    } else {
      // ─── (state != 7) AND entity[0..3] != 0 ───────────────────────────
      branch = "long0_nonzero";
      firstRng = rng(state, RNG_LIMIT_LONG0); // [0..1]
      const counter = (((firstRng << 3) + 4) & 0xff);
      writeByte(state, off + ENTITY_COUNTER_OFFSET, counter);
    }

    finalRng = rng(state, RNG_LIMIT_FINAL); // [0..3]
    if (finalRng === 0 && stateByte === STATE_CLEAR_TRIGGER) {
      // clear-block: entity[0x26] = 0x10; entity[0..7] = 0
      writeByte(state, off + ENTITY_COUNTER_OFFSET, CLEAR_COUNTER_VALUE);
      writeLongBE(state, off + ENTITY_LONG1_OFFSET, 0);
      writeLongBE(state, off + ENTITY_LONG0_OFFSET, 0);
      clearBlockExecuted = true;
    }
  }

  subs?.fun_19692?.(state, entityAddr);

  return {
    branch,
    firstRng,
    finalRng,
    clearBlockExecuted,
    newCounter: readByte(state, off + ENTITY_COUNTER_OFFSET),
  };
}
