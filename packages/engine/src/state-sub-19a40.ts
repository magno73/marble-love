/**
 * state-sub-19a40.ts - port of `FUN_00019A40` (362 bytes, 0x019A40-0x019BAA).
 *
 * Scans the 10-entity table at `0x4019F8` (0x38-byte stride). Each mid-loop
 * consumes one `(X.b, Y.b)` pair from `0x244F6`, counts occupied entities whose
 * X cell matches the pair, and may spawn a single entity into the first free
 * table slot. D4 is the threshold for `cmp.b D4,D3; bgt skip`.
 *
 * Spawn initialization writes:
 *
 *   entity[0x18] = 1
 *   entity[0x1A] = 1
 *   entity[0x0C] = sext(D6) << 0x13 + 0x40000   ; X (long, fixed-point)
 *   entity[0x10] = sext(D7) << 0x13 + 0x40000   ; Y
 *   entity[0x14] = 0x3FD80000                   ; Z?
 *   entity[0x24] = 0
 *   entity[0x1B] = 0
 *   entity[0x25] = 0x08                         ; state byte
 *   entity[0x1C] = 0x000224CA                   ; likely AI script ptr
 *   entity[0x04] = 0xFFFC0000                   ; likely velocity
 *
 * External calls:
 *   - `FUN_00019E42(entityPtr)` - marble-cell-dispatch, already replicated.
 *   - `FUN_00018E6C(0xF, sext_l(entity[0x19]))` - slot-insert-sorted.
 *   - `FUN_000158AC(*(0x24500 + D5*4))` - sound/event by mid-loop index.
 *
 * Key ROM tables:
 *   - `0x244F6` (10 bytes): five signed `(X.b, Y.b)` pairs.
 *   - `0x1F0BA` (40 bytes): entity pointer table equivalent to `A3 + i*0x38`.
 *   - `0x24500` (20 bytes): event ID table, one long per pair.
 *
 * Written work RAM:
 *   - The selected entity struct fields at offsets 0x04, 0x0C-0x0F,
 *     0x10-0x13, 0x14-0x17, 0x18, 0x1A, 0x1B, 0x1C-0x1F, 0x24, and 0x25.
 *
 * **Known caller** (1 xref): `FUN_00019BAA` @ 0x019BCE.
 */

import type { GameState } from "./state.js";
import type { RomImage } from "./bus.js";

// ─── ROM table addresses ─────────────────────────────────────────────────

/** ROM addr of (X.b, Y.b) pair table - five pairs, 10 bytes. */
export const ROM_PAIR_TABLE = 0x000244f6 as const;
/** ROM addr of entity ptr table - 10 longs. */
export const ROM_ENTITY_PTR_TABLE = 0x0001f0ba as const;
/** ROM addr of event-ID table for `fun_158ac` - five longs. */
export const ROM_EVENT_TABLE = 0x00024500 as const;

// ─── Entity layout ───────────────────────────────────────────────────────

export const ENTITY_TABLE_BASE = 0x004019f8 as const;
/** Byte stride of one entity. */
export const ENTITY_STRIDE = 0x38 as const;
export const ENTITY_COUNT = 10 as const;

/** Byte: state slot (1 = occupied, != 1 = free). */
export const ENTITY_OCCUPIED_OFFSET = 0x18 as const;
/** Byte: secondary state. */
export const ENTITY_SUBSTATE_OFFSET = 0x1a as const;
/** Long: position X (fixed-point). */
export const ENTITY_POS_X_OFFSET = 0x0c as const;
/** Long: position Y. */
export const ENTITY_POS_Y_OFFSET = 0x10 as const;
/** Long: position Z (?). */
export const ENTITY_POS_Z_OFFSET = 0x14 as const;
/** Byte: clear in init. */
export const ENTITY_CLEAR24_OFFSET = 0x24 as const;
/** Byte: clear in init. */
export const ENTITY_CLEAR1B_OFFSET = 0x1b as const;
/** Byte: state. */
export const ENTITY_STATE_OFFSET = 0x25 as const;
/** Long: AI script ptr. */
export const ENTITY_AI_OFFSET = 0x1c as const;
/** Long: velocity (?) */
export const ENTITY_VEL_OFFSET = 0x04 as const;
/** Byte: read for fun_18E6C arg2. */
export const ENTITY_KEY19_OFFSET = 0x19 as const;

// ─── Init constants ──────────────────────────────────────────────────────

/** entity[0x14] init value. */
export const INIT_POS_Z = 0x3fd80000 as const;
/** entity[0x1C] init value. */
export const INIT_AI_PTR = 0x000224ca as const;
/** entity[0x04] init value. */
export const INIT_VEL = 0xfffc0000 as const;
/** entity[0x25] init value. */
export const INIT_STATE = 0x08 as const;
export const POS_BIAS = 0x40000 as const;
/** Left shift applied to X/Y position (sext_l(byte) << 0x13). */
export const POS_SHIFT = 0x13 as const;
/** Y-distance threshold: skip when `|dy| < 4`. */
export const PROX_Y_THRESHOLD = 4 as const;

/** D5 wraps at 5 (mid-loop iter count = 5 pairs). */
export const MID_LOOP_COUNT = 5 as const;
/** D4 wraps at 2 (outer-loop iter count = 2 passes). */
export const OUTER_LOOP_COUNT = 2 as const;
/** Arg1 long passed to `fun_18e6c`. */
export const FUN_18E6C_ARG1 = 0x0f as const;

// ─── Sub injections ──────────────────────────────────────────────────────

export interface StateSub19A40Subs {
  /** `FUN_00019E42(entityAddr)` - marble-cell-dispatch. */
  fun_19e42?: (state: GameState, entityAddr: number) => void;
  /** `FUN_00018E6C(arg1Long, arg2Long)` - slot-insert-sorted. */
  fun_18e6c?: (state: GameState, arg1Long: number, arg2Long: number) => void;
  /** `FUN_000158AC(arg)` - sound/event dispatcher. */
  fun_158ac?: (state: GameState, arg: number) => void;
}

// ─── Result ──────────────────────────────────────────────────────────────

export interface SpawnRecord {
  /** Outer-loop pass index (0 or 1). */
  outerD4: number;
  /** Mid-loop iter index (0..4). */
  midD5: number;
  pairIndex: number;
  entityAddr: number;
  /** Index (0..9) of the spawned entity in the table. */
  entitySlot: number;
  eventArg: number;
}

export interface StateSub19A40Result {
  /** Total number of spawns (max 10; practically 0..10). */
  spawnCount: number;
  /** Details for each spawn. */
  spawns: SpawnRecord[];
  earlyExit: boolean;
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

function writeLongBE(state: GameState, off: number, v: number): void {
  const x = v >>> 0;
  state.workRam[off] = (x >>> 24) & 0xff;
  state.workRam[off + 1] = (x >>> 16) & 0xff;
  state.workRam[off + 2] = (x >>> 8) & 0xff;
  state.workRam[off + 3] = x & 0xff;
}

function romByte(rom: RomImage, addr: number): number {
  return (rom.program[addr] ?? 0) & 0xff;
}

function romLongBE(rom: RomImage, addr: number): number {
  return (
    (((rom.program[addr] ?? 0) << 24) |
      ((rom.program[addr + 1] ?? 0) << 16) |
      ((rom.program[addr + 2] ?? 0) << 8) |
      (rom.program[addr + 3] ?? 0)) >>>
    0
  );
}

/** Sign-extend byte to signed 32-bit integer. */
function sextByte(b: number): number {
  const v = b & 0xff;
  return v & 0x80 ? v - 0x100 : v;
}

/** Sign-extend word to signed 32-bit integer. */
function sextWord(w: number): number {
  const v = w & 0xffff;
  return v & 0x8000 ? v - 0x10000 : v;
}

/** Convert m68k address to workRam offset. */
function addrToOff(addr: number): number {
  return (addr - 0x400000) >>> 0;
}

// ─── Port ────────────────────────────────────────────────────────────────

/**
 *
 * @param state  GameState. Mutates `state.workRam` for spawned entities.
 * @param subs   Sub injections; default no-op for all three callees.
 *
 * @returns Spawn details, count, and earlyExit flag.
 *
 * **Side effects**:
 *     listed in the module header.
 *
 *   1. outer D4 = 0..1 (early-exit breaks the outer loop)
 *   2. mid D5 = 0..4: each iteration consumes pair @ ROM[0x244F6 + D5*2]
 *   3. inner scan: 10 entities, count matches `entity[0x0C..0x0D].w >> 3 == X`
 *      with `entity[0x18] == 1`; save the first match index.
 *   4. if `D3 > D4`, skip spawn and advance D5.
 *   5. if `D3 == 1`, run Y proximity check; if distance < 4, skip.
 */
export function stateSub19A40(
  state: GameState,
  rom: RomImage,
  subs?: StateSub19A40Subs,
): StateSub19A40Result {
  const spawns: SpawnRecord[] = [];
  let earlyExit = false;

  // Outer loop: D4 = 0..1
  outer: for (let d4 = 0; d4 < OUTER_LOOP_COUNT; d4++) {
    // A1 resets to ROM_PAIR_TABLE at the start of each outer pass.
    let pairIdx = 0;

    for (let d5 = 0; d5 < MID_LOOP_COUNT; d5++) {
      // D6 = (A1)+.b ; D7 = (A1)+.b
      const d6Byte = romByte(rom, ROM_PAIR_TABLE + pairIdx * 2);
      const d7Byte = romByte(rom, ROM_PAIR_TABLE + pairIdx * 2 + 1);
      pairIdx++;
      const d6Sext = sextByte(d6Byte); // signed for compare

      // Inner scan: count matches and remember first match index.
      let d3 = 0; // match count
      let firstMatchSlot = 0; // saved at (-1, A6), only when D3 < 2
      for (let d2 = 0; d2 < ENTITY_COUNT; d2++) {
        const entityAddr = ENTITY_TABLE_BASE + d2 * ENTITY_STRIDE;
        const off = addrToOff(entityAddr);
        if (readByte(state, off + ENTITY_OCCUPIED_OFFSET) === 1) {
          // D0 = sext_w(D6.b) -> then cmp.w D1,D0 with D1 = (A2[0xC..0xD]).w >>3 (asr.w)
          const xWord = readWordBE(state, off + ENTITY_POS_X_OFFSET);
          const xSigned = sextWord(xWord);
          // asr.w #3 — arithmetic shift right (signed), retain sign.
          const xShifted = xSigned >> 3;
          // cmp.w D1, D0: word-level compare. D0 = sext_w(d6Byte).
          if ((xShifted & 0xffff) === (d6Sext & 0xffff)) {
            d3++;
            if (d3 < 2) {
              firstMatchSlot = d2;
            }
          }
        }
      }

      // if (D3 > D4) skip spawn.
      if (d3 > d4) {
        continue;
      }

      // if (D3 == 1): proximity Y-check via the matched entity.
      if (d3 === 1) {
        // A2 = *(0x1F0BA + firstMatchSlot * 4) — long ROM.
        const entityAddr = romLongBE(
          rom,
          ROM_ENTITY_PTR_TABLE + firstMatchSlot * 4,
        );
        const off = addrToOff(entityAddr);
        // D1 = sext_l(D7); D0 = sext_l((A2[0x10..0x11]).w) >> 3 (asr.l #3)
        const d1Long = sextByte(d7Byte); // A4 was sext_l(D7.b)
        const yWord = readWordBE(state, off + ENTITY_POS_Y_OFFSET);
        const ySigned = sextWord(yWord);
        const yShifted = ySigned >> 3; // signed asr.l
        const diff = d1Long - yShifted;
        // cmp.l D1, D0 with D0 = 4: bgt if 4 > D1 → skip
        if (4 > diff) {
          continue;
        }
      }

      // Find first free slot (entity[0x18] != 1).
      let freeSlot: number = ENTITY_COUNT;
      for (let d2 = 0; d2 < ENTITY_COUNT; d2++) {
        const entityAddr = ENTITY_TABLE_BASE + d2 * ENTITY_STRIDE;
        const off = addrToOff(entityAddr);
        if (readByte(state, off + ENTITY_OCCUPIED_OFFSET) !== 1) {
          freeSlot = d2;
          break;
        }
      }
      if (freeSlot === ENTITY_COUNT) {
        // No slot free → exit function entirely.
        earlyExit = true;
        break outer;
      }

      // Spawn into the free slot.
      const entityAddr = ENTITY_TABLE_BASE + freeSlot * ENTITY_STRIDE;
      const off = addrToOff(entityAddr);

      writeByte(state, off + ENTITY_OCCUPIED_OFFSET, 1);
      writeByte(state, off + ENTITY_SUBSTATE_OFFSET, 1);

      // entity[0x0C] = sext_l(D6.b) << 0x13 + 0x40000
      const xLong = ((d6Sext << POS_SHIFT) + POS_BIAS) >>> 0;
      writeLongBE(state, off + ENTITY_POS_X_OFFSET, xLong);

      // entity[0x10] = sext_l(D7.b) << 0x13 + 0x40000
      const d7Sext = sextByte(d7Byte);
      const yLong = ((d7Sext << POS_SHIFT) + POS_BIAS) >>> 0;
      writeLongBE(state, off + ENTITY_POS_Y_OFFSET, yLong);

      writeLongBE(state, off + ENTITY_POS_Z_OFFSET, INIT_POS_Z);
      writeByte(state, off + ENTITY_CLEAR24_OFFSET, 0);
      writeByte(state, off + ENTITY_CLEAR1B_OFFSET, 0);
      writeByte(state, off + ENTITY_STATE_OFFSET, INIT_STATE);
      writeLongBE(state, off + ENTITY_AI_OFFSET, INIT_AI_PTR);
      writeLongBE(state, off + ENTITY_VEL_OFFSET, INIT_VEL);

      // Sub-call 1: fun_19e42(entityAddr).
      subs?.fun_19e42?.(state, entityAddr);

      // Sub-call 2: fun_18e6c(arg1=0xF, arg2=sext_l(entity[0x19].b)).
      const key19 = readByte(state, off + ENTITY_KEY19_OFFSET);
      const key19Sext = sextByte(key19);
      subs?.fun_18e6c?.(state, FUN_18E6C_ARG1, key19Sext);

      // Sub-call 3: fun_158ac(arg = ROM[0x24500 + d5*4]).
      // m68k: D0 = D5.b sext_w; asl.w #2,D0w; A0 = *(0x24500 + D0.w).
      const eventArg = romLongBE(rom, ROM_EVENT_TABLE + d5 * 4);
      subs?.fun_158ac?.(state, eventArg);

      spawns.push({
        outerD4: d4,
        midD5: d5,
        pairIndex: pairIdx - 1,
        entityAddr,
        entitySlot: freeSlot,
        eventArg,
      });

      // direttamente al D4++.
      break;
    }
  }

  return {
    spawnCount: spawns.length,
    spawns,
    earlyExit,
  };
}
